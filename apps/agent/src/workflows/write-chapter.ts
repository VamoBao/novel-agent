import { generateText } from "ai";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import type {
  ReviewReport,
  ReviewStageResult,
  WriteProgressPhase,
  Document,
  WritingPrefsOverride,
} from "@novel/shared";
import { resolveChapterLength, resolveStylePassScore } from "@novel/shared";
import type { UiChannel } from "../ui/channel";
import { getWritingModel } from "../providers/writing-model";
import { model as agentSessionModel } from "../providers/agent-model";
import { resolveSystemWritingPrefs } from "../providers/writing-prefs";
import { getDefaultNovelStore, type NovelStore } from "../state/novel-store";
import { getDefaultOutlineStore, type OutlineStore } from "../state/outline-store";
import { getDefaultWorldviewStore, type WorldviewStore } from "../state/worldview-store";
import { getDefaultCharacterStore, type CharacterStore } from "../state/character-store";
import { getDefaultDocumentStore, type DocumentStore } from "../state/document-store";
import { getDefaultStyleReferenceStore, type StyleReferenceStore } from "../state/style-reference-store";
import { getDefaultForeshadowStore, type ForeshadowStore } from "../state/foreshadow-store";
import {
  getDefaultCharacterMigrationStore,
  type CharacterMigrationStore,
} from "../state/migration-store";
import { buildChapterForeshadowContext } from "./foreshadow-context";
import {
  buildCharacterStateContext,
  buildNeighborChapterContext,
} from "./chapter-context";
import {
  MAX_REVIEW_ROUNDS,
  formatRevisionBlock,
  reviewChapter,
} from "./chapter-review";
import { OUTPUT_DIR } from "../output/outline-writer";
import {
  buildChapterDocumentPath,
  countWords,
  removeDocumentArtifact,
  writeDocumentArtifact,
} from "../output/document-writer";

/** 正文生成流程进度事件：单段完成附 stageResult；完整 report 附在 revising / saving。 */
export interface WriteProgressEvent {
  chapterNodeId: string;
  round: number;
  totalRounds: number;
  phase: WriteProgressPhase;
  report?: ReviewReport;
  stageResult?: ReviewStageResult;
}

export interface WriteChapterOptions {
  /** 交互通道（终端 / 协议 / 测试替身），业务交互的唯一出口 */
  channel: UiChannel;
  /** 目标小说创作 ID */
  novelId: string;
  /** 目标章的 outlines 表节点 ID */
  chapterNodeId: string;
  /** 写作模型实例；缺省 getWritingModel()（OpenAI 接口兼容端点，环境变量配置，测试注入替身） */
  model?: LanguageModelV4;
  /** 校验模型实例（三段校验独立调用）；缺省 Agent 会话模型——配置了独立写作模型时天然「他评」 */
  reviewModel?: LanguageModelV4;
  /** 流程进度回调（headless 映射为 write-progress 协议消息；CLI / 测试可不传） */
  onProgress?: (event: WriteProgressEvent) => void;
  /** 正文产物根目录；缺省 output（NOVEL_OUTPUT_DIR，协议模式下宿主传绝对路径），测试注入临时目录 */
  outputDir?: string;
  /** 系统级写作偏好（章节篇幅 + 文风合格线的系统设置）；缺省读环境变量
   *  NOVEL_CHAPTER_LENGTH_MIN/MAX + NOVEL_STYLE_PASS_SCORE（客户端 childEnv 注入），测试注入替身 */
  systemWritingPrefs?: WritingPrefsOverride;
  novelStore?: NovelStore;
  outlineStore?: OutlineStore;
  worldviewStore?: WorldviewStore;
  characterStore?: CharacterStore;
  documentStore?: DocumentStore;
  /** 参考文风库；缺省 getDefaultStyleReferenceStore()，测试注入替身 */
  styleReferenceStore?: StyleReferenceStore;
  /** 伏笔库；缺省 getDefaultForeshadowStore()，测试注入替身 */
  foreshadowStore?: ForeshadowStore;
  /** 角色迁移库（本章角色状态与迁移阶段解析）；缺省 getDefaultCharacterMigrationStore() */
  migrationStore?: CharacterMigrationStore;
}

export interface WriteChapterResult {
  novelId: string;
  chapterNodeId: string;
  chapterName: string;
  documentId: string;
  wordCount: number;
}

/** 报告 → 一行摘要（notify 文案用）：内容 N 处、文风 X 分（或无文风要求）、自洽 M 处 */
function describeReport(report: ReviewReport): string {
  const styleText = report.style.skipped
    ? "无文风要求"
    : `文风 ${report.style.score} 分`;
  return `内容 ${report.content.issues.length} 处、${styleText}、自洽 ${report.consistency.issues.length} 处`;
}

/**
 * 章节正文生成工作流（客户端章节点「✍️ 生成本章正文」入口）：
 * 从库中校验并组装写作上下文（小说名/logline、世界观、本章绑定的登场角色摘要
 * （character_ids 过滤——未绑定的旧章回退全库）、所属部/幕
 * 梗概与关键情节点、本章概述、同幕前后章概述、本章绑定伏笔——登场卡片 /
 * 回收卡片+登场章上下文），交写作模型（OpenAI 接口
 * 兼容端点，与 Agent 会话模型解耦；WRITING_MODEL_* 未配置时回落 Agent
 * 会话模型）生成正文；生成后、落盘前经校验 subAgent（chapter-review，
 * Agent 模型三段独立调用——内容约束 / 文风相似度 / 前后自洽）产出结构化整改
 * 报告：通过（内容与自洽零问题且文风 skipped 或达到合格线）才落盘入库；未达标
 * 按报告修订式重写（原上下文 + 上一版正文 + 整改报告），最多 MAX_REVIEW_ROUNDS
 * 轮，第 3 轮仍未达标保存最后一版并警告（产物优先，用户确认的决策）。
 * 该章已有正文时为**重新生成**：流程完全一致，落库走覆盖替换
 * （replaceChapterDocument 单事务删旧行插新行），事务提交后清理旧正文文件；
 * 任一环节失败（校验抛错 / 库故障）新文件回滚删除，旧正文零影响。
 * 正文**存文件系统**（`<output>/<小说名>-<创作ID前8位>/<部名>/<章名>.md`，
 * 人类可直接阅读），先写文件、后经单事务登记元数据
 * （file_path + 字数）并绑定章节点 document_id；库失败时回滚删除已写文件，
 * 不留孤儿。
 * 校验失败（小说/章不存在、非章节点、缺概述、世界观未确认）与
 * 校验调用异常（网络 / schema 不合）抛可读错误，由调用方（协议入口）转为
 * fatal error 消息，零落盘零入库。
 */
export async function writeChapter(options: WriteChapterOptions): Promise<WriteChapterResult> {
  const { channel, novelId, chapterNodeId } = options;
  const novelStore = options.novelStore ?? getDefaultNovelStore();
  const outlineStore = options.outlineStore ?? getDefaultOutlineStore();
  const worldviewStore = options.worldviewStore ?? getDefaultWorldviewStore();
  const characterStore = options.characterStore ?? getDefaultCharacterStore();
  const documentStore = options.documentStore ?? getDefaultDocumentStore();
  const styleReferenceStore = options.styleReferenceStore ?? getDefaultStyleReferenceStore();
  const foreshadowStore = options.foreshadowStore ?? getDefaultForeshadowStore();
  const migrationStore = options.migrationStore ?? getDefaultCharacterMigrationStore();
  const outputDir = options.outputDir ?? OUTPUT_DIR;

  const novel = novelStore.getNovel(novelId);
  if (!novel) {
    throw new Error(`小说不存在，无法生成正文：${novelId}`);
  }

  // 写作偏好生效值：小说级（novels 行）> 系统级（环境变量，客户端设置注入）> 内置默认
  //（篇幅 2000~3000 / 文风合格线 80）；篇幅 min/max 为整体覆盖，半设/乱序的级防御性跳过
  const systemWritingPrefs = options.systemWritingPrefs ?? resolveSystemWritingPrefs();
  const chapterLength = resolveChapterLength(novel, systemWritingPrefs);
  const stylePassScore = resolveStylePassScore(novel, systemWritingPrefs);

  const chapter = outlineStore.getOutlineNode(chapterNodeId);
  if (!chapter || chapter.novelId !== novelId) {
    throw new Error(`章节节点不存在或不属于该小说：${chapterNodeId}`);
  }
  if (chapter.node.type !== "chapter") {
    throw new Error(`所选节点不是章（类型为 ${chapter.node.type}），无法生成正文：${chapter.node.name}`);
  }
  if (chapter.node.summary === null) {
    throw new Error(`章「${chapter.node.name}」缺少剧情概述（旧数据未入库内容），无法生成正文`);
  }

  const act = chapter.node.parentId ? outlineStore.getOutlineNode(chapter.node.parentId) : undefined;
  if (!act || act.node.type !== "act") {
    throw new Error(`章「${chapter.node.name}」缺少所属幕节点，无法组装写作上下文`);
  }
  const part = act.node.parentId ? outlineStore.getOutlineNode(act.node.parentId) : undefined;
  if (!part || part.node.type !== "part") {
    throw new Error(`章「${chapter.node.name}」缺少所属部节点，无法组装写作上下文`);
  }

  // 一章一份：已有正文走重生成路径（覆盖替换——同事务换库行、提交后清理旧文件），
  // 无正文走首次生成；两条路径的生成与校验流程完全一致
  const existing = documentStore.getDocumentByChapter(chapterNodeId);
  const isRegen = existing !== undefined;

  const storedWorldview = worldviewStore.getWorldview(novelId);
  if (!storedWorldview) {
    throw new Error("该小说世界观未确认（库中无记录），无法生成正文");
  }

  // 前后章衔接：按**全书章序**解析（覆盖跨幕衔接）——上一章正文可用且不超预算时纳入，
  // 否则回退概述；下一章只取概述（不抢写其情节）
  const neighbors = buildNeighborChapterContext({
    novelId,
    chapterNodeId,
    outlineStore,
    documentStore,
    outputDir,
  });

  // 参考文风（可选增强，不阻塞生成）：只注入启用的样本，全部停用或未添加时零注入零通知
  const enabledStyles = styleReferenceStore
    .listStyleReferences(novelId)
    .filter((stored) => stored.styleReference.enabled);

  // 登场角色状态与迁移阶段（章节规划确认时绑定到章节点 character_ids）：基准卡 +
  // 已结束迁移组成该章角色参考；进行中 / 结束章的变化作为独立计划块传入（不让目标新值
  // 提前覆盖既有特征）。未绑定（null，旧数据）或绑定角色均已不在库时回退全库注入并 notify
  const characterContext = buildCharacterStateContext({
    novelId,
    chapterNodeId,
    characterStore,
    migrationStore,
    outlineStore,
    castIds: chapter.node.characterIds,
  });
  if (characterContext.fallbackToLibrary) {
    channel.notify("🎭 本章未绑定登场角色（旧数据），已回退注入全库角色参考");
  }

  // 本章伏笔（可选增强，不阻塞生成）：绑定到本章的伏笔——登场注入卡片、回收注入卡片
  // + 登场章上下文（正文优先、概述兜底、预算护栏，详见 foreshadow-context.ts）；
  // 同一份 lines 同时进写作 prompt 与校验 ①（校验所见即写作者所见）
  const foreshadowContext = buildChapterForeshadowContext({
    novelId,
    chapterNodeId,
    foreshadowStore,
    outlineStore,
    documentStore,
    characterStore,
    outputDir,
  });
  const hasForeshadows = foreshadowContext.lines.length > 0;

  // 条件附加要求（伏笔/文风）编号顺延，末条固定「只输出正文文本」——无附加条时与既有形态一致
  const extraRequirements: string[] = [];
  if (characterContext.planCount > 0) {
    extraRequirements.push(
      "本章角色变化按【本章角色变化计划】推进：进行中的人物属性变化呈现渐变过程、标「本章完成」的人物属性在本章内完成转变，不得提前呈现目标状态的全部特征，也不得让角色凭空声称此前未发生的事；作者创作指导仅约束创作方向，方案调整完成不表示结局事件已经发生；",
    );
  }
  if (hasForeshadows) {
    extraRequirements.push(
      "本章如有登场伏笔，按注意度控制显隐程度、自然带出不刻意；如有回收伏笔，按每条标注的回收阶段呼应登场细节：阶段回收保留核心真相，最终回收必须在本章揭露完整真相并收尾，解释表面行为与真相的联系，不得留待后章；对明确标为最终回收的伏笔，最终收尾要求优先于概述中推迟揭露或继续悬置的描述，其余情节仍遵循概述；不要复述登场原文；",
    );
  }
  if (enabledStyles.length > 0) {
    extraRequirements.push(
      "模仿参考文风样本的叙事语言、句式节奏与描写风格，但不抄袭其具体情节与专有名词；",
    );
  }

  channel.notify(
    `${isRegen ? "🔄 重新生成中（将覆盖现有正文）" : "✍️ 正文生成中"}（《${novel.name ?? "未命名小说"}》· ${chapter.node.name}，写作模型）…`,
  );
  // 小说级偏好已生效时通报（确认覆盖确实生效；未设置时零通知，默认路径无噪音）
  if (novel.chapterLengthMin !== null && novel.chapterLengthMax !== null) {
    channel.notify(`📏 本小说篇幅偏好：约 ${chapterLength.min}~${chapterLength.max} 字（覆盖系统设置）`);
  }
  if (novel.stylePassScore !== null) {
    channel.notify(`📏 本小说文风合格线：${stylePassScore} 分（覆盖系统设置）`);
  }
  if (characterContext.planCount > 0) {
    channel.notify(
      `🎭 本章角色变化计划：${characterContext.planCount} 条（进行中 / 本章完成，共 ${characterContext.characterCount} 名登场角色）`,
    );
  }
  if (hasForeshadows) {
    channel.notify(
      `🔮 本章伏笔：登场 ${foreshadowContext.appearCount} 条、回收 ${foreshadowContext.recoverCount} 条` +
        (foreshadowContext.degradedCount > 0
          ? `（${foreshadowContext.degradedCount} 条登场章正文缺失或超预算，以概述代替）`
          : ""),
    );
  }
  if (enabledStyles.length > 0) {
    channel.notify(
      `🖋️ 本次参考文风：${enabledStyles.map((stored) => stored.styleReference.name).join("、")}`,
    );
  }

  const model = options.model ?? getWritingModel();
  const reviewModel = options.reviewModel ?? agentSessionModel;
  const { onProgress } = options;

  /** 写作 prompt（初稿与修订版共用主体；修订版追加上一版正文与整改报告块，末条要求替换为修订指令） */
  const buildPrompt = (
    revision: { previousContent: string; revisionBlock: string } | null,
  ): string =>
    [
      "你是一位经验丰富的小说作者，请依据下面的资料把指定章节的剧情概述扩写为小说正文。",
      "",
      "【小说】",
      `书名：${novel.name ?? "未命名小说"}`,
      novel.description ? `一句话简介：${novel.description}` : null,
      "",
      "【世界观】",
      JSON.stringify(storedWorldview.worldview),
      "",
      ...(characterContext.lines.length > 0 ? characterContext.lines : ["【登场角色参考】", "（暂无入库角色）"]),
      "",
      "【所属部】",
      `${part.node.name}：${part.node.summary ?? "（缺部梗概）"}`,
      "",
      "【所属幕】",
      `${act.node.name}：${act.node.summary ?? "（缺幕梗概）"}`,
      act.node.keyPlotPoints ? `幕关键情节点：${act.node.keyPlotPoints.join("；")}` : null,
      "",
      "【本章】",
      `${chapter.node.name}：${chapter.node.summary}`,
      "",
      neighbors.previous
        ? `【上一章（衔接其结尾，不要重复叙述）】\n${neighbors.previous.name}：${neighbors.previous.summary ?? "（无概述）"}` +
          (neighbors.previousProse
            ? `\n上一章正文（衔接其收束，不要照抄）：\n${neighbors.previousProse}`
            : "")
        : null,
      neighbors.next
        ? `【下一章（为其留出衔接空间，不要抢写其情节）】\n${neighbors.next.name}：${neighbors.next.summary ?? "（无概述）"}`
        : null,
      // 本章伏笔插在下一章块之后、参考文风之前：核心叙事上下文区，长样本文风仍留尾部
      ...(hasForeshadows ? ["", ...foreshadowContext.lines] : []),
      // 参考文风放 prompt 尾部：不把世界观/角色/本章概述等核心上下文推远，且紧邻风格指令
      ...(enabledStyles.length > 0
        ? [
            "",
            "【参考文风】",
            enabledStyles
              .map((stored) => `（${stored.styleReference.name}）\n${stored.styleReference.content}`)
              .join("\n\n"),
          ]
        : []),
      // 修订材料置于写作要求之前：与文风样本同属尾部上下文区，要求清单保持最后
      ...(revision
        ? [
            "",
            "【上一版正文（在其基础上修订）】",
            revision.previousContent,
            "",
            "【整改报告（请逐条修订）】",
            revision.revisionBlock,
          ]
        : []),
      "",
      "写作要求：",
      "1. 依据本章剧情概述展开正文，可合理补充场景、对话与细节，但不得偏离概述的情节走向；",
      "2. 承接上一章结尾（如有），并为下一章留出衔接空间（如有）；",
      "3. 场景化叙述、张弛有度，对话自然贴合各角色性格；",
      "4. 严格遵守世界观禁忌（taboos）；",
      `5. 篇幅约 ${chapterLength.min}~${chapterLength.max} 字；`,
      ...extraRequirements.map((text, i) => `${6 + i}. ${text}`),
      revision
        ? `${6 + extraRequirements.length}. 按整改报告逐条修订上一版正文（只修正报告指出的问题，报告未涉及的情节与表达尽量保持原样），只输出修订后的正文文本：不要章节标题、不要任何说明或元信息。`
        : `${6 + extraRequirements.length}. 只输出正文文本：不要章节标题、不要任何说明或元信息。`,
    ]
      .filter((line): line is string => line !== null)
      .join("\n");

  // 生成-校验-修订循环：初稿 + 最多 MAX_REVIEW_ROUNDS-1 轮修订；通过才跳出，
  // 3 轮仍未达标保底保存最后一版并警告（产物优先）
  let content = "";
  let report: ReviewReport | null = null;
  let passed = false;

  for (let round = 1; round <= MAX_REVIEW_ROUNDS; round++) {
    const isRevision = round > 1;
    onProgress?.({
      chapterNodeId,
      round,
      totalRounds: MAX_REVIEW_ROUNDS,
      phase: isRevision ? "revising" : "drafting",
      ...(isRevision && report ? { report } : {}),
    });
    if (isRevision && report) {
      channel.notify(
        `♻️ 第 ${round} 轮：上一版未达标准（${describeReport(report)}），按整改报告修订重写…`,
      );
    }

    const { text } = await generateText({
      model,
      prompt: buildPrompt(
        isRevision && report
          ? { previousContent: content, revisionBlock: formatRevisionBlock(report, stylePassScore) }
          : null,
      ),
    });

    content = text.trim();
    if (content.length === 0) {
      throw new Error("写作模型返回了空正文，请稍后重试");
    }

    // 三段校验（chapter-review，Agent 模型独立调用；异常直接抛错终止会话零残留）
    report = await reviewChapter(
      {
        novelId,
        chapterName: chapter.node.name,
        summary: chapter.node.summary ?? "",
        worldview: storedWorldview.worldview,
        foreshadowLines: foreshadowContext.lines,
        characterLines: characterContext.lines,
        styleSamples: enabledStyles.map((stored) => ({
          name: stored.styleReference.name,
          content: stored.styleReference.content,
        })),
        stylePassScore,
        content,
        round,
      },
      {
        reviewModel,
        onProgress: (phase, stageResult) =>
          onProgress?.({
            chapterNodeId, round, totalRounds: MAX_REVIEW_ROUNDS, phase,
            ...(stageResult ? { stageResult } : {}),
          }),
      },
    );
    passed = report.passed;
    if (passed) {
      channel.notify(`✅ 校验通过（第 ${round} 轮）：${describeReport(report)}`);
      break;
    }
  }
  if (!passed && report) {
    channel.notify(
      `⚠️ ${MAX_REVIEW_ROUNDS} 轮未全部达标，保存最后一版（${describeReport(report)}）——建议人工复核或重新发起生成`,
    );
  }

  // 落盘事件携带最终报告（通过 → 已达标依据；保底 → 未达标摘要）
  onProgress?.({
    chapterNodeId,
    round: report?.round ?? MAX_REVIEW_ROUNDS,
    totalRounds: MAX_REVIEW_ROUNDS,
    phase: "saving",
    ...(report ? { report } : {}),
  });

  // 正文落盘（小说名-<id前8位>/部名/章名层级，同名小说不共享文件夹），库绑定失败时回滚删除文件
  const relativePath = buildChapterDocumentPath(
    {
      novelName: novel.name ?? "未命名小说",
      novelId,
      partName: part.node.name,
      chapterName: chapter.node.name,
    },
    outputDir,
  );
  let document: Document;
  try {
    writeDocumentArtifact(relativePath, content, outputDir);
    // 重生成走覆盖替换（单事务删旧行插新行），首次生成走既有保存
    document = isRegen
      ? documentStore.replaceChapterDocument(
          novelId,
          chapterNodeId,
          relativePath,
          countWords(content),
        )
      : documentStore.saveChapterDocument(
          novelId,
          chapterNodeId,
          relativePath,
          countWords(content),
        );
  } catch (error) {
    removeDocumentArtifact(relativePath, outputDir);
    throw error;
  }
  // 库事务已提交：清理旧正文文件——路径相同（旧文件本就缺失的孤儿行）时跳过，防误删新文件；
  // removeDocumentArtifact 幂等，旧文件已被手工移走时静默
  if (isRegen && existing && existing.filePath !== document.filePath) {
    removeDocumentArtifact(existing.filePath, outputDir);
  }
  channel.notify(`✍️ 正文已保存：${relativePath}（约 ${document.wordCount} 字）`);
  return {
    novelId,
    chapterNodeId,
    chapterName: chapter.node.name,
    documentId: document.id,
    wordCount: document.wordCount,
  };
}

import { generateText } from "ai";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import type { UiChannel } from "../ui/channel";
import { getWritingModel } from "../providers/writing-model";
import { getDefaultNovelStore, type NovelStore } from "../state/novel-store";
import { getDefaultOutlineStore, type OutlineStore } from "../state/outline-store";
import { getDefaultWorldviewStore, type WorldviewStore } from "../state/worldview-store";
import { getDefaultCharacterStore, type CharacterStore } from "../state/character-store";
import { getDefaultDocumentStore, type DocumentStore } from "../state/document-store";
import { getDefaultStyleReferenceStore, type StyleReferenceStore } from "../state/style-reference-store";
import { getDefaultForeshadowStore, type ForeshadowStore } from "../state/foreshadow-store";
import { buildChapterForeshadowContext } from "./foreshadow-context";
import { OUTPUT_DIR } from "../output/outline-writer";
import {
  buildChapterDocumentPath,
  countWords,
  removeDocumentArtifact,
  writeDocumentArtifact,
} from "../output/document-writer";
import type { Document } from "@novel/shared";

export interface WriteChapterOptions {
  /** 交互通道（终端 / 协议 / 测试替身），业务交互的唯一出口 */
  channel: UiChannel;
  /** 目标小说创作 ID */
  novelId: string;
  /** 目标章的 outlines 表节点 ID */
  chapterNodeId: string;
  /** 写作模型实例；缺省 getWritingModel()（OpenAI 接口兼容端点，环境变量配置，测试注入替身） */
  model?: LanguageModelV4;
  /** 正文产物根目录；缺省 output（NOVEL_OUTPUT_DIR，协议模式下宿主传绝对路径），测试注入临时目录 */
  outputDir?: string;
  novelStore?: NovelStore;
  outlineStore?: OutlineStore;
  worldviewStore?: WorldviewStore;
  characterStore?: CharacterStore;
  documentStore?: DocumentStore;
  /** 参考文风库；缺省 getDefaultStyleReferenceStore()，测试注入替身 */
  styleReferenceStore?: StyleReferenceStore;
  /** 伏笔库；缺省 getDefaultForeshadowStore()，测试注入替身 */
  foreshadowStore?: ForeshadowStore;
}

export interface WriteChapterResult {
  novelId: string;
  chapterNodeId: string;
  chapterName: string;
  documentId: string;
  wordCount: number;
}

/** 角色 → 紧凑的角色摘要行（正文写作的登场人物参考，控制 prompt 体积） */
function characterDigestLine(character: {
  basicInfo: { name: string; appearance?: string };
  core: { narrativeRole: string; desire: string; fear: string };
  personality?: string;
}): string {
  const parts = [
    `定位：${character.core.narrativeRole}`,
    character.basicInfo.appearance ? `外貌：${character.basicInfo.appearance}` : null,
    character.personality ? `性格：${character.personality}` : null,
    `渴望：${character.core.desire}`,
    `恐惧：${character.core.fear}`,
  ].filter((part): part is string => part !== null);
  return `${character.basicInfo.name}（${parts.join("；")}）`;
}

/**
 * 章节正文生成工作流（客户端章节点「✍️ 生成本章正文」入口）：
 * 从库中校验并组装写作上下文（小说名/logline、世界观、角色摘要、所属部/幕
 * 梗概与关键情节点、本章概述、同幕前后章概述、本章绑定伏笔——登场卡片 /
 * 回收卡片+登场章上下文），交写作模型（OpenAI 接口
 * 兼容端点，与 Agent 会话模型解耦；WRITING_MODEL_* 未配置时回落 Agent
 * 会话模型 deepseek）单轮生成正文，无确认门——确认在客户端
 * （生成后展示，重写/修订流为后续需求）。
 * 正文**存文件系统**（`<output>/<小说名>-<创作ID前8位>/<部名>/<章名>.md`，
 * 人类可直接阅读），先写文件、后经 saveChapterDocument 单事务登记元数据
 * （file_path + 字数）并绑定章节点 document_id；库失败时回滚删除已写文件，
 * 不留孤儿。
 * 校验失败（小说/章不存在、非章节点、缺概述、已有正文、世界观未确认）
 * 抛可读错误，由调用方（协议入口）转为 fatal error 消息。
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
  const outputDir = options.outputDir ?? OUTPUT_DIR;

  const novel = novelStore.getNovel(novelId);
  if (!novel) {
    throw new Error(`小说不存在，无法生成正文：${novelId}`);
  }

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

  // 一章一份：已有正文直接拒绝（重写/修订流为后续需求），避免浪费生成调用
  if (documentStore.getDocumentByChapter(chapterNodeId)) {
    throw new Error(`章「${chapter.node.name}」已有正文，重新生成为后续需求`);
  }

  const storedWorldview = worldviewStore.getWorldview(novelId);
  if (!storedWorldview) {
    throw new Error("该小说世界观未确认（库中无记录），无法生成正文");
  }

  // 同幕前后章概述：衔接上文、给下文留空间（写作模型不臆造跨章情节）
  const siblings = outlineStore
    .listOutlineNodes(novelId, { currentOnly: true })
    .filter(
      (n) => n.node.parentId === act.id && n.node.type === "chapter" && n.id !== chapter.id,
    );
  const previous = siblings.find((n) => n.node.sort === chapter.node.sort - 1);
  const next = siblings.find((n) => n.node.sort === chapter.node.sort + 1);

  // 参考文风（可选增强，不阻塞生成）：只注入启用的样本，全部停用或未添加时零注入零通知
  const enabledStyles = styleReferenceStore
    .listStyleReferences(novelId)
    .filter((stored) => stored.styleReference.enabled);

  // 本章伏笔（可选增强，不阻塞生成）：绑定到本章的伏笔——登场注入卡片、回收注入卡片
  // + 登场章上下文（正文优先、概述兜底、预算护栏，详见 foreshadow-context.ts）
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
  if (hasForeshadows) {
    extraRequirements.push(
      "本章如有登场伏笔，按注意度控制显隐程度、自然带出不刻意；如有回收伏笔，呼应登场章的具体细节、不复述登场原文；",
    );
  }
  if (enabledStyles.length > 0) {
    extraRequirements.push(
      "模仿参考文风样本的叙事语言、句式节奏与描写风格，但不抄袭其具体情节与专有名词；",
    );
  }

  channel.notify(`✍️ 正文生成中（《${novel.name ?? "未命名小说"}》· ${chapter.node.name}，写作模型）…`);
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
  const { text } = await generateText({
    model,
    prompt: [
      "你是一位经验丰富的小说作者，请依据下面的资料把指定章节的剧情概述扩写为小说正文。",
      "",
      "【小说】",
      `书名：${novel.name ?? "未命名小说"}`,
      novel.description ? `一句话简介：${novel.description}` : null,
      "",
      "【世界观】",
      JSON.stringify(storedWorldview.worldview),
      "",
      "【登场角色参考】",
      characterStore
        .listCharacters(novelId)
        .map((stored) => characterDigestLine(stored.character))
        .join("\n") || "（暂无入库角色）",
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
      previous
        ? `【上一章（衔接其结尾，不要重复叙述）】\n${previous.node.name}：${previous.node.summary}`
        : null,
      next
        ? `【下一章（为其留出衔接空间，不要抢写其情节）】\n${next.node.name}：${next.node.summary}`
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
      "",
      "写作要求：",
      "1. 依据本章剧情概述展开正文，可合理补充场景、对话与细节，但不得偏离概述的情节走向；",
      "2. 承接上一章结尾（如有），并为下一章留出衔接空间（如有）；",
      "3. 场景化叙述、张弛有度，对话自然贴合各角色性格；",
      "4. 严格遵守世界观禁忌（taboos）；",
      "5. 篇幅约 2000~3000 字；",
      ...extraRequirements.map((text, i) => `${6 + i}. ${text}`),
      `${6 + extraRequirements.length}. 只输出正文文本：不要章节标题、不要任何说明或元信息。`,
    ]
      .filter((line): line is string => line !== null)
      .join("\n"),
  });

  const content = text.trim();
  if (content.length === 0) {
    throw new Error("写作模型返回了空正文，请稍后重试");
  }

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
    document = documentStore.saveChapterDocument(
      novelId,
      chapterNodeId,
      relativePath,
      countWords(content),
    );
  } catch (error) {
    removeDocumentArtifact(relativePath, outputDir);
    throw error;
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

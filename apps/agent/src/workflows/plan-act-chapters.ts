import { runCachedWorkflow, type WorkflowCacheOptions } from "./workflow-cache";
import type { UiChannel } from "../ui/channel";
import { getDefaultNovelStore, type NovelStore } from "../state/novel-store";
import { getDefaultWorldviewStore, type WorldviewStore } from "../state/worldview-store";
import { getDefaultCharacterStore, type CharacterStore } from "../state/character-store";
import { getDefaultOutlineStore, type OutlineStore } from "../state/outline-store";
import { getDefaultForeshadowStore, type ForeshadowStore } from "../state/foreshadow-store";
import { getDefaultLocationStore, type LocationStore } from "../state/location-store";
import { readOutlineTheme } from "../output/outline-writer";
import type { Outline } from "@novel/shared";
import { planChapters } from "./agents/chapter-agent";
import { autoCreateCharacters, collectChapterCharacters, filterNewCharacters } from "./agents/auto-character-agent";
import { plantChapterForeshadows } from "./foreshadow-intake";
import { bindChapterCasts } from "./chapter-cast-intake";
import { filterNewLocations, plantNewLocations } from "./location-intake";

export interface PlanActChaptersOptions extends WorkflowCacheOptions {
  /** 交互通道（终端 / 协议 / 测试替身），业务交互的唯一出口 */
  channel: UiChannel;
  /** 目标小说创作 ID */
  novelId: string;
  /** 目标幕的 outlines 表节点 ID */
  actNodeId: string;
  /** 小说信息 store；缺省用默认 SQLite store（data/novel.db） */
  novelStore?: NovelStore;
  /** 大纲树 store；缺省用默认 SQLite store（data/novel.db） */
  outlineStore?: OutlineStore;
  /** 世界观 store；缺省用默认 SQLite store（data/novel.db） */
  worldviewStore?: WorldviewStore;
  /** 角色库 store；缺省用默认 SQLite store（data/novel.db） */
  characterStore?: CharacterStore;
  /** 伏笔 store；缺省用默认 SQLite store（data/novel.db） */
  foreshadowStore?: ForeshadowStore;
  /** 地点 store；缺省用默认 SQLite store（data/novel.db） */
  locationStore?: LocationStore;
}

export interface PlanActChaptersResult {
  novelId: string;
  actNodeId: string;
  actName: string;
  chapterCount: number;
}

/**
 * 单幕章节规划工作流（客户端幕节点「规划本幕章节」入口）：
 * 从库中校验并组装目标幕的规划上下文（小说名/logline、所属部、幕梗概与关键情节点，
 * theme 自 output 产物尽力读取），复用章节 Agent 的确认门规划章节（每章含登场角色
 * 清单——库内与新角色全列），确认后经 saveChapters 在幕下批量建章。登场角色处理：
 * 先按角色库对逐章清单兜底 diff 派生「本次规划新增角色」，经 autoCreateCharacters
 * 自动填充角色卡入库（空派生跳过、零 LLM 调用，同大纲两条流程的收尾动作）；
 * 再把各章登场名单（库内既有 + 本轮新入库）名字→ID 解析后单事务回填绑定到章节点
 * （bindChapterCasts——绑定前全部角色已入库、ID 必然存在；正文生成按绑定注入
 * 本章阵容角色资料，替代全库注入）。
 * 本幕「未绑登场章」的伏笔随规划上下文回传给 LLM；确认后 newForeshadows 新伏笔
 * 带登场章与幕归属入库、foreshadowBindings 绑定指令把回传伏笔 patch 到登场章（空清单跳过）。
 * 校验失败（小说/幕不存在、非幕节点、旧数据缺内容、已有章节规划、世界观未确认）
 * 抛可读错误，由调用方（协议入口）转为 fatal error 消息。
 */
export async function planActChapters(options: PlanActChaptersOptions): Promise<PlanActChaptersResult> {
  const { channel, novelId, actNodeId } = options;
  const novelStore = options.novelStore ?? getDefaultNovelStore();
  const outlineStore = options.outlineStore ?? getDefaultOutlineStore();
  const worldviewStore = options.worldviewStore ?? getDefaultWorldviewStore();
  const characterStore = options.characterStore ?? getDefaultCharacterStore();
  const foreshadowStore = options.foreshadowStore ?? getDefaultForeshadowStore();
  const locationStore = options.locationStore ?? getDefaultLocationStore();

  if (!novelStore.getNovel(novelId)) throw new Error(`小说不存在，无法规划章节：${novelId}`);

  return runCachedWorkflow({ ...options, kind: "plan-chapters", novelStore, targetId: actNodeId }, async (cache) => {
    const { novel, act, part, actSummary, keyPlotPoints, storedWorldview, unboundForeshadows, recoverableForeshadows } = cache.step("planning-context", () => {
      const novel = novelStore.getNovel(novelId);
      if (!novel) {
        throw new Error(`小说不存在，无法规划章节：${novelId}`);
      }

      const act = outlineStore.getOutlineNode(actNodeId);
      if (!act || act.novelId !== novelId) {
        throw new Error(`幕节点不存在或不属于该小说：${actNodeId}`);
      }
      if (act.node.type !== "act") {
        throw new Error(`所选节点不是幕（类型为 ${act.node.type}），无法规划章节：${act.node.name}`);
      }
      if (act.node.summary === null || act.node.keyPlotPoints === null) {
        throw new Error(`幕「${act.node.name}」缺少梗概或关键情节点（旧数据未入库内容），无法规划章节`);
      }

      if (!act.node.isCurrentVersion) throw new Error("大纲版本已变更，无法恢复旧幕的章节规划");

      const part = act.node.parentId ? outlineStore.getOutlineNode(act.node.parentId) : undefined;
      if (!part || part.node.type !== "part") {
        throw new Error(`幕「${act.node.name}」缺少所属部节点，无法组装规划上下文`);
      }

      // 同一幕重复规划会被唯一索引拒绝（重新规划/修订流为后续需求），前置给出可读错误
      const hasChapters = outlineStore
        .listOutlineNodes(novelId, { currentOnly: true })
        .some((n) => n.node.parentId === act.id && n.node.type === "chapter");
      if (hasChapters) {
        throw new Error(`幕「${act.node.name}」已有章节规划，重新规划（修订流）为后续需求`);
      }

      // 自动创建新角色需要世界观依据；前置拒绝避免「确认入库后才发现无法自动创建」的中间态
      const storedWorldview = worldviewStore.getWorldview(novelId);
      if (!storedWorldview) {
        throw new Error("该小说世界观未确认（库中无记录），无法规划章节");
      }

      // 本幕「未绑登场章」的伏笔回传给章节 Agent：有则模型输出 foreshadowBindings 绑定登场章
      const unboundForeshadows = foreshadowStore.listUnboundByAct(novelId, act.id);
      const recoverableForeshadows = foreshadowStore.listUnrecoveredByAct(novelId, act.id);

      return { novel, act, part, actSummary: act.node.summary, keyPlotPoints: act.node.keyPlotPoints, storedWorldview, unboundForeshadows, recoverableForeshadows };
    });
    const assertCurrentAct = () => {
      const currentAct = outlineStore.getOutlineNode(act.id);
      if (!currentAct?.node.isCurrentVersion || currentAct.node.version !== act.node.version) {
        throw new Error("大纲版本已变更，无法恢复旧幕的章节规划");
      }
    };
    assertCurrentAct();
    channel.stage("chapter");
    channel.notify(`📑 章节规划 Agent 启动（${act.node.name}）…`);
    const { plan, newForeshadows, foreshadowBindings, foreshadowRecoverBindings, newLocations } = await cache.asyncStep("confirmed-plan", () => planChapters(
      {
        novelTitle: novel.name ?? "未命名小说",
        logline: novel.description ?? "",
        theme: readOutlineTheme(novelId),
        narrativePov: novel.narrativePov ?? undefined,
        partName: part.node.name,
        partSummary: part.node.summary ?? "",
        actName: act.node.name,
        actSummary,
        keyPlotPoints,
      },
      channel,
      { novelId, characterStore, locationStore, unboundForeshadows, recoverableForeshadows },
    ));

    const chapterNodes = cache.step("save-chapters", () => {
      if (!outlineStore.getOutlineNode(act.id)?.node.isCurrentVersion) throw new Error("大纲版本已变更，无法保存旧幕章节");
      return outlineStore.saveChapters(novelId, act.id, plan.chapters);
    });
    channel.notify(`📑 章节已入库：${act.node.name} 规划 ${chapterNodes.length} 章`);

    // 章节规划新增地点确定性入库：置于角色自动入库之前（同 createNovel 收尾动作语义——
    // 毫秒级同步代码先行，与角色同批次；不并行避免 notify 交错）。空清单（过滤后）整块跳过。
    cache.step("save-locations", () => {
      const existingLocations = locationStore.listLocations(novelId).map((l) => l.location);
      const pendingLocations = filterNewLocations(newLocations, existingLocations);
      if (pendingLocations.length > 0) {
        channel.notify(`\n✨ 本幕规划引入了 ${pendingLocations.length} 个新地点，正在入库…`);
        plantNewLocations({ novelId, newLocations: pendingLocations, channel, locationStore });
        channel.notify(
          `✨ 本次规划新增 ${pendingLocations.length} 个地点已自动入库：${pendingLocations.map((l) => l.name).join("、")}`,
        );
      }
    });

    // 章节规划登场角色处理（确认入库后）：逐章登场清单对角色库兜底 diff 派生「本次规划
    // 新增角色」——空派生跳过（零 LLM 调用）；非空经自动创建 Agent 逐卡入库
    await cache.asyncStep("auto-characters", async () => {
      const existingCharacters = characterStore.listCharacters(novelId).map((c) => c.character);
      const pendingNew = filterNewCharacters(collectChapterCharacters(plan), existingCharacters);
      if (pendingNew.length > 0) {
        channel.notify(`\n✨ 本幕规划引入了 ${pendingNew.length} 个新角色，正在自动填充角色卡并入库…`);
        // 部/幕节点组装伪 Outline（结构匹配 Outline，供自动创建 Agent 作登场情节上下文）
        const outlineContext: Outline = {
          title: novel.name ?? "未命名小说",
          logline: novel.description ?? "",
          parts: [
            {
              name: part.node.name,
              summary: part.node.summary ?? "",
              acts: [
                {
                  name: act.node.name,
                  summary: actSummary,
                  keyPlotPoints,
                },
              ],
            },
          ],
        };
        await autoCreateCharacters({
          novelId,
          worldview: storedWorldview.worldview,
          outline: outlineContext,
          newCharacters: pendingNew,
          existingCharacters,
          channel,
          characterStore,
          extraContext: `本次规划的章节列表：\n${plan.chapters
            .map(
              (c, i) =>
                `第${i + 1}章 ${c.name}：${c.summary}（登场：${c.characters.map((cast) => cast.name).join("、")}）`,
            )
            .join("\n")}`,
        });
        channel.notify(
          `✨ 本次章节规划新增 ${pendingNew.length} 个角色已自动入库：${pendingNew.map((c) => c.name).join("、")}`,
        );
      }
    });

    assertCurrentAct();

    // 各章登场角色 ID 绑定回填（置于自动建卡之后——名单含本轮新入库角色；伏笔块之前）：
    // 名字→ID 解析后单事务回填章节点 character_ids，正文生成按绑定注入本章阵容
    cache.step("bind-casts", () => {
      channel.notify(`🎭 正在绑定各章登场角色（${plan.chapters.length} 章）…`);
      const castResult = bindChapterCasts({
        novelId,
        chapters: plan.chapters,
        chapterNodes,
        characters: characterStore.listCharacters(novelId),
        channel,
        outlineStore,
      });
      channel.notify(
        `✨ 各章登场角色已绑定：${castResult.boundChapters} 章共 ${castResult.totalBindings} 人次${castResult.skipped.length > 0 ? `（${castResult.skipped.length} 处未匹配跳过）` : ""
        }`,
      );
    });

    // 伏笔处理：新伏笔带登场章与幕入库、既有未绑伏笔按 LLM 绑定指令 patch（确定性代码）。
    // 置于角色自动入库块之后：新伏笔的 characterNames 可能引用本轮自动入库的新角色。
    cache.step("save-foreshadows", () => {
      if (newForeshadows.length > 0 || foreshadowBindings.length > 0 || foreshadowRecoverBindings.length > 0) {
        channel.notify(
          `\n✨ 本幕伏笔处理中：新增 ${newForeshadows.length} 处、绑定 ${foreshadowBindings.length} 处、回收绑定 ${foreshadowRecoverBindings.length} 处…`,
        );
        const chapterNodeRefs = chapterNodes.map((n) => ({ id: n.id, name: n.node.name }));
        // 全书当前版本章节点（含本次规划）——回收/登场顺序校验的全局章序依据
        const allChapterNodes = outlineStore
          .listOutlineNodes(novelId, { currentOnly: true })
          .map((n) => ({ id: n.id, parentId: n.node.parentId, type: n.node.type, sort: n.node.sort }));
        const { created, skipped, bound, recoverBound } = plantChapterForeshadows({
          novelId,
          actNodeId: act.id,
          newForeshadows,
          bindings: foreshadowBindings,
          recoverBindings: foreshadowRecoverBindings,
          recoverable: recoverableForeshadows,
          characters: characterStore.listCharacters(novelId),
          chapterNodes: chapterNodeRefs,
          allChapterNodes,
          unbound: unboundForeshadows,
          channel,
          foreshadowStore,
        });
        channel.notify(
          `✨ 本次规划伏笔入库 ${created} 处、绑定 ${bound} 处、回收绑定 ${recoverBound} 处${skipped > 0 ? `（${skipped} 处未匹配跳过）` : ""}`,
        );
      }
    });
    return { novelId, actNodeId: act.id, actName: act.node.name, chapterCount: chapterNodes.length };
  });
}

import { runCachedWorkflow, type WorkflowCacheOptions } from "./workflow-cache";
import type { UiChannel } from "../ui/channel";
import { getDefaultNovelStore, type NovelStore } from "../state/novel-store";
import { getDefaultWorldviewStore, type WorldviewStore } from "../state/worldview-store";
import { getDefaultCharacterStore, type CharacterStore } from "../state/character-store";
import { getDefaultOutlineStore, type OutlineStore } from "../state/outline-store";
import { getDefaultForeshadowStore, type ForeshadowStore } from "../state/foreshadow-store";
import { getDefaultLocationStore, type LocationStore } from "../state/location-store";
import { saveOutline } from "../output/outline-writer";
import { createOutline } from "./agents/outline-agent";
import { autoCreateCharacters, filterNewCharacters } from "./agents/auto-character-agent";
import { plantOutlineForeshadows } from "./foreshadow-intake";
import { filterNewLocations, plantNewLocations } from "./location-intake";

export interface RegenOutlineOptions extends WorkflowCacheOptions {
  /** 交互通道（终端 / 协议 / 测试替身），业务交互的唯一出口 */
  channel: UiChannel;
  /** 目标小说创作 ID */
  novelId: string;
  novelStore?: NovelStore;
  worldviewStore?: WorldviewStore;
  characterStore?: CharacterStore;
  outlineStore?: OutlineStore;
  /** 伏笔持久化 store；缺省用默认 SQLite store（data/novel.db） */
  foreshadowStore?: ForeshadowStore;
  /** 地点持久化 store；缺省用默认 SQLite store（data/novel.db） */
  locationStore?: LocationStore;
}

export interface RegenOutlineResult {
  novelId: string;
  /** 新大纲树的版本号（旧版本 max+1） */
  version: number;
  partCount: number;
  actCount: number;
}

/**
 * 大纲重新生成工作流（客户端「📖 大纲」刷新入口）：
 * 从库读取小说基本信息、世界观与角色（不喂旧大纲，避免新版本被旧结构锚定），
 * 用户填幕数/部数表单后复用大纲 Agent 的确认门生成新大纲，
 * 确认后以新版本入库——旧大纲树与已生成章节整体降级为历史版本（行保留，
 * 版本迭代记录），并覆盖 output 产物、回填 novels.description（logline）。
 * 新版大纲 newCharacters 清单中的新增角色经兜底 diff 后自动填充角色卡入库
 * （空清单跳过，同 createNovel 收尾动作）；newForeshadows 伏笔清单在角色入库后
 * 确定性解析入库（幕名→新版幕节点、服务角色名→ID，未匹配跳过，同 createNovel）。
 * 校验失败（小说不存在 / 世界观未确认 / 无角色）抛可读错误，
 * 由调用方（协议入口）转为 fatal error 消息。
 */
export async function regenerateOutline(options: RegenOutlineOptions): Promise<RegenOutlineResult> {
  const { channel, novelId } = options;
  const novelStore = options.novelStore ?? getDefaultNovelStore();
  const worldviewStore = options.worldviewStore ?? getDefaultWorldviewStore();
  const characterStore = options.characterStore ?? getDefaultCharacterStore();
  const outlineStore = options.outlineStore ?? getDefaultOutlineStore();
  const foreshadowStore = options.foreshadowStore ?? getDefaultForeshadowStore();
  const locationStore = options.locationStore ?? getDefaultLocationStore();

  if (!novelStore.getNovel(novelId)) throw new Error(`小说不存在，无法重新生成大纲：${novelId}`);
  return runCachedWorkflow({ ...options, kind: "regen-outline", novelStore }, async (cache) => {
    const { novel, storedWorldview, characters, initialPartIds } = cache.step("outline-context", () => {
      const novel = novelStore.getNovel(novelId);
      if (!novel) {
        throw new Error(`小说不存在，无法重新生成大纲：${novelId}`);
      }
      const storedWorldview = worldviewStore.getWorldview(novelId);
      if (!storedWorldview) {
        throw new Error("该小说世界观未确认（库中无记录），无法重新生成大纲");
      }
      const characters = characterStore.listCharacters(novelId);
      if (characters.length === 0) {
        throw new Error("该小说没有已入库的角色，无法重新生成大纲");
      }

      const initialPartIds = outlineStore.listOutlineNodes(novelId, { currentOnly: true })
        .filter((n) => n.node.type === "part").map((n) => n.id).sort();
      return { novel, storedWorldview, characters, initialPartIds };
    });
    channel.stage("outline");
    channel.notify(`🛠 大纲重新生成 Agent 启动（《${novel.name ?? "未命名小说"}》）…`);

    // 数量表单：幕数与部数（对齐新建小说流程），各部幕数由模型按剧情节奏分配
    const actCount = await cache.asyncStep("act-count", () => channel.askInt("请输入整本剧情拆分的幕数", {
      min: 3,
      max: 20,
      default: 5,
    }));
    const partCount = await cache.asyncStep("part-count", () => channel.askInt(`这 ${actCount} 幕拆分为几部`, {
      min: 1,
      max: actCount,
      default: 1,
    }));

    const submission = await cache.asyncStep("confirmed-outline", () => createOutline(
      // 创作条件逐项入库；历史小说未采集的字段省略，沿用 Agent 的缺省策略。
      {
        worldview: storedWorldview.worldview,
        characters: characters.map((c) => c.character),
        ...(novel.genre !== null ? { genre: novel.genre } : {}),
        ...(novel.narrativePov !== null ? { narrativePov: novel.narrativePov } : {}),
        ...(novel.audience !== null ? { audience: novel.audience } : {}),
        ...(novel.coreConflict !== null ? { coreConflict: novel.coreConflict } : {}),
      },
      { novelTitle: novel.name ?? undefined, actCount, partCount, novelId, characterStore, locationStore },
      channel,
    ));
    const outline = submission.outline;

    const treeNodes = cache.step("save-outline-tree", () => {
      const currentPartIds = outlineStore.listOutlineNodes(novelId, { currentOnly: true })
        .filter((n) => n.node.type === "part").map((n) => n.id).sort();
      if (JSON.stringify(currentPartIds) !== JSON.stringify(initialPartIds)) {
        throw new Error("大纲版本已变更，无法将旧任务保存到新版大纲");
      }
      return outlineStore.saveOutlineTreeNewVersion(novelId, outline.parts);
    });
    const assertCurrentTree = () => {
      if (treeNodes.some((n) => !outlineStore.getOutlineNode(n.id)?.node.isCurrentVersion)) {
        throw new Error("大纲版本已变更，无法继续旧版本任务");
      }
    };
    assertCurrentTree();
    const version = treeNodes[0]?.node.version ?? 1;
    const partTotal = treeNodes.filter((n) => n.node.type === "part").length;
    const actTotal = treeNodes.filter((n) => n.node.type === "act").length;
    channel.notify(
      `🗂 新版大纲已入库（第 ${version} 版：${partTotal} 部 / ${actTotal} 幕）；旧大纲与已生成章节已归档为历史版本`,
    );
    const savedPath = await saveOutline(novelId, outline);
    channel.notify(`🗂 大纲产物已更新：${savedPath}`);
    cache.step("update-novel", () => novelStore.updateNovel(novelId, { description: outline.logline }));

    // 新版大纲地点确定性入库（同 createNovel 收尾动作）：置于角色自动入库之前；地点只增
    // 不改——兜底 diff 对全库地点名，旧版入库地点保留不动。空清单（过滤后）整块跳过。
    cache.step("save-locations", () => {
      const existingLocations = locationStore.listLocations(novelId).map((l) => l.location);
      const pendingLocations = filterNewLocations(submission.newLocations, existingLocations);
      if (pendingLocations.length > 0) {
        channel.notify(`\n✨ 新版大纲引入了 ${pendingLocations.length} 个新地点，正在入库…`);
        plantNewLocations({ novelId, newLocations: pendingLocations, channel, locationStore });
        channel.notify(
          `✨ 本次大纲新增 ${pendingLocations.length} 个地点已自动入库：${pendingLocations.map((l) => l.name).join("、")}`,
        );
      }
    });

    // 大纲新增角色自动入库（兜底 diff + 空清单跳过，同 createNovel 收尾动作）
    await cache.asyncStep("auto-characters", async () => {
      const freshCharacters = characterStore.listCharacters(novelId).map((c) => c.character);
      const pendingNew = filterNewCharacters(submission.newCharacters, freshCharacters);
      if (pendingNew.length > 0) {
        channel.notify(`\n✨ 新版大纲引入了 ${pendingNew.length} 个新角色，正在自动填充角色卡并入库…`);
        await autoCreateCharacters({
          novelId,
          worldview: storedWorldview.worldview,
          outline,
          newCharacters: pendingNew,
          existingCharacters: freshCharacters,
          channel,
          characterStore,
        });
        channel.notify(
          `✨ 本次大纲新增 ${pendingNew.length} 个角色已自动入库：${pendingNew.map((c) => c.name).join("、")}`,
        );
      }
    });
    assertCurrentTree();

    // 大纲伏笔入库：确定性代码创建（角色已入库，服务角色名可解析）；幕名/角色名未匹配逐条跳过并警告。
    // 置于角色自动入库块之后：伏笔清单可能引用本轮自动入库的新角色（服务角色 ID 需角色先入库）；
    // actNodes 取当前版本树（saveOutlineTreeNewVersion 后即新版），伏笔随新版幕挂接。
    cache.step("save-foreshadows", () => {
      if (submission.newForeshadows.length > 0) {
        channel.notify(`\n✨ 新版大纲安排了 ${submission.newForeshadows.length} 处伏笔，正在入库…`);
        const actNodes = treeNodes
          .filter((n) => n.node.type === "act")
          .map((n) => ({ id: n.id, name: n.node.name }));
        const { created, skipped } = plantOutlineForeshadows({
          novelId,
          newForeshadows: submission.newForeshadows,
          characters: characterStore.listCharacters(novelId),
          actNodes,
          channel,
          foreshadowStore,
        });
        channel.notify(
          `✨ 本次大纲伏笔已入库 ${created} 处${skipped > 0 ? `（${skipped} 处因幕名/角色名未匹配跳过）` : ""}`,
        );
      }
    });
    return { novelId, version, partCount: partTotal, actCount: actTotal };
  });
}

import type { UiChannel } from "../ui/channel";
import { getDefaultNovelStore, type NovelStore } from "../state/novel-store";
import { getDefaultWorldviewStore, type WorldviewStore } from "../state/worldview-store";
import { getDefaultCharacterStore, type CharacterStore } from "../state/character-store";
import { getDefaultOutlineStore, type OutlineStore } from "../state/outline-store";
import { saveOutline } from "../output/outline-writer";
import { createOutline } from "./agents/outline-agent";

export interface RegenOutlineOptions {
  /** 交互通道（终端 / 协议 / 测试替身），业务交互的唯一出口 */
  channel: UiChannel;
  /** 目标小说创作 ID */
  novelId: string;
  novelStore?: NovelStore;
  worldviewStore?: WorldviewStore;
  characterStore?: CharacterStore;
  outlineStore?: OutlineStore;
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
 * 校验失败（小说不存在 / 世界观未确认 / 无角色）抛可读错误，
 * 由调用方（协议入口）转为 fatal error 消息。
 */
export async function regenerateOutline(options: RegenOutlineOptions): Promise<RegenOutlineResult> {
  const { channel, novelId } = options;
  const novelStore = options.novelStore ?? getDefaultNovelStore();
  const worldviewStore = options.worldviewStore ?? getDefaultWorldviewStore();
  const characterStore = options.characterStore ?? getDefaultCharacterStore();
  const outlineStore = options.outlineStore ?? getDefaultOutlineStore();

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

  channel.stage("outline");
  channel.notify(`🛠 大纲重新生成 Agent 启动（《${novel.name ?? "未命名小说"}》）…`);

  // 数量表单：幕数与部数（对齐新建小说流程），各部幕数由模型按剧情节奏分配
  const actCount = await channel.askInt("请输入整本剧情拆分的幕数", {
    min: 3,
    max: 20,
    default: 5,
  });
  const partCount = await channel.askInt(`这 ${actCount} 幕拆分为几部`, {
    min: 1,
    max: actCount,
    default: 1,
  });

  const outline = await createOutline(
    // 类型/受众/核心冲突未入库，仅喂库内数据（worldview + characters）
    { worldview: storedWorldview.worldview, characters: characters.map((c) => c.character) },
    { novelTitle: novel.name ?? undefined, actCount, partCount },
    channel,
  );

  const treeNodes = outlineStore.saveOutlineTreeNewVersion(novelId, outline.parts);
  const version = treeNodes[0]?.node.version ?? 1;
  const partTotal = treeNodes.filter((n) => n.node.type === "part").length;
  const actTotal = treeNodes.filter((n) => n.node.type === "act").length;
  channel.notify(
    `🗂 新版大纲已入库（第 ${version} 版：${partTotal} 部 / ${actTotal} 幕）；旧大纲与已生成章节已归档为历史版本`,
  );
  const savedPath = await saveOutline(novelId, outline);
  channel.notify(`🗂 大纲产物已更新：${savedPath}`);
  novelStore.updateNovel(novelId, { description: outline.logline });
  return { novelId, version, partCount: partTotal, actCount: actTotal };
}

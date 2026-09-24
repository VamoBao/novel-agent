import type { UiChannel } from "../ui/channel";
import { getDefaultNovelStore, type NovelStore } from "../state/novel-store";
import { getDefaultOutlineStore, type OutlineStore } from "../state/outline-store";
import { readOutlineTheme } from "../output/outline-writer";
import { planChapters } from "./agents/chapter-agent";

export interface PlanActChaptersOptions {
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
}

export interface PlanActChaptersResult {
  novelId: string;
  actNodeId: string;
  actName: string;
  chapterCount: number;
}

/**
 * 单幕章节规划工作流（客户端幕节点「生成本幕章节」入口）：
 * 从库中校验并组装目标幕的规划上下文（小说名/logline、所属部、幕梗概与关键情节点，
 * theme 自 output 产物尽力读取），复用章节 Agent 的确认门规划章节，
 * 确认后经 saveChapters 在幕下批量建章。
 * 校验失败（小说/幕不存在、非幕节点、旧数据缺内容、已有章节规划）抛可读错误，
 * 由调用方（协议入口）转为 fatal error 消息。
 */
export async function planActChapters(options: PlanActChaptersOptions): Promise<PlanActChaptersResult> {
  const { channel, novelId, actNodeId } = options;
  const novelStore = options.novelStore ?? getDefaultNovelStore();
  const outlineStore = options.outlineStore ?? getDefaultOutlineStore();

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

  channel.stage("chapter");
  channel.notify(`📑 章节规划 Agent 启动（${act.node.name}）…`);
  const plan = await planChapters(
    {
      novelTitle: novel.name ?? "未命名小说",
      logline: novel.description ?? "",
      theme: readOutlineTheme(novelId),
      partName: part.node.name,
      partSummary: part.node.summary ?? "",
      actName: act.node.name,
      actSummary: act.node.summary,
      keyPlotPoints: act.node.keyPlotPoints,
    },
    channel,
  );

  const chapterNodes = outlineStore.saveChapters(novelId, act.id, plan.chapters);
  channel.notify(`📑 章节已入库：${act.node.name} 规划 ${chapterNodes.length} 章`);
  return { novelId, actNodeId: act.id, actName: act.node.name, chapterCount: chapterNodes.length };
}

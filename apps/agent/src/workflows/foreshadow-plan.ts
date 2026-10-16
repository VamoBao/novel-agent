import { buildChapterOrder, type ChapterOrderNode, type ChapterNewForeshadow, type OutlineNewForeshadow } from "@novel/shared";
import type { StoredOutlineNode } from "../state/outline-store";
import type { StoredForeshadow } from "../state/foreshadow-store";

/** 旧确认缓存允许缺少新数组；新模型输出的必填约束由 Agent schema 保证。 */
export type CachedOutlineForeshadow = Omit<OutlineNewForeshadow, "recoverActNames"> & {
  recoverActNames?: string[];
  recoverActName?: string;
};
export type CachedChapterForeshadow = Omit<ChapterNewForeshadow, "recoveryPlan"> & {
  recoveryPlan?: { actName: string; chapterNames: string[] }[];
};

export function recoveryActIds(record: Pick<StoredForeshadow, "recoverActNodeId"> & { recoverActNodeIds?: string[] }): string[] {
  return record.recoverActNodeIds ?? (record.recoverActNodeId ? [record.recoverActNodeId] : []);
}

/** 复用树遍历，只把幕视作终点，避免跨部时比较幕内 sort。 */
export function buildActOrder(nodes: readonly ChapterOrderNode[]): Map<string, number> {
  return buildChapterOrder(nodes.filter(n => n.type !== "chapter").map(n => n.type === "act" ? { ...n, type: "chapter" } : n));
}

/** 新伏笔回收计划在已确认章节点上再次解析，绝不猜测未规划幕的章名。 */
export function resolveChapterRecoveryPlan(
  item: CachedChapterForeshadow,
  novelId: string,
  actNodeId: string,
  appearChapterId: string,
  nodes: readonly StoredOutlineNode[],
): { actIds: string[]; chapterIds: string[] } {
  // 升级前已确认的产物允许无计划，不替用户猜写回收点。
  if (item.recoveryPlan === undefined) return { actIds: [], chapterIds: [] };
  if (item.recoveryPlan.length === 0) throw new Error("回收计划不能为空");
  const current = nodes.filter(n => n.novelId === novelId && n.node.isCurrentVersion);
  const orderNodes = current.map(n => ({ id: n.id, ...n.node }));
  const actOrder = buildActOrder(orderNodes);
  const chapterOrder = buildChapterOrder(orderNodes);
  const appearActOrder = actOrder.get(actNodeId);
  const appearOrder = chapterOrder.get(appearChapterId);
  if (appearActOrder === undefined || appearOrder === undefined) throw new Error("登场幕或登场章不在当前大纲中");
  const actIds: string[] = [];
  const chapterIds: string[] = [];
  for (const point of item.recoveryPlan) {
    const matches = current.filter(n => n.node.type === "act" && n.node.name === point.actName.trim());
    const act = matches.length === 1 ? matches[0] : undefined;
    if (!act || (actOrder.get(act.id) ?? -1) < appearActOrder) throw new Error(`回收幕「${point.actName}」不存在、不唯一或早于登场幕`);
    if (actIds.includes(act.id)) throw new Error(`回收幕「${point.actName}」重复`);
    actIds.push(act.id);
    const chapters = current.filter(n => n.node.type === "chapter" && n.node.parentId === act.id);
    if (chapters.length > 0 && point.chapterNames.length === 0) throw new Error(`回收幕「${point.actName}」已有章节，必须指定回收章`);
    for (const name of point.chapterNames) {
      const found = chapters.filter(n => n.node.name === name.trim());
      const chapter = found.length === 1 ? found[0] : undefined;
      if (!chapter || (chapterOrder.get(chapter.id) ?? -1) <= appearOrder) throw new Error(`回收章「${point.actName}/${name}」不存在、不唯一或不晚于登场章`);
      if (chapterIds.includes(chapter.id)) throw new Error(`回收章「${name}」重复`);
      chapterIds.push(chapter.id);
    }
  }
  actIds.sort((a, b) => actOrder.get(a)! - actOrder.get(b)!);
  chapterIds.sort((a, b) => chapterOrder.get(a)! - chapterOrder.get(b)!);
  return { actIds, chapterIds };
}

/** 用户修改优先；新版快照允许其他工作流追加绑定，但不允许替换/清空或修改设定。 */
export function canResumeForeshadowBindings(snapshot: StoredForeshadow, latest: StoredForeshadow): boolean {
  const signature = (value: StoredForeshadow): string => JSON.stringify([
    value.id, value.novelId, value.actNodeId, recoveryActIds(value), value.createdAt,
    value.editRevision ?? 0, value.updatedAt, value.foreshadow,
  ]);
  if (signature(snapshot) === signature(latest)) return true;
  // 升级前快照没有编辑版本，无法证明发生的是自动追加，保守保护原有编辑行为。
  if (snapshot.editRevision === undefined || snapshot.editRevision !== latest.editRevision) return false;
  const core = (value: StoredForeshadow): string => {
    const { appearChapterId: _appear, recoverChapterIds: _recover, ...card } = value.foreshadow;
    return JSON.stringify([value.id, value.novelId, value.actNodeId, recoveryActIds(value), value.createdAt, card]);
  };
  if (core(snapshot) !== core(latest)) return false;
  const previousAppearance = snapshot.foreshadow.appearChapterId;
  if (previousAppearance && previousAppearance !== latest.foreshadow.appearChapterId) return false;
  const latestRecovery = latest.foreshadow.recoverChapterIds ?? [];
  return (snapshot.foreshadow.recoverChapterIds ?? []).every(id => latestRecovery.includes(id));
}

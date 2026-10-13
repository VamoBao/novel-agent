/**
 * 大纲节点全书序（纯函数，零依赖）：outlines.sort 仅同父级内唯一，
 * 跨幕比较章节先后须按「部 sort → 幕 sort → 章 sort」深度优先展开。
 */

/** buildChapterOrder 的输入节点：outlines 行（当前版本）的最小形态 */
export interface ChapterOrderNode {
  id: string;
  parentId: string | null;
  type: string;
  sort: number;
}

/**
 * 全书章节全局序：返回 章 ID → 全局序号（1 起）的映射（非章节点只用于下探）。
 * 节点列表可含部 / 幕 / 章任意子集——缺失中间层时其下章节点不可达（不入映射），
 * 调用方以 `undefined` 表示「不在当前树内」。
 */
export function buildChapterOrder(nodes: readonly ChapterOrderNode[]): Map<string, number> {
  const children = new Map<string | null, ChapterOrderNode[]>();
  for (const node of nodes) {
    const list = children.get(node.parentId) ?? [];
    list.push(node);
    children.set(node.parentId, list);
  }
  for (const list of children.values()) list.sort((a, b) => a.sort - b.sort);
  const order = new Map<string, number>();
  let index = 0;
  const walk = (parentId: string | null): void => {
    for (const node of children.get(parentId) ?? []) {
      if (node.type === "chapter") {
        index += 1;
        order.set(node.id, index);
      } else {
        walk(node.id);
      }
    }
  };
  walk(null);
  return order;
}

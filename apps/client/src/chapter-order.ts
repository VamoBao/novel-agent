import type { NovelDetail } from "@novel/shared";

/**
 * 全书章节全局序：部 sort → 幕 sort → 章 sort 深度优先展开。
 * outlines.sort 仅在同父级内唯一（幕内章序），跨幕比较「回收章是否晚于登场章」
 * 须组合部/幕序。返回 章 ID → 全局序号（1 起）的映射。
 */
export function globalChapterOrder(detail: NovelDetail): Map<string, number> {
  const children = new Map<string | null, NovelDetail["outlineNodes"]>();
  for (const node of detail.outlineNodes) {
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

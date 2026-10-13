import { buildChapterOrder, type NovelDetail } from "@novel/shared";

/**
 * 全书章节全局序：部 sort → 幕 sort → 章 sort 深度优先展开。
 * 实现收敛于 @novel/shared 的 buildChapterOrder（agent 侧迁移链校验与伏笔绑定共用同一算法），
 * 此处仅把详情载荷的大纲节点投影为其最小输入形态。
 */
export function globalChapterOrder(detail: NovelDetail): Map<string, number> {
  return buildChapterOrder(
    detail.outlineNodes.map((node) => ({
      id: node.id,
      parentId: node.parentId,
      type: node.type,
      sort: node.sort,
    })),
  );
}

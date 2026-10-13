import type { NovelDetail } from "@novel/shared";

/** 章节点选项（伏笔登场章 / 角色迁移起止章下拉共用）：label 为「部名/幕名/章名」——
 *  按 parentId 上溯两级（章 → 幕 → 部），缺失级省略（历史数据 / 异常态兜底） */
export interface ChapterOption {
  id: string;
  label: string;
}

export function chapterOptions(detail: NovelDetail): ChapterOption[] {
  const nodeById = new Map(detail.outlineNodes.map((node) => [node.id, node]));
  return detail.outlineNodes
    .filter((node) => node.type === "chapter")
    .map((node) => {
      const act = node.parentId !== null ? nodeById.get(node.parentId) : undefined;
      const part = act && act.parentId !== null ? nodeById.get(act.parentId) : undefined;
      return { id: node.id, label: [part?.name, act?.name, node.name].filter(Boolean).join("/") };
    });
}

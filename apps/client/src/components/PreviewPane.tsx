import type { ReactElement } from "react";
import type { NovelDetail, OutlineNodeEntry, View } from "@novel/shared";
import { ViewCard } from "./ViewCard";
import { OutlineNodeCard } from "./OutlineNodeCard";
import type { Selection } from "./StructureTreePanel";

interface PreviewPaneProps {
  /** null = 未选中小说 */
  detail: NovelDetail | null;
  loading: boolean;
  error: string | null;
  selection: Selection | null;
  /** 幕节点「规划本幕章节」入口（App 接线到独立章节规划页）；不传则幕卡不显示入口 */
  onPlanChapters?: (node: OutlineNodeEntry) => void;
}

/** 选中项 → 只读视图（世界观 / 角色复用创作流 ViewCard；大纲节点走 OutlineNodeCard，不经此处） */
function toView(detail: NovelDetail, selection: Selection): View | null {
  switch (selection.kind) {
    case "worldview":
      return detail.worldview ? { kind: "worldview", worldview: detail.worldview } : null;
    case "character": {
      const entry = detail.characters.find((c) => c.id === selection.characterId);
      return entry ? { kind: "character-card", character: entry } : null;
    }
    case "outline":
      return null;
  }
}

/** 右栏内容预览：结构树选中节点的只读视图 */
export function PreviewPane({ detail, loading, error, selection, onPlanChapters }: PreviewPaneProps) {
  let body: ReactElement;
  if (!detail) {
    body = (
      <p className="pane-hint">
        {loading ? "加载中…" : error ?? "← 从书库选择一本小说，点击中间结构树预览内容。"}
      </p>
    );
  } else if (!selection) {
    body = <p className="pane-hint">← 点击中间结构树节点预览对应内容。</p>;
  } else if (selection.kind === "outline") {
    const node = detail.outlineNodes.find((n) => n.id === selection.outlineNodeId);
    body = node ? (
      <OutlineNodeCard
        node={node}
        hasChapters={detail.outlineNodes.some(
          (n) => n.parentId === node.id && n.type === "chapter",
        )}
        onPlanChapters={onPlanChapters ? () => onPlanChapters(node) : undefined}
      />
    ) : (
      <p className="pane-error">该节点内容未能加载（数据缺失）。</p>
    );
  } else {
    const view = toView(detail, selection);
    body = view ? (
      <ViewCard view={view} />
    ) : (
      <p className="pane-error">该节点内容未能加载（数据缺失）。</p>
    );
  }

  return (
    <section className="preview">
      {detail ? (
        <h2 className="preview-title">
          《{detail.novel.name ?? "未命名小说"}》
          <span className="preview-id">{detail.novel.id.slice(0, 8)}</span>
        </h2>
      ) : null}
      {body}
    </section>
  );
}

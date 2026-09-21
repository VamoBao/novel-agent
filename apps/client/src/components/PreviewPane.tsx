import type { ReactElement } from "react";
import type { NovelDetail, View } from "@novel/shared";
import { ViewCard } from "./ViewCard";
import type { Selection } from "./StructureTreePanel";

interface PreviewPaneProps {
  /** null = 未选中小说 */
  detail: NovelDetail | null;
  loading: boolean;
  error: string | null;
  selection: Selection | null;
}

/** 选中项 → 只读视图（复用创作流的 ViewCard 渲染） */
function toView(detail: NovelDetail, selection: Selection): View | null {
  switch (selection.kind) {
    case "worldview":
      return detail.worldview ? { kind: "worldview", worldview: detail.worldview } : null;
    case "character": {
      const entry = detail.characters.find((c) => c.id === selection.characterId);
      return entry ? { kind: "character-card", character: entry } : null;
    }
    case "outline":
      return detail.outline ? { kind: "outline", detail: "full", outline: detail.outline } : null;
  }
}

/** 右栏内容预览：结构树选中节点的只读视图 */
export function PreviewPane({ detail, loading, error, selection }: PreviewPaneProps) {
  let body: ReactElement;
  if (!detail) {
    body = (
      <p className="pane-hint">
        {loading ? "加载中…" : error ?? "← 从书库选择一本小说，点击中间结构树预览内容。"}
      </p>
    );
  } else if (!selection) {
    body = <p className="pane-hint">← 点击中间结构树节点预览对应内容。</p>;
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

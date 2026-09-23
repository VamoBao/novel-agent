import type { NovelDetail, OutlineNodeEntry } from "@novel/shared";
import type { ReactNode } from "react";

/** 结构树选中项：三类节点（角色 / 大纲节点携带库表主键区分同名人） */
export type Selection =
  | { kind: "worldview" }
  | { kind: "character"; characterId: string }
  | { kind: "outline"; outlineNodeId: string };

interface StructureTreePanelProps {
  /** null = 未选中小说 */
  detail: NovelDetail | null;
  loading: boolean;
  error: string | null;
  selection: Selection | null;
  onSelect: (selection: Selection) => void;
}

interface TreeNodeProps {
  label: string;
  muted?: boolean;
  active?: boolean;
  depth: number;
  onClick?: () => void;
}

function TreeNode({ label, muted, active, depth, onClick }: TreeNodeProps) {
  if (muted) {
    return (
      <div className="tree-node muted" style={{ paddingLeft: depth * 16 }}>
        {label}
      </div>
    );
  }
  return (
    <button
      className={`tree-node${active ? " active" : ""}`}
      style={{ paddingLeft: depth * 16 }}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

/** 大纲节点树形前缀：部实心三角、幕/章圆点（章为写作期预留） */
function outlinePrefix(type: OutlineNodeEntry["type"]): string {
  return type === "part" ? "▸" : "·";
}

/**
 * 大纲节点按 parentId 递归建树渲染：根（部，parentId=null）在 depth=1，
 * 子级按 sort 逐层下探；点击节点 → 右栏按节点展示 summary / keyPlotPoints。
 */
function renderOutlineNodes(
  nodes: OutlineNodeEntry[],
  parentId: string | null,
  depth: number,
  selection: Selection | null,
  onSelect: (selection: Selection) => void,
): ReactNode[] {
  return nodes
    .filter((node) => node.parentId === parentId)
    .flatMap((node) => [
      <TreeNode
        key={node.id}
        label={`${outlinePrefix(node.type)} ${node.name}`}
        depth={depth}
        active={selection?.kind === "outline" && selection.outlineNodeId === node.id}
        onClick={() => onSelect({ kind: "outline", outlineNodeId: node.id })}
      />,
      ...renderOutlineNodes(nodes, node.id, depth + 1, selection, onSelect),
    ]);
}

/**
 * 中栏结构树：世界观 / 角色 / 大纲（部→幕，读 outlines 表当前版本节点）三类组成节点。
 * 大纲按节点选中预览（视图粒度 = 单节点）。
 */
export function StructureTreePanel({
  detail,
  loading,
  error,
  selection,
  onSelect,
}: StructureTreePanelProps) {
  return (
    <div className="structure">
      <div className="library-head">
        <strong>🧩 结构</strong>
      </div>

      {!detail && loading ? <p className="pane-hint">加载中…</p> : null}
      {!detail && !loading && error ? <p className="pane-error">{error}</p> : null}
      {!detail && !loading && !error ? (
        <p className="pane-hint">← 选择一本小说查看结构</p>
      ) : null}

      {detail ? (
        <>
          <TreeNode
            label={detail.worldview ? "🌍 世界观" : "🌍 世界观（未确认）"}
            depth={0}
            muted={!detail.worldview}
            active={selection?.kind === "worldview"}
            onClick={detail.worldview ? () => onSelect({ kind: "worldview" }) : undefined}
          />

          <div className="tree-group">👥 角色</div>
          {detail.characters.length === 0 ? (
            <TreeNode label="（暂无角色）" depth={1} muted />
          ) : (
            detail.characters.map((character) => (
              <TreeNode
                key={character.id}
                label={`👤 ${character.basicInfo.name}`}
                depth={1}
                active={
                  selection?.kind === "character" &&
                  selection.characterId === character.id
                }
                onClick={() => onSelect({ kind: "character", characterId: character.id })}
              />
            ))
          )}

          <div className="tree-group">📖 大纲</div>
          {detail.outlineNodes.length === 0 ? (
            <TreeNode label="（未生成）" depth={1} muted />
          ) : (
            renderOutlineNodes(detail.outlineNodes, null, 1, selection, onSelect)
          )}
        </>
      ) : null}
    </div>
  );
}

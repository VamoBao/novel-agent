import { useState } from "react";
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
  /** 「📖 大纲」组头的重新生成入口（有大纲时显示刷新按钮）；App 接线到警告弹框 */
  onRegenOutline?: () => void;
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

interface TreeBranchProps {
  label: string;
  depth: number;
  active: boolean;
  /** 有子节点才有切换；叶子以 · 占位保持对齐 */
  hasChildren: boolean;
  expanded: boolean;
  onToggle: () => void;
  onClick: () => void;
}

/** 大纲树行：三角切换（▾ 展开 / ▸ 收起）+ 节点按钮；切换不触发选中 */
function TreeBranch({ label, depth, active, hasChildren, expanded, onToggle, onClick }: TreeBranchProps) {
  return (
    <div className="tree-row" style={{ paddingLeft: depth * 16 }}>
      <button
        className="tree-toggle"
        disabled={!hasChildren}
        onClick={hasChildren ? onToggle : undefined}
        title={hasChildren ? (expanded ? "收起" : "展开") : undefined}
      >
        {hasChildren ? (expanded ? "▾" : "▸") : "·"}
      </button>
      <button className={`tree-node${active ? " active" : ""}`} onClick={onClick}>
        {label}
      </button>
    </div>
  );
}

/**
 * 大纲节点按 parentId 递归建树渲染：根（部，parentId=null）在 depth=1，
 * 子级按 sort 逐层下探；部/幕可收起（collapsed 集合默认空 = 全展开，会话内保持）；
 * 点击节点 → 右栏按节点展示 summary / keyPlotPoints。
 */
function renderOutlineNodes(
  nodes: OutlineNodeEntry[],
  parentId: string | null,
  depth: number,
  selection: Selection | null,
  onSelect: (selection: Selection) => void,
  collapsed: ReadonlySet<string>,
  onToggle: (id: string) => void,
): ReactNode[] {
  return nodes
    .filter((node) => node.parentId === parentId)
    .flatMap((node) => {
      const children = nodes.filter((n) => n.parentId === node.id);
      const expanded = !collapsed.has(node.id);
      return [
        <TreeBranch
          key={node.id}
          label={node.name}
          depth={depth}
          active={selection?.kind === "outline" && selection.outlineNodeId === node.id}
          hasChildren={children.length > 0}
          expanded={expanded}
          onToggle={() => onToggle(node.id)}
          onClick={() => onSelect({ kind: "outline", outlineNodeId: node.id })}
        />,
        ...(expanded ? renderOutlineNodes(nodes, node.id, depth + 1, selection, onSelect, collapsed, onToggle) : []),
      ];
    });
}

/**
 * 中栏结构树：世界观 / 角色 / 大纲（部→幕→章，读 outlines 表当前版本节点）三类组成节点。
 * 大纲分组可整组收起（组头三角，默认展开），组内部/幕可逐节点收起（默认全展开），
 * 收起态均会话内保持；大纲按节点选中预览（视图粒度 = 单节点）；
 * 组头刷新按钮触发大纲重新生成（经弹框确认）。
 */
export function StructureTreePanel({
  detail,
  loading,
  error,
  selection,
  onSelect,
  onRegenOutline,
}: StructureTreePanelProps) {
  /** 收起的大纲节点 ID 集合（默认空 = 全展开），会话内保持 */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  /** 大纲分组整组收起（默认展开），会话内保持 */
  const [groupCollapsed, setGroupCollapsed] = useState(false);
  const toggleCollapse = (id: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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

          <div className="tree-group">
            {detail.outlineNodes.length > 0 ? (
              <button
                className="tree-toggle"
                title={groupCollapsed ? "展开大纲" : "收起大纲"}
                onClick={() => setGroupCollapsed((v) => !v)}
              >
                {groupCollapsed ? "▸" : "▾"}
              </button>
            ) : null}
            <span>📖 大纲</span>
            {detail.outlineNodes.length > 0 && onRegenOutline ? (
              <button
                className="tree-group-btn"
                title="重新生成大纲（旧大纲与已生成章节将归档为历史版本）"
                onClick={onRegenOutline}
              >
                🔄
              </button>
            ) : null}
          </div>
          {detail.outlineNodes.length === 0 ? (
            <TreeNode label="（未生成）" depth={1} muted />
          ) : groupCollapsed ? null : (
            renderOutlineNodes(detail.outlineNodes, null, 1, selection, onSelect, collapsed, toggleCollapse)
          )}
        </>
      ) : null}
    </div>
  );
}

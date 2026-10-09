import { useState } from "react";
import type { ForeshadowEntry, NovelDetail, OutlineNodeEntry } from "@novel/shared";
import type { ReactNode } from "react";

/** 结构树选中项：四类节点（角色 / 大纲节点 / 伏笔携带库表主键区分同名人） */
export type Selection =
  | { kind: "worldview" }
  | { kind: "character"; characterId: string }
  | { kind: "outline"; outlineNodeId: string }
  | { kind: "foreshadow"; foreshadowId: string };

interface StructureTreePanelProps {
  /** null = 未选中小说 */
  detail: NovelDetail | null;
  loading: boolean;
  error: string | null;
  selection: Selection | null;
  onSelect: (selection: Selection) => void;
  /** 「📖 大纲」组头的重新生成入口（有大纲时显示刷新按钮）；App 接线到警告弹框 */
  onRegenOutline?: () => void;
  /** 「👥 角色」组头的「＋ 新增角色」入口（App 接线到右栏新建态）；不传则不显示按钮 */
  onAddCharacter?: () => void;
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
 * 中栏结构树：世界观 / 角色 / 伏笔（按埋设幕分组）/ 大纲（部→幕→章，读 outlines 表当前版本节点）
 * 四类组成节点。角色与大纲分组均可整组收起（组头三角，默认展开、会话内保持），大纲组内部/幕可
 * 逐节点收起（默认全展开）；伏笔组头可整组收起、组内幕分组可逐组收起（均默认展开、会话内保持，
 * 仅分组头不触发选中）；角色组头附「＋ 新增角色」入口；大纲按节点选中预览（视图粒度 =
 * 单节点）；组头刷新按钮触发大纲重新生成（经弹框确认）。
 */
export function StructureTreePanel({
  detail,
  loading,
  error,
  selection,
  onSelect,
  onRegenOutline,
  onAddCharacter,
}: StructureTreePanelProps) {
  /** 收起的大纲节点 ID 集合（默认空 = 全展开），会话内保持 */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  /** 大纲分组整组收起（默认展开），会话内保持 */
  const [groupCollapsed, setGroupCollapsed] = useState(false);
  /** 角色分组整组收起（默认展开），会话内保持 */
  const [charsCollapsed, setCharsCollapsed] = useState(false);
  /** 伏笔分组整组收起（默认展开），会话内保持 */
  const [fsGroupCollapsed, setFsGroupCollapsed] = useState(false);
  /** 收起的伏笔幕分组（actNodeId；未绑幕组键 "__none__"），默认空 = 全展开，会话内保持 */
  const [fsActCollapsed, setFsActCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const toggleFsAct = (key: string): void => {
    setFsActCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const toggleCollapse = (id: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 伏笔按埋设幕分组：幕顺序对齐大纲树当前版本 act 顺序；未绑幕归末尾「未绑幕」组
  //（stale 归档旧幕归未绑幕组，不再静默不可见）
  const fsGroups: { key: string; label: string; items: ForeshadowEntry[] }[] = detail
    ? (() => {
        const actOrder = detail.outlineNodes
          .filter((n) => n.type === "act")
          .map((n) => ({ id: n.id, name: n.name }));
        const groups = actOrder.map((act) => ({
          key: act.id,
          label: act.name,
          items: detail.foreshadows.filter((f) => f.actNodeId === act.id),
        }));
        const actIds = new Set(actOrder.map((act) => act.id));
        const unbound = detail.foreshadows.filter(
          (f) => f.actNodeId === null || !actIds.has(f.actNodeId),
        );
        if (unbound.length > 0) groups.push({ key: "__none__", label: "未绑幕", items: unbound });
        return groups.filter((g) => g.items.length > 0);
      })()
    : [];

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

          <div className="tree-group">
            {detail.characters.length > 0 ? (
              <button
                className="tree-toggle"
                title={charsCollapsed ? "展开角色" : "收起角色"}
                onClick={() => setCharsCollapsed((v) => !v)}
              >
                {charsCollapsed ? "▸" : "▾"}
              </button>
            ) : null}
            <span>👥 角色</span>
            {onAddCharacter ? (
              <button className="tree-group-btn" title="新增角色" onClick={onAddCharacter}>
                ＋
              </button>
            ) : null}
          </div>
          {detail.characters.length === 0 ? (
            <TreeNode label="（暂无角色）" depth={1} muted />
          ) : charsCollapsed ? null : (
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
            {detail.foreshadows.length > 0 ? (
              <button
                className="tree-toggle"
                title={fsGroupCollapsed ? "展开伏笔" : "收起伏笔"}
                onClick={() => setFsGroupCollapsed((v) => !v)}
              >
                {fsGroupCollapsed ? "▸" : "▾"}
              </button>
            ) : null}
            <span>🔮 伏笔</span>
          </div>
          {detail.foreshadows.length === 0 ? (
            <TreeNode label="（暂无伏笔）" depth={1} muted />
          ) : fsGroupCollapsed ? null : (
            fsGroups.map((group) => (
              <div key={group.key}>
                <div className="tree-row" style={{ paddingLeft: 16 }}>
                  <button
                    className="tree-toggle"
                    title={fsActCollapsed.has(group.key) ? "展开" : "收起"}
                    onClick={() => toggleFsAct(group.key)}
                  >
                    {fsActCollapsed.has(group.key) ? "▸" : "▾"}
                  </button>
                  <span>
                    {group.label}（{group.items.length}）
                  </span>
                </div>
                {fsActCollapsed.has(group.key)
                  ? null
                  : group.items.map((f) => (
                      <TreeNode
                        key={f.id}
                        label={`✦ ${f.surfaceAction}`}
                        depth={2}
                        active={
                          selection?.kind === "foreshadow" &&
                          selection.foreshadowId === f.id
                        }
                        onClick={() => onSelect({ kind: "foreshadow", foreshadowId: f.id })}
                      />
                    ))}
              </div>
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

import { useState } from "react";
import { Blocks, BookOpen, ChevronDown, ChevronRight, Feather, FileText, Gem, Globe, Layers3, LoaderCircle, MapPin, Plus, RefreshCw, Sparkle, User, Users } from "lucide-react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { ForeshadowEntry, NovelDetail, OutlineNodeEntry } from "@novel/shared";

export type Selection =
  | { kind: "worldview" }
  | { kind: "character"; characterId: string }
  | { kind: "outline"; outlineNodeId: string }
  | { kind: "foreshadow"; foreshadowId: string }
  | { kind: "location"; locationId: string }
  | { kind: "style"; styleId: string };

interface StructureTreePanelProps {
  detail: NovelDetail | null;
  loading: boolean;
  error: string | null;
  selection: Selection | null;
  onSelect: (selection: Selection) => void;
  onRegenOutline?: () => void;
  onAddCharacter?: () => void;
  onAddStyle?: () => void;
}

function TreeNode({ label, icon, muted, active, depth, onClick }: {
  label: string; icon?: ReactNode; muted?: boolean; active?: boolean; depth: number; onClick?: () => void;
}) {
  if (muted) return <div className="tree-node muted" style={{ paddingLeft: depth * 16 }}>{icon}{label}</div>;
  return <button className={`tree-node${active ? " active" : ""}`} title={label} aria-current={active ? true : undefined}
    style={{ paddingLeft: depth * 16 }} onClick={onClick}>{icon}{label}</button>;
}

/** 一个语义分组对应一张轻卡片；折叠仅控制内容可见性，保持业务选择。 */
function StructureGroup({ label, icon, count, collapsed, onToggle, actions, children }: {
  label: string; icon: ReactNode; count: number; collapsed: boolean; onToggle: () => void;
  actions?: ReactNode; children: ReactNode;
}) {
  return <section className="structure-group" aria-label={label}>
    <div className="tree-group">
      {count > 0 ? <button className="tree-toggle" title={`${collapsed ? "展开" : "收起"}${label}`}
        aria-label={`${collapsed ? "展开" : "收起"}${label}`} aria-expanded={!collapsed} onClick={onToggle}>
        {collapsed ? <ChevronRight className="ic-btn" aria-hidden /> : <ChevronDown className="ic-btn" aria-hidden />}
      </button> : <span className="tree-toggle-spacer" />}
      <span className="tree-group-label">{icon}{label}</span><span className="browse-count">{count}</span>{actions}
    </div>
    {!collapsed || count === 0 ? <div className="structure-group-content">{children}</div> : null}
  </section>;
}

function toggle(setter: Dispatch<SetStateAction<ReadonlySet<string>>>, key: string): void {
  setter((previous) => {
    const next = new Set(previous);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
}

function renderOutlineNodes(nodes: OutlineNodeEntry[], parentId: string | null, depth: number, selection: Selection | null,
  onSelect: (selection: Selection) => void, collapsed: ReadonlySet<string>, onToggle: (id: string) => void): ReactNode[] {
  return nodes.filter((node) => node.parentId === parentId).flatMap((node) => {
    const hasChildren = nodes.some((child) => child.parentId === node.id);
    const expanded = !collapsed.has(node.id);
    const active = selection?.kind === "outline" && selection.outlineNodeId === node.id;
    const Icon = node.type === "part" ? BookOpen : node.type === "act" ? Layers3 : FileText;
    return [
      <div className="tree-row" key={node.id} style={{ paddingLeft: depth * 12 }}>
        <button className="tree-toggle" disabled={!hasChildren} title={hasChildren ? expanded ? "收起" : "展开" : undefined}
          aria-label={`${expanded ? "收起" : "展开"}${node.name}`} aria-expanded={hasChildren ? expanded : undefined}
          onClick={hasChildren ? () => onToggle(node.id) : undefined}>
          {hasChildren ? expanded ? <ChevronDown className="ic-btn" aria-hidden /> : <ChevronRight className="ic-btn" aria-hidden /> : <span className="tree-leaf-dot" />}
        </button>
        <button className={`tree-node${active ? " active" : ""}`} title={node.name} aria-current={active ? true : undefined}
          onClick={() => onSelect({ kind: "outline", outlineNodeId: node.id })}><Icon className="ic" aria-hidden />{node.name}</button>
      </div>,
      ...(expanded ? renderOutlineNodes(nodes, node.id, depth + 1, selection, onSelect, collapsed, onToggle) : []),
    ];
  });
}

/** 资料分组与大纲树保留会话内折叠状态，选择仍以库内标识回调给 App。 */
export function StructureTreePanel({ detail, loading, error, selection, onSelect, onRegenOutline, onAddCharacter, onAddStyle }: StructureTreePanelProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [groupsCollapsed, setGroupsCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [fsActCollapsed, setFsActCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const fsGroups: { key: string; label: string; items: ForeshadowEntry[] }[] = detail ? (() => {
    const acts = detail.outlineNodes.filter((node) => node.type === "act");
    const groups = acts.map((act) => ({ key: act.id, label: act.name, items: detail.foreshadows.filter((item) => item.actNodeId === act.id) }));
    const ids = new Set(acts.map((act) => act.id));
    const unbound = detail.foreshadows.filter((item) => item.actNodeId === null || !ids.has(item.actNodeId));
    if (unbound.length) groups.push({ key: "__none__", label: "未绑幕", items: unbound });
    return groups.filter((group) => group.items.length > 0);
  })() : [];
  const groupProps = (label: string) => ({ label, collapsed: groupsCollapsed.has(label), onToggle: () => toggle(setGroupsCollapsed, label) });

  return <div className="structure">
    <div className="library-head structure-head"><span className="browse-panel-icon"><Blocks size={19} aria-hidden /></span>
      <div className="browse-panel-title"><strong>结构</strong><span>世界设定与故事脉络</span></div></div>
    {!detail && loading ? <p className="pane-hint browse-panel-state" role="status"><LoaderCircle className="ic browse-spinner" aria-hidden />正在加载资料…</p> : null}
    {!detail && !loading && error ? <p className="pane-error browse-panel-state" role="alert">{error}</p> : null}
    {!detail && !loading && !error ? <div className="pane-hint browse-panel-state"><Blocks size={24} aria-hidden /><strong>故事的脉络，在这里展开</strong><p>选择一本小说，查看它的世界、人物与章节。</p></div> : null}
    {detail ? <>
      <section className="structure-group structure-worldview" aria-label="世界观">
        <TreeNode label={detail.worldview ? "世界观" : "世界观（未确认）"} icon={<Globe className="ic" aria-hidden />} depth={0}
          muted={!detail.worldview} active={selection?.kind === "worldview"} onClick={detail.worldview ? () => onSelect({ kind: "worldview" }) : undefined} />
      </section>
      <StructureGroup {...groupProps("地点")} icon={<MapPin className="ic" aria-hidden />} count={detail.locations.length}>
        {detail.locations.length ? detail.locations.map((entry) => <TreeNode key={entry.id} label={entry.name} icon={<MapPin className="ic" aria-hidden />} depth={1}
          active={selection?.kind === "location" && selection.locationId === entry.id} onClick={() => onSelect({ kind: "location", locationId: entry.id })} />)
          : <TreeNode label="（暂无地点）" depth={1} muted />}
      </StructureGroup>
      <StructureGroup {...groupProps("角色")} icon={<Users className="ic" aria-hidden />} count={detail.characters.length}
        actions={onAddCharacter ? <button className="tree-group-btn" title="新增角色" aria-label="新增角色" onClick={onAddCharacter}><Plus className="ic-btn" aria-hidden /></button> : undefined}>
        {detail.characters.length ? detail.characters.map((entry) => <TreeNode key={entry.id} label={entry.basicInfo.name} icon={<User className="ic" aria-hidden />} depth={1}
          active={selection?.kind === "character" && selection.characterId === entry.id} onClick={() => onSelect({ kind: "character", characterId: entry.id })} />)
          : <TreeNode label="（暂无角色）" depth={1} muted />}
      </StructureGroup>
      <StructureGroup {...groupProps("伏笔")} icon={<Gem className="ic" aria-hidden />} count={detail.foreshadows.length}>
        {detail.foreshadows.length ? fsGroups.map((group) => <div key={group.key}>
          <div className="tree-row foreshadow-branch" style={{ paddingLeft: 12 }}>
            <button className="tree-toggle" title={fsActCollapsed.has(group.key) ? "展开" : "收起"} aria-label={`${fsActCollapsed.has(group.key) ? "展开" : "收起"}${group.label}`}
              aria-expanded={!fsActCollapsed.has(group.key)} onClick={() => toggle(setFsActCollapsed, group.key)}>
              {fsActCollapsed.has(group.key) ? <ChevronRight className="ic-btn" aria-hidden /> : <ChevronDown className="ic-btn" aria-hidden />}</button>
            <span title={group.label}>{group.label}（{group.items.length}）</span>
          </div>
          {fsActCollapsed.has(group.key) ? null : group.items.map((entry) => <TreeNode key={entry.id} label={entry.surfaceAction} icon={<Sparkle className="ic" aria-hidden />} depth={2}
            active={selection?.kind === "foreshadow" && selection.foreshadowId === entry.id} onClick={() => onSelect({ kind: "foreshadow", foreshadowId: entry.id })} />)}
        </div>) : <TreeNode label="（暂无伏笔）" depth={1} muted />}
      </StructureGroup>
      <StructureGroup {...groupProps("大纲")} icon={<BookOpen className="ic" aria-hidden />} count={detail.outlineNodes.length}
        actions={detail.outlineNodes.length && onRegenOutline ? <button className="tree-group-btn" title="重新生成大纲（旧大纲与已生成章节将归档为历史版本）" aria-label="重新生成大纲" onClick={onRegenOutline}><RefreshCw className="ic-btn" aria-hidden /></button> : undefined}>
        {detail.outlineNodes.length ? renderOutlineNodes(detail.outlineNodes, null, 1, selection, onSelect, collapsed, (id) => toggle(setCollapsed, id))
          : <TreeNode label="（未生成）" depth={1} muted />}
      </StructureGroup>
      <StructureGroup {...groupProps("文风")} icon={<Feather className="ic" aria-hidden />} count={detail.styleReferences.length}
        actions={onAddStyle ? <button className="tree-group-btn" title="新增参考文风" aria-label="新增参考文风" onClick={onAddStyle}><Plus className="ic-btn" aria-hidden /></button> : undefined}>
        {detail.styleReferences.length ? detail.styleReferences.map((entry) => <TreeNode key={entry.id} label={`${entry.name}${entry.enabled ? "" : "（已停用）"}`} icon={<Feather className="ic" aria-hidden />} depth={1}
          active={selection?.kind === "style" && selection.styleId === entry.id} onClick={() => onSelect({ kind: "style", styleId: entry.id })} />)
          : <TreeNode label="（暂无文风）" depth={1} muted />}
      </StructureGroup>
    </> : null}
  </div>;
}

import type { NovelDetail } from "@novel/shared";

/** 结构树选中项：三类节点（角色携带库表主键区分同名人） */
export type Selection =
  | { kind: "worldview" }
  | { kind: "character"; characterId: string }
  | { kind: "outline" };

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

/**
 * 中栏结构树：世界观 / 角色 / 大纲（部→幕）三类组成节点。
 * 大纲任意层级节点点击均在右栏预览整份大纲（视图粒度 = 整树，树节点是导航入口）。
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
          {!detail.outline ? (
            <TreeNode label="（未生成）" depth={1} muted />
          ) : (
            <>
              <TreeNode
                label={`《${detail.outline.title}》`}
                depth={1}
                active={selection?.kind === "outline"}
                onClick={() => onSelect({ kind: "outline" })}
              />
              {detail.outline.parts.map((part, partIndex) => (
                <div key={`${part.name}-${partIndex}`}>
                  <TreeNode
                    label={`▸ ${part.name}`}
                    depth={2}
                    active={selection?.kind === "outline"}
                    onClick={() => onSelect({ kind: "outline" })}
                  />
                  {part.acts.map((act, actIndex) => (
                    <TreeNode
                      key={`${act.name}-${actIndex}`}
                      label={`· ${act.name}`}
                      depth={3}
                      active={selection?.kind === "outline"}
                      onClick={() => onSelect({ kind: "outline" })}
                    />
                  ))}
                </div>
              ))}
            </>
          )}
        </>
      ) : null}
    </div>
  );
}

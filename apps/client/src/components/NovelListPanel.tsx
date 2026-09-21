import type { NovelListItem } from "@novel/shared";

interface NovelListPanelProps {
  /** null = 列表加载中 */
  novels: NovelListItem[] | null;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRefresh: () => void;
}

/** 左栏书库：novels 表全量列表（仅展示名称 + ID 前缀），点击选中查看详情 */
export function NovelListPanel({
  novels,
  error,
  selectedId,
  onSelect,
  onRefresh,
}: NovelListPanelProps) {
  return (
    <div className="library">
      <div className="library-head">
        <strong>📚 书库</strong>
        <button className="icon-btn" onClick={onRefresh} title="刷新列表">
          ↻
        </button>
      </div>

      {novels === null ? <p className="pane-hint">加载中…</p> : null}

      {novels !== null && error ? (
        <p className="pane-error">
          {error}
          <button className="ghost" onClick={onRefresh}>
            重试
          </button>
        </p>
      ) : null}

      {novels !== null && !error && novels.length === 0 ? (
        <p className="pane-hint">还没有小说，点右上角「＋ 新建小说」开始创作。</p>
      ) : null}

      <ul className="novel-list">
        {novels?.map((novel) => (
          <li key={novel.id}>
            <button
              className={`novel-item${novel.id === selectedId ? " active" : ""}`}
              onClick={() => onSelect(novel.id)}
              title={novel.id}
            >
              <span className="novel-name">{novel.name ?? "未命名小说"}</span>
              <span className="novel-id">{novel.id.slice(0, 8)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

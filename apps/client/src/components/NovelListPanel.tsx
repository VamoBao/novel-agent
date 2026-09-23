import { useEffect, useRef, useState } from "react";
import type { NovelListItem } from "@novel/shared";
import { DeleteNovelDialog } from "./DeleteNovelDialog";

interface NovelListPanelProps {
  /** null = 列表加载中 */
  novels: NovelListItem[] | null;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  onRename: (id: string, name: string) => void;
  onSetPinned: (id: string, pinned: boolean) => void;
  onSetFavorite: (id: string, favorite: boolean) => void;
  onDelete: (id: string) => void;
}

/** 右键菜单定位（clientX/Y + fixed） */
type MenuState = { novelId: string; x: number; y: number } | null;

/** 左栏书库：小说列表（名称 + 置顶/收藏标识），右键菜单管理（重命名 / 置顶 / 收藏 / 删除） */
export function NovelListPanel({
  novels,
  error,
  selectedId,
  onSelect,
  onRefresh,
  onRename,
  onSetPinned,
  onSetFavorite,
  onDelete,
}: NovelListPanelProps) {
  const [menu, setMenu] = useState<MenuState>(null);
  /** 正在内联重命名的小说：null = 无 */
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  /** 等待强确认删除的小说：null = 无；从列表解析条目，删除完成后列表刷新自动关闭 */
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // 点击任意处关闭右键菜单（菜单项自身的 onClick 先执行，再冒泡到 window 关闭）
  useEffect(() => {
    if (!menu) return;
    const close = (): void => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus();
  }, [renamingId]);

  const menuNovel = menu ? novels?.find((novel) => novel.id === menu.novelId) : undefined;
  const confirmDeleteNovel = confirmDeleteId
    ? novels?.find((novel) => novel.id === confirmDeleteId)
    : undefined;

  const submitRename = (): void => {
    if (!renamingId) return;
    const trimmed = renameValue.trim();
    const novel = novels?.find((item) => item.id === renamingId);
    if (trimmed && trimmed !== (novel?.name ?? "")) onRename(renamingId, trimmed);
    setRenamingId(null);
  };

  const startRename = (novel: NovelListItem): void => {
    setRenamingId(novel.id);
    setRenameValue(novel.name ?? "");
  };

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
        {novels?.map((novel) =>
          renamingId === novel.id ? (
            <li key={novel.id} className="novel-item editing">
              <input
                ref={renameInputRef}
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitRename();
                  if (event.key === "Escape") setRenamingId(null);
                }}
                onBlur={submitRename}
              />
            </li>
          ) : (
            <li key={novel.id}>
              <button
                className={`novel-item${novel.id === selectedId ? " active" : ""}`}
                onClick={() => onSelect(novel.id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setConfirmDeleteId(null);
                  setMenu({ novelId: novel.id, x: event.clientX, y: event.clientY });
                }}
                title={novel.id}
              >
                <span className="novel-name">
                  {novel.pinned ? "📌 " : ""}
                  {novel.name ?? "未命名小说"}
                  {novel.favorite ? " ⭐" : ""}
                </span>
                <span className="novel-id">{novel.id.slice(0, 8)}</span>
              </button>
            </li>
          ),
        )}
      </ul>

      {menu && menuNovel ? (
        <div
          className="context-menu"
          style={{ left: menu.x, top: menu.y }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button onClick={() => startRename(menuNovel)}>✏️ 重命名</button>
          <button onClick={() => onSetPinned(menuNovel.id, !menuNovel.pinned)}>
            {menuNovel.pinned ? "取消置顶" : "📌 置顶"}
          </button>
          <button onClick={() => onSetFavorite(menuNovel.id, !menuNovel.favorite)}>
            {menuNovel.favorite ? "取消收藏" : "⭐ 收藏"}
          </button>
          <button
            className="danger"
            onClick={() => {
              setMenu(null);
              setConfirmDeleteId(menuNovel.id);
            }}
          >
            🗑 删除
          </button>
        </div>
      ) : null}

      {confirmDeleteNovel ? (
        <DeleteNovelDialog
          novel={confirmDeleteNovel}
          onCancel={() => setConfirmDeleteId(null)}
          onConfirm={onDelete}
        />
      ) : null}
    </div>
  );
}

import { useEffect, useRef } from "react";
import { Library } from "lucide-react";
import type { NovelListItem } from "@novel/shared";
import { NovelListPanel } from "../NovelListPanel";

interface LibraryManagerProps {
  /** null = 列表加载中 */
  novels: NovelListItem[] | null;
  error: string | null;
  selectedId: string | null;
  /** 受控展开：App 统一协调与切换下拉互斥 */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  onRename: (id: string, name: string) => void;
  onSetPinned: (id: string, pinned: boolean) => void;
  onSetFavorite: (id: string, favorite: boolean) => void;
  onSetWritingPrefs: (id: string) => void;
  onDelete: (id: string) => void;
}

/**
 * 顶栏「书库管理」弹层：切换器右侧图标按钮开合，承载原左侧书库栏的全部管理
 * 职责（列表 + 行尾「⋯」/ 右键菜单）。行点击切换选中并收起弹层；写作偏好与
 * 删除弹窗打开期间不因点击外部收起（模态交互完成后回到弹层继续）。
 */
export function LibraryManager({
  novels,
  error,
  selectedId,
  open,
  onOpenChange,
  onSelect,
  onRefresh,
  onRename,
  onSetPinned,
  onSetFavorite,
  onSetWritingPrefs,
  onDelete,
}: LibraryManagerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: globalThis.MouseEvent): void => {
      // 写作偏好 / 删除确认等模态弹窗交互期间保持管理弹层（弹窗关闭时的冒泡点击不收起）
      if (document.querySelector(".dialog-backdrop")) return;
      const target = event.target as Element | null;
      // 其他顶栏弹层触发器由 App 互斥状态收口，避免事件顺序竞态把新弹层误关
      if (target?.closest("[data-popover-trigger]")) return;
      if (rootRef.current?.contains(event.target as Node)) return;
      onOpenChange(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (document.querySelector(".dialog-backdrop, .context-menu")) return;
      event.preventDefault();
      onOpenChange(false);
      triggerRef.current?.focus();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onOpenChange]);

  return (
    <div className="library-manager" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="icon-btn"
        title="书库管理"
        aria-label="书库管理"
        aria-expanded={open}
        data-popover-trigger
        onClick={() => onOpenChange(!open)}
      >
        <Library className="ic-btn" aria-hidden />
      </button>

      {open ? (
        <div className="header-popover library-popover" aria-label="书库管理">
          <NovelListPanel
            novels={novels}
            error={error}
            selectedId={selectedId}
            onSelect={(id) => {
              onSelect(id);
              onOpenChange(false);
            }}
            onRefresh={onRefresh}
            onRename={onRename}
            onSetPinned={onSetPinned}
            onSetFavorite={onSetFavorite}
            onSetWritingPrefs={onSetWritingPrefs}
            onDelete={onDelete}
          />
        </div>
      ) : null}
    </div>
  );
}

import { useEffect, useRef, type KeyboardEvent } from "react";
import { BookOpen, Check, ChevronDown, CircleAlert, LoaderCircle, Pin, Star } from "lucide-react";
import type { NovelListItem } from "@novel/shared";

interface NovelSwitcherProps {
  /** null = 列表加载中 */
  novels: NovelListItem[] | null;
  error: string | null;
  selectedId: string | null;
  /** 受控展开：App 统一协调与书库管理弹层互斥 */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
  onRefresh: () => void;
}

/**
 * 顶栏左上角小说切换器（类 Android Studio 项目切换）：常显当前小说名，展开后是
 * 纯切换下拉——列表沿用书库排序（置顶优先），当前项高亮 + 勾选，↑↓/Home/End 键盘
 * 导航、Enter 选择、Esc / 点击面板外关闭；管理操作不在此处，由相邻书库管理弹层承载。
 */
export function NovelSwitcher({
  novels,
  error,
  selectedId,
  open,
  onOpenChange,
  onSelect,
  onRefresh,
}: NovelSwitcherProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // 点击面板外收起（触发按钮与选项都在 root 内，自身点击不误关；其他顶栏弹层
  // 触发器同样跳过——互斥开合由 App 统一状态收口，避免事件顺序竞态把新弹层误关）
  useEffect(() => {
    if (!open) return;
    const close = (event: globalThis.MouseEvent): void => {
      const target = event.target as Element | null;
      if (target?.closest("[data-popover-trigger]")) return;
      if (rootRef.current?.contains(event.target as Node)) return;
      onOpenChange(false);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open, onOpenChange]);

  const selected = novels?.find((novel) => novel.id === selectedId) ?? null;
  const label = selected?.name ?? (novels === null ? "正在加载书库…" : "选择小说");

  const focusItem = (index: number): void => {
    const count = novels?.length ?? 0;
    if (!count) return;
    itemRefs.current[((index % count) + count) % count]?.focus();
  };

  const close = (refocus: boolean): void => {
    onOpenChange(false);
    if (refocus) triggerRef.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        close(true);
      }
      return;
    }
    if (!open) return;
    const list = novels;
    const count = list?.length ?? 0;
    if (!list || !count) return;
    const current = itemRefs.current.findIndex((item) => item === document.activeElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      // 未进入列表时从当前选中项开始（无选中取首项）
      if (current < 0) {
        const initial = list.findIndex((novel) => novel.id === selectedId);
        focusItem(initial >= 0 ? initial : 0);
      } else {
        focusItem(current + 1);
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusItem(current < 0 ? count - 1 : current - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusItem(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusItem(count - 1);
    }
  };

  return (
    <div className="novel-switcher" ref={rootRef} onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={`novel-switcher-trigger${open ? " open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={label}
        data-popover-trigger
        onClick={() => onOpenChange(!open)}
      >
        <BookOpen className="ic" aria-hidden />
        <span className="novel-switcher-label">{label}</span>
        <ChevronDown className="ic switcher-chevron" aria-hidden />
      </button>

      {open ? (
        <div className="header-popover switcher-dropdown" role="listbox" aria-label="小说列表">
          {novels === null ? (
            <p className="pane-hint browse-panel-state switcher-state" role="status">
              <LoaderCircle className="ic browse-spinner" aria-hidden />
              正在加载书库…
            </p>
          ) : null}

          {novels !== null && error ? (
            <div className="pane-error browse-panel-state switcher-state" role="alert">
              <CircleAlert className="ic" aria-hidden />
              <p>{error}</p>
              <button className="ghost" onClick={onRefresh}>
                重试
              </button>
            </div>
          ) : null}

          {novels !== null && !error && novels.length === 0 ? (
            <div className="pane-hint browse-panel-state switcher-state">
              <BookOpen size={24} aria-hidden />
              <strong>还没有小说</strong>
              <p>点击右上角「新建小说」，开始第一本故事。</p>
            </div>
          ) : null}

          {novels?.map((novel, index) => {
            const active = novel.id === selectedId;
            return (
              <button
                key={novel.id}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                type="button"
                role="option"
                aria-selected={active}
                title={novel.name ?? "未命名小说"}
                className={`switcher-option${active ? " active" : ""}`}
                onClick={() => {
                  onSelect(novel.id);
                  onOpenChange(false);
                }}
              >
                <span className="novel-cover" aria-hidden>
                  <BookOpen size={15} />
                </span>
                <span className="switcher-option-name">{novel.name ?? "未命名小说"}</span>
                {novel.pinned || novel.favorite ? (
                  <span className="novel-flags">
                    {novel.pinned ? <Pin size={12} aria-hidden /> : null}
                    {novel.favorite ? <Star size={12} aria-hidden /> : null}
                  </span>
                ) : null}
                {active ? <Check className="ic switcher-check" aria-hidden /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

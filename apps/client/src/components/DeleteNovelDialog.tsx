import { useEffect, useRef, useState } from "react";
import type { NovelListItem } from "@novel/shared";

/** 确认口令 = 展示名（未命名小说用展示名，保证有唯一可输入的确认串） */
export function deleteConfirmPhrase(novel: Pick<NovelListItem, "name">): string {
  return novel.name ?? "未命名小说";
}

interface DeleteNovelDialogProps {
  novel: NovelListItem;
  onCancel: () => void;
  onConfirm: (id: string) => void;
}

/**
 * 删除小说强确认对话框（GitHub 删 repo 式）：必须输入小说名（trim 后全等）才放行，
 * 默认焦点在输入框；Esc / 点击遮罩 / 取消关闭，Enter 在放行时提交。
 * 级联范围文案与后端 deleteNovel 的删除语义（四表 + output 产物）保持一致。
 */
export function DeleteNovelDialog({ novel, onCancel, onConfirm }: DeleteNovelDialogProps) {
  const phrase = deleteConfirmPhrase(novel);
  const [value, setValue] = useState("");
  const confirmed = value.trim() === phrase;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <section
        className="dialog dialog-danger"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <h3>🗑 删除小说</h3>
        <p className="dialog-lead">
          即将删除 <strong>《{phrase}》</strong>（{novel.id.slice(0, 8)}）。
          世界观、角色、大纲节点及 output 产物文件将一并清除，<strong>此操作不可恢复</strong>。
        </p>
        <p className="dialog-hint">
          请输入小说名 <code>{phrase}</code> 以确认：
        </p>
        <input
          ref={inputRef}
          value={value}
          placeholder={phrase}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && confirmed) onConfirm(novel.id);
          }}
        />
        <div className="dialog-actions">
          <button onClick={onCancel}>取消</button>
          <button
            className="danger-filled"
            disabled={!confirmed}
            onClick={() => onConfirm(novel.id)}
          >
            删除这本小说
          </button>
        </div>
      </section>
    </div>
  );
}

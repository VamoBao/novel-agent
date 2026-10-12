import { useEffect } from "react";

interface ChapterRegenDialogProps {
  chapterName: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * 章节正文重新生成确认弹框：告知现有正文将被覆盖（不可恢复——旧正文不归档，
 * 与「大纲重生成归档历史版本」不同），且重生成走与首次生成完全相同的
 * 三段校验-修订流程（真实 LLM 成本）。Esc / 遮罩 / 取消关闭。
 */
export function ChapterRegenDialog({ chapterName, onCancel, onConfirm }: ChapterRegenDialogProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <section
        className="dialog"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <h3>🔄 重新生成本章正文</h3>
        <p className="dialog-lead">
          即将为 <strong>「{chapterName}」</strong> 重新生成正文。
        </p>
        <p className="dialog-hint">
          现有正文将被<strong>覆盖且不可恢复</strong>（旧版本不归档）。重新生成走与首次生成
          完全相同的流程：写作模型生成 → 内容约束 / 文风 / 前后自洽三段校验 → 未达标按
          整改报告修订，最多 3 轮，通过校验（或 3 轮后保底）才会替换保存。过程中会产生
          真实的模型调用开销。
        </p>
        <div className="dialog-actions">
          <button onClick={onCancel}>取消</button>
          <button className="primary" onClick={onConfirm}>
            开始重新生成
          </button>
        </div>
      </section>
    </div>
  );
}

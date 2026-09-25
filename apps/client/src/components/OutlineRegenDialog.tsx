import { useEffect } from "react";

interface OutlineRegenDialogProps {
  novelName: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * 重新生成大纲确认弹框：告知旧大纲与已生成章节将随换版一并清空
 * （归档为历史版本，库中保留；世界观与角色不受影响），
 * 且新大纲须经用户预览确认后才入库。Esc / 遮罩 / 取消关闭。
 */
export function OutlineRegenDialog({ novelName, onCancel, onConfirm }: OutlineRegenDialogProps) {
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
        <h3>🔄 重新生成大纲</h3>
        <p className="dialog-lead">
          即将为 <strong>《{novelName}》</strong> 重新生成大纲。
        </p>
        <p className="dialog-hint">
          已生成的章节数据将随旧大纲一并清空（与旧大纲一起归档为历史版本，库中保留）；
          世界观与角色不受影响。新大纲生成后会先给你预览，可提修改意见，最终确认后才会入库为当前版本。
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

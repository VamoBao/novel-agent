import { useState } from "react";
import type { StyleReferenceEntry } from "@novel/shared";

/** 内容软上限：防误粘整本书撑爆写作 prompt（schema 层不设 max，历史数据与大样本不受影响） */
const MAX_CONTENT_LENGTH = 20000;

interface StyleEditFormProps {
  novelId: string;
  /** 缺省 = 新建态（结构树文风组头「＋」进入） */
  entry?: StyleReferenceEntry;
  /** 提交成功（返回新建 / 更新后条目） */
  onSubmitted: (entry: StyleReferenceEntry) => void;
  /** 编辑态删除成功（调用方重置选中并刷新详情） */
  onDeleted?: () => void;
  /** 取消：退出表单，不做任何修改 */
  onCancel: () => void;
}

/**
 * 参考文风编辑表单（新建 / 编辑共用）：名字 + 内容 + 启用开关三项，
 * 名字与内容必填、内容软上限 20000 字符（超限禁提交并提示当前字数）；
 * 提交经 query CLI 直写库；编辑态附「🗑 删除」（confirm 确认）；
 * 取消零副作用。
 */
export function StyleEditForm({ novelId, entry, onSubmitted, onDeleted, onCancel }: StyleEditFormProps) {
  const [name, setName] = useState(entry?.name ?? "");
  const [content, setContent] = useState(entry?.content ?? "");
  const [enabled, setEnabled] = useState(entry?.enabled ?? true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameMissing = name.trim().length === 0;
  const contentMissing = content.trim().length === 0;
  const contentOver = content.length > MAX_CONTENT_LENGTH;
  const busy = submitting;

  const submit = (): void => {
    if (nameMissing || contentMissing || contentOver) return;
    setSubmitting(true);
    setError(null);
    const payload = { name: name.trim(), content, enabled };
    const request =
      entry === undefined
        ? window.agent.addStyle(novelId, payload)
        : window.agent.updateStyle(novelId, entry.id, payload);
    request
      .then((saved) => {
        onSubmitted(saved);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        setSubmitting(false);
      });
  };

  const remove = (): void => {
    if (entry === undefined) return;
    if (!confirm(`确定删除参考文风「${entry.name}」？删除后不可恢复。`)) return;
    setSubmitting(true);
    setError(null);
    window.agent
      .deleteStyle(entry.id)
      .then(() => {
        onDeleted?.();
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        setSubmitting(false);
      });
  };

  return (
    <section className="viewcard character-form">
      <p className="card-label">{entry === undefined ? "新增参考文风" : "编辑参考文风"}</p>
      <div className="form-fields">
        <div className={`field${nameMissing ? " invalid" : ""}`}>
          <label>
            名字（样本标识，如「江南式打斗」）
            <span className="req"> *</span>
          </label>
          <input
            type="text"
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className={`field${contentMissing || contentOver ? " invalid" : ""}`}>
          <label>
            文本内容（粘贴范文或风格描述，生成正文时按启用状态注入写作模型）
            <span className="req"> *</span>
          </label>
          <textarea
            rows={14}
            value={content}
            disabled={busy}
            onChange={(e) => setContent(e.target.value)}
          />
          <p className={`hint${contentOver ? " form-error" : ""}`}>
            {content.length} / {MAX_CONTENT_LENGTH} 字符
            {contentOver ? "（超出软上限，请精简后再提交）" : ""}
          </p>
        </div>
        <div className="field">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={enabled}
              disabled={busy}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            启用（生成正文时注入该样本；停用后保留文本、不注入）
          </label>
        </div>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="form-actions">
        <button
          className="primary"
          disabled={busy || nameMissing || contentMissing || contentOver}
          title={
            nameMissing
              ? "必填未填：名字"
              : contentMissing
                ? "必填未填：文本内容"
                : contentOver
                  ? "内容超出软上限（20000 字符）"
                  : undefined
          }
          onClick={submit}
        >
          {submitting ? "提交中…" : "提交"}
        </button>
        <button disabled={busy} onClick={onCancel}>
          取消
        </button>
        {entry !== undefined && onDeleted ? (
          <button
            className="danger-filled"
            disabled={busy}
            title="删除该参考文风（删除后不可恢复）"
            onClick={remove}
          >
            🗑 删除
          </button>
        ) : null}
      </div>
    </section>
  );
}

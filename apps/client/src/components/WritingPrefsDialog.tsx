import { useEffect, useState } from "react";
import {
  DEFAULT_CHAPTER_LENGTH_MAX,
  DEFAULT_CHAPTER_LENGTH_MIN,
  DEFAULT_STYLE_PASS_SCORE,
} from "@novel/shared";
import { parseWritingPrefsForm, type WritingPrefsFormValues } from "../writing-prefs-form";

interface WritingPrefsDialogProps {
  novelId: string;
  novelName: string;
  /** 关闭弹窗（取消 / 保存成功均经此退出） */
  onClose: () => void;
  /** 保存成功（App 刷新详情与书库列表——updated_at 变化） */
  onSaved: () => void;
}

/**
 * 小说写作偏好弹窗（书库右键「📏 写作偏好」入口）：章节篇幅范围与文风合格线的
 * **小说级覆盖**——优先级高于系统设置（⚙️ 设置弹窗的「写作偏好（默认）」），
 * 留空项回落系统设置（系统未设置时为内置默认 2000~3000 字 / 80 分）。
 * 打开时从详情加载现值；提交经 query CLI set-writing-prefs 全量替换
 * （null=清空覆盖），服务端成对校验兜底；取消零副作用。
 */
export function WritingPrefsDialog({ novelId, novelName, onClose, onSaved }: WritingPrefsDialogProps) {
  /** null = 详情加载中 */
  const [form, setForm] = useState<WritingPrefsFormValues | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.agent
      .getNovelDetail(novelId)
      .then((detail) => {
        if (cancelled) return;
        setForm({
          chapterLengthMin: detail.novel.chapterLengthMin?.toString() ?? "",
          chapterLengthMax: detail.novel.chapterLengthMax?.toString() ?? "",
          stylePassScore: detail.novel.stylePassScore?.toString() ?? "",
        });
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [novelId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const setField = (field: keyof WritingPrefsFormValues, value: string): void => {
    setForm((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const save = (): void => {
    if (!form) return;
    const parsed = parseWritingPrefsForm(form);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setSaving(true);
    setError(null);
    window.agent
      .setWritingPrefs(novelId, parsed.prefs)
      .then(() => onSaved())
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setSaving(false);
      });
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <section
        className="dialog"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <h3>📏 写作偏好</h3>
        <p className="dialog-lead">
          《{novelName}》的章节正文生成偏好，优先级高于系统设置；留空项跟随系统设置
          （系统未设置时为内置默认：篇幅 {DEFAULT_CHAPTER_LENGTH_MIN}~{DEFAULT_CHAPTER_LENGTH_MAX} 字、
          文风合格线 {DEFAULT_STYLE_PASS_SCORE} 分）。
        </p>
        {form === null && !error ? <p className="dialog-lead">加载中…</p> : null}
        {form !== null ? (
          <>
            <div className="field">
              <label>篇幅下限（字）</label>
              <input
                inputMode="numeric"
                value={form.chapterLengthMin}
                disabled={saving}
                placeholder={String(DEFAULT_CHAPTER_LENGTH_MIN)}
                onChange={(event) => setField("chapterLengthMin", event.target.value)}
              />
            </div>
            <div className="field">
              <label>篇幅上限（字）</label>
              <input
                inputMode="numeric"
                value={form.chapterLengthMax}
                disabled={saving}
                placeholder={String(DEFAULT_CHAPTER_LENGTH_MAX)}
                onChange={(event) => setField("chapterLengthMax", event.target.value)}
              />
            </div>
            <div className="field">
              <label>文风合格线（0-100）</label>
              <input
                inputMode="numeric"
                value={form.stylePassScore}
                disabled={saving}
                placeholder={String(DEFAULT_STYLE_PASS_SCORE)}
                onChange={(event) => setField("stylePassScore", event.target.value)}
              />
            </div>
            <p className="settings-hint">篇幅下限与上限须同时填写或同时留空，且下限不大于上限；清空全部即恢复跟随系统设置。</p>
            {error ? <p className="form-error">{error}</p> : null}
            <div className="dialog-actions">
              <button className="primary" disabled={saving} onClick={save}>
                {saving ? "保存中…" : "保存"}
              </button>
              <button disabled={saving} onClick={onClose}>
                取消
              </button>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}

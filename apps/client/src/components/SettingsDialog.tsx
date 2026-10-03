import { useEffect, useState } from "react";
import type { AppSettings, ThemeSetting } from "../../electron/settings";

/** 外观主题三选展示文案（Record 键穷尽：THEMES 扩值时此处编译报错，不会静默漏项） */
const THEME_LABELS: Record<ThemeSetting, string> = {
  system: "跟随系统",
  light: "浅色",
  dark: "深色",
};

/** 外观主题三选（键序即展示顺序） */
const THEME_OPTIONS = (Object.keys(THEME_LABELS) as ThemeSetting[]).map((value) => ({
  value,
  label: THEME_LABELS[value],
}));

/** 表单态：五个模型字段 + 主题（theme 即持久化值，非字符串表单字段） */
interface FormState {
  theme: ThemeSetting;
  deepseekApiKey: string;
  deepseekModelName: string;
  writingModelName: string;
  writingModelApiKey: string;
  writingModelBaseUrl: string;
}

const EMPTY_FORM: FormState = {
  theme: "system",
  deepseekApiKey: "",
  deepseekModelName: "",
  writingModelName: "",
  writingModelApiKey: "",
  writingModelBaseUrl: "",
};

interface SettingsDialogProps {
  /** 关闭弹窗（取消 / 保存成功均经此退出） */
  onClose: () => void;
}

/**
 * 模型设置弹窗（头部 ⚙️ 入口）：Agent 会话模型（DeepSeek Key + 模型名）与
 * 写作模型（模型名 / Key / Base URL，三项需同时配置、留空整体回落 Agent
 * 模型）两组字段；Key 输入用 password 型防旁窥。设置存 userData 明文
 * JSON（VS Code 式，用户决策），优先级 设置 > .env > 继承环境变量——
 * 保存即刻落盘，对 agent 子进程的注入在**下一次 spawn** 生效（会话均短
 * 生命周期，无热更新问题）。
 */
export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.agent
      .getSettings()
      .then(({ settings }) => {
        if (cancelled) return;
        setForm({
          theme: settings.theme,
          deepseekApiKey: settings.deepseek.apiKey,
          deepseekModelName: settings.deepseek.modelName,
          writingModelName: settings.writingModel.modelName,
          writingModelApiKey: settings.writingModel.apiKey,
          writingModelBaseUrl: settings.writingModel.baseUrl,
        });
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setField = (field: keyof FormState, value: string): void => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const save = (): void => {
    setSaving(true);
    setError(null);
    const settings: AppSettings = {
      theme: form.theme,
      deepseek: { apiKey: form.deepseekApiKey, modelName: form.deepseekModelName },
      writingModel: {
        modelName: form.writingModelName,
        apiKey: form.writingModelApiKey,
        baseUrl: form.writingModelBaseUrl,
      },
    };
    window.agent
      .saveSettings(settings)
      .then(() => onClose())
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setSaving(false);
      });
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog settings-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>⚙️ 模型设置</h3>
        {loading ? (
          <p className="dialog-lead">加载中…</p>
        ) : (
          <>
            <div className="settings-group">
              <p className="settings-group-label">外观</p>
              <div className="theme-options" role="group" aria-label="主题">
                {THEME_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={form.theme === option.value ? "selected" : undefined}
                    aria-pressed={form.theme === option.value}
                    disabled={saving}
                    onClick={() => setField("theme", option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="settings-hint">主题保存后立即生效，「跟随系统」随系统浅色/深色自动切换；模型配置仍为下一次会话生效。</p>
            </div>
            <div className="settings-group">
              <p className="settings-group-label">Agent 会话模型（DeepSeek）——世界观 / 角色 / 大纲 / 章节规划</p>
              <div className="field">
                <label>API Key</label>
                <input
                  type="password"
                  value={form.deepseekApiKey}
                  disabled={saving}
                  onChange={(e) => setField("deepseekApiKey", e.target.value)}
                />
              </div>
              <div className="field">
                <label>模型名（可选）</label>
                <input
                  value={form.deepseekModelName}
                  disabled={saving}
                  placeholder="deepseek-flash"
                  onChange={(e) => setField("deepseekModelName", e.target.value)}
                />
              </div>
            </div>
            <div className="settings-group">
              <p className="settings-group-label">写作模型（OpenAI 接口兼容）——章节正文生成专用</p>
              <div className="field">
                <label>模型名</label>
                <input
                  value={form.writingModelName}
                  disabled={saving}
                  placeholder="如 qwen3-max / gpt-5.2"
                  onChange={(e) => setField("writingModelName", e.target.value)}
                />
              </div>
              <div className="field">
                <label>API Key</label>
                <input
                  type="password"
                  value={form.writingModelApiKey}
                  disabled={saving}
                  onChange={(e) => setField("writingModelApiKey", e.target.value)}
                />
              </div>
              <div className="field">
                <label>Base URL</label>
                <input
                  value={form.writingModelBaseUrl}
                  disabled={saving}
                  placeholder="https://api.example.com/v1"
                  onChange={(e) => setField("writingModelBaseUrl", e.target.value)}
                />
              </div>
              <p className="settings-hint">三项需同时配置才启用独立写作模型；留空则正文生成回落上面的 Agent 模型。</p>
            </div>
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
        )}
      </div>
    </div>
  );
}

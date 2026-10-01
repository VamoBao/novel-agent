import { useEffect, useState } from "react";
import type { AppSettings } from "../../electron/settings";

/** 表单态：五个字段一一对应的扁平字符串（空串 = 未配置） */
interface FormState {
  deepseekApiKey: string;
  deepseekModelName: string;
  writingModelName: string;
  writingModelApiKey: string;
  writingModelBaseUrl: string;
}

const EMPTY_FORM: FormState = {
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
  const [filePath, setFilePath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.agent
      .getSettings()
      .then(({ settings, filePath: path }) => {
        if (cancelled) return;
        setForm({
          deepseekApiKey: settings.deepseek.apiKey,
          deepseekModelName: settings.deepseek.modelName,
          writingModelName: settings.writingModel.modelName,
          writingModelApiKey: settings.writingModel.apiKey,
          writingModelBaseUrl: settings.writingModel.baseUrl,
        });
        setFilePath(path);
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
            <p className="dialog-hint">
              明文存储于 {filePath ?? "（加载失败）"}（不进仓库）；优先级：此处设置 &gt; .env &gt;
              环境变量；保存后自下一次会话生效。
            </p>
          </>
        )}
      </div>
    </div>
  );
}

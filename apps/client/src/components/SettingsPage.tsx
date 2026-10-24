import { useEffect, useState, type ReactElement } from "react";
import {
  ArrowLeft,
  Cpu,
  Palette,
  Settings,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import type { AppSettings, ThemeSetting } from "../../electron/settings";
import {
  DEFAULT_CHAPTER_LENGTH_MAX,
  DEFAULT_CHAPTER_LENGTH_MIN,
  DEFAULT_STYLE_PASS_SCORE,
  MODEL_PROVIDER_BASE_URLS,
  type ModelProvider,
} from "@novel/shared";
import { parseWritingPrefsForm } from "../writing-prefs-form";

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

/** provider 三选展示文案（Record 键穷尽：MODEL_PROVIDERS 扩值时此处编译报错） */
const PROVIDER_LABELS: Record<ModelProvider, string> = {
  openai: "OpenAI",
  deepseek: "DeepSeek",
  claude: "Claude",
};

/** provider 三选（键序即展示顺序） */
const PROVIDER_OPTIONS = (Object.keys(PROVIDER_LABELS) as ModelProvider[]).map((value) => ({
  value,
  label: PROVIDER_LABELS[value],
}));

/** provider 展示提示：Base URL 留空时的官方默认地址与模型名示例（切换 provider 只换提示，不改写已填值） */
const PROVIDER_HINTS: Record<ModelProvider, { baseUrl: string; modelName: string }> = {
  openai: { baseUrl: MODEL_PROVIDER_BASE_URLS.openai, modelName: "如 gpt-5.2" },
  deepseek: { baseUrl: MODEL_PROVIDER_BASE_URLS.deepseek, modelName: "deepseek-flash" },
  claude: { baseUrl: MODEL_PROVIDER_BASE_URLS.claude, modelName: "如 claude-sonnet-5" },
};

/** 设置导航分类（左侧栏）：模型设置 / 写作偏好 / 外观 */
type SettingsCategory = "model" | "writing" | "appearance";

/** 导航分类（键序即展示顺序；图标 Lucide） */
const CATEGORIES: { id: SettingsCategory; label: string; icon: LucideIcon }[] = [
  { id: "model", label: "模型设置", icon: Cpu },
  { id: "writing", label: "写作偏好", icon: SlidersHorizontal },
  { id: "appearance", label: "外观", icon: Palette },
];

/** 表单态：主题 + 三族模型各四字段（provider + Key + 模型名 + Base URL）+ 写作偏好三字段
 *  （空串 = 未设置）+ 产物输出目录（空串 = 场景默认目录） */
interface FormState {
  theme: ThemeSetting;
  agentProvider: ModelProvider;
  agentApiKey: string;
  agentModelName: string;
  agentBaseUrl: string;
  writingProvider: ModelProvider;
  writingModelName: string;
  writingModelApiKey: string;
  writingModelBaseUrl: string;
  reviewProvider: ModelProvider;
  reviewModelName: string;
  reviewModelApiKey: string;
  reviewModelBaseUrl: string;
  chapterLengthMin: string;
  chapterLengthMax: string;
  stylePassScore: string;
  outputDir: string;
}

/** 三族模型的 provider 字段（下拉框选中态 / 设置文件原值 / 用户是否编辑过连接字段） */
type ProviderField = "agent" | "writing" | "review";

const EMPTY_FORM: FormState = {
  theme: "system",
  // 载入设置前的兜底选择与「全新配置」的生效值一致（Agent 落 DeepSeek、独立写作 / 校审落 OpenAI）
  agentProvider: "deepseek",
  agentApiKey: "",
  agentModelName: "",
  agentBaseUrl: "",
  writingProvider: "openai",
  writingModelName: "",
  writingModelApiKey: "",
  writingModelBaseUrl: "",
  reviewProvider: "openai",
  reviewModelName: "",
  reviewModelApiKey: "",
  reviewModelBaseUrl: "",
  chapterLengthMin: "",
  chapterLengthMax: "",
  stylePassScore: "",
  outputDir: "",
};

/** 连接字段 → 所属模型组：编辑任一连接字段即固化该组当前显示的接口类型 */
const MODEL_GROUP_FIELDS: Partial<Record<keyof FormState, ProviderField>> = {
  agentProvider: "agent",
  agentApiKey: "agent",
  agentModelName: "agent",
  agentBaseUrl: "agent",
  writingProvider: "writing",
  writingModelName: "writing",
  writingModelApiKey: "writing",
  writingModelBaseUrl: "writing",
  reviewProvider: "review",
  reviewModelName: "review",
  reviewModelApiKey: "review",
  reviewModelBaseUrl: "review",
};

/** 各模型组的 provider 下拉框选中态键（三族共用渲染） */
const PROVIDER_FORM_KEYS: Record<ProviderField, keyof FormState> = {
  agent: "agentProvider",
  writing: "writingProvider",
  review: "reviewProvider",
};

interface SettingsPageProps {
  /** 返回浏览页（返回按钮 / Esc / 取消均经此退出） */
  onClose: () => void;
}

/**
 * 设置页（独立整页，头部「设置」入口）：左导航分类（模型设置 / 写作偏好 / 外观）
 * + 右内容区具体设置项——内容纵向铺开，不受弹窗高度局限。分类仅决定渲染哪组，
 * 表单态跨分类共享、右栏底部一次保存全部（对齐原设置弹窗语义）。
 *
 * 模型设置：Agent 会话模型、写作模型与校审模型三组——各含**接口类型 provider**
 * （openai / deepseek / claude，决定调用哪家官方 SDK 与协议）、API Key、模型名与
 * Base URL（写作 / 校审两组三项需同时配置才启用独立模型，留空回落 Agent 模型；
 * 校审为配置先行——当前版本审校仍用 Agent 模型）；
 * 写作偏好：章节篇幅范围与文风合格线的系统级默认（留空 = 内置默认 2000~3000 字 /
 * 80 分；单本小说可在书库右键「写作偏好」单独覆盖，优先级更高）+ 产物输出目录；
 * 外观：主题三选（保存即生效）。Key 输入用 password 型防旁窥。
 *
 * provider 载入时按 agent 侧同一规则回显生效选项（历史配置缺 provider 时按
 * 有效地址迁移）；Base URL 与模型名的 placeholder 随所选 provider 变化，
 * **已填写的值不自动改写或删除**（自定义地址须支持所选协议）。设置存 userData
 * 明文 JSON（VS Code 式，用户决策），优先级 设置 > .env > 继承环境变量——
 * 保存即刻落盘，对 agent 子进程的注入在**下一次 spawn** 生效（会话均短
 * 生命周期，无热更新问题）。
 */
export function SettingsPage({ onClose }: SettingsPageProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  /** 设置文件里的 provider 原值（空串 = 历史未设置）：未编辑该组模型连接时按原值保存，
   *  避免把「回显出来的生效值」固化进设置文件、遮蔽 `.env` / 继承环境里的 provider */
  const [storedProvider, setStoredProvider] = useState<Record<ProviderField, ModelProvider | "">>({
    agent: "", writing: "", review: "",
  });
  const [modelTouched, setModelTouched] = useState<Record<ProviderField, boolean>>({
    agent: false, writing: false, review: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 产物目录的场景默认（设置项留空时的落点）：placeholder 与提示展示用 */
  const [defaultOutputDir, setDefaultOutputDir] = useState("");
  /** 目录选择器进行中（防止重复唤起系统对话框） */
  const [picking, setPicking] = useState(false);
  /** 当前导航分类（默认模型设置）；会话内保持 */
  const [category, setCategory] = useState<SettingsCategory>("model");

  useEffect(() => {
    let cancelled = false;
    window.agent
      .getSettings()
      .then(({ settings, effectiveProviders, defaultOutputDir: fallback }) => {
        if (cancelled) return;
        setStoredProvider({
          agent: settings.agentModel.provider,
          writing: settings.writingModel.provider,
          review: settings.reviewModel.provider,
        });
        setDefaultOutputDir(fallback);
        setForm({
          theme: settings.theme,
          // 下拉框回显**生效值**（含 .env / 继承环境变量的贡献），与 agent 侧同一规则
          agentProvider: effectiveProviders.agent,
          agentApiKey: settings.agentModel.apiKey,
          agentModelName: settings.agentModel.modelName,
          agentBaseUrl: settings.agentModel.baseUrl,
          writingProvider: effectiveProviders.writing,
          writingModelName: settings.writingModel.modelName,
          writingModelApiKey: settings.writingModel.apiKey,
          writingModelBaseUrl: settings.writingModel.baseUrl,
          reviewProvider: effectiveProviders.review,
          reviewModelName: settings.reviewModel.modelName,
          reviewModelApiKey: settings.reviewModel.apiKey,
          reviewModelBaseUrl: settings.reviewModel.baseUrl,
          chapterLengthMin: settings.writing.chapterLengthMin?.toString() ?? "",
          chapterLengthMax: settings.writing.chapterLengthMax?.toString() ?? "",
          stylePassScore: settings.writing.stylePassScore?.toString() ?? "",
          outputDir: settings.outputDir,
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

  // Esc 返回浏览页（页面化后保留弹窗期的键盘退出习惯）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const setField = (field: keyof FormState, value: string): void => {
    setForm((prev) => ({ ...prev, [field]: value }));
    // 编辑连接字段表示正在配置该模型，必须保留界面显示的接口类型。
    const group = MODEL_GROUP_FIELDS[field] ?? null;
    if (group) setModelTouched((prev) => ({ ...prev, [group]: true }));
  };

  const save = (): void => {
    const parsed = parseWritingPrefsForm({
      chapterLengthMin: form.chapterLengthMin,
      chapterLengthMax: form.chapterLengthMax,
      stylePassScore: form.stylePassScore,
    });
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setSaving(true);
    setError(null);
    // 未编辑该组连接时写回设置文件原值（空串 = 保持「按地址迁移」语义）
    const settings: AppSettings = {
      theme: form.theme,
      agentModel: {
        provider: modelTouched.agent ? form.agentProvider : storedProvider.agent,
        apiKey: form.agentApiKey,
        modelName: form.agentModelName,
        baseUrl: form.agentBaseUrl,
      },
      writingModel: {
        provider: modelTouched.writing ? form.writingProvider : storedProvider.writing,
        modelName: form.writingModelName,
        apiKey: form.writingModelApiKey,
        baseUrl: form.writingModelBaseUrl,
      },
      reviewModel: {
        provider: modelTouched.review ? form.reviewProvider : storedProvider.review,
        modelName: form.reviewModelName,
        apiKey: form.reviewModelApiKey,
        baseUrl: form.reviewModelBaseUrl,
      },
      writing: parsed.prefs,
      outputDir: form.outputDir,
    };
    window.agent
      .saveSettings(settings)
      .then(() => onClose())
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setSaving(false);
      });
  };

  /** 目录选择：主进程系统选择器 + 可写性探针——选中且可写才回填；不可写回显错误不采纳；
   *  用户取消静默（非错误）。路径不经手写输入，保证落库目录都经过探针验证 */
  const pickOutputDir = (): void => {
    setPicking(true);
    setError(null);
    window.agent
      .pickOutputDirectory()
      .then((result) => {
        if (result.ok) {
          setForm((prev) => ({ ...prev, outputDir: result.dir }));
        } else if (!result.canceled && result.error) {
          setError(result.error);
        }
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setPicking(false));
  };

  /** provider 下拉框（三族模型共用；option 键序即 MODEL_PROVIDERS 顺序）；
   *  下拉框与连接字段的改动均记为显式选择，其他设置不固化推断值 */
  const renderProviderSelect = (field: ProviderField): ReactElement => (
    <div className="field">
      <label>接口类型</label>
      <select
        value={form[PROVIDER_FORM_KEYS[field]]}
        disabled={saving}
        onChange={(e) => {
          setField(PROVIDER_FORM_KEYS[field], e.target.value);
        }}
      >
        {PROVIDER_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );

  /** Agent 会话模型组（模型设置分类） */
  const agentModelGroup = (
    <div className="settings-group">
      <p className="settings-group-label">Agent 会话模型——世界观 / 角色 / 大纲 / 章节规划 / 正文校验</p>
      {renderProviderSelect("agent")}
      <div className="field">
        <label>API Key</label>
        <input
          type="password"
          value={form.agentApiKey}
          disabled={saving}
          onChange={(e) => setField("agentApiKey", e.target.value)}
        />
      </div>
      <div className="field">
        <label>模型名（可选）</label>
        <input
          value={form.agentModelName}
          disabled={saving}
          placeholder={PROVIDER_HINTS[form.agentProvider].modelName}
          onChange={(e) => setField("agentModelName", e.target.value)}
        />
      </div>
      <div className="field">
        <label>Base URL（可选）</label>
        <input
          value={form.agentBaseUrl}
          disabled={saving}
          placeholder={PROVIDER_HINTS[form.agentProvider].baseUrl}
          onChange={(e) => setField("agentBaseUrl", e.target.value)}
        />
      </div>
      <p className="settings-hint">
        接口类型决定调用哪家官方 SDK 与协议，下拉框显示当前生效值（可能来自 .env / 环境变量）；
        Base URL 留空使用该类型的官方默认地址（当前：{PROVIDER_HINTS[form.agentProvider].baseUrl}），
        自定义地址须支持所选协议。模型名留空仅 DeepSeek 有默认值。
      </p>
    </div>
  );

  /** 写作模型组（模型设置分类） */
  const writingModelGroup = (
    <div className="settings-group">
      <p className="settings-group-label">写作模型——章节正文生成专用</p>
      {renderProviderSelect("writing")}
      <div className="field">
        <label>模型名</label>
        <input
          value={form.writingModelName}
          disabled={saving}
          placeholder={PROVIDER_HINTS[form.writingProvider].modelName}
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
          placeholder={PROVIDER_HINTS[form.writingProvider].baseUrl}
          onChange={(e) => setField("writingModelBaseUrl", e.target.value)}
        />
      </div>
      <p className="settings-hint">
        三项需同时配置才启用独立写作模型（接口类型可与上面的 Agent 模型不同）；留空则正文生成回落 Agent 模型。
        编辑本组连接信息会保存当前接口类型；仅修改外观或写作偏好时，继续沿用已有接口类型配置。
      </p>
    </div>
  );

  /** 校审模型组（模型设置分类；配置先行——当前版本审校仍用 Agent 模型） */
  const reviewModelGroup = (
    <div className="settings-group">
      <p className="settings-group-label">校审模型——章节正文审校专用</p>
      {renderProviderSelect("review")}
      <div className="field">
        <label>模型名</label>
        <input
          value={form.reviewModelName}
          disabled={saving}
          placeholder={PROVIDER_HINTS[form.reviewProvider].modelName}
          onChange={(e) => setField("reviewModelName", e.target.value)}
        />
      </div>
      <div className="field">
        <label>API Key</label>
        <input
          type="password"
          value={form.reviewModelApiKey}
          disabled={saving}
          onChange={(e) => setField("reviewModelApiKey", e.target.value)}
        />
      </div>
      <div className="field">
        <label>Base URL</label>
        <input
          value={form.reviewModelBaseUrl}
          disabled={saving}
          placeholder={PROVIDER_HINTS[form.reviewProvider].baseUrl}
          onChange={(e) => setField("reviewModelBaseUrl", e.target.value)}
        />
      </div>
      <p className="settings-hint">
        三项需同时配置才启用独立校审模型（接口类型可与上面的 Agent / 写作模型不同）；留空则正文审校回落 Agent 模型。
        当前版本审校流程仍使用 Agent 会话模型——本组配置先行保存，接入校审流程后生效。
        编辑本组连接信息会保存当前接口类型；仅修改外观或写作偏好时，继续沿用已有接口类型配置。
      </p>
    </div>
  );

  /** 写作偏好组（写作偏好分类） */
  const writingPrefsGroup = (
    <div className="settings-group">
      <p className="settings-group-label">写作偏好（默认）——章节正文生成</p>
      <div className="field">
        <label>篇幅下限（字）</label>
        <input
          inputMode="numeric"
          value={form.chapterLengthMin}
          disabled={saving}
          placeholder={String(DEFAULT_CHAPTER_LENGTH_MIN)}
          onChange={(e) => setField("chapterLengthMin", e.target.value)}
        />
      </div>
      <div className="field">
        <label>篇幅上限（字）</label>
        <input
          inputMode="numeric"
          value={form.chapterLengthMax}
          disabled={saving}
          placeholder={String(DEFAULT_CHAPTER_LENGTH_MAX)}
          onChange={(e) => setField("chapterLengthMax", e.target.value)}
        />
      </div>
      <div className="field">
        <label>文风合格线（0-100）</label>
        <input
          inputMode="numeric"
          value={form.stylePassScore}
          disabled={saving}
          placeholder={String(DEFAULT_STYLE_PASS_SCORE)}
          onChange={(e) => setField("stylePassScore", e.target.value)}
        />
      </div>
      <p className="settings-hint">
        留空使用内置默认：篇幅 {DEFAULT_CHAPTER_LENGTH_MIN}~{DEFAULT_CHAPTER_LENGTH_MAX} 字、文风合格线 {DEFAULT_STYLE_PASS_SCORE} 分；
        单本小说可在书库右键「写作偏好」单独设置，优先级高于此处。
      </p>
    </div>
  );

  /** 产物输出目录组（写作偏好分类——正文文件去向与写作直接相关） */
  const outputDirGroup = (
    <div className="settings-group">
      <p className="settings-group-label">产物输出目录——章节正文文件</p>
      <div className="field">
        <label>输出目录</label>
        <input
          value={form.outputDir}
          readOnly
          disabled={saving}
          placeholder={`默认：${defaultOutputDir}`}
        />
      </div>
      <div className="field-actions">
        <button type="button" disabled={saving || picking} onClick={pickOutputDir}>
          {picking ? "选择中…" : "浏览…"}
        </button>
        <button
          type="button"
          disabled={saving || form.outputDir.length === 0}
          onClick={() => setForm((prev) => ({ ...prev, outputDir: "" }))}
        >
          恢复默认
        </button>
      </div>
      <p className="settings-hint">
        正文按「输出目录/小说 ID/部名/章名.md」分文件夹存放；留空使用默认：{defaultOutputDir || "（加载中）"}。
        选择时自动验证目录可写；更换目录后已生成的正文保留在原位置仍可阅读，新正文写入新目录；保存后下一次会话生效。
      </p>
    </div>
  );

  /** 外观组（外观分类） */
  const appearanceGroup = (
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
  );

  return (
    <div className="settings-page">
      <header className="settings-header">
        <button className="icon-btn" onClick={onClose} title="返回浏览页">
          <ArrowLeft className="ic-btn" aria-hidden />
        </button>
        <strong>
          <Settings className="ic" aria-hidden />
          设置
        </strong>
      </header>

      <div className="settings-body">
        <nav className="settings-nav" aria-label="设置分类">
          {CATEGORIES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={category === item.id ? "active" : undefined}
              aria-current={category === item.id ? "page" : undefined}
              disabled={saving}
              onClick={() => setCategory(item.id)}
            >
              <item.icon className="ic" aria-hidden />
              {item.label}
            </button>
          ))}
        </nav>

        <main className="settings-content">
          {loading ? (
            <p className="settings-hint">加载中…</p>
          ) : (
            <>
              {category === "model" ? (
                <>
                  {agentModelGroup}
                  {writingModelGroup}
                  {reviewModelGroup}
                </>
              ) : null}
              {category === "writing" ? (
                <>
                  {writingPrefsGroup}
                  {outputDirGroup}
                </>
              ) : null}
              {category === "appearance" ? appearanceGroup : null}
              {error ? <p className="form-error">{error}</p> : null}
              <div className="settings-actions">
                <button className="primary" disabled={saving} onClick={save}>
                  {saving ? "保存中…" : "保存"}
                </button>
                <button disabled={saving} onClick={onClose}>
                  取消
                </button>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

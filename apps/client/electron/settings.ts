import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  chapterLengthBoundSchema,
  stylePassScoreSchema,
} from "@novel/shared";

/**
 * 客户端应用配置（主进程持有，agent 子进程经环境变量注入读取）：
 * VS Code 式**明文 JSON**（用户决策）存于 Electron userData 目录
 * （settings.json，不进仓库、不入 git）——外观主题（system / light / dark，
 * main 侧 applyTheme 设 nativeTheme.themeSource）、Agent 会话模型（OpenAI 接口
 * 兼容：Key + 模型名 + Base URL）、写作模型（OpenAI 接口兼容：模型名 + Key +
 * Base URL，三项需同时配置，留空回落 Agent 模型）与**写作偏好系统级默认**
 * （章节篇幅 min/max + 文风合格线，null=未设置回落内置默认 2000~3000 / 80；
 * 单本小说可在书库右键「写作偏好」单独覆盖，优先级更高）。
 *
 * 优先级（resolveModelEnv / resolveWritingEnv）：设置文件 > 根目录 `.env` >
 * 继承的环境变量；模型解析结果仍以 `AGENT_MODEL_*` / `WRITING_MODEL_*` 注入
 * 子进程（childEnv），写作偏好以 `NOVEL_CHAPTER_LENGTH_MIN/MAX` /
 * `NOVEL_STYLE_PASS_SCORE` 注入，providers 层（apps/agent）统一读取。
 *
 * 本模块刻意不 import electron（app.getPath 由调用方传入），保持可在
 * bun:test 下直接导入测试。
 */

/** 主题三态：与 Electron nativeTheme.themeSource 原生枚举一一对应，零转换 */
export const THEMES = ["system", "light", "dark"] as const;
export type ThemeSetting = (typeof THEMES)[number];

/** 写作偏好（系统级默认）：null = 未设置（正文生成回落内置默认，或被小说级覆盖之外的部分回落至此） */
export interface WritingPrefsSettings {
  chapterLengthMin: number | null;
  chapterLengthMax: number | null;
  stylePassScore: number | null;
}

export interface AppSettings {
  /** 外观主题：跟随系统（默认）/ 浅色 / 深色；main 侧经 applyTheme 设 nativeTheme.themeSource */
  theme: ThemeSetting;
  /** Agent 会话模型（OpenAI 接口兼容）：世界观 / 角色 / 大纲 / 章节规划等工作流共用 */
  agentModel: {
    apiKey: string;
    modelName: string;
    baseUrl: string;
  };
  /** 写作模型（OpenAI 接口兼容端点）：章节正文生成专用；三项留空回落 Agent 模型 */
  writingModel: {
    modelName: string;
    apiKey: string;
    baseUrl: string;
  };
  /** 写作偏好（章节正文生成）的系统级默认；单本小说的「写作偏好」覆盖优先级更高 */
  writing: WritingPrefsSettings;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  agentModel: { apiKey: "", modelName: "", baseUrl: "" },
  writingModel: { modelName: "", apiKey: "", baseUrl: "" },
  writing: { chapterLengthMin: null, chapterLengthMax: null, stylePassScore: null },
};

/** 单字段还原：非字符串一律空串，字符串 trim（粘贴的换行/空白无效化） */
function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 组内字段还原：未知字段丢弃、非字符串归空串（K 为字面量键组，返回对应形状） */
function normalizeGroup<K extends string>(raw: unknown, keys: readonly K[]): Record<K, string> {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const result = {} as Record<K, string>;
  for (const key of keys) {
    result[key] = normalizeString(source[key]);
  }
  return result;
}

/** 主题枚举还原：非三合法值（缺省 / 手改 settings.json 写错）一律回「跟随系统」 */
function normalizeTheme(value: unknown): ThemeSetting {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value)
    ? (value as ThemeSetting)
    : "system";
}

/** 写作偏好单字段还原：整数且在边界内保留，其余（缺省 / 非数字 / 越界）归 null（未设置） */
function normalizeWritingValue(
  value: unknown,
  bounds: typeof chapterLengthBoundSchema | typeof stylePassScoreSchema,
): number | null {
  return typeof value === "number" && bounds.safeParse(value).success ? value : null;
}

/** 写作偏好组还原：逐字段独立校验（篇幅成对与否交给解析层的防御性规则） */
function normalizeWritingGroup(raw: unknown): WritingPrefsSettings {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    chapterLengthMin: normalizeWritingValue(source.chapterLengthMin, chapterLengthBoundSchema),
    chapterLengthMax: normalizeWritingValue(source.chapterLengthMax, chapterLengthBoundSchema),
    stylePassScore: normalizeWritingValue(source.stylePassScore, stylePassScoreSchema),
  };
}

/** 还原为合法设置对象：未知字段忽略（前向兼容手工编辑）、字符串 trim / 非字符串归空串、theme 枚举非法归 system、写作偏好非法值归 null */
export function normalizeSettings(raw: unknown): AppSettings {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    theme: normalizeTheme(source.theme),
    agentModel: normalizeGroup(
      Object.hasOwn(source, "agentModel") ? source.agentModel : source.deepseek,
      ["apiKey", "modelName", "baseUrl"],
    ),
    writingModel: normalizeGroup(source.writingModel, ["modelName", "apiKey", "baseUrl"]),
    writing: normalizeWritingGroup(source.writing),
  };
}

/** 读取设置文件（不存在 / 损坏一律返回全空默认——等价未配置，.env 兜底） */
export function readSettingsFile(filePath: string): AppSettings {
  try {
    return normalizeSettings(JSON.parse(readFileSync(filePath, "utf8")));
  } catch {
    return normalizeSettings(null);
  }
}

/** 保存设置文件（自动建目录，人类可读的两空格缩进） */
export function writeSettingsFile(filePath: string, settings: AppSettings): AppSettings {
  const normalized = normalizeSettings(settings);
  if (!existsSync(dirname(filePath))) {
    mkdirSync(dirname(filePath), { recursive: true });
  }
  writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

/** 模型相关环境变量清单（settings.json 字段 → 注入子进程的变量名） */
const MODEL_ENV_ENTRIES = [
  ["agentModel", "apiKey", "AGENT_MODEL_API_KEY", "DEEPSEEK_API_KEY"],
  ["agentModel", "modelName", "AGENT_MODEL_NAME", "DEEPSEEK_MODEL_NAME"],
  ["agentModel", "baseUrl", "AGENT_MODEL_BASE_URL", undefined],
  ["writingModel", "modelName", "WRITING_MODEL_NAME", undefined],
  ["writingModel", "apiKey", "WRITING_MODEL_API_KEY", undefined],
  ["writingModel", "baseUrl", "WRITING_MODEL_BASE_URL", undefined],
] as const;

/** 从（可能是 null/undefined 的）候选值里取第一个非空串 */
function firstNonEmpty(...candidates: Array<string | undefined>): string {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return "";
}

/**
 * 三级优先级解析为注入子进程的环境变量：设置文件 > `.env`（调用方解析的
 * 键值表）> 继承的父进程环境变量。返回恰好含六个模型变量的键值表，
 * **空串表示三层均未配置**（调用方须从子进程 env 中删除该键——空串会让
 * provider 侧「未配置」判定与默认值逻辑失真）。
 */
export function resolveModelEnv(
  settings: AppSettings,
  dotenv: Readonly<Record<string, string>>,
  inherited: NodeJS.ProcessEnv,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [group, field, envKey, legacyKey] of MODEL_ENV_ENTRIES) {
    // 先按来源优先级查找，同一来源内通用变量先于旧变量。
    env[envKey] = firstNonEmpty(
      settings[group][field],
      dotenv[envKey],
      legacyKey ? dotenv[legacyKey] : undefined,
      inherited[envKey],
      legacyKey ? inherited[legacyKey] : undefined,
    );
  }
  return env;
}

/** 写作偏好环境变量清单（settings.json 字段 → 注入子进程的变量名） */
const WRITING_ENV_ENTRIES = [
  ["chapterLengthMin", "NOVEL_CHAPTER_LENGTH_MIN"],
  ["chapterLengthMax", "NOVEL_CHAPTER_LENGTH_MAX"],
  ["stylePassScore", "NOVEL_STYLE_PASS_SCORE"],
] as const;

/**
 * 写作偏好的三级优先级解析（设置文件 > `.env` > 继承的环境变量）：
 * 只输出**已解析到值**的键（调用方直接覆盖注入）；三层均未配置时不输出——
 * agent 侧读取缺省即「系统级未设置」，正文生成回落内置默认。
 */
export function resolveWritingEnv(
  settings: AppSettings,
  dotenv: Readonly<Record<string, string>>,
  inherited: Readonly<NodeJS.ProcessEnv>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [field, envKey] of WRITING_ENV_ENTRIES) {
    const fromSettings = settings.writing[field];
    const value =
      fromSettings !== null
        ? String(fromSettings)
        : firstNonEmpty(dotenv[envKey], inherited[envKey]);
    if (value.length > 0) {
      env[envKey] = value;
    }
  }
  return env;
}

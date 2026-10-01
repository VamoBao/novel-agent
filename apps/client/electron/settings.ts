import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * 客户端模型配置（主进程持有，agent 子进程经环境变量注入读取）：
 * VS Code 式**明文 JSON**（用户决策）存于 Electron userData 目录
 * （settings.json，不进仓库、不入 git），两族字段——Agent 会话模型
 * （DeepSeek：Key + 模型名）与写作模型（OpenAI 接口兼容：模型名 + Key +
 * Base URL，三项需同时配置，留空回落 Agent 模型）。
 *
 * 优先级（resolveModelEnv）：设置文件 > 根目录 `.env` > 继承的环境变量；
 * 解析结果仍以 `DEEPSEEK_API_KEY` / `WRITING_MODEL_*` 环境变量注入子进程
 * （childEnv），providers 层（apps/agent）零改动。
 *
 * 本模块刻意不 import electron（app.getPath 由调用方传入），保持可在
 * bun:test 下直接导入测试。
 */

export interface AppSettings {
  /** Agent 会话模型（DeepSeek）：世界观 / 角色 / 大纲 / 章节规划等工作流共用 */
  deepseek: {
    apiKey: string;
    modelName: string;
  };
  /** 写作模型（OpenAI 接口兼容端点）：章节正文生成专用；三项留空回落 deepseek */
  writingModel: {
    modelName: string;
    apiKey: string;
    baseUrl: string;
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  deepseek: { apiKey: "", modelName: "" },
  writingModel: { modelName: "", apiKey: "", baseUrl: "" },
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

/** 还原为合法设置对象：未知字段忽略（前向兼容手工编辑）、非字符串归空串 */
export function normalizeSettings(raw: unknown): AppSettings {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    deepseek: normalizeGroup(source.deepseek, ["apiKey", "modelName"]),
    writingModel: normalizeGroup(source.writingModel, ["modelName", "apiKey", "baseUrl"]),
  };
}

/** 读取设置文件（不存在 / 损坏一律返回全空默认——等价未配置，.env 兜底） */
export function readSettingsFile(filePath: string): AppSettings {
  try {
    return normalizeSettings(JSON.parse(readFileSync(filePath, "utf8")));
  } catch {
    return { deepseek: { ...DEFAULT_SETTINGS.deepseek }, writingModel: { ...DEFAULT_SETTINGS.writingModel } };
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
  ["deepseek.apiKey", "DEEPSEEK_API_KEY"],
  ["deepseek.modelName", "DEEPSEEK_MODEL_NAME"],
  ["writingModel.modelName", "WRITING_MODEL_NAME"],
  ["writingModel.apiKey", "WRITING_MODEL_API_KEY"],
  ["writingModel.baseUrl", "WRITING_MODEL_BASE_URL"],
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
 * 键值表）> 继承的父进程环境变量。返回恰好含五个模型变量的键值表，
 * **空串表示三层均未配置**（调用方须从子进程 env 中删除该键——空串会让
 * provider 侧「未配置」判定与默认值逻辑失真）。
 */
export function resolveModelEnv(
  settings: AppSettings,
  dotenv: Readonly<Record<string, string>>,
  inherited: Readonly<NodeJS.ProcessEnv>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [settingsPath, envKey] of MODEL_ENV_ENTRIES) {
    const [group, field] = settingsPath.split(".") as [
      keyof AppSettings,
      keyof AppSettings[keyof AppSettings],
    ];
    env[envKey] = firstNonEmpty(
      settings[group][field],
      dotenv[envKey],
      inherited[envKey],
    );
  }
  return env;
}

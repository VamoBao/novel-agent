import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAgentModelProvider, resolveWritingModelProvider } from "@novel/shared";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  readSettingsFile,
  resolveEffectiveProviders,
  resolveModelEnv,
  resolveOutputDir,
  resolveWritingEnv,
  writeSettingsFile,
} from "./settings";

/**
 * settings 模块单元测试：字段还原（trim / 非法归空 / 未知字段忽略）、
 * 文件读写往返（损坏文件容错）与三级优先级解析（设置 > .env > 继承环境，
 * 空值逐级下探、全空为空串）。
 */

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe("normalizeSettings", () => {
  test("历史 deepseek 设置迁移；新组存在时不恢复旧值", () => {
    expect(normalizeSettings({ deepseek: { apiKey: " old-key ", modelName: "old-model" } }).agentModel).toEqual({
      provider: "", apiKey: "old-key", modelName: "old-model", baseUrl: "",
    });
    expect(normalizeSettings({
      agentModel: {}, deepseek: { apiKey: "old-key", modelName: "old-model" },
    }).agentModel).toEqual({ provider: "", apiKey: "", modelName: "", baseUrl: "" });
  });
  test("合法对象原样通过（字符串 trim，粘贴的空白无效化）", () => {
    const settings = normalizeSettings({
      agentModel: { apiKey: " sk-abc \n", modelName: " deepseek-v4-pro ", baseUrl: " https://agent.example/v1 " },
      writingModel: { modelName: "qwen3-max", apiKey: "sk-x", baseUrl: " https://api.example.com/v1 " },
    });
    expect(settings.agentModel.apiKey).toBe("sk-abc");
    expect(settings.agentModel.modelName).toBe("deepseek-v4-pro");
    expect(settings.agentModel.baseUrl).toBe("https://agent.example/v1");
    expect(settings.writingModel.baseUrl).toBe("https://api.example.com/v1");
  });

  test("非法输入（null / 非对象 / 非字符串字段 / 未知字段）一律归默认，不抛错", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings("junk")).toEqual(DEFAULT_SETTINGS);
    expect(
      normalizeSettings({ agentModel: { apiKey: 123 }, writingModel: null, extra: "ignored" }),
    ).toEqual(DEFAULT_SETTINGS);
  });
});

describe("normalizeSettings provider（接口类型）", () => {
  test("三合法值透传（两族模型各自独立）", () => {
    for (const provider of ["openai", "deepseek", "claude"] as const) {
      expect(normalizeSettings({ agentModel: { provider } }).agentModel.provider).toBe(provider);
      expect(normalizeSettings({ writingModel: { provider } }).writingModel.provider).toBe(provider);
    }
    const settings = normalizeSettings({
      agentModel: { provider: "deepseek" }, writingModel: { provider: "claude" },
    });
    expect([settings.agentModel.provider, settings.writingModel.provider]).toEqual(["deepseek", "claude"]);
  });

  test("缺省 / 手改非法值归空串——此处不做地址推断（不遮蔽 .env / 继承环境里已配置的值）", () => {
    expect(normalizeSettings({}).agentModel.provider).toBe("");
    expect(normalizeSettings({ agentModel: { baseUrl: "https://api.deepseek.com" } }).agentModel.provider).toBe("");
    for (const invalid of ["OpenAI", "gemini", 123, null]) {
      expect(normalizeSettings({ agentModel: { provider: invalid } }).agentModel.provider).toBe("");
    }
    // 前后空白忽略（手改 settings.json 的常见形态）
    expect(normalizeSettings({ agentModel: { provider: " claude " } }).agentModel.provider).toBe("claude");
    expect(DEFAULT_SETTINGS.agentModel.provider).toBe("");
    expect(DEFAULT_SETTINGS.writingModel.provider).toBe("");
  });

  test("写后读往返保留 provider", () => {
    const dir = mkdtempSync(join(tmpdir(), "novel-settings-provider-"));
    tempDirs.push(dir);
    const filePath = join(dir, "settings.json");
    const saved = writeSettingsFile(filePath, {
      theme: "system",
      agentModel: { provider: "deepseek", apiKey: "sk", modelName: "deepseek-flash", baseUrl: "" },
      writingModel: { provider: "claude", modelName: "claude-sonnet-5", apiKey: "sk-w", baseUrl: "" },
      writing: { chapterLengthMin: null, chapterLengthMax: null, stylePassScore: null },
      outputDir: "",
    });
    expect(readSettingsFile(filePath)).toEqual(saved);
    expect(readSettingsFile(filePath).writingModel.provider).toBe("claude");
  });
});

describe("settings 文件读写", () => {
  test("写后读往返一致；文件为人类可读 JSON；目录不存在时自动创建", () => {
    const dir = mkdtempSync(join(tmpdir(), "novel-settings-"));
    tempDirs.push(dir);
    const filePath = join(dir, "nested", "settings.json");

    const saved = writeSettingsFile(filePath, {
      theme: "system",
      agentModel: { provider: "", apiKey: " sk-main ", modelName: "", baseUrl: "" },
      writingModel: { provider: "", modelName: "m", apiKey: "k", baseUrl: "https://x/v1" },
      writing: { chapterLengthMin: null, chapterLengthMax: null, stylePassScore: null },
      outputDir: "",
    });
    expect(saved.agentModel.apiKey).toBe("sk-main");
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, "utf8")).toContain("\"apiKey\": \"sk-main\"");
    expect(readSettingsFile(filePath)).toEqual(saved);
  });

  test("文件缺失 / JSON 损坏：返回全空默认（等价未配置，.env 兜底）", () => {
    const dir = mkdtempSync(join(tmpdir(), "novel-settings-"));
    tempDirs.push(dir);
    expect(readSettingsFile(join(dir, "absent.json"))).toEqual(DEFAULT_SETTINGS);
    const corrupt = join(dir, "corrupt.json");
    writeFileSync(corrupt, "{ not json");
    expect(readSettingsFile(corrupt)).toEqual(DEFAULT_SETTINGS);
  });
});

describe("resolveModelEnv 三级优先级", () => {
  test("同来源通用变量优先；高优先级旧变量胜过低优先级通用变量", () => {
    const env = resolveModelEnv(DEFAULT_SETTINGS, {
      AGENT_MODEL_API_KEY: " new-dotenv ", DEEPSEEK_API_KEY: "old-dotenv",
      DEEPSEEK_MODEL_NAME: "legacy-dotenv", AGENT_MODEL_BASE_URL: " https://dotenv/v1 ",
    }, {
      AGENT_MODEL_API_KEY: "inherited", AGENT_MODEL_NAME: "new-inherited",
      AGENT_MODEL_BASE_URL: "https://inherited/v1",
    });
    expect(env.AGENT_MODEL_API_KEY).toBe("new-dotenv");
    expect(env.AGENT_MODEL_NAME).toBe("legacy-dotenv");
    expect(env.AGENT_MODEL_BASE_URL).toBe("https://dotenv/v1");
    expect(Object.keys(env)).toHaveLength(8);
  });

  test("设置 Base URL 优先，空白继续向下查找", () => {
    const settings = normalizeSettings({ agentModel: { baseUrl: " https://settings/v1 " } });
    const env = resolveModelEnv(settings, {
      AGENT_MODEL_API_KEY: " ", DEEPSEEK_API_KEY: " legacy-key ",
      AGENT_MODEL_BASE_URL: "https://dotenv/v1",
    }, {});
    expect(env.AGENT_MODEL_BASE_URL).toBe("https://settings/v1");
    expect(env.AGENT_MODEL_API_KEY).toBe("legacy-key");
  });
  test("设置文件 > .env > 继承环境变量；上层为空串时逐级下探", () => {
    const env = resolveModelEnv(
      {
        theme: "system",
        agentModel: { provider: "", apiKey: "sk-settings", modelName: "", baseUrl: "" },
        writingModel: { provider: "", modelName: "", apiKey: "", baseUrl: "" },
        writing: { chapterLengthMin: null, chapterLengthMax: null, stylePassScore: null },
        outputDir: "",
      },
      { DEEPSEEK_API_KEY: "sk-dotenv", DEEPSEEK_MODEL_NAME: "from-dotenv", WRITING_MODEL_NAME: "wm-dotenv" },
      { DEEPSEEK_API_KEY: "sk-inherited", WRITING_MODEL_NAME: "wm-inherited", WRITING_MODEL_API_KEY: "wm-key-inherited" },
    );
    // 设置非空 → 胜出
    expect(env.AGENT_MODEL_API_KEY).toBe("sk-settings");
    // 设置空 → .env 胜出
    expect(env.AGENT_MODEL_NAME).toBe("from-dotenv");
    // 设置与 .env 均空 → 继承环境变量
    expect(env.WRITING_MODEL_API_KEY).toBe("wm-key-inherited");
    // 三层均未配置 → 空串（调用方删除该键）
    expect(env.WRITING_MODEL_BASE_URL).toBe("");
  });

  test("空串候选视为未配置（.env 里的空行不遮蔽继承值）", () => {
    const env = resolveModelEnv(
      DEFAULT_SETTINGS,
      { DEEPSEEK_API_KEY: "", WRITING_MODEL_NAME: "  " },
      { DEEPSEEK_API_KEY: "sk-inherited" },
    );
    expect(env.AGENT_MODEL_API_KEY).toBe("sk-inherited");
    expect(env.WRITING_MODEL_NAME).toBe("");
  });
});

describe("resolveModelEnv provider 三级优先级与旧配置迁移", () => {
  test("provider 同款逐层下探：设置 > .env > 继承环境变量", () => {
    const settings = normalizeSettings({
      agentModel: { provider: "claude" }, writingModel: { provider: "deepseek" },
    });
    const env = resolveModelEnv(settings, {
      AGENT_MODEL_PROVIDER: "openai", WRITING_MODEL_PROVIDER: "claude",
    }, { AGENT_MODEL_PROVIDER: "deepseek" });
    // 设置非空胜出（两族模型互不影响）
    expect(env.AGENT_MODEL_PROVIDER).toBe("claude");
    expect(env.WRITING_MODEL_PROVIDER).toBe("deepseek");
  });

  test("没有显式 provider 的来源不遮蔽下一层已配置的值", () => {
    const env = resolveModelEnv(DEFAULT_SETTINGS, { WRITING_MODEL_PROVIDER: "openai" }, {
      AGENT_MODEL_PROVIDER: "deepseek",
    });
    expect(env.AGENT_MODEL_PROVIDER).toBe("deepseek");
    expect(env.WRITING_MODEL_PROVIDER).toBe("openai");
    // 三层均未配置 → 空串（调用方删除该键，由 agent 侧按有效地址迁移）
    expect(resolveModelEnv(DEFAULT_SETTINGS, {}, {}).AGENT_MODEL_PROVIDER).toBe("");
  });

  test("旧配置迁移链路：注入空 provider，agent 侧按最终生效地址解析出接口类型", () => {
    // 历史 settings.json（无 provider，DeepSeek 官方地址）→ DeepSeek
    const legacy = normalizeSettings({
      agentModel: { apiKey: "sk", modelName: "deepseek-flash", baseUrl: "https://api.deepseek.com" },
    });
    const legacyEnv = resolveModelEnv(legacy, {}, {});
    expect(legacyEnv.AGENT_MODEL_PROVIDER).toBe("");
    expect(resolveAgentModelProvider(legacyEnv.AGENT_MODEL_PROVIDER, legacyEnv.AGENT_MODEL_BASE_URL ?? ""))
      .toBe("deepseek");

    // 历史 OpenAI 兼容代理地址 → OpenAI
    const proxy = normalizeSettings({ agentModel: { baseUrl: "https://api.example.com/v1" } });
    const proxyEnv = resolveModelEnv(proxy, {}, {});
    expect(resolveAgentModelProvider(proxyEnv.AGENT_MODEL_PROVIDER, proxyEnv.AGENT_MODEL_BASE_URL ?? ""))
      .toBe("openai");

    // 历史写作配置：官方地址 → DeepSeek；自定义地址 → OpenAI（独立写作默认）
    const writing = normalizeSettings({
      writingModel: { modelName: "m", apiKey: "sk", baseUrl: "https://api.deepseek.com" },
    });
    const writingEnv = resolveModelEnv(writing, {}, {});
    expect(resolveWritingModelProvider(writingEnv.WRITING_MODEL_PROVIDER, writingEnv.WRITING_MODEL_BASE_URL ?? ""))
      .toBe("deepseek");
    expect(resolveWritingModelProvider("", "https://api.example.com/v1")).toBe("openai");
  });
});

describe("resolveEffectiveProviders（设置弹窗回显生效接口类型）", () => {
  test("设置文件显式值胜出；留空时由 .env / 继承环境变量按地址迁移决定", () => {
    // 设置文件显式 claude → 胜出（即使 .env 说 openai）
    const explicit = normalizeSettings({ agentModel: { provider: "claude" } });
    expect(resolveEffectiveProviders(explicit, { AGENT_MODEL_PROVIDER: "openai" }, {}).agent).toBe("claude");

    // 设置文件留空 → .env 生效（这是「弹窗回显真实生效值」的关键路径）
    expect(resolveEffectiveProviders(DEFAULT_SETTINGS, {
      AGENT_MODEL_PROVIDER: "claude", AGENT_MODEL_BASE_URL: "https://api.anthropic.com/v1",
    }, {}).agent).toBe("claude");

    // 三层均无 provider → 按最终生效地址迁移（Agent 空地址 → DeepSeek 官方默认）
    expect(resolveEffectiveProviders(DEFAULT_SETTINGS, {}, {}).agent).toBe("deepseek");
    expect(resolveEffectiveProviders(DEFAULT_SETTINGS, {}, {
      AGENT_MODEL_BASE_URL: "https://api.example.com/v1",
    }).agent).toBe("openai");
  });

  test("写作模型独立解析：未配置 → OpenAI，官方地址 → DeepSeek，显式值优先", () => {
    expect(resolveEffectiveProviders(DEFAULT_SETTINGS, {}, {}).writing).toBe("openai");
    expect(resolveEffectiveProviders(DEFAULT_SETTINGS, {
      WRITING_MODEL_BASE_URL: "https://api.deepseek.com/v1",
    }, {}).writing).toBe("deepseek");
    expect(resolveEffectiveProviders(normalizeSettings({
      writingModel: { provider: "claude" },
    }), {}, {}).writing).toBe("claude");
  });
});

describe("normalizeSettings theme", () => {
  test("缺省 / 非法值归 system（旧 settings.json 前向兼容、手改文件容错）", () => {
    expect(normalizeSettings(null).theme).toBe("system");
    expect(normalizeSettings({}).theme).toBe("system");
    expect(normalizeSettings({ theme: "blue" }).theme).toBe("system");
    expect(normalizeSettings({ theme: 123 }).theme).toBe("system");
  });

  test("三个合法值透传", () => {
    expect(normalizeSettings({ theme: "system" }).theme).toBe("system");
    expect(normalizeSettings({ theme: "light" }).theme).toBe("light");
    expect(normalizeSettings({ theme: "dark" }).theme).toBe("dark");
  });

  test("写后读往返保留 theme", () => {
    const dir = mkdtempSync(join(tmpdir(), "novel-settings-"));
    tempDirs.push(dir);
    const filePath = join(dir, "settings.json");
    writeSettingsFile(filePath, {
      theme: "dark",
      agentModel: { provider: "", apiKey: "", modelName: "", baseUrl: "" },
      writingModel: { provider: "", modelName: "", apiKey: "", baseUrl: "" },
      writing: { chapterLengthMin: null, chapterLengthMax: null, stylePassScore: null },
      outputDir: "",
    });
    expect(readSettingsFile(filePath).theme).toBe("dark");
  });
});

describe("normalizeSettings writing（写作偏好系统级默认）", () => {
  test("合法值透传；缺省 / 非法值（非数字 / 越界）逐字段归 null", () => {
    expect(
      normalizeSettings({ writing: { chapterLengthMin: 3000, chapterLengthMax: 4500, stylePassScore: 85 } }).writing,
    ).toEqual({ chapterLengthMin: 3000, chapterLengthMax: 4500, stylePassScore: 85 });
    expect(normalizeSettings(null).writing).toEqual({ chapterLengthMin: null, chapterLengthMax: null, stylePassScore: null });
    expect(
      normalizeSettings({ writing: { chapterLengthMin: "3000", chapterLengthMax: 999999, stylePassScore: 101 } }).writing,
    ).toEqual({ chapterLengthMin: null, chapterLengthMax: null, stylePassScore: null });
    // 半设形态原样保留（成对与否交给 agent 侧解析层的防御性规则）
    expect(normalizeSettings({ writing: { chapterLengthMin: 3000 } }).writing).toEqual({
      chapterLengthMin: 3000,
      chapterLengthMax: null,
      stylePassScore: null,
    });
  });

  test("写后读往返保留写作偏好", () => {
    const dir = mkdtempSync(join(tmpdir(), "novel-settings-writing-"));
    tempDirs.push(dir);
    const filePath = join(dir, "settings.json");
    const saved = writeSettingsFile(filePath, {
      theme: "system",
      agentModel: { provider: "", apiKey: "", modelName: "", baseUrl: "" },
      writingModel: { provider: "", modelName: "", apiKey: "", baseUrl: "" },
      writing: { chapterLengthMin: 2500, chapterLengthMax: 4000, stylePassScore: 90 },
      outputDir: "",
    });
    expect(saved.writing).toEqual({ chapterLengthMin: 2500, chapterLengthMax: 4000, stylePassScore: 90 });
    expect(readSettingsFile(filePath).writing).toEqual(saved.writing);
  });
});

describe("resolveWritingEnv 三级优先级", () => {
  test("设置文件 > .env > 继承环境变量；设置 null 时向下下探；全空不输出键", () => {
    const settings = normalizeSettings({ writing: { chapterLengthMin: 3000, stylePassScore: 85 } });
    const env = resolveWritingEnv(settings, {
      NOVEL_CHAPTER_LENGTH_MIN: "1500",
      NOVEL_CHAPTER_LENGTH_MAX: "2500",
    }, {
      NOVEL_CHAPTER_LENGTH_MAX: "1800",
      NOVEL_STYLE_PASS_SCORE: "60",
    });
    // 设置非空胜出（下限 / 合格线）；设置 null → .env 胜出（上限，压过继承的 1800）
    expect(env).toEqual({
      NOVEL_CHAPTER_LENGTH_MIN: "3000",
      NOVEL_CHAPTER_LENGTH_MAX: "2500",
      NOVEL_STYLE_PASS_SCORE: "85",
    });

    const allEmpty = resolveWritingEnv(
      { ...DEFAULT_SETTINGS, writing: { chapterLengthMin: null, chapterLengthMax: null, stylePassScore: null } },
      {},
      {},
    );
    expect(Object.keys(allEmpty)).toHaveLength(0);
  });
});

describe("resolveOutputDir 三级优先级", () => {
  test("设置 > .env > 继承环境变量 > 场景默认；空白逐层下探；normalize 非法值归空串", () => {
    const withDir = normalizeSettings({ outputDir: " /custom/output " });
    expect(withDir.outputDir).toBe("/custom/output");
    expect(
      resolveOutputDir(withDir, { NOVEL_OUTPUT_DIR: "/dotenv-output" }, { NOVEL_OUTPUT_DIR: "/inherited-output" }, "/default/output"),
    ).toBe("/custom/output");
    expect(
      resolveOutputDir(DEFAULT_SETTINGS, { NOVEL_OUTPUT_DIR: " /dotenv-output " }, { NOVEL_OUTPUT_DIR: "/inherited-output" }, "/default/output"),
    ).toBe("/dotenv-output");
    expect(
      resolveOutputDir(DEFAULT_SETTINGS, { NOVEL_OUTPUT_DIR: " " }, { NOVEL_OUTPUT_DIR: "/inherited-output" }, "/default/output"),
    ).toBe("/inherited-output");
    // 三层全未配置：永远有生效值，回落调用方场景默认（打包 userData/output、开发仓库 output/）
    expect(resolveOutputDir(DEFAULT_SETTINGS, {}, {}, "/default/output")).toBe("/default/output");
    // 手改 settings.json 写错类型（非字符串）归空串 = 未设置
    expect(normalizeSettings({ outputDir: 123 }).outputDir).toBe("");
  });
});

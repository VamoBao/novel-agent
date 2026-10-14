import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  readSettingsFile,
  resolveModelEnv,
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
      apiKey: "old-key", modelName: "old-model", baseUrl: "",
    });
    expect(normalizeSettings({
      agentModel: {}, deepseek: { apiKey: "old-key", modelName: "old-model" },
    }).agentModel).toEqual({ apiKey: "", modelName: "", baseUrl: "" });
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

describe("settings 文件读写", () => {
  test("写后读往返一致；文件为人类可读 JSON；目录不存在时自动创建", () => {
    const dir = mkdtempSync(join(tmpdir(), "novel-settings-"));
    tempDirs.push(dir);
    const filePath = join(dir, "nested", "settings.json");

    const saved = writeSettingsFile(filePath, {
      theme: "system",
      agentModel: { apiKey: " sk-main ", modelName: "", baseUrl: "" },
      writingModel: { modelName: "m", apiKey: "k", baseUrl: "https://x/v1" },
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
    expect(Object.keys(env)).toHaveLength(6);
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
        agentModel: { apiKey: "sk-settings", modelName: "", baseUrl: "" },
        writingModel: { modelName: "", apiKey: "", baseUrl: "" },
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
      agentModel: { apiKey: "", modelName: "", baseUrl: "" },
      writingModel: { modelName: "", apiKey: "", baseUrl: "" },
    });
    expect(readSettingsFile(filePath).theme).toBe("dark");
  });
});

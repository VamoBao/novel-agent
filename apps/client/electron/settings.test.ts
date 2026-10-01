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
  test("合法对象原样通过（字符串 trim，粘贴的空白无效化）", () => {
    const settings = normalizeSettings({
      deepseek: { apiKey: " sk-abc \n", modelName: " deepseek-v4-pro " },
      writingModel: { modelName: "qwen3-max", apiKey: "sk-x", baseUrl: " https://api.example.com/v1 " },
    });
    expect(settings.deepseek.apiKey).toBe("sk-abc");
    expect(settings.deepseek.modelName).toBe("deepseek-v4-pro");
    expect(settings.writingModel.baseUrl).toBe("https://api.example.com/v1");
  });

  test("非法输入（null / 非对象 / 非字符串字段 / 未知字段）一律归默认，不抛错", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings("junk")).toEqual(DEFAULT_SETTINGS);
    expect(
      normalizeSettings({ deepseek: { apiKey: 123 }, writingModel: null, extra: "ignored" }),
    ).toEqual(DEFAULT_SETTINGS);
  });
});

describe("settings 文件读写", () => {
  test("写后读往返一致；文件为人类可读 JSON；目录不存在时自动创建", () => {
    const dir = mkdtempSync(join(tmpdir(), "novel-settings-"));
    tempDirs.push(dir);
    const filePath = join(dir, "nested", "settings.json");

    const saved = writeSettingsFile(filePath, {
      deepseek: { apiKey: " sk-main ", modelName: "" },
      writingModel: { modelName: "m", apiKey: "k", baseUrl: "https://x/v1" },
    });
    expect(saved.deepseek.apiKey).toBe("sk-main");
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
  test("设置文件 > .env > 继承环境变量；上层为空串时逐级下探", () => {
    const env = resolveModelEnv(
      {
        deepseek: { apiKey: "sk-settings", modelName: "" },
        writingModel: { modelName: "", apiKey: "", baseUrl: "" },
      },
      { DEEPSEEK_API_KEY: "sk-dotenv", DEEPSEEK_MODEL_NAME: "from-dotenv", WRITING_MODEL_NAME: "wm-dotenv" },
      { DEEPSEEK_API_KEY: "sk-inherited", WRITING_MODEL_NAME: "wm-inherited", WRITING_MODEL_API_KEY: "wm-key-inherited" },
    );
    // 设置非空 → 胜出
    expect(env.DEEPSEEK_API_KEY).toBe("sk-settings");
    // 设置空 → .env 胜出
    expect(env.DEEPSEEK_MODEL_NAME).toBe("from-dotenv");
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
    expect(env.DEEPSEEK_API_KEY).toBe("sk-inherited");
    expect(env.WRITING_MODEL_NAME).toBe("");
  });
});

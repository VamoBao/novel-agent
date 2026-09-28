import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getWritingModel } from "./writing-model";

const ENV_KEYS = [
  "WRITING_MODEL_NAME",
  "WRITING_MODEL_API_KEY",
  "WRITING_MODEL_BASE_URL",
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("getWritingModel", () => {
  test("三项环境变量均未配置时抛可读错误，指明全部缺失变量", () => {
    expect(() => getWritingModel()).toThrow(
      "缺少环境变量 WRITING_MODEL_NAME、WRITING_MODEL_API_KEY、WRITING_MODEL_BASE_URL",
    );
  });

  test("部分缺失时仅提示缺失的变量（空串视为未配置）", () => {
    process.env.WRITING_MODEL_NAME = "test-writing-model";
    process.env.WRITING_MODEL_API_KEY = "";
    expect(() => getWritingModel()).toThrow(
      "缺少环境变量 WRITING_MODEL_API_KEY、WRITING_MODEL_BASE_URL",
    );
  });

  test("三项配置齐全时返回 LanguageModelV4 实例（v4 规格、模型名透传、生成入口可用）", () => {
    process.env.WRITING_MODEL_NAME = "test-writing-model";
    process.env.WRITING_MODEL_API_KEY = "sk-test";
    process.env.WRITING_MODEL_BASE_URL = "https://api.example.com/v1";
    const model = getWritingModel();
    expect(model.specificationVersion).toBe("v4");
    expect(model.modelId).toBe("test-writing-model");
    expect(typeof model.doGenerate).toBe("function");
    expect(typeof model.doStream).toBe("function");
  });

  test("可重复调用，每次返回可用实例（无模块级缓存副作用）", () => {
    process.env.WRITING_MODEL_NAME = "test-writing-model";
    process.env.WRITING_MODEL_API_KEY = "sk-test";
    process.env.WRITING_MODEL_BASE_URL = "https://api.example.com/v1";
    expect(getWritingModel().modelId).toBe("test-writing-model");
    expect(getWritingModel().modelId).toBe("test-writing-model");
  });
});

import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { resolveAgentModelConfig } from "./agent-model";

describe("Agent 模型配置", () => {
  test("未配置时允许导入，并保留默认模型和端点", () => {
    expect(resolveAgentModelConfig({})).toEqual({
      apiKey: "", modelName: "deepseek-flash", baseUrl: "https://api.deepseek.com",
    });
  });

  test("兼容旧变量并 trim；通用变量优先", () => {
    expect(resolveAgentModelConfig({ DEEPSEEK_API_KEY: " old-key ", DEEPSEEK_MODEL_NAME: " old-model " })).toEqual({
      apiKey: "old-key", modelName: "old-model", baseUrl: "https://api.deepseek.com",
    });
    expect(resolveAgentModelConfig({
      AGENT_MODEL_API_KEY: " new-key ", AGENT_MODEL_NAME: " new-model ",
      AGENT_MODEL_BASE_URL: " https://example.com/v1/ ",
      DEEPSEEK_API_KEY: "old-key", DEEPSEEK_MODEL_NAME: "old-model",
    })).toEqual({ apiKey: "new-key", modelName: "new-model", baseUrl: "https://example.com/v1/" });
  });

  test("空串和纯空白视为未配置，旧变量及默认值兜底", () => {
    expect(resolveAgentModelConfig({
      AGENT_MODEL_API_KEY: " ", AGENT_MODEL_NAME: "", AGENT_MODEL_BASE_URL: " ",
      DEEPSEEK_API_KEY: " legacy ", DEEPSEEK_MODEL_NAME: " ",
    })).toEqual({ apiKey: "legacy", modelName: "deepseek-flash", baseUrl: "https://api.deepseek.com" });
  });
});

test.each(["index.ts", "headless.ts"])("%s 无 Agent Key 时拒绝启动并引导通用配置", async (entry) => {
  const proc = Bun.spawn([process.execPath, fileURLToPath(new URL("../" + entry, import.meta.url))], {
    env: { ...process.env, AGENT_MODEL_API_KEY: " ", DEEPSEEK_API_KEY: "" },
    stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  const [stderr, exit] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  expect(exit).toBe(1);
  expect(stderr).toContain("未设置 AGENT_MODEL_API_KEY");
});

test.each(["AGENT_MODEL_API_KEY", "DEEPSEEK_API_KEY"])("headless 使用 %s 通过检查进入会话", async (key) => {
  const proc = Bun.spawn([
    process.execPath, fileURLToPath(new URL("../headless.ts", import.meta.url)),
    "write-chapter", "missing-novel", "missing-chapter",
  ], {
    // 启动检查不依赖磁盘持久化，内存库避免 fsync 的环境波动。
    env: {
      ...process.env, NOVEL_DB_PATH: ":memory:", NOVEL_OUTPUT_DIR: tmpdir(),
      AGENT_MODEL_API_KEY: "", DEEPSEEK_API_KEY: "", [key]: "test-key",
      AGENT_MODEL_NAME: "custom-agent", AGENT_MODEL_BASE_URL: "https://example.com/v1",
    }, stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  try {
    const [stdout, stderr, exit] = await Promise.all([
      new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
    ]);
    // 使用不存在的小说触发业务前置校验，不发起任何模型请求。
    expect(exit).toBe(1);
    expect(stderr).toBe("");
    const messages = stdout.trim().split("\n").map((line) => JSON.parse(line) as { type: string; message?: string });
    expect(messages[0]!.type).toBe("hello");
    expect(messages.at(-1)!.type).toBe("error");
    expect(messages.at(-1)!.message).toContain("小说不存在");
  } finally {
    if (proc.exitCode === null) proc.kill();
  }
});

test("真实 SDK 按 Agent 配置发送文本、工具与 JSON 请求，写作回落共用实例", async () => {
  // 独立进程避免工作流测试 mock.module('ai') 影响真实 SDK 协议验证。
  const probe = `
    import { generateText, generateObject, tool } from 'ai';
    import { z } from 'zod';
    import { model } from './src/providers/agent-model';
    import { getWritingModel } from './src/providers/writing-model';
    // 通用端点使用 json_object；schema 由 SDK 在响应后校验，预期兼容性警告不输出。
    globalThis.AI_SDK_LOG_WARNINGS = false;
    const requests = [];
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(init.body);
      requests.push({ url: String(url), auth: new Headers(init.headers).get('authorization'), body });
      const tools = body.tools?.length > 0;
      const json = body.response_format?.type === 'json_object';
      return Response.json({
        id: 'completion-test', object: 'chat.completion', created: 1, model: 'custom-agent',
        choices: [{ index: 0, finish_reason: tools ? 'tool_calls' : 'stop', message: {
          role: 'assistant', content: tools ? null : json ? '{"name":"林恒"}' : '你好',
          ...(tools ? { tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{"name":"林恒"}' } }] } : {}),
        } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    };
    const text = await generateText({ model, prompt: '问候' });
    const tools = await generateText({ model, prompt: '查角色', tools: {
      lookup: tool({ description: '查角色', inputSchema: z.object({ name: z.string() }) }),
    } });
    const json = await generateObject({ model, schema: z.object({ name: z.string() }), prompt: '角色名字' });
    process.stdout.write(JSON.stringify({ requests, text: text.text, call: tools.toolCalls[0], object: json.object, fallback: getWritingModel() === model }));
  `;
  const proc = Bun.spawn([process.execPath, "--eval", probe], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    env: {
      ...process.env,
      AGENT_MODEL_API_KEY: " probe-key ", AGENT_MODEL_NAME: " custom-agent ",
      AGENT_MODEL_BASE_URL: " https://example.com/v1/ ",
      WRITING_MODEL_API_KEY: "", WRITING_MODEL_NAME: "", WRITING_MODEL_BASE_URL: "",
    }, stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
  ]);
  expect(stderr).toBe("");
  expect(exit).toBe(0);
  const result = JSON.parse(stdout) as {
    requests: Array<{ url: string; auth: string; body: { model: string; tools?: unknown[]; response_format?: { type: string } } }>;
    text: string; call: { toolName: string; input: unknown }; object: unknown; fallback: boolean;
  };
  expect(result.requests).toHaveLength(3);
  for (const request of result.requests) {
    expect(request.url).toBe("https://example.com/v1/chat/completions");
    expect(request.auth).toBe("Bearer probe-key");
    expect(request.body.model).toBe("custom-agent");
  }
  expect(result.text).toBe("你好");
  expect(result.call.toolName).toBe("lookup");
  expect(result.call.input).toEqual({ name: "林恒" });
  expect(result.requests[2]!.body.response_format?.type).toBe("json_object");
  expect(result.object).toEqual({ name: "林恒" });
  expect(result.fallback).toBe(true);
});

import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import {
  DEFAULT_DEEPSEEK_MODEL_NAME,
  describeAgentModelConfigError,
  resolveAgentModelConfig,
} from "./agent-model";

describe("Agent 模型配置", () => {
  test("未配置时允许导入，并保留默认 provider、模型和端点", () => {
    expect(resolveAgentModelConfig({})).toEqual({
      provider: "deepseek",
      apiKey: "",
      modelName: DEFAULT_DEEPSEEK_MODEL_NAME,
      baseUrl: "https://api.deepseek.com",
    });
  });

  test("兼容旧变量并 trim；通用变量优先", () => {
    expect(resolveAgentModelConfig({ DEEPSEEK_API_KEY: " old-key ", DEEPSEEK_MODEL_NAME: " old-model " })).toEqual({
      provider: "deepseek", apiKey: "old-key", modelName: "old-model", baseUrl: "https://api.deepseek.com",
    });
    expect(resolveAgentModelConfig({
      AGENT_MODEL_API_KEY: " new-key ", AGENT_MODEL_NAME: " new-model ",
      AGENT_MODEL_BASE_URL: " https://example.com/v1/ ",
      DEEPSEEK_API_KEY: "old-key", DEEPSEEK_MODEL_NAME: "old-model",
    })).toEqual({
      provider: "openai", apiKey: "new-key", modelName: "new-model", baseUrl: "https://example.com/v1/",
    });
  });

  test("空串和纯空白视为未配置，旧变量及默认值兜底", () => {
    expect(resolveAgentModelConfig({
      AGENT_MODEL_API_KEY: " ", AGENT_MODEL_NAME: "", AGENT_MODEL_BASE_URL: " ",
      DEEPSEEK_API_KEY: " legacy ", DEEPSEEK_MODEL_NAME: " ",
    })).toEqual({
      provider: "deepseek", apiKey: "legacy", modelName: DEFAULT_DEEPSEEK_MODEL_NAME, baseUrl: "https://api.deepseek.com",
    });
  });
});

describe("provider 选择与历史配置迁移", () => {
  test("显式 provider 优先；Base URL 留空取该 provider 官方默认地址", () => {
    expect(resolveAgentModelConfig({ AGENT_MODEL_PROVIDER: "claude", AGENT_MODEL_NAME: "claude-sonnet-5" })).toEqual({
      provider: "claude", apiKey: "", modelName: "claude-sonnet-5", baseUrl: "https://api.anthropic.com/v1",
    });
    expect(resolveAgentModelConfig({ AGENT_MODEL_PROVIDER: "openai", AGENT_MODEL_NAME: "gpt-5.2" }).baseUrl)
      .toBe("https://api.openai.com/v1");
    // DeepSeek 保留原有默认模型名
    expect(resolveAgentModelConfig({ AGENT_MODEL_PROVIDER: "deepseek" }).modelName).toBe(DEFAULT_DEEPSEEK_MODEL_NAME);
  });

  test("无 provider 的历史配置按有效地址迁移（官方地址含 /v1 与尾斜杠写法）", () => {
    for (const baseUrl of [
      "https://api.deepseek.com",
      "https://api.deepseek.com/v1",
      "https://api.deepseek.com/",
      "https://api.deepseek.com/beta",
    ]) {
      expect(resolveAgentModelConfig({ AGENT_MODEL_BASE_URL: baseUrl }).provider).toBe("deepseek");
    }
    for (const baseUrl of ["https://api.example.com/v1", "https://api.openai.com/v1"]) {
      expect(resolveAgentModelConfig({ AGENT_MODEL_BASE_URL: baseUrl }).provider).toBe("openai");
    }
  });

  test("非 DeepSeek 接口类型无默认模型名；非法 provider 值不静默采用（由启动检查报错）", () => {
    expect(resolveAgentModelConfig({ AGENT_MODEL_PROVIDER: "openai" }).modelName).toBe("");
    expect(resolveAgentModelConfig({ AGENT_MODEL_PROVIDER: "claude" }).modelName).toBe("");
    expect(resolveAgentModelConfig({ AGENT_MODEL_PROVIDER: "claud" }).provider).toBe("deepseek");
  });

  test("provider 前后空白忽略（.env 粘贴形态），显式值不与地址迁移打架", () => {
    expect(resolveAgentModelConfig({
      AGENT_MODEL_PROVIDER: " claude ", AGENT_MODEL_BASE_URL: "https://api.openai.com/v1",
    })).toEqual({
      provider: "claude", apiKey: "", modelName: "", baseUrl: "https://api.openai.com/v1",
    });
    expect(describeAgentModelConfigError({
      AGENT_MODEL_PROVIDER: " claude ", AGENT_MODEL_NAME: "claude-sonnet-5",
    })).toBeNull();
  });
});

describe("describeAgentModelConfigError（入口启动检查）", () => {
  test("默认配置与三种合法 provider 配齐模型名均可用", () => {
    expect(describeAgentModelConfigError({})).toBeNull();
    expect(describeAgentModelConfigError({ AGENT_MODEL_PROVIDER: "deepseek" })).toBeNull();
    expect(describeAgentModelConfigError({ AGENT_MODEL_PROVIDER: "openai", AGENT_MODEL_NAME: "gpt-5.2" })).toBeNull();
    expect(describeAgentModelConfigError({ AGENT_MODEL_PROVIDER: "claude", AGENT_MODEL_NAME: "claude-sonnet-5" })).toBeNull();
  });

  test("非法 provider 值给出清晰错误与可选值", () => {
    const message = describeAgentModelConfigError({ AGENT_MODEL_PROVIDER: "openAI" });
    expect(message).toContain("AGENT_MODEL_PROVIDER 配置无效：openAI");
    expect(message).toContain("openai / deepseek / claude");
  });

  test("非 DeepSeek 接口类型缺模型名提前拦住", () => {
    expect(describeAgentModelConfigError({ AGENT_MODEL_PROVIDER: "openai" })).toContain("AGENT_MODEL_NAME");
    expect(describeAgentModelConfigError({ AGENT_MODEL_PROVIDER: "claude" })).toContain("AGENT_MODEL_NAME");
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

test("非法 AGENT_MODEL_PROVIDER 在入口启动检查即报错退出（不静默走错协议）", async () => {
  const proc = Bun.spawn([process.execPath, fileURLToPath(new URL("../headless.ts", import.meta.url))], {
    env: { ...process.env, AGENT_MODEL_API_KEY: "test-key", AGENT_MODEL_PROVIDER: "openAI" },
    stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  const [stderr, exit] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  expect(exit).toBe(1);
  expect(stderr).toContain("AGENT_MODEL_PROVIDER 配置无效：openAI");
  expect(stderr).toContain("openai / deepseek / claude");
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

/**
 * 真实 SDK 协议回归（独立进程避免工作流测试 mock.module('ai') 干扰）：
 * 模拟服务端按各家真实约束应答——DeepSeek 的 json_object 请求要求 prompt 含
 * json 字样（缺则 400，可复现用户报错），因此结构化输出必须由专用 provider 注入
 * JSON 指令，而不是靠各业务 prompt 打补丁。
 */
test("三种官方 provider 的地址、鉴权、文本、工具与结构化输出符合各自协议", async () => {
  const probe = `
    import { generateText, generateObject, tool } from 'ai';
    import { z } from 'zod';
    import { createAgentModel, model as agentModel } from './src/providers/agent-model';
    import { getWritingModel } from './src/providers/writing-model';
    globalThis.AI_SDK_LOG_WARNINGS = false;

    const requests = [];
    const chatCompletion = (body) => {
      const names = (body.tools ?? []).map((t) => t.function?.name ?? t.name);
      const called = names.find((name) => name === 'lookup') ?? names[0];
      const json = body.response_format != null || body.output_config?.format != null;
      return {
        id: 'completion-test', object: 'chat.completion', created: 1, model: body.model,
        choices: [{ index: 0, finish_reason: called ? 'tool_calls' : 'stop', message: {
          role: 'assistant',
          content: called ? null : json ? '{"name":"林恒"}' : '你好',
          ...(called ? { tool_calls: [{ id: 'call-1', type: 'function', function: { name: called, arguments: '{"name":"林恒"}' } }] } : {}),
        } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      };
    };
    const anthropicMessage = (body) => {
      const names = (body.tools ?? []).map((t) => t.name);
      const called = names.find((name) => name === 'lookup') ?? names[0];
      const json = body.output_config?.format != null;
      return {
        id: 'msg-test', type: 'message', role: 'assistant', model: body.model, stop_sequence: null,
        content: called
          ? [{ type: 'tool_use', id: 'toolu-1', name: called, input: { name: '林恒' } }]
          : [{ type: 'text', text: json ? '{"name":"林恒"}' : '你好' }],
        stop_reason: called ? 'tool_use' : 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      };
    };
    // 模拟服务端约束：不满足各家协议要求的请求一律 400（200 + 结构化对象才证明适配成功）
    const rejected = [];
    const reject = (vendor, reason) => {
      rejected.push(vendor + ': ' + reason);
      return Response.json({ error: { message: reason } }, { status: 400 });
    };
    globalThis.fetch = async (url, init) => {
      const target = String(url);
      const headers = new Headers(init.headers);
      const body = JSON.parse(init.body);
      const authorization = headers.get('authorization');
      const apiKey = headers.get('x-api-key');
      requests.push({
        url: target, authorization, apiKey,
        anthropicVersion: headers.get('anthropic-version'), body,
      });
      const messages = body.messages ?? [];
      if (!body.model || messages.length === 0) return reject('all', 'model 与 messages 必填');
      if (target.startsWith('https://api.deepseek.com')) {
        // DeepSeek：Bearer 鉴权；json_object 请求的 prompt 必须含 json 字样（缺则 400）
        if (authorization !== 'Bearer ds-key') return reject('deepseek', '缺少 Bearer 鉴权');
        if (body.response_format?.type === 'json_object' && !/json/i.test(JSON.stringify(messages))) {
          return reject('deepseek', 'Prompt must contain the word "json"');
        }
        return Response.json(chatCompletion(body));
      }
      if (target.endsWith('/messages')) {
        // Anthropic Messages：x-api-key + anthropic-version 鉴权头、max_tokens 必填、
        // system 为顶层字段（不得出现在 messages 里）、结构化输出经 output_config.format
        if (!apiKey) return reject('claude', '缺少 x-api-key');
        if (headers.get('anthropic-version') == null) return reject('claude', '缺少 anthropic-version');
        if (!(body.max_tokens > 0)) return reject('claude', 'max_tokens 必填且为正数');
        if (messages.some((message) => message.role === 'system')) return reject('claude', 'system 须为顶层字段');
        if (body.output_config != null && body.output_config.format?.type !== 'json_schema') {
          return reject('claude', 'output_config.format 须为 json_schema');
        }
        return Response.json(anthropicMessage(body));
      }
      // OpenAI Chat Completions：Bearer 鉴权；结构化输出须为完整 json_schema（schema + strict + name）
      if (authorization !== 'Bearer oa-key') return reject('openai', '缺少 Bearer 鉴权');
      if (body.response_format?.type === 'json_schema') {
        const schema = body.response_format.json_schema;
        if (schema?.schema == null || typeof schema.strict !== 'boolean' || !schema.name) {
          return reject('openai', 'json_schema 须带 schema / strict / name');
        }
      }
      return Response.json(chatCompletion(body));
    };

    const fallback = getWritingModel();  // WRITING_MODEL_* 未配置 → 回落 Agent 实例
    const configs = [
      // DeepSeek：官方默认地址与默认模型名（AGENT_MODEL_NAME / BASE_URL 留空）
      { name: 'deepseek', env: { AGENT_MODEL_PROVIDER: 'deepseek', AGENT_MODEL_API_KEY: ' ds-key ' } },
      // OpenAI：Chat Completions 自定义地址（尾斜杠由 SDK 归一）
      { name: 'openai', env: {
        AGENT_MODEL_PROVIDER: 'openai', AGENT_MODEL_API_KEY: 'oa-key', AGENT_MODEL_NAME: 'gpt-custom',
        AGENT_MODEL_BASE_URL: ' https://openai-proxy.example/v1/ ',
      } },
      // Claude：Anthropic Messages 自定义地址
      { name: 'claude', env: {
        AGENT_MODEL_PROVIDER: 'claude', AGENT_MODEL_API_KEY: 'cl-key', AGENT_MODEL_NAME: 'claude-sonnet-5',
        AGENT_MODEL_BASE_URL: 'https://claude-proxy.example/v1',
      } },
    ];
    const results = {};
    for (const config of configs) {
      const model = createAgentModel(config.env);
      const text = await generateText({ model, system: '你是小说助手', prompt: '问候' });
      const tools = await generateText({ model, prompt: '查角色', tools: {
        lookup: tool({ description: '查角色', inputSchema: z.object({ name: z.string() }) }),
      } });
      const object = await generateObject({ model, schema: z.object({ name: z.string() }), prompt: '请提取角色名字' });
      results[config.name] = { text: text.text, call: tools.toolCalls[0], object: object.object };
    }

    // 独立写作模型：分别选择 provider，正文生成走写作模型的地址与鉴权
    process.env.WRITING_MODEL_PROVIDER = 'claude';
    process.env.WRITING_MODEL_NAME = 'claude-sonnet-5';
    process.env.WRITING_MODEL_API_KEY = 'wr-key';
    process.env.WRITING_MODEL_BASE_URL = 'https://writing-proxy.example/v1';
    const writing = await generateText({ model: getWritingModel(), prompt: '写一段' });
    process.env.WRITING_MODEL_PROVIDER = 'claud';
    let writingError = null;
    try { getWritingModel(); } catch (error) { writingError = error.message; }
    process.stdout.write(JSON.stringify({
      requests, results, rejected, fallback: fallback === agentModel,
      writing: writing.text, writingError,
    }));
  `;
  const proc = Bun.spawn([process.execPath, "--eval", probe], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    env: {
      ...process.env,
      WRITING_MODEL_API_KEY: "", WRITING_MODEL_NAME: "", WRITING_MODEL_BASE_URL: "", WRITING_MODEL_PROVIDER: "",
    }, stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
  ]);
  expect(stderr).toBe("");
  expect(exit).toBe(0);

  interface ProbeRequest {
    url: string;
    authorization: string | null;
    apiKey: string | null;
    anthropicVersion: string | null;
    body: {
      model: string;
      system?: unknown;
      messages: Array<{ role: string; content: unknown }>;
      tools?: Array<{ type?: string; name?: string; function?: { name: string; parameters?: unknown }; input_schema?: unknown }>;
      response_format?: { type: string; json_schema?: { strict?: boolean; name?: string } };
      output_config?: { format?: { type: string } };
      max_tokens?: number;
    };
  }
  const result = JSON.parse(stdout) as {
    requests: ProbeRequest[];
    results: Record<string, { text: string; call: { toolName: string; input: unknown }; object: unknown }>;
    rejected: string[];
    fallback: boolean;
    writing: string;
    writingError: string | null;
  };
  // 十次调用（三家各三次 + 写作模型一次）全部通过各家服务端约束——无任何 400
  expect(result.rejected).toEqual([]);
  const requestsOf = (prefix: string): ProbeRequest[] =>
    result.requests.filter((request) => request.url.startsWith(prefix));
  /** 单次运行的三类请求：文本 / 工具 / 结构化输出 */
  const partsOf = (prefix: string) => {
    const list = requestsOf(prefix);
    return {
      list,
      text: list[0]!,
      tools: list[1]!,
      json: list[2]!,
    };
  };

  // ① DeepSeek：官方地址与默认模型名；结构化输出的 JSON 指令由 SDK 注入 system 消息
  const deepseek = partsOf("https://api.deepseek.com");
  expect(deepseek.list).toHaveLength(3);
  for (const request of deepseek.list) {
    expect(request.url).toBe("https://api.deepseek.com/chat/completions");
    expect(request.authorization).toBe("Bearer ds-key");
    expect(request.body.model).toBe(DEFAULT_DEEPSEEK_MODEL_NAME);
  }
  expect(deepseek.json.body.response_format?.type).toBe("json_object");
  expect(JSON.stringify(deepseek.json.body.messages)).toContain("Return JSON that conforms to the following schema");
  expect(deepseek.tools.body.tools?.[0]?.function?.name).toBe("lookup");
  expect(result.results.deepseek!.text).toBe("你好");
  expect(result.results.deepseek!.call.toolName).toBe("lookup");
  expect(result.results.deepseek!.call.input).toEqual({ name: "林恒" });
  expect(result.results.deepseek!.object).toEqual({ name: "林恒" });

  // ② OpenAI：Chat Completions 自定义地址（尾斜杠归一）、Bearer 鉴权、json_schema 响应格式
  const openai = partsOf("https://openai-proxy.example/v1");
  expect(openai.list).toHaveLength(3);
  for (const request of openai.list) {
    expect(request.url).toBe("https://openai-proxy.example/v1/chat/completions");
    expect(request.authorization).toBe("Bearer oa-key");
    expect(request.body.model).toBe("gpt-custom");
  }
  expect(openai.json.body.response_format?.type).toBe("json_schema");
  expect(openai.json.body.response_format?.json_schema?.strict).toBe(true);
  expect(openai.text.body.messages[0]?.role).toBe("system");
  expect(result.results.openai!.text).toBe("你好");
  expect(result.results.openai!.call.toolName).toBe("lookup");
  expect(result.results.openai!.call.input).toEqual({ name: "林恒" });
  expect(result.results.openai!.object).toEqual({ name: "林恒" });

  // ③ Claude：Anthropic Messages 协议（x-api-key + anthropic-version、system 独立字段、工具 input_schema）
  const claude = partsOf("https://claude-proxy.example/v1");
  expect(claude.list).toHaveLength(3);
  for (const request of claude.list) {
    expect(request.url).toBe("https://claude-proxy.example/v1/messages");
    expect(request.apiKey).toBe("cl-key");
    expect(request.anthropicVersion).toBe("2023-06-01");
    expect(request.authorization).toBeNull();
    expect(request.body.model).toBe("claude-sonnet-5");
    expect(request.body.max_tokens).toBeGreaterThan(0);
    expect(request.body.messages.some((message) => message.role === "system")).toBe(false);
  }
  expect(JSON.stringify(claude.text.body.system)).toContain("你是小说助手");
  expect(claude.tools.body.tools?.[0]?.name).toBe("lookup");
  expect(claude.tools.body.tools?.[0]?.input_schema).toBeDefined();
  // 结构化输出：已知支持结构化输出的模型经 output_config 声明 json_schema
  expect(claude.json.body.output_config?.format?.type).toBe("json_schema");
  expect(result.results.claude!.text).toBe("你好");
  expect(result.results.claude!.call.toolName).toBe("lookup");
  expect(result.results.claude!.call.input).toEqual({ name: "林恒" });
  expect(result.results.claude!.object).toEqual({ name: "林恒" });

  // ④ 写作模型：独立 provider 选择；未配置时回落同一 Agent 实例；非法值给出清晰错误
  const writing = requestsOf("https://writing-proxy.example/v1");
  expect(writing).toHaveLength(1);
  expect(writing[0]!.url).toBe("https://writing-proxy.example/v1/messages");
  expect(writing[0]!.apiKey).toBe("wr-key");
  expect(result.writing).toBe("你好");
  expect(result.fallback).toBe(true);
  expect(result.writingError).toContain("WRITING_MODEL_PROVIDER 配置无效：claud");
});

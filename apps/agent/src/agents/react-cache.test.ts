import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test.each([false, true])("SDK step 消息保留工具关联，失败后保留完整步骤：failure=%s", async (failure) => {
  // 独立子进程用真实 AI SDK，仅替换 HTTP；缺失 step 落盘或错误时清空消息均会失败。
  const probe = `
    import { tool } from 'ai';
    import { z } from 'zod';
    import { runReactAgent } from './src/agents/react';
    import { withAgentMessageCache } from './src/agents/session-context';
    import { openDatabase } from './src/state/db';
    import { NovelStore } from './src/state/novel-store';
    import { WorkflowRunStore } from './src/state/workflow-run-store';
    globalThis.AI_SDK_LOG_WARNINGS = false;
    const fail = process.env.FAIL_PROBE === 'yes';
    let calls = 0;
    const snapshots = [];
    const db = openDatabase(':memory:');
    const novel = new NovelStore(db).createNovel({});
    const store = new WorkflowRunStore(db);
    const run = store.create({ kind: 'create', novelId: novel.id });
    const save = store.saveTrace.bind(store);
    store.saveTrace = (...args) => {
      save(...args);
      snapshots.push(store.listTraces(run.id)[0]);
    };
    globalThis.fetch = async () => {
      calls++;
      if (calls > 1) {
        if (fail) return Response.json({ error: { message: '额度耗尽' } }, { status: 401 });
        return Response.json({ id: 'completion-done', object: 'chat.completion', created: 1, model: 'test',
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '查到了线索' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
      }
      return Response.json({ id: 'completion-test', object: 'chat.completion', created: 1, model: 'test',
        choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null,
          tool_calls: [{ id: 'call1', type: 'function', function: { name: 'lookup', arguments: '{"name":"线索"}' } }],
        } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    };
    let error = null;
    try {
      await withAgentMessageCache({ runId: run.id, agentName: 'outline', store }, () => runReactAgent({
        system: '系统设定', prompt: '查询线索', maxSteps: 3,
        tools: { lookup: tool({ description: '查询', inputSchema: z.object({ name: z.string() }),
          execute: ({ name }) => ({ name, found: true }) }) },
      }));
    } catch (e) { error = e.message; }
    const trace = store.listTraces(run.id)[0];
    db.close();
    process.stdout.write(JSON.stringify({ trace, snapshots, error }));
  `;
  const proc = Bun.spawn([process.execPath, "--eval", probe], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    env: { ...process.env, AGENT_MODEL_API_KEY: "test", AGENT_MODEL_BASE_URL: "https://example.com/v1", FAIL_PROBE: failure ? "yes" : "no" },
    stdout: "pipe", stderr: "pipe",
  });
  const [out, err, exit] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  expect(err).toBe("");
  expect(exit).toBe(0);
  const result = JSON.parse(out);
  expect(result.trace?.status).toBe(failure ? "failed" : "completed");
  expect(result.trace.system).toBe("系统设定");
  const messages = result.trace.messages;
  expect(messages[0]).toEqual({ role: "user", content: "查询线索" });
  expect(messages.find((m: { role: string }) => m.role === "assistant").content).toContainEqual(
    expect.objectContaining({ type: "tool-call", toolCallId: "call1", toolName: "lookup", input: { name: "线索" } }),
  );
  expect(messages.find((m: { role: string }) => m.role === "tool").content).toContainEqual(
    expect.objectContaining({ type: "tool-result", toolCallId: "call1", toolName: "lookup" }),
  );
  expect(result.snapshots.some((snapshot: { status: string }) => snapshot.status === "running")).toBe(true);
  expect(messages.filter((message: { role: string }) => message.role === "tool")).toHaveLength(1);
  if (!failure) expect(JSON.stringify(messages)).toContain("查到了线索");
  expect(Boolean(result.error)).toBe(failure);
});

test.each(["continuation-failure", "terminal-accepted", "terminal-rejected"])("真实 SDK + SQLite 边界：%s", async (scenario) => {
  const probe = `
    import { tool } from 'ai';
    import { z } from 'zod';
    import { runReactAgent } from './src/agents/react';
    import { withAgentMessageCache } from './src/agents/session-context';
    import { openDatabase } from './src/state/db';
    import { NovelStore } from './src/state/novel-store';
    import { WorkflowRunStore } from './src/state/workflow-run-store';
    globalThis.AI_SDK_LOG_WARNINGS = false;
    const db = openDatabase(':memory:');
    const novel = new NovelStore(db).createNovel({ name: '日志回归' });
    const store = new WorkflowRunStore(db);
    const run = store.create({ kind: 'create', novelId: novel.id });
    const scenario = process.env.SCENARIO;
    let calls = 0;
    let submissions = 0;
    let done = false;
    const rejectedFirst = scenario === 'terminal-rejected';
    globalThis.fetch = async () => {
      calls++;
      if (scenario === 'continuation-failure') {
        if (calls > 1) return Response.json({ error: { message: '额度耗尽' } }, { status: 401 });
        return Response.json({ id: 'completion-one', object: 'chat.completion', created: 1, model: 'test',
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '即将提交' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
      }
      // 任何确认完成后的额外请求均模拟额度耗尽；确认前的否决允许下一次调用。
      if (done) return Response.json({ error: { message: '确认后不应额外请求' } }, { status: 401 });
      return Response.json({ id: 'completion-submit', object: 'chat.completion', created: 1, model: 'test',
        choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null,
          tool_calls: [{ id: 'submit-' + calls, type: 'function', function: { name: 'submit', arguments: '{}' } }],
        } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    };
    let error = null;
    let result = null;
    try {
      result = await withAgentMessageCache({ runId: run.id, agentName: 'regression', store }, () => runReactAgent({
        system: '系统设定', prompt: '初始问题', maxSteps: 4,
        isDone: () => done,
        continuationMax: 1, continuationHint: '请提交确认结果',
        tools: { submit: tool({ description: '确认提交', inputSchema: z.object({}),
          execute: () => {
            submissions++;
            const accepted = !rejectedFirst || submissions > 1;
            done = accepted;
            return { accepted };
          } }) },
      }));
    } catch (e) { error = e.message; }
    process.stdout.write(JSON.stringify({ calls, submissions, done, error, result, traces: store.listTraces(run.id) }));
    db.close();
  `;
  const proc = Bun.spawn([process.execPath, "--eval", probe], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    env: { ...process.env, AGENT_MODEL_API_KEY: "test", AGENT_MODEL_BASE_URL: "https://example.com/v1", SCENARIO: scenario },
    stdout: "pipe", stderr: "pipe",
  });
  const [out, err, exit] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  expect(err).toBe("");
  expect(exit).toBe(0);
  const result = JSON.parse(out);
  expect(result.traces).toHaveLength(1);
  const trace = result.traces[0];
  if (scenario === "continuation-failure") {
    expect(result.calls).toBe(2);
    expect(result.error).toBeTruthy();
    expect(trace.status).toBe("failed");
    expect(trace.messages).toContainEqual({ role: "user", content: "请提交确认结果" });
  } else {
    const expectedCalls = scenario === "terminal-rejected" ? 2 : 1;
    expect(result.error).toBeNull();
    expect(result.calls).toBe(expectedCalls);
    expect(result.submissions).toBe(expectedCalls);
    expect(result.done).toBe(true);
    expect(trace.status).toBe("completed");
    const toolMessages = trace.messages.filter((message: { role: string }) => message.role === "tool");
    expect(toolMessages).toHaveLength(expectedCalls);
    expect(toolMessages.at(-1).content).toContainEqual(expect.objectContaining({
      type: "tool-result", toolCallId: `submit-${expectedCalls}`, toolName: "submit",
      output: { type: "json", value: { accepted: true } },
    }));
    if (scenario === "terminal-rejected") {
      expect(toolMessages[0].content).toContainEqual(expect.objectContaining({
        toolCallId: "submit-1", output: { type: "json", value: { accepted: false } },
      }));
    }
  }
});

import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { agentMessageSchema } from "@novel/shared";

// 独立进程避免其他测试的 mock.module("ai") 污染。跑真实工作流、SDK、SQLite，
// 只替换 HTTP 边界；删掉历史追加、缓存选项或诊断接线都会破坏这些契约。
const bootstrap = `
  import { openDatabase } from './src/state/db';
  import { NovelStore } from './src/state/novel-store';
  import { OutlineStore } from './src/state/outline-store';
  import { WorldviewStore } from './src/state/worldview-store';
  import { DocumentStore } from './src/state/document-store';
  import { StyleReferenceStore } from './src/state/style-reference-store';
  import { readFileSync } from 'node:fs';
  globalThis.AI_SDK_LOG_WARNINGS = false;
  const db = openDatabase(process.env.NOVEL_DB_PATH);
  const novelStore = new NovelStore(db);
  const outlineStore = new OutlineStore(db);
  novelStore.createNovel({ id: 'sdk-novel', name: '缓存测试' });
  new WorldviewStore(db).saveWorldview('sdk-novel', { background: { geography: '九州大陆' }, taboos: ['不可出现现代科技'] });
  new StyleReferenceStore(db).addStyleReference('sdk-novel', { name: '样本文风', content: '长街落雪，少年驻足。' });
  const [, act] = outlineStore.saveOutlineTree('sdk-novel', [{ name: '部', summary: '部梗概', acts: [{ name: '幕', summary: '幕梗概', keyPlotPoints: ['拾遗'] }] }]);
  const chapter = outlineStore.addOutlineNode('sdk-novel', { type: 'chapter', name: '章', parentId: act.id, sort: 1, summary: '少年拾遗' });
  process.env.SDK_CHAPTER_ID = chapter.id;
  if (process.argv.at(-1) === 'sdk-chapter') process.argv[process.argv.length - 1] = chapter.id;
  db.close();
  const requests = [];
  let writingRound = 0;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const input = JSON.stringify(body.messages);
    const contentReview = input.includes('你是一位严格的小说设定审校编辑');
    const styleReview = input.includes('你是一位文风比对评审');
    const consistencyReview = input.includes('你是一位细致的小说内部自洽审校');
    const review = contentReview || styleReview || consistencyReview;
    if (!review) writingRound++;
    requests.push({ review, url: String(url), body });
    const content = review ? JSON.stringify(styleReview
      ? { score: 95, rationale: '句式贴近', suggestions: [] }
      : { issues: contentReview && writingRound < 3 ? [{ kind: 'summary', description: '第' + writingRound + '稿缺少拾遗', suggestion: '补全拾遗' }] : [] })
      : '  第' + writingRound + '稿写作内容。 \\n';
    await Bun.sleep(5);
    if (String(url).endsWith('/messages')) return Response.json({
      id: 'msg-' + requests.length, type: 'message', role: 'assistant', model: body.model, stop_sequence: null,
      content: [{ type: 'text', text: content }], stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 20, ...(process.env.SDK_CACHE_USAGE === 'missing' ? {} : {
        cache_read_input_tokens: process.env.SDK_CACHE_USAGE === 'zero' ? 0 : 2000,
        cache_creation_input_tokens: process.env.SDK_CACHE_USAGE === 'zero' ? 0 : 300,
      }) },
    });
    return Response.json({
      id: 'chat-' + requests.length, object: 'chat.completion', created: 1, model: body.model,
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
      ...(process.env.SDK_NO_USAGE === '1' && !review ? {} : { usage: {
        ...(['missing-input', 'empty'].includes(process.env.SDK_BASIC_USAGE) ? {} : { prompt_tokens: 2100 }),
        ...(['missing-output', 'empty'].includes(process.env.SDK_BASIC_USAGE) ? {} : { completion_tokens: 20 }),
        ...(process.env.SDK_CACHE_USAGE === 'missing' ? {} : {
          prompt_tokens_details: { cached_tokens: process.env.SDK_CACHE_USAGE === 'zero' ? 0 : 2000 },
          prompt_cache_hit_tokens: process.env.SDK_CACHE_USAGE === 'zero' ? 0 : 2000,
        }),
      } }),
    });
  };
`;

const directRun = `
  const { writeChapter } = await import('./src/workflows/write-chapter');
  const { FakeChannel } = await import('./src/ui/fake-channel');
  const metrics = [];
  await writeChapter({ channel: new FakeChannel([]), novelId: 'sdk-novel', chapterNodeId: process.env.SDK_CHAPTER_ID, onUsage: event => metrics.push(event) });
  const verifyDb = openDatabase(process.env.NOVEL_DB_PATH);
  const doc = new DocumentStore(verifyDb).getDocumentByChapter(process.env.SDK_CHAPTER_ID);
  console.log(JSON.stringify({ requests, metrics, chapterNodeId: process.env.SDK_CHAPTER_ID, content: readFileSync(doc.filePath, 'utf8') }));
  verifyDb.close();
`;

async function runProbe(provider: string, options: { fallback?: boolean; noUsage?: boolean; headless?: boolean; cacheUsage?: "missing" | "zero"; basicUsage?: string } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "novel-writing-sdk-"));
  try {
    const env = {
      ...process.env,
      NOVEL_DB_PATH: join(dir, "test.db"), NOVEL_OUTPUT_DIR: join(dir, "output"),
      AGENT_MODEL_PROVIDER: options.fallback ? provider : "deepseek", AGENT_MODEL_API_KEY: "test-agent-secret",
      AGENT_MODEL_NAME: options.fallback ? "claude-sonnet-4-5" : "deepseek-chat", AGENT_MODEL_BASE_URL: "https://review.invalid/v1",
      WRITING_MODEL_PROVIDER: options.fallback ? "" : provider, WRITING_MODEL_API_KEY: options.fallback ? "" : "test-writer-secret",
      WRITING_MODEL_NAME: options.fallback ? "" : provider === "claude" ? "claude-sonnet-4-5" : "test-writer",
      WRITING_MODEL_BASE_URL: options.fallback ? "" : "https://writer.invalid/v1",
      SDK_NO_USAGE: options.noUsage ? "1" : "0",
      SDK_CACHE_USAGE: options.cacheUsage ?? "present",
      SDK_BASIC_USAGE: options.basicUsage ?? "present",
    };
    let argv = [process.execPath, "--eval", bootstrap + directRun];
    if (options.headless) {
      // preload 在 cwd 外，使用绝对 import 确保加载同一应用模块。
      const appDir = fileURLToPath(new URL("../..", import.meta.url));
      const preload = join(dir, "preload.ts");
      await writeFile(preload, bootstrap.replaceAll("from './src/", `from '${appDir}/src/`));
      argv = [process.execPath, "--preload", preload, "src/headless.ts", "write-chapter", "sdk-novel", "sdk-chapter"];
    }
    const proc = Bun.spawn(argv, {
      cwd: fileURLToPath(new URL("../..", import.meta.url)), env,
      stdin: "pipe", stdout: "pipe", stderr: "pipe",
    });
    try {
      const [stdout, stderr, exit] = await Promise.all([
        new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
      ]);
      expect(exit, stderr || stdout).toBe(0);
      return { stdout, stderr };
    } finally { proc.kill(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test.each(["openai", "deepseek", "claude"])("%s 真实 SDK：三轮前缀、独立审校、缓存配置与写作指标", async (provider) => {
  const { stdout, stderr } = await runProbe(provider);
  expect(stderr).toBe("");
  const result = JSON.parse(stdout);
  const writes = result.requests.filter((request: { review: boolean }) => !request.review);
  expect(writes).toHaveLength(3);
  expect(result.requests.filter((request: { review: boolean }) => request.review)).toHaveLength(9);
  expect(writes[1].body.messages.slice(0, 1)).toEqual(writes[0].body.messages);
  expect(writes[2].body.messages.slice(0, 3)).toEqual(writes[1].body.messages);
  expect(writes[2].body.messages.map((message: { role: string }) => message.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
  expect(JSON.stringify(writes[1].body.messages[1])).toContain("  第1稿写作内容。 ");
  for (const request of writes) {
    expect(request.url).toBe(provider === "claude" ? "https://writer.invalid/v1/messages" : "https://writer.invalid/v1/chat/completions");
    expect(request.body.cache_control).toEqual(provider === "claude" ? { type: "ephemeral" } : undefined);
  }
  expect(result.content).toBe("第3稿写作内容。");
  expect(result.metrics).toHaveLength(3);
  expect(result.metrics.map((event: { phase: string }) => event.phase)).toEqual(["drafting", "revising", "revising"]);
  for (const [index, event] of result.metrics.entries()) {
    expect(event).toMatchObject({ novelId: "sdk-novel", chapterNodeId: result.chapterNodeId, round: index + 1,
      inputTokens: provider === "claude" ? 2400 : 2100, outputTokens: 20, cacheReadTokens: 2000,
      cacheWriteTokens: provider === "claude" ? 300 : null });
    expect(event.durationMs).toBeGreaterThanOrEqual(4);
    expect(event.modelId).toBe(provider === "claude" ? "claude-sonnet-4-5" : "test-writer");
  }
});

test("未配置独立写作模型时回落 Claude，仍启用缓存和追加历史", async () => {
  const { stdout, stderr } = await runProbe("claude", { fallback: true });
  expect(stderr).toBe("");
  const result = JSON.parse(stdout);
  const writes = result.requests.filter((request: { review: boolean }) => !request.review);
  expect(writes).toHaveLength(3);
  expect(writes[0].url).toBe("https://review.invalid/v1/messages");
  expect(writes[0].body.cache_control).toEqual({ type: "ephemeral" });
  expect(writes[2].body.messages.slice(0, 3)).toEqual(writes[1].body.messages);
  expect(result.content).toBe("第3稿写作内容。");
});

test("供应商未返回 usage：写作指标保留 null，不编造零命中", async () => {
  const { stdout } = await runProbe("openai", { noUsage: true });
  const { metrics } = JSON.parse(stdout);
  expect(metrics).toHaveLength(3);
  expect(metrics[0]).toMatchObject({ inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null });
});

test.each(["openai", "deepseek", "claude"])("%s 仅返回基本 usage 时缓存计数未知，显式零命中时保留 0", async (provider) => {
  const missing = JSON.parse((await runProbe(provider, { cacheUsage: "missing" })).stdout);
  expect(missing.metrics[0]).toMatchObject({
    inputTokens: provider === "claude" ? 100 : 2100,
    outputTokens: 20, cacheReadTokens: null, cacheWriteTokens: null,
  });
  const zero = JSON.parse((await runProbe(provider, { cacheUsage: "zero" })).stdout);
  expect(zero.metrics[0]).toMatchObject({ cacheReadTokens: 0, cacheWriteTokens: provider === "claude" ? 0 : null });
});

test.each(["openai", "deepseek"])("%s 部分 usage 或空对象不将未知输入/输出计数归零", async (provider) => {
  for (const [basicUsage, inputTokens, outputTokens] of [
    ["missing-input", null, 20], ["missing-output", 2100, null], ["empty", null, null],
  ] as const) {
    const { metrics } = JSON.parse((await runProbe(provider, { basicUsage, cacheUsage: "missing" })).stdout);
    expect(metrics[0]).toMatchObject({ inputTokens, outputTokens, cacheReadTokens: null, cacheWriteTokens: null });
  }
});

test("headless 写作指标只进 stderr JSON，stdout 保持协议且不泄露内容或 Key", async () => {
  const { stdout, stderr } = await runProbe("claude", { headless: true });
  const messages = stdout.trim().split("\n").map(line => agentMessageSchema.parse(JSON.parse(line)));
  expect(messages.at(-1)).toEqual({ type: "run_finished", novelId: "sdk-novel" });
  const diagnostics = stderr.trim().split("\n").map(line => JSON.parse(line));
  expect(diagnostics).toHaveLength(3);
  expect(diagnostics[0]).toMatchObject({ type: "chapter-writing-usage", phase: "drafting", round: 1, cacheReadTokens: 2000 });
  expect(stderr).not.toContain("test-writer-secret");
  expect(stderr).not.toContain("test-agent-secret");
  expect(stderr).not.toContain("写作内容");
  expect(stderr).not.toContain("九州大陆");
  expect(stdout).not.toContain("chapter-writing-usage");
});

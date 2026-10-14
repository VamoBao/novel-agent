import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("生成进度使用协议中的会话阈值，并在后续消息中保留", async () => {
  // 丢失 IPC 阈值、改用详情设置或后续消息覆盖阈值，会使 92 分错误地通过。
  const probe = `
    import { Window } from 'happy-dom';
    import { agentMessageSchema, novelDetailSchema } from '@novel/shared';
    const dom = new Window({ url: 'http://localhost' });
    Object.assign(globalThis, { window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true });
    const { act, createElement } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { PreviewPane } = await import('./src/components/PreviewPane');
    let onMessage;
    dom.agent = {
      onMessage: callback => { onMessage = callback; return () => {}; },
      onExit: () => () => {}, start: async () => {}, stop: async () => {},
    };
    const detail = novelDetailSchema.parse({
      novel: { id: 'n1', name: '小说', pinned: false, favorite: false,
        createdAt: '', updatedAt: '', stylePassScore: 80 },
      worldview: null, characters: [], migrations: [], migrationVersions: [],
      documents: [], foreshadows: [], locations: [], styleReferences: [],
      outlineNodes: [{ id: 'ch1', parentId: 'act1', type: 'chapter', name: '第一章',
        sort: 1, summary: '剧情', keyPlotPoints: null, characterIds: null }],
    });
    const container = dom.document.createElement('div');
    dom.document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(createElement(PreviewPane, {
      detail, loading: false, error: null, selection: { kind: 'outline', outlineNodeId: 'ch1' },
    })));
    await act(async () => [...container.querySelectorAll('button')]
      .find(button => button.textContent.includes('生成本章正文')).click());
    const base = { type: 'write-progress', chapterNodeId: 'ch1', round: 1, totalRounds: 3 };
    await act(async () => onMessage(agentMessageSchema.parse({
      ...base, phase: 'review-style', stylePassScore: 95,
      stageResult: { phase: 'review-style', result: {
        skipped: false, score: 92, rationale: '节奏不符', suggestions: ['调整叙述节奏'],
      } },
    })));
    await act(async () => onMessage(agentMessageSchema.parse({ ...base, phase: 'review-consistency' })));
    const styleStep = container.querySelectorAll('.progress-steps > li')[2].textContent;
    await act(async () => root.unmount());
    await dom.happyDOM.close();
    process.stdout.write(JSON.stringify({ styleStep }));
  `;
  const proc = Bun.spawn([process.execPath, "--eval", probe], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)), stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
  ]);
  expect(stderr).toBe("");
  expect(exit).toBe(0);
  const result = JSON.parse(stdout);
  expect(result.styleStep).toContain("⚠ 文风校验");
  expect(result.styleStep).toContain("调整叙述节奏");
});

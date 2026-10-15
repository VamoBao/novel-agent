import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

// 仅替换 Electron IPC。丢失首次 workflow-run、重试新建流程或完成后不刷新详情应使测试失败。
async function probe(body: string, env: Record<string, string> = {}): Promise<unknown> {
  const script = `
    import { Window } from 'happy-dom';
    const dom = new Window({ url: 'http://localhost' });
    Object.assign(globalThis, { window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true });
    const { act, createElement } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const container = dom.document.createElement('div');
    dom.document.body.append(container);
    const root = createRoot(container);
    const button = text => [...container.querySelectorAll('button')].find(n => n.textContent.includes(text));
    let message, exit;
    const starts = [], calls = [];
    let running = false;
    dom.agent = {
      onMessage: callback => { message = callback; return () => { message = undefined; }; },
      onExit: callback => { exit = callback; return () => { exit = undefined; }; },
      start: async options => {
        calls.push('start'); starts.push(options ?? null); running = true;
        message?.({ type: 'workflow-run', runId: 'saved-run', novelId: 'novel' });
        message?.({ type: 'notify', text: '继续处理已确认的创作结果' });
        message?.({ type: 'request', id: starts.length, ask: {
          type: 'confirm', prompt: '确认继续创作？', default: true,
        } });
      },
      stop: async () => {
        calls.push('stop');
        if (running) { running = false; exit?.(143); }
      },
      respond: async () => {},
      isAutostart: () => false, autoSelectNovelId: () => null,
    };
    ${body}
    await act(async () => root.unmount());
    await dom.happyDOM.close();
    process.stdout.write(JSON.stringify(result));
  `;
  const proc = Bun.spawn([process.execPath, "--eval", script], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
  ]);
  expect(stderr).toBe("");
  expect(exit).toBe(0);
  return JSON.parse(stdout);
}

test.each(["CreationFlow", "ChapterPlanFlow", "OutlineRegenFlow"])(
  "%s 错误后恢复收到的流程，保留新会话提问并忽略旧进程退出",
  async (component) => {
    const result = await probe(`
      const name = process.env.FLOW_COMPONENT;
      const module = await import('./src/components/' + name);
      await act(async () => root.render(createElement(module[name], {
        novelId: 'novel', novelName: '测试小说', actNodeId: 'act', actName: '第一幕',
        onFinished: () => {}, onClose: () => {},
      })));
      const firstQuestionVisible = !!container.querySelector('.question');
      await act(async () => message({ type: 'error', message: '网络中断', fatal: true }));
      const hint = container.querySelector('.error-panel .hint')?.textContent;
      const retry = button('继续未完成流程') ?? button('重启 agent');
      await act(async () => retry.click());
      const result = {
        starts, calls, firstQuestionVisible, hint,
        questionVisible: !!container.querySelector('.question'),
        errorVisible: !!container.querySelector('.error-panel'),
      };
    `, { FLOW_COMPONENT: component }) as {
      starts: unknown[]; calls: string[]; firstQuestionVisible: boolean;
      hint: string; questionVisible: boolean; errorVisible: boolean;
    };
    expect(result.starts[0]).toEqual(component === "CreationFlow"
      ? null
      : component === "ChapterPlanFlow"
        ? { mode: "plan-chapters", novelId: "novel", actNodeId: "act" }
        : { mode: "regen-outline", novelId: "novel" });
    expect(result.firstQuestionVisible).toBe(true);
    expect(result.starts[1]).toEqual({ mode: "resume", runId: "saved-run" });
    expect(result.calls.slice(-2)).toEqual(["stop", "start"]);
    expect(result.hint).toContain("已确认的结果已保存");
    expect(result.questionVisible).toBe(true);
    expect(result.errorVisible).toBe(false);
  },
);

test.each(["finish", "return"])("书库恢复未完成流程并在%s后刷新详情", async (action) => {
  const result = await probe(`
    const { App } = await import('./src/App');
    const action = process.env.RESUME_ACTION;
    const novel = { id: 'novel', name: '测试小说', pinned: false, favorite: false,
      createdAt: '', updatedAt: '' };
    let finished = false, listReads = 0, detailReads = 0;
    dom.agent.listNovels = async () => { listReads++; return [novel]; };
    dom.agent.getNovelDetail = async () => {
      detailReads++;
      return {
        novel, worldview: null, characters: [], migrations: [], migrationVersions: [],
        documents: [], foreshadows: [], locations: [], styleReferences: [],
        outlineNodes: [{ id: 'act', parentId: null, type: 'act', name: '渡河之夜',
          sort: 1, summary: '渡河', keyPlotPoints: null, characterIds: null }],
        pendingRuns: finished ? [] : [
          { id: 'saved-run', kind: 'plan-chapters', targetId: 'act', status: 'failed',
            error: '网络中断', updatedAt: '' },
          { id: 'create-run', kind: 'create', targetId: null, status: 'running', error: null, updatedAt: '' },
          { id: 'regen-run', kind: 'regen-outline', targetId: null, status: 'failed', error: null, updatedAt: '' },
        ],
      };
    };
    await act(async () => root.render(createElement(App)));
    await act(async () => container.querySelector('.novel-item').click());
    await act(async () => [...container.querySelectorAll('.tree-row .tree-node')]
      .find(node => node.textContent === '渡河之夜').click());
    const oldSelectionWasVisible = !!container.querySelector('.tree-node.active');
    const entryLabels = [...container.querySelectorAll('.tree-pane button')]
      .map(n => n.textContent).filter(text => text.includes('继续'));
    const resume = button('继续本幕章节规划');
    if (resume) await act(async () => resume.click());
    const title = container.querySelector('.creation-header strong')?.textContent;
    const readsBefore = { listReads, detailReads };
    if (resume) {
      finished = true;
      if (action === 'finish') {
        await act(async () => message({ type: 'run_finished', novelId: 'novel' }));
      } else {
        await act(async () => container.querySelector('.creation-header button').click());
      }
    }
    const result = {
      starts, title, entryLabels, readsBefore, listReads, detailReads,
      returned: !!container.querySelector('.workspace'),
      pendingVisible: [...container.querySelectorAll('.tree-pane button')]
        .some(n => n.textContent.includes('继续')),
      oldSelectionWasVisible,
      selectedAfter: !!container.querySelector('.tree-node.active'),
    };
  `, { RESUME_ACTION: action }) as {
    starts: unknown[]; title: string; entryLabels: string[];
    readsBefore: { listReads: number; detailReads: number }; listReads: number; detailReads: number;
    returned: boolean; pendingVisible: boolean; selectedAfter: boolean; oldSelectionWasVisible: boolean;
  };
  expect(result.entryLabels).toHaveLength(3);
  expect(result.entryLabels.join(" ")).toContain("渡河之夜");
  expect(result.entryLabels.join(" ")).toContain("继续新建小说");
  expect(result.entryLabels.join(" ")).toContain("继续大纲重生成");
  expect(result.entryLabels.join(" ")).not.toContain("saved-run");
  expect(result.starts).toEqual([{ mode: "resume", runId: "saved-run" }]);
  expect(result.title).toContain("继续创作流程");
  expect(result.returned).toBe(true);
  expect(result.listReads).toBeGreaterThan(result.readsBefore.listReads);
  expect(result.detailReads).toBeGreaterThan(result.readsBefore.detailReads);
  expect(result.pendingVisible).toBe(false);
  expect(result.oldSelectionWasVisible).toBe(true);
  expect(result.selectedAfter).toBe(false);
});

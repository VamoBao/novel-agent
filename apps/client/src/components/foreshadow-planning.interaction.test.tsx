import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

// 真实 React 确认门与预览，只替换 Electron IPC；遗漏计划幕、回收章或回收绑定即应失败。
test.each(["outline", "chapter", "preview", "legacy-preview"] as const)(
  "伏笔多幕回收展示：%s",
  async (scenario) => {
    const script = `
      import { Window } from 'happy-dom';
      const dom = new Window({ url: 'http://localhost' });
      Object.assign(globalThis, { window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true });
      const { act, createElement } = await import('react');
      const { createRoot } = await import('react-dom/client');
      const { CreationFlow } = await import('./src/components/CreationFlow');
      const { PreviewPane } = await import('./src/components/PreviewPane');
      const scenario = process.env.FORESHADOW_SCENARIO;
      let onMessage;
      const responses = [];
      dom.agent = {
        onMessage: callback => { onMessage = callback; return () => {}; },
        onExit: () => () => {}, start: async () => {}, stop: async () => {},
        respond: async (id, answer) => responses.push({id, answer}),
      };
      const container = dom.document.createElement('div');
      dom.document.body.append(container);
      const root = createRoot(container);
      const base = { surfaceAction: '铜铃停响', hiddenTruth: '铜铃记录了叛徒的暗号',
        attentionLevel: 8, characterNames: ['小林'] };
      const outline = { title: '渡河', logline: '渡河寻人', parts: [{ name: '上部', summary: '寻人',
        acts: [{name: '埋设幕', summary: '铜铃', keyPlotPoints: ['铜铃停响']}] }] };
      const plan = { chapters: [{ name: '起行章', summary: '踏上旅途', characters: [{ name: '小林', role: '主角' }] }] };
      if (scenario === 'outline' || scenario === 'chapter') {
        await act(async () => root.render(createElement(CreationFlow, {onFinished: () => {}, onClose: () => {}})));
        const view = scenario === 'outline'
          ? {kind: 'outline', detail: 'confirm', outline,
             newForeshadows: [{...base, actName: '埋设幕', recoverActNames: ['释疑幕', '终局幕']}]}
          : {kind: 'chapter-plan', actName: '埋设幕', actSummary: '起行', keyPlotPoints: ['铜铃停响'], plan,
             newForeshadows: [{...base, chapterName: '起行章', recoveryPlan: [
               {actName: '释疑幕', chapterNames: ['解铃章', '证词章']},
               {actName: '终局幕', chapterNames: []},
             ]}],
             foreshadowBindings: [{index: 1, chapterName: '起行章'}],
             foreshadowRecoverBindings: [{index: 2, chapterName: '破局章'}]};
        await act(async () => onMessage({type: 'request', id: 7, ask: {type: 'confirm', prompt: '确认计划？', view}}));
        const text = container.querySelector('.viewcard').textContent;
        await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === '确认').click());
        var result = {text, responses, questionClosed: !container.querySelector('.question')};
      } else {
        const entry = {id: 'f1', ...base, recoveryStatus: 'unrecovered', actNodeId: 'act1',
          recoverActNodeId: 'act2', appearChapterId: 'chapter1', recoverChapterIds: ['chapter2'],
          ...(scenario === 'preview' ? {recoverActNodeIds: ['act2', 'act3']} : {})};
        const node = (id, parentId, type, name, sort) => ({id, parentId, type, name, sort,
          summary: '概述', keyPlotPoints: [], characterIds: null});
        const detail = {novel: {id: 'novel'}, worldview: null, characters: [], migrations: [], migrationVersions: [],
          documents: [], foreshadows: [entry], locations: [], styleReferences: [], outlineNodes: [
            node('part', null, 'part', '上部', 1), node('act1', 'part', 'act', '埋设幕', 1),
            node('act2', 'part', 'act', '释疑幕', 2), node('act3', 'part', 'act', '终局幕', 3),
            node('chapter1', 'act1', 'chapter', '起行章', 1), node('chapter2', 'act2', 'chapter', '解铃章', 1),
          ]};
        await act(async () => root.render(createElement(PreviewPane, {detail, loading: false, error: null,
          selection: {kind: 'foreshadow', foreshadowId: 'f1'}})));
        const text = container.querySelector('.viewcard').textContent;
        await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent.includes('编辑伏笔')).click());
        await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === '取消').click());
        var result = {text, afterCancel: container.querySelector('.viewcard').textContent};
      }
      await act(async () => root.unmount());
      await dom.happyDOM.close();
      process.stdout.write(JSON.stringify(result));
    `;
    const proc = Bun.spawn([process.execPath, "--eval", script], {
      cwd: fileURLToPath(new URL("../..", import.meta.url)),
      env: { ...process.env, FORESHADOW_SCENARIO: scenario }, stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, exit] = await Promise.all([
      new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
    ]);
    expect(stderr).toBe("");
    expect(exit).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.text).toContain("释疑幕");
    if (scenario !== "legacy-preview") expect(result.text).toContain("终局幕");
    if (scenario === "outline") {
      expect(result.text).toContain("回收幕：释疑幕、终局幕");
    } else if (scenario === "chapter") {
      expect(result.text).toContain("解铃章、证词章");
      expect(result.text).toContain("终局幕：待细化");
      expect(result.text).toContain("伏笔回收绑定（确认后生效）");
      expect(result.text).toContain("2) → 破局章");
    } else {
      expect(result.text).toContain("释疑幕：已绑定回收章：解铃章");
      if (scenario === "preview") expect(result.text).toContain("终局幕：待细化");
      expect(result.afterCancel).toBe(result.text);
      expect(result.text).not.toContain("act2");
      expect(result.text).not.toContain("act3");
    }
    if (scenario === "outline" || scenario === "chapter") {
      expect(result.responses).toEqual([{ id: 7, answer: true }]);
      expect(result.questionClosed).toBe(true);
    }
  },
);

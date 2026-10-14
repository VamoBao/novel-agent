import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

// 真实 App/书库/弹窗联动，仅替换 Electron IPC；独立进程避免 ReactDOM 的 DOM 检测缓存串扰。
// 无条件刷新目标详情、遗漏当前小说刷新或接纳切换前的迟到响应，均应被这些场景捕获。
test.each(["other", "current", "switch"] as const)(
  "保存写作偏好保持详情与选中小说一致：%s",
  async (scenario) => {
    const probe = `
      import { Window } from 'happy-dom';
      const dom = new Window({ url: 'http://localhost' });
      Object.assign(globalThis, { window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true });
      const { act, createElement } = await import('react');
      const { createRoot } = await import('react-dom/client');
      const { App } = await import('./src/App');
      const scenario = process.env.PREFS_SCENARIO;
      const novels = ['A', 'B'].map(id => ({
        id, name: '小说' + id, pinned: false, favorite: false,
        createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
      }));
      let saved = false;
      let finishRefresh;
      const detail = id => ({
        novel: { ...novels.find(n => n.id === id), genre: null, audience: null, coreConflict: null,
          chapterLengthMin: null, chapterLengthMax: null, stylePassScore: null },
        worldview: null, characters: [], migrations: [], migrationVersions: [], outlineNodes: [],
        documents: [], foreshadows: [], styleReferences: [],
        locations: [{ id: 'loc-' + id, name: '地点' + id + (saved && id === 'A' ? '更新' : ''),
          description: '定位' }],
      });
      dom.agent = {
        isAutostart: () => false, autoSelectNovelId: () => null,
        listNovels: async () => novels,
        getNovelDetail: async id => {
          if (scenario === 'switch' && saved && id === 'A') {
            return new Promise(resolve => { finishRefresh = () => resolve(detail(id)); });
          }
          return detail(id);
        },
        setWritingPrefs: async id => { saved = true; return novels.find(n => n.id === id); },
        onMessage: () => () => {}, onExit: () => () => {}, stop: async () => {},
      };
      const container = dom.document.createElement('div');
      dom.document.body.append(container);
      const root = createRoot(container);
      await act(async () => root.render(createElement(App)));
      const select = async id => {
        await act(async () => {
          [...container.querySelectorAll('.novel-item')].find(n => n.textContent === '小说' + id).click();
        });
      };
      await select('A');
      await act(async () => {
        const target = scenario === 'other' ? 'B' : 'A';
        [...container.querySelectorAll('.novel-item')].find(n => n.textContent === '小说' + target)
          .dispatchEvent(new dom.MouseEvent('contextmenu', { bubbles: true }));
      });
      await act(async () => {
        [...container.querySelectorAll('button')].find(n => n.textContent.includes('📏 写作偏好')).click();
      });
      await act(async () => container.querySelector('.dialog button.primary').click());
      if (scenario === 'switch') {
        await select('B');
        await act(async () => finishRefresh());
      }
      const result = {
        active: container.querySelector('.novel-item.active').textContent,
        tree: container.querySelector('.tree-pane').textContent,
        dialogClosed: container.querySelector('.dialog') === null,
      };
      await act(async () => root.unmount());
      await dom.happyDOM.close();
      process.stdout.write(JSON.stringify(result));
    `;
    const proc = Bun.spawn([process.execPath, "--eval", probe], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: { ...process.env, PREFS_SCENARIO: scenario }, stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, exit] = await Promise.all([
      new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
    ]);
    expect(stderr).toBe("");
    expect(exit).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.dialogClosed).toBe(true);
    if (scenario === "switch") {
      expect(result.active).toBe("小说B");
      expect(result.tree).toContain("地点B");
      expect(result.tree).not.toContain("地点A");
    } else {
      expect(result.active).toBe("小说A");
      expect(result.tree).toContain(scenario === "current" ? "地点A更新" : "地点A");
      expect(result.tree).not.toContain("地点B");
    }
  },
);

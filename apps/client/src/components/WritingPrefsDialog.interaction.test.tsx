import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

/**
 * WritingPrefsDialog 交互冒烟（happy-dom + 真实 React，独立子进程隔离模块缓存——
 * 与 SettingsDialog.interaction 同款 harness）：打开加载小说现值 → 编辑三项 →
 * 保存提交载荷正确；半设篇幅被表单校验拦截零提交。
 */
test("写作偏好弹窗：加载现值、编辑保存载荷正确、半设篇幅拦截", async () => {
  const probe = `
    import { Window } from 'happy-dom';
    const dom = new Window({ url: 'http://localhost' });
    Object.assign(globalThis, { window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true });
    const { act, createElement } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { WritingPrefsDialog } = await import('./src/components/WritingPrefsDialog');
    const submitted = [];
    dom.agent = {
      getNovelDetail: async () => ({
        novel: {
          id: 'n-1', name: '灵脉拾遗', pinned: false, favorite: false,
          createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
          genre: null, audience: null, coreConflict: null,
          chapterLengthMin: 3000, chapterLengthMax: 4500, stylePassScore: 85,
        },
        worldview: null, characters: [], migrations: [], migrationVersions: [],
        outlineNodes: [], documents: [], foreshadows: [], locations: [], styleReferences: [],
      }),
      setWritingPrefs: async (novelId, prefs) => {
        submitted.push({ novelId, prefs });
        return { id: novelId, name: '灵脉拾遗', pinned: false, favorite: false, createdAt: '', updatedAt: '' };
      },
    };
    const container = dom.document.createElement('div');
    dom.document.body.append(container);
    const root = createRoot(container);
    let saved = false;
    await act(async () => {
      root.render(createElement(WritingPrefsDialog, {
        novelId: 'n-1', novelName: '灵脉拾遗',
        onClose: () => {}, onSaved: () => { saved = true; },
      }));
    });
    const inputs = dom.document.querySelectorAll('.dialog input');
    const loaded = { count: inputs.length, min: inputs[0].value, max: inputs[1].value, score: inputs[2].value };
    const set = (input, value) => {
      Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, 'value').set.call(input, value);
      input.dispatchEvent(new dom.Event('input', { bubbles: true }));
    };
    // 先试半设篇幅：清空下限（只留上限）→ 表单校验拦截，零提交、显示错误
    await act(async () => {
      set(inputs[0], '');
      dom.document.querySelector('button.primary').click();
    });
    const errorText = dom.document.querySelector('.form-error')?.textContent ?? '';
    const submittedBeforeFix = submitted.length;
    // 补齐三项后保存（保存成功后按钮停在保存中态，由父级 onSaved 卸载收尾——对齐 App 行为）
    await act(async () => {
      set(inputs[0], ' 2500 ');
      set(inputs[1], '4000');
      set(inputs[2], '95');
    });
    await act(async () => { dom.document.querySelector('button.primary').click(); });
    await act(async () => root.unmount());
    await dom.happyDOM.close();
    process.stdout.write(JSON.stringify({
      loaded, saved, submitted, submittedBeforeFix, errorText,
    }));
  `;
  const proc = Bun.spawn([process.execPath, "--eval", probe], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  expect(stderr).toBe("");
  expect(exit).toBe(0);
  const result = JSON.parse(stdout);
  expect(result.loaded).toEqual({ count: 3, min: "3000", max: "4500", score: "85" });
  expect(result.saved).toBe(true);
  expect(result.submittedBeforeFix).toBe(0);
  expect(result.submitted).toEqual([
    {
      novelId: "n-1",
      prefs: { chapterLengthMin: 2500, chapterLengthMax: 4000, stylePassScore: 95 },
    },
  ]);
  expect(result.errorText).toContain("同时");
});

test("写作偏好加载失败显示原始错误，取消可关闭且不能保存", async () => {
  // 把错误和取消按钮放在加载成功分支，会让查询失败静默且无关闭入口。
  const probe = `
    import { Window } from 'happy-dom';
    const dom = new Window({ url: 'http://localhost' });
    Object.assign(globalThis, { window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true });
    const { act, createElement } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { WritingPrefsDialog } = await import('./src/components/WritingPrefsDialog');
    dom.agent = { getNovelDetail: async () => { throw new Error('查询子进程超时（8s）'); } };
    const container = dom.document.createElement('div');
    dom.document.body.append(container);
    const root = createRoot(container);
    let closed = false;
    await act(async () => root.render(createElement(WritingPrefsDialog, {
      novelId: 'n1', novelName: '小说', onClose: () => { closed = true; }, onSaved: () => {},
    })));
    const error = container.querySelector('.form-error')?.textContent ?? null;
    const canSave = container.querySelector('button.primary') !== null;
    const cancel = [...container.querySelectorAll('button')].find(button => button.textContent === '取消');
    await act(async () => cancel?.click());
    await act(async () => root.unmount());
    await dom.happyDOM.close();
    process.stdout.write(JSON.stringify({ error, canSave, closed }));
  `;
  const proc = Bun.spawn([process.execPath, "--eval", probe], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)), stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
  ]);
  expect(stderr).toBe("");
  expect(exit).toBe(0);
  expect(JSON.parse(stdout)).toEqual({ error: "查询子进程超时（8s）", canSave: false, closed: true });
});

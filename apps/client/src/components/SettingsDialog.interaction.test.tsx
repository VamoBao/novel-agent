import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeSettings, readSettingsFile, resolveModelEnv, writeSettingsFile } from "../../electron/settings";

test("Agent Base URL 从设置加载，编辑保存后重读并注入通用环境变量", async () => {
  const dir = mkdtempSync(join(tmpdir(), "novel-settings-ui-"));
  const filePath = join(dir, "settings.json");
  try {
    writeSettingsFile(filePath, normalizeSettings({
      agentModel: { apiKey: "custom-key", modelName: "custom-model", baseUrl: "https://before.example/v1" },
    }));
    // ReactDOM 必须在 DOM 建立后加载才启用文本 input 事件；独立进程隔离其他测试的模块缓存。
    const probe = `
      import { Window } from 'happy-dom';
      import { readSettingsFile, writeSettingsFile } from './electron/settings';
      const dom = new Window({ url: 'http://localhost' });
      Object.assign(globalThis, { window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true });
      const { act, createElement } = await import('react');
      const { createRoot } = await import('react-dom/client');
      const { SettingsDialog } = await import('./src/components/SettingsDialog');
      const filePath = process.env.SETTINGS_PROBE_FILE;
      dom.agent = {
        getSettings: async () => ({ settings: readSettingsFile(filePath), filePath }),
        saveSettings: async (settings) => ({ settings: writeSettingsFile(filePath, settings), filePath }),
      };
      const container = dom.document.createElement('div');
      dom.document.body.append(container);
      const root = createRoot(container);
      let closed = false;
      await act(async () => { root.render(createElement(SettingsDialog, { onClose: () => { closed = true; } })); });
      const inputs = dom.document.querySelectorAll('.settings-group')[1].querySelectorAll('input');
      const loaded = { count: inputs.length, type: inputs[0].type, model: inputs[1].value, url: inputs[2]?.value };
      await act(async () => {
        Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, 'value').set.call(inputs[2], ' https://after.example/v1 ');
        inputs[2].dispatchEvent(new dom.Event('input', { bubbles: true }));
      });
      await act(async () => { dom.document.querySelector('button.primary').click(); });
      await act(async () => root.unmount());
      await dom.happyDOM.close();
      process.stdout.write(JSON.stringify({ loaded, closed }));
    `;
    const proc = Bun.spawn([process.execPath, "--eval", probe], {
      cwd: fileURLToPath(new URL("../..", import.meta.url)),
      env: { ...process.env, SETTINGS_PROBE_FILE: filePath }, stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, exit] = await Promise.all([
      new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
    ]);
    expect(stderr).toBe("");
    expect(exit).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      loaded: { count: 3, type: "password", model: "custom-model", url: "https://before.example/v1" }, closed: true,
    });
    const saved = readSettingsFile(filePath);
    expect(saved.agentModel).toEqual({ apiKey: "custom-key", modelName: "custom-model", baseUrl: "https://after.example/v1" });
    expect(resolveModelEnv(saved, {}, {}).AGENT_MODEL_BASE_URL).toBe("https://after.example/v1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

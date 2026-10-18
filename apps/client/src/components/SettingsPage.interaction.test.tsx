import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeSettings, readSettingsFile, resolveModelEnv, writeSettingsFile } from "../../electron/settings";

test("设置页结构：左导航三项、默认模型设置、切换渲染对应设置项、Esc 触发返回", async () => {
  const dir = mkdtempSync(join(tmpdir(), "novel-settings-page-"));
  const filePath = join(dir, "settings.json");
  try {
    writeSettingsFile(filePath, normalizeSettings({}));
    const probe = `
      import { Window } from 'happy-dom';
      import { readSettingsFile, resolveEffectiveProviders } from './electron/settings';
      const dom = new Window({ url: 'http://localhost' });
      Object.assign(globalThis, { window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true });
      const { act, createElement } = await import('react');
      const { createRoot } = await import('react-dom/client');
      const { SettingsPage } = await import('./src/components/SettingsPage');
      const filePath = process.env.SETTINGS_PROBE_FILE;
      dom.agent = {
        getSettings: async () => {
          const settings = readSettingsFile(filePath);
          return { settings, filePath, effectiveProviders: resolveEffectiveProviders(settings, {}, {}), defaultOutputDir: "/default/output" };
        },
        saveSettings: async (settings) => ({ settings, filePath }),
      };
      const container = dom.document.createElement('div');
      dom.document.body.append(container);
      const root = createRoot(container);
      let closed = false;
      await act(async () => { root.render(createElement(SettingsPage, { onClose: () => { closed = true; } })); });
      const nav = [...dom.document.querySelectorAll('.settings-nav button')].map((b) => b.textContent);
      const clickNav = async (label) => {
        const button = [...dom.document.querySelectorAll('.settings-nav button')].find((b) => b.textContent.includes(label));
        await act(async () => { button.click(); });
      };
      const snapshot = () => ({
        active: dom.document.querySelector('.settings-nav button.active')?.textContent,
        groups: [...dom.document.querySelectorAll('.settings-group-label')].map((p) => p.textContent),
      });
      const initial = snapshot();
      await clickNav('写作偏好');
      const writing = snapshot();
      await clickNav('外观');
      const appearance = snapshot();
      const themeButtons = [...dom.document.querySelectorAll('.theme-options button')].map((b) => b.textContent);
      // 页面化：无弹窗遮罩，保存动作行常驻右栏底部
      const layout = {
        backdrop: dom.document.querySelector('.dialog-backdrop') === null,
        hasSave: dom.document.querySelector('.settings-actions button.primary')?.textContent,
      };
      // Esc 返回（页面化后保留键盘退出习惯）
      await act(async () => { dom.window.dispatchEvent(new dom.KeyboardEvent('keydown', { key: 'Escape' })); });
      await act(async () => root.unmount());
      await dom.happyDOM.close();
      process.stdout.write(JSON.stringify({ nav, initial, writing, appearance, themeButtons, layout, closed }));
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
      nav: ["模型设置", "写作偏好", "外观"],
      // 默认分类：模型设置（Agent 会话模型 + 写作模型两组）
      initial: {
        active: "模型设置",
        groups: [
          "Agent 会话模型——世界观 / 角色 / 大纲 / 章节规划 / 正文校验",
          "写作模型——章节正文生成专用",
        ],
      },
      // 写作偏好：篇幅 / 合格线 + 产物输出目录（正文文件去向与写作直接相关）
      writing: {
        active: "写作偏好",
        groups: ["写作偏好（默认）——章节正文生成", "产物输出目录——章节正文文件"],
      },
      // 外观：主题三选
      appearance: { active: "外观", groups: ["外观"] },
      themeButtons: ["跟随系统", "浅色", "深色"],
      layout: { backdrop: true, hasSave: "保存" },
      closed: true,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.each(["agent", "writing"])("%s 只编辑连接字段后仍使用界面显示的 DeepSeek（不触碰下拉框）", async (group) => {
  const dir = mkdtempSync(join(tmpdir(), "novel-settings-provider-edit-"));
  const filePath = join(dir, "settings.json");
  try {
    // 写作组的历史地址使其初始显示 DeepSeek；Agent 空配置也默认显示 DeepSeek。
    writeSettingsFile(filePath, normalizeSettings({
      writingModel: { baseUrl: "https://api.deepseek.com" },
    }));
    const probe = `
      import { Window } from 'happy-dom';
      import { readSettingsFile, writeSettingsFile, resolveEffectiveProviders, resolveModelEnv } from './electron/settings';
      const dom = new Window({ url: 'http://localhost' });
      Object.assign(globalThis, { window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true });
      const { act, createElement } = await import('react');
      const { createRoot } = await import('react-dom/client');
      const { SettingsPage } = await import('./src/components/SettingsPage');
      const filePath = process.env.SETTINGS_PROBE_FILE;
      dom.agent = {
        getSettings: async () => {
          const settings = readSettingsFile(filePath);
          return { settings, filePath, effectiveProviders: resolveEffectiveProviders(settings, {}, {}), defaultOutputDir: "/default/output" };
        },
        saveSettings: async (settings) => ({ settings: writeSettingsFile(filePath, settings), filePath }),
      };
      const container = dom.document.createElement('div');
      dom.document.body.append(container);
      const root = createRoot(container);
      await act(async () => root.render(createElement(SettingsPage, { onClose: () => {} })));
      const group = process.env.SETTINGS_TEST_GROUP;
      // 默认分类即模型设置：组序 [0] = Agent 会话模型、[1] = 写作模型
      const target = dom.document.querySelectorAll('.settings-group')[group === 'agent' ? 0 : 1];
      const select = target.querySelector('select');
      const shown = select.value;
      const inputs = target.querySelectorAll('input');
      const values = group === 'agent'
        ? ['test-key', 'deepseek-flash', 'https://deepseek-proxy.example/v1']
        : ['deepseek-flash', 'test-key', 'https://deepseek-proxy.example/v1'];
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, 'value').set;
        values.forEach((value, index) => {
          setter.call(inputs[index], value);
          inputs[index].dispatchEvent(new dom.Event('input', { bubbles: true }));
        });
      });
      const afterEdit = select.value;
      await act(async () => dom.document.querySelector('.settings-actions button.primary').click());
      const saved = readSettingsFile(filePath);
      const env = resolveModelEnv(saved, {}, {});
      process.stdout.write(JSON.stringify({
        shown, afterEdit, effective: resolveEffectiveProviders(saved, {}, {})[group],
        injected: env[group === 'agent' ? 'AGENT_MODEL_PROVIDER' : 'WRITING_MODEL_PROVIDER'],
      }));
      await act(async () => root.unmount());
      await dom.happyDOM.close();
    `;
    const proc = Bun.spawn([process.execPath, "--eval", probe], {
      cwd: fileURLToPath(new URL("../..", import.meta.url)),
      env: { ...process.env, SETTINGS_PROBE_FILE: filePath, SETTINGS_TEST_GROUP: group },
      stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, exit] = await Promise.all([
      new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
    ]);
    expect(stderr).toBe("");
    expect(exit).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      shown: "deepseek", afterEdit: "deepseek", effective: "deepseek", injected: "deepseek",
    });
    const saved = readSettingsFile(filePath);
    expect(saved[group === "agent" ? "agentModel" : "writingModel"].provider).toBe("deepseek");
    expect(saved[group === "agent" ? "writingModel" : "agentModel"].provider).toBe("");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

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
      import { readSettingsFile, resolveEffectiveProviders, writeSettingsFile } from './electron/settings';
      const dom = new Window({ url: 'http://localhost' });
      Object.assign(globalThis, { window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true });
      const { act, createElement } = await import('react');
      const { createRoot } = await import('react-dom/client');
      const { SettingsPage } = await import('./src/components/SettingsPage');
      const filePath = process.env.SETTINGS_PROBE_FILE;
      // 模拟宿主注入来源（main 侧读根 .env）：生效 provider 可能来自 .env 而非设置文件
      const dotenv = JSON.parse(process.env.SETTINGS_PROBE_DOTENV || '{}');
      dom.agent = {
        getSettings: async () => {
          const settings = readSettingsFile(filePath);
          return { settings, filePath, effectiveProviders: resolveEffectiveProviders(settings, dotenv, {}), defaultOutputDir: "/default/output" };
        },
        saveSettings: async (settings) => ({ settings: writeSettingsFile(filePath, settings), filePath }),
      };
      const container = dom.document.createElement('div');
      dom.document.body.append(container);
      const root = createRoot(container);
      let closed = false;
      await act(async () => { root.render(createElement(SettingsPage, { onClose: () => { closed = true; } })); });
      // 默认分类模型设置：组序 [0] = Agent 会话模型、[1] = 写作模型
      const groups = dom.document.querySelectorAll('.settings-group');
      const agentGroup = groups[0];
      const inputs = agentGroup.querySelectorAll('input');
      const loaded = { count: inputs.length, type: inputs[0].type, model: inputs[1].value, url: inputs[2]?.value };
      // provider 下拉框：载入时按有效地址回显（历史配置无 provider），切换后只换 Base URL 提示、不改写已填值
      const select = agentGroup.querySelector('select');
      const provider = {
        options: [...select.options].map((option) => option.value),
        labels: [...select.options].map((option) => option.textContent),
        loaded: select.value,
        urlPlaceholder: inputs[2].placeholder,
      };
      await act(async () => {
        Object.getOwnPropertyDescriptor(dom.HTMLSelectElement.prototype, 'value').set.call(select, 'claude');
        select.dispatchEvent(new dom.Event('change', { bubbles: true }));
      });
      provider.afterSwitch = {
        value: select.value,
        urlPlaceholder: inputs[2].placeholder,
        modelPlaceholder: inputs[1].placeholder,
        keptUrl: inputs[2].value,
      };
      await act(async () => {
        Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, 'value').set.call(inputs[2], ' https://after.example/v1 ');
        inputs[2].dispatchEvent(new dom.Event('input', { bubbles: true }));
      });
      // 写作模型组：provider 默认 OpenAI，独立选择不影响 Agent 组
      const writingGroup = groups[1];
      const writingSelect = writingGroup.querySelector('select');
      const writing = { loaded: writingSelect.value, afterSwitch: '' };
      await act(async () => {
        Object.getOwnPropertyDescriptor(dom.HTMLSelectElement.prototype, 'value').set.call(writingSelect, 'deepseek');
        writingSelect.dispatchEvent(new dom.Event('change', { bubbles: true }));
      });
      writing.afterSwitch = writingSelect.value;
      await act(async () => { dom.document.querySelector('.settings-actions button.primary').click(); });
      await act(async () => root.unmount());
      await dom.happyDOM.close();
      process.stdout.write(JSON.stringify({ loaded, provider, writing, closed }));
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
      loaded: { count: 3, type: "password", model: "custom-model", url: "https://before.example/v1" },
      provider: {
        options: ["openai", "deepseek", "claude"],
        labels: ["OpenAI", "DeepSeek", "Claude"],
        // 历史配置（无 provider）+ 自定义地址 → 按有效地址迁移为 openai
        loaded: "openai",
        urlPlaceholder: "https://api.openai.com/v1",
        afterSwitch: {
          value: "claude",
          urlPlaceholder: "https://api.anthropic.com/v1",
          modelPlaceholder: "如 claude-sonnet-5",
          // 切换 provider 不改写用户已填写的地址
          keptUrl: "https://before.example/v1",
        },
      },
      // 写作模型 provider 默认 OpenAI（全新配置），可独立切换
      writing: { loaded: "openai", afterSwitch: "deepseek" },
      closed: true,
    });
    const saved = readSettingsFile(filePath);
    expect(saved.agentModel).toEqual({
      provider: "claude", apiKey: "custom-key", modelName: "custom-model", baseUrl: "https://after.example/v1",
    });
    expect(saved.writingModel.provider).toBe("deepseek");
    const env = resolveModelEnv(saved, {}, {});
    expect(env.AGENT_MODEL_PROVIDER).toBe("claude");
    expect(env.WRITING_MODEL_PROVIDER).toBe("deepseek");
    expect(env.AGENT_MODEL_BASE_URL).toBe("https://after.example/v1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("产物输出目录：浏览回填经探针验证的目录并保存落盘；不可写回显错误不采纳；恢复默认清空", async () => {
  const dir = mkdtempSync(join(tmpdir(), "novel-settings-output-"));
  const filePath = join(dir, "settings.json");
  try {
    writeSettingsFile(filePath, normalizeSettings({}));
    const probe = `
      import { Window } from 'happy-dom';
      import { readSettingsFile, resolveEffectiveProviders, writeSettingsFile } from './electron/settings';
      const dom = new Window({ url: 'http://localhost' });
      Object.assign(globalThis, { window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true });
      const { act, createElement } = await import('react');
      const { createRoot } = await import('react-dom/client');
      const { SettingsPage } = await import('./src/components/SettingsPage');
      const filePath = process.env.SETTINGS_PROBE_FILE;
      // pickOutputDirectory 脚本：第一次返回不可写目录（探针失败），其后返回可写目录
      let pickCount = 0;
      dom.agent = {
        getSettings: async () => {
          const settings = readSettingsFile(filePath);
          return { settings, filePath, effectiveProviders: resolveEffectiveProviders(settings, {}, {}), defaultOutputDir: "/default/output" };
        },
        saveSettings: async (settings) => ({ settings: writeSettingsFile(filePath, settings), filePath }),
        pickOutputDirectory: async () => {
          pickCount += 1;
          return pickCount === 1
            ? { ok: false, canceled: false, error: "目录不可写（/readonly）：permission denied" }
            : { ok: true, dir: "/custom/output" };
        },
      };
      const container = dom.document.createElement('div');
      dom.document.body.append(container);
      const root = createRoot(container);
      await act(async () => { root.render(createElement(SettingsPage, { onClose: () => {} })); });
      // 产物输出目录归入「写作偏好」分类：先切换导航，组序 [0] = 写作偏好、[1] = 输出目录
      const navButton = [...dom.document.querySelectorAll('.settings-nav button')].find((b) => b.textContent.includes('写作偏好'));
      await act(async () => { navButton.click(); });
      const group = dom.document.querySelectorAll('.settings-group')[1];
      const input = group.querySelector('input');
      const placeholder = input.placeholder;
      // 第一次浏览：探针失败 → 错误回显、目录不采纳（保持空 = 默认）
      await act(async () => { group.querySelectorAll('.field-actions button')[0].click(); });
      const errorAfterProbe = dom.document.querySelector('.form-error')?.textContent ?? null;
      const valueAfterProbe = input.value;
      // 第二次浏览：可写目录回填 → 恢复默认可用，点击后清空回落默认
      await act(async () => { group.querySelectorAll('.field-actions button')[0].click(); });
      const valueAfterPick = input.value;
      await act(async () => { group.querySelectorAll('.field-actions button')[1].click(); });
      const valueAfterReset = input.value;
      // 再选一次并保存：outputDir 落盘
      await act(async () => { group.querySelectorAll('.field-actions button')[0].click(); });
      await act(async () => { dom.document.querySelector('.settings-actions button.primary').click(); });
      const saved = readSettingsFile(filePath);
      await act(async () => root.unmount());
      await dom.happyDOM.close();
      process.stdout.write(JSON.stringify({
        placeholder, errorAfterProbe, valueAfterProbe, valueAfterPick, valueAfterReset, saved: saved.outputDir,
      }));
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
      placeholder: "默认：/default/output",
      // 探针失败：错误回显、目录不采纳（保持默认空值）
      errorAfterProbe: "目录不可写（/readonly）：permission denied",
      valueAfterProbe: "",
      valueAfterPick: "/custom/output",
      valueAfterReset: "",
      saved: "/custom/output",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("历史配置（无 provider，DeepSeek 官方地址）在设置页中回显为 DeepSeek 并保存为新格式", async () => {
  const dir = mkdtempSync(join(tmpdir(), "novel-settings-ui-legacy-"));
  const filePath = join(dir, "settings.json");
  try {
    // 模拟历史 settings.json：只有 deepseek 组（无 provider 字段）
    writeFileSync(filePath, JSON.stringify({
      deepseek: { apiKey: "old-key", modelName: "deepseek-flash" },
      writing: { chapterLengthMin: 3000, chapterLengthMax: 4000 },
    }));
    const probe = `
      import { Window } from 'happy-dom';
      import { readSettingsFile, resolveEffectiveProviders, writeSettingsFile } from './electron/settings';
      const dom = new Window({ url: 'http://localhost' });
      Object.assign(globalThis, { window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true });
      const { act, createElement } = await import('react');
      const { createRoot } = await import('react-dom/client');
      const { SettingsPage } = await import('./src/components/SettingsPage');
      const filePath = process.env.SETTINGS_PROBE_FILE;
      // 模拟宿主注入来源（main 侧读根 .env）：生效 provider 可能来自 .env 而非设置文件
      const dotenv = JSON.parse(process.env.SETTINGS_PROBE_DOTENV || '{}');
      dom.agent = {
        getSettings: async () => {
          const settings = readSettingsFile(filePath);
          return { settings, filePath, effectiveProviders: resolveEffectiveProviders(settings, dotenv, {}), defaultOutputDir: "/default/output" };
        },
        saveSettings: async (settings) => ({ settings: writeSettingsFile(filePath, settings), filePath }),
      };
      const container = dom.document.createElement('div');
      dom.document.body.append(container);
      const root = createRoot(container);
      await act(async () => { root.render(createElement(SettingsPage, { onClose: () => {} })); });
      // 默认分类模型设置：组序 [0] = Agent 会话模型、[1] = 写作模型
      const groups = dom.document.querySelectorAll('.settings-group');
      const loaded = {
        provider: groups[0].querySelector('select').value,
        key: groups[0].querySelectorAll('input')[0].value,
        writingProvider: groups[1].querySelector('select').value,
      };
      const untouched = groups[0].querySelector('select').value;
      await act(async () => { dom.document.querySelector('.settings-actions button.primary').click(); });
      await act(async () => root.unmount());
      await dom.happyDOM.close();
      process.stdout.write(JSON.stringify({ loaded, untouched }));
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
      // 设置页回显生效值：Agent 地址留空 → 沿用 DeepSeek 官方默认；写作未配置 → 默认 OpenAI
      loaded: { provider: "deepseek", key: "old-key", writingProvider: "openai" },
      untouched: "deepseek",
    });
    const saved = readSettingsFile(filePath);
    // 关键：未触碰下拉框时**不把回显出的生效值固化**进设置文件——provider 保持空串，
    // 下次会话仍由 .env / 继承环境变量按地址迁移决定（避免遮蔽下层已配置的 provider）
    expect(saved.agentModel.provider).toBe("");
    expect(saved.writingModel.provider).toBe("");
    expect(saved.agentModel.apiKey).toBe("old-key");
    // 写作三项仍为空 → 不因新增默认 provider 而意外启用
    expect([saved.writingModel.modelName, saved.writingModel.apiKey, saved.writingModel.baseUrl])
      .toEqual(["", "", ""]);
    expect(resolveModelEnv(saved, {}, {}).AGENT_MODEL_PROVIDER).toBe("");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("只改主题时保留 .env 的 provider，不固化回显值", async () => {
  const dir = mkdtempSync(join(tmpdir(), "novel-settings-ui-dotenv-"));
  const filePath = join(dir, "settings.json");
  try {
    writeFileSync(filePath, JSON.stringify({ agentModel: { apiKey: "sk-env" } }));
    const probe = `
      import { Window } from 'happy-dom';
      import { readSettingsFile, resolveEffectiveProviders, writeSettingsFile } from './electron/settings';
      const dom = new Window({ url: 'http://localhost' });
      Object.assign(globalThis, { window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true });
      const { act, createElement } = await import('react');
      const { createRoot } = await import('react-dom/client');
      const { SettingsPage } = await import('./src/components/SettingsPage');
      const filePath = process.env.SETTINGS_PROBE_FILE;
      const dotenv = JSON.parse(process.env.SETTINGS_PROBE_DOTENV || '{}');
      dom.agent = {
        getSettings: async () => {
          const settings = readSettingsFile(filePath);
          return { settings, filePath, effectiveProviders: resolveEffectiveProviders(settings, dotenv, {}), defaultOutputDir: "/default/output" };
        },
        saveSettings: async (settings) => ({ settings: writeSettingsFile(filePath, settings), filePath }),
      };
      const container = dom.document.createElement('div');
      dom.document.body.append(container);
      const root = createRoot(container);
      await act(async () => { root.render(createElement(SettingsPage, { onClose: () => {} })); });
      // 模型设置分类（默认）读回显的接口类型
      const groups = dom.document.querySelectorAll('.settings-group');
      const agentSelect = groups[0].querySelector('select');
      const shown = {
        agent: agentSelect.value,
        agentOptions: [...agentSelect.options].map((option) => option.value),
        urlPlaceholder: groups[0].querySelectorAll('input')[2].placeholder,
      };
      // 切到外观分类改主题后保存
      const appearanceNav = [...dom.document.querySelectorAll('.settings-nav button')].find((b) => b.textContent.includes('外观'));
      await act(async () => { appearanceNav.click(); });
      await act(async () => { dom.document.querySelectorAll('.theme-options button')[2].click(); });
      await act(async () => { dom.document.querySelector('.settings-actions button.primary').click(); });
      await act(async () => root.unmount());
      await dom.happyDOM.close();
      process.stdout.write(JSON.stringify({ shown }));
    `;
    const proc = Bun.spawn([process.execPath, "--eval", probe], {
      cwd: fileURLToPath(new URL("../..", import.meta.url)),
      env: {
        ...process.env,
        SETTINGS_PROBE_FILE: filePath,
        SETTINGS_PROBE_DOTENV: JSON.stringify({
          AGENT_MODEL_PROVIDER: "claude", AGENT_MODEL_BASE_URL: "https://api.anthropic.com/v1",
        }),
      },
      stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, exit] = await Promise.all([
      new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
    ]);
    expect(stderr).toBe("");
    expect(exit).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      // 回显的是 .env 提供的生效接口类型（而非「设置文件为空 → 默认 DeepSeek」）
      shown: {
        agent: "claude",
        agentOptions: ["openai", "deepseek", "claude"],
        urlPlaceholder: "https://api.anthropic.com/v1",
      },
    });
    // 保存只落用户实际编辑的字段：provider 仍为空串，.env 的 claude 继续生效
    const saved = readSettingsFile(filePath);
    expect(saved.theme).toBe("dark");
    expect(saved.agentModel.provider).toBe("");
    const env = resolveModelEnv(saved, { AGENT_MODEL_PROVIDER: "claude", AGENT_MODEL_BASE_URL: "https://api.anthropic.com/v1" }, {});
    expect(env.AGENT_MODEL_PROVIDER).toBe("claude");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

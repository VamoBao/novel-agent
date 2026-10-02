# 客户端暗黑模式 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 客户端新增暗黑主题，默认跟随系统；设置弹窗三选手动切换（跟随系统/浅色/深色），保存即时生效；浅色观感不回归。

**架构：** `userData/settings.json` 的 `theme` 字段 → main 进程 `nativeTheme.themeSource` → Chromium 覆盖 renderer 的 `prefers-color-scheme` 媒体查询 → CSS 变量整组切换。渲染层零主题 JS；窗口底色由 `nativeTheme.shouldUseDarkColors` 计算并随 `updated` 事件同步，防启动白闪。

**技术栈：** Electron 38 内置 `nativeTheme`（零新依赖）+ CSS 原生变量与媒体查询 + React 19 + bun:test。

**规格：** `docs/superpowers/specs/2026-10-02-client-dark-mode-design.md`（31 变量深浅对照表以规格为准）

**项目约定覆盖（优先于本技能默认）：** 依 `docs/feature-check-guide.md`，拆解任务**不单独 commit**——任务 1 先把清单落盘 `PROGRESS.md`「进行中」，WIP = 1 逐任务执行并即时更新清单状态，全部完成后任务 8 归一清单、同步状态文档并**一次原子提交**。每个任务结束跑闭环校验（`bun run typecheck`、`bun run lint`、`bun run test`）。

---

## 文件结构

| 文件 | 动作 | 职责 |
| --- | --- | --- |
| `apps/client/electron/settings.ts` | 修改 | `ThemeSetting` 类型 + `THEMES` 常量 + `AppSettings.theme` 字段 + `normalizeTheme` 枚举归一（保持 electron-free、bun:test 可测） |
| `apps/client/electron/settings.test.ts` | 修改 | theme 归一化与读写往返用例 |
| `apps/client/electron/main.ts` | 修改 | `applyTheme()`（启动与保存后设 `themeSource`）+ `windowBackgroundColor()` + `updated` 监听 + 诊断钩子 `NOVEL_CLIENT_THEME` |
| `apps/client/src/styles.css` | 修改 | `:root` 31 变量 + 暗色媒体查询块 + 规则区硬编码颜色全量替换 + `.theme-options` 样式 |
| `apps/client/src/components/SettingsDialog.tsx` | 修改 | 「外观」分组三选分段按钮，theme 入草稿态随保存提交 |
| `apps/client/src/env.d.ts` | 零改动 | `window.agent` 类型引用 `AppSettings`，theme 字段自动跟随 |
| 状态文档（PROGRESS / ARCHITECTURE / AGENTS / DECISIONS） | 修改 | 任务 8 统一同步 |

依赖顺序：任务 2（settings.ts theme 字段）→ 任务 3（main.ts 接线，读 `settings.theme`）与任务 5（SettingsDialog，引 `THEMES` 类型）依赖它；任务 4（styles.css）独立。WIP = 1 按序执行：2 → 3 → 4 → 5 → 6 → 7 → 8。

---

### 任务 1：任务清单落盘 PROGRESS.md（编码前断点存档）

**文件：**
- 修改：`PROGRESS.md`（「进行中」区域，替换占位行）

- [ ] **步骤 1：写入任务清单**

将「进行中」区域的占位行替换为：

```markdown
### 进行中：客户端暗黑模式（2026-10-02 拆解，规格 docs/superpowers/specs/2026-10-02-client-dark-mode-design.md）

- [ ] 任务 2：settings.ts 增 theme 字段｜涉及模块：apps/client/electron｜业务目的：主题偏好持久化与归一化底座（electron-free 可单测）｜完成判断条件：settings 单测含 theme 默认/非法归一/三值透传/读写往返全过，typecheck/lint 过（状态：未开始）
- [ ] 任务 3：main.ts nativeTheme 接线｜涉及模块：apps/client/electron｜业务目的：设置→themeSource 三态映射、保存即生效、窗口底色防白闪｜完成判断条件：typecheck/lint 过；启动/保存/系统切换三路径运行时行为任务 7 截图实证（状态：未开始）
- [ ] 任务 4：styles.css 变量化 + 暗色媒体查询｜涉及模块：apps/client/src｜业务目的：31 语义变量底座与暗色配色（规格对照表）｜完成判断条件：规则区零硬编码色值（仅 :root 与媒体查询块含色值，grep 实证）；浅色无头截图与现状目测一致（状态：未开始）
- [ ] 任务 5：SettingsDialog 外观分组｜涉及模块：apps/client/src｜业务目的：主题三选手动切换入口｜完成判断条件：三选项草稿态交互、保存载荷携带 theme；typecheck/lint 过（状态：未开始）
- [ ] 任务 6：整体闭环校验｜涉及模块：apps/client｜业务目的：工程不变量全量过｜完成判断条件：bun run typecheck / lint / test 100% 通过（状态：未开始）
- [ ] 任务 7：双主题运行时验证｜涉及模块：apps/client｜业务目的：暗色观感与浅色回归的实证验收｜完成判断条件：NOVEL_CLIENT_THEME=light/dark 无头截图各一张并目测通过（状态：未开始）
- [ ] 任务 8：文档同步与原子提交｜涉及模块：仓库根状态文档｜业务目的：代码与文档原子一致｜完成判断条件：PROGRESS 清单归一、ARCHITECTURE/AGENTS/DECISIONS 同步、单次 feat(client) 提交（状态：未开始）
```

---

### 任务 2：settings.ts 增 theme 字段（TDD）

**文件：**
- 修改：`apps/client/electron/settings.test.ts`（文末追加 describe）
- 修改：`apps/client/electron/settings.ts`

- [ ] **步骤 1：编写失败的测试**

在 `settings.test.ts` 文末（`resolveModelEnv` describe 之后）追加：

```ts
describe("normalizeSettings theme", () => {
  test("缺省 / 非法值归 system（旧 settings.json 前向兼容、手改文件容错）", () => {
    expect(normalizeSettings(null).theme).toBe("system");
    expect(normalizeSettings({}).theme).toBe("system");
    expect(normalizeSettings({ theme: "blue" }).theme).toBe("system");
    expect(normalizeSettings({ theme: 123 }).theme).toBe("system");
  });

  test("三个合法值透传", () => {
    expect(normalizeSettings({ theme: "system" }).theme).toBe("system");
    expect(normalizeSettings({ theme: "light" }).theme).toBe("light");
    expect(normalizeSettings({ theme: "dark" }).theme).toBe("dark");
  });

  test("写后读往返保留 theme", () => {
    const dir = mkdtempSync(join(tmpdir(), "novel-settings-"));
    tempDirs.push(dir);
    const filePath = join(dir, "settings.json");
    writeSettingsFile(filePath, {
      theme: "dark",
      deepseek: { apiKey: "", modelName: "" },
      writingModel: { modelName: "", apiKey: "", baseUrl: "" },
    });
    expect(readSettingsFile(filePath).theme).toBe("dark");
  });
});
```

（所需符号 `normalizeSettings` / `writeSettingsFile` / `readSettingsFile` / `mkdtempSync` / `tmpdir` / `join` / `tempDirs` 均已在既有 import 中。）

- [ ] **步骤 2：运行测试验证失败**

运行：`bun test apps/client/electron/settings.test.ts`
预期：FAIL——`normalizeSettings(null).theme` 为 `undefined`（类型层 `theme` 不存在则 typecheck 亦报错，先见测试红）。

- [ ] **步骤 3：实现 settings.ts**

`settings.ts` 改动（四处）：

① 模块注释段落后新增类型与常量：

```ts
/** 主题三态：与 Electron nativeTheme.themeSource 原生枚举一一对应，零转换 */
export const THEMES = ["system", "light", "dark"] as const;
export type ThemeSetting = (typeof THEMES)[number];
```

② `AppSettings` 接口首行插入 `theme` 字段，`DEFAULT_SETTINGS` 同步：

```ts
export interface AppSettings {
  /** 外观主题：跟随系统（默认）/ 浅色 / 深色；main 侧经 applyTheme 设 nativeTheme.themeSource */
  theme: ThemeSetting;
  /** Agent 会话模型（DeepSeek）：世界观 / 角色 / 大纲 / 章节规划等工作流共用 */
  deepseek: {
    apiKey: string;
    modelName: string;
  };
  /** 写作模型（OpenAI 接口兼容端点）：章节正文生成专用；三项留空回落 deepseek */
  writingModel: {
    modelName: string;
    apiKey: string;
    baseUrl: string;
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  deepseek: { apiKey: "", modelName: "" },
  writingModel: { modelName: "", apiKey: "", baseUrl: "" },
};
```

③ `normalizeSettings` 增主题归一（归一函数放在 `normalizeGroup` 之后）：

```ts
/** 主题枚举还原：非三合法值（缺省 / 手改 settings.json 写错）一律回「跟随系统」 */
function normalizeTheme(value: unknown): ThemeSetting {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value)
    ? (value as ThemeSetting)
    : "system";
}
```

`normalizeSettings` 返回对象首行加：

```ts
    theme: normalizeTheme(source.theme),
```

④ `readSettingsFile` catch 分支改走 normalize（DRY，自动携带 theme 默认且每次返回全新对象）：

```ts
/** 读取设置文件（不存在 / 损坏一律返回全空默认——等价未配置，.env 兜底） */
export function readSettingsFile(filePath: string): AppSettings {
  try {
    return normalizeSettings(JSON.parse(readFileSync(filePath, "utf8")));
  } catch {
    return normalizeSettings(null);
  }
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`bun test apps/client/electron/settings.test.ts`
预期：PASS（既有 5 测试 + 新增 3 测试全绿——既有用例无需改动：`toEqual(DEFAULT_SETTINGS)` 自动含 `theme: "system"`）。

- [ ] **步骤 5：闭环校验并更新清单**

运行：`bun run typecheck && bun run lint`
预期：全过。将 `PROGRESS.md` 任务 2 勾选并置「已完成」。

---

### 任务 3：main.ts nativeTheme 接线

**文件：**
- 修改：`apps/client/electron/main.ts`（import 行、`createWindow`、`settings:save`、`app.whenReady`）

（electron 模块无法 import 进 bun:test，本任务静态校验兜底，运行时行为在任务 7 截图实证。）

- [ ] **步骤 1：import 行加入 nativeTheme**

```ts
import { app, BrowserWindow, ipcMain, nativeTheme } from "electron";
```

- [ ] **步骤 2：新增两个主题函数**

放在 `settingsFilePath()` 定义之后：

```ts
/** 窗口底色随主题（防启动白闪与切题闪帧；值与 styles.css 的 --bg-app 保持一致） */
function windowBackgroundColor(): string {
  return nativeTheme.shouldUseDarkColors ? "#0d1117" : "#f6f7f9";
}

/** 应用主题设置到 nativeTheme：theme 三值与原生三态一一对应。
 *  themeSource 一变，renderer 的 prefers-color-scheme 媒体查询即时重算——主题保存即生效。
 *  诊断钩子 NOVEL_CLIENT_THEME=system|light|dark 强制覆盖（与 NOVEL_CLIENT_* 家族同款，
 *  仅显式设置时生效，双主题无头截图验证用） */
function applyTheme(): void {
  const override = process.env.NOVEL_CLIENT_THEME;
  nativeTheme.themeSource =
    override === "system" || override === "light" || override === "dark"
      ? override
      : readSettingsFile(settingsFilePath()).theme;
}
```

- [ ] **步骤 3：createWindow 传底色**

`new BrowserWindow({...})` options 首行（`width` 之前）插入：

```ts
    backgroundColor: windowBackgroundColor(),
```

- [ ] **步骤 4：启动时应用 + 跟随系统监听**

`app.whenReady().then(...)` 改为：

```ts
app.whenReady().then(() => {
  applyTheme();
  // 「跟随系统」模式：系统运行中切换主题时同步窗口底色（CSS 媒体查询由 Chromium 自动重算）
  nativeTheme.on("updated", () => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.setBackgroundColor(windowBackgroundColor());
    }
  });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
```

- [ ] **步骤 5：settings:save 保存后即时应用**

```ts
ipcMain.handle("settings:save", (_event, settings: AppSettings): { settings: AppSettings; filePath: string } => {
  const saved = writeSettingsFile(settingsFilePath(), settings);
  applyTheme(); // 主题保存即生效（模型配置仍为下一次会话生效，两者语义不同）
  return { settings: saved, filePath: settingsFilePath() };
});
```

- [ ] **步骤 6：闭环校验并更新清单**

运行：`bun run typecheck && bun run lint`
预期：全过。将 `PROGRESS.md` 任务 3 勾选并置「已完成」。

---

### 任务 4：styles.css 变量化 + 暗色媒体查询

**文件：**
- 修改：`apps/client/src/styles.css`（`:root` 头块重写；规则区 1-766 行逐条替换色值）

- [ ] **步骤 1：重写 `:root` 头块并追加暗色媒体查询**

将文件开头 1-4 行替换为（规则区其余部分本步不动）：

```css
:root {
  color-scheme: light;
  /* 背景 */
  --bg-app: #f6f7f9;
  --bg-panel: #fff;
  --bg-sidebar: #fbfbfc;
  --bg-subtle: #eef0f3;
  --bg-button-hover: #f3f4f6;
  --bg-accent-subtle: #e8effd;
  --bg-success-subtle: #dcfce7;
  --bg-danger-subtle: #fef3f2;
  --bg-danger-soft: #fee4e2;
  --bg-warning-subtle: #fffbeb;
  /* 边框 */
  --border-default: #e4e7eb;
  --border-strong: #d0d7de;
  --border-danger: #fecdca;
  --border-warning: #fde68a;
  /* 文字 */
  --fg-default: #1f2328;
  --fg-muted: #6a737d;
  --fg-subtle: #9aa1ab;
  --fg-disabled: #b6bcc4;
  --fg-notify: #424a53;
  --fg-on-emphasis: #fff;
  /* 强调蓝（emphasis 为填充底，暗色比文字蓝深以保白字对比） */
  --accent: #2563eb;
  --accent-emphasis: #2563eb;
  --accent-strong: #1d4ed8;
  /* 危险红（hover 暗色变亮而非变暗） */
  --danger: #b42318;
  --danger-strong: #912018;
  --danger-emphasis: #b42318;
  --danger-hover: #912018;
  /* 成功绿 */
  --success: #15803d;
  /* 层级 */
  --overlay: rgba(31, 35, 40, 0.45);
  --shadow-popover: 0 6px 20px rgba(31, 35, 40, 0.14);
  --shadow-modal: 0 12px 32px rgba(31, 35, 40, 0.22);

  font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}

/* 暗黑主题：值以 GitHub Primer Dark 为基准（规格映射表 docs/superpowers/specs/2026-10-02-client-dark-mode-design.md）。
   nativeTheme.themeSource 会覆盖这里的媒体查询判定——手动三选与跟随系统同走此路径 */
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --bg-app: #0d1117;
    --bg-panel: #151b23;
    --bg-sidebar: #10151c;
    --bg-subtle: #21262d;
    --bg-button-hover: #262c36;
    --bg-accent-subtle: #121d2f;
    --bg-success-subtle: #12261e;
    --bg-danger-subtle: #25171c;
    --bg-danger-soft: #312229;
    --bg-warning-subtle: #272115;
    --border-default: #3d444d;
    --border-strong: #4b535e;
    --border-danger: #931c2e;
    --border-warning: #9e6a03;
    --fg-default: #f0f3f6;
    --fg-muted: #9198a1;
    --fg-subtle: #656c76;
    --fg-disabled: #484f58;
    --fg-notify: #d1d7de;
    --fg-on-emphasis: #fff;
    --accent: #4493f8;
    --accent-emphasis: #1f6feb;
    --accent-strong: #388bfd;
    --danger: #f85149;
    --danger-strong: #ff8182;
    --danger-emphasis: #b62324;
    --danger-hover: #da3633;
    --success: #3fb950;
    --overlay: rgba(1, 4, 9, 0.6);
    --shadow-popover: 0 6px 20px rgba(1, 4, 9, 0.4);
    --shadow-modal: 0 12px 32px rgba(1, 4, 9, 0.5);
  }
}
```

- [ ] **步骤 2：规则区逐条替换硬编码色值**

替换映射（「上下文」列用于同名色分派不同变量的行，行号为现状行号、供定位）：

| 现值 | 替换为 | 上下文例外 |
| --- | --- | --- |
| `#f6f7f9` | `var(--bg-app)` | |
| `#1f2328` | `var(--fg-default)` | |
| `#fff` 作 background | `var(--bg-panel)` | |
| `#fff` 作 color | `var(--fg-on-emphasis)` | 行 394（danger-filled）/ 424（stage.active）/ 697（button.primary） |
| `#e4e7eb` | `var(--border-default)` | |
| `#fbfbfc` | `var(--bg-sidebar)` | |
| `#6a737d` | `var(--fg-muted)` | |
| `#b42318` 作 color | `var(--danger)` | |
| `#b42318` 作 background / border-color | `var(--danger-emphasis)` | 行 392 / 393（danger-filled） |
| `#eef0f3` | `var(--bg-subtle)` | |
| `#e8effd` | `var(--bg-accent-subtle)` | |
| `#2563eb` 作 box-shadow（inset 选中条） | `var(--accent)` | 行 163（novel-item.active） |
| `#2563eb` 作 background / border-color | `var(--accent-emphasis)` | 行 423（stage.active）/ 695、696（button.primary） |
| `#9aa1ab` | `var(--fg-subtle)` | |
| `#1d4ed8` | `var(--accent-strong)` | |
| `#b6bcc4` | `var(--fg-disabled)` | 行 240（tree-toggle:disabled 的 color） |
| `#d0d7de` / `#d5d9df` / `#d5dae1` | `var(--border-strong)` | 三值并入（输入框/按钮/组头钮边框） |
| `#912018` 作 color | `var(--danger-strong)` | 行 370（dialog-hint code） |
| `#912018` 作 background | `var(--danger-hover)` | 行 398（danger-filled:hover） |
| `#fffbeb` | `var(--bg-warning-subtle)` | |
| `#fde68a` | `var(--border-warning)` | |
| `#fef3f2` | `var(--bg-danger-subtle)` | |
| `#fecdca` | `var(--border-danger)` | |
| `#fee4e2` | `var(--bg-danger-soft)` | |
| `#dcfce7` | `var(--bg-success-subtle)` | |
| `#15803d` | `var(--success)` | |
| `#424a53` | `var(--fg-notify)` | |
| `#f3f4f6` | `var(--bg-button-hover)` | |
| `#8a929c` | `var(--fg-subtle)` | 行 765（settings-hint） |
| `rgba(31, 35, 40, 0.45)` | `var(--overlay)` | 行 332（dialog-backdrop） |
| `rgba(31, 35, 40, 0.14)` | `var(--shadow-popover)` | 行 288（context-menu） |
| `rgba(31, 35, 40, 0.22)` | `var(--shadow-modal)` | 行 342（dialog） |

- [ ] **步骤 3：实证规则区零硬编码色值**

运行：`grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\(' apps/client/src/styles.css`
预期：命中行全部位于文件头部 `:root` 块与 `@media (prefers-color-scheme: dark)` 块区间内，规则区（两个块之后）零命中。

- [ ] **步骤 4：闭环校验并更新清单**

运行：`bun run typecheck && bun run lint`
预期：全过。将 `PROGRESS.md` 任务 4 勾选并置「已完成」。（浅色回归截图在任务 7 与暗色一并目测。）

---

### 任务 5：SettingsDialog 外观分组

**文件：**
- 修改：`apps/client/src/components/SettingsDialog.tsx`
- 修改：`apps/client/src/styles.css`（文件末尾追加 `.theme-options` 样式组）

- [ ] **步骤 1：SettingsDialog 引入主题类型与选项常量**

import 区改为：

```tsx
import { useEffect, useState } from "react";
import type { AppSettings, ThemeSetting } from "../../electron/settings";
import { THEMES } from "../../electron/settings";
```

`FormState` 接口上方加选项常量（顺序即 THEMES 顺序，label 为展示文案）：

```tsx
/** 外观主题三选（跟随系统为默认；THEMES 顺序即展示顺序） */
const THEME_OPTIONS: Array<{ value: ThemeSetting; label: string }> = THEMES.map((value) => ({
  value,
  label: value === "system" ? "跟随系统" : value === "light" ? "浅色" : "深色",
}));
```

`FormState` 增字段、`EMPTY_FORM` 同步：

```tsx
/** 表单态：五个模型字段 + 主题（theme 即持久化值，非字符串表单字段） */
interface FormState {
  theme: ThemeSetting;
  deepseekApiKey: string;
  deepseekModelName: string;
  writingModelName: string;
  writingModelApiKey: string;
  writingModelBaseUrl: string;
}

const EMPTY_FORM: FormState = {
  theme: "system",
  deepseekApiKey: "",
  deepseekModelName: "",
  writingModelName: "",
  writingModelApiKey: "",
  writingModelBaseUrl: "",
};
```

（`setField` 签名 `(field: keyof FormState, value: string)` 不变——`ThemeSetting` 是 string 子类型，`setField("theme", option.value)` 类型兼容。）

- [ ] **步骤 2：加载回填与保存载荷携带 theme**

加载 `.then` 内 `setForm({...})` 首行加：

```tsx
          theme: settings.theme,
```

`save()` 内 `AppSettings` 对象首行加：

```tsx
      theme: form.theme,
```

- [ ] **步骤 3：「外观」分组 UI（置于 Agent 会话模型分组之前）**

```tsx
            <div className="settings-group">
              <p className="settings-group-label">外观</p>
              <div className="theme-options" role="group" aria-label="主题">
                {THEME_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={form.theme === option.value ? "selected" : undefined}
                    aria-pressed={form.theme === option.value}
                    disabled={saving}
                    onClick={() => setField("theme", option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="settings-hint">主题保存后立即生效，「跟随系统」随系统浅色/深色自动切换；模型配置仍为下一次会话生效。</p>
            </div>
```

- [ ] **步骤 4：追加 .theme-options 样式（styles.css 末尾，header-actions 样式组风格）**

```css
/* 设置弹窗「外观」主题分段三选（SettingsDialog）：选中态复用主按钮填充语汇 */
.theme-options {
  display: flex;
  gap: 6px;
}

.theme-options button {
  padding: 5px 12px;
  font-size: 13px;
}

.theme-options button.selected {
  background: var(--accent-emphasis);
  border-color: var(--accent-emphasis);
  color: var(--fg-on-emphasis);
}
```

- [ ] **步骤 5：闭环校验并更新清单**

运行：`bun run typecheck && bun run lint`
预期：全过。将 `PROGRESS.md` 任务 5 勾选并置「已完成」。

---

### 任务 6：整体闭环校验

- [ ] **步骤 1：三件套全量**

运行：`bun run typecheck && bun run lint && bun run test`
预期：3 工程 typecheck 过、lint 零错误、全部单测过（含 settings 新增 3 条）。

- [ ] **步骤 2：更新清单**

将 `PROGRESS.md` 任务 6 勾选并置「已完成」。

---

### 任务 7：双主题运行时验证（无头截图）

**前置：** 命令在仓库根执行；`NOVEL_CLIENT_SCREENSHOT` 到点截图后自动退出（main.ts 既有钩子）。

- [ ] **步骤 1：浅色截图**

运行：`NOVEL_CLIENT_THEME=light NOVEL_CLIENT_SCREENSHOT=/tmp/client-light.png bun run dev:client`
预期：进程自动退出，`/tmp/client-light.png` 生成，观感与改造前浅色一致。

- [ ] **步骤 2：暗色截图**

运行：`NOVEL_CLIENT_THEME=dark NOVEL_CLIENT_SCREENSHOT=/tmp/client-dark.png bun run dev:client`
预期：`/tmp/client-dark.png` 生成——深底浅字、无白块残留（重点看头部/三栏/弹窗遮罩区）。

- [ ] **步骤 3：目测评审**

Read 两张 PNG 逐项目测：背景层级（app < panel 对比清晰）、文字四级可读、primary/danger 按钮白字对比、选中项蓝底、滚动条随主题。任一项不过 → 回任务 4 微调对应暗色变量后重截。

- [ ] **步骤 4：更新清单**

将 `PROGRESS.md` 任务 7 勾选并置「已完成」（记录截图路径供验收引用）。

---

### 任务 8：文档同步与原子提交

**文件：**
- 修改：`PROGRESS.md`、`ARCHITECTURE.md`、`AGENTS.md`、`DECISIONS.md`

- [ ] **步骤 1：PROGRESS.md 清单归一**

「进行中」整体清单删除，归一为一条完成记录（时间 2026-10-02、类型 [feat]、范围、AC：typecheck/lint/test 全过 + 双主题截图实证；人工验收项如实注明）。已完成区域超过 5 条时按约定将最旧条目滚入「历史归档」滚动摘要。

- [ ] **步骤 2：ARCHITECTURE.md 同步**

`apps/client` 主进程描述段补：主题机制（settings.theme → applyTheme → nativeTheme.themeSource、backgroundColor 随 shouldUseDarkColors、updated 监听）、诊断钩子清单加 `NOVEL_CLIENT_THEME`；renderer 描述补 SettingsDialog「外观」主题三选与 styles.css 变量化暗色媒体查询。

- [ ] **步骤 3：AGENTS.md 同步**

「目录结构与模块划分」apps/client 条目：main.ts 描述加主题接线与 `NOVEL_CLIENT_THEME` 钩子；SettingsDialog 描述加「外观」分组；styles 相关描述补暗黑模式（默认跟随系统、保存即生效）。

- [ ] **步骤 4：DECISIONS.md 追加决策**

记录：主题机制选型（nativeTheme + 媒体查询，否决 data-theme 与逐条硬覆盖的权衡）、强调填充与文字色暗色分化（--accent-emphasis 等四变量）、诊断钩子 NOVEL_CLIENT_THEME 的引入理由。

- [ ] **步骤 5：原子提交**

```bash
git add apps/client PROGRESS.md ARCHITECTURE.md AGENTS.md DECISIONS.md
git commit -m "feat(client): 客户端暗黑模式——默认跟随系统，设置弹窗三选即时生效

- settings.theme（system/light/dark）经 nativeTheme.themeSource 覆盖 prefers-color-scheme，renderer 零主题 JS，保存即生效
- styles.css 31 个语义变量 + 暗色媒体查询（GitHub Primer Dark 基准），窗口底色随主题防白闪
- SettingsDialog「外观」分组三选；诊断钩子 NOVEL_CLIENT_THEME 支持无头双主题截图
- AC：typecheck/lint/test 全过（settings 新增 3 用例）；NOVEL_CLIENT_THEME=light/dark 截图目测通过"
```

- [ ] **步骤 6：人工验收交接**

向用户列出人工验收项：系统主题运行中切换（主题=跟随系统）、弹窗内切换保存即生效、暗色下六界面过目（三栏浏览 / 创作页 / 章节规划页 / 大纲重生成页 / 设置弹窗 / 删除确认弹窗）。

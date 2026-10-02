# 客户端暗黑模式设计规格

> 状态：已确认（2026-10-02，切换能力与实现方案经用户选择确认）
> 关联：`docs/superpowers/specs/2026-09-21-client-browse-ui-design.md`（三栏浏览 UI）、`apps/client/electron/settings.ts`（设置存储）

## 背景与目标

客户端界面为单一浅色主题（`styles.css` 766 行硬编码 hex 颜色，约 27 种，GitHub Light 风格），夜间使用刺眼。本次改造：

- 新增暗黑主题，**默认跟随系统主题**
- 设置弹窗提供手动切换：跟随系统（默认）/ 浅色 / 深色，保存后**即时生效**
- 浅色观感不回归（变量化只换写法、不换值；唯二例外是两处近似色归并 #d5dae1→`--border-strong`、#8a929c→`--fg-subtle`，色差肉眼不可辨）

## 用户已确认的决策

1. **切换能力**：手动切换 + 默认跟随系统；入口在设置弹窗（不做头部快捷按钮）
2. **实现方案**：主进程 `nativeTheme.themeSource` + CSS `@media (prefers-color-scheme: dark)`（方案 A）——渲染层零主题 JS；否决 renderer `data-theme` 属性方案（启动白闪、双套逻辑）与媒体查询内逐条硬覆盖方案（样式行数翻倍）

## 主题机制

数据流：`userData/settings.json`（`theme` 字段）→ main 进程 `nativeTheme.themeSource` → Chromium 覆盖 renderer 的 `prefers-color-scheme` 媒体查询 → CSS 变量整组切换。

- **settings 层**（`electron/settings.ts`）：`AppSettings` 新增 `theme: "system" | "light" | "dark"`，`DEFAULT_SETTINGS.theme = "system"`；`normalizeSettings` 对 `theme` 做枚举归一（非三个合法值一律回 `"system"`，与既有「未知字段忽略」前向兼容机制一致——旧 settings.json 无 theme 字段自动落默认）。本模块保持不 import electron、bun:test 可测。
- **main 进程**（`electron/main.ts`）：
  - 启动时读设置，`nativeTheme.themeSource = settings.theme`（`"system" | "light" | "dark"` 与 Electron 原生三态枚举一一对应，零转换）
  - `settings:save` IPC 保存成功后重新应用 `themeSource`——**保存即生效**（Chromium 立即重算媒体查询，无需重启、无需 renderer 参与）
  - 防启动白闪：`createWindow` 按 `nativeTheme.shouldUseDarkColors` 传 `backgroundColor`（暗 `#0d1117` / 亮 `#f6f7f9`）；`nativeTheme.on("updated")` 时同步 `win.setBackgroundColor`——主题为「跟随系统」时系统运行中切换，窗口底色与页面同步跟随
- **CSS**（`src/styles.css`）：`:root` 声明全部颜色变量与 `color-scheme: light dark`；`@media (prefers-color-scheme: dark)` 内整组覆盖暗色值（`color-scheme` 随之切换，滚动条与原生表单控件自动适配）
- **renderer**：零新增逻辑（SettingsDialog 仅读写既有 getSettings/saveSettings IPC；preload / env.d.ts 零改动）

## CSS 变量化映射表

27 种硬编码色 + 3 处 rgba 阴影/遮罩归并为 28 个语义变量（27 种 hex 归并掉 2 个近似色后剩 25 个，加 3 个阴影/遮罩变量）。浅色列为现状值（逐像素保持）；暗色列以 GitHub Primer Dark 为基准映射（现有浅色即 GitHub Light 风格，深浅同源观感协调）。视觉微调允许在验收轮进行，以目测通过为准。

### 背景（11）

| 变量 | 浅色 | 暗色 | 用途 |
| --- | --- | --- | --- |
| `--bg-app` | `#f6f7f9` | `#0d1117` | body 全局底色 |
| `--bg-panel` | `#fff` | `#151b23` | 卡片/面板/弹窗白底 |
| `--bg-sidebar` | `#fbfbfc` | `#10151c` | 左栏书库底色 |
| `--bg-subtle` | `#eef0f3` | `#21262d` | 悬停底、标签片、选项底 |
| `--bg-button-hover` | `#f3f4f6` | `#21262d` | 次级按钮悬停 |
| `--bg-accent-subtle` | `#e8effd` | `#121d2f` | 选中项/当前阶段蓝底 |
| `--bg-disabled` | `#d5d9df` | `#21262d` | 禁用态底 |
| `--bg-success-subtle` | `#dcfce7` | `#0f2417` | 成功提示底 |
| `--bg-danger-subtle` | `#fef3f2` | `#25171c` | 危险警示底 |
| `--bg-danger-soft` | `#fee4e2` | `#312229` | 危险文字按钮悬停 |
| `--bg-warning-subtle` | `#fffbeb` | `#272115` | 警告提示底 |

### 边框（5）

| 变量 | 浅色 | 暗色 | 用途 |
| --- | --- | --- | --- |
| `--border-default` | `#e4e7eb` | `#3d444d` | 常规边框/分隔线 |
| `--border-strong` | `#d0d7de` | `#4b535e` | 输入框/复选框边框（#d5dae1 并入） |
| `--border-disabled` | `#b6bcc4` | `#2a3138` | 禁用态边框 |
| `--border-danger` | `#fecdca` | `#931c2e` | 危险警示边框 |
| `--border-warning` | `#fde68a` | `#9e6a03` | 警告提示边框 |

### 文字（4）

| 变量 | 浅色 | 暗色 | 用途 |
| --- | --- | --- | --- |
| `--fg-default` | `#1f2328` | `#f0f3f6` | 主文字 |
| `--fg-muted` | `#6a737d` | `#9198a1` | 次要文字/标签 |
| `--fg-subtle` | `#9aa1ab` | `#656c76` | 占位/提示文字（#8a929c 并入） |
| `--fg-notify` | `#424a53` | `#d1d7de` | 会话通知文字 |

### 语义色（5）

| 变量 | 浅色 | 暗色 | 用途 |
| --- | --- | --- | --- |
| `--accent` | `#2563eb` | `#4493f8` | 主色（按钮/选中/徽标） |
| `--accent-strong` | `#1d4ed8` | `#388bfd` | 主色悬停/链接 |
| `--danger` | `#b42318` | `#f85149` | 危险文字/主按钮 |
| `--danger-strong` | `#912018` | `#da3633` | 危险按钮悬停 |
| `--success` | `#15803d` | `#3fb950` | 成功文字 |

### 层级（3）

| 变量 | 浅色 | 暗色 | 用途 |
| --- | --- | --- | --- |
| `--overlay` | `rgba(31,35,40,0.45)` | `rgba(1,4,9,0.6)` | 弹窗遮罩 |
| `--shadow-popover` | `0 6px 20px rgba(31,35,40,0.14)` | `0 6px 20px rgba(1,4,9,0.4)` | 浮层阴影 |
| `--shadow-modal` | `0 12px 32px rgba(31,35,40,0.22)` | `0 12px 32px rgba(1,4,9,0.5)` | 模态阴影 |

归并说明：#d5dae1（设置输入框边框）并入 `--border-strong`；#8a929c（提示文字）并入 `--fg-subtle`；#eef0f3 与 #f3f4f6 职责不同（通用悬停底 / 次级按钮悬停）保留两变量。深浅两套值同处一个文件（`:root` + 一个媒体查询块），颜色只此两处，不再有第三份。

## 设置弹窗 UI

- `SettingsDialog` 顶部新增「外观」分组：主题分段三选（跟随系统 / 浅色 / 深色），置于 Agent 与写作模型两组字段上方
- 随既有「保存」按钮一次 IPC（`settings:save`）落盘并即时生效；弹窗既有说明区补一句「主题保存后立即生效」（模型配置仍为下一次会话生效，两者语义区分明示）
- 状态管理沿用弹窗既有本地草稿模式：读取时回填、保存时统一提交

## 测试与验收

- **单测**（`settings.test.ts` 增用例）：theme 默认 system；非法值（字符串越界/非字符串）归 system；三个合法值透传；读写往返保留 theme
- **运行时验证**：
  - 无头截图双主题各一张（临时 settings.json 指定 light / dark + `NOVEL_CLIENT_SCREENSHOT` 钩子），目测暗色观感与浅色不回归
  - SSR 冒烟不回归
- **人工验收项**：系统主题运行中切换（主题=跟随系统）实时生效；弹窗内切换保存后立即生效；暗色下六界面过目——三栏浏览 / 创作页 / 章节规划页 / 大纲重生成页 / 设置弹窗 / 删除确认弹窗

## 边界情况

| 场景 | 行为 |
| --- | --- |
| 旧 settings.json 无 theme 字段 | `normalizeSettings` 归默认 `system`（既有前向兼容机制） |
| 手工编辑 settings.json 写入非法 theme 值 | 归 `system` |
| 主题=跟随系统，系统运行中切换主题 | `nativeTheme updated` → CSS 媒体查询自动重算 + 窗口底色同步 |
| 主题=浅色/深色，系统运行中切换 | 客户端不变（`themeSource` 已钉死，语义即「手动覆盖」） |
| 诊断截图钩子 | 输出跟随当前生效主题，无特殊处理 |

## 不做范围

- agent 与 `@novel/shared` 零改动（theme 是纯客户端偏好，不进协议、不进数据库）
- 不做定时自动切换（如「夜间自动深色」）
- 不做头部快捷切换按钮
- 不改浅色观感（变量化后浅色值与现状一致）
- 不引入新 npm 依赖（纯 Electron 内置 `nativeTheme` + CSS 原生能力）

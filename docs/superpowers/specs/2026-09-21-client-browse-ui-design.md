# 客户端三栏浏览 UI 设计规格

> 状态：已确认（2026-09-21，三项关键决策经用户选择确认）
> 关联：`docs/superpowers/specs/2026-09-19-monorepo-electron-client-design.md`（客户端 v1 设计）

## 背景与目标

客户端 v1 为单栏问答流 UI（App 状态机 + StageBar / ViewCard / QuestionCard），只能进行「一次创作会话」，无法回看已入库的小说。本次改造为三栏浏览主界面：

- **左栏（可折叠）**：小说列表，数据来自 novels 表，仅展示名称
- **中栏**：小说结构组成树——世界观 / 角色 / 大纲 三类
- **右栏**：内容预览区，点击结构树节点后展示对应视图
- **创作视图**：点击「新建小说」后，创作对话视图**覆盖在中栏与右栏上方**（左栏保持可见）；完成后关闭覆盖层、刷新列表并选中新小说

## 用户已确认的决策

1. **布局形态**：三栏常驻 + 顶栏汉堡按钮折叠/展开左栏（IDE 风格，非抽屉浮层）
2. **创作共存方式**：新建创作视图覆盖中+右栏区域，左栏小说列表保持可见
3. **数据读取架构**：agent 侧新增一次性查询 CLI 入口（spawn bun 子进程取 stdout JSON），复用 store 层与 zod 校验；不在 Electron 主进程直读 SQLite

## 布局

```text
┌──────────────────────────────────────────────────────┐
│ ☰  📖 novel-agent                        ＋ 新建小说   │ 顶栏
├───────────┬──────────────────┬────────────────────────┤
│ 小说列表    │ 结构树            │ 内容预览                │
│ (折叠时隐藏) │ 🌍 世界观         │ （复用 ViewCard 渲染）   │
│ · 小说 A    │ 👥 角色           │                        │
│ · 小说 B    │   · 主角 XX       │                        │
│           │ 📖 大纲           │                        │
│           │   · 第一部        │                        │
│           │     · 幕 1 …      │                        │
├───────────┴──────────────────┴────────────────────────┤
│        创作视图（覆盖中+右栏，左栏仍可见）                 │
└──────────────────────────────────────────────────────┘
```

## 数据流

### 1. shared 查询 schema（`packages/shared/src/query.ts`）

- `novelListItemSchema`：`{ id, name: string | null, createdAt, updatedAt }`（name 在大纲确认后才回填，可能为 null）
- `novelDetailSchema`：`{ novel: NovelListItem, worldview: Worldview | null, characters: Character[], outline: Outline | null }`
- 与 protocol.ts 同级导出，供 agent 序列化与 client 主进程 zod 复验共用

### 2. agent 查询入口（`apps/agent/src/query.ts`）

一次性 CLI（区别于长驻的 headless.ts）：

- `bun run apps/agent/src/query.ts list` → stdout 单行 JSON：`NovelListItem[]`（按 createdAt 降序，新作品在前）
- `bun run apps/agent/src/query.ts get <novelId>` → stdout 单行 JSON：`NovelDetail`
  - `worldview`：`WorldviewStore.getWorldview(id)` ?? null
  - `characters`：`CharacterStore.listCharacters(id)`
  - `outline`：读 `output/<novelId>.json`（`outlineFilePath` + `outlineSchema` 校验），缺失或不合法 → null
- 失败（库错误 / 小说不存在 / 参数缺失）→ stderr 错误信息 + exit 非零
- 依赖变更：`NovelStore` 新增 `listNovels()`

**大纲数据来源说明**：outlines 表仅存树节点（name/sort/version），title / logline / summary / keyPlotPoints 等完整结构只存在于落盘产物 `output/<id>.json`；两处在确认流程中同步写入、一一对应，故大纲的树与预览统一取 JSON。未生成大纲（或产物被删）的小说，「大纲」节点展示为缺失态。

### 3. Electron 主进程 / preload

- `ipcMain.handle("library:list")` / `ipcMain.handle("library:get", id)`：spawn `bun run apps/agent/src/query.ts …`（cwd=仓库根，注入 `NOVEL_DB_PATH` / `NOVEL_OUTPUT_DIR` 绝对路径，与 AgentProcess 一致），收集 stdout、zod 复验（与 agentMessage 复验同模式）后返回；超时（8s）或非零退出 → reject，renderer 展示错误态
- preload：`window.agent.listNovels(): Promise<NovelListItem[]>`、`window.agent.getNovelDetail(id): Promise<NovelDetail>`

### 4. renderer 组件

| 组件 | 职责 |
| --- | --- |
| `App.tsx` | 布局壳：顶栏（汉堡折叠 + 标题 + 新建按钮）、三栏容器、创作覆盖层开关；持有 novels / selectedId / detail / selection 全局状态 |
| `CreationFlow.tsx` | 现有问答流逻辑**整体抽取**（phase 状态机 + StageBar / QuestionCard / ViewCard + finished / error 面板），props：`onFinished(novelId)`（run_finished 回调）、`onClose`（关闭=终止 agent 并返回浏览） |
| `NovelListPanel.tsx` | 左栏：小说列表（name ?? 「未命名小说」+ id 前 8 位），选中高亮，刷新按钮，加载/空态 |
| `StructureTreePanel.tsx` | 中栏：固定三类分组；世界观单节点、角色每人一节点、大纲部→幕两级（取 outline.parts/acts）；点击节点更新 selection |
| `PreviewPane.tsx` | 右栏：按 selection 从 detail 构造 View（worldview / character-card / outline full）交给现有 `ViewCard` 渲染；空态提示 |

联动关系：

- 选中小说 → 加载 detail → 结构树渲染；detail 加载失败/为空各分支有对应提示
- 创作完成（run_finished）→ 关闭覆盖层 → 刷新列表 → 自动选中新小说并加载 detail
- 创作中途手动关闭 / 出错退出 → 关闭覆盖层 → 刷新列表（世界观 / 角色中途已增量落库，刷新后可见），不自动选中
- 创作进行中「新建小说」按钮禁用（AgentProcess 单会话）
- 无头冒烟（`NOVEL_CLIENT_SCREENSHOT`）不再依赖 `NOVEL_CLIENT_AUTOSTART`：默认截三栏浏览态（读真实 data/novel.db）；AUTOSTART 仍保留用于创作流冒烟（覆盖层形态）

## 任务拆分（同步落盘 PROGRESS.md「进行中」）

1. **shared 查询 schema**：`packages/shared/src/query.ts` + 导出 + schema 单测
2. **agent 查询 CLI**：`NovelStore.listNovels()` + `apps/agent/src/query.ts`（list / get）+ bun:test（临时库覆盖空库 / 未命名 / outline 缺失 / 不存在 ID）
3. **client 主进程与 preload**：library IPC handler（spawn + zod 复验 + 超时错误处理）+ preload 暴露 + env.d.ts 类型
4. **renderer 骨架重构**：三栏布局 + 顶栏汉堡折叠 + `CreationFlow` 抽取（问答流行为不回归）+ 样式
5. **renderer 数据接入**：NovelListPanel / StructureTreePanel / PreviewPane + 创作完成联动刷新选中
6. **端到端验证与文档同步**：typecheck（3 工程）/ lint / test + 无头冒烟截图（三栏态）；同步 AGENTS.md / 根 ARCHITECTURE.md / PROGRESS.md 归一 / DECISIONS.md；原子提交

## 验收标准（AC）

1. `bun run typecheck`、`bun run lint`、`bun run test` 全过（新增 query CLI 单测）
2. `bun run apps/agent/src/query.ts list` / `get <id>` 输出合法 JSON 且过 shared schema；空库时 list 返回 `[]`；get 不存在 ID 非零退出
3. 无头冒烟截图呈现三栏布局：左栏列出 data/novel.db 中的真实小说名称；点选后中栏出现三类结构树（人工 / 截图核验）
4. 「新建小说」→ 覆盖层出现创作问答流（覆盖中+右栏、左栏可见）；完成后自动关闭覆盖层、列表刷新并选中新作
5. GUI 交互观感与创作全流程由用户人工验收（`bun run dev:client`）

## 不做范围（Out of Scope）

- 不改 agent 创作工作流与 headless 协议本身（无新协议消息，query CLI 为独立入口）
- 不改数据库 schema（无迁移、无新表；NovelStore 仅新增只读 list 方法）
- 不做小说删除 / 重命名 / 编辑（纯只读浏览）
- 冲突（coreConflict）未持久化入库，浏览界面不展示（用户要求的三类与现有四张表能力对齐）
- 不引入 UI 组件库 / 路由（维持现有轻量 React + 手写样式）

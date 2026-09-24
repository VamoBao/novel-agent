# novel-agent

一个基于 Bun + TypeScript 构建的交互式小说创作 AI Agent 应用（Bun workspaces monorepo：CLI 应用 `apps/agent` + 共享 schema 包 `packages/shared`，Electron 客户端 `apps/client` 建设中）：通过类型/受众问答、世界观 / 角色 / 核心冲突的多轮收集确认、两级大纲（部→幕）生成确认与第一幕章节规划（章名 + 剧情概述，确认后入库），完成小说前期设定与写作准备，并按 UUIDv7 创作 ID 持久化到 SQLite 与 `output/` 落盘。CLI 入口 `apps/agent/src/index.ts`。

## 技术栈

- 运行时：Bun 1.4（`bun.lock` 锁定依赖，`bun install` 安装）
- 仓库结构：Bun workspaces monorepo（根 `package.json` 编排 `apps/*` 与 `packages/*`，共享编译选项收敛于 `tsconfig.base.json`）
- 语言：TypeScript 6（`tsconfig.json` 开启 `strict`、`noUncheckedIndexedAccess`、`noImplicitOverride` 等严格选项）
- LLM 接入：Vercel AI SDK 7（`ai`）+ 官方 `@ai-sdk/deepseek` provider，工具参数 schema 用 zod 4
- 数据库：SQLite（Bun 内置 `bun:sqlite`，库文件 `data/novel.db`，路径可用 `NOVEL_DB_PATH` 覆盖）
- 静态检查：ESLint 10 + typescript-eslint 8（`eslint.config.js` 扁平配置）
- 测试：Bun 内置测试运行器（`bun:test`，测试文件命名为 `*.test.ts`）

## 常用命令

| 用途 | 命令 |
| --- | --- |
| 安装依赖 | `bun install` |
| 运行入口 | `bun run dev` |
| 协议模式运行 | `bun run headless` |
| Electron 客户端 | `bun run dev:client` |
| 类型检查 | `bun run typecheck` |
| Lint 检查 | `bun run lint` |
| 单元测试 | `bun run test` |

## 目录结构与模块划分

项目为 Bun workspaces monorepo，两个工作区按职责分层（Electron 客户端 `apps/client` 建设中）：

- `apps/agent/`：`@novel/agent`——小说创作 CLI 应用（原 `src/` 整体迁入，内部分层与依赖边界不变）
  - `src/index.ts`：CLI 应用入口（Key 检查、触发主工作流，不承载业务逻辑）
  - `src/headless.ts`：协议模式入口——stdio JSON 行协议（hello 握手、消息分发、EOF/SIGTERM 收尾），由 Electron 等宿主进程 spawn；argv 选会话模式（无参 = 新建小说全流程，`plan-chapters <novelId> <actNodeId>` = 单幕章节规划）
  - `src/query.ts`：库查询与管理入口——一次性 CLI（查询：`list` 列小说 / `get <novelId>` 取世界观+角色+大纲节点资料——大纲读 outlines 表当前版本节点，不再读 output 产物；管理：`rename` / `pin` / `unpin` / `favorite` / `unfavorite` / `delete`），stdout 单行 JSON（契约见 shared query.ts），即起即退
  - `src/cli/prompt.ts`：终端输入原语（TTY/管道双模式，EOF 优雅中止，并发读取串行化）
  - `src/ui/`：交互通道层——`channel.ts` UiChannel 接口 + `aborted.ts` 中止异常 + `cli-channel.ts` 终端实现（含角色卡/大纲等视图渲染）+ `protocol-channel.ts` stdio JSON 协议实现 + `fake-channel.ts` 测试替身；业务层交互与输出的唯一出口（ESLint 边界规则强制）
  - `src/providers/`：LLM 接入层（`deepseek.ts`：Key 读 `DEEPSEEK_API_KEY`，模型读 `DEEPSEEK_MODEL_NAME`，默认 `deepseek-flash`）
  - `src/agents/react.ts`：通用 ReAct Agent 运行器（终态工具模式 + 未完成自动续跑）
  - `src/tools/`：提供给 LLM 使用的通用工具（`ask-user.ts` 工厂函数，按 Agent 标签生成），经 `tools/index.ts` 汇总导出；workflow 私有终态工具在对应 agent 文件内定义
  - `src/state/`：小说创作状态与持久化（`NovelStateStore` 接口 + 内存实现 + UUIDv7 生成；`db.ts` 建库建表（novels / characters / worldviews / outlines / locations / foreshadows，外键关联），`novel-store.ts`/`character-store.ts`/`worldview-store.ts`/`outline-store.ts`/`location-store.ts`/`foreshadow-store.ts` 按 UUIDv7 创作 ID 落 SQLite）
  - `src/output/`：产物落盘（大纲按创作 ID 保存为 `output/<id>.json`；`readOutlineTheme` 尽力读取产物主题供单幕章节规划）
  - `src/workflows/`：工作流编排（`create-novel.ts` 新建小说主流程 + `plan-act-chapters.ts` 单幕章节规划会话 + `agents/` 下 worldview / character / outline / chapter 四个 subAgent；本模块已建立模块级状态文档 `apps/agent/src/workflows/ARCHITECTURE.md` 与 `PROGRESS.md`）
- `packages/shared/`：`@novel/shared`——双端共享的纯 zod 层：领域 schema（worldview / character / location / foreshadow / conflict / outline / chapter-plan / audience / outline-node，原 `src/schemas/` 迁出）+ 展示视图 schema（views.ts）+ stdio JSON 协议消息 schema（protocol.ts，含 `AgentStartOptions` 会话启动参数类型）+ 库查询结果契约（query.ts）；agent 与客户端共同引用，零运行时依赖
- `apps/client/`：`@novel/client`——Electron 桌面客户端（electron-vite 三段式 + React，三栏浏览 + 整页会话创作 / 章节规划）
  - `electron/main.ts`：主进程——窗口管理 + AgentProcess（spawn `bun run apps/agent/src/headless.ts`——`AgentStartOptions` 映射 argv 选会话模式、协议消息 zod 复验后 IPC 转发、hello 协议版本校验、退出回收）+ library 查询 / 管理 IPC（spawn `apps/agent/src/query.ts`、shared schema 复验、超时兜底）；WSL2 需禁 GPU/sandbox；`NOVEL_CLIENT_AUTOSTART` / `NOVEL_CLIENT_SELECT` / `NOVEL_CLIENT_SCREENSHOT` 为诊断钩子（自动开创作页 / 自动选中预览 / 无头截图）
  - `electron/preload.ts`：contextBridge 暴露最小 API（start（携带会话参数）/ stop / respond / onMessage / onExit / listNovels / getNovelDetail / renameNovel / setNovelPinned / setNovelFavorite / deleteNovel / 诊断钩子读取）
  - `src/`：renderer（React）——App 页面级切换：三栏浏览主页（左栏书库可汉堡折叠，右键菜单管理：重命名 / 置顶 / 收藏 / 删除——删除走 DeleteNovelDialog 输入小说名强确认；中栏世界观·角色·大纲结构树——大纲读 outlines 表节点，点击节点右栏按节点展示，幕卡对未规划幕显示「规划本幕章节」入口；右栏预览）↔ 独立创作页（CreationFlow 问答流，整页呈现、头部返回书库）↔ 独立章节规划页（ChapterPlanFlow：单幕规划问答流，与 CreationFlow 共用 hooks/use-agent-session 会话泵，完成回浏览页刷新详情保持选中该幕）+ NovelListPanel / StructureTreePanel / PreviewPane / OutlineNodeCard 大纲节点卡（幕卡含规划入口：已规划隐藏 / 旧数据禁用） / DeleteNovelDialog 删除强确认 / StageBar 七阶段进度 / ViewCard 只读视图 / QuestionCard 五类提问输入
- `docs/`：Agent 工作流指导文档（需求 / 提交 / 修 Bug 三份指引）；`docs/superpowers/specs/` 存放前期设计规格（如 monorepo 与 Electron 客户端设计，状态以文首标注为准）
- `files/`：本地参考资料（`prompt.md` 原始工作流需求、`role.md` 角色属性设计参考），已 gitignore
- `.env.example`：环境变量样例（`.env` 已 gitignore，Bun 自动加载）
- `docker-compose.yaml`：本地辅助——sqlite-web 网页查看 `data/novel.db`（宿主 8081 端口，非应用运行时依赖）
- `eslint.config.js`、`tsconfig.base.json`：根统一静态检查与共享编译配置（各工作区 `tsconfig.json` 继承 base）

依赖方向（apps/agent 内）：`workflows/ → agents/ + tools/ + ui/ + state/ + @novel/shared + output/ + cli/ + providers/`，下层不得反向依赖上层；`ui/`（交互通道层）依赖 `cli/`（终端原语）与 `@novel/shared`（视图类型），`cli/` 仅依赖 node 内置与 `ui/aborted`；`@novel/shared` 不依赖任何工作区（详见根目录 `ARCHITECTURE.md`）。

> **维护约定**：当项目发生重大修改（新增目录或模块、调整模块职责与边界、技术栈变动）时，Agent 须同步更新本节，保持入口文档与项目实际结构一致。

## 工作流（Agent 必读）

每次执行用户需求前，按以下顺序工作：

1. 先读本文件了解项目结构与约定，再读取状态文档：项目级状态文档在仓库根目录（`ARCHITECTURE.md` 与 `PROGRESS.md`）；需求落在已建立模块文档的目录（当前为 `apps/agent/src/workflows/`）时，同时读取该模块目录内的同名文档。缺失则视为新建模块/新层级，在任务过程中按需创建
2. 按任务类型读取对应指引：
   - 新需求开发：[`docs/feature-check-guide.md`](docs/feature-check-guide.md)
   - 修复 Bug / 处理报错：[`docs/bug-fix-guide.md`](docs/bug-fix-guide.md)
   - 执行提交前读取 [`docs/git-commit-guide.md`](docs/git-commit-guide.md)（需求完成后 Agent 自动执行原子提交时同样遵循）
3. 完成后按指引要求同步更新状态文档（见下方约定）

## 状态文档约定

状态文档分两级维护，由 Agent 在任务过程中按需创建与更新：项目级放仓库根目录；结构与职责足够独立、已建立模块文档的模块目录（当前为 `apps/agent/src/workflows/`）内放模块级同名文档：

- `ARCHITECTURE.md`：模块架构蓝图、文件职责与依赖边界
- `PROGRESS.md`：进度与已知 Bug（含「进行中」任务清单、「已完成」总结与「历史归档」滚动摘要；已完成仅保留最近 5 条；时间格式统一为 `YYYY-MM-DD`）
- `DECISIONS.md`：重大决策记录（决策背景、备选方案、权衡依据与结论）

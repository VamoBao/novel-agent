# novel-agent

一个基于 Bun + TypeScript 构建的交互式小说创作 AI Agent 应用（CLI 形态，入口为 `src/index.ts`）：通过类型/受众问答、世界观 / 角色 / 核心冲突的多轮收集确认、两级大纲（部→幕）生成确认，完成小说前期设定，并按 UUIDv7 创作 ID 持久化到 SQLite 与 `output/` 落盘。

## 技术栈

- 运行时：Bun 1.4（`bun.lock` 锁定依赖，`bun install` 安装）
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
| 类型检查 | `bun run typecheck` |
| Lint 检查 | `bun run lint` |
| 单元测试 | `bun run test` |

## 目录结构与模块划分

项目为单模块，源码集中在 `src/` 下按职责分层：

- `src/index.ts`：应用入口（Key 检查、触发主工作流，不承载业务逻辑）
- `src/cli/prompt.ts`：交互输入原语（TTY/管道双模式，EOF 优雅中止）
- `src/schemas/`：zod schema 层（worldview / character / conflict / outline / audience / outline-node）
- `src/providers/`：LLM 接入层（`deepseek.ts`：Key 读 `DEEPSEEK_API_KEY`，模型读 `DEEPSEEK_MODEL_NAME`，默认 `deepseek-flash`）
- `src/agents/react.ts`：通用 ReAct Agent 运行器（终态工具模式 + 未完成自动续跑）
- `src/tools/`：提供给 LLM 使用的通用工具（`ask-user.ts` 工厂函数，按 Agent 标签生成），经 `tools/index.ts` 汇总导出；workflow 私有终态工具在对应 agent 文件内定义
- `src/state/`：小说创作状态与持久化（`NovelStateStore` 接口 + 内存实现 + UUIDv7 生成；`db.ts` 建库建表（novels / characters / worldviews / outlines，外键关联），`novel-store.ts`/`character-store.ts`/`worldview-store.ts`/`outline-store.ts` 按 UUIDv7 创作 ID 落 SQLite）
- `src/output/`：产物落盘（大纲按创作 ID 保存为 `output/<id>.json`）
- `src/workflows/`：工作流编排（`create-novel.ts` 主流程 + `agents/` 下 worldview / character / outline 三个 subAgent；本模块已建立模块级状态文档 `src/workflows/ARCHITECTURE.md` 与 `src/workflows/PROGRESS.md`）
- `docs/`：Agent 工作流指导文档（需求 / 提交 / 修 Bug 三份指引）；`docs/superpowers/specs/` 存放前期设计规格（如 monorepo 与 Electron 客户端设计，状态以文首标注为准）
- `files/`：本地参考资料（`prompt.md` 原始工作流需求、`role.md` 角色属性设计参考），已 gitignore
- `.env.example`：环境变量样例（`.env` 已 gitignore，Bun 自动加载）
- `docker-compose.yaml`：本地辅助——sqlite-web 网页查看 `data/novel.db`（宿主 8081 端口，非应用运行时依赖）
- `eslint.config.js`、`tsconfig.json`：静态检查与编译配置

依赖方向：`workflows/ → agents/ + tools/ + state/ + schemas/ + output/ + cli/ + providers/`，下层不得反向依赖上层（详见根目录 `ARCHITECTURE.md`）。

> **维护约定**：当项目发生重大修改（新增目录或模块、调整模块职责与边界、技术栈变动）时，Agent 须同步更新本节，保持入口文档与项目实际结构一致。

## 工作流（Agent 必读）

每次执行用户需求前，按以下顺序工作：

1. 先读本文件了解项目结构与约定，再读取状态文档：项目级状态文档在仓库根目录（`ARCHITECTURE.md` 与 `PROGRESS.md`）；需求落在已建立模块文档的目录（当前为 `src/workflows/`）时，同时读取该模块目录内的同名文档。缺失则视为新建模块/新层级，在任务过程中按需创建
2. 按任务类型读取对应指引：
   - 新需求开发：[`docs/feature-check-guide.md`](docs/feature-check-guide.md)
   - 修复 Bug / 处理报错：[`docs/bug-fix-guide.md`](docs/bug-fix-guide.md)
   - 执行提交前读取 [`docs/git-commit-guide.md`](docs/git-commit-guide.md)（需求完成后 Agent 自动执行原子提交时同样遵循）
3. 完成后按指引要求同步更新状态文档（见下方约定）

## 状态文档约定

状态文档分两级维护，由 Agent 在任务过程中按需创建与更新：项目级放仓库根目录；结构与职责足够独立、已建立模块文档的模块目录（当前为 `src/workflows/`）内放模块级同名文档：

- `ARCHITECTURE.md`：模块架构蓝图、文件职责与依赖边界
- `PROGRESS.md`：进度与已知 Bug（时间格式统一为 `YYYY-MM-DD`）
- `DECISIONS.md`：重大决策记录（决策背景、备选方案、权衡依据与结论）

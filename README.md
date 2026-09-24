# novel-agent

基于 Bun + TypeScript 构建的交互式小说创作 AI Agent 应用：通过类型/受众问答、世界观 / 角色 / 核心冲突的多轮收集确认、两级大纲（部→幕）生成确认，完成小说前期设定，并按 UUIDv7 创作 ID 持久化到 SQLite 与 `output/` 落盘。

项目为 Bun workspaces monorepo，包含三个工作区：

| 工作区 | 包名 | 说明 |
| --- | --- | --- |
| `apps/agent` | `@novel/agent` | 小说创作 CLI 应用（终端交互 + stdio JSON 协议模式 + 库查询管理入口） |
| `packages/shared` | `@novel/shared` | 双端共享的纯 zod 层：领域 schema / 展示视图 / 协议消息 / 查询契约，零运行时依赖 |
| `apps/client` | `@novel/client` | Electron 桌面客户端（electron-vite 三段式 + React，三栏浏览 + 独立创作页） |

## 功能特性

- **多阶段创作工作流**：类型选择 → 受众推断（LLM 生成候选 + 用户多选）→ 世界观（ReAct Agent 多轮追问）→ 角色卡（逐字段「发散丰富 → 确认 → 保存」）→ 核心冲突 → 两级大纲（部→幕，结构强校验 + 确认循环）
- **人机确认门**：世界观提交、角色卡整卡确认、大纲确认均设用户确认环节，拒绝后按反馈修订重提
- **SQLite 持久化**：novels / characters / worldviews / outlines / locations / foreshadows 六表外键关联，主键均为应用层生成的 UUIDv7；schema 以 `PRAGMA user_version` 版本化增量迁移
- **双运行模式**：终端交互模式（CLI）与 stdio JSON 行协议模式（`headless`，供 Electron 等宿主进程 spawn）
- **库查询与管理**：一次性查询 CLI（`query.ts`）：`list` / `get` 查询 + `rename` / `pin` / `unpin` / `favorite` / `unfavorite` / `delete` 管理
- **Electron 客户端**：三栏浏览主页（书库 / 结构树 / 预览，右键菜单管理，删除需输入小说名强确认）↔ 独立创作页（问答流）
- **产物落盘**：大纲按创作 ID 保存为 `output/<id>.json`

## 技术栈

- 运行时：Bun 1.4（`bun.lock` 锁定依赖）
- 语言：TypeScript 6（`strict`、`noUncheckedIndexedAccess` 等严格选项）
- LLM 接入：Vercel AI SDK 7（`ai`）+ 官方 `@ai-sdk/deepseek` provider，工具参数 schema 用 zod 4
- 数据库：SQLite（Bun 内置 `bun:sqlite`）
- 桌面端：Electron + electron-vite + React
- 静态检查：ESLint 10 + typescript-eslint 8（扁平配置）
- 测试：Bun 内置测试运行器（`bun:test`）

## 快速开始

### 环境要求

- [Bun](https://bun.com) 1.4+
- DeepSeek API Key

### 安装与配置

```bash
bun install
cp .env.example .env   # 编辑 .env，填入 DEEPSEEK_API_KEY
```

### 运行

```bash
# 终端交互模式（CLI 主入口）
bun run dev

# 协议模式（stdio JSON 行协议，供宿主进程 spawn）
bun run headless

# Electron 客户端（内部 spawn 协议模式 agent + 库查询 CLI）
bun run dev:client
```

## 常用命令

| 用途 | 命令 |
| --- | --- |
| 安装依赖 | `bun install` |
| 运行入口（CLI） | `bun run dev` |
| 协议模式运行 | `bun run headless` |
| Electron 客户端 | `bun run dev:client` |
| 类型检查 | `bun run typecheck` |
| Lint 检查 | `bun run lint` |
| 单元测试 | `bun run test` |
| 库查询 / 管理 | `bun run apps/agent/src/query.ts list`（或 `get <novelId>` / `rename` / `pin` / `unpin` / `favorite` / `unfavorite` / `delete`，stdout 单行 JSON） |

## 环境变量

Bun 自动加载根目录 `.env`（参考 `.env.example`）：

| 变量 | 必填 | 说明 | 默认值 |
| --- | --- | --- | --- |
| `DEEPSEEK_API_KEY` | 是 | DeepSeek API Key | — |
| `DEEPSEEK_MODEL_NAME` | 否 | 模型名 | `deepseek-flash` |
| `NOVEL_DB_PATH` | 否 | SQLite 库文件路径 | `data/novel.db` |
| `NOVEL_OUTPUT_DIR` | 否 | 大纲产物输出目录 | `output` |

## 数据存储

- **SQLite**（默认 `data/novel.db`）：六张表按 UUIDv7 创作 ID 外键关联——`novels`（小说信息与置顶/收藏标记）、`worldviews`（1:1）、`characters`（1:N）、`outlines`（大纲树，部/幕两级、多版本、内容随节点入库）、`locations`（层级位置，数据层先行）、`foreshadows`（伏笔，完整 CRUD 与回收状态流转，数据层先行）
- **产物落盘**：大纲 JSON 保存为 `output/<id>.json`，仅供留存
- **本地查库辅助**：`docker-compose.yaml` 提供 sqlite-web 网页查看 `data/novel.db`（宿主 8081 端口，非应用运行时依赖）：

  ```bash
  docker compose up -d
  ```

## 更多文档

- [AGENTS.md](AGENTS.md)——Agent 工作流入口（项目结构、约定与状态文档指引）
- [ARCHITECTURE.md](ARCHITECTURE.md)——项目级架构蓝图（分层结构、依赖边界、关键约定）
- [PROGRESS.md](PROGRESS.md)——进度与已知 Bug
- [DECISIONS.md](DECISIONS.md)——重大决策记录
- `apps/agent/src/workflows/`——工作流模块级架构与进度文档
- `docs/`——需求 / 提交 / 修 Bug 三份工作流指引；`docs/superpowers/specs/` 存放前期设计规格

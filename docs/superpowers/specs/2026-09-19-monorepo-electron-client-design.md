# Monorepo 改造 + Electron 客户端设计规格

> 日期：2026-09-19 · 状态：待用户审查 · 关联：根 `ARCHITECTURE.md`、`PROGRESS.md`、`AGENTS.md`

## 1. 背景与目标

novel-agent 当前是单模块 Bun CLI 应用（`src/` 分层：cli / schemas / providers / agents / tools / state / output / workflows）。本需求为其添加 Electron 桌面客户端，并将仓库改造为 monorepo 管理。

**v1 成功标准：**

- 开发模式一键启动（一条命令同时起 Electron 与 agent），从客户端完成一条完整创作流程（类型 → 受众 → 世界观 → 角色 → 冲突 → 大纲），数据照常入库与落盘
- CLI 入口保留且行为零回归（现有 59 用例全过 + 手动冒烟）
- 施工按原子提交序列推进，每步独立可验证、可回滚

## 2. 关键决策

| # | 决策 | 理由 |
| --- | --- | --- |
| D1 | **agent 以独立 Bun 进程运行**：Electron 只做 UI 壳，主进程 spawn agent 子进程，经 stdio JSON 行通信 | 保住 Bun 运行时（`bun:sqlite`、`Bun.randomUUIDv7`、`bun:test` 原样不动）；进程隔离崩溃（agent 崩不闪退 UI，可单独重启） |
| D2 | **agent 放 `apps/`**，不放 `packages/` | agent 是「有独立入口、独立运行时、可单独执行」的产品单元；`packages/` 只放被链接复用的库 |
| D3 | **`packages/shared` 承载领域 schemas + 协议消息定义** | 协议消息需引用角色卡/大纲结构（zod 即类型），client 渲染确认视图也需同一份类型；放 agent 内则 client 需反向依赖，违反依赖方向约定 |
| D4 | **v1 范围 = 复刻问答流** | 协议与 UI 骨架一次做对，数据浏览类功能（作品列表、角色卡/大纲浏览）留 v2 |
| D5 | **client 用 React + electron-vite** | 生态最大，后续大纲树/表单类界面方案多；工具链成熟 |
| D6 | **Bun workspaces 管 monorepo**（根 `package.json` `workspaces: ["apps/*", "packages/*"]`） | 两 app 一包的规模不值引入 turborepo/nx |

**已否决的备选：**

- 嵌入 Electron 主进程（Node 运行时）：须剥离全部 Bun 专属依赖（DB 层换 better-sqlite3、UUIDv7 自实现）、交互层全部重做、测试迁移——改造量大且丧失 Bun 优势
- 核心抽包 + 双入口（agent-core 入 packages，CLI 与 Electron 双壳）：同样要 Node 化核心，且双入口长期双倍维护
- Docker：面向部署环境一致性，与桌面应用错配（用户须装 Docker Desktop、stdio 管道用不了须改 TCP、SQLite/输出文件要卷挂载）。适用形态是「浏览器 client + 远程后端」的多端场景，与本需求无关。现有 `docker-compose.yaml`（sqlite-web 查库辅助）不受影响

## 3. 目标仓库结构

```text
novel-agent/
├── package.json              # workspace 根：workspaces 编排（test/typecheck/lint 遍历或 filter）
├── bun.lock / tsconfig.base.json / eslint.config.js   # 共享严格选项；根统一 flat config 覆盖所有包
├── apps/
│   ├── agent/                # @novel/agent —— 现 src/ 整体 git mv 迁入（保历史）
│   │   ├── package.json      # 自有依赖（ai、@ai-sdk/deepseek）；workspace:* 依赖 @novel/shared
│   │   ├── src/…             # 分层不变；schemas 迁出后 import 改指 @novel/shared
│   │   ├── index.ts          # CLI 入口（保留，交互方式不变）
│   │   └── headless.ts       # 新增：协议模式入口
│   │   └── *.test.ts         # 测试随迁，继续用 bun:test
│   └── client/               # @novel/client —— Electron + React（结构见第 6 节）
├── packages/
│   └── shared/               # @novel/shared —— 领域 schemas + 协议消息 + 视图 schema，纯 zod 零运行时依赖
├── data/ output/ docs/       # 运行时产物与文档留在根
└── ARCHITECTURE.md / PROGRESS.md / DECISIONS.md   # 根状态文档保留，client 规模大了再拆自己的
```

**数据路径约定**：CLI 直跑时 cwd 是仓库根，Electron spawn 时 cwd 不同——`NOVEL_DB_PATH` 与输出目录改为启动时经环境变量显式传**绝对路径**，agent `hello` 消息回显校验，不再依赖相对路径默认值。

## 4. 启动与生命周期模型

用户视角一键启动，无手动步骤：

```text
双击/一条命令启动 Electron
  └─ main 进程启动 → spawn agent 子进程（stdio 管道 JSON，无端口无守护）
       └─ 问答/生成过程经管道双向通信
退出（窗口全关）→ main 发退出消息 → 超时强杀 agent
```

| 场景 | 行为 |
| --- | --- |
| 开发模式 | `electron-vite` dev 的 main 直接 spawn `bun run headless.ts`；根脚本用 concurrently 串联，一条 `bun dev` 同时起两端 |
| agent 崩溃（非零退出） | main 通知 renderer 展示错误视图 +「重启 agent」按钮（v1 无会话恢复，重启即从头开始，UI 如实标注） |
| client 退出 | agent stdin EOF → 直接退出（state 增量落库，无需善后）；SIGTERM 同理 |
| agent 未捕获异常 | 发 `error` 消息后非零退出码退出 |
| 分发打包（v2） | `bun build --compile` 把 agent 编译成单文件可执行，塞进 electron-builder 的 extraResources——用户机器无需装 Bun |

## 5. Agent 协议化

### 5.1 UiChannel 接口（改造核心）

现状交互散落三处：`cli/prompt.ts` 原语（工作流直接调）、`tools/ask-user.ts`（直接 import prompt）、终态工具内的 console 打印 + askConfirm（字段摘要/角色卡/大纲确认门）。全部收敛到接口之后：

```ts
interface UiChannel {
  askText(prompt: string, opts?: { default?: string }): Promise<string>
  askSelect<T extends string>(prompt: string, options: readonly T[]): Promise<T>
  askMultiSelect<T extends string>(prompt: string, options: readonly T[]): Promise<T[]>
  askConfirm(prompt: string): Promise<boolean>
  askInt(prompt: string, opts: { min: number; max: number; default?: number }): Promise<number>
  notify(text: string): void                                  // 阶段提示、进度文案
  present(view: View): void                                   // 结构化视图（见 5.3 view 消息）
}
```

两个实现：

- **CliChannel**：包装现有 `prompt.ts` + 终端文本视图打印。CLI 行为零变化
- **ProtocolChannel**：每个 `ask*` 发 `request` 消息（带自增 id）并挂起 Promise，收 `response`（id 关联）后 resolve；`notify`/`present` 发单向事件

注入方式：`createNovel({ channel })` 构造注入；`ask-user` 等工具工厂改为接收 channel。**workflow/工具层不再直接 import `cli/prompt`、不再用 console 输出**——这是唯一的大面积改动面。

### 5.2 headless.ts 入口

读 stdin 行 → zod 解析 → 按 id 路由到挂起的 ask 回调；构造 ProtocolChannel 注入 `createNovel`；启动即发 `hello`。stdin EOF / SIGTERM 优雅退出。

### 5.3 协议消息（schema 定义于 `@novel/shared`，双侧共用校验）

| 方向 | 消息 | 载荷 | 说明 |
| --- | --- | --- | --- |
| agent→c | `hello` | `{ protoVersion, dbPath, outputDir }` | 启动握手，回显环境变量协商结果；protoVersion 不一致时 client 报错拒绝继续 |
| agent→c | `stage` | `{ stage }`，枚举 `type / audience / worldview / character / conflict / outline` | 阶段切换 |
| agent→c | `notify` | `{ text }` | 进度文本 |
| agent→c | `view` | `{ kind, data }`，kind 枚举 `field-summary / character-card / outline` | 结构化视图，data 由 shared 内对应 zod schema 定型（复用领域 schemas） |
| agent→c | `request` | `{ id, ask: { type, prompt, options?, default?, min?, max? } }`，type 同 UiChannel 五原语 | 提问 |
| agent→c | `run_finished` | `{ novelId, outputPath }` | 完整流程结束 |
| agent→c | `error` | `{ message, fatal }` | fatal=true 即将退出 |
| c→agent | `response` | `{ id, answer }`，answer 按类型为 `string / string[] / boolean / number` | 应答 |

无优雅取消消息：v1 一会话一进程，中断 = main 直接终止 agent 子进程（见 6.2）。「再来一部」= 重新 spawn。

### 5.4 语义细节

- **并发请求**：ReAct 一步可能并行调多个 `ask_user`，`request` 可并发到达；client 按到达顺序排队呈现、一次只答一个——SerialLineSource 的串行语义在 UI 侧等价保留
- **校验失败 fail-fast**：任一侧收到不合 schema 的消息，开发期直接报错退出，便于暴露协议 bug
- **视图即类型**：`view.data` 的 payload schema 全部定义在 shared，client 渲染与 agent 组装共用，杜绝两侧结构漂移

### 5.5 v1 明确不做

token 流式输出、断线重连/会话恢复、消息加密、优雅取消协议——父子进程关系就是会话边界，中断走进程终止。

## 6. Electron Client（apps/client）

### 6.1 结构（electron-vite 三段式）

```text
apps/client/
├── electron/
│   ├── main.ts        # 窗口管理 + AgentProcess：spawn/重启/退出回收；协议消息 zod 复验后转发
│   └── preload.ts     # contextBridge 暴露最小 API（应答 invoke + 事件订阅），contextIsolation 开启
└── src/               # renderer（React）
    ├── agent/         # AgentBridge：IPC 封装，协议类型 import @novel/shared
    └── components/    # StageBar / MessageLog / ViewCard / QuestionCard
```

```text
agent ⇄(stdio JSON) main ⇄(IPC) renderer
request → QuestionCard 按类型切换输入（文本框/单选/多选/确认钮/数字）→ 应答原路返回（id 关联）
view    → ViewCard 只读渲染；stage/notify → StageBar / MessageLog
```

### 6.2 v1 UI 面（单页面）

- **idle**：「开始创作」按钮 → main spawn agent
- **running**：顶部 StageBar（六阶段进度）+ 中部滚动流（notify 文案、view 卡片、当前待答问题）+ 底部输入区按 request 类型切换；带中断按钮（main 终止 agent 子进程，回 idle）
- **finished**：展示 novelId / output 路径 +「再来一部」
- 不做：作品列表、DB 浏览、大纲编辑、设置页（v2）

## 7. 测试策略

| 层 | 方式 |
| --- | --- |
| ProtocolChannel | 单测：fake 双向流，断言消息序列、id 关联、并发请求隔离 |
| createNovel（注入 FakeChannel） | 纯本地集成测试：内存 channel + 脚本化应答跑通全流程（现有端到端依赖真实 LLM，此为净收获） |
| agent 既有逻辑 | 59 用例零回归 + CLI 手动冒烟 |
| client | 组件渲染冒烟（QuestionCard 各类型、ViewCard） |
| 端到端 | 真实 LLM 从 client 跑通完整创作流（沿用项目真实冒烟传统） |

## 8. 施工顺序（原子提交序列）

| 步 | 内容 | 验收 |
| --- | --- | --- |
| 1 | monorepo 骨架：根 workspaces / tsconfig.base / 根 eslint 调整；`git mv` 迁 agent；schemas 抽 `@novel/shared`；根 scripts 收敛为 workspace 编排；状态文档同步（AGENTS.md 结构节、ARCHITECTURE.md 依赖边界、PROGRESS.md） | agent 测试全过、CLI 照常跑 |
| 2 | UiChannel 抽象：接口 + CliChannel 包装现有 prompt；workflows/工具改构造注入；FakeChannel 集成测试落地 | 59 用例过 + CLI 手动冒烟零变化 |
| 3 | 协议层：shared 增消息与视图 schema；ProtocolChannel + `headless.ts` | fake 流单测过；命令行手动管道喂消息冒烟 |
| 4 | client 骨架：electron-vite 脚手架 + main spawn agent + IPC 桥 + 问答流 UI | dev 一键起，能对答 |
| 5 | 端到端联调 | 真实 LLM 完整创作流，入库与 output 落盘正确 |

打包分发（electron-builder + agent 编译进 extraResources）为独立后续需求，不在本序列。

## 9. 风险

| 风险 | 应对 |
| --- | --- |
| bun workspaces 跑 electron postinstall（二进制下载）偶发不兼容 | 低概率；若受阻，client 目录单独退回 npm/pnpm 安装，不阻塞其余设计 |
| 交互点收敛遗漏（残留 console.log / 直接 import prompt） | 步 2 以 ESLint no-restricted-imports 规则固化边界，CI 即 lint 兜底 |

## 10. 文档同步承诺

按项目约定，每步提交同步更新：`AGENTS.md`（结构节，步 1 后 monorepo 布局）、根 `ARCHITECTURE.md`（workspace 依赖边界与协议层）、`PROGRESS.md`（每步验收记录）；本设计的关键决策回填 `DECISIONS.md`。

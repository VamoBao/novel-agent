# 重大决策记录

记录「为什么」而非「做了什么」：决策背景、备选方案、权衡依据与最终结论。

## 2026-09-15 ReAct Agent 采用「终态工具」模式（closure + hasToolCall）

- **背景**：世界观/大纲 subAgent 需要产出结构化结果，且世界观 Agent 需要「向用户提问」的多轮交互。
- **备选方案**：
  1. 解析 `result.steps[].toolResults` 提取结果——依赖 SDK 内部结构（v5→v7 字段多次更名），脆弱
  2. 用 `generateObject` 直接结构化生成——拿不到多轮工具循环，无法 ask_user
  3. 终态工具：提交工具的 `inputSchema` 即结果 schema，execute 闭包记录，`stopWhen: hasToolCall(终态工具)` 停止
- **结论**：方案 3。结果天然经 zod 校验、不依赖 toolResults 内部形状、多轮工具循环由 generateText 原生承载；`stepCountIs(maxSteps)` 作为死循环兜底。

## 2026-09-15 CLI 输入采用双模式（TTY: readline / 管道: 自维护行缓冲）

- **背景**：端到端自动化验证需脚本喂入 stdin；实测 Bun 1.4 的 `node:readline` 在管道输入下，两次 `question` 之间会丢弃剩余缓冲行并触发 close（Node 正常，最小复现确认）。
- **备选方案**：等 Bun 修复（不可控）；全部改用 `Bun.stdin` 手写（TTY 下失去行编辑/回显）。
- **结论**：按 `process.stdin.isTTY` 分流——TTY 用 readline（交互体验完整），管道用自维护行缓冲（顺序消费全部输入）。代价是两套实现，但接口统一为 `LineSource`。

## 2026-09-15 主角/核心冲突收集用 generateObject 归一化 + 用户确认门（而非完整 ReAct Agent）

- **背景**：需求只指定世界观与大纲为 ReAct Agent；主角/冲突是单轮「自由文本 → 结构化」转换。
- **权衡**：为二者也建 ReAct Agent 会增加交互轮次与 token 成本，收益低；但纯 generateObject 有模型漂移风险（实测 deepseek-flash 把「记者顾清欢」改写成「修复师苏晚」并虚构第二角色）。
- **结论**：generateObject + 强约束 prompt（用户描述置尾、明确禁止改写姓名/增减角色）+ 打印角色卡后用户确认（不满意重新描述）。实测收紧后姓名/身份逐字保留；确认门兜底残余漂移。

## 2026-09-15 state 采用 NovelStateStore 接口 + 内存实现；ID 用 UUID

- **背景**：需求要求调用 Agent 前生成唯一 ID 作为后续 state 入库主键，但 state 持久化暂不做。
- **备选方案**：直接用全局变量不抽象（DB 接入时侵入工作流）；先接 SQLite（超出本次范围）。
- **结论**：定义 `NovelStateStore` 接口（get/create/update），提供 `MemoryNovelStateStore`；ID 在工作流入口用 `crypto.randomUUID()` 生成，全程透传。DB 接入时新增实现类即可，工作流零改动。

## 2026-09-14 LLM 接入层选型：Vercel AI SDK + 官方 DeepSeek provider

- **背景**：项目需要接入 LLM 能力，首个目标厂商为 DeepSeek，且未来大概率接入其他厂商。
- **备选方案**：
  1. 直接裸调 DeepSeek HTTP API——无抽象层，换厂商成本高，工具调用协议需自行实现
  2. Vercel AI SDK（`ai`）+ `@ai-sdk/openai-compatible` 自建 DeepSeek 接入——灵活但需自己维护 baseURL 与模型映射
  3. Vercel AI SDK + 官方 `@ai-sdk/deepseek`——厂商差异由官方包收敛，社区生态成熟
- **权衡依据**：AI SDK 的统一 `LanguageModel` 抽象使后续换/加厂商只改 provider 层；`@ai-sdk/deepseek` 在官方 monorepo（vercel/ai）内维护，模型 ID 与接口跟随官方更新。
- **结论**：采用方案 3。`zod` 同步引入（AI SDK 的 tool 参数 schema 依赖）。

## 2026-09-14 TypeScript 固定在 6.x 而非 7.x

- **背景**：`bun init` 默认安装 TS 7.0（原生版），但 typescript-eslint 8.70 支持范围为 `>=4.8.4 <6.1.0`，加载即报错退出。
- **备选方案**：等 typescript-eslint 支持 TS 7（不可控）；按官方建议 TS 6/TS 7 并存（需双包别名，增加维护复杂度）。
- **结论**：devDependencies 固定 `typescript@6` 并移除 `^7` peer 声明。tsconfig 严格选项在 TS 6 下全部可用；待 typescript-eslint 支持 TS 7 后可平滑升级。

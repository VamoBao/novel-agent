# 重大决策记录

记录「为什么」而非「做了什么」：决策背景、备选方案、权衡依据与最终结论。

## 2026-09-17 worldviews 表 1:1 主键 + taboos JSON 列 + store 共享连接

- **背景**：世界观也要按 schema 入库并与角色分表、按创作 ID 绑定。
- **设计要点**：
  - 世界观与小说是 1:1（一本小说一个世界观），`novel_id` 直接作主键；与角色的 1:N（自增 id + novel_id 索引）区分
  - `taboos` 为字符串数组，SQLite 无数组类型，存 JSON 文本（读写经 schema 校验保证结构正确）
  - 保存语义为 upsert（覆盖更新、created_at 保留）——世界观可能经用户确认后修订重存
  - 两个 store 共享 `getDefaultDatabase()` 懒加载单例连接（同库不同表），避免多连接；测试用 `static open(path)` 独立建库隔离

## 2026-09-17 角色持久化采用 Bun 内置 bun:sqlite，characters 表按 schema 平铺

- **背景**：角色卡确认后需要持久化并绑定创作 ID，为后续「按 ID 恢复继续创作」打基础。
- **备选方案**：better-sqlite3（需原生编译依赖，Bun 环境无必要）；JSON 文件追加（无结构化查询，多角色/多 ID 管理弱）；先做 NovelStateStore 整体 SQLite 化（超出本次范围）。
- **结论**：`bun:sqlite`（零依赖、同步 API）。`characters` 表列与 characterSchema 平铺字段一一对应（嵌套的 basicInfo/core 拆为列），`novel_id` 加索引；读写双向过 zod 校验保证库内数据完整性。角色在每张卡确认后立即增量入库（崩溃时已完成的角色不丢失）；内核/背景/创作目的/结局方向为固定属性，只增不改。NovelState 整体（status/params/outline）的 SQLite 化为后续接入点。

## 2026-09-17 终端交互串行化（并发确认排队 + 提示语轮到时才写）

- **背景**：deepseek 等模型会在 ReAct 单步内并行调用多个 `save_field`，每个 execute 都要用户确认。管道模式靠 FIFO 勉强保持顺序但提示语全部提前打印；TTY 模式下 node:readline 的 `question()` 只有一个回调槽，后调覆盖前调，前一个确认永久挂起。
- **备选方案**：提示词约束模型一次只调一个工具（弱模型不可靠）；按工具聚合批量确认（跨 execute 聚合复杂且改变确认语义）。
- **结论**：`SerialLineSource` 基类在输入层串行化——并发读取 FIFO 排队，同一时刻只有一个未完成提问，提示语在轮到时才写入（展示内容拼进 prompt 参数，摘要与提问原子出现）。附带约定：工具内需要「展示内容 + 确认」时，内容必须拼入确认提示而非先行 console.log。隔离测试（时间戳）与端到端均验证：B 的提示仅在 A 应答后出现，应答按序映射。

## 2026-09-16 角色收集改为 ReAct Agent + 字段协议（save_field 逐字段确认）

- **背景**：角色卡新增「内核/背景/创作目的/结局方向」四个固定必填属性，旧的一次性 generateObject 归一化既无法保证逐项由用户提供，也无法逐项确认（此前实测 deepseek-flash 会改写姓名、虚构角色）。
- **备选方案**：
  1. 沿用 generateObject + 一次性确认——无法满足「必填项必须在生成时提供并逐项确认」
  2. 让 LLM 自由对话后整体提交角色卡——确认粒度粗，且终态参数由模型重组仍有漂移风险
  3. 字段协议：13 个扁平字段（FIELD_NAMES）映射 schema；`save_field` 在 execute 内代码强制「打印总结→用户确认→反馈修正」；`submit_character` 由代码从已确认记录组装并 zod 校验
- **结论**：方案 3。确认语义由代码而非提示词保证；终态数据全部来自已确认字段，模型无法在提交时篡改。姓名虽未列入固定属性，但作为关系引用与大纲引用的句柄一并设为必填。
- **附带决策**：submit_character 校验失败（缺必填）时循环必须继续，因此角色 Agent 不设 stopTool（hasToolCall 会在工具被调用时无条件停止），改用 isDone 判定 + maxSteps 兜底。

## 2026-09-16 ReAct 运行器新增续跑机制

- **背景**：端到端实测 deepseek-flash 偶发「宣告要调用提交工具却只输出文本」即自然结束轮次（同版本模型时好时坏），终态工具未被调用导致整个工作流失败。
- **备选方案**：整体重跑（丢问答上下文、重复消耗用户输入）；换强模型（成本高，且问题仍可能偶发）。
- **结论**：runReactAgent 增加 `isDone` 判定——循环自然结束但终态未达成时，注入提醒消息并携带 `response.messages` 完整历史续跑（默认 1 次）。实测该机制在真实失败场景下成功恢复。

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

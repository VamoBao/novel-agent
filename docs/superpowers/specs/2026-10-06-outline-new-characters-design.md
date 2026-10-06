# 大纲新增角色结构化输出与自动入库 设计规格

> 状态：**已确认**（2026-10-06，方案与任务包经用户确认）
> 需求来源：用户提出——大纲 Agent 增加角色库查询工具；大纲结构化输出附「新增角色清单」；大纲确认入库后由独立的角色自动创建 Agent 循环填充并入库（后续章节 / 正文工作流复用）。

## 1. 背景与问题

- 大纲 Agent（`apps/agent/src/workflows/agents/outline-agent.ts`）目前仅在 `save_outline` 终态工具处结构化（`outlineSchema.refine(部/幕强校验)`），输出只有大纲本体；大纲中登场的新角色（角色库中没有的）无任何结构化梳理。
- 大纲确认入库后，新角色不会自动进入 `characters` 表，用户只能手动在客户端「＋」逐个新建，角色库与大纲脱节。
- 用户确认的三个取舍：
  1. 新增角色清单形态：**名字 + 一句话定位**（`{ name, role }`）；
  2. 清单**进入大纲确认门**，随确认视图一并展示、随大纲连带确认（拒绝大纲即清单连带作废）；
  3. 新建小说流程与**大纲重新生成流程（regen-outline）都接入**确认后自动入库。

## 2. 方案总览（已选定：方案 A，ReAct 循环 Agent）

数据流：

```text
大纲 Agent（增 list_characters 工具）
  └─ save_outline 结构化入参 = 大纲本体 + newCharacters 清单
       └─ 确认门视图一并展示清单（拒绝→连带作废重新生成）
            └─ 用户确认 → 大纲入库（两流程各自版本机制不变）
                 └─ 编排层代码级兜底 diff（过滤库内已有名 + 清单去重）
                      └─ 清单空 → 跳过（零 LLM 调用）；非空 → autoCreateCharacters
                           └─ ReAct 循环：save_character 逐卡入库，isDone 按清单数量判定
                                └─ 收尾 notify 汇总
```

备选方案与取舍：B（编排层 for 循环 + generateObject 逐角色）确定性强但非循环 Agent、N 次独立调用互相看不见导致关系字段质量下降；C（单次 generateObject 生成 N 卡数组）无循环语义、角色多时输出易截断。A 与现有四 subAgent 的终态工具模式一致，单次会话内世界观 / 大纲 / 已入库卡持续在场，跨角色字段（relationships）质量最好。A 的弱点（弱模型改名漂移）由 execute 内名字白名单守卫兜底。

## 3. 详细设计

### 3.1 shared schema 层（`packages/shared/src/`）

- `outline.ts`：
  - 新增 `newCharacterSchema = z.object({ name: z.string().min(1), role: z.string().min(1) })`，`name` = 角色名，`role` = 该角色在大纲中的一句话定位（如「反派·血宗宗主」）；
  - **`outlineSchema` 本身不动**——`output/<id>.json` 产物与库内大纲树保持大纲本体，新增角色清单不入产物；
  - 导出类型 `NewCharacterOutline`。
- `views.ts`：`outlineViewSchema` 增**可选**字段 `newCharacters: z.array(newCharacterSchema).optional()`——仅确认门（`detail: "confirm"`）视图携带，full 展示视图不带；渲染端存在即展示。可选字段保证旧消息 / full 视图零破坏。

### 3.2 大纲 Agent 改造（`outline-agent.ts`）

- **`list_characters` 工具**（新增）：无入参，execute 从注入的 `CharacterStore.listCharacters(novelId)` 返回 `[{ name, narrativeRole }]` 文本清单，供模型比对出「新增」。注入方式：`CreateOutlineOptions` 增 `novelId: string` 与 `characterStore?: CharacterStore`（缺省默认 SQLite store，测试可替换）。
- **`save_outline` 结构化扩展**：入参 schema 由 `outlineSchemaFor(actCount, partCount)` 改为 `outlineSchema.extend({ newCharacters: z.array(newCharacterSchema).refine(清单内名字不重复) }).refine(部/幕强校验)`——部/幕强校验逻辑保持不变（沿用现有 `outlineSchemaFor` 的 refine 谓词）。
- **确认门**：`channel.askConfirm` 的视图载荷携带 `newCharacters`（`view: { kind: "outline", detail: "confirm", outline, newCharacters }`）；用户拒绝时清单随大纲连带作废，模型按反馈调整后重新提交。
- **系统提示词**：新增三条约束——大纲中的角色应尽量沿用角色库已有角色；登场角色不在库中时**必须**列入 `newCharacters`（名字 + 一句话定位），不得虚构角色库中已有角色的变体名字来规避；可用 `list_characters` 工具查询角色库现状。
- **返回类型**：`createOutline` 返回值由 `Outline` 改为 `OutlineSubmission = { outline: Outline; newCharacters: NewCharacterOutline[] }`；`outlineSchemaFor` 保留导出（结构强校验谓词复用），单测同步扩展。

### 3.3 角色自动创建 Agent（新文件 `workflows/agents/auto-character-agent.ts`）

独立模块，后续章节规划 / 正文生成工作流可直接复用：

- **导出** `autoCreateCharacters(options)`：
  - 入参：`novelId`、`worldview`、`outline`（大纲本体，作上下文）、`newCharacters: NewCharacterOutline[]`、`existingCharacters: Character[]`（供 relationships 引用）、`channel: UiChannel`、`characterStore?: CharacterStore`（缺省默认）；
  - 行为：全自动无确认门、无 ask_user；返回 `StoredCharacter[]`（本次实际入库的记录）。
- **ReAct 循环**：`save_character` 终态工具，`inputSchema = characterSchema`（复用既有 schema，结果天然过校验）。execute 闭包三重守卫：
  1. `name` 必须在待创建清单内（白名单，防漂移改名）；
  2. 库内不得重名（`existingCharacters` 快照 + 已入库累计，重名拒绝并提示）；
  3. schema 校验（SDK 先校验再执行）。
  守卫通过 → `characterStore.addCharacter` 入库 → `channel.notify` 逐卡通报 → 记录已入库名字集合。
- **停止条件**：`isDone = 清单名字集合全部已入库`；`maxSteps = 4 + 2 × 清单长度`（每张卡预留约 2 步 + 收尾余量）；`continuationHint` 提示「还有未入库的清单角色，请继续调用 save_character」。终态未达成时照现有模式抛可读错误（带 stepCount 与最后输出）。
- **填充约束（系统提示词）**：必填 7 项（姓名 / 核心渴望 / 核心恐惧 / 叙事定位 / 背景 / 创作目的 / 结局方向）必须非空填充；可选 6 项在大纲与世界观有依据时一并填充（性别 / 外貌常可自大纲推断），无依据留空；`relationships` 引用已有角色须用真实名字；name 字段照抄清单名字，不得增删改。

### 3.4 编排接入（`create-novel.ts` 与 `regen-outline.ts`）

两流程在各自大纲入库动作（`saveOutlineTree` / `saveOutlineTreeNewVersion`）之后统一接入：

1. **代码级兜底 diff**（不信任模型的「新增」判定）：按库内角色名过滤清单（trim 后全等比对，库内已有者剔除）、清单内去重（同名保留首个）；
2. 清单为空 → 跳过自动创建（零 LLM 调用、零 notify 噪音）；
3. 非空 → `notify` 告知即将自动创建 → `autoCreateCharacters(...)` → 收尾 notify 汇总（`✨ 本次大纲新增 N 个角色已自动入库：<名字列表>`）；
4. create-novel 收尾指引文案、regen-outline 返回值不变（不新增返回字段——客户端刷新详情即可见新角色）。

### 3.5 双端渲染联动

- agent 侧 `ui/cli-channel.ts` `renderView`（CLI 与协议通道共用）：outline confirm 分支在梗概之后渲染「新增角色」清单（`名字 —— 定位` 逐行）；full 分支与 `newCharacters` 缺失时不渲染。
- client 侧 `ViewCard`：outline confirm 视图同步渲染清单（沿用现有列表样式）；协议 zod 复验随 shared schema 更新自动兼容。
- 无新交互步骤、无新增 headless 会话模式、StageBar 不变（自动创建属大纲阶段收尾动作，不发新 stage）。

## 4. 边界与错误处理

- 大纲被拒 → 清单连带作废，循环内重新生成；确认后以最终提交的清单为准。
- 模型把已有角色列入清单 → 编排层 diff 剔除（不报错、不中断）。
- 模型在自动创建时改名漂移 / 越界提交 → execute 守卫拒绝，返回 note 让模型继续修正；maxSteps 兜底抛错（已入库卡保留，可手动删除，不做自动清理）。
- 清单为空 / 大纲确认时角色库为空 → 正常路径（create-novel 角色阶段本就保证至少一名主角，空清单常见于「大纲未引入新角色」）。
- 自动创建中断（会话中止 / maxSteps 耗尽）→ 已入库卡保留（增量入库语义，与 create-novel 角色阶段一致），中断前的大纲入库不回滚。

## 5. 测试计划

- `outline-agent.test.ts`：save_outline 新入参 schema——`newCharacters` 缺失 / name 或 role 空串被拒；空清单合法；清单内重名被拒；部 / 幕强校验不回归。
- `auto-character-agent.test.ts`（新建）：mock `ai` + FakeChannel + 临时 SQLite——N 卡全部入库；越界名被拒后模型修正再入库；库内重名被拒；maxSteps 耗尽抛可读错误。
- `create-novel.test.ts` / `regen-outline.test.ts` 改造：确认后 `characters` 表新增行断言（数量 + 名字）；模型把已有角色列入清单时被 diff 剔除；空清单跳过路径（零工具调用断言）。
- shared views 单测：outlineViewSchema `newCharacters` 可选字段两态校验。

## 6. 文档同步与提交

- `AGENTS.md` 目录结构与主工作流描述、根 `ARCHITECTURE.md`（大纲 Agent 工具清单 / 自动创建 Agent / 两流程收尾动作）、`apps/agent/src/workflows/ARCHITECTURE.md` 与 `PROGRESS.md` 同步；决策（方案 A 取舍 + 确认门连带确认）落根 `DECISIONS.md`。
- 整项需求一次原子提交（含规格与计划文档）；真实 LLM 端到端（`bun run dev` 走到大纲确认门，观察清单展示与确认后自动入库）由用户复验。

## 7. 不做范围

- 不自动更新已有角色卡（大纲对既有角色的刻画变化不回写）；
- 自动创建无确认门、失败不自动清理已入库卡；
- `output/<id>.json` 产物与 outlines 表结构不变（清单不入产物 / 不入库）；
- 不新增 headless 会话模式与客户端交互面（仅渲染联动）。

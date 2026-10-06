# 章节规划新增角色梳理与自动入库 设计规格

> 状态：**已确认**（2026-10-06，方案与任务包经用户确认）
> 需求来源：用户提出——章节规划时如有新增角色也要列出并用角色自动创建 Agent 入库；章节概述需尽量点名出场角色。
> 前置依赖：`docs/superpowers/specs/2026-10-06-outline-new-characters-design.md` 已落地（`newCharacterSchema`、`autoCreateCharacters` / `filterNewCharacters`、大纲确认门连带确认模式）。

## 1. 背景与问题

- 章节 Agent（`apps/agent/src/workflows/agents/chapter-agent.ts`）的 `save_chapters` 入参即 `chapterPlanSchema`（仅 `chapters[{name, summary}]`，1~12 章），无新增角色概念；确认视图 `chapter-plan` 自包含幕信息 + 规划。
- 编排 `planActChapters`（`apps/agent/src/workflows/plan-act-chapters.ts`）上下文只有书名 / logline / 部幕信息 / theme——**不读角色库、不读世界观**：模型既不知道已有哪些角色（概述无法点名、易虚构重复角色），也没有依据梳理「新增」。
- 用户确认的取舍：清单形态 = **顶层 newCharacters**（名字 + 一句话定位，定位注明登场章节，如「第3章登场·血宗打手」）——与大纲模式完全一致；确认门连带确认、确认后自动入库沿用大纲已定模式，不再另议。

## 2. 方案总览

数据流（镜像大纲链路，复用既有设施）：

```text
planActChapters（前置校验 + 世界观已确认校验[新增]）
  └─ planChapters：prompt 增「已有角色」行 + list_characters 工具[新增]
       └─ save_chapters 结构化入参 = 章节规划 + 顶层 newCharacters
            └─ 确认门视图一并展示清单（拒绝→连带作废重新生成）
                 └─ 确认 → saveChapters 幕下建章（不变）
                      └─ 兜底 diff（filterNewCharacters）→ 空清单跳过
                           └─ autoCreateCharacters（世界观 + 伪 Outline + extraContext=章节规划全文）
                                └─ 汇总 notify
```

## 3. 详细设计

### 3.1 shared schema 层

- `views.ts`：`chapterPlanViewSchema` 增**可选**字段 `newCharacters: z.array(newCharacterSchema).optional()`——仅确认门视图携带；渲染端存在即展示。可选字段保证旧消息零破坏。
- `chapterPlanSchema` 本身不动（视图内嵌 `plan` 保持规划本体；`output` 产物与 outlines 章节点结构不变）。

### 3.2 章节 Agent 改造（`chapter-agent.ts`）

- **`saveChaptersInputSchema` 工厂**（模块内导出，镜像 `saveOutlineInputSchemaFor`）：`chapterPlanSchema.extend({ newCharacters: z.array(newCharacterSchema).refine(清单内名字不重复) })`。
- **`list_characters` 工具**（新增）：无入参，execute 从注入的 `CharacterStore.listCharacters(novelId)` 返回 `[{ name, narrativeRole }]`。
- **注入方式**：`planChapters` 增第三参 `options: { novelId: string; characterStore?: CharacterStore }`（缺省默认 SQLite store）；`PlanChaptersInput` 保持纯数据不动。
- **prompt**：增「角色库已有角色：<名>（<叙事定位>）」行（数据取自 store，与工具同源）；「请基于以上内容推荐…」保持。
- **SYSTEM_PROMPT 增角色梳理要求**（三条）：
  1. 章节概述**尽量点名本章出场角色**——已有角色用真名，新角色用其清单名字；
  2. 登场角色不在角色库中时，必须列入 `save_chapters` 的 `newCharacters`：`name` 为角色名、`role` 为一句话定位并**注明登场章**（如「第3章登场·血宗打手」）；清单内名字不得重复、库内已有角色不得列入；
  3. 可用 `list_characters` 工具查询角色库现状；`newCharacters` 会在确认时随规划一并展示，确认后自动填充角色卡并入库。
- **返回类型**：`planChapters` 返回值由 `ChapterPlan` 改为 `ChapterPlanSubmission = { plan: ChapterPlan; newCharacters: NewCharacterOutline[] }`（类型在 chapter-agent.ts 定义导出）。
- **确认门**：视图载荷携带 `newCharacters`；拒绝时清单随规划连带作废。

### 3.3 auto-character-agent 增量扩展

`AutoCreateCharactersOptions` 增**可选** `extraContext?: string`——存在时作为附加上下文块追加进 prompt（位于大纲之后、已有角色行之前）。章节规划的「章名 + 概述」是新角色言行的一手素材，可显著提升填卡质量。纯增量可选参数，大纲链路两个既有调用方零改动。

### 3.4 编排接入（`plan-act-chapters.ts`）

- **注入**：`PlanActChaptersOptions` 增 `worldviewStore?: WorldviewStore` 与 `characterStore?: CharacterStore`（缺省默认）。
- **前置校验新增**：「世界观未确认（库中无记录）」拒绝规划——对齐 regen-outline / write-chapter 的既有校验惯例；自动创建需要世界观依据，且避免「确认入库后才发现无法自动创建」的中间态。
- **`planChapters` 调用**：传入 `novelId` + `characterStore`。
- **确认入库后**（`saveChapters` 与「章节已入库」notify 之后、`return` 之前）：
  1. `existing = characterStore.listCharacters(novelId).map(c => c.character)`；`pendingNew = filterNewCharacters(submission.newCharacters, existing)`；
  2. 空清单跳过（零 LLM 调用、零 notify 噪音）；
  3. 非空 → notify「本幕规划引入了 N 个新角色，正在自动填充角色卡并入库…」→ `autoCreateCharacters({ novelId, worldview: stored.worldview, outline: 伪Outline, newCharacters: pendingNew, existingCharacters: existing, channel, characterStore, extraContext: 章节规划全文 })` → 汇总 notify「✨ 本次章节规划新增 N 个角色已自动入库：<名单>」（`pendingNew.map(c => c.name)` 清单序）。
- **伪 Outline 组装**（结构天然匹配 `Outline`）：`{ title: novel.name ?? "未命名小说", logline: novel.description ?? "", parts: [{ name: 部名, summary: 部梗概, acts: [{ name: 幕名, summary: 幕梗概, keyPlotPoints: 本幕情节点 }] }] }`。
- **extraContext 文本**：`本次规划的章节列表：\n第i章 <章名>：<概述>` 逐行（取自确认后的 `submission.plan.chapters`）。
- 返回值 `PlanActChaptersResult` 不变（客户端刷新详情即可见新角色）。

### 3.5 双端渲染联动

- agent 侧 `formatChapterPlan`（`cli-channel.ts`）：在章节列表之后追加「  ✨ 本次规划新增角色（确认后自动入库）：」+「    · <名>——<定位>」逐行；清单缺失或空不渲染。
- client 侧 `ViewCard.tsx` chapter-plan 分支：在章列表之后追加同内容区块（`.part-name` 标题 + `.act` 行，条件 `view.newCharacters && view.newCharacters.length > 0`——chapter-plan 视图仅用于确认门，无需 detail 判别）。
- 无新交互步骤、无新增 headless 会话模式；协议 zod 复验随 shared schema 自动兼容。

## 4. 边界与错误处理

- 规划被拒 → 清单连带作废，重新提交以最新清单为准。
- 模型把已有角色列入清单 / 清单内重名 → `filterNewCharacters` 兜底剔除与去重；`saveChaptersInputSchema` 层拒绝清单内重名（SDK 先校验）。
- 自动创建越界名 / 重名 → execute 三重守卫拒绝（任务上一轮已落地）；`isDone` 以 `pendingNames.size` 为基准。
- 自动创建中断 → 已入库卡保留、已建章节点保留（增量语义），无回滚。
- 世界观缺失的旧数据 → 前置校验直接拒绝规划（可读错误），不做「跳过自动创建」的静默兜底。
- 空清单（本幕未引入新角色）→ 正常路径，跳过自动创建。

## 5. 测试计划

- `chapter-agent.test.ts`（新建，镜像 outline-agent.test.ts）：`saveChaptersInputSchema`——newCharacters 缺失 / 字段空串被拒；空清单合法；清单内重名被拒（「不得重复」）；chapters 数量约束（1~12）不回归。
- `auto-character-agent.test.ts` 增：`extraContext` 传入时出现在 prompt 断言（现有用例改一处即可，或加最小用例）。
- `plan-act-chapters.test.ts`：fixture 增 `newCharacters`；textScript 增 `save_character` 轮；断言确认后 characters 表新增行、逐卡与汇总 notify；空清单跳过路径；**世界观缺失前置拒绝**新用例。
- `cli-channel.test.ts`：chapter-plan 渲染清单两态（携带渲染 / 缺失不渲染）。
- shared 单测：`chapterPlanViewSchema` 可选字段两态。

## 6. 文档同步与提交

- `AGENTS.md`（目录树 plan-act-chapters / chapter-agent 描述、单幕章节规划流程）、根 `ARCHITECTURE.md`（「单幕章节规划工作流」）、workflows 两级 `ARCHITECTURE.md` / `PROGRESS.md`、根 `DECISIONS.md`（顶层清单取舍 + 世界观前置校验 + extraContext 增量参数的决策）同步。
- 整项需求一次原子提交（squash 回 master）；真实 LLM 端到端（客户端幕卡「规划本幕章节」走确认门，观察清单展示、概述点名与确认后自动入库）由用户复验。

## 7. 不做范围

- 不改 `chapterPlanSchema` 本体与 `output/<id>.json` 产物结构；
- 不为世界观缺失做静默兜底（前置校验直接拒绝）；
- 不自动更新已有角色卡（概述对既有角色的新刻画不回写）；
- 重复规划修订流（同一幕重新规划）仍为后续需求；
- 不新增 headless 会话模式与客户端交互面（仅渲染联动）。

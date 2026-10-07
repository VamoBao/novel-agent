# 大纲与章节规划伏笔接入 设计规格

> 状态：**已确认**（2026-10-06——三项实质决策经用户确认：act 列精确圈定 / 未解析服务角色名跳过 / regen 保留旧伏笔；任务包沿用本会话已两次确认的同构 SDD 流水线）
> 需求来源：用户提出——大纲与章节规划的结构化输出列出「未创建伏笔」，内容与角色入库后创建入库（表面行为 / 隐藏真相 / 读者注意度 / 回收状态恒为未回收 / 服务角色 ID）；章节规划时回传该幕伏笔由 LLM 绑定登场章，并支持新增带章节绑定的伏笔。
> 前置依赖：newCharacters 链路（大纲与章节规划两轮需求已落地）——本需求镜像其「结构化清单 → 确认门连带确认 → 入库后代码创建」模式。

## 1. 背景与问题

- 伏笔数据层先行落地（`foreshadows` 表 + `ForeshadowStore` 完整 CRUD + `foreshadowSchema`），但创作流零接入：大纲与章节规划的 LLM 无伏笔概念，表内始终无数据。
- 关键差异（与角色链路相比）：**伏笔创建不需要 LLM**——用户点名的全部字段（表面行为 / 隐藏真相 / 注意度 / 回收状态=未回收 / 服务角色）都由 `save_outline` / `save_chapters` 的结构化清单直接给出，创建是确定性代码（角色需要 LLM 补全 13 字段，伏笔不需要）。故**不建独立 ReAct Agent**。
- 服务角色在 LLM 层面只能给**名字**（角色 UUID 不可生成）——入库时代码解析为 `character_ids`；伏笔创建时机必须在**角色入库之后**（用户明确）。
- 伏笔直接关联章节而非幕（用户明确）：大纲阶段不绑章（章节尚不存在）；章节规划时回传该幕伏笔，LLM 决定绑定登场章；章节阶段新增的伏笔可同时绑章——故章节阶段伏笔创建在**章节入库之后**。
- 表缺失「幕归属」字段——「章节规划回传该幕的伏笔」需要圈定依据。

## 2. 用户确认的三项决策

1. **幕归属 = act 列精确圈定**：`foreshadows` 增可空 `act_node_id` 裸列（迁移 11→12）；大纲阶段创建时绑幕节点；章节规划查「本幕且未绑章」精确回传。
2. **未解析服务角色名 → 跳过该名并 notify**（伏笔照常入库，characterIds 只含可解析项）；全部解析失败跳过整条并 notify。
3. **regen-outline 后旧伏笔保留**（act/appear 指向归档节点，悬挂但无害；同「正文行与归档章关联留存」先例）。

## 3. 详细设计

### 3.1 shared schema 层（`packages/shared/src/`）

- `foreshadow.ts` 追加（`foreshadowSchema` / `foreshadowPatchSchema` 不动）：

```text
newForeshadowSchema = {
  surfaceAction: string min1        // 表面行为
  hiddenTruth: string min1          // 隐藏的真相
  attentionLevel: int 1-10          // 读者注意度
  characterNames: string[] min1     // 服务角色名（引用角色库名或本次新增角色清单名）
}
outlineNewForeshadowSchema  = newForeshadowSchema.extend({ actName: string min1 })      // 埋设幕名（大纲阶段）
chapterNewForeshadowSchema  = newForeshadowSchema.extend({ chapterName: string min1 })  // 登场章名（章节阶段）
foreshadowBindingSchema = { index: int min1, chapterName: string min1 }                 // 既有未绑伏笔 → 登场章
```

类型：`NewForeshadow` / `OutlineNewForeshadow` / `ChapterNewForeshadow` / `ForeshadowBinding`。
- `views.ts`：`outlineViewSchema` 增可选 `newForeshadows: array(outlineNewForeshadowSchema)`；`chapterPlanViewSchema` 增可选 `newForeshadows: array(chapterNewForeshadowSchema)` 与 `foreshadowBindings: array(foreshadowBindingSchema)`。仅确认门携带，可选保证旧消息零破坏。
- `index.ts` 出口补齐上述 schema 与类型。

### 3.2 数据层（`apps/agent/src/state/`）

- `db.ts`：SCHEMA_VERSION 11→12——迁移段 `version === 11` 时 `ALTER TABLE foreshadows ADD COLUMN act_node_id TEXT;`（可空裸列，无外键——SQLite 不支持 ALTER 补外键，一致性由写入方保证，先例 `outlines.document_id`）；新建表路径（version < 4 DROP 重建）的 CREATE TABLE 同步含新列；幂等守卫对齐既有链式迁移惯例。
- `foreshadow-store.ts`：
  - `StoredForeshadow` 增 `actNodeId: string | null`；INSERT / SELECT 各 SQL 增列；
  - `addForeshadow(novelId, foreshadow, actNodeId?)` 增第三可选参（既有调用方零破坏——生产调用方为零，仅 store 测试）；
  - 新查询 `listUnboundByAct(novelId, actNodeId): StoredForeshadow[]`——`WHERE novel_id = ? AND act_node_id = ? AND appear_chapter_id IS NULL ORDER BY created_at ASC`（章节规划回传清单）；
  - `updateForeshadow` patch `appearChapterId` 已支持，零改动。

### 3.3 伏笔落地模块（新文件 `apps/agent/src/workflows/foreshadow-intake.ts`）

两条大纲流程与章节规划共用的确定性创建逻辑（无 LLM）：

- **纯函数** `resolveCharacterIds(names: string[], characters: {id, name}[]): { ids: string[]; unresolved: string[] }`——trim 全等匹配。
- **`plantOutlineForeshadows(options)`**：`{ novelId, newForeshadows: OutlineNewForeshadow[], characters: StoredCharacter[]（库内全量，含本次自动入库角色）, actNodes: {id, name}[]（本版幕节点）, channel, foreshadowStore }` → 逐条：
  1. `actNodeId` = actNodes 按名全等匹配；未匹配 → **跳过整条** + notify 警告（无法圈定回传范围，死数据不如不入库）；
  2. `resolveCharacterIds`：未解析名剔除 + notify；全部失败 → 跳过整条 + notify；
  3. `addForeshadow(novelId, { surfaceAction, hiddenTruth, attentionLevel, recoveryStatus: "unrecovered", characterIds（解析结果非空时） }, actNodeId)`；
  4. 返回 `{ created: StoredForeshadow[]; skipped: string[]（原因摘要） }`；编排层汇总 notify。
- **`plantChapterForeshadows(options)`**：`{ novelId, actNodeId, newForeshadows: ChapterNewForeshadow[], bindings: ForeshadowBinding[], characters, chapterNodes: {id, name}[]（本次所建章节点）, unbound: StoredForeshadow[]（回传清单，index 与 prompt 序号一致 1-based）, channel, foreshadowStore }` →
  1. newForeshadows 逐条：`chapterName → 章节点 ID`（未匹配跳过 + notify）+ 角色解析（同上策略）→ `addForeshadow(..., appearChapterId: 章节点ID, actNodeId=本幕)`；
  2. bindings 逐条：`index → unbound[index-1]`（越界跳过 + notify）、`chapterName → 章节点 ID`（未匹配跳过 + notify）→ `updateForeshadow(id, { appearChapterId })`；
  3. 返回创建与绑定统计；编排层汇总 notify。

### 3.4 大纲 Agent 改造（`outline-agent.ts`）

- `saveOutlineInputSchemaFor` 增 `newForeshadows: z.array(outlineNewForeshadowSchema).refine(清单内 surfaceAction 不得重复)`（可空数组合法）。
- `OutlineSubmission` 增 `newForeshadows: OutlineNewForeshadow[]`；确认视图携带；拒绝连带作废。
- SYSTEM_PROMPT 增「伏笔梳理要求」：某幕安排伏笔时列入 newForeshadows——表面行为（读者可见的表现）/ 隐藏真相（真正指向的剧情）/ 注意度 1-10（1 易发现→10 难发现）/ 服务角色名（可引用角色库或 newCharacters 清单名）/ 埋设幕名（actName 必须是本大纲中真实的幕名）；伏笔挂幕不挂章；服务角色名必须真实存在。

### 3.5 大纲两编排接入（`create-novel.ts` / `regen-outline.ts`）

- 角色自动入库之后（上两轮的 auto 块之后）：`submission.newForeshadows` 非空 → notify「大纲安排了 N 处伏笔，正在入库…」→ `plantOutlineForeshadows`（actNodes 取自刚入库的树 `listOutlineNodes(currentOnly)` 中 type=act 节点；characters 取自动入库后的全量 `listCharacters`）→ 汇总 notify「✨ 本次大纲伏笔已入库 N 处（M 处因幕名/角色名未匹配跳过）」。
- 注入 `foreshadowStore?`（缺省默认）；返回值不变。

### 3.6 章节 Agent 改造（`chapter-agent.ts`）

- `PlanChaptersAgentOptions` 增 `unboundForeshadows?: ReadonlyArray<StoredForeshadow>`（编排层查好传入）；prompt 有则增「本幕未绑章伏笔清单（序号. 表面行为——隐藏真相）」块；无则不带。
- `saveChaptersInputSchema` 增 `newForeshadows: array(chapterNewForeshadowSchema).refine(surfaceAction 不重复)` 与 `foreshadowBindings: array(foreshadowBindingSchema)`（均可空数组合法）。
- `ChapterPlanSubmission` 增 `newForeshadows` / `foreshadowBindings`；确认视图携带两组。
- SYSTEM_PROMPT 增「伏笔梳理要求」：①清单中的伏笔若在本幕章节中出现，必须输出 foreshadowBindings（序号 + 登场章名——章名须是本次规划中的真实章名）；②新伏笔列入 newForeshadows（含登场章名）；③章节概述尽量体现伏笔的表面行为（正文写作有据可依）；④服务角色名必须真实。

### 3.7 章节编排接入（`plan-act-chapters.ts`）

- 注入 `foreshadowStore?`；前置校验后查 `listUnboundByAct(novelId, act.id)`，随 `unboundForeshadows` 传入章节 Agent。
- 确认后顺序：saveChapters 建章 → 角色自动入库 → **`plantChapterForeshadows`**（chapterNodes 取本次所建章节点；unbound 传同一清单）→ 汇总 notify「✨ 本次规划伏笔入库 N 处、绑定 M 处（跳过 K 处）」。
- 返回值不变。

### 3.8 双端渲染联动

- CLI `formatOutlineForConfirm`：newCharacters 区块之后渲染伏笔区块「✨ 本次大纲伏笔（确认后自动入库）」——逐条「`[幕名] 表面行为 ⇢ 隐藏真相（注意度 N，服务：角色名…）`」。
- CLI `formatChapterPlan`：章列表与 newCharacters 之后渲染「✨ 本次规划新增伏笔（确认后自动入库）」（含登场章）与「🔗 伏笔绑定」（序号 → 章名）。
- client `ViewCard` 两分支同步（沿用 `.part-name` / `.act` / `.plot` 样式；条件渲染，缺失或空不渲染）。
- 无新交互步骤与 headless 会话模式；协议复验随 shared 自动兼容。

## 4. 边界与错误处理

- 大纲 / 规划被拒 → 伏笔清单连带作废；确认后以最终提交清单为准。
- 幕名 / 章名 / 角色名未匹配 → 逐条跳过 + notify（不阻塞其余条目）；bindings 序号越界跳过 + notify。
- 服务角色解析部分成功 → 只含可解析项（notify 列出未解析名）；全部失败 → 跳过整条。
- 重复伏笔：schema 层拒清单内 surfaceAction 重复；跨提交重复（库里已有相同 surface_action）不拦截——写作期人工管理（YAGNI）。
- regen-outline：旧伏笔保留（act 指向归档节点；`listUnboundByAct` 按当前 act 查询天然不回传旧版伏笔）。
- 自动创建中断 → 已入库伏笔保留（增量语义），无回滚。
- `attentionLevel` 越界 / 缺字段 → schema 拒绝（SDK 先校验）。

## 5. 测试计划

- shared 单测：三变体 schema 必填与边界（注意度 0/11 拒、characterNames 空拒、actName/chapterName 缺拒）+ 两确认视图可选字段两态。
- db 迁移测试：v11 库升 12 列存在且数据无损；新建直建 12 形态。
- foreshadow-store 测试：act_node_id 写读、listUnboundByAct 过滤语义（本幕 + 未绑章 + 排序）、addForeshadow 第三参缺省兼容。
- foreshadow-intake 单测（FakeChannel + 临时 SQLite）：大纲路径（幕未匹配跳过 / 角色部分解析 / 全失败跳过 / 正常入库绑 act）、章节路径（章未匹配跳过、绑定越界跳过、正常创建带 appearChapterId + patch 绑定）。
- 大纲 Agent schema 单测：newForeshadows 缺失合法（空数组）、surfaceAction 重复拒。
- 章节 Agent schema 单测：两组字段缺失合法（空数组）、重复拒、binding index 越界值拒（min1）。
- create-novel / regen-outline / plan-act-chapters 集成测试：确认后伏笔入库断言（character_ids / act_node_id / appear_chapter_id 正确）、跳过路径、空清单零调用。
- cli-channel 渲染测试：三区块两态。

## 6. 文档同步与提交

- `AGENTS.md`、根 `ARCHITECTURE.md`（两工作流 + 文件树 + foreshadows 表描述补 act_node_id 与采集接入）、两级 `PROGRESS.md` 归一、根 `DECISIONS.md`（三项决策 + 「伏笔无需 LLM Agent」的差异论证）、`workflows/ARCHITECTURE.md`（foreshadow-intake 条目 + 数据流 + 依赖边界）。
- 整项需求一次原子提交（squash 回 master）；真实库副本迁移实跑（11→12 无损）；真实 LLM 端到端由用户复验。

## 7. 不做范围

- 不建独立伏笔 ReAct Agent；不改 `foreshadowSchema` / `foreshadowPatchSchema` 卡片字段；
- 不自动回收伏笔（recovery_status 流转、recover_chapter_ids 采集仍为后续需求）；
- 客户端浏览侧伏笔 UI（结构树 / 预览卡）与伏笔增删管理界面不动；
- 不做跨提交伏笔去重；不清理 regen 旧伏笔。

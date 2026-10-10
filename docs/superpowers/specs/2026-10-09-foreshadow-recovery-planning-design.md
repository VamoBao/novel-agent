# 伏笔回收规划（手动编辑 + 大纲/章节规划自动绑定） 设计规格

> 状态：**已确认**（2026-10-09——两途径方案由用户提出并指示执行：①伏笔编辑表单增回收章规划（回收章必须在登场章之后）；②大纲/章节规划时生成伏笔入场的同时规划回收，顺序为幕→章——大纲挂回收幕、该幕章节规划时绑具体回收章）。
> 前置依赖：伏笔登场链路已闭环（appearChapterId 大纲挂幕→章节规划绑定）；ForeshadowEditForm 已有登场章下拉；章卡伏笔区块已按 recoverChapterIds 过滤展示「回收」徽标。

## 1. 背景与问题

- 伏笔「登场」有完整规划链（大纲挂幕 → 章节规划绑定登场章 → 手动编辑修正），但「回收」（recoverChapterIds）**无任何写入来源**——回收状态流转、章卡回收徽标全部空转。
- 途径一缺编辑面：ForeshadowEditForm 当初设计明确「回收章不入 patch 保留现值」（回收流为后续需求），本需求落地它。
- 顺序约束需要全局章节序：outlines.sort 仅在同父级内唯一（幕内章序），跨幕无法比较「回收章在登场章之后」——须组合「部 sort → 幕 sort → 章 sort」得到全书章节全序。

## 2. 用户确认的方案（两途径互补）

1. **手动**：伏笔编辑表单增加回收章多选；回收章必须严格在登场章之后（全局序）——登场章为空时先绑登场章。
2. **自动（幕→章两级）**：大纲 Agent 的 newForeshadows 附可选 `recoverActName`（回收幕名，挂幕不挂章——同登场的「先幕后章」节奏）；该幕被章节规划时，编排把「回收幕=本幕且未绑回收章」的伏笔带序号回传章节 Agent，LLM 输出 `foreshadowRecoverBindings`（清单序号+回收章名），确认后确定性绑定 recoverChapterIds。幕已有章节（不能再规划）或 LLM 未绑的场景由途径一手动兜底。

## 3. 详细设计

### 3.1 全局章节序（双方各实现一份纯函数，约 15 行）

- 输入章节点全集（含 parentId/sort/type），按「部（sort）→ 幕（sort）→ 章（sort）」深度优先展开，产出章 ID 的全序表；`orderOf(chapterId)` 查全局序号。
- agent 侧：`foreshadow-intake.ts` 导出 `buildChapterOrder(nodes)`（intake 校验回收/登场顺序用；输入为扁平节点 `{id,parentId,type,sort}` 数组——store 行与编排透传时映射）。
- 客户端：`apps/client/src/chapter-order.ts`（表单选项过滤与校验用；输入 `OutlineNodeEntry[]`）。
- shared 保持纯 zod 层不放函数；两份实现各自贴合输入类型。

### 3.2 shared schema（`foreshadow.ts` / `views.ts` / `query.ts`）

- `outlineNewForeshadowSchema` 增 `recoverActName: z.string().min(1).optional()`（回收幕名，须为本大纲真实幕名且在埋设幕之后——顺序校验在 save_outline 入参层 refine，因需大纲本体上下文）。
- `chapterPlanViewSchema` 增 `foreshadowRecoverBindings: z.array(foreshadowBindingSchema).optional()`（复用同构的绑定指令 schema：index 回传清单序号 + chapterName 回收章名；旧消息零破坏）。
- `foreshadowEntrySchema` 增 `recoverActNodeId: z.string().min(1).nullable()`（回收幕节点；未规划 / 旧数据 null）——客户端预览与编辑取用。

### 3.3 数据层（SCHEMA_VERSION 13→14，`db.ts` / `foreshadow-store.ts`）

- foreshadows 增列 `recover_act_node_id TEXT`（可空裸列，先例 act_node_id）；守卫 `version >= 8 && version <= 13`（表自 v8 已存在，ALTER 对旧形态生效）。
- `StoredForeshadow` 增 `recoverActNodeId: string | null`；行结构 / INSERT / SELECT / UPDATE 基线列扩展。
- `addForeshadow(novelId, foreshadow, actNodeId?, recoverActNodeId?)` 增第四参。
- 新增 `listUnrecoveredByAct(novelId, actNodeId)`：`recover_act_node_id = 本幕 AND recover_chapter_ids IS NULL`，按入库顺序——章节规划回传「本幕待回收」清单。
- patch 不扩展回收幕（编辑面只编辑回收章；回收幕由大纲链写入，YAGNI）。

### 3.4 大纲 Agent（`outline-agent.ts`）

- 伏笔梳理要求补：真相在后续某幕揭晓的伏笔附 `recoverActName`（回收幕名）——须为真实幕名且**在埋设幕之后**；大纲期看不到回收点的伏笔省略该字段。
- `saveOutlineInputSchemaFor` 顶层 refine 增幕序校验：构建幕名→（部序, 幕序）表，每条带 recoverActName 的伏笔要求幕名存在且回收幕序 > 埋设幕序，违反拒绝（「伏笔回收幕必须是真实幕名且在埋设幕之后」）。
- OutlineNewForeshadow 类型随 schema 自动扩展，submission 无需改动。

### 3.5 章节 Agent（`chapter-agent.ts`）

- `PlanChaptersAgentOptions` 增 `recoverableForeshadows: StoredForeshadow[]`（编排查好传入；无则空数组）。
- prompt 增「本幕待回收伏笔」清单块（带 1-based 序号：`序号. 表面行为——隐藏真相（登场：章名）`）与回收绑定要求：清单中的伏笔若在你规划的章节中揭晓/回收，输出 `foreshadowRecoverBindings`（index = 清单序号，chapterName = 回收章名——本次规划真实章名，且须在该伏笔登场章之后）；不在本幕揭晓的不绑定。
- `saveChaptersInputSchema` 增 `foreshadowRecoverBindings`（refine：(index, chapterName) 组合不重复——**允许同 index 多条**，对应一个伏笔跨多章的多步回收）；`ChapterPlanSubmission` 增该字段；确认视图连带展示。

### 3.6 确定性入库（`foreshadow-intake.ts`）

- `plantOutlineForeshadows`：`recoverActName` → 幕节点 → `recoverActNodeId` 随伏笔入库；未匹配（幕名漂移）**不跳过伏笔**——伏笔照常入库、回收幕置空并 notify 警告（登场幕匹配是入库硬条件、回收幕只是规划信息，降级语义）。
- `plantChapterForeshadows` 增 `recoverBindings` 与 `allChapterNodes`（全书当前版本章节点，含本次规划——顺序校验需要跨幕登场章）参数：
  - 登场绑定（既有 bindings）**增对称顺序校验**：伏笔已有回收章且新登场章全局序 ≥ 最早回收章 → 跳过并警告（登场必须严格早于回收）。
  - 回收绑定逐条：序号越界 / 章名未匹配 / 登场章未绑定 / 回收章全局序 ≤ 登场章全局序 → 逐条跳过并 notify 警告（不阻塞其余）；通过则 `updateForeshadow({ recoverChapterIds: [chapterId] })` 并 notify「♻ 伏笔已绑定回收章」。
  - 返回值增 `recoverBound` 计数。
- 新增导出 `buildChapterOrder`。

### 3.7 编排（`plan-act-chapters.ts`）

- 章节 Agent 调用前：`listUnrecoveredByAct(novelId, act.id)` 查本幕待回收伏笔传入 options。
- 确认入库后（既有伏笔处理块内）：全书当前版本章节点（`listOutlineNodes(currentOnly)` 过滤 chapter + 本次规划 chapterNodes 合并）传 `plantChapterForeshadows`；汇总 notify 增回收绑定计数。
- create-novel / regen-outline：无需改动（plantOutlineForeshadows 签名内部消费 recoverActName；regen 新版伏笔挂新版幕——回收幕同样解析新版树，旧伏笔行不动）。

### 3.8 query CLI（`query.ts`）

- `toForeshadowEntry` 携带 `recoverActNodeId`。
- `toForeshadowPatch`：`recoverChapterIds` 改为入 patch——有值传值、缺省传 **null**（清空）——编辑面已含回收章，「保留现值」语义退役；命令头注释同步。

### 3.9 CLI renderView（`cli-channel.ts`）

- 大纲确认视图伏笔行：带 recoverActName 时显示 `→ 回收：幕名`。
- 章节规划确认视图：增「♻ 伏笔回收绑定（确认后生效）」区块（`序号) → 章名`），缺失或空不渲染。

### 3.10 客户端

- **`chapter-order.ts`**（新建）：`globalChapterOrder(detail): string[]`（全书章 ID 按全局序）+ `orderIndexMap`。
- **ForeshadowEditForm**：增「回收章」多选——登场章已绑定：选项 = 全局序**严格大于**登场章的章（动态过滤）；登场章为空：字段禁用并提示「请先绑定登场章」；切换登场章时已选回收章不再满足则自动剔除；提交时 recoverChapterIds 随完整卡提交（空选 = 清空）。
- **ForeshadowPreview**：增「回收章」行（章名顿号连接，未规划显示「（未规划）」）与「回收幕」行（recoverActNodeId 解析幕名，仅非空且回收章为空时显示——回收章已绑时幕信息冗余；未匹配兜底原 ID）。
- 章卡「回收」徽标已按 recoverChapterIds 过滤，零改动。

## 4. 联动清单

| 联动 | 行为 |
| --- | --- |
| 大纲伏笔带 recoverActName 且幕名漂移 | 伏笔照常入库，回收幕置空 + 警告（不阻塞） |
| 回收幕在埋设幕之前/不存在 | save_outline 入参层拒绝（模型重试） |
| 回收绑定：登场章未绑定 | 跳过并警告（登场未定无从校验顺序） |
| 回收绑定：回收章 ≤ 登场章（全局序） | 跳过并警告 |
| 登场绑定：已有回收章且新登场 ≥ 最早回收章 | 跳过并警告（对称校验，既有行为增强） |
| 手动编辑：登场章清空 | 回收章联动清空（顺序约束无从满足） |
| 旧协议消息（无 foreshadowRecoverBindings / recoverActName） | 视图 optional，照常解析 |
| 旧库（v8~13） | ALTER 增列保数据，旧行 recover_act_node_id=NULL |
| 幕已有章节（不能再规划） | LLM 自动绑定无入口，途径一手动兜底 |

## 5. 验收标准（AC）

1. `bun run typecheck`（3 工程）/ `bun run lint` / `bun run test` 全过，净增用例覆盖：schema 两态与 refine（回收幕顺序拒绝）、迁移 13→14、store（addForeshadow 回收幕 / listUnrecoveredByAct）、intake（大纲回收幕解析与降级、回收绑定四类跳过、登场对称校验、buildChapterOrder）、两 Agent 入参（回收绑定组合去重、index 可重复）、三编排集成（回传清单进 prompt、确认后回收章绑定、通知计数）、query patch（回收章设值/清空）、客户端 SSR 冒烟（表单多选过滤、预览回收行）。
2. 真实库副本迁移 13→14 无损。
3. 真实 LLM 端到端待用户复验：大纲确认门看伏笔行「回收：幕名」；规划回收幕的章节时看「♻ 伏笔回收绑定」区块；确认后章卡「回收」徽标与伏笔预览回收章；手动编辑改回收章。

## 6. 不做范围

- 回收幕的手动编辑（编辑面只编辑回收章；回收幕由大纲链写入）；
- 回收状态的自动流转（绑定回收章后 recoveryStatus 仍手动维护——自动推断「全部回收点已写完」无依据）；
- 大纲重生成对旧伏笔回收幕的迁移（旧伏笔行不动，同登场幕先例）；
- 跨幕回收幕的重新指定界面。

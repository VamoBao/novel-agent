# 伏笔回收规划 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。
> **项目约定覆盖**：拆分任务不单独 commit；每任务以校验闭环收尾，全部完成后 T8 统一原子提交（规格已独立 docs 提交）。

**目标：** 伏笔回收（recoverChapterIds）获得两条写入链路——编辑表单手动规划（回收章严格晚于登场章）+ 大纲挂回收幕/章节规划绑定回收章（幕→章两级，LLM 清单指令 → 确定性绑定）。

**架构：** 全局章节序 = 部 sort → 幕 sort → 章 sort 深度优先展开（agent 侧 `buildChapterOrder` / 客户端 `chapter-order.ts` 各一份）；大纲 Agent newForeshadows 附可选 recoverActName（入参层幕序校验）；章节 Agent 回传「本幕待回收」清单并收 foreshadowRecoverBindings 指令；`foreshadow-intake.ts` 确定性绑定（越界/章名漂移/登场未绑/顺序不满足逐条跳过，登场绑定增对称校验）；SCHEMA_VERSION 13→14 增 recover_act_node_id 列。

**技术栈：** 同主仓（Bun + TS6 strict、zod 4、bun:test、React 19）。

**规格：** `docs/superpowers/specs/2026-10-09-foreshadow-recovery-planning-design.md`

---

### 任务 1：shared——schema 扩展（recoverActName / foreshadowRecoverBindings / recoverActNodeId）

**文件：**
- 修改：`packages/shared/src/foreshadow.ts`（outlineNewForeshadowSchema 增可选 recoverActName）
- 修改：`packages/shared/src/views.ts`（chapterPlanViewSchema 增可选 foreshadowRecoverBindings）
- 修改：`packages/shared/src/query.ts`（foreshadowEntrySchema 增 recoverActNodeId nullable）
- 测试：`packages/shared/src/index.test.ts`、`query.test.ts`

- [ ] 步骤 1：失败测试——outlineNewForeshadow 带/不带 recoverActName 两态；chapter-plan 视图带 foreshadowRecoverBindings 解析（复用 foreshadowBindingSchema 形态）、缺失仍通过；foreshadowEntry recoverActNodeId 值与 null 两态。
- [ ] 步骤 2：实现三处 schema 扩展（字段 describe 注明语义）。
- [ ] 步骤 3：`bun test packages/shared` 过。

### 任务 2：数据层——SCHEMA_VERSION 14 + recover_act_node_id 列 + listUnrecoveredByAct

**文件：**
- 修改：`apps/agent/src/state/db.ts`（版本 14、迁移段 `version >= 8 && version <= 13` ALTER ADD、头注释）
- 修改：`apps/agent/src/state/foreshadow-store.ts`（StoredForeshadow/行结构/三 SQL/ addForeshadow 第四参 / listUnrecoveredByAct / rowToStored）
- 测试：`apps/agent/src/state/db.test.ts`（14 迁移用例 + 既有版本断言 13→14）、`foreshadow-store.test.ts`（回收幕写入往返 / listUnrecoveredByAct 过滤语义）

- [ ] 步骤 1：失败测试——v13 库升 14 列落地保数据；addForeshadow 带 recoverActNodeId 读回；listUnrecoveredByAct 只取「回收幕=本幕且回收章为空」。
- [ ] 步骤 2：实现迁移与 store 扩展。
- [ ] 步骤 3：`bun test apps/agent/src/state/` 过。

### 任务 3：大纲/章节 Agent + CLI renderView

**文件：**
- 修改：`apps/agent/src/workflows/agents/outline-agent.ts`（prompt 回收幕要求 + saveOutlineInputSchemaFor 幕序 refine）
- 修改：`apps/agent/src/workflows/agents/chapter-agent.ts`（options.recoverableForeshadows + prompt 回收清单与绑定要求 + saveChaptersInputSchema 增 foreshadowRecoverBindings（组合去重 refine，index 可重复）+ submission + view）
- 修改：`apps/agent/src/ui/cli-channel.ts`（大纲伏笔行「→ 回收：幕名」；章节规划「♻ 伏笔回收绑定（确认后生效）」区块）
- 测试：`outline-agent.test.ts`（recoverActName 幕序 refine：回收幕不存在/在前拒绝、在后通过、缺省合法）、`chapter-agent.test.ts`（foreshadowRecoverBindings 必填数组、组合重复拒绝、同 index 不同章合法）、`cli-channel.test.ts`（两渲染块）

- [ ] 步骤 1：失败测试（三文件）。
- [ ] 步骤 2：实现 prompt / refine / 入参 / 渲染。
- [ ] 步骤 3：`bun test apps/agent/src/workflows/agents/ apps/agent/src/ui/` 过 + typecheck。

### 任务 4：foreshadow-intake——buildChapterOrder + 大纲回收幕解析 + 回收绑定与对称校验

**文件：**
- 修改：`apps/agent/src/workflows/foreshadow-intake.ts`
- 测试：`apps/agent/src/workflows/foreshadow-intake.test.ts`

- [ ] 步骤 1：失败测试——
  - `buildChapterOrder`：两部各两幕各两章乱序输入 → 展开 8 章按部/幕/章序。
  - `plantOutlineForeshadows`：recoverActName 匹配 → recoverActNodeId 落库；幕名漂移 → 伏笔照常入库、回收幕 null、警告。
  - `plantChapterForeshadows`（扩展签名 recoverBindings + allChapterNodes）：回收绑定成功（登场在前）patch recoverChapterIds；序号越界 / 章名漂移 / 登场未绑 / 回收章≤登场章（跨幕用 allChapterNodes 构造）逐条跳过警告；同伏笔多条指令（多步回收）合法；登场绑定对称校验：已有回收章且新登场≥最早回收 → 跳过警告。
  - 返回值 { created, skipped, bound, recoverBound }。
- [ ] 步骤 2：实现（buildChapterOrder 纯函数：按 parentId 组树、sort 排、深度优先收集章 ID → Map<id, 序号>；plantChapterForeshadows 顺序校验用全书序表）。
- [ ] 步骤 3：`bun test apps/agent/src/workflows/foreshadow-intake.test.ts` 过。

### 任务 5：编排接入——plan-act-chapters 回传与绑定

**文件：**
- 修改：`apps/agent/src/workflows/plan-act-chapters.ts`（listUnrecoveredByAct 传入 agent；确认后全书章节点传 plantChapterForeshadows；通知文案增回收计数）
- 测试：`plan-act-chapters.test.ts`（种子伏笔挂回收幕=本幕 → prompt 含「本幕待回收伏笔」清单；save_chapters 附回收绑定指令；确认后 recoverChapterIds 落库；通知计数）

- [ ] 步骤 1：失败测试（成功路径扩展 + 回收绑定断言）。
- [ ] 步骤 2：实现编排接线。
- [ ] 步骤 3：`bun test apps/agent/src/workflows/` 过。

### 任务 6：query CLI——recoverActNodeId 透出 + 回收章入 patch

**文件：**
- 修改：`apps/agent/src/query.ts`（toForeshadowEntry 带 recoverActNodeId；toForeshadowPatch recoverChapterIds 有值传值/缺省 null；头注释）
- 测试：`apps/agent/src/query.test.ts`（update-foreshadow 设回收章与清空回收章两路径）

- [ ] 步骤 1：失败测试。
- [ ] 步骤 2：实现。
- [ ] 步骤 3：`bun test apps/agent/src/query.test.ts` 过。

### 任务 7：客户端——chapter-order + 编辑表单回收章多选 + 预览回收行

**文件：**
- 创建：`apps/client/src/chapter-order.ts`（globalChapterOrder + orderIndexMap）
- 修改：`apps/client/src/components/ForeshadowEditForm.tsx`（回收章多选：登场章后动态过滤、登场空禁用、切换登场自动剔除失效项）
- 修改：`apps/client/src/components/PreviewPane.tsx`（ForeshadowPreview 增回收章行与回收幕行）
- 测试：transient SSR 冒烟

- [ ] 步骤 1：实现 chapter-order.ts + 表单 + 预览。
- [ ] 步骤 2：SSR 冒烟（表单选项过滤、登场空禁用、预览回收行、无 ID 泄露）。
- [ ] 步骤 3：typecheck 过。

### 任务 8：收尾——全量校验 + 副本迁移实跑 + 文档同步 + 原子提交

- [ ] typecheck / lint / 全量测试 100% 过。
- [ ] 真实库副本 13→14 迁移实跑无损（真实库不动）。
- [ ] 文档同步：AGENTS.md（save_outline/save_chapters 描述、foreshadow-intake 模块、ForeshadowEditForm/预览描述）、根 ARCHITECTURE.md（workflows 树、大纲/章节流程段、数据层 14）、workflows/ARCHITECTURE.md（同构更新）、PROGRESS 归一、DECISIONS 落盘。
- [ ] 原子提交 + 遗留交接（真实 LLM 端到端复验步骤）。

---

## 自检记录

- 规格覆盖：3.1→T4/T7、3.2→T1、3.3→T2、3.4→T3、3.5→T3、3.6→T4、3.7→T5、3.8→T6、3.9→T3、3.10→T7、AC→T8——全覆盖；联动清单各行对应 T3（refine）/T4（四类跳过+对称校验）/T7（登场清空联动）/T1（optional 零破坏）/T2（迁移）。
- 类型一致性：`recoverActName`（T1 定义，T3/T4 消费）、`foreshadowRecoverBindings`（T1 视图 optional / T3 入参必填数组与 submission，T5 透传）、`recoverActNodeId`（T2 StoredForeshadow，T6 透出）、`buildChapterOrder`（T4 定义，T5 消费）、`allChapterNodes`/`recoverBindings` 新参（T4 定义，T5 传入）——一致。

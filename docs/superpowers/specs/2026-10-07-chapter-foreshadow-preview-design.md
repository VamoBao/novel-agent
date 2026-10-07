# 章节预览伏笔展示 设计规格

> 状态：**已确认**（2026-10-07——两项实质决策经用户确认：「涉及」= 登场 + 回收都展示（带徽标区分）；幕卡不动。任务包沿用本会话已三轮确认的同构 SDD 流水线）
> 需求来源：用户提出——章节预览的界面可以查看当前章节涉及到的伏笔。
> 前置依赖：伏笔接入需求已落地（`foreshadows` 表含 `appear_chapter_id` / `recover_chapter_ids` / `character_ids`，大纲与章节规划两阶段自动入库与绑定）。

## 1. 背景与问题

- 伏笔已随大纲与章节规划入库（登场章经 `appearChapterId` 绑定），但客户端**零展示**：`novelDetail` 查询契约不含伏笔，章卡（`OutlineNodeCard` 的 chapter 分支）只有梗概 / 正文。
- 用户在预览章节时无法看到「本章埋了什么伏笔、回收了什么」，正文写作与核对无从对齐。

## 2. 用户确认的两项决策

1. **「本章涉及的伏笔」= 登场 + 回收都展示**：登场（`appearChapterId = 本章`）与回收（`recoverChapterIds` 含本章）分别带「登场 / 回收」徽标——回收数据当前无写入来源（回收流为后续需求），过滤零成本预留，落地后立即生效。
2. **幕卡不动**：仅章卡展示；幕下未绑章伏笔不在本次范围。

## 3. 详细设计

### 3.1 shared 查询契约（`packages/shared/src/query.ts`）

- 新增 `foreshadowEntrySchema = foreshadowSchema.extend({ id: z.string().min(1) })`，类型 `ForeshadowEntry`——复用既有卡片字段（含 `appearChapterId` / `recoverChapterIds` / `characterIds` / `recoveryStatus`）；服务角色保持 **ID 形态**（客户端经详情 characters 解析名字，与 characterEntry 携带 id 供树节点 key 同构）。`actNodeId` 不入契约（章卡不需要，YAGNI）。
- `novelDetailSchema` 增 `foreshadows: z.array(foreshadowEntrySchema).describe("全部伏笔（按入库顺序，未生成为空数组；章节点预览按 appearChapterId / recoverChapterIds 取用）")`。

### 3.2 agent 查询 CLI（`apps/agent/src/query.ts`）

- `buildNovelDetail` 增：`const foreshadows = new ForeshadowStore(db).listForeshadows(novelId).map((f) => ({ id: f.id, ...f.foreshadow }));`（行经 store 读侧 schema.parse，`recoveryStatus` 默认值已填充）；返回对象增 `foreshadows`。
- `query.test.ts` 增集成用例：种子「登场章绑定 + 回收章绑定 + 无绑定」三形态伏笔，断言 `detail.foreshadows` 字段（appearChapterId / recoverChapterIds / characterIds / recoveryStatus）正确携带。

### 3.3 客户端（`PreviewPane.tsx` + `OutlineNodeCard.tsx`）

- **PreviewPane 章节点分支**构造显示模型（过滤 + 名字解析集中在此，卡片纯渲染）：
  - `appearChapterId === node.id` → 徽标「登场」；`recoverChapterIds?.includes(node.id)` → 徽标「回收」（同一伏笔可同时命中两组，各显示一条）；
  - `characterIds` 经 `detail.characters` 解析为名字（`characterEntry.id` 匹配；未匹配兜底显示原 ID）；
  - 显示模型 `ChapterForeshadow { key: string; badge: "登场" | "回收"; surfaceAction: string; hiddenTruth: string; attentionLevel: number; characterNames: string[] }`（client 本地类型）。
- **OutlineNodeCard**：props 增可选 `foreshadows?: ChapterForeshadow[]`；章卡在正文卡（或生成入口）之后渲染「📌 伏笔」区块——`card-label` 标题「伏笔」+ 逐条「[登场/回收] 表面行为 ⇢ 隐藏真相（注意度 N，服务：名字…）」；undefined / 空数组不渲染（与无正文不渲染正文卡同风格）。
- 协议与 headless 零改动（详情经既有 library IPC 的 shared schema 复验自动兼容）。

## 4. 边界与错误处理

- 无伏笔的章（旧书 / 未规划伏笔）→ 不渲染区块，章卡其余内容零变化。
- 服务角色名解析失败（角色已删等）→ 兜底显示原 ID，不隐藏整条。
- 回收数组暂无数据来源 → 过滤分支自然空，渲染无感。
- `novelDetail.foreshadows` 缺失（旧协议消息）→ 客户端 schema 复验剥离后为空数组行为——本字段为必填数组（新契约），旧客户端读新 CLI 输出剥离未知字段零破坏。

## 5. 测试计划

- shared `query.test.ts`：`foreshadowEntrySchema` 与 `novelDetailSchema.foreshadows` 契约单测（两形态）。
- agent `query.test.ts`：`buildNovelDetail` 集成用例（三形态种子断言）。
- client：typecheck 验证（无组件测试基建）；GUI 观感待用户人工验收（可选用 `NOVEL_CLIENT_SELECT` + `NOVEL_CLIENT_SCREENSHOT` 无头截图冒烟）。

## 6. 文档同步与提交

- `AGENTS.md`（client 条目章卡描述补伏笔区块、query 契约描述）、根 `ARCHITECTURE.md`（query CLI 与客户端浏览描述）、两级 `PROGRESS.md` 归一。决策级别较轻（范围决策已由用户确认，落 DECISIONS 与否以「无新架构取舍」判断——仅记录范围界定一条）。
- 整项需求一次原子提交（squash 回 master）。

## 7. 不做范围

- 幕卡不展示未绑章伏笔；伏笔增删 / 编辑 / 回收流转管理 UI 不做；
- `actNodeId` 不入查询契约；协议 / headless / 数据层零改动；
- 不做伏笔跨章汇总视图（全书伏笔列表）。

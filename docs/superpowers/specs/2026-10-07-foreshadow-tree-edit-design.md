# 结构树伏笔组与预览编辑 设计规格

> 状态：**已确认**（2026-10-07——两项实质决策经用户确认：树形态 = 按埋设幕分组两级树；编辑范围 = 全字段含绑定（登场章 + 服务角色）。任务包经用户确认。）
> 需求来源：用户提出——界面中间结构处展示伏笔内容，放在角色和大纲中间，也是树结构可展开，点击伏笔可预览相关字段内容并可编辑修改。
> 前置依赖：伏笔接入（大纲与章节规划确定性入库 + 章卡伏笔区块）与 `novelDetail.foreshadows` 查询契约已落地。

## 1. 背景与问题

- 伏笔已入库并在章卡按章可见，但中栏结构树无伏笔入口——无法按幕总览、无法点击单条查看与修改。
- 修正错绑（登场章 / 服务角色）当前无任何界面手段；`ForeshadowStore.updateForeshadow` patch 能力（含服务角色同小说校验）闲置。

## 2. 用户确认的两项决策

1. **树形态 = 按埋设幕分组两级树**：伏笔按 `actNodeId` 分组，幕顺序对齐大纲树当前版本顺序，未绑幕归末尾「未绑幕」组；组头与幕分组行均可收起（默认展开、会话内保持）。需查询契约补 `actNodeId`。
2. **编辑范围 = 全字段含绑定**：登场章下拉单选（可清空）+ 服务角色多选；回收章（`recoverChapterIds`）不编辑（回收流后续需求）。

## 3. 详细设计

### 3.1 shared 查询契约（`packages/shared/src/query.ts`）

- `foreshadowEntrySchema` 增 `actNodeId: z.string().min(1).nullable().describe("埋设幕节点 ID（outlines 表 act 节点）；未绑幕 / 旧数据为 null")`——树分组依据；其余字段复用现状。`novelDetailSchema` 不变（已含 foreshadows）。

### 3.2 agent 查询 CLI（`apps/agent/src/query.ts`）

- `buildNovelDetail` 伏笔映射补 `actNodeId: f.actNodeId`。
- 新命令 `update-foreshadow <novelId> <foreshadowId> <伏笔JSON>`，导出 `updateForeshadowEntry(db, novelId, foreshadowId, foreshadowJson): ForeshadowEntry`：
  1. JSON 解析 + `foreshadowSchema.parse`（完整卡校验）；
  2. **转 patch**（关键语义——`updateForeshadow` 的 patch 是 undefined=不动 / null=清空）：必填三字段（surfaceAction / hiddenTruth / attentionLevel）与 recoveryStatus 直接传值；可选字段（plantingMethod / purpose / appearChapterId）有值传值、undefined 传 **null**（清空）；`characterIds` 非空数组传值、否则传 **null**；**`recoverChapterIds` 不入 patch**（编辑面不含回收章，保留现值）；
  3. `ForeshadowStore.updateForeshadow`（伏笔不存在 / 服务角色跨小说抛可读错误——store 内置）；
  4. 返回更新后 `ForeshadowEntry`（含 actNodeId——幕归属不受本次编辑影响）。
- 用法行与命令表补 `update-foreshadow`。

### 3.3 client IPC 链

- `main.ts`：`library:updateForeshadow` handler（spawn query CLI `update-foreshadow`，返回值经 `foreshadowEntrySchema` 复验，8s 超时兜底）。
- `preload.ts` / `env.d.ts`：`updateForeshadow(novelId, foreshadowId, foreshadow): Promise<ForeshadowEntry>`。

### 3.4 结构树伏笔组（`StructureTreePanel.tsx`）

- `Selection` 联合类型增 `{ kind: "foreshadow"; foreshadowId: string }`。
- 角色组与大纲组之间插入伏笔组：
  - 组头「🔮 伏笔」+ 三角整组收起（`fsGroupCollapsed` state，默认展开；条目为 0 时不显示三角、组下占位「（暂无伏笔）」）；
  - 组内按 `actNodeId` 分组：幕顺序 = `detail.outlineNodes` 当前版本 act 节点顺序；无 actNodeId 条目归末尾「未绑幕」组；
  - 幕分组行：三角收起 + 幕名文本（`fsActCollapsed: ReadonlySet<string>`，默认空 = 全展开、会话内保持；**仅作分组头，不触发选中**——保持伏笔组语义纯粹）；
  - 叶子：`TreeNode` depth=2、label `✦ ${surfaceAction}`、点击 `onSelect({ kind: "foreshadow", foreshadowId })`。

### 3.5 右栏预览与编辑

- **`ForeshadowPreview`**（PreviewPane 内模块级组件，镜像 CharacterPreview）：顶部「✏️ 编辑伏笔」按钮（editing state 切换表单）；只读卡（viewcard 风格）展示：表面行为 / 隐藏真相 / 注意度 / 回收状态（未回收 / 部分回收 / 已回收中文）/ 埋设幕名（actNodeId 经 detail.outlineNodes 解析，null 占位「未绑幕」）/ 登场章名（appearChapterId 解析为「部/幕/章」名，未绑定占位）/ 服务角色名（characterIds 解析，未匹配兜底原 ID）/ 埋线方式 / 创作目的（无则不渲染行）。
- **`ForeshadowEditForm`**（新组件 `apps/client/src/components/ForeshadowEditForm.tsx`，镜像 CharacterEditForm）：
  - 表单态：surfaceAction / hiddenTruth（textarea）、attentionLevel（数字输入，1-10 整数校验）、recoveryStatus（下拉：unrecovered 未回收 / partial 部分回收 / recovered 已回收）、plantingMethod / purpose（可选文本）、appearChapterId（下拉：`（未绑定）` + 当前版本 chapter 节点，选项 label 为「部名/幕名/章名」）、characterIds（checkbox 多选 detail.characters，label 角色名）；
  - 必填校验：surfaceAction / hiddenTruth 非空、attentionLevel 为 1-10 整数——缺一拦截提交并提示；
  - 提交构造完整 `Foreshadow`（可选项空串→undefined；characterIds 空选→undefined；appearChapterId 空串→undefined；recoveryStatus 恒有值）→ `updateForeshadow` → 成功 `onSubmitted(entry)`（PreviewPane 退出编辑态 + `onForeshadowSaved()` 刷新详情——伏笔 id 稳定，选中不失效）；失败展示错误；取消零副作用。
- **PreviewPane**：props 增 `onForeshadowSaved?: () => void`；分支 `selection.kind === "foreshadow"` 取 `detail.foreshadows.find(f => f.id === selection.foreshadowId)` 渲染 ForeshadowPreview（缺失时 pane-error 占位，对齐角色先例）。
- **App 接线**：`onForeshadowSaved` = 既有 reloadDetail（同 onCharacterSaved）。

## 4. 边界与错误处理

- 幕 / 章归属解析失败（actNodeId 指向归档节点等）：树分组归「未绑幕」、预览幕名兜底显示原 ID；章名解析失败兜底原 ID——不隐藏条目。
- `updateForeshadow` 服务角色跨小说 → CLI 抛可读错误 → IPC 错误 → 表单错误提示，详情不刷新。
- 伏笔不存在（并发删除等）→ CLI 可读错误 → 表单提示。
- 可选项清空语义经 null patch 真实清空（区别于角色编辑的全量覆盖——patch 语义差异在计划与测试中显式覆盖）。
- 旧数据伏笔（无 actNodeId）正常入「未绑幕」组。

## 5. 测试计划

- shared：foreshadowEntry `actNodeId` 两态（值 / null）契约单测。
- agent `query.test.ts`：`update-foreshadow` 集成用例——改必填值生效；可选字段清空（null 语义）；登场章与服务角色改绑生效（种子真实章节点与角色）；`recoverChapterIds` 现值保留；伏笔不存在拒绝；返回条目含 actNodeId。
- client：typecheck（无组件测试基建）；GUI 树分组 / 预览 / 编辑流待用户人工验收。

## 6. 文档同步与提交

- `AGENTS.md`（结构树描述、query 管理命令、client 组件）、根 `ARCHITECTURE.md`（query CLI 命令、客户端浏览描述）、两级 `PROGRESS.md` 归一、根 `DECISIONS.md`（patch 编辑语义——undefined=不动 / null=清空与表单清空语义的映射决策；幕分组行不选中）。
- 整项需求一次原子提交（squash 回 master）。

## 7. 不做范围

- 不新增 / 删除伏笔（管理命令仅 update；增删与回收流转 UI 为后续需求）；
- `recoverChapterIds` 不可编辑（回收流后续）；无 AI 润色；
- 协议 / headless / 数据层 schema 零改动（复用既有 patch）；
- 幕分组行不作为大纲节点选中入口。

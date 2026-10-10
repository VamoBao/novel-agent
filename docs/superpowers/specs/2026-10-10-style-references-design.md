# 参考文风 设计规格

> 状态：**已确认**（2026-10-10——三项选型经用户确认：内容存储 = 存数据库不落文件（agent 建议并说明理由，用户采纳）；作用范围 = 每本小说独立（style_references 挂 novel_id 外键）；注入策略 = 带启用开关（enabled 列，生成正文只注入启用的条目）。设计全文经用户确认后开始执行。）
> 需求来源：用户提出——新增「参考文风」模块，用户在结构界面新增参考文风（一份或多份文本），每次生成正文时 LLM 参考这些文本的文风来生成正文；需新增数据库表，文本内容存数据库还是存本地文件由建议定夺。
> 前置依赖：write-chapter 章节正文生成链路已成熟（prompt 组装点单一、无确认门）；结构树「📍 地点」组交互模式（可收起 + 空组占位 + 只读卡）与 ForeshadowEditForm 编辑表单模式可复用；query CLI 管理命令（add-character / update-foreshadow）为直写库先例。

## 1. 背景与问题

- 生成正文（write-chapter）的写作要求只有通用约束（篇幅、世界观禁忌、场景化叙述），无法沉淀用户对「文风」的偏好——用户若有喜欢的作者风格 / 范文，目前没有入口喂给写作模型。
- 需要一个由用户手动维护的「参考文风」资料库：每本小说可挂多份文本样本，生成正文时按启用状态注入 prompt。

## 2. 用户确认的三项决策

1. **内容存储 = 存数据库**（TEXT 列直接进库，不落文件、无 file_path）。`documents` 表「正文存文件」的三个动机对参考文风均不成立：
   - 正文是**人类阅读产物**，按 `<小说>/<部>/<章>.md` 层级目录组织供文件系统翻阅——文风是喂给 LLM 的素材，经 UI 粘贴录入，无目录组织诉求；
   - 正文体量随章节**线性增长**——文风体量小而恒定（每本通常 1~3 份、每份几百到几千字，表单软上限约束），SQLite TEXT 列无压力；
   - 正文列表查询可**懒加载**（列表只读元数据、按需读文件）——文风每次生成正文都全量注入 prompt，无懒加载优化空间。
   - 而存文件需背负 documents 真实背过的全套生命周期复杂度：rename 联动迁移文件（updateFilePaths）、deleteNovel 逐文件清理、文件缺失读取兜底——存库后全部消解（备份 = 单个 novel.db、删除 = 级联 SQL、改名零联动）。「文档 ID 链接」的适用场景（大体量 + 人类可读产物 + 文件系统直接编辑）一条不占。
2. **作用范围 = 每本小说独立**：style_references 挂 novel_id 外键，与角色 / 地点 / 伏笔一致——结构树天然按小说展示、删除小说级联清理、查询契约对齐。跨书复用走复制粘贴（每份才几千字，成本极低），首版不做全局文风库。
3. **注入策略 = 带启用开关**：每条 enabled 标记（INTEGER 0/1，默认 1），生成正文只注入启用的条目——并存多份风格时切换试用不必反复删建。

## 3. 详细设计

### 3.1 shared schema（`packages/shared/src/style-reference.ts` 新建）

```ts
styleReferenceSchema = z.object({
  name: z.string().min(1),      // 名字（如「江南式打斗」），必填
  content: z.string().min(1),   // 文本内容，必填
  enabled: z.boolean(),         // 启用开关（默认 true——入库 schema 默认值在 store 层）
});
```

- 导出类型 `StyleReference`；`index.ts` 补导出。
- 表单软上限（约 2 万字符）为**客户端 UI 校验**，schema 层不做 max 硬约束（避免历史数据 / 大样本合法输入被 schema 拒绝）。

### 3.2 数据库迁移（`state/db.ts`，SCHEMA_VERSION 14→15）

```sql
CREATE TABLE IF NOT EXISTS style_references (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL REFERENCES novels(id),
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_style_references_novel_id ON style_references(novel_id);
```

- **纯新增表**：无 ALTER，`CREATE TABLE IF NOT EXISTS` 幂等落地（先例：7→8 foreshadows、9→10 documents），迁移分支仅版本号注释占位。
- `deleteNovel` 级联清八表（novel-store.ts 级联清单补 style_references——外键无 ON DELETE CASCADE，对齐其余六表逐表删除惯例）。
- 小说改名**零联动**（内容进库、无 file_path——存库方案消解的成本）。

### 3.3 store（`state/style-reference-store.ts` 新建）

对齐 LocationStore / ForeshadowStore 惯例（读写双向 zod 校验、UUIDv7 主键、共享连接）：

- `addStyleReference(novelId, input: { name, content, enabled? })`：schema 校验 → 小说存在性由调用方保证（query CLI 层校验，与 add-character 同）→ 入库（enabled 缺省 true）→ 返回 StoredStyleReference（id / novelId / createdAt / updatedAt / styleReference）。
- `listStyleReferences(novelId)`：按入库顺序（created_at ASC, id ASC，对齐 locations）。
- `updateStyleReference(id, patch: { name?, content?, enabled? })`：patch 语义（undefined = 不动），行不存在抛可读错误，updated_at 刷新。
- `deleteStyleReference(id)`：行不存在抛可读错误。
- `getStyleReference(id)`：单条取用（编辑回显与写入后重读）。

### 3.4 query 契约与 CLI（`packages/shared/src/query.ts` + `apps/agent/src/query.ts`）

- `styleReferenceEntrySchema = styleReferenceSchema.extend({ id })`（对齐 locationEntrySchema 模式）；`novelDetailSchema` 增 `styleReferences: z.array(styleReferenceEntrySchema)`（按入库顺序）。
- CLI 新增三管理命令（无 LLM 会话，纯文本操作直写库，先例 add-character / update-foreshadow）：
  - `add-style <novelId> <文风JSON>`（JSON：{ name, content, enabled? }）
  - `update-style <novelId> <styleId> <文风JSON>`（全量编辑：{ name, content, enabled }）
  - `delete-style <styleId>`
  - 统一返回 StyleReferenceEntry 单行 JSON；用法文案与命令分派同步补。

### 3.5 write-chapter 注入（`workflows/write-chapter.ts`）

- **前置校验不变**：无文风不阻塞——文风是可选增强，走原有流程（不新增校验分支）。
- 上下文组装时 `listStyleReferences(novelId)` 过滤 `enabled === true`，非空则在 prompt 的【下一章】块之后、写作要求之前插入：

```
【参考文风】
（名字1）
<内容1>
（名字2）
<内容2>
```

  长样本放 prompt 尾部：不把世界观 / 角色 / 本章概述等核心上下文推远，且紧邻风格指令。
- 写作要求新增一条：「模仿参考文风的叙事语言、句式节奏与描写风格，但不抄袭其具体情节与专有名词」（仅在有启用文风时附加，无文风时要求清单不变）。
- 生成前 notify「🖋️ 本次参考文风：名字1、名字2」，让用户知道哪些样本生效；无启用文风时零 notify、零注入（行为与现状逐字节一致）。

### 3.6 客户端（apps/client）

- **结构树**（StructureTreePanel）：「🖋️ 文风」组排**最后**（大纲之后——设定类 → 规划类 → 结构 → 写作素材），复用地点组交互：组头可整组收起（默认展开、会话内保持）、空组「（暂无文风）」占位、组头「＋ 新增」入口；叶子 `🖋 名字`（禁用态文风名后缀「（已停用）」弱提示），点击右栏预览。Selection 联合增 `{ kind: "style"; styleId: string }`。
- **右栏预览**（PreviewPane）：StylePreview 只读卡——名字 + 启用徽标（✅ 启用中 / ⏸ 已停用）+ 内容全文（白空间保留，`white-space: pre-wrap`）+「✏️ 编辑文风」入口；不展示 id（全页面去 ID 约定）。
- **编辑表单**（StyleEditForm 新建，新建 / 编辑共用，对齐 CharacterEditForm 模式）：名字（必填）、内容 textarea（必填，软上限 20000 字符——超限禁提交并提示）、启用开关；提交经 `addStyle` / `updateStyle` IPC 直写库刷新详情、取消零副作用。
- **IPC 链**：main.ts `library:addStyle` / `library:updateStyle` / `library:deleteStyle`（runLibraryQuery + styleReferenceEntrySchema 复验，对齐 handleForeshadowMutation 模式）+ preload / env.d.ts 各补三方法。删除入口放编辑态表单（「🗑 删除」按钮 + confirm 确认）——预览卡保持只读纯净。
- **App 接线**：`onStyleSaved` / `onStyleCreated` 回调 → reloadDetail（对齐伏笔/角色模式）。

## 4. 数据流

1. 用户在结构树「🖋️ 文风」组头「＋」→ 右栏空表单 → 填名字 + 粘贴文本 → 提交 → `library:addStyle` IPC → query CLI `add-style` → StyleStore.addStyleReference 入库 → 返回条目 → 客户端刷新详情、自动选中新条目。
2. 生成正文：章卡「✍️ 生成本章正文」→ writeChapter 组上下文时读启用文风 → 注入【参考文风】段 + 模仿要求 → 写作模型生成 → 落盘入库（既有链路零改动）。
3. 删除小说：novel-store.deleteNovel 级联 DELETE style_references（随八表清空）。

## 5. 错误处理

- JSON 入参不合法（CLI）：解析 / schema 校验失败抛带首个 issue 定位的可读错误（对齐 parseCharacterJson），stderr 非零退出。
- 编辑不存在的文风 / 删除不存在的文风：store 层抛可读错误。
- 文风条目全部停用或小说无文风：write-chapter 照常生成（零注入），不阻塞。

## 6. 测试计划

- shared：styleReferenceSchema 合法 / 非法（空名 / 空内容）、entry 契约、novelDetail.styleReferences 字段存在。
- 数据层：v14→v15 迁移（新库直建 + 旧库升级幂等）、store CRUD 全路径（add 缺省 enabled / list 顺序 / update patch 三字段选择性更新 / delete / 不存在抛错）。
- write-chapter：无文风 prompt 无【参考文风】段（现状回归）；有启用文风 prompt 含段落与名字、要求清单含模仿条、notify 带名字清单；仅停用文风时同无文风；混合时只注入启用条。
- query CLI：add-style / update-style / delete-style 集成（临时库实跑）。

## 7. 不做范围（Out of Scope）

- 全局跨书文风库、多对多关联。
- 文风条目的 AI 润色 / 风格分析摘要（可后续需求）。
- 大纲生成、章节规划会话注入文风（仅正文生成接入——文风影响的是「怎么写」，不影响「写什么」）。
- 按部 / 幕 / 章粒度差异化挂接文风（首版小说级全量启用制）。
- CLI 终端创作流的文风录入入口（客户端 UI 优先，查询 CLI 三命令已可脚本化维护）。

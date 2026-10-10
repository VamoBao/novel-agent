# 参考文风 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。
> **项目约定覆盖**：按 `docs/feature-check-guide.md`，拆分任务不单独 commit；每任务以校验闭环收尾，全部完成后 T8 统一原子提交（规格 / 计划文档各自独立 docs 提交）。

**目标：** 用户在客户端结构树维护每本小说的参考文风（一份或多份文本、带启用开关），生成正文时写作模型按启用的文风样本调整语言风格。

**架构：** 纯新增 `style_references` 表（SCHEMA_VERSION 14→15，CREATE IF NOT EXISTS 幂等）+ StyleReferenceStore CRUD；内容直接进库（不落文件、无 file_path——决策见规格）；query CLI 三管理命令直写库 + novelDetail 契约透出；write-chapter 上下文组装时注入启用文风段（无文风零改动）；客户端结构树「🖋️ 文风」组（复用地点组交互）+ 预览卡 + 新建/编辑共用表单。

**技术栈：** Bun 1.4 + TypeScript 6（strict）、zod 4、`bun:sqlite`、React 19（renderer）、`bun:test`。

**规格：** `docs/superpowers/specs/2026-10-10-style-references-design.md`

---

### 任务 1：shared——styleReferenceSchema + 查询契约

**文件：**
- 新建：`packages/shared/src/style-reference.ts`
- 修改：`packages/shared/src/query.ts`（styleReferenceEntrySchema + novelDetail.styleReferences）
- 修改：`packages/shared/src/index.ts`（补导出）
- 测试：`packages/shared/src/index.test.ts`

- [ ] **步骤 1：编写失败的测试**（index.test.ts 追加，对齐既有 describe 风格）

```ts
describe("styleReferenceSchema 与查询契约", () => {
  test("名字+内容合法解析，enabled 缺省 true（store 层默认，schema 显式必填）", () => {
    const s = styleReferenceSchema.parse({ name: "江南式打斗", content: "刀光一闪……", enabled: true });
    expect(s).toEqual({ name: "江南式打斗", content: "刀光一闪……", enabled: true });
  });
  test("空名 / 空内容被拒绝", () => {
    expect(() => styleReferenceSchema.parse({ name: "", content: "x", enabled: true })).toThrow();
    expect(() => styleReferenceSchema.parse({ name: "文风", content: "", enabled: true })).toThrow();
  });
  test("styleReferenceEntrySchema = schema + id；novelDetail.styleReferences 字段存在", () => {
    const entry = styleReferenceEntrySchema.parse({ id: "s1", name: "文风", content: "样本", enabled: false });
    expect(entry.id).toBe("s1");
    expect(novelDetailSchema.shape.styleReferences).toBeDefined();
  });
});
```

- [ ] **步骤 2：运行测试验证失败**——`bun test packages/shared`（schema 未导出）

- [ ] **步骤 3：实现**——新建 `style-reference.ts`（name / content 均 `z.string().min(1)`，enabled `z.boolean()`；导出 `StyleReference`）；query.ts 增 `styleReferenceEntrySchema = styleReferenceSchema.extend({ id: z.string().min(1) })`（对齐 locationEntrySchema）与 `novelDetailSchema.styleReferences` 数组（按入库顺序）；index.ts 补导出。

- [ ] **步骤 4：测试与静态校验通过**——`bun test packages/shared` && `bun run typecheck`。

### 任务 2：数据层——14→15 迁移 + StyleReferenceStore

**文件：**
- 修改：`apps/agent/src/state/db.ts`（SCHEMA_VERSION 15 + 建表 DDL + 注释）
- 修改：`apps/agent/src/state/novel-store.ts`（deleteNovel 级联清单补 style_references）
- 新建：`apps/agent/src/state/style-reference-store.ts`
- 测试：`apps/agent/src/state/style-reference-store.test.ts`（新建；迁移用例并入既有 db 迁移测试文件所在位置，对齐惯例）

- [ ] **步骤 1：编写失败的测试**——store CRUD：add（enabled 缺省 true / 显式 false）/ list 按入库顺序 / update patch 三字段选择性更新（undefined 不动、updated_at 刷新）/ delete / get / 不存在抛可读错误；迁移：旧库（v14 形态，无该表）打开后升级 15 且表可插查，新库直建；deleteNovel 后 style_references 行随级联消失。

- [ ] **步骤 2：运行测试验证失败**——`bun test apps/agent/src/state`

- [ ] **步骤 3：实现**——
  - db.ts：`SCHEMA_VERSION = 15`；DDL 追加到建表区（规格 3.2 SQL）；表注释补进文件头清单。纯新增表，迁移分支仅注释占位（先例 9→10 documents）。
  - novel-store.ts：deleteNovel 级联 DELETE 清单补 `style_references`（外键无 ON DELETE CASCADE，逐表删除惯例）。
  - style-reference-store.ts：`StoredStyleReference { id, novelId, createdAt, updatedAt, styleReference }`；`addStyleReference(novelId, input)`（styleReferenceSchema 延展 enabled 可选默认 true，写侧校验）、`listStyleReferences`（ORDER BY created_at ASC, id ASC，读侧校验）、`getStyleReference`、`updateStyleReference(id, patch)`（undefined=不动，行不存在抛错）、`deleteStyleReference(id)`（行不存在抛错）、`getDefaultStyleReferenceStore()` 懒加载单例。

- [ ] **步骤 4：测试与静态校验通过**——`bun test apps/agent/src/state` && `bun run typecheck`。

### 任务 3：query CLI——三管理命令 + detail 透出

**文件：**
- 修改：`apps/agent/src/query.ts`（buildNovelDetail 读文风 + add-style / update-style / delete-style 三命令 + 用法文案）
- 测试：`apps/agent/src/query.test.ts`（既有文件追加）

- [ ] **步骤 1：编写失败的测试**——临时库实跑：`buildNovelDetail` 含 styleReferences 条目（入库顺序）；`addStyleEntry`（小说不存在抛错 / JSON 非法抛错 / 成功返回条目）；`updateStyleEntry`（全量编辑返回更新后条目）；`deleteStyleEntry`（删除后 list 减少）。

- [ ] **步骤 2：运行测试验证失败**——`bun test apps/agent/src/query.test.ts`

- [ ] **步骤 3：实现**——对齐 add-character / update-foreshadow 模式：`parseStyleReferenceJson`（JSON.parse + schema safeParse，错误带首个 issue 定位）；`addStyleEntry(db, novelId, json)` / `updateStyleEntry(db, novelId, styleId, json)` / `deleteStyleEntry(db, styleId)`；main switch 三分支与用法字符串补齐。

- [ ] **步骤 4：测试与静态校验通过**——`bun test apps/agent/src/query.test.ts` && `bun run typecheck`。

### 任务 4：write-chapter 注入启用文风

**文件：**
- 修改：`apps/agent/src/workflows/write-chapter.ts`
- 测试：`apps/agent/src/workflows/write-chapter.test.ts`（既有文件追加）

- [ ] **步骤 1：编写失败的测试**——四态断言 generateText 收到的 prompt：①无文风 → 无【参考文风】段、要求清单不含模仿条、零文风 notify（现状回归）；②两条启用文风 → 段落在【下一章】块之后、含「（名字）」与内容、要求含「模仿参考文风」条、notify 含「🖋️ 本次参考文风：名字1、名字2」；③全部停用 → 同①；④混合启用停用 → 只注入启用条。

- [ ] **步骤 2：运行测试验证失败**——`bun test apps/agent/src/workflows/write-chapter.test.ts`

- [ ] **步骤 3：实现**——WriteChapterOptions 增可选 `styleReferenceStore?`（默认 getDefaultStyleReferenceStore，测试注入）；上下文组装处 `listStyleReferences(novelId).filter(enabled)`；非空时 prompt 行数组在【下一章】块后插【参考文风】段（`（名字）\n内容`，条间空行）、写作要求插入模仿条（编号顺延）、生成前 `channel.notify` 名字清单。

- [ ] **步骤 4：测试与静态校验通过**——`bun test apps/agent/src/workflows/write-chapter.test.ts` && `bun run typecheck`。

### 任务 5：客户端 IPC 链

**文件：**
- 修改：`apps/client/electron/main.ts`（library:addStyle / library:updateStyle / library:deleteStyle + styleReferenceEntrySchema 复验）
- 修改：`apps/client/electron/preload.ts`、`apps/client/src/env.d.ts`（各补三方法）

- [ ] **步骤 1：实现**——`handleStyleMutation`（runLibraryQuery + styleReferenceEntrySchema.safeParse，对齐 handleForeshadowMutation）；IPC 三 handler：add → `["add-style", novelId, JSON.stringify(input)]`、update → `["update-style", novelId, styleId, ...]`、delete → `["delete-style", styleId]`；preload 与 env.d.ts 增 `addStyle` / `updateStyle` / `deleteStyle`。

- [ ] **步骤 2：静态校验通过**——`bun run typecheck`（client 工程）。

### 任务 6：客户端结构树组 + 预览卡 + 编辑表单 + App 接线

**文件：**
- 修改：`apps/client/src/components/StructureTreePanel.tsx`（Selection 增 style 分支 +「🖋️ 文风」组）
- 修改：`apps/client/src/components/PreviewPane.tsx`（StylePreview 只读卡 + 编辑态切 StyleEditForm）
- 新建：`apps/client/src/components/StyleEditForm.tsx`（新建/编辑共用：名字 + 内容 textarea 软上限 20000 + 启用开关 + 编辑态「🗑 删除」confirm）
- 修改：`apps/client/src/App.tsx`（onStyleCreated / onStyleSaved 接线 reloadDetail）
- 修改：`apps/client/src/styles.css`（如需内容全文 pre-wrap 样式类）

- [ ] **步骤 1：实现**——
  - StructureTreePanel：`Selection` 增 `{ kind: "style"; styleId: string }`；组排大纲之后（设定 → 规划 → 结构 → 素材），组头三角整组收起（默认展开、会话内保持）+「＋」入口（`onAddStyle?` prop，App 接线右栏新建态）；空组「（暂无文风）」占位；叶子 `🖋 名字`，`enabled === false` 后缀「（已停用）」。
  - StyleEditForm：props `novelId` + 可选 `entry`（编辑态）；名字必填、内容必填 + 长度 ≤ 20000 提示禁提交、启用 checkbox；提交 `window.agent.addStyle / updateStyle` → `onSubmitted`；编辑态另附「🗑 删除」（confirm(输入名不强制，confirm 弹窗即可) → deleteStyle → onSubmitted 刷新）；取消零副作用。对齐 CharacterEditForm 的表单样式类。
  - PreviewPane：`StylePreview`（key=entry.id，编辑态切换）——启用徽标 + 名字 + 内容全文（pre-wrap）+「✏️ 编辑文风」；selection.kind === "style" 分支；新建态（`creatingStyle` prop，镜像 creatingCharacter）渲染空表单。
  - App：`creatingStyle` state + `handleSelect` 退出新建态 + `onStyleCreated`（选中新建条目 + reloadDetail）+ `onStyleSaved`（reloadDetail）。

- [ ] **步骤 2：静态校验 + SSR 冒烟通过**——`bun run typecheck` && `bun run test`；如既有 client 冒烟测试文件存在则补 style 组断言（对齐地点组断言风格）。

### 任务 7：全量校验

- [ ] `bun run typecheck`（3 工程全过）
- [ ] `bun run lint`（零新增告警）
- [ ] `bun run test`（全量用例过，记录净增数）
- [ ] 真实库副本迁移实跑：复制 `data/novel.db` 副本 → `NOVEL_DB_PATH` 指副本打开 query CLI `list` → 版本升 15、原数据无损（对齐历次迁移验证惯例）；真实库不动。

### 任务 8：文档同步与原子提交

- [ ] 根 `ARCHITECTURE.md`：目录树 state/ 补 style-reference-store、db.ts 表清单补 style_references（当前 15）、write-chapter 工作流描述补文风注入、query.ts 命令清单补三命令、客户端 StructureTree/PreviewPane 描述补文风组；关键约定 SQLite 段补第九张表说明。
- [ ] 根 `AGENTS.md`：目录结构与模块划分相应段落同步（新表、新 store、新 CLI 命令、write-chapter 注入、客户端文风组）。
- [ ] `apps/agent/src/workflows/ARCHITECTURE.md` / `PROGRESS.md`：write-chapter 条目更新 + 本需求模块视角记录（本模块改动仅 write-chapter.ts）。
- [ ] 根 `DECISIONS.md`：追加「参考文风内容存库而非文件」决策（documents 三动机不成立的论证）。
- [ ] 根 / 模块 `PROGRESS.md`：进行中清单归一为完成记录（根保留 5 条压缩规则）。
- [ ] 原子提交：`feat: 参考文风——结构界面维护+正文生成按启用注入`（代码 + 文档同 commit；进行中清单先行落盘随本提交）。

# 章节正文重新生成 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 已生成正文的章支持「重新生成」——客户端章卡「🔄 重新生成」入口经覆盖警示弹框确认后，发起与新生成完全相同的 write-chapter 会话（三段校验-修订闭环），新正文通过校验后覆盖替换旧正文（同事务换库行、提交后清理旧文件；失败旧正文零影响）。

**架构：** document-store 新增 `replaceChapterDocument`（单事务删旧→插新→回写，无旧行等同首次保存）；write-chapter 移除「已有正文」拒绝、按 `isRegen` 分流 notify 与保存路径（save-or-replace + 提交后删旧文件）；客户端 OutlineNodeCard 重生成入口 + 新 ChapterRegenDialog 警示弹框 + PreviewPane 复用既有内联会话收口。协议 / headless / shared 零改动。

**技术栈：** Bun + TypeScript（strict）、bun:sqlite、bun:test、设计规格 `docs/superpowers/specs/2026-10-12-chapter-regen-design.md`。

**执行约定（项目级，优先于技能模板）：** 复杂需求任务清单落盘 `PROGRESS.md`「进行中」后 WIP=1 逐任务执行；**拆分任务不单独提交**，全部完成、全量校验通过、文档同步后统一一次原子提交（`docs/git-commit-guide.md`）。

---

### 任务 1：document-store 替换语义

**文件：** 修改 `apps/agent/src/state/document-store.ts`（+ 其测试文件，若无则新建）

- [ ] 步骤 1：编写失败的测试（替换生效：预置旧行后 replace → documents 行数仍 1、filePath/wordCount 为新值、outlines.documentId 指向新行；无旧行 → 等同首次保存；异小说章 / 非章节点拒绝）
- [ ] 步骤 2：实现 `replaceChapterDocument(novelId, chapterNodeId, filePath, wordCount)`——校验同 save（章节点存在/同小说/类型 chapter/filePath 非空，不拒已有正文），单事务 DELETE 旧行 → INSERT 新行 → UPDATE outlines 回写 document_id + status=completed
- [ ] 步骤 3：`bun test` 相关文件 + `bun run typecheck` 通过

### 任务 2：write-chapter 重生成路径

**文件：** 修改 `apps/agent/src/workflows/write-chapter.ts`、`write-chapter.test.ts`

- [ ] 步骤 1：前置校验移除「已有正文」拒绝，改为检测 `isRegen`；启动 notify 区分「🔄 重新生成中（…，将覆盖现有正文）…」
- [ ] 步骤 2：保存段 save-or-replace——isRegen 走 replaceChapterDocument；事务提交成功后删旧文件（路径不同才删、容忍缺失）；失败回滚删新文件（既有 catch 不变）
- [ ] 步骤 3：测试改写与新增——前置校验用例移除「已有正文」段；新增三用例（重生成成功替换 + 旧文件清理 + notify 🔄 / 库故障回滚旧正文零影响 / 校验抛错保旧）；既有新生成用例全保留
- [ ] 步骤 4：`bun test` + `bun run typecheck` 通过

### 任务 3：客户端入口与弹框

**文件：** 修改 `apps/client/src/components/OutlineNodeCard.tsx`、`PreviewPane.tsx`、`styles.css`；新建 `apps/client/src/components/ChapterRegenDialog.tsx`

- [ ] 步骤 1：OutlineNodeCard 增 `onRegenerateChapter` prop——有正文且传入时动作区显示「🔄 重新生成」（writing 时禁用）
- [ ] 步骤 2：ChapterRegenDialog（镜像 OutlineRegenDialog：遮罩 + Esc/取消 + 确认）——章名、覆盖警告（不可恢复）、流程说明
- [ ] 步骤 3：PreviewPane 接线——待确认章节点状态 + 弹框渲染 + 确认后复用 startWriteChapter；样式（复用 modal 既有类，按需少量补充）
- [ ] 步骤 4：SSR 冒烟（有正文章卡入口 / 禁用态 / 弹框渲染）transient 实跑 + `bun test apps/client` + typecheck + lint

### 任务 4：文档同步与收尾

- [ ] 步骤 1：全量校验（typecheck / lint / test 全过）
- [ ] 步骤 2：文档同步——AGENTS.md（章卡入口与重生成语义）、两级 ARCHITECTURE（store 与工作流描述）、PROGRESS 清单归一、DECISIONS 追加（覆盖替换 + 弹框确认）
- [ ] 步骤 3：原子提交

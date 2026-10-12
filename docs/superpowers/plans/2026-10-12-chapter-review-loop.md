# 章节正文生成校验-修订闭环 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** write-chapter 在「生成之后、落盘之前」插入三段式校验（内容约束 / 文风相似度评分≥90 / 前后自洽）——新校验模块（deepseek，三段各自独立单轮调用、上下文不继承生成对话）产出结构化整改报告；未达标按报告修订式重写，最多 3 轮（第 3 轮仍未达标保存最后一版并警告）；全程经 write-progress 协议消息在客户端章卡实时展示流程进度。

**架构：** shared 新增 review schema（报告）+ write-progress 协议消息；agent 侧新建 `workflows/chapter-review.ts`（三段 generateObject + 判定/格式化纯函数，模型注入）；`write-chapter.ts` 生成段包进 3 轮循环、Options 增 reviewModel/onProgress 注入；headless 把 onProgress 映射为协议消息并收窄 Key 检查；客户端 PreviewPane 订阅 write-progress、OutlineNodeCard 章卡渲染进度区块与报告摘要。

**技术栈：** Bun + TypeScript（strict）、bun:sqlite、bun:test（mock 双模型：写作模型 generateText + 校验模型 generateObject）、设计规格 `docs/superpowers/specs/2026-10-12-chapter-review-loop-design.md`。

**执行约定（项目级，优先于技能模板）：** 复杂需求任务清单落盘 `PROGRESS.md`「进行中」后 WIP=1 逐任务执行；**拆分任务不单独提交**，全部完成、全量校验通过、文档同步后统一一次原子提交（`docs/git-commit-guide.md`）。

---

## 文件结构

- 创建：`packages/shared/src/review.ts`——校验报告 schema（reviewIssueKindSchema / reviewIssueSchema / styleReviewSchema / reviewReportSchema）+ 导出；
- 创建：`packages/shared/src/review.test.ts`——报告 schema 单测；
- 修改：`packages/shared/src/protocol.ts`——writeProgressPhaseSchema + agentMessageSchema 增 write-progress 分支（report 可选）；
- 修改：`packages/shared/src/index.ts`——导出 review 模块；
- 创建：`apps/agent/src/workflows/chapter-review.ts`——三段校验模块（reviewChapter / isReportPassing / formatRevisionBlock，reviewModel 与 onProgress 注入）；
- 创建：`apps/agent/src/workflows/chapter-review.test.ts`——模块单测（mock ai）；
- 修改：`apps/agent/src/workflows/write-chapter.ts`——生成段包 3 轮循环、修订轮 prompt 追加块、reviewModel/onProgress 注入、notify 文案；
- 修改：`apps/agent/src/workflows/write-chapter.test.ts`——mock reviewModel 脚本化 + 新增五路径集成用例 + 既有用例适配；
- 修改：`apps/agent/src/headless.ts`——write-chapter 分支传 onProgress 映射 write-progress 消息；Key 检查豁免删除（write-chapter 始终要求 DEEPSEEK_API_KEY）；
- 修改：`apps/client/src/components/PreviewPane.tsx`——订阅 write-progress 维护进度态、下传 OutlineNodeCard；
- 修改：`apps/client/src/components/OutlineNodeCard.tsx`——章卡生成进度区块（步骤条 + 报告摘要 + 问题列表）；
- 修改：`apps/client/src/styles.css`——进度区块样式（语义变量，零硬编码色值）；
- 文档：`AGENTS.md`、根 `ARCHITECTURE.md`、`apps/agent/src/workflows/ARCHITECTURE.md`、根与模块 `PROGRESS.md`、`DECISIONS.md`。

---

### 任务 1：shared 校验报告与 write-progress 协议 schema

**文件：**
- 创建：`packages/shared/src/review.ts`、`packages/shared/src/review.test.ts`
- 修改：`packages/shared/src/protocol.ts`、`packages/shared/src/index.ts`

- [ ] **步骤 1：编写失败的测试**（review.test.ts：合法报告 parse 通过（含 skipped 两态与带 issues 形态）；description/suggestion 空串拒绝；score 越界（-1 / 101）与非整数拒绝；非法 kind 拒绝；write-progress 消息（有 report / 无 report / phase 全枚举 / report 缺字段拒绝）；既有消息样例回归）
- [ ] **步骤 2：实现 review.ts**（按规格 3.3 的四个 schema；styleReviewSchema 用 z.discriminatedUnion("skipped") 两分支；全部导出）
- [ ] **步骤 3：扩展 protocol.ts**（writeProgressPhaseSchema 六枚举；agentMessageSchema discriminatedUnion 追加 write-progress 分支——chapterNodeId/round/totalRounds/phase 必填、report 可选引用 reviewReportSchema；注意 protocol.ts 引入 review.ts 依赖、index.ts 补导出）
- [ ] **步骤 4：运行 `bun test packages/shared` 与 `bun run typecheck` 验证通过**

**完成判断条件：** review schema 与 write-progress 消息过 zod 单测；旧协议消息回归通过；typecheck 过。

---

### 任务 2：chapter-review.ts 三段校验模块

**文件：**
- 创建：`apps/agent/src/workflows/chapter-review.ts`、`apps/agent/src/workflows/chapter-review.test.ts`

- [ ] **步骤 1：编写失败的测试**（mock `ai` 的 generateObject：三段按序调用且各自 model/prompt 载荷断言——①含世界观 JSON/章名概述/伏笔行/正文，②含文风样本与正文，③仅正文全文；无文风输入时 ② 不发起调用、报告 style.skipped=true；isReportPassing 四态；formatRevisionBlock 含问题序号/类别/建议与文风段；onProgress 逐段回调断言；generateObject 抛错透传）
- [ ] **步骤 2：实现模块**（`STYLE_PASS_SCORE = 90`、`MAX_REVIEW_ROUNDS = 3` 常量导出；`reviewChapter(input, deps)`——input: novelId/chapterName/summary/worldview/foreshadowLines/styleSamples/content，deps: reviewModel/onProgress；三段各自 buildPrompt + generateObject（zod schema 直接用 shared review schema 的对应子集）；段落完成后 onProgress(phase)；全部完成后组装 ReviewReport 返回（round/passed 由编排层回填，本模块 round 透传、passed 先按 isReportPassing 填充）；异常直接抛）
- [ ] **步骤 3：运行 `bun test apps/agent/src/workflows/chapter-review` 与 `bun run typecheck` 验证通过**

**完成判断条件：** mock ai 单测全过；三段独立调用与 skipped 语义验证；typecheck 过。

---

### 任务 3：writeChapter 循环编排

**文件：**
- 修改：`apps/agent/src/workflows/write-chapter.ts`、`apps/agent/src/workflows/write-chapter.test.ts`

- [ ] **步骤 1：改造编排**（Options 增 reviewModel（缺省 import deepseek model）/onProgress；现有 prompt 组装提为循环内函数（初稿与修订版共用主体）；`for round in 1..MAX_REVIEW_ROUNDS`：onProgress(drafting|revising) → generateText → 空正文拒绝 → onProgress(review-*) × 3 → 报告 → notify 结果 → isReportPassing ? 跳出 : 继续；修订轮 prompt 追加【上一版正文】+【整改报告】块；通过 notify；3 轮保底警告 notify；落盘入库段在循环后执行（onProgress(saving)）；notify 文案按规格 3.4）
- [ ] **步骤 2：改写既有测试**（setup 增 mock reviewModel 脚本——默认一次通过 fixture，保证既有用例语义不变：prompt 逐字节断言、入库绑定、伏笔/文风注入四态等全保留）
- [ ] **步骤 3：新增集成用例**（规格 6 节五路径：一次通过事件序列 / 第 2 轮修订 prompt 含上一版正文与报告块且 round=2 / 3 轮保底保存 + 警告 notify 断言 / 无文风 skipped 校验计数 / 校验抛错 fatal 零残留）
- [ ] **步骤 4：运行 `bun test apps/agent/src/workflows/write-chapter` 与 `bun run typecheck` 验证通过**

**完成判断条件：** 五路径集成用例过；既有回归用例全保留语义不变；typecheck 过。

---

### 任务 4：headless 接线与 Key 检查收窄

**文件：**
- 修改：`apps/agent/src/headless.ts`

- [ ] **步骤 1：** runSession write-chapter 分支增 `onProgress: (event) => send({ type: "write-progress", chapterNodeId: event.chapterNodeId, round: event.round, totalRounds: event.totalRounds, phase: event.phase, ...(event.report ? { report: event.report } : {}) })`；
- [ ] **步骤 2：** 删除 `writingModelOnly` 豁免——write-chapter 与其他会话同样要求 DEEPSEEK_API_KEY；`isWritingModelConfigured` 导入移除；头部注释与 Key 检查注释同步；
- [ ] **步骤 3：** 运行 `bun test`（全量，含 protocol-e2e 若受影响则适配 mock 脚本补校验 fixture）与 `bun run typecheck`、`bun run lint`。

**完成判断条件：** write-progress 消息经协议 schema；Key 检查收窄生效；全量测试过。

---

### 任务 5：客户端进度展示

**文件：**
- 修改：`apps/client/src/components/PreviewPane.tsx`、`apps/client/src/components/OutlineNodeCard.tsx`、`apps/client/src/styles.css`

- [ ] **步骤 1：PreviewPane**（进度态 `{ round, phase, report } | null`（按 writingNodeId 路由）；消息订阅增 write-progress 分支；run_finished/error 清态（现状行为保留）；进度态与 writing 布尔一并下传 OutlineNodeCard）
- [ ] **步骤 2：OutlineNodeCard**（章卡 writing 态渲染「生成进度」区块：六阶段步骤条（drafting→review-content→review-style→review-consistency→revising→saving），当前高亮/已过打勾、修订轮显示「第 N/3 轮」；report 摘要行（内容 N 处 · 文风 X 分/skipped · 自洽 M 处）+ 问题可折叠列表（[类别] 描述 → 建议）；props 类型扩展）
- [ ] **步骤 3：styles.css**（进度区块类组——步骤条/徽标/列表，全部语义变量）
- [ ] **步骤 4：SSR 冒烟断言**（writing+progress 各阶段渲染 / 报告摘要渲染 / 非生成态零渲染）并运行 `bun test apps/client`、`bun run typecheck`、`bun run lint`。

**完成判断条件：** 进度区块按阶段正确渲染、完成清态；SSR 冒烟过；暗色主题零硬编码色值。

---

### 任务 6：文档同步与收尾

**文件：** `AGENTS.md`、根 `ARCHITECTURE.md`、根 `PROGRESS.md`、`DECISIONS.md`、`apps/agent/src/workflows/ARCHITECTURE.md`、`apps/agent/src/workflows/PROGRESS.md`

- [ ] **步骤 1：全量校验**（`bun run typecheck` / `lint` / `test` 全过）；
- [ ] **步骤 2：文档同步**（两级 ARCHITECTURE 文件职责与数据流、AGENTS.md 摘要段、DECISIONS 四项决策（3 轮保底保存 / deepseek 校验 / 修订式重写 / write-progress 回调模式）、PROGRESS 清单归一为完成记录）；
- [ ] **步骤 3：原子提交**（代码 + 文档一次 commit，规范见 `docs/git-commit-guide.md`）。

**完成判断条件：** 三项工程校验全绿；文档与代码一致；提交完成。

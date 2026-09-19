# 进度与已知 Bug

时间格式统一为 `YYYY-MM-DD`。

## 进行中

- （当前无进行中需求。复杂需求编码前在此落盘任务清单，见 `docs/feature-check-guide.md` 工作流程第 2 步；完成后归一至「已完成」）

## 已完成

- 2026-09-19 [docs] 需求指南对齐 create-agent-docs 技能新版模板：feature-check-guide 重构为「需求分级」工作流——简单需求快速通道（判定标准、不减底线、回退机制），复杂需求完整流水线（任务拆解四要素、任务清单落盘 PROGRESS「进行中」、WIP=1 逐任务执行、断点续作检查、清单归一收尾）；运行时校验补「无法验证时记录要求」与历史告警基线；原子提交改为整需求统一提交。AGENTS.md 状态文档约定同步 PROGRESS 职责（进行中清单 / 已完成 ≤5 条 / 历史归档滚动摘要）；两级 PROGRESS.md 结构对齐新约定（旧条目归并为滚动摘要）。git-commit-guide / bug-fix-guide 核对模板未变，未改动。AC：typecheck/lint/test 通过（59 用例，未改代码）；指引文档无模板占位符与适配说明残留

- 2026-09-19 [docs] 三份工作流指引与入口文档对齐项目现状：AGENTS.md 修正项目阶段与入口描述（「初始阶段 / 入口 index.ts」→ 交互式创作工作流 / `src/index.ts`）、目录清单补登 `docs/superpowers/specs/`、`files/`、`.env.example`、workflows 模块级状态文档，状态文档约定升级为两级（项目级根目录 + 模块级模块目录）；feature-check-guide 状态文档读取层级与 DECISIONS.md 位置对齐两级约定；git-commit-guide scope 改为取实际分层目录名、禁止提交清单对齐 .gitignore（`.env`、`files/`）、示例改用项目真实词汇；bug-fix-guide 复盘记录位置对齐 PROGRESS.md「流程复盘记录」区域。AC：typecheck/lint/test 通过（59 用例）；四份文档无模板占位符/适配说明残留，引用路径全部存在

- 2026-09-18 [chore] 新增 `docker-compose.yaml`：sqlite-web 网页查库界面（coleifer/sqlite-web，宿主 8081 → 容器 8080，挂载 `./data` 打开 `novel.db`），仅本地查看用、非应用运行时依赖；修正自 excel-parse 模板拷来的失真注释（路径对齐本项目 `data/novel.db`）。AC：`docker compose config` 解析通过；typecheck/lint/test 通过（59 用例，未改动代码）

- 2026-09-18 [feat] 大纲两级结构对齐 outlines 表并接入工作流：outlineNodeType 瘦身为部/幕/章（去卷，SCHEMA_VERSION 3→4 重建）；outlineSchema 重构为「部→幕」嵌套（部含概述，每部至少 1 幕）；`outlineSchemaFor(actCount, partCount)` refine 强校验恰好 M 部共 N 幕；OutlineStore 新增 `saveOutlineTree`（部根节点/幕子节点，sort 按父级 1 起，整树事务，中途失败回滚、重复保存拒绝）；createNovel 先问幕数（3-20 默认 5）再问部数（1~幕数 默认 1），确认后入库+落盘（output JSON 结构变两级，旧文件不兼容）。AC：typecheck/lint/test 通过（59 用例：两级映射/事务回滚/重复拒绝/结构校验）；真实 LLM 定向冒烟（仙侠参数，要求 2 部 5 幕 → 恰好 2 部共 5 幕，模型自分配 3+2，管道确认 y 一次通过）

- 2026-09-18 [docs] 建立 workflows 模块状态文档（src/workflows/ARCHITECTURE.md + PROGRESS.md，历史自根文档按模块视角回填）；顺带修正根架构文档两处失真：依赖边界补 `output/`、目录树补 `workflows/index.ts`。AC：模块文档经源码逐文件核对（含 import 关系验证），typecheck/lint/test 通过（55 用例）

## 历史归档

- 2026-09-14 ~ 2026-09-18【早期建设期滚动摘要，20 条已归并】SQLite 持久化从零到体系：characters → worldviews（1:1，taboos JSON）→ novels（全表主键 UUIDv7 化，PRAGMA user_version 管理重建，外键关联）→ outlines 树形多版本表（同父级当前版本 sort 唯一索引），各表配 store 读写双向 zod 校验。交互确认门体系：save_field 逐字段「概括→确认→保存」→ submit_character 整卡确认 → save_outline 大纲确认循环（拒绝→按反馈修订→再确认），并行确认串行化（SerialLineSource）。ReAct 基建：通用运行器（终态工具模式 + 未完成自动续跑）+ ask-user 工厂函数 + AI SDK 7 / deepseek provider 接入。CLI 双模式输入（修复 Bun 管道 readline 丢行）；askInt 范围默认值；可选命名步骤；幕数经 outlineSchemaForActs 在 save_outline 入参层强校验；UUIDv7 切换 Bun 原生 `Bun.randomUUIDv7()`；大纲产物按创作 ID 落盘 `output/`；项目脚手架初始化（Bun + TS6 + ESLint 10 + Agent 文档工作流）。各条均含 typecheck/lint/test 与端到端真实 LLM 验证（《灵脉破晓》《九州残脉》《逆脉》《地脉长歌》等）

## 已知 Bug

- （非阻塞）deepseek-flash 在主角归一化时仍可能小幅补全用户未提及字段——已有「确认门」兜底，用户答 n 可重新描述；若换更强模型（deepseek-v4-pro）可进一步降低漂移

## 流程复盘记录

- 2026-09-15 端到端验证时发现 Bun 1.4 `node:readline` 在管道输入下两次 question 之间丢弃缓冲并触发 close（Node 行为正常）。归因：环境差异类问题，需求校验阶段未覆盖「脚本化喂入交互输入」的验证方式。优化：本次已在 `cli/prompt.ts` 内置双模式输入解决；后续涉及 stdin 交互的需求，验证清单应同时覆盖 TTY 与管道两种模式

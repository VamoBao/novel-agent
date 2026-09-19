# 进度与已知 Bug

时间格式统一为 `YYYY-MM-DD`。

## 进行中

- （当前无进行中需求。复杂需求编码前在此落盘任务清单，见 `docs/feature-check-guide.md` 工作流程第 2 步；完成后归一至「已完成」）

## 已完成

- 2026-09-19 [chore] 移除误入库的 `.claude/skills/create-agent-docs/`（SKILL.md + 4 个 references 模板）：在 `.gitignore` 增加 `.claude` 条目前已被跟踪，gitignore 对已跟踪文件不生效；`git rm -r --cached` 解除跟踪后由现有忽略规则接管。本地文件保留——项目内副本含用户级技能未同步的迭代内容（需求分级 / WIP 任务清单等新版描述），直接删除会丢数据。AC：`git ls-files .claude/` 为空、`git status` 干净、本地文件仍在

- 2026-09-19 [feat] Monorepo 改造 + agent 协议化 + Electron 客户端 v1（设计规格 `docs/superpowers/specs/2026-09-19-monorepo-electron-client-design.md`，五任务 WIP=1 串行完成）：Bun workspaces 三区落地（`apps/agent` 原 src 整体 git mv 迁入、`packages/shared` 抽领域 schema + 视图 + 协议消息、`apps/client` electron-vite + React 新建）；UiChannel 交互抽象收敛全部交互（CLI / Protocol / Fake 三实现，EOF 分层语义 askLine-null / 其余抛 UserAbortedError，确认视图与提问原子绑定，ESLint no-restricted-imports + no-console 边界规则固化，CLI 行为零回归）；stdio JSON 协议 + `headless.ts` 入口（request/response 自增 id 关联、无效应答重问、fail-fast、hello 绝对路径回显、`NOVEL_OUTPUT_DIR`）；Electron 客户端（main AgentProcess spawn + zod 复验 IPC 转发 + StageBar/ViewCard/QuestionCard 问答流，WSL2 需 disable-gpu/no-sandbox/in-process-gpu，诊断钩子 NOVEL_CLIENT_AUTOSTART/SCREENSHOT）；`scripts/protocol-e2e.ts` 协议驱动器入库。AC：typecheck 3 工程 + lint + 86 用例全过（新增 27，含 mock ai + FakeChannel 的 createNovel 全流程集成测试）；无头冒烟截图实证 UI 渲染；真实 LLM 协议端到端全流程通过（25 提问 / 6 阶段，novels=1 / characters=1 / worldviews=1 / outlines=6 入库 + 大纲落盘，exit 0）；EOF 中断优雅退出。决策回填 DECISIONS。GUI 交互观感待用户人工验收（`bun run dev:client`）

- 2026-09-19 [docs] 需求指南对齐 create-agent-docs 技能新版模板：feature-check-guide 重构为「需求分级」工作流——简单需求快速通道（判定标准、不减底线、回退机制），复杂需求完整流水线（任务拆解四要素、任务清单落盘 PROGRESS「进行中」、WIP=1 逐任务执行、断点续作检查、清单归一收尾）；运行时校验补「无法验证时记录要求」与历史告警基线；原子提交改为整需求统一提交。AGENTS.md 状态文档约定同步 PROGRESS 职责（进行中清单 / 已完成 ≤5 条 / 历史归档滚动摘要）；两级 PROGRESS.md 结构对齐新约定（旧条目归并为滚动摘要）。git-commit-guide / bug-fix-guide 核对模板未变，未改动。AC：typecheck/lint/test 通过（59 用例，未改代码）；指引文档无模板占位符与适配说明残留

- 2026-09-19 [docs] 三份工作流指引与入口文档对齐项目现状：AGENTS.md 修正项目阶段与入口描述（「初始阶段 / 入口 index.ts」→ 交互式创作工作流 / `src/index.ts`）、目录清单补登 `docs/superpowers/specs/`、`files/`、`.env.example`、workflows 模块级状态文档，状态文档约定升级为两级（项目级根目录 + 模块级模块目录）；feature-check-guide 状态文档读取层级与 DECISIONS.md 位置对齐两级约定；git-commit-guide scope 改为取实际分层目录名、禁止提交清单对齐 .gitignore（`.env`、`files/`）、示例改用项目真实词汇；bug-fix-guide 复盘记录位置对齐 PROGRESS.md「流程复盘记录」区域。AC：typecheck/lint/test 通过（59 用例）；四份文档无模板占位符/适配说明残留，引用路径全部存在

- 2026-09-18 [chore] 新增 `docker-compose.yaml`：sqlite-web 网页查库界面（coleifer/sqlite-web，宿主 8081 → 容器 8080，挂载 `./data` 打开 `novel.db`），仅本地查看用、非应用运行时依赖；修正自 excel-parse 模板拷来的失真注释（路径对齐本项目 `data/novel.db`）。AC：`docker compose config` 解析通过；typecheck/lint/test 通过（59 用例，未改动代码）

## 历史归档

- 2026-09-14 ~ 2026-09-18【早期建设期滚动摘要，22 条已归并】SQLite 持久化从零到体系：characters → worldviews（1:1，taboos JSON）→ novels（全表主键 UUIDv7 化，PRAGMA user_version 管理重建，外键关联）→ outlines 树形多版本表（同父级当前版本 sort 唯一索引），各表配 store 读写双向 zod 校验。交互确认门体系：save_field 逐字段「概括→确认→保存」→ submit_character 整卡确认 → save_outline 大纲确认循环（拒绝→按反馈修订→再确认），并行确认串行化（SerialLineSource）。ReAct 基建：通用运行器（终态工具模式 + 未完成自动续跑）+ ask-user 工厂函数 + AI SDK 7 / deepseek provider 接入。CLI 双模式输入（修复 Bun 管道 readline 丢行）；askInt 范围默认值；可选命名步骤；大纲两级结构（部→幕）对齐 outlines 表接入工作流（先问幕数再问部数，`outlineSchemaFor` refine 强校验恰好 M 部共 N 幕，`saveOutlineTree` 整树事务入库，output JSON 同步两级化）；幕数经 outlineSchemaForActs 在 save_outline 入参层强校验；UUIDv7 切换 Bun 原生 `Bun.randomUUIDv7()`；大纲产物按创作 ID 落盘 `output/`；建立 workflows 模块级状态文档（架构/进度自根文档按模块视角回填，顺带修正根架构文档两处失真）；项目脚手架初始化（Bun + TS6 + ESLint 10 + Agent 文档工作流）。各条均含 typecheck/lint/test 与端到端真实 LLM 验证（《灵脉破晓》《九州残脉》《逆脉》《地脉长歌》等）

## 已知 Bug

- （非阻塞）deepseek-flash 在主角归一化时仍可能小幅补全用户未提及字段——已有「确认门」兜底，用户答 n 可重新描述；若换更强模型（deepseek-v4-pro）可进一步降低漂移

## 流程复盘记录

- 2026-09-15 端到端验证时发现 Bun 1.4 `node:readline` 在管道输入下两次 question 之间丢弃缓冲并触发 close（Node 行为正常）。归因：环境差异类问题，需求校验阶段未覆盖「脚本化喂入交互输入」的验证方式。优化：本次已在 `cli/prompt.ts` 内置双模式输入解决；后续涉及 stdin 交互的需求，验证清单应同时覆盖 TTY 与管道两种模式

# 进度与已知 Bug

时间格式统一为 `YYYY-MM-DD`。

## 进行中

- （当前无进行中需求。复杂需求编码前在此落盘任务清单，见 `docs/feature-check-guide.md` 工作流程第 2 步；完成后归一至「已完成」）

## 已完成

- 2026-09-23 [docs] 需求指南收紧任务包确认门：取消「方案唯一且无高风险时确认单兼作执行摘要、输出后可直接开始」的例外，全部复杂需求输出《任务包确认单》后必须停下等待用户明确回复「确认」/「开始」才可编码（Human-in-the-loop 检查点）；同步更新流水线示意（任务包确认（必须经用户确认））、确认单模板尾注与工作流程第 2 步表述（「或执行摘要输出」→「经用户确认任务包后」）。交叉检查：快速通道（简单需求免确认单）与回退机制（执行中升级须补确认）表述一致，无残留旧措辞。AC：`grep` 全仓校验「直接开始 / 执行摘要 / 必要时」零残留

- 2026-09-22 [refactor] 新建小说改为独立创作页：App 从「三栏 + 覆盖层盖住中右栏」改为页面级切换（浏览页 ↔ 创作页），创作页整页呈现 CreationFlow 问答流（头部「←」终止 agent 返回书库，替代原右上 ✕），浏览页汉堡 / 三栏结构不再与创作共存；样式移除 creation-overlay grid 定位，新增 create-app 整页容器；AUTOSTART 冒烟钩子语义不变（自动进入创作页）。AC：typecheck / lint / 111 用例过；无头冒烟截图实证创作页独立整页形态（无三栏 / 汉堡）；AGENTS / ARCHITECTURE / DECISIONS（旧决策补更新注记）同步

- 2026-09-21 [fix] 跨进程并发打开库报 `database is locked`（书库管理需求遗留 Bug）：根因是 `openDatabase` 每次打开都无条件执行 `PRAGMA user_version` 赋值（写语句）且连接默认 `busy_timeout=0`——agent 创作进程写库期间，查询 CLI 子进程打开库抢写锁立即抛错（临时库多进程复现实证）。修复：所有连接统一 `busy_timeout=5000`（短锁冲突等待化解）；`journal_mode` 改幂等读检查后设置；`user_version` 写入收敛到真正的迁移 / 重建分支内——版本匹配的纯浏览打开零写，WAL 下读写连接天然共存。AC：复现场景（他进程持写锁 3s + 并发 `query list`）修复后 exit 0 正常返回；新增并发防锁单测（busy_timeout 生效 + 持锁读不阻塞）；全仓 111 用例 / typecheck / lint 过；v4→v5 迁移用例回归通过。并发约定落盘 ARCHITECTURE 关键约定

- 2026-09-21 [feat] 书库管理右键菜单（设计规格 `docs/superpowers/specs/2026-09-21-novel-management-design.md`，六任务 WIP=1 串行完成）：novels 表增列 pinned / favorite（SCHEMA_VERSION 4→5，**改 DROP 重建为 ALTER 保数据增量迁移**——书库已投产不可清空，决策见 DECISIONS）；NovelStore 扩展 setNovelPinned / setNovelFavorite / deleteNovel（单事务级联清四表）与置顶优先排序；query CLI 扩展管理子命令（rename / pin / unpin / favorite / unfavorite / delete + output 产物清理），统一 openDatabase 连接使纯浏览路径顺带完成迁移；client 新增 library:rename / setPinned / setFavorite / delete IPC 与 preload API；renderer 书库列表右键菜单（自定义 HTML：重命名内联编辑 Enter/Esc、置顶 / 收藏动态文案、删除项内二次确认）+ 📌⭐ 标识 + 操作失败回显、删除当前选中清空预览。AC：typecheck 3 工程 / lint / 110 用例全过（新增 11：v4 库迁移保数据、级联删除、置顶排序、CLI 管理命令）；真实 v4 库经新代码迁移后 3 本小说完整保留，pin/rename 实跑验证后还原；pin+favorite 冒烟截图实证标识与排序（已还原）；右键菜单 GUI 交互待用户人工验收
- 2026-09-21 [feat] 客户端三栏浏览 UI（设计规格 `docs/superpowers/specs/2026-09-21-client-browse-ui-design.md`，六任务 WIP=1 串行完成）：shared 新增库查询契约（`query.ts`：novelListItem / novelDetail / characterEntry，schema 用例 11 个）；agent 新增一次性查询入口 `query.ts`（`list` 列小说 / `get` 取世界观+角色+大纲全量，只读连接不触发建表，NovelStore 补 `listNovels()`，5 用例覆盖空库 / 未命名 / 产物缺失 / 不存在 ID，真实库实跑验证）；client main 新增 `library:list` / `library:get` IPC（spawn 查询 CLI + shared schema 复验 + 8s 超时兜底）与 `agent:stop`；renderer 重构为三栏浏览壳（左栏书库可汉堡折叠 / 中栏世界观·角色·大纲结构树 / 右栏 ViewCard 预览），原问答流整体迁移为 CreationFlow 创作覆盖层（盖住中+右栏，完成自动关层刷新并选中新作，中途关闭终止 agent）；AUTOSTART 诊断钩子改由 renderer 触发覆盖层（main 裸 spawn 与新架构脱节），新增 `NOVEL_CLIENT_SELECT` 自动选中。AC：typecheck 3 工程 / lint / 99 用例全过（新增 16）；无头冒烟截图实证浏览态、真实数据三栏态与创作覆盖层；GUI 交互观感待用户人工验收（`bun run dev:client`）
- 2026-09-19 [feat] Monorepo 改造 + agent 协议化 + Electron 客户端 v1（设计规格 `docs/superpowers/specs/2026-09-19-monorepo-electron-client-design.md`，五任务 WIP=1 串行完成）：Bun workspaces 三区落地（`apps/agent` 原 src 整体 git mv 迁入、`packages/shared` 抽领域 schema + 视图 + 协议消息、`apps/client` electron-vite + React 新建）；UiChannel 交互抽象收敛全部交互（CLI / Protocol / Fake 三实现，EOF 分层语义 askLine-null / 其余抛 UserAbortedError，确认视图与提问原子绑定，ESLint no-restricted-imports + no-console 边界规则固化，CLI 行为零回归）；stdio JSON 协议 + `headless.ts` 入口（request/response 自增 id 关联、无效应答重问、fail-fast、hello 绝对路径回显、`NOVEL_OUTPUT_DIR`）；Electron 客户端（main AgentProcess spawn + zod 复验 IPC 转发 + StageBar/ViewCard/QuestionCard 问答流，WSL2 需 disable-gpu/no-sandbox/in-process-gpu，诊断钩子 NOVEL_CLIENT_AUTOSTART/SCREENSHOT）；`scripts/protocol-e2e.ts` 协议驱动器入库。AC：typecheck 3 工程 + lint + 86 用例全过（新增 27，含 mock ai + FakeChannel 的 createNovel 全流程集成测试）；无头冒烟截图实证 UI 渲染；真实 LLM 协议端到端全流程通过（25 提问 / 6 阶段，novels=1 / characters=1 / worldviews=1 / outlines=6 入库 + 大纲落盘，exit 0）；EOF 中断优雅退出。决策回填 DECISIONS。GUI 交互观感待用户人工验收（`bun run dev:client`）

## 历史归档

- 2026-09-14 ~ 2026-09-19【早期建设期滚动摘要，26 条已归并】SQLite 持久化从零到体系：characters → worldviews（1:1，taboos JSON）→ novels（全表主键 UUIDv7 化，PRAGMA user_version 管理重建，外键关联）→ outlines 树形多版本表（同父级当前版本 sort 唯一索引），各表配 store 读写双向 zod 校验。交互确认门体系：save_field 逐字段「概括→确认→保存」→ submit_character 整卡确认 → save_outline 大纲确认循环（拒绝→按反馈修订→再确认），并行确认串行化（SerialLineSource）。ReAct 基建：通用运行器（终态工具模式 + 未完成自动续跑）+ ask-user 工厂函数 + AI SDK 7 / deepseek provider 接入。CLI 双模式输入（修复 Bun 管道 readline 丢行）；askInt 范围默认值；可选命名步骤；大纲两级结构（部→幕）对齐 outlines 表接入工作流（先问幕数再问部数，`outlineSchemaFor` refine 强校验恰好 M 部共 N 幕，`saveOutlineTree` 整树事务入库，output JSON 同步两级化）；幕数经 outlineSchemaForActs 在 save_outline 入参层强校验；UUIDv7 切换 Bun 原生 `Bun.randomUUIDv7()`；大纲产物按创作 ID 落盘 `output/`；建立 workflows 模块级状态文档（架构/进度自根文档按模块视角回填，顺带修正根架构文档两处失真）；项目脚手架初始化（Bun + TS6 + ESLint 10 + Agent 文档工作流）；docker-compose 本地查库辅助（sqlite-web，宿主 8081，非运行时依赖）；三份工作流指引与入口文档对齐项目现状（AGENTS.md 项目阶段与入口描述修正、目录清单补登 specs/files/.env.example、两级状态文档约定、git-commit-guide scope 与禁止提交清单、bug-fix-guide 复盘位置对齐）；需求指南对齐 create-agent-docs 新版模板（需求分级工作流：简单快速通道 / 复杂完整流水线、任务清单落盘、WIP=1、清单归一）；移除误入库的 .claude 技能文件（git rm --cached 解除跟踪，本地保留）。各条均含 typecheck/lint/test 与端到端真实 LLM 验证（《灵脉破晓》《九州残脉》《逆脉》《地脉长歌》等）

## 已知 Bug

- （非阻塞）deepseek-flash 在主角归一化时仍可能小幅补全用户未提及字段——已有「确认门」兜底，用户答 n 可重新描述；若换更强模型（deepseek-v4-pro）可进一步降低漂移

## 流程复盘记录

- 2026-09-15 端到端验证时发现 Bun 1.4 `node:readline` 在管道输入下两次 question 之间丢弃缓冲并触发 close（Node 行为正常）。归因：环境差异类问题，需求校验阶段未覆盖「脚本化喂入交互输入」的验证方式。优化：本次已在 `cli/prompt.ts` 内置双模式输入解决；后续涉及 stdin 交互的需求，验证清单应同时覆盖 TTY 与管道两种模式

# 进度与已知 Bug

时间格式统一为 `YYYY-MM-DD`。

## 进行中

- （当前无进行中需求。复杂需求编码前在此落盘任务清单，见 `docs/feature-check-guide.md` 工作流程第 2 步；完成后归一至「已完成」）

## 已完成

- 2026-09-23 [feat] 删除小说改为 GitHub 删 repo 式强确认（简单需求快速通道）：删除菜单项打开 DeleteNovelDialog 模态（遮罩 + 危险色卡片）——展示书名 / ID 前 8 位 / 级联范围（世界观、角色、大纲节点及 output 产物，不可恢复），必须输入小说名（trim 后全等；未命名小说输入「未命名小说」）才放行「删除这本小说」按钮；输入框自动聚焦，Esc / 点遮罩 / 取消关闭，Enter 放行时提交；对话框条目从列表解析，删除后列表刷新自动关闭；替代原内联二次确认条（样式同步移除），onDelete 链路（IPC / 级联 / 产物清理）不变。AC：typecheck 3 工程 / lint / 127 用例过；DeleteNovelDialog SSR 冒烟（命名 / 未命名口令回落、级联警示与范围文案、按钮初始禁用）；对话框交互（输入放行 / Esc / Enter）待用户 dev:client 人工验收

- 2026-09-23 [feat] 客户端大纲浏览切换为 outlines 表节点（任务包经用户确认）：shared query 契约 `outline: Outline|null` → `outlineNodes: OutlineNodeEntry[]`（id/parentId/type/name/sort/summary/keyPlotPoints，currentOnly 当前版本；类比 characterEntry 带主键先例）；query CLI `buildNovelDetail` 接 `listOutlineNodes(currentOnly)`，`readOutlineArtifact` 退役（outlineFilePath 留给 delete 清产物）——产物缺失不再影响浏览；renderer `Selection` 大纲分支携带 `outlineNodeId`，结构树按 parentId 通用建树（部▸/幕·，去《标题》伪根），新增 OutlineNodeCard（类型徽标 + 梗概 + 幕级情节点列表，NULL 展示「暂无梗概 / 暂无关键情节点——旧数据未入库内容」占位，不进 View 体系避免渗入创作流协议）；App 冒烟 autoSelect 改取首个大纲节点。AC：typecheck 3 工程 / lint / 127 用例全过（重写契约与 CLI 大纲用例）；种子临时库 query 实跑（部 summary 有 + 幕情节点 3/2 条）；真实库《漂亮话》6 节点内容列全 null（旧数据空占位数据源）；OutlineNodeCard SSR 冒烟（内容 / 旧幕 / 旧部三路径，部无情节区）；无头截图实证树由 DB 节点渲染（▸ 第一部：漂亮话 + 五幕，无渲染异常）；创作流协议零改动。点击交互观感待用户 dev:client 人工验收。决策见 DECISIONS

- 2026-09-23 [feat] 大纲内容（summary / keyPlotPoints）入库 outlines 表（任务包经用户确认；默认决策：读取路径不动、旧数据不回填，见 DECISIONS）：outlineNodeSchema 增内容两字段（nullable + refine「keyPlotPoints 非 null 时 type 须为 act」+ patch 放行；zod 4 refine 后不可 pick，patch 由内部纯 object schema 派生）；SCHEMA_VERSION 5→6 链式保数据迁移（v4 库直升时 novels / outlines 两段列同批补齐；连带修正 novel-store 旧 v4 迁移用例缺 outlines 表的合成失真）；OutlineStore 输入 / 行 / SQL / 读写全链路扩展（OutlineTreeInput 内容必填、与 outlineSchema.parts 对齐，内容不可再被编译期静默丢弃；key_plot_points 存 JSON 文本，损坏抛带节点 ID 的可读错误）。AC：typecheck 3 工程 / lint / 123 用例全过（新增 12：shared schema 5 + db 迁移 3 + outline-store 内容 4）；真实库迁移实跑（4 本小说 14 行大纲无损、旧行未回填、`get` 仍读产物路径行为不变）；createNovel 集成断言 DB 行含梗概与情节点。读取路径切换 / 旧数据回填 / documents 表为后续需求

- 2026-09-23 [docs] 需求指南收紧任务包确认门：取消「方案唯一且无高风险时确认单兼作执行摘要、输出后可直接开始」的例外，全部复杂需求输出《任务包确认单》后必须停下等待用户明确回复「确认」/「开始」才可编码（Human-in-the-loop 检查点）；同步更新流水线示意（任务包确认（必须经用户确认））、确认单模板尾注与工作流程第 2 步表述（「或执行摘要输出」→「经用户确认任务包后」）。交叉检查：快速通道（简单需求免确认单）与回退机制（执行中升级须补确认）表述一致，无残留旧措辞。AC：`grep` 全仓校验「直接开始 / 执行摘要 / 必要时」零残留

- 2026-09-22 [refactor] 新建小说改为独立创作页：App 从「三栏 + 覆盖层盖住中右栏」改为页面级切换（浏览页 ↔ 创作页），创作页整页呈现 CreationFlow 问答流（头部「←」终止 agent 返回书库，替代原右上 ✕），浏览页汉堡 / 三栏结构不再与创作共存；样式移除 creation-overlay grid 定位，新增 create-app 整页容器；AUTOSTART 冒烟钩子语义不变（自动进入创作页）。AC：typecheck / lint / 111 用例过；无头冒烟截图实证创作页独立整页形态（无三栏 / 汉堡）；AGENTS / ARCHITECTURE / DECISIONS（旧决策补更新注记）同步

## 历史归档

- 2026-09-21 [fix] 跨进程并发打开库报 `database is locked`（书库管理需求遗留 Bug）：所有连接统一 `busy_timeout=5000`；`journal_mode` 幂等读检查后设置；`user_version` 写入收敛到真正迁移 / 重建分支内——版本匹配的纯浏览打开零写，WAL 下读写连接天然共存。AC：复现场景修复 + 并发防锁单测 + 111 用例过；并发约定落盘 ARCHITECTURE 关键约定

- 2026-09-21 [feat] 书库管理右键菜单（设计规格 `docs/superpowers/specs/2026-09-21-novel-management-design.md`）：novels 增列 pinned / favorite（SCHEMA_VERSION 4→5，DROP 重建改 ALTER 保数据迁移）+ NovelStore 置顶/收藏/级联删除与排序 + query CLI 管理子命令（rename / pin / unpin / favorite / unfavorite / delete + 产物清理）+ client library 管理 IPC 与右键菜单（重命名内联编辑、📌⭐ 标识、删除二次确认）。AC：110 用例（新增 11）+ 真实 v4 库迁移实跑保留 + 冒烟截图；右键菜单 GUI 待人工验收
- 2026-09-21 [feat] 客户端三栏浏览 UI（设计规格 `docs/superpowers/specs/2026-09-21-client-browse-ui-design.md`）：shared 新增库查询契约 + agent 一次性查询 CLI（list / get，NovelStore 补 listNovels）+ client library IPC（spawn + schema 复验 + 8s 超时）与 agent:stop；renderer 三栏浏览壳（书库 / 结构树 / 预览）+ CreationFlow 创作覆盖层（后改独立创作页，见 2026-09-22）；AUTOSTART 改 renderer 触发、新增 NOVEL_CLIENT_SELECT。AC：typecheck / lint / 99 用例（新增 16）+ 无头冒烟截图；GUI 观感待人工验收
- 2026-09-19 [feat] Monorepo 改造 + agent 协议化 + Electron 客户端 v1（设计规格 `docs/superpowers/specs/2026-09-19-monorepo-electron-client-design.md`）：Bun workspaces 三区落地；UiChannel 交互抽象（CLI / Protocol / Fake 三实现，EOF 分层语义、确认视图与提问原子绑定，ESLint 边界规则固化）；stdio JSON 协议 + headless 入口；Electron main spawn + zod 复验 IPC（WSL2 禁 GPU/sandbox）；`scripts/protocol-e2e.ts` 协议驱动器。AC：typecheck / lint / 86 用例（新增 27，含 mock ai + FakeChannel 全流程集成）；无头冒烟 + 真实 LLM 端到端验证通过；决策回填 DECISIONS。GUI 观感待人工验收
- 2026-09-14 ~ 2026-09-19【早期建设期滚动摘要，26 条已归并】SQLite 持久化从零到体系：characters → worldviews（1:1，taboos JSON）→ novels（全表主键 UUIDv7 化，PRAGMA user_version 管理重建，外键关联）→ outlines 树形多版本表（同父级当前版本 sort 唯一索引），各表配 store 读写双向 zod 校验。交互确认门体系：save_field 逐字段「概括→确认→保存」→ submit_character 整卡确认 → save_outline 大纲确认循环（拒绝→按反馈修订→再确认），并行确认串行化（SerialLineSource）。ReAct 基建：通用运行器（终态工具模式 + 未完成自动续跑）+ ask-user 工厂函数 + AI SDK 7 / deepseek provider 接入。CLI 双模式输入（修复 Bun 管道 readline 丢行）；askInt 范围默认值；可选命名步骤；大纲两级结构（部→幕）对齐 outlines 表接入工作流（先问幕数再问部数，`outlineSchemaFor` refine 强校验恰好 M 部共 N 幕，`saveOutlineTree` 整树事务入库，output JSON 同步两级化）；幕数经 outlineSchemaForActs 在 save_outline 入参层强校验；UUIDv7 切换 Bun 原生 `Bun.randomUUIDv7()`；大纲产物按创作 ID 落盘 `output/`；建立 workflows 模块级状态文档（架构/进度自根文档按模块视角回填，顺带修正根架构文档两处失真）；项目脚手架初始化（Bun + TS6 + ESLint 10 + Agent 文档工作流）；docker-compose 本地查库辅助（sqlite-web，宿主 8081，非运行时依赖）；三份工作流指引与入口文档对齐项目现状（AGENTS.md 项目阶段与入口描述修正、目录清单补登 specs/files/.env.example、两级状态文档约定、git-commit-guide scope 与禁止提交清单、bug-fix-guide 复盘位置对齐）；需求指南对齐 create-agent-docs 新版模板（需求分级工作流：简单快速通道 / 复杂完整流水线、任务清单落盘、WIP=1、清单归一）；移除误入库的 .claude 技能文件（git rm --cached 解除跟踪，本地保留）。各条均含 typecheck/lint/test 与端到端真实 LLM 验证（《灵脉破晓》《九州残脉》《逆脉》《地脉长歌》等）

## 已知 Bug

- （非阻塞）deepseek-flash 在主角归一化时仍可能小幅补全用户未提及字段——已有「确认门」兜底，用户答 n 可重新描述；若换更强模型（deepseek-v4-pro）可进一步降低漂移

## 流程复盘记录

- 2026-09-15 端到端验证时发现 Bun 1.4 `node:readline` 在管道输入下两次 question 之间丢弃缓冲并触发 close（Node 行为正常）。归因：环境差异类问题，需求校验阶段未覆盖「脚本化喂入交互输入」的验证方式。优化：本次已在 `cli/prompt.ts` 内置双模式输入解决；后续涉及 stdin 交互的需求，验证清单应同时覆盖 TTY 与管道两种模式

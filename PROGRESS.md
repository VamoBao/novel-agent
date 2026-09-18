# 进度与已知 Bug

时间格式统一为 `YYYY-MM-DD`。

## 已完成

- 2026-09-18 [chore] 新增 `docker-compose.yaml`：sqlite-web 网页查库界面（coleifer/sqlite-web，宿主 8081 → 容器 8080，挂载 `./data` 打开 `novel.db`），仅本地查看用、非应用运行时依赖；修正自 excel-parse 模板拷来的失真注释（路径对齐本项目 `data/novel.db`）。AC：`docker compose config` 解析通过；typecheck/lint/test 通过（59 用例，未改动代码）

- 2026-09-18 [feat] 大纲两级结构对齐 outlines 表并接入工作流：outlineNodeType 瘦身为部/幕/章（去卷，SCHEMA_VERSION 3→4 重建）；outlineSchema 重构为「部→幕」嵌套（部含概述，每部至少 1 幕）；`outlineSchemaFor(actCount, partCount)` refine 强校验恰好 M 部共 N 幕；OutlineStore 新增 `saveOutlineTree`（部根节点/幕子节点，sort 按父级 1 起，整树事务，中途失败回滚、重复保存拒绝）；createNovel 先问幕数（3-20 默认 5）再问部数（1~幕数 默认 1），确认后入库+落盘（output JSON 结构变两级，旧文件不兼容）。AC：typecheck/lint/test 通过（59 用例：两级映射/事务回滚/重复拒绝/结构校验）；真实 LLM 定向冒烟（仙侠参数，要求 2 部 5 幕 → 恰好 2 部共 5 幕，模型自分配 3+2，管道确认 y 一次通过）

- 2026-09-18 [docs] 建立 workflows 模块状态文档（src/workflows/ARCHITECTURE.md + PROGRESS.md，历史自根文档按模块视角回填）；顺带修正根架构文档两处失真：依赖边界补 `output/`、目录树补 `workflows/index.ts`。AC：模块文档经源码逐文件核对（含 import 关系验证），typecheck/lint/test 通过（55 用例）

- 2026-09-18 [feat] 新增 outlines 表：树形大纲（卷/部/幕/章，`parent_id` 自引用外键）按小说 ID 持久化，同节点多版本行并存（`version` + `is_current_version`），部分唯一表达式索引 `(novel_id, COALESCE(parent_id,''), sort) WHERE is_current_version=1` 实现「同父级当前版本 sort 唯一」（根节点 NULL 经 COALESCE 归一判重，跨小说隔离）；`OutlineStore` 增/查/列（currentOnly）/改（盖章 updated_at），读写双向 zod 校验，唯一索引违规转译可读错误；SCHEMA_VERSION 2→3。AC：typecheck/lint/test 通过（55 用例：默认值/UUIDv7/外键拒绝/唯一索引/多版本共存与切换/根节点跨书隔离/排序/重开库持久化）。create-novel 工作流接入与 document_id 正文关联为后续需求
- 2026-09-18 [feat] 大纲生成前询问幕数（askInt 新原语：范围校验 + 回车默认值），默认 5 幕（3-20）；幕数经 outlineSchemaForActs（refine）在 save_outline 入参层强校验，恰好 N 幕，模型给错被 schema 拒绝重试，不依赖模型自觉。AC：typecheck/lint/test 通过（46 用例）；端到端真实 LLM 验证指定 4 幕 → 大纲恰好 4 幕（夺卷/亡命/锁脉/共济）
- 2026-09-17 [feat] 创建流程新增可选命名步骤：ID 生成后、大纲前询问小说名称（回车跳过）；已命名时 novels.name 即用户名且大纲 title 强制沿用，未命名维持原行为（大纲确认后以标题回填）。AC：typecheck/lint/test 通过（43 用例）；端到端真实 LLM 验证用户命名路径（novels.name=灵脉遗孤 未被覆盖，大纲标题沿用书名）
- 2026-09-17 [refactor] UUIDv7 生成切换为 Bun 原生 `Bun.randomUUIDv7()`（同毫秒内单调递增，优于自实现的纯随机段），保留 generateUuidV7 函数壳作唯一出口；测试改为时间戳区间断言 + 200 轮连续单调断言。AC：typecheck/lint/test 通过（43 用例）
- 2026-09-17 [feat] 新增 novels 表（id/name/author/description）：全部表主键改为 UUIDv7（时间有序，node randomUUID 仅 v4）；characters/worldviews 的 novel_id 外键关联 novels.id（PRAGMA foreign_keys=ON，novels 行先于二者入库，name/description 大纲确认后回填）；schema 用 PRAGMA user_version 版本管理（不匹配重建，开发期）。AC：typecheck/lint/test 通过（43 用例：v7 格式/时间戳嵌入/外键约束/novels CRUD）；端到端真实 LLM 验证三表外键精确匹配、foreign_key_check 零违规（《灵脉无主》）
- 2026-09-17 [feat] 世界观按 schema 入库：新增 `worldviews` 表（与 characters 分表，1:1，novel_id 主键，taboos 存 JSON 文本），WorldviewStore upsert/get + 读写双向 zod 校验；各 store 共享懒加载数据库连接；世界观确认后即入库。AC：typecheck/lint/test 通过（34 用例：往返/upsert 覆盖与 created_at 保留/可选字段/分表隔离）；端到端真实 LLM 验证（《地脉长歌》世界观绑定创作 ID，taboos 4 条 JSON 往返正确）
- 2026-09-17 [feat] 新增 SQLite 持久化（Bun 内置 bun:sqlite，`data/novel.db`，路径可用 `NOVEL_DB_PATH` 覆盖）：characters 表按 characterSchema 平铺字段，角色卡确认后按创作 ID 增量入库（CharacterStore，读写双向 zod 校验）。AC：typecheck/lint/test 通过（29 用例，含重开库持久化/多 ID 隔离/可选字段往返）；端到端真实 LLM 验证库内角色绑定创作 ID 且字段完整
- 2026-09-17 [fix] 解决 save_field 并行调用时无法依次确认的问题：prompt.ts 引入 SerialLineSource 串行队列（FIFO、提示语轮到时才写），同时修复 TTY 模式下 readline.question 回调槽被并发覆盖导致的确认挂起；字段摘要/角色卡/大纲确认视图拼入确认提示原子出现，反馈提示带字段标签。AC：隔离测试（时间戳验证 B 提示仅在 A 应答后出现、应答按序映射）+ 端到端真实 LLM 验证（《九州残脉》，逐字段成对确认、修订回路走通、自然退出）
- 2026-09-17 [feat] 大纲增加用户确认循环：save_outline 升级最终确认门，展示剧情梗概/主题/每幕名称与概述，用户确认无修改才落盘；有修改意见按反馈调整后重新确认（循环）。outline Agent 去掉 stopTool 改 isDone 模式（hasToolCall 无法表达「提交被拒需继续修订」），maxSteps 提至 12。AC：typecheck/lint/test 通过（25 用例）；端到端真实 LLM 验证含完整「拒绝→按反馈修订→再确认」回路（《逆脉》，第一幕按要求从铺垫改为冲突切入后落盘）
- 2026-09-17 [feat] submit_character 升级为最终确认门：必填字段齐全后组装整卡展示给用户确认，确认无补充才赋值 submitted 结束循环，有反馈则带反馈继续处理并重新提交；角色卡汇总打印移入 character-agent，编排层改单行确认输出。AC：typecheck/lint/test 通过（25 用例）；自适应驱动端到端真实 LLM 验证成功（《卷动九州》，整卡确认环节走通，进程自然退出）
- 2026-09-16 [feat] 角色卡结构重设计（基本信息/内核三维/背景/性格/角色目的/创作目的/轨迹/结局方向/关系，其中内核、背景、创作目的、结局方向为固定必填）；角色创建改为 ReAct Agent 循环：save_field 逐字段「概括→用户确认→保存」+ submit_character 代码组装过 schema（杜绝模型改写漂移）；ask-user 改工厂函数支持 Agent 标签；ReAct 运行器新增续跑机制（弱模型只宣告不调用工具时自动提醒续跑）；修复 PipedLineSource 未销毁 stdin 导致完成后进程挂住的问题。AC：typecheck/lint/test 通过（25 用例）；自适应驱动端到端真实 LLM 验证成功（《灵脉破晓》，角色卡要素完整流入大纲）
- 2026-09-15 [feat] 大纲生成后按创作 ID 保存到 `output/<id>.json`（outline-writer，含 id 文件名安全校验；output/ 内容被 gitignore，保留 .gitkeep）。AC：typecheck/lint/test 通过（19 用例）；端到端真实 LLM 验证落盘成功（5 幕 26 情节点，JSON 过 schema 校验）
- 2026-09-15 [feat] 完成小说创作工作流编排：createNovel 主流程（UUID 生成 → state 初始化 → 类型/受众/世界观/主角/核心冲突收集 → 大纲生成）；世界观 ReAct Agent（ask_user 多轮追问 + submit_worldview 终态提交）；大纲 ReAct Agent（save_outline）；通用 ReAct 运行器；CLI 双模式交互输入。AC：typecheck/lint/test 通过（15 用例）；两次端到端真实 LLM 验证全流程走通（《回声之蚀》《拾光书坊》）
- 2026-09-15 [fix] 修复 Bun node:readline 管道输入丢行问题（非 TTY 场景改用自维护行缓冲）；主角归一化漂移（强约束 prompt + 用户确认门）；受众 state 只存标签
- 2026-09-14 [feat] 接入 AI SDK（`ai@7` + `@ai-sdk/deepseek@3`），创建 `src/providers/deepseek.ts` 提供 provider 实例；搭建 `src/` 分层结构（providers / tools / workflows），入口迁移至 `src/index.ts`；`tools/` 与 `workflows/` 为占位。AC：typecheck / lint / test 通过，`bun run dev` 正常输出，provider 实例可创建 `deepseek-v4-flash` 模型（运行时冒烟验证）
- 2026-09-14 [chore] 初始化项目：Bun + TypeScript 6 脚手架、ESLint 10 工具链、Agent 工作流文档（AGENTS.md + docs/ 三份指引）、git init

## 已知 Bug

- （非阻塞）deepseek-flash 在主角归一化时仍可能小幅补全用户未提及字段——已有「确认门」兜底，用户答 n 可重新描述；若换更强模型（deepseek-v4-pro）可进一步降低漂移

## 流程复盘记录

- 2026-09-15 端到端验证时发现 Bun 1.4 `node:readline` 在管道输入下两次 question 之间丢弃缓冲并触发 close（Node 行为正常）。归因：环境差异类问题，需求校验阶段未覆盖「脚本化喂入交互输入」的验证方式。优化：本次已在 `cli/prompt.ts` 内置双模式输入解决；后续涉及 stdin 交互的需求，验证清单应同时覆盖 TTY 与管道两种模式

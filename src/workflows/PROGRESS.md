# workflows 模块进度与已知 Bug

时间格式统一为 `YYYY-MM-DD`。模块建档于 2026-09-18，此前条目自根目录 `PROGRESS.md` 按模块视角回填（完整 AC 与端到端记录见根文档对应条目）。

## 进行中

- （当前无进行中需求。复杂需求编码前在此落盘任务清单，见 `docs/feature-check-guide.md` 工作流程第 2 步；完成后归一至「已完成」）

## 已完成

- 2026-09-18 [feat] 大纲接入 outlines 表：类型枚举瘦身为部/幕/章（去卷，章为写作期预留）；`outlineSchema` 重构为「部→幕」两级（部含名称+概述，幕含名称/梗概/情节点），`outlineSchemaFor(actCount, partCount)` 强校验恰好 M 部共 N 幕、每部至少一幕；编排层先问幕数（3-20，默认 5）再问部数（1~幕数，默认 1），各部幕数由模型按剧情节奏分配；确认后 `saveOutlineTree` 整树事务入库 + `output/<id>.json` 落盘（结构变为两级，旧 JSON 不兼容）。AC：typecheck/lint/test 通过（59 用例）；真实 LLM 定向冒烟（createOutline，2 部 5 幕 → 恰好 2 部共 5 幕，模型自分配 3+2，确认循环正常）
- 2026-09-18 [docs] 建立本模块 ARCHITECTURE / PROGRESS 文档；顺带修正根架构文档两处失真：依赖边界补 `output/`（create-novel 实际导入 outline-writer）、目录树补 `workflows/index.ts`
- 2026-09-18 [feat] 大纲生成前询问幕数：`askInt`（3-20，回车默认 5）在编排层收集，经 `outlineSchemaForActs`（refine）在 `save_outline` 入参层强校验恰好 N 幕，模型给错被 schema 拒绝重试。AC：typecheck/lint/test 通过；端到端验证指定 4 幕 → 恰好 4 幕
- 2026-09-17 [feat] 创建流程新增可选命名步骤：命名在 ID 生成后、大纲前询问（回车跳过）；novels 行初始化即建并携带书名；已命名时大纲 title 强制沿用，未命名时大纲确认后以标题回填 name、以 logline 回填 description
- 2026-09-17 [feat] 世界观/角色接入 SQLite 持久化：世界观确认后按创作 ID upsert 入库（1:1）；角色每张卡确认后立即增量入库（1:N，novels 行先建满足外键顺序）

## 历史归档

- 2026-09-15 ~ 2026-09-17【早期建设期滚动摘要，5 条已归并】大纲确认循环（save_outline 最终确认门，拒绝→修订→再确认，isDone 模式 maxSteps 12）；submit_character 整卡确认门（assembleCharacter 代码组装过 schema，杜绝模型改写漂移）；角色收集字段协议（13 字段 FIELD_SPECS，save_field 代码强制「概括→确认→保存」）；主角/核心冲突收集（generateObject 归一化 + 强约束 prompt + 确认门）；模块首建（createNovel 主编排 + worldview/outline subAgent ReAct 终态工具模式，首次端到端跑通并落盘 `output/<id>.json`）

## 已知 Bug

- （非阻塞）deepseek-flash 在主角归一化时可能小幅补全用户未提及字段——本模块角色 Agent 的「确认门」兜底，用户答 n 可重新描述；换更强模型可进一步降低漂移
- （限制，非 Bug）ID 续作/恢复路径目前仅「检测到已有 state 直接返回」，未接入分步恢复；依赖 NovelState 持久化（见待办）

## 待办与后续接入点

- ~~`outlines` 表接入 createNovel~~（2026-09-18 完成：大纲确认后 `saveOutlineTree` 两级入库）
- 大纲修订的多版本流：重新生成大纲时降级旧树、提升新版本（当前重复保存整树会被唯一索引拒绝）
- NovelState 整体 SQLite 化：state 仍为内存态（`memoryNovelStateStore`），`store` 已参数化可直接替换实现
- 未来写作工作流：章（chapter）节点生成与 `document_id` 关联正文（documents 表落地后补外键）

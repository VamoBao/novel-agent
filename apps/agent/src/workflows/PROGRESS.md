# workflows 模块进度与已知 Bug

时间格式统一为 `YYYY-MM-DD`。模块建档于 2026-09-18，此前条目自根目录 `PROGRESS.md` 按模块视角回填（完整 AC 与端到端记录见根文档对应条目）。

## 进行中

- （当前无进行中需求。复杂需求编码前在此落盘任务清单，见 `docs/feature-check-guide.md` 工作流程第 2 步；完成后归一至「已完成」）

## 已完成

- 2026-09-23 [feat] 大纲内容入库 outlines 表（编排层联动，任务包经用户确认）：`saveOutlineTree(id, outline.parts)` 输入类型与 outlineSchema.parts 对齐后内容必填（调用处零改动、类型直接匹配），梗概与关键情节点随节点入列；入库通知文案补「含梗概与关键情节点」；createNovel 集成测试补 DB 行内容断言（部有梗概无情节点、幕两者齐全）。schema / 迁移 / store 改动与 AC 见根 PROGRESS 对应条目；读取路径不动（客户端预览仍读 output JSON）

- 2026-09-22 [feat] save_field 保存策略改为「受控发散」（决策见根 DECISIONS）：标识性字段（name/gender/narrativeRole）照存用户原词不扩写（姓名只存名字本身、性别只存性别、叙事定位一句话以内），描述性字段以用户描述为种子发散丰富成 2~4 句设定文字（补充贴合细节与形象，不照抄原话，不与用户事实相悖）；SYSTEM_PROMPT 与 save_field 工具描述同步分级约束；组装校验与双重确认门不变。AC：typecheck/lint/111 用例过；真实 LLM 定向冒烟两轮——首轮暴露标识字段污染（name 混入名字来历长段、gender 混入外貌），分级修正后第二轮 name/gender/narrativeRole 干净照存、描述性字段饱满扩写（背景从一句身世扩为完整设定）；根 ARCHITECTURE 角色流程描述同步

- 2026-09-18 [feat] 大纲接入 outlines 表：类型枚举瘦身为部/幕/章（去卷，章为写作期预留）；`outlineSchema` 重构为「部→幕」两级（部含名称+概述，幕含名称/梗概/情节点），`outlineSchemaFor(actCount, partCount)` 强校验恰好 M 部共 N 幕、每部至少一幕；编排层先问幕数（3-20，默认 5）再问部数（1~幕数，默认 1），各部幕数由模型按剧情节奏分配；确认后 `saveOutlineTree` 整树事务入库 + `output/<id>.json` 落盘（结构变为两级，旧 JSON 不兼容）。AC：typecheck/lint/test 通过（59 用例）；真实 LLM 定向冒烟（createOutline，2 部 5 幕 → 恰好 2 部共 5 幕，模型自分配 3+2，确认循环正常）
- 2026-09-18 [docs] 建立本模块 ARCHITECTURE / PROGRESS 文档；顺带修正根架构文档两处失真：依赖边界补 `output/`（create-novel 实际导入 outline-writer）、目录树补 `workflows/index.ts`
- 2026-09-18 [feat] 大纲生成前询问幕数：`askInt`（3-20，回车默认 5）在编排层收集，经 `outlineSchemaForActs`（refine）在 `save_outline` 入参层强校验恰好 N 幕，模型给错被 schema 拒绝重试。AC：typecheck/lint/test 通过；端到端验证指定 4 幕 → 恰好 4 幕
- 2026-09-18 [feat] 创建流程新增可选命名步骤：命名在 ID 生成后、大纲前询问（回车跳过）；novels 行初始化即建并携带书名；已命名时大纲 title 强制沿用，未命名时大纲确认后以标题回填 name、以 logline 回填 description

## 历史归档

- 2026-09-15 ~ 2026-09-17【早期建设期滚动摘要，6 条已归并】大纲确认循环（save_outline 最终确认门，拒绝→修订→再确认，isDone 模式 maxSteps 12）；submit_character 整卡确认门（assembleCharacter 代码组装过 schema，杜绝模型改写漂移）；角色收集字段协议（13 字段 FIELD_SPECS，save_field 代码强制「概括→确认→保存」）；主角/核心冲突收集（generateObject 归一化 + 强约束 prompt + 确认门）；模块首建（createNovel 主编排 + worldview/outline subAgent ReAct 终态工具模式，首次端到端跑通并落盘 `output/<id>.json`）；世界观/角色接入 SQLite 持久化（世界观确认后按创作 ID upsert 1:1；角色每卡确认后增量入库 1:N，novels 行先建满足外键顺序）

## 已知 Bug

- （非阻塞）deepseek-flash 在主角归一化时可能小幅补全用户未提及字段——本模块角色 Agent 的「确认门」兜底，用户答 n 可重新描述；换更强模型可进一步降低漂移
- （限制，非 Bug）ID 续作/恢复路径目前仅「检测到已有 state 直接返回」，未接入分步恢复；依赖 NovelState 持久化（见待办）

## 待办与后续接入点

- ~~`outlines` 表接入 createNovel~~（2026-09-18 完成：大纲确认后 `saveOutlineTree` 两级入库）
- 大纲修订的多版本流：重新生成大纲时降级旧树、提升新版本（当前重复保存整树会被唯一索引拒绝）
- NovelState 整体 SQLite 化：state 仍为内存态（`memoryNovelStateStore`），`store` 已参数化可直接替换实现
- 未来写作工作流：章（chapter）节点生成与 `document_id` 关联正文（documents 表落地后补外键）

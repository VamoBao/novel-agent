# workflows 模块进度与已知 Bug

时间格式统一为 `YYYY-MM-DD`。模块建档于 2026-09-18，此前条目自根目录 `PROGRESS.md` 按模块视角回填（完整 AC 与端到端记录见根文档对应条目）。

## 进行中

- （当前无进行中需求。复杂需求编码前在此落盘任务清单，见 `docs/feature-check-guide.md` 工作流程第 2 步；完成后归一至「已完成」）

## 已完成

- 2026-09-28 [feat] 正文存储改文件系统（writeChapter 落盘联动，用户明确指定需求自主直接执行，决策见根 DECISIONS）：正文内容出库入文件——`output/<小说名>/<部名>/<章名>.md`（sanitize 段清理、同名冲突 -N 后缀不覆盖），新增 `output/document-writer.ts`（build/write/read/move/remove/countWords 原语）；writeChapter 改为「写文件 → saveChapterDocument 登记元数据（file_path + 字数，content 不进库）→ 章节点绑定」，库失败回滚删除已写文件；小说 rename 经 updateFilePaths 联动迁移文件，delete 清理正文文件。SCHEMA_VERSION 10→11：documents 去 content 列增 file_path，迁移内联把存量行 content 按层级落文件（10→11 段守卫 version === 10，v10 以下库直接建 11 形态）。AC：typecheck 3 工程 / lint / 203 用例全过（新增 6：迁移 v10 落文件 1 + document-writer 经由工作流断言 + 同名冲突后缀 + 库失败回滚 + query 读取两态/删清/改名迁移 3）；真实库迁移实跑（v10 库 1 行 3094 字正文逐字落 `output/万流归序/第一部·弃子观流/第一章·取魂之夜.md`、content 列移除、file_path 回填）；mock 写作端点 e2e（临时 output 目录）——正文落盘层级与内容 PASS、元数据与绑定 PASS、query CLI 读文件拼 content

- 2026-09-28 [feat] 章节正文生成工作流 writeChapter（跨模块需求，用户明确指定需求自主直接执行，决策见根 DECISIONS，任务清单见根 PROGRESS 当日条目）：`write-chapter.ts`——前置校验（小说存在 / 章节点存在同小说类型 chapter / 概述非空拒旧数据 / 所属幕与部在 / 尚无正文一章一份 / 世界观已确认）→ 库内组上下文（书名 logline + 世界观 + 角色摘要行 + 部幕梗概情节点 + 本章概述 + 同幕前后章概述衔接）→ 写作模型 `getWritingModel()`（OpenAI 兼容端点，与 Agent 会话模型解耦，未配置抛可读错误）单轮 generateText（无确认门，2000~3000 字约束、空结果拒绝）→ `saveChapterDocument` 单事务入库并绑定章节点 document_id + status=completed。headless 第五会话模式 `write-chapter <novelId> <chapterNodeId>`（本会话不经 DeepSeek，Key 检查跳过）。AC：typecheck 3 工程 / lint / 全量 196 用例过（本编排集成 4：入库绑定与 prompt 上下文断言 / 五类前置校验 / 模型未配置 / 空正文零残留）；mock 写作端点协议级端到端（临时库）——hello→notify×2→run_finished、正文入库 48 字、绑定与 completed 落库、query CLI documents 读取。数据层 documents 表与客户端章卡入口部分见根条目

- 2026-09-25 [feat] 角色 AI 润色工作流 polishCharacter（跨模块需求，任务包经用户确认，决策见根 DECISIONS，任务清单见根 PROGRESS 当日条目）：`polish-character.ts`——前置校验（小说存在 / 角色存在且同小说（编辑流传 ID，新建流不传）/ 世界观已确认）→ generateObject 以表单当前值 + 世界观单轮全字段润色（prompt 约束忠实原意、姓名不变、必填语义不变、空可选项补全；无确认门——确认在客户端表单层）；headless 第四会话模式 `polish-character <novelId> [characterId] <formJson>`（表单 JSON 过 characterSchema 校验，结果经协议新增 polish-result 消息回传，run_finished 收尾）。AC：typecheck 3 工程 / lint / 全量 180 用例过（本编排集成 3：编辑流 prompt 含表单与世界观断言 / 新建流 / 前置校验四类可读错误）；真实 LLM 协议级端到端（临时库，`scripts/polish-e2e.ts`）——polish-result 全字段填充、库零写入、run_finished。数据层版本化与客户端表单部分见根条目

- 2026-09-25 [feat] 大纲重新生成工作流 regenerateOutline（跨模块需求，任务包经用户确认，决策见根 DECISIONS，本模块承担编排侧）：`regen-outline.ts`——前置校验（小说存在 / 世界观已确认 / 至少一角色）→ askInt 幕数/部数表单 → 复用 createOutline（入参松绑为 `OutlineContext`：genre/audience/coreConflict 可选，重生成仅喂库内 worldview+characters、不喂旧大纲）→ `saveOutlineTreeNewVersion` 单事务版本切换（旧树与旧章降级 is_current_version=0 归档、新树 version=max+1 当前）→ 覆盖产物 + 回填 description。headless 新增 `regen-outline <novelId>` 第三会话模式。store 侧 `saveOutlineTreeNewVersion` + 单测 3（降级含旧章 / 多版迭代跨小说隔离 / 回滚与入参校验）。AC：typecheck 3 工程 / lint / 172 用例全过（本编排集成 3：新版本入库断言 / 确认循环 / 三类前置校验）；真实 LLM 协议级端到端（临时库实跑）——表单 3 幕 1 部、确认后第 2 版 1 部 3 幕入库、产物覆盖、run_finished。客户端树收起 / 弹框 / 会话页部分见根条目

- 2026-09-25 [feat] createNovel 移除大纲后的自动第一幕章节规划段（用户直接决策，见根 DECISIONS）：大纲确认入库落盘后会话直接收尾（run_finished），收尾 notify 指引从书库幕节点「规划本幕章节」入口手动发起；planChapters / saveChapters / `chapter` 阶段与 chapter-plan 视图保留，归单幕规划会话（planActChapters）使用；集成测试删章节段断言（视图序列无 chapter-plan、库无章节点、断言手动指引通知）。联动：客户端 StageBar 七 → 六阶段。AC 与真实 LLM 待复验项见根 PROGRESS 当日条目

- 2026-09-24 [feat] 单幕章节规划工作流 planActChapters（跨模块需求，任务包与决策见根 PROGRESS / DECISIONS，本模块承担编排侧）：`plan-act-chapters.ts`——前置校验（小说存在 / 幕节点存在同小说类型 act / 幕内容非空拒旧数据 / 所属部在 / 无重复规划）→ 从库组装上下文（novels.name/description + 部与幕节点内容，theme 经 outline-writer 新增 `readOutlineTheme` 尽力读取）→ 复用 planChapters 确认门 → saveChapters 幕下建章。headless 新增 `plan-chapters <novelId> <actNodeId>` 会话模式（无参行为不变）。AC：typecheck 3 工程 / lint / 166 用例全过（新增 7：本编排成功路径 + 五类前置校验 + 确认门中止；readOutlineTheme 2 条）；真实 LLM 协议级端到端实跑——「万流归序」第二幕规划 5 章入库、run_finished、重复规划前置拒绝实证

- 2026-09-24 [feat] 第一幕章节规划工作流（决策见根 DECISIONS）：大纲确认入库落盘后新增章节规划段——`planChapters`（chapter-agent，ReAct + `save_chapters` 终态确认门：拒绝→反馈→修订→再确认）取树中首个 act 节点为第一幕，按幕梗概与关键情节点推荐章节数量（模型推荐，schema 约束 1~12）与各章剧情概述；确认后 `OutlineStore.saveChapters` 幕下事务批量建 chapter 子节点（父级须为幕且同小说、sort 从 1 递增、概述随节点入列、重复保存撞唯一索引拒绝）。协议侧新增 `chapter-plan` 确认视图与 `chapter` 阶段（七阶段）；CLI renderView / client ViewCard / StageBar 联动，客户端浏览侧结构树第三层零改动（本就预留）。AC：typecheck 3 工程 / lint / 157 用例全过（新增 7：shared schema 3 + saveChapters 3 + renderView 1；集成测试改写覆盖章节段——章节点挂幕/概述/sort 断言）；真实 LLM 端到端待用户验证（`bun run dev` 走到章节确认门）。（2026-09-25 更新：createNovel 内的自动规划段已移除、StageBar 相应七 → 六阶段，章节规划统一走客户端手动入口，见当日根 DECISIONS；chapter-agent 与 saveChapters 由单幕会话沿用，本条其余内容仍有效）

- 2026-09-23 [feat] 大纲内容入库 outlines 表（编排层联动，任务包经用户确认）：`saveOutlineTree(id, outline.parts)` 输入类型与 outlineSchema.parts 对齐后内容必填（调用处零改动、类型直接匹配），梗概与关键情节点随节点入列；入库通知文案补「含梗概与关键情节点」；createNovel 集成测试补 DB 行内容断言（部有梗概无情节点、幕两者齐全）。schema / 迁移 / store 改动与 AC 见根 PROGRESS 对应条目；读取路径不动（客户端预览仍读 output JSON）

## 历史归档

- 2026-09-22 [feat] save_field 保存策略改为「受控发散」（决策见根 DECISIONS）：标识性字段（name/gender/narrativeRole）照存用户原词不扩写（姓名只存名字本身、性别只存性别、叙事定位一句话以内），描述性字段以用户描述为种子发散丰富成 2~4 句设定文字（补充贴合细节与形象，不照抄原话，不与用户事实相悖）；SYSTEM_PROMPT 与 save_field 工具描述同步分级约束；组装校验与双重确认门不变。AC：typecheck/lint/111 用例过；真实 LLM 定向冒烟两轮——首轮暴露标识字段污染（name 混入名字来历长段、gender 混入外貌），分级修正后第二轮 name/gender/narrativeRole 干净照存、描述性字段饱满扩写（背景从一句身世扩为完整设定）；根 ARCHITECTURE 角色流程描述同步

- 2026-09-18 [docs] 建立本模块 ARCHITECTURE / PROGRESS 文档；顺带修正根架构文档两处失真：依赖边界补 `output/`（create-novel 实际导入 outline-writer）、目录树补 `workflows/index.ts`

- 2026-09-18 大纲生成前询问幕数（`askInt` 3-20 默认 5，经 `outlineSchemaForActs` refine 在 save_outline 入参层强校验，模型给错被 schema 拒绝重试；端到端 4 幕 → 恰好 4 幕）；创建流程新增可选命名步骤（ID 后大纲前回车跳过，novels 行初始化即建，已命名大纲 title 强制沿用、未命名确认后以标题回填 name / logline 回填 description）——两条均为大纲工作流形态定型的配套改造，完整 AC 见当时提交记录
- 2026-09-15 ~ 2026-09-18【滚动摘要，7 条已归并】早期建设期 6 条：大纲确认循环（save_outline 最终确认门，拒绝→修订→再确认，isDone 模式 maxSteps 12）；submit_character 整卡确认门（assembleCharacter 代码组装过 schema，杜绝模型改写漂移）；角色收集字段协议（13 字段 FIELD_SPECS，save_field 代码强制「概括→确认→保存」）；主角/核心冲突收集（generateObject 归一化 + 强约束 prompt + 确认门）；模块首建（createNovel 主编排 + worldview/outline subAgent ReAct 终态工具模式，首次端到端跑通并落盘 `output/<id>.json`）；世界观/角色接入 SQLite 持久化（世界观确认后按创作 ID upsert 1:1；角色每卡确认后增量入库 1:N，novels 行先建满足外键顺序）。另含 2026-09-18 [feat] 大纲接入 outlines 表：类型枚举瘦身为部/幕/章、outlineSchema 重构两级 + outlineSchemaFor 强校验恰好 M 部共 N 幕、先问幕数再问部数、saveOutlineTree 整树事务入库 + output 两级化落盘（真实 LLM 冒烟：2 部 5 幕模型自分配 3+2）

## 已知 Bug

- （非阻塞）deepseek-flash 在主角归一化时可能小幅补全用户未提及字段——本模块角色 Agent 的「确认门」兜底，用户答 n 可重新描述；换更强模型可进一步降低漂移
- （限制，非 Bug）ID 续作/恢复路径目前仅「检测到已有 state 直接返回」，未接入分步恢复；依赖 NovelState 持久化（见待办）

## 待办与后续接入点

- ~~`outlines` 表接入 createNovel~~（2026-09-18 完成：大纲确认后 `saveOutlineTree` 两级入库）
- ~~第一幕章节规划~~（2026-09-24 完成：大纲后 `planChapters` + `saveChapters` 幕下建章；2026-09-25 起自动段移除，改由客户端幕卡入口手动发起）
- ~~后续幕逐幕推进的章节规划~~（2026-09-24 完成：客户端幕卡入口 → `planActChapters` 单幕会话，任意未规划幕可规划）
- 章节规划修订流：同一幕重复规划章节需先降级旧章（当前重复保存被唯一索引拒绝——客户端幕卡已按「已规划隐藏入口」规避；大纲整树重生成已有版本切换流可参照）
- ~~大纲重新生成的多版本流~~（2026-09-25 完成：`saveOutlineTreeNewVersion` 降级旧树与旧章、新树 max+1 当前；历史版本行保留在库）
- 历史版本浏览 / 切换 UI：重生成归档的旧版行仅存于库（listOutlineNodes currentOnly 不见），客户端无查看/回切界面
- NovelState 整体 SQLite 化：state 仍为内存态（`memoryNovelStateStore`），`store` 已参数化可直接替换实现
- 未来写作工作流：按章节概述生成正文并经 `document_id` 关联（documents 表落地后补外键）

# workflows 模块进度与已知 Bug

时间格式统一为 `YYYY-MM-DD`。模块建档于 2026-09-18，此前条目自根目录 `PROGRESS.md` 按模块视角回填（完整 AC 与端到端记录见根文档对应条目）。

## 进行中

- （当前无进行中需求。复杂需求编码前在此落盘任务清单，见 `docs/feature-check-guide.md` 工作流程第 2 步；完成后归一至「已完成」）

## 已完成

- 2026-10-06 [feat] 大纲新增角色结构化输出与自动入库（跨模块需求，SDD 计划见 `docs/superpowers/plans/2026-10-06-outline-new-characters.md`，7 任务逐一完成后清单归一，决策见根 DECISIONS）：①大纲 Agent（outline-agent）配 `list_characters` 角色库查询工具（返回名 + 叙事定位），`save_outline` 经 `saveOutlineInputSchemaFor` 结构化入参附 newCharacters 新增角色清单（清单内名字不得重复），确认视图连带展示「✨ 本次大纲新增角色（确认后自动入库）」——拒绝大纲即连带拦截角色入库；②新建 `agents/auto-character-agent.ts`：`autoCreateCharacters`——ReAct + save_character 终态工具按清单逐卡入库（isDone 按清单数量判定、maxSteps=4+清单×2 耗尽抛可读错误保留已入库卡；清单外 / 重复保存 / 库内同名三重守卫拒绝后可修正重试）+ `filterNewCharacters` 纯函数兜底 diff（trim 全等剔除库内已有名、清单内同名去重保留首个、空名剔除），独立导出供章节规划 / 正文生成等写作期工作流复用；③createNovel / regenerateOutline 大纲确认入库落盘后兜底 diff + 空清单跳过（零 LLM 调用）+ 自动创建接入（两流程收尾动作一致）。AC：typecheck 3 工程 / lint / 232 用例全过（本模块净增 9：save_outline 入参强校验 4 + auto-character-agent 4 + createNovel 兜底 diff 集成 1，regen-outline 为既有用例扩展；shared schema 与 CLI renderView / 客户端 ViewCard 渲染见根条目）；真实 LLM 端到端待用户复验——`bun run dev` 走到大纲确认门观察清单展示，确认后查 characters 表（新角色 version=1 入库）

- 2026-09-28 [feat] 正文文件夹改「小说名-<创作ID前8位>」去重（简单需求快速通道，用户直接决策，见根 DECISIONS）：buildChapterDocumentPath 入参增 novelId、顶层段统一为 `<小说名>-<id前8>`——同名小说天然分属不同文件夹，rename 迁移仅更新名段（ID 段稳定）；10→11 迁移路径构造同步（SQL 增选 novel_id）；新增 output/document-writer.test.ts 4 条（sanitize 清理/回退/截断、同名不同 ID 路径分叉、-N 冲突后缀、countWords）。AC：typecheck 3 工程 / lint / 208 用例全过；mock 写作端点 e2e 新路径断言 PASS（真实库数据迁移见根 PROGRESS 当日条目）
- 2026-09-28 [feat] 正文存储改文件系统（writeChapter 落盘联动，用户明确指定需求自主直接执行，决策见根 DECISIONS）：正文内容出库入文件——`output/<小说名>/<部名>/<章名>.md`（sanitize 段清理、同名冲突 -N 后缀不覆盖），新增 `output/document-writer.ts`（build/write/read/move/remove/countWords 原语）；writeChapter 改为「写文件 → saveChapterDocument 登记元数据（file_path + 字数，content 不进库）→ 章节点绑定」，库失败回滚删除已写文件；小说 rename 经 updateFilePaths 联动迁移文件，delete 清理正文文件。SCHEMA_VERSION 10→11：documents 去 content 列增 file_path，迁移内联把存量行 content 按层级落文件（10→11 段守卫 version === 10，v10 以下库直接建 11 形态）。AC：typecheck 3 工程 / lint / 203 用例全过（新增 6：迁移 v10 落文件 1 + document-writer 经由工作流断言 + 同名冲突后缀 + 库失败回滚 + query 读取两态/删清/改名迁移 3）；真实库迁移实跑（v10 库 1 行 3094 字正文逐字落 `output/万流归序/第一部·弃子观流/第一章·取魂之夜.md`、content 列移除、file_path 回填）；mock 写作端点 e2e（临时 output 目录）——正文落盘层级与内容 PASS、元数据与绑定 PASS、query CLI 读文件拼 content

- 2026-09-28 [feat] 章节正文生成工作流 writeChapter（跨模块需求，用户明确指定需求自主直接执行，决策见根 DECISIONS，任务清单见根 PROGRESS 当日条目）：`write-chapter.ts`——前置校验（小说存在 / 章节点存在同小说类型 chapter / 概述非空拒旧数据 / 所属幕与部在 / 尚无正文一章一份 / 世界观已确认）→ 库内组上下文（书名 logline + 世界观 + 角色摘要行 + 部幕梗概情节点 + 本章概述 + 同幕前后章概述衔接）→ 写作模型 `getWritingModel()`（OpenAI 兼容端点，与 Agent 会话模型解耦，未配置抛可读错误）单轮 generateText（无确认门，2000~3000 字约束、空结果拒绝）→ `saveChapterDocument` 单事务入库并绑定章节点 document_id + status=completed。headless 第五会话模式 `write-chapter <novelId> <chapterNodeId>`（本会话不经 DeepSeek，Key 检查跳过）。AC：typecheck 3 工程 / lint / 全量 196 用例过（本编排集成 4：入库绑定与 prompt 上下文断言 / 五类前置校验 / 模型未配置 / 空正文零残留）；mock 写作端点协议级端到端（临时库）——hello→notify×2→run_finished、正文入库 48 字、绑定与 completed 落库、query CLI documents 读取。数据层 documents 表与客户端章卡入口部分见根条目

- 2026-09-25 [feat] 角色 AI 润色工作流 polishCharacter（跨模块需求，任务包经用户确认，决策见根 DECISIONS，任务清单见根 PROGRESS 当日条目）：`polish-character.ts`——前置校验（小说存在 / 角色存在且同小说（编辑流传 ID，新建流不传）/ 世界观已确认）→ generateObject 以表单当前值 + 世界观单轮全字段润色（prompt 约束忠实原意、姓名不变、必填语义不变、空可选项补全；无确认门——确认在客户端表单层）；headless 第四会话模式 `polish-character <novelId> [characterId] <formJson>`（表单 JSON 过 characterSchema 校验，结果经协议新增 polish-result 消息回传，run_finished 收尾）。AC：typecheck 3 工程 / lint / 全量 180 用例过（本编排集成 3：编辑流 prompt 含表单与世界观断言 / 新建流 / 前置校验四类可读错误）；真实 LLM 协议级端到端（临时库，`scripts/polish-e2e.ts`）——polish-result 全字段填充、库零写入、run_finished。数据层版本化与客户端表单部分见根条目

## 历史归档

- 2026-09-22 [feat] save_field 保存策略改为「受控发散」（决策见根 DECISIONS）：标识性字段（name/gender/narrativeRole）照存用户原词不扩写（姓名只存名字本身、性别只存性别、叙事定位一句话以内），描述性字段以用户描述为种子发散丰富成 2~4 句设定文字（补充贴合细节与形象，不照抄原话，不与用户事实相悖）；SYSTEM_PROMPT 与 save_field 工具描述同步分级约束；组装校验与双重确认门不变。AC：typecheck/lint/111 用例过；真实 LLM 定向冒烟两轮——首轮暴露标识字段污染（name 混入名字来历长段、gender 混入外貌），分级修正后第二轮 name/gender/narrativeRole 干净照存、描述性字段饱满扩写（背景从一句身世扩为完整设定）；根 ARCHITECTURE 角色流程描述同步

- 2026-09-18 [docs] 建立本模块 ARCHITECTURE / PROGRESS 文档；顺带修正根架构文档两处失真：依赖边界补 `output/`（create-novel 实际导入 outline-writer）、目录树补 `workflows/index.ts`

- 2026-09-18 大纲生成前询问幕数（`askInt` 3-20 默认 5，经 `outlineSchemaForActs` refine 在 save_outline 入参层强校验，模型给错被 schema 拒绝重试；端到端 4 幕 → 恰好 4 幕）；创建流程新增可选命名步骤（ID 后大纲前回车跳过，novels 行初始化即建，已命名大纲 title 强制沿用、未命名确认后以标题回填 name / logline 回填 description）——两条均为大纲工作流形态定型的配套改造，完整 AC 见当时提交记录
- 2026-09-15 ~ 2026-09-25【滚动摘要，12 条已归并】早期建设期 6 条：大纲确认循环（save_outline 最终确认门，拒绝→修订→再确认，isDone 模式 maxSteps 12）；submit_character 整卡确认门（assembleCharacter 代码组装过 schema，杜绝模型改写漂移）；角色收集字段协议（13 字段 FIELD_SPECS，save_field 代码强制「概括→确认→保存」）；主角/核心冲突收集（generateObject 归一化 + 强约束 prompt + 确认门）；模块首建（createNovel 主编排 + worldview/outline subAgent ReAct 终态工具模式，首次端到端跑通并落盘 `output/<id>.json`）；世界观/角色接入 SQLite 持久化（世界观确认后按创作 ID upsert 1:1；角色每卡确认后增量入库 1:N，novels 行先建满足外键顺序）。另含 2026-09-18 [feat] 大纲接入 outlines 表：类型枚举瘦身为部/幕/章、outlineSchema 重构两级 + outlineSchemaFor 强校验恰好 M 部共 N 幕、先问幕数再问部数、saveOutlineTree 整树事务入库 + output 两级化落盘（真实 LLM 冒烟：2 部 5 幕模型自分配 3+2）；2026-09-23 [feat] 大纲内容入库编排层联动（saveOutlineTree 输入类型对齐 outlineSchema.parts 内容必填，梗概与关键情节点随节点入列）；2026-09-24 [feat] 第一幕章节规划——planChapters 终态确认门 + saveChapters 幕下事务建章 + `chapter-plan` 视图与 `chapter` 阶段（后自动段移除，由单幕会话沿用）；2026-09-24 [feat] 单幕章节规划 planActChapters（headless `plan-chapters` 会话模式：五类前置校验 + 库内组上下文 + 复用章节 Agent，真实 LLM 端到端 5 章入库）；2026-09-25 [feat] createNovel 移除大纲后自动规划段（会话收尾于大纲入库，章节规划归客户端幕卡手动入口，StageBar 七→六阶段）；2026-09-25 [feat] 大纲重新生成 regenerateOutline（复用大纲 Agent 入参松绑 + saveOutlineTreeNewVersion 版本切换、headless `regen-outline` 第三会话，真实 LLM 端到端实跑）（各条 AC 与决策详见 git 历史与根 PROGRESS / DECISIONS 对应条目）

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

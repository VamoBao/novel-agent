# workflows 模块进度与已知 Bug

时间格式统一为 `YYYY-MM-DD`。模块建档于 2026-09-18，此前条目自根目录 `PROGRESS.md` 按模块视角回填（完整 AC 与端到端记录见根文档对应条目）。

## 进行中

- （当前无进行中需求。）

## 已完成

- 2026-10-15 [fix] 写作偏好反馈阈值一致性：writeChapter 的初稿/修订、三段审核开始/结束与保存事件均携带本次解析的 stylePassScore，经 headless → shared write-progress → 客户端章卡传递，警告与建议显示使用同审核阈值。协议新字段可选、旧消息默认 80，零阈值保留。扩展工作流默认 80 与小说覆盖 85 的全阶段/跨轮断言，客户端与协议新增回归见根 PROGRESS。AC：先红后绿，typecheck / lint / 全量 539 项通过，独立复审无新增问题。

- 2026-10-14 [feat] 写作偏好两级配置（章节篇幅 + 文风合格线）：writeChapter 在组上下文前解析生效值——`providers/writing-prefs.ts` 的 resolveSystemWritingPrefs 读 NOVEL_CHAPTER_LENGTH_MIN/MAX + NOVEL_STYLE_PASS_SCORE（非法值静默归 null），shared resolveChapterLength / resolveStylePassScore 按「小说级 novels 行 > 系统级 > 内置默认 2000~3000 字 / 80 分」解析（篇幅 min/max 整体覆盖、半设乱序防御性跳过）；写作 prompt 篇幅条用生效值、chapter-review 文风合格线参数化（input.stylePassScore → 评分 prompt / isReportPassing / formatRevisionBlock，内置默认由 90 改为 80）、Options 增 systemWritingPrefs 注入（缺省读环境变量）、小说级覆盖生效时 notify 通报。AC：typecheck 3 工程 / lint / 全量 529 用例通过（本模块净增 writing-prefs 单测 3 + chapter-review 阈值用例 + write-chapter 偏好两态）；真实模型文学效果待人工验收。数据层 19→20 迁移、query CLI set-writing-prefs 与客户端设置入口见根 PROGRESS 与 DECISIONS 当日条目。

- 2026-10-14 [feat] 伏笔最终回收判断与 eval：复用 resolveChapterTreePosition 的目标树版本全书章序，去重回收点取最大者为最终收尾章（不依赖数组顺序、幕内 sort 或 recoveryStatus）；前段标阶段回收保留核心真相，最终章要求完整揭露真相、解释表面行为联系并收尾，同源注入初稿/修订/内容审校；缺失或跨版回收点不猜测最终点。同章种收、登场资料缺失及归档目标仍有正确阶段要求。最终收尾优先于概述中的延后揭露描述，summary 不得仅因此报偏离；未收尾返回 foreshadow 整改项并进入既有三轮修订，保底保存/警告策略保持。AC：新增 8 项回归先红后绿，覆盖无序重复、跨部跨幕、版本隔离、异常降级及未收尾→整改→修订稿入库；typecheck / lint / 全量 507 项通过，独立审查提出的优先级冲突修复后复审关闭。未调用真实模型验证文学效果；中间章持续约束与本章位置展示仍在待办。

- 2026-10-14 [feat] 正文角色上下文补全（主记录见根 PROGRESS）：完整角色字段、作者指导独立、同版本已确认的全部已结束历史与本章计划同源注入写作和审校；未来/草案/取消不注入，区间结束不代表正文兑现。新增纯函数全字段/作者阶段/前段历史/连续两段历史与请求集成测试。AC：全量 499 项、typecheck、lint 通过；姓名限制见根记录。

- 2026-10-14 [feat] Agent 模型 OpenAI 兼容接入（主记录与配置规则见根 PROGRESS）：create-novel / polish-character / write-chapter 统一引用 providers/agent-model，正文审校与写作回落均使用通用 Agent 模型；现有模型注入接口与业务流程保留。相关注释和架构文档同步。AC：typecheck / lint / 全量 489 项通过，独立审查无必须修复问题；真实服务未调用验证。

## 历史归档

- 2026-10-15 历史滚动摘要：2026-10-13 章节登场人物 ID 绑定（chapter-cast-intake 与上下文按阵容收窄）、角色编辑陈旧可见性（后由迁移影响范围判定接替），原验收见根记录与 Git 历史。；本次归并：2026-10-13 固定角色基准与迁移上下文模块、2026-10-14 迁移计划归属审查修复（完整验收见根进度与 Git 历史）。

- 2026-10-12 历史滚动摘要：2026-10-12 [feat] 正文校验阶段结束即时回传单项结果；主任务清单、验证结果与全量测试环境限制见仓库根目录 `PROGRESS.md`。；小说创作条件入库与复用（完整实现与验收见对应提交。）

- 2026-10-12 [feat] 章节正文重新生成——覆盖替换 + 弹框确认（跨模块需求，设计规格 `docs/superpowers/specs/2026-10-12-chapter-regen-design.md` + 实现计划 `docs/superpowers/plans/2026-10-12-chapter-regen.md`，4 任务逐一实现后清单归一；两项决策经用户确认：旧正文覆盖替换 / 弹框确认，决策见根 DECISIONS）：**本模块仅 write-chapter.ts 改动**——前置校验移除「已有正文」拒绝（getDocumentByChapter 有行即 isRegen 分流：notify「🔄 重新生成中（将覆盖现有正文）」、落库走 replaceChapterDocument 覆盖替换、事务提交后清理旧正文文件——路径相同跳过防误删、幂等容忍缺失；任一环节失败回滚删新文件旧正文零影响）；生成与校验流程与首次生成完全一致（同一会话、协议与 headless 零改动）。document-store replaceChapterDocument 与客户端重生成入口/弹框见根 PROGRESS 当日条目。AC：typecheck 3 工程 / lint / 361 用例全过（本模块净增 3 条重生成集成用例——覆盖替换成功 / 库故障回滚 / 校验抛错保旧；前置校验用例「已有正文拒绝」随行为翻转移除，既有用例全数保留）；真实端到端待用户复验
- 2026-10-12 [feat] 章节正文生成校验-修订闭环（跨模块需求，设计规格 `docs/superpowers/specs/2026-10-12-chapter-review-loop-design.md` + 实现计划 `docs/superpowers/plans/2026-10-12-chapter-review-loop.md`，6 任务逐一实现后清单归一；三项决策经用户确认：3 轮上限仍未达标保底保存最后一版并警告 / 校验模型用 Agent 会话模型 deepseek / 修订式重写，决策见根 DECISIONS）：**本模块净增 chapter-review.ts 校验 subAgent（reviewChapter 三段独立单轮 generateObject——①内容约束（世界观/章节概述/本章伏笔同源 lines）②文风相似度（≥90 合格、无启用样本 skipped 段事件零发送）③前后自洽（仅正文、kind 代码补全）+ isReportPassing + formatRevisionBlock；reviewModel 与 onProgress 注入、异常直接抛错）与 write-chapter.ts 循环化改造（生成段包进 3 轮循环、修订轮 prompt 追加【上一版正文】+【整改报告】块、3 轮保底保存警告、Options 增 reviewModel/onProgress 注入）**；shared review schema 与 write-progress 协议、headless 接线与 Key 检查收窄（write-chapter 自此始终要求 DEEPSEEK_API_KEY）、客户端进度区块见根 PROGRESS 当日条目。AC：typecheck 3 工程 / lint / 355 用例全过（本模块净增 13：chapter-review 8 + write-chapter 集成 5，既有 334 全数保留——初稿 prompt 逐字节回归、伏笔/文风注入用例全保留）；真实 LLM / 写作模型端到端待用户复验

- 2026-10-11 [feat] 章节正文生成伏笔上下文注入（复杂需求，设计规格 `docs/superpowers/specs/2026-10-11-foreshadow-prose-context-design.md` + 实现计划 `docs/superpowers/plans/2026-10-11-foreshadow-prose-context.md`，3 任务逐一实现后清单归一；两项决策经用户确认：登场伏笔仅注入卡片；回收伏笔登场章上下文=正文优先+概述兜底+预算护栏——「伏笔编辑对未写章滚动生效、剩余不一致收敛为已写正文」，是「设定与已生成内容一致性」系列讨论的第一块，决策见根 DECISIONS）：①新建 `foreshadow-context.ts` 纯函数模块（无 LLM 零 schema 迁移）——`buildChapterForeshadowContext` 把绑定到本章的伏笔分登场/回收两组（同章种收只归回收组标「登场于本章」，实现期修正计划中「同章种收仍进登场组」的规格覆盖错误），登场注入卡片全字段（表面行为/隐藏真相/注意度/埋线方式/创作目的/服务角色名——ID 解析名字未匹配兜底原 ID），回收组按登场章全局章序升序（`buildChapterOrder` 复用，更早埋设优先保正文预算）注入卡片 + 登场章上下文（`getOutlineNode` 按 ID 直查不过滤版本——归档旧版章照常解析名与正文；`getDocumentByChapter` + `readDocumentArtifact` 正文优先，FORESHADOW_PROSE_BUDGET=8000 字符预算内整条注入不截断，未生成/文件缺失/超预算降级该章概述）+ 多步回收的既往回收章概述（全局章序在当前章之前，防重复揭底），登场章节点不可解析仅注入卡片标注不计降级，无绑定伏笔返回空 lines；②write-chapter 集成——Options 增 foreshadowStore 注入（缺省默认 store），【本章伏笔】块插【下一章】块后【参考文风】段前（核心叙事上下文区，长样本文风仍留尾部），写作要求条件附加编号顺延（6=伏笔显隐与呼应要求、7=文风模仿、8=只输出正文；无附加条时「只输出正文文本」仍为第 6 条），生成前 notify「🔮 本章伏笔：登场 N 条、回收 M 条（X 条登场章正文缺失或超预算，以概述代替）」；无绑定伏笔零注入零通知（现状逐字节回归，不新增前置校验）。AC：typecheck 3 工程 / lint / 334 用例全过（净增 15：foreshadow-context 12 + write-chapter 集成 3，既有 319 全数保留）；真实 LLM / 写作模型端到端待用户复验——绑定伏笔的章生成正文，观察 notify 统计、正文对伏笔表面行为的带出与注意度服从、回收章对登场章细节的呼应

- 2026-09-28 [feat] 正文文件夹改「小说名-<创作ID前8位>」去重（简单需求快速通道，用户直接决策，见根 DECISIONS）：buildChapterDocumentPath 入参增 novelId、顶层段统一为 `<小说名>-<id前8>`——同名小说天然分属不同文件夹，rename 迁移仅更新名段（ID 段稳定）；10→11 迁移路径构造同步（SQL 增选 novel_id）；新增 output/document-writer.test.ts 4 条（sanitize 清理/回退/截断、同名不同 ID 路径分叉、-N 冲突后缀、countWords）。AC：typecheck 3 工程 / lint / 208 用例全过；mock 写作端点 e2e 新路径断言 PASS（真实库数据迁移见根 PROGRESS 当日条目）
- 2026-09-28 [feat] 正文存储改文件系统（writeChapter 落盘联动，用户明确指定需求自主直接执行，决策见根 DECISIONS）：正文内容出库入文件——`output/<小说名>/<部名>/<章名>.md`（sanitize 段清理、同名冲突 -N 后缀不覆盖），新增 `output/document-writer.ts`（build/write/read/move/remove/countWords 原语）；writeChapter 改为「写文件 → saveChapterDocument 登记元数据（file_path + 字数，content 不进库）→ 章节点绑定」，库失败回滚删除已写文件；小说 rename 经 updateFilePaths 联动迁移文件，delete 清理正文文件。SCHEMA_VERSION 10→11：documents 去 content 列增 file_path，迁移内联把存量行 content 按层级落文件（10→11 段守卫 version === 10，v10 以下库直接建 11 形态）。AC：typecheck 3 工程 / lint / 203 用例全过（新增 6：迁移 v10 落文件 1 + document-writer 经由工作流断言 + 同名冲突后缀 + 库失败回滚 + query 读取两态/删清/改名迁移 3）；真实库迁移实跑（v10 库 1 行 3094 字正文逐字落 `output/万流归序/第一部·弃子观流/第一章·取魂之夜.md`、content 列移除、file_path 回填）；mock 写作端点 e2e（临时 output 目录）——正文落盘层级与内容 PASS、元数据与绑定 PASS、query CLI 读文件拼 content

- 2026-09-28 [feat] 章节正文生成工作流 writeChapter（跨模块需求，用户明确指定需求自主直接执行，决策见根 DECISIONS，任务清单见根 PROGRESS 当日条目）：`write-chapter.ts`——前置校验（小说存在 / 章节点存在同小说类型 chapter / 概述非空拒旧数据 / 所属幕与部在 / 尚无正文一章一份 / 世界观已确认）→ 库内组上下文（书名 logline + 世界观 + 角色摘要行 + 部幕梗概情节点 + 本章概述 + 同幕前后章概述衔接）→ 写作模型 `getWritingModel()`（OpenAI 兼容端点，与 Agent 会话模型解耦，未配置回落 deepseek）单轮 generateText（无确认门，2000~3000 字约束、空结果拒绝）→ `saveChapterDocument` 单事务入库并绑定章节点 document_id + status=completed。headless 第五会话模式 `write-chapter <novelId> <chapterNodeId>`。AC：typecheck 3 工程 / lint / 全量 196 用例过（本编排集成 4：入库绑定与 prompt 上下文断言 / 五类前置校验 / 模型未配置回落 / 空正文零残留）；mock 写作端点协议级端到端（临时库）——hello→notify×2→run_finished、正文入库、绑定与 completed 落库、query CLI documents 读取。数据层 documents 表与客户端章卡入口部分见根条目

- 2026-09-22 [feat] save_field 保存策略改为「受控发散」（决策见根 DECISIONS）：标识性字段（name/gender/narrativeRole）照存用户原词不扩写（姓名只存名字本身、性别只存性别、叙事定位一句话以内），描述性字段以用户描述为种子发散丰富成 2~4 句设定文字（补充贴合细节与形象，不照抄原话，不与用户事实相悖）；SYSTEM_PROMPT 与 save_field 工具描述同步分级约束；组装校验与双重确认门不变。AC：typecheck/lint/111 用例过；真实 LLM 定向冒烟两轮——首轮暴露标识字段污染（name 混入名字来历长段、gender 混入外貌），分级修正后第二轮 name/gender/narrativeRole 干净照存、描述性字段饱满扩写（背景从一句身世扩为完整设定）；根 ARCHITECTURE 角色流程描述同步

- 2026-09-18 [docs] 建立本模块 ARCHITECTURE / PROGRESS 文档；顺带修正根架构文档两处失真：依赖边界补 `output/`（create-novel 实际导入 outline-writer）、目录树补 `workflows/index.ts`

- 2026-09-18 大纲生成前询问幕数（`askInt` 3-20 默认 5，经 `outlineSchemaForActs` refine 在 save_outline 入参层强校验，模型给错被 schema 拒绝重试；端到端 4 幕 → 恰好 4 幕）；创建流程新增可选命名步骤（ID 后大纲前回车跳过，novels 行初始化即建，已命名大纲 title 强制沿用、未命名确认后以标题回填 name / logline 回填 description）——两条均为大纲工作流形态定型的配套改造，完整 AC 见当时提交记录
- 2026-09-15 ~ 2026-10-10【滚动摘要，17 条已归并】早期建设期 6 条：大纲确认循环（save_outline 最终确认门，拒绝→修订→再确认，isDone 模式 maxSteps 12）；submit_character 整卡确认门（assembleCharacter 代码组装过 schema，杜绝模型改写漂移）；角色收集字段协议（13 字段 FIELD_SPECS，save_field 代码强制「概括→确认→保存」）；主角/核心冲突收集（generateObject 归一化 + 强约束 prompt + 确认门）；模块首建（createNovel 主编排 + worldview/outline subAgent ReAct 终态工具模式，首次端到端跑通并落盘 `output/<id>.json`）；世界观/角色接入 SQLite 持久化（世界观确认后按创作 ID upsert 1:1；角色每卡确认后增量入库 1:N，novels 行先建满足外键顺序）。另含 2026-09-18 [feat] 大纲接入 outlines 表：类型枚举瘦身为部/幕/章、outlineSchema 重构两级 + outlineSchemaFor 强校验恰好 M 部共 N 幕、先问幕数再问部数、saveOutlineTree 整树事务入库 + output 两级化落盘（真实 LLM 冒烟：2 部 5 幕模型自分配 3+2）；2026-09-23 [feat] 大纲内容入库编排层联动（saveOutlineTree 输入类型对齐 outlineSchema.parts 内容必填，梗概与关键情节点随节点入列）；2026-09-24 [feat] 第一幕章节规划——planChapters 终态确认门 + saveChapters 幕下事务建章 + `chapter-plan` 视图与 `chapter` 阶段（后自动段移除，由单幕会话沿用）；2026-09-24 [feat] 单幕章节规划 planActChapters（headless `plan-chapters` 会话模式：五类前置校验 + 库内组上下文 + 复用章节 Agent，真实 LLM 端到端 5 章入库）；2026-09-25 [feat] createNovel 移除大纲后自动规划段（会话收尾于大纲入库，章节规划归客户端幕卡手动入口，StageBar 七→六阶段）；2026-09-25 [feat] 大纲重新生成 regenerateOutline（复用大纲 Agent 入参松绑 + saveOutlineTreeNewVersion 版本切换、headless `regen-outline` 第三会话，真实 LLM 端到端实跑）；2026-09-25 [feat] 角色 AI 润色工作流 polishCharacter（前置校验三类：小说 / 角色同小说 / 世界观已确认，generateObject 以表单当前值 + 世界观单轮全字段润色、无确认门——确认在客户端表单层，headless 第四会话 `polish-character`、结果经 polish-result 协议消息回传，真实 LLM 协议级端到端 polish-result 全字段填充、库零写入）（各条 AC 与决策详见 git 历史与根 PROGRESS / DECISIONS 对应条目）；本次追加：2026-10-06 大纲新增角色自动创建、2026-10-07 伏笔树编辑与章卡预览、2026-10-10 参考文风正文注入已归档，细节见根进度、设计与 Git 历史。

## 已知 Bug

- （非阻塞）deepseek-flash 在主角归一化时可能小幅补全用户未提及字段——本模块角色 Agent 的「确认门」兜底，用户答 n 可重新描述；换更强模型可进一步降低漂移
- （限制，非 Bug）ID 续作/恢复路径目前仅「检测到已有 state 直接返回」，未接入分步恢复；依赖 NovelState 持久化（见待办）

## 待办与后续接入点

### 正文章序与伏笔持续约束（2026-10-14 评估，剩余任务包待确认）

- 评估阶段完成代码链路核对与运行验证。随后用户确认并要求实现「全书章序最晚回收点为最终章、最终章揭露真相且 eval 校验」，该子范围单独交付；下列本章位置展示及中间章持续约束任务仍未开始，不计入「进行中」。
- **评估结论：反馈部分成立。** `outlines.sort` 是同父级排序，但 shared `buildChapterOrder` 已按「部 sort → 幕 sort → 章 sort」展开所有已规划章，得到从 1 起的全书章序；角色迁移通过 `chapter-context.ts` 按目标章所在全书大纲版本计算未开始 / 进行中 / 本章完成 / 已结束，计划含全书起止章序、旧值→目标、诱因与过渡，写作和内容审校同源注入。因此不存在「仅按幕内排序判断角色迁移」或「迁移完全没有阶段 prompt」的问题。
- **确认的上下文缺口：** `write-chapter.ts` 的【本章】仅包含章名与概述，没有独立的本章全书章序说明（章名不保证包含数字）；`foreshadow-context.ts` 仅选择本章登场或回收的伏笔，登场后、下一回收点前的中间章不注入该伏笔的「已埋设、尚未到回收点、不得提前揭底」约束，内容审校也缺少同一信息。全书排序已存在，缺口在上下文选择与表达。当前行为符合既有「无本章绑定零注入」设计，是后续能力补全；未验证真实模型已产生提前揭底等文学问题。
- **验证证据：** 2026-10-14 定向执行 `bun test apps/agent/src/workflows/chapter-context.test.ts apps/agent/src/workflows/foreshadow-context.test.ts apps/agent/src/workflows/write-chapter.test.ts apps/agent/src/workflows/chapter-review.test.ts`，63 pass / 0 fail；另用内存 SQLite 最小场景先规划第二幕、再规划第一幕，两幕各三章的全书序仍为 1～6（幕内 sort 各为 1～3）。迁移第 2～5 章：第 4 章为进行中、第 5 章本章完成、第 6 章参考套用新值；伏笔第 2 章登场、第 5 章回收：第 3、4 章均返回空伏笔 lines。
- **建议方案：** 复用现有树排序，按请求派生本章章序与所属大纲版本并注入 prompt，保留章节 ID 作为绑定依据；暂不新增持久化全书序列，避免先规划后幕、后补前幕时维护两套排序。序号只表示该版本当前已规划章节中的位置，补章后重新计算。伏笔需区分「本章必须体现的登场/回收」与「中间章仅需遵守的保密/连续性约束」，不可要求每章重新埋设。
- **已确认与剩余边界：** 伏笔是一个登场点加多个可选回收点，不等同于角色迁移的单一起止区间。用户已确认按全书章序最大的回收点最终收尾，前段回收推进线索/局部揭示并保留核心真相；剩余待确定的是中间章持续约束、最后回收点后是否继续提供已揭示历史、仅绑回收幕/尚无回收章如何降级。`recoveryStatus` 为卡片管理状态，不能直接当作倒序生成目标章的叙事阶段；既有回收路径允许引用归档登场章，补全过程不能无意移除该兼容能力。

任务包目标：让写作与审校共享明确的本章位置，并在伏笔中间章获得适当的持续约束。后续需求涉及上下文纯函数、编排和审校，按复杂需求串行执行、WIP = 1；本轮仅登记待确认方案。

- [ ] 任务 1：本章位置上下文｜状态：未开始｜业务目的：让模型明确本章在全书当前规划中的位置，与迁移起止章序使用同一依据｜完成判断条件：写作与审校接收一致的派生章序及版本说明；跨部/跨幕、倒序规划、补规划前幕和旧版目标章的排序正确，不依赖章名数字或入库顺序｜涉及模块：`packages/shared/src/outline-order.ts`、`chapter-context.ts`、`write-chapter.ts`、`chapter-review.ts`（优先复用已有排序，不预设改 shared 或数据库）。
- [ ] 任务 2：伏笔相对目标章的持续约束｜状态：未开始｜业务目的：埋设后到回收点之间保留真相边界，降低提前揭底与前后矛盾风险｜完成判断条件：在已实现的阶段/最终回收判断之上，中间章提供不得提前揭底的约束而不强制重提伏笔；无相关伏笔仍零注入；明确未绑章、回收幕及归档引用的持续约束处理并覆盖｜涉及模块：`foreshadow-context.ts` 及其存取接口消费。
- [ ] 任务 3：写作、修订与审校联动及回归｜状态：未开始｜业务目的：避免写作者知道持续约束而审校看不到，或把保密约束误当作正文必须出现的内容｜完成判断条件：初稿和修订稿复用同源位置/伏笔材料，内容审校同时检查端点兑现与中间章保密；新增跨部/跨幕、开放区间、多步回收、倒序生成、版本隔离及空数据回归，按最终范围执行 typecheck / lint / test 并同步架构与进度文档；真实模型的文学效果另行验收｜涉及模块：`write-chapter.ts`、`chapter-review.ts`、相关 `*.test.ts` 与模块状态文档。

- ~~`outlines` 表接入 createNovel~~（2026-09-18 完成：大纲确认后 `saveOutlineTree` 两级入库）
- ~~第一幕章节规划~~（2026-09-24 完成：大纲后 `planChapters` + `saveChapters` 幕下建章；2026-09-25 起自动段移除，改由客户端幕卡入口手动发起）
- ~~后续幕逐幕推进的章节规划~~（2026-09-24 完成：客户端幕卡入口 → `planActChapters` 单幕会话，任意未规划幕可规划）
- 章节规划修订流：同一幕重复规划章节需先降级旧章（当前重复保存被唯一索引拒绝——客户端幕卡已按「已规划隐藏入口」规避；大纲整树重生成已有版本切换流可参照）
- ~~大纲重新生成的多版本流~~（2026-09-25 完成：`saveOutlineTreeNewVersion` 降级旧树与旧章、新树 max+1 当前；历史版本行保留在库）
- 历史版本浏览 / 切换 UI：重生成归档的旧版行仅存于库（listOutlineNodes currentOnly 不见），客户端无查看/回切界面
- NovelState 整体 SQLite 化：state 仍为内存态（`memoryNovelStateStore`），`store` 已参数化可直接替换实现
- 未来写作工作流：按章节概述生成正文并经 `document_id` 关联（documents 表落地后补外键）


## 流程复盘记录

- 2026-10-14 初版角色迁移上下文只验单角色，未验证多角色同字段计划的归属。现扩展纯函数与写作/审校请求集成测试，明确两名角色使用相同旧值、不同目标；矩阵与测试隔离规范见根目录 docs/character-migration-testing.md。

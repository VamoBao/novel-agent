## 2026-10-13 章节登场人物 ID 绑定：逐章清单单一事实源、outlines.character_ids 列、正文按绑定注入

- **背景**：正文生成的【登场角色参考】注入**全库角色**——角色库随创作推进膨胀（大纲、每幕规划持续自动入库），每章正文生成都要为无关角色付出 token；且「哪些角色在哪章登场」没有结构化数据（顶层 newCharacters 的 role 文本「第2章登场·…」仅供人读，系统从不解析）。用户提出：在大纲表新增角色 ID 绑定列（仅章节点有效），章节规划时逐章梳理登场角色，确认入库后建卡 → 名字→ID 回填绑定，正文生成按绑定收窄上下文。
- **决策一：逐章 characters 清单为唯一事实源，顶层 newCharacters 清单取消（方案设计时与用户对齐）**：save_chapters 的 chapters[] 项新增 `characters: [{name, role}]`（min 1，章内名不重复，全员必填 role——库内角色=在本章中的作用、新角色=设定级一句话定位即建卡依据，用户选定）；「本次规划新增角色」由编排层经 `collectChapterCharacters`（逐章并集、跨章同名保首个 role）+ `filterNewCharacters`（对角色库 diff）**派生**，确认视图与建卡入库共用同一对纯函数——确认门所见 = 入库所得，消除「幕级清单 vs 章级清单」双清单漂移。否决「保留顶层清单并行」（漂移）与「纯名字清单」（新角色建卡失去定位输入）。
- **决策二：绑定存 outlines.character_ids JSON 文本列，仅章节点携带（用户指定「大纲表可控列」）**：完全对齐 key_plot_points 先例——schema refine 强约束（部/幕必须 null）、TEXT 存 JSON 数组、损坏抛可读错误、schema min(1)（null 或 ≥1，不出现空数组——解析后为空的章不绑、保持 null 未绑定语义）；patch 支持 set/clear。否决「独立 chapter_characters 关联表」（当前无按角色反查章的查询需求，列内 JSON 与 key_plot_points/character_ids（伏笔）同风格）。时序按用户指定：saveChapters 建章 → 地点入库 → 派生建卡（autoCreateCharacters）→ `bindChapterCasts`（resolveCharacterIds trim 全等复用 + setChapterCharacters 单事务回填）→ 伏笔——绑定前名单全部角色已入库、ID 必然存在，index 对齐免名字匹配。
- **决策三：正文生成按绑定收窄，未绑定旧章回退全库（兼容兜底）**：characterIds 非空且可解析 → 仅注入本章阵容 digest；null（17 版前旧章）或绑定角色全不在库 → 回退全库注入并 notify「🎭 本章未绑定登场角色（旧数据）」——旧数据行为逐字节不变，回退不静默。
- **结论**：SCHEMA_VERSION 16→17（ALTER 补列与版本同 immediate 事务、表缺失或列已存在只写版本标记；15→16 段改显式写 16 供链式直升）；shared 四 schema（outlineNode / outlineNodePatch / chapterPlan.chapters / outlineNodeEntry）+ OutlineStore 全链路 + setChapterCharacters；chapter-agent prompt 重写与派生视图；chapter-cast-intake.ts 确定性回填；write-chapter 按绑定过滤；query 契约与客户端（ViewCard 章行登场名单、章卡「🎭 登场人物」区块——未匹配兜底原 ID，用户选定展示）+ CLI renderView 同步。AC：typecheck 3 工程 / lint / 393 用例全过（净增 12：shared schema 5 + 迁移 1 + store 3 + chapter-cast-intake 3 + plan-act-chapters / write-chapter / cli-channel / OutlineNodeCard 用例扩展）。


## 2026-10-12 小说创作条件：绑定 novels、分阶段持久化、历史留空

背景：类型、受众与核心冲突仅在内存 state，重生成无法复用原创作意图。用户确认任务包并指示开始（设计见 `docs/superpowers/specs/2026-10-12-novel-creation-params-design.md`）。

采用 novels 的 genre TEXT / audience JSON 数组 / core_conflict JSON 对象三列，复用小说生命周期与部分更新；相比独立 1:1 参数表减少当前无收益的模块，相比单个 JSON 列支持分阶段直接保存。15→16 补列与版本号同一 immediate 事务提交、锁内复查防并发重复迁移；小说更新仅修改 patch 明确字段，防跨进程改名覆盖创作条件。历史 NULL 不推断回填，空受众数组不同于未采集。新建逐阶段保存，详情查询暴露原生值，重生成读取各非 null 条件；会话整体恢复及编辑界面为后续需求。

## 2026-10-12 章节正文重新生成：覆盖替换旧正文、弹框确认（两项决策经用户确认，设计规格 `docs/superpowers/specs/2026-10-12-chapter-regen-design.md`）

- **背景**：正文「一章一份」双层拒绝（write-chapter 前置校验 + document-store.saveChapterDocument）——用户对正文不满意时没有任何再生成手段，只能手工删库删文件。用户要求：添加重新生成按钮，流程与新生成完全一致（即完整的三段校验-修订闭环）。
- **决策一：旧正文覆盖替换（用户选定）**：新正文通过校验后，`replaceChapterDocument` 单事务「删旧 documents 行 → 插新行 → 回写章节点」、提交后清理旧正文文件；失败（校验抛错 / 中止 / 库故障）新文件回滚、旧正文行与文件零影响。文件名经既有 `-N` 冲突后缀在 `章名.md`↔`章名-2.md` 间交替，不无限增长。否决「归档历史版本」（需 schema 迁移 + 旧文件保留 + 版本浏览 UI，范围 2~3 倍——归档为后续独立需求，覆盖即失已在客户端弹框明示）。
- **决策二：弹框确认（用户选定）**：对齐 OutlineRegenDialog 先例——ChapterRegenDialog 模态警示「覆盖且不可恢复 + 完整三段校验流程 + 真实模型调用开销」，确认才发起会话。否决「两段式按钮」（与项目 destructive 操作弹框惯例不一致）与「直接执行」（误点即触发一次完整生成循环且不可逆覆盖）。
- **设计要点**：协议 / headless / shared 零改动——重新生成与首次生成是同一 write-chapter 会话，仅前置校验移除「已有正文」拒绝（检测到既有 document 即 `isRegen` 分流 notify「🔄 重新生成中（将覆盖现有正文）」与保存路径 save-or-replace）；旧文件清理置于库事务提交之后（路径相同——旧文件本就缺失的孤儿行——跳过防误删新文件；removeDocumentArtifact 幂等容忍缺失）；客户端进度区块与正文卡并存展示（进度区块渲染条件本不依赖「无正文」，复用既有 write-progress 收口零新增订阅）。
- **结论**：DocumentStore.replaceChapterDocument（与 saveChapterDocument 共用校验与插入助手）+ write-chapter isRegen 分流 + 客户端章卡「🔄 重新生成」入口（有正文时与生成入口互斥显示）+ ChapterRegenDialog 警示弹框（PreviewPane 复用 startWriteChapter 发起同一会话）。AC：typecheck 3 工程 / lint / 361 用例全过（净增 6：document-store 3 + write-chapter 集成 3，前置校验用例「已有正文拒绝」随行为翻转移除）；SSR 冒烟 12 条 transient 实跑过；真实端到端待用户复验。


## 2026-10-12 章节正文生成校验-修订闭环：3 轮上限保底保存、deepseek 校验、修订式重写（三项决策经用户确认，设计规格 `docs/superpowers/specs/2026-10-12-chapter-review-loop-design.md`）

- **背景**：write-chapter 是「单轮生成 → 落盘入库」直通链路，正文质量无事后把关——设定违背、伏笔未体现、文风不像、章内自相矛盾全靠人眼。用户提出：保存前新增校验 subagent（独立 LLM 调用、上下文不继承生成对话），三段校验（内容约束 / 文风相似度 ≥90 分合格 / 前后自洽）汇总为结构化整改报告，未达标按报告重新生成直至验收通过（校验也是 loop），客户端展示全流程进度。
- **决策一：循环 3 轮上限，仍未达标保存最后一版并警告（三选项中用户选定）**：最坏成本 3 生成 + 9 校验可控；产物优先——保底落盘（notify 附文风分与问题计数，建议人工复核或重新发起），校验是质量闸门而非硬门槛。否决「不达标即失败零残留」（产物优先）；否决「不设上限直到达标」（校验器持续挑刺时无限烧钱）。
- **决策二：校验模型 = Agent 会话模型 deepseek（三选项中用户选定）**：校验是结构化分析（输出 JSON 报告），deepseek 擅长且便宜；配独立写作模型时天然「他评」而非「自评」（自评偏松漏检）。连带收窄：write-chapter 会话从此始终要求 `DEEPSEEK_API_KEY`（「写作模型配置齐即免检」豁免退役）。否决「写作模型」（自评）；否决「新增 REVIEW_MODEL_* 三变量」（三模型分离当前阶段过度设计）。
- **决策三：修订式重写（用户选定）**：修订轮 prompt = 原始上下文 + 【上一版正文】+【整改报告】→ 按报告逐条修订（只修指出的问题，未涉及部分保持原样）。已达标部分稳定保留、token 更省、收敛快。否决「全量重写」（每轮成本高、可能修好旧问题又引入新问题、循环不易收敛）。
- **设计要点**：校验形态为三段各自独立单轮 generateObject（无 ReAct）——「上下文不继承」的直接落地，对齐 polish-character 单轮先例；「新 subagent」落为独立模块 `workflows/chapter-review.ts` + 独立模型注入；报告 schema 入 shared（review.ts）随新协议消息 `write-progress` 透传（report 附着在 revising/saving 事件上——实现期优化，校验模块只发三段段开始事件，避免重复事件）；文风段无启用样本时 skipped 零调用（与生成侧零注入对称）；③ 自洽段只喂正文全文（章内属性，不携外部上下文稀释注意力）；伏笔上下文与写作者同源（同一份 `buildChapterForeshadowContext().lines`，校验所见即写作者所见）；报告仅会话内透传不持久化；进度回调经 Options 注入（headless 收口映射协议消息，工作流不感知协议——对齐 polish-result 先例）。
- **结论**：`reviewChapter` / `isReportPassing` / `formatRevisionBlock` + write-chapter 3 轮循环（初稿 prompt 与现状逐字节一致，修订块置于写作要求前、末条要求替换为修订指令）+ headless onProgress 接线 + 客户端章卡进度区块（步骤条 + 报告摘要与可折叠问题列表）。AC：typecheck 3 工程 / lint / 355 用例全过（净增 21：shared 7 + chapter-review 8 + write-chapter 集成 5 + protocol 1）；SSR 冒烟 11 条 transient 实跑过；真实 LLM / 写作模型端到端待用户复验。


## 2026-10-11 章节正文生成伏笔上下文注入：登场仅卡片、回收登场章正文优先+概述兜底+预算护栏（两项决策经用户确认，设计规格 `docs/superpowers/specs/2026-10-11-foreshadow-prose-context-design.md`）

- **背景**：「设定与已生成内容一致性」讨论确认——write-chapter 写作上下文不含伏笔，伏笔只经「章节概述」间接传导：①注意度/埋线方式等结构化约束不进写作面；②用户编辑伏笔后，未写章节的正文会顺着冻结的旧概述跑偏（伏笔设定更新对「未来」不生效）；③回收章看不到登场章的实际呈现，回收易空泛或与登场细节矛盾。用户确认「伏笔进正文生成面」为必做：登场伏笔仅读取伏笔内容；回收伏笔还需读取登场章内容——读概述还是正文经讨论定夺。
- **决策一：回收伏笔的登场章上下文 = 正文优先 + 概述兜底 + 预算护栏（三选项中用户选定）**：
  1. **正文优先（选定）**：正文是读者实际读到的最终事实——表面行为的具体呈现（场景、措辞、物件）只存在于正文，概述只是规划骨架；且正文存文件系统、可被用户直接手改，文件才是事实源。回收要有呼应感必须看到具体细节
  2. 仅注入概述：体积最小、与前后章注入模式一致，但回收呼应感弱、存量老章与手改正文的具体细节丢失——否决
  3. 全文无预算：多条回收时 prompt 膨胀 6~9k+ 字符，写作模型是任意 OpenAI 兼容端点（可能为小上下文本地模型）有溢出风险——否决；落地为 `FORESHADOW_PROSE_BUDGET=8000` 字符护栏，按登场章全局章序逐条整条扣减（不截断——截断切掉关键细节）、超限整条降级概述并 notify
  4. LLM 预提取登场章相关片段（RAG 式）：非确定性、每条伏笔多一次调用，违背本项目确定性组上下文惯例——否决
- **决策二：登场章未生成/文件缺失降级该章概述、多步回收注入既往回收章概述**：概述兜底覆盖「跳章写作」「文件缺失」两类场景并标注「正文未生成」；既往回收章只注入**概述**（承接需要事实清单防重复揭底，呼应才需要具体细节——登场章正文已承担后者）；正文优先的事实源地位在此分层中保持一致。
- **设计要点**：纯 workflows 层 prompt 组装改动（`workflows/foreshadow-context.ts` 纯函数），零 schema 迁移、零契约变更、零前置校验（伏笔为可选增强，无绑定伏笔零注入零通知，对齐参考文风先例）；登场章按 ID 直查不过滤版本（归档旧版章照常解析名与正文，documents 全量含归档章正文）；同章种收只归回收组标「登场于本章」（实现期修正计划中「仍进登场组」的规格覆盖错误）；【本章伏笔】块插【下一章】后【参考文风】前（核心叙事上下文区，长样本文风仍留尾部——既有「不推远核心上下文」决策不动）；写作要求条件附加编号顺延。
- **结论**：`buildChapterForeshadowContext` + write-chapter 集成（Options 增 foreshadowStore 注入、块插入、notify「🔮 本章伏笔」统计与降级计数）。**连带效果：伏笔编辑自此对未写章节滚动生效**（正文生成现读库），「伏笔改了与内容不一致」的问题面从「已写正文 + 未来全部」收敛为「只剩已写正文」——衔接后续一致性机制讨论（影响面弹框/待同步标记/正文重写阶梯）。AC：typecheck 3 工程 / lint / 334 用例全过（净增 15）；真实 LLM 端到端待用户复验。



## 2026-10-10 参考文风：内容存数据库而非文件、每本小说独立、启用开关制（三项选型经用户确认，设计规格 `docs/superpowers/specs/2026-10-10-style-references-design.md`）

- **背景**：用户提出新增「参考文风」模块——结构界面维护一份或多份文本，生成正文时写作模型参考其文风；需新增数据库表，文本内容存库还是存文件由建议定夺。
- **决策一：内容直接进库（TEXT 列），不落文件、无 file_path**：`documents`「正文存文件、库留路径」的三个动机对文风均不成立——①正文是人类阅读产物（`<小说>/<部>/<章>.md` 层级目录供文件系统翻阅），文风是喂 LLM 的素材、经 UI 粘贴录入，无目录组织诉求；②正文体量随章节线性增长，文风小而恒定（每本通常 1~3 份、表单软上限 2 万字符）；③正文列表查询可懒加载（列表读元数据、按需读文件），文风每次生成正文都全量注入 prompt，无懒加载优化空间。而存文件需背负 documents 真实背过的全套生命周期复杂度（rename 联动迁移 updateFilePaths、deleteNovel 逐文件清理、文件缺失读取兜底）——存库后全部消解：备份即单个 novel.db、删除一条级联 SQL、改名零联动。「文档 ID 链接」的适用场景（大体量 + 人类可读产物 + 文件系统直接编辑）一条不占。
- **决策二：每本小说独立（novel_id 外键），不做全局文风库**：与角色/地点/伏笔一致——结构树按小说展示、级联删除、查询契约对齐；跨书复用走复制粘贴（每份才几千字），全局库的多对多关联与去重机制违背首版 YAGNI。
- **决策三：启用开关制（enabled 默认 1），生成正文只注入启用条目**：并存多份风格时切换试用不必反复删建；一个 boolean 列的成本换真实灵活性。注入点在 prompt 尾部（【下一章】块后、写作要求前）——长样本不推远核心上下文且紧邻风格指令；写作要求附「模仿叙事语言/句式节奏/描写风格，不抄袭具体情节与专有名词」防样本情节渗入正文；无启用文风零注入零通知（行为与无此功能逐字节一致，文风为可选增强不设前置校验）。
- **结论**：SCHEMA_VERSION 15（纯新增 style_references 表，CREATE IF NOT EXISTS 幂等）；StyleReferenceStore CRUD + query CLI 三命令（add-style / update-style / delete-style，无 LLM 会话——文风维护是纯文本操作）+ novelDetail.styleReferences 契约；结构树「🖋️ 文风」组（大纲之后）+ StyleEditForm（新建/编辑共用，编辑态附删除 confirm）；编辑面软上限 2 万字符为 UI 校验、schema 不设 max（历史数据与大样本合法输入不被拒）。AC：typecheck 3 工程 / lint / 319 用例全过（净增 12）；真实库副本迁移 13→15 实跑无损（八表行数逐一一致），真实库未动；真实 LLM 端到端待用户复验。

## 2026-10-09 伏笔回收规划：幕→章两级自动绑定 + 手动编辑，全局章序支撑顺序不变量（两途径方案由用户提出并指示执行，设计规格 `docs/superpowers/specs/2026-10-09-foreshadow-recovery-planning-design.md`）

- **背景**：伏笔「登场」链路闭环（大纲挂幕→章节规划绑定→手动编辑修正），但「回收」（recoverChapterIds）无任何写入来源——回收状态流转、章卡回收徽标空转。用户给出两途径方案并指示执行：①手动编辑回收章（须在登场章之后）；②大纲/章节规划时同步规划回收，顺序为幕→章（大纲挂回收幕→该幕章节规划时绑具体回收章）。
- **决策一：全局章节序 = 部 sort → 幕 sort → 章 sort 深度优先组合（用户指出的方向）**：outlines.sort 仅同父级内唯一（幕内章序），跨幕比较须组合部/幕序。agent 侧 `buildChapterOrder`（intake 校验）与客户端 `chapter-order.ts`（表单过滤）各实现一份约 15 行纯函数——shared 保持纯 zod 层不放运行时函数，两份实现各自贴合输入类型。
- **决策二：回收链路对齐登场的「先幕后章」节奏**：大纲 Agent 伏笔清单附可选 recoverActName（入参层 refine 强校验真实幕名且在埋设幕之后——模型给错即拒绝重试）；入库时幕名漂移**不阻塞伏笔**（回收幕留空并警告——登场幕匹配是硬条件、回收幕只是规划信息，降级语义）；该幕被章节规划时编排查 `listUnrecoveredByAct`（回收幕=本幕且回收章空）带序号与登场章信息回传，LLM 输出回收绑定指令，确定性绑定（同伏笔多条合并=多步回收）。幕已有章节（不能再规划）或 LLM 未绑的场景由手动编辑兜底。
- **决策三：顺序不变量双侧守护**：回收绑定——登场未绑（无从校验）或回收章不晚于登场章（全局序）逐条跳过警告；登场绑定（既有行为）增**对称校验**——伏笔已有回收章时新登场章须早于最早回收章；手动编辑——登场未绑时回收章禁用、切换登场章自动剔除失效已选、清空登场联动清空回收章。
- **决策四：编辑面回收章语义从「保留现值」改为「随编辑覆盖/清空」**：2026-10-07 伏笔编辑落地时回收章不入 patch（回收流未建，防误清）；本需求编辑面开放回收章多选，未勾选=清空全部回收章（与 characterIds 空选清空对齐），回收幕不受编辑影响（由大纲链写入，手动编辑回收幕另起需求）。
- **结论**：SCHEMA_VERSION 14（foreshadows 增 recover_act_node_id）；回收状态仍手动维护（绑定回收章后不自动流转 recoveryStatus——「全部回收点已写完」无判定依据）。AC：typecheck / lint / 302 用例全过（净增 13）；真实库副本迁移无损；真实 LLM 端到端待用户复验。

## 2026-10-09 大纲与章节规划地点自动入库：确定性入库 + schema 演进（三项选型经用户确认，设计规格 `docs/superpowers/specs/2026-10-09-location-auto-intake-design.md`）

- **背景**：locations 表自 2026-09-23 数据层先行落地后无任何读写方（query CLI 不读、客户端不展示、创作流不写）。需求对齐角色/伏笔的「清单连带确认 → 确认后自动执行」模式接入地点采集。关键张力：现有 locationSchema 是地图坐标导向（x/y/layer 必填），而大纲/规划能提炼的地点信息本质是「名字+一句话定位」。
- **决策一：接入范围 = 大纲（新建+重生成）+ 单幕章节规划三处，正文生成不接**：「生成章节内容」经确认解读为章节规划——有确认门，地点清单可随大纲/规划连带确认后再入库，模式与角色/伏笔完全对齐；正文生成会话是写作模型单轮、无确认门，地点无法连带确认就静默入库，破坏「写库前透明可拦截」的确认门体系。
- **决策二：确定性入库 + schema 演进（x/y/layer 放宽可选 + 新增 description，SCHEMA_VERSION 12→13），而非 LLM 填全卡**：
  1. **确定性入库 + schema 演进（选定）**：清单只带「名字+定位」，确认后确定性代码直建（零 LLM 调用）；description 落的是大纲提炼的真实信息；地图向字段放宽可选后留给未来地图功能用户编辑——不产生编造数据
  2. LLM 填全卡（镜像 autoCreateCharacters）：能填 x/y/layer/population，但坐标是依世界观推定的假精确值——今天无任何消费方（无地图 UI、写作上下文不读坐标），且每地点多一轮 LLM 调用，违背 YAGNI
  3. 仅入名字不改 schema（x=0/y=0/layer=占位）：实现最小但落脏数据，被否
- **决策三：客户端含最小展示**（结构树「📍 地点」组 + 右栏只读卡 + query 契约），不做编辑表单：否则自动入库结果用户不可见不可验证；地点编辑（对齐 ForeshadowEditForm 模式）另起需求。
- **执行语义补充（设计定稿）**：地点入库块置于角色自动入库**之前**——毫秒级同步代码先行完成即「与角色同批次」（用户诉求「和角色同步进行」），不做 Promise.all 并发（两路 notify 在协议流/终端交错，并发收益为零）；重生成时地点**只增不改**——兜底 diff 对全库地点名，旧版入库地点保留不动。
- **结论**：shared schema 演进 + newLocationSchema + 视图/查询契约；12→13 locations 表重建迁移（放宽 NOT NULL 按官方重建流程，守卫 7~12 含表缺失兜底）；location-intake.ts 确定性入库模块；两 Agent list_locations 工具与清单入参；三编排接入；客户端最小展示。AC：typecheck 3 工程 / lint / 289 用例全过（净增 21）；真实库副本迁移 12→13 无损；真实 LLM 端到端待用户复验。

## 2026-10-07 结构树伏笔组与预览编辑：patch 编辑语义与按幕分组（两项范围决策经用户确认，SDD 计划 `docs/superpowers/plans/2026-10-07-foreshadow-tree-edit.md`）

- **背景**：伏笔已入库并可在章卡按章查看，但结构树无伏笔入口——无法按幕总览、无法点击单条查看与修改；`ForeshadowStore.updateForeshadow` 的 patch 能力（含服务角色同小说校验）闲置。本需求补齐结构树伏笔组 + 右栏预览编辑；两项关键取舍落盘。
- **决策一：编辑走「完整卡转 patch」而非全量覆盖——可选空=null 清空、回收章不入 patch 保留现值**：`updateForeshadow` 的 patch 语义是 undefined=不动 / null=清空 / 值=覆盖，与角色编辑的全量覆盖（updateCharacter 整卡替换）天然不同——若表单可选项空值映射为 undefined，用户「清空埋线方式」会被静默忽略（不动旧值）；映射为 null 才真实清空。`recoverChapterIds` 不入 patch：回收章绑定属写作期回收流（多步回收、状态流转），编辑面暂不暴露，保留现值避免表单无意清掉回收记录。登场章（appearChapterId）与服务角色（characterIds）纳入编辑——绑定修正正是伏笔编辑的主要用途（错绑唯一的人工修正手段）。
- **决策二：结构树伏笔按埋设幕两级分组，幕分组行不触发选中、stale 归档旧幕归「未绑幕」组**：按幕分组（actNodeId）对齐数据的天然归属（大纲阶段挂幕入库），幕顺序对齐当前大纲树——导航上下文清晰；幕分组行仅作收起控制不触发选中，避免伏笔组内点击跳转到大纲预览的语义混乱。actNodeId 为 null **或不在当前版本 act 列表**（归档旧幕）的伏笔统一归「未绑幕」组——归档旧幕的伏笔若静默不可见，库中有数据树上看不到（用户无从知晓）；归组可见 + 预览兜底显示原 ID，历史数据可追溯。
- **结论**：shared `foreshadowEntry` 增 `actNodeId: string | null`；query CLI `update-foreshadow <novelId> <foreshadowId> <伏笔JSON>`（`toForeshadowPatch` 转换，返回更新后条目）；Electron `library:updateForeshadow` IPC 链；StructureTreePanel 伏笔组（两级收起）+ ForeshadowPreview 只读卡 + ForeshadowEditForm（全字段含登场章下拉与服务角色多选）。AC：typecheck 3 工程 / lint / 268 用例全过（净增 3）；GUI（树分组、预览、编辑流）待用户人工验收。

## 2026-10-07 章节预览伏笔展示：登场 + 回收两组都展示、幕卡不动（范围决策经用户确认，设计规格 `docs/superpowers/specs/2026-10-07-chapter-foreshadow-preview-design.md`）

- **背景**：伏笔已随大纲与章节规划确定性入库（登场章经 `appearChapterId` 绑定），但 `novelDetail` 查询契约不含伏笔、客户端零展示——用户预览章节时无从看到「本章埋了什么、回收了什么」，正文写作与核对无从对齐。两项范围决策经用户确认，无新架构取舍，仅落盘范围界定。
- **决策一：「本章涉及」= 登场 + 回收都展示，而非只展示登场**：登场（`appearChapterId` 命中本章）与回收（`recoverChapterIds` 含本章）分别带「登场 / 回收」徽标，同一伏笔可两组各显示一条；回收数据当前无写入来源（回收流转 UI 为后续需求），过滤分支零成本预留，回收流落地后立即生效。
- **决策二：幕卡不动，仅章卡展示**：幕下未绑登场章的伏笔不在本次范围——章卡才是写作期核对伏笔的落点；伏笔增删 / 编辑 / 回收流转管理 UI 亦不做。
- **结论**：shared `novelDetail.foreshadows`（`foreshadowSchema.extend({ id })`）+ query CLI `buildNovelDetail` 读 ForeshadowStore 全量行（按入库顺序）+ 客户端 `toChapterForeshadows` 过滤解析（服务角色 ID → 名字，未匹配兜底原 ID）与章卡「伏笔」区块渲染（`[登场/回收] 表面行为 ⇢ 隐藏真相（注意度 N，服务：名字…）`，无则不渲染）。AC：typecheck 3 工程 / lint / 265 用例全过（净增 3）；GUI 观感待用户人工验收。

## 2026-10-06 大纲与章节规划伏笔接入：act 列精确圈定回传 + 确定性入库（任务包经用户确认，SDD 计划 `docs/superpowers/plans/2026-10-06-foreshadow-intake.md`）

- **背景**：foreshadows 表自 2026-09-24 起已有完整 CRUD（数据层先行，采集为后续需求）。创作流伏笔采集缺口：大纲与章节规划时模型安排的伏笔只存在于大纲 / 概述文本里，库中无行——写作期正文无从按伏笔表面行为落笔，回收状态流转无从启动。需求：大纲 Agent `save_outline` 与章节 Agent `save_chapters` 附「未创建伏笔清单」随确认门连带确认，确认入库后自动入库；章节规划另把本幕未绑伏笔回传 LLM 绑定登场章。四项关键取舍一并落盘。
- **决策一：foreshadows 增 `act_node_id` 列按幕精确圈定回传，而非全书伏笔全量回传**：
  1. **act 列精确圈定（选定，方案经用户确认）**：伏笔在大纲阶段挂幕（章尚不存在）→ 章节规划时 `listUnboundByAct(novelId, actNodeId)` 只回传本幕「未绑登场章」的伏笔——上下文体积恒定可控，模型只面对与本幕直接相关的伏笔，绑定指令（index + chapterName）引用的是带序号紧凑清单，序号漂移面小
  2. 全量回传（`listForeshadows` 免新列免新查询）：随伏笔积累 prompt 线性膨胀，且模型要自行从全量中筛出本幕相关者——弱模型误绑跨幕伏笔的漂移面更大
  - **迁移形态**：SCHEMA_VERSION 11→12，`ALTER TABLE foreshadows ADD COLUMN act_node_id TEXT`——加可空裸列无行级改写，SQLite 最安全迁移形态（同 4→5 先例）；守卫 `version >= 8 && version <= 11`——foreshadows 表自 v8 起已存在（不同于 10→11 时 documents 尚不存在），8~11 的库都持无此列的旧表形态，CREATE TABLE IF NOT EXISTS 对其不生效，守卫须覆盖整段而非仅 `version === 11`
- **决策二：幕名 / 章名 / 服务角色名 / 绑定序号未匹配逐条跳过并 notify，而非中止整批或静默丢弃**：伏笔清单是随大纲 / 规划连带确认的次要产物（确认的主对象是大纲与章节），一条伏笔的幕名拼错不应连累其余条目；跳过经 notify `⚠️ 伏笔跳过…` 透明可见，用户可后续手动补录（完整 CRUD 已有）。服务角色**全部**无法解析才跳过该条、部分未解析仅剔除未解析者并警告——`characterIds` 是服务语义而非身份必需，无角色的伏笔仍成立。与角色链路的差异：角色自动创建是 LLM Agent，被守卫拒绝后可自行修正重试；伏笔入库是确定性代码无处重试——跳过即终态，故透明 notify 是必须的兜底。
- **决策三：regen 保留旧伏笔不清理，而非随旧版归档或删除**：大纲重生成只降级大纲节点（行保留），伏笔行不动——旧伏笔 `act_node_id` 指向已降级的旧幕节点，悬挂但无害：`listUnboundByAct` 按当前 act 查询天然不回传旧版伏笔，旧伏笔不再进入新版大纲的规划上下文。删除则永久丢失用户已确认过的伏笔数据；「重新挂接到新版同名幕」则要代码猜幕对应关系，漂移面大。同「正文行与归档章关联留存」先例——历史回溯不吃 schema 变更；若需把旧伏笔重新挂到新版幕，另起需求。
- **决策四：伏笔入库走确定性代码（`foreshadow-intake.ts`），而非 LLM Agent（与角色链路的差异论证）**：角色自动创建需要「依据世界观与大纲为每个新角色扩写 13 字段完整角色卡」——生成任务必须 LLM（ReAct + save_character 逐卡入库，守卫拒绝后模型自行修正重试）；伏笔清单本身已是结构化数据（表面行为 / 隐藏真相 / 注意度都由大纲或章节 Agent 产出且在确认门过目过），入库只需「幕名 / 章名 → 节点 ID、角色名 → 角色 ID」的查表映射——确定性代码零 LLM 调用、零漂移、零 token 成本，错误处理收敛为「跳过 + notify」而非「重试循环」。挂幕而非挂章（大纲阶段章尚不存在），登场章由章节规划阶段的绑定指令补齐——两阶段各取当时已存在的最小锚点。
- **结论**：SCHEMA_VERSION 12 + `listUnboundByAct` + shared 伏笔清单三变体与绑定 schema + `workflows/foreshadow-intake.ts`（resolveCharacterIds / plantOutlineForeshadows / plantChapterForeshadows）+ 两 Agent 结构化入参（save_outline 附 newForeshadows 挂幕；save_chapters 附 newForeshadows 登场章 + foreshadowBindings 序号绑定）+ 两编排确认入库后（角色入库之后）确定性入库 + CLI / 客户端确认视图伏笔与绑定区块渲染。AC：typecheck 3 工程 / lint / 262 用例全过（净增 19）；真实库副本 11→12 迁移实跑数据无损；真实 LLM 端到端待用户复验（大纲确认门观察伏笔清单展示与确认后入库、章节规划观察未绑伏笔回传与绑定生效）。

## 2026-10-06 章节规划新增角色梳理与自动入库（任务包经用户确认，SDD 计划 `docs/superpowers/plans/2026-10-06-chapter-plan-new-characters.md`）

- **背景**：单幕章节规划（`planActChapters`）时模型同样会引入角色库中没有的新角色（本幕登场的反派、配角等），此前只存在于章节概述文本里——写正文时没有角色卡可依；且章节 Agent 上下文不读角色库，概述无法点名已有角色、易虚构重复。需求：`save_chapters` 附新增角色清单随规划进确认门，确认后自动填充角色卡入库（复用上一需求的 `autoCreateCharacters` / `filterNewCharacters`），概述尽量点名出场角色。三个关键取舍一并落盘。
- **决策一：新增角色清单取顶层 newCharacters（名字 + 一句话定位、定位注明登场章，如「第3章登场·血宗打手」），而非按章归属（每章嵌自己的新角色子清单）**：
  1. **顶层清单（选定，方案经用户确认）**：与大纲 `newCharacters` 形态完全一致——`newCharacterSchema` / 确认门连带确认 / 兜底 diff / 自动创建全链路零新增概念直接复用；角色常跨章登场，顶层归属天然支持定位里注明登场章；确认视图一个区块、双端渲染一处追加
  2. 按章归属（`chapters[i].newCharacters`）：登场信息结构化更强，但同一角色跨两章时须模型自行合并去重——schema 与兜底 diff 都要按章聚合，「同一角色在两章各列一次」的漂移面更大；确认视图逐章散列，用户难以一眼看全本次共引入几人
- **决策二：世界观已确认作为前置校验（对齐 regen-outline / write-chapter），而非确认入库后再判断或静默跳过**：自动创建新角色需要世界观依据（`autoCreateCharacters` 入参必带 worldview）；regen-outline / write-chapter 均有「世界观已确认」前置校验先例。若把校验放在确认入库之后：章节已入库无法回退（同一幕重复规划被唯一索引拒绝、修订流未建），才告知「世界观缺失无法自动创建角色」，用户陷入进退两难的中间态；若静默跳过自动创建：与确认门里「确认后自动入库」的展示文案相悖，属静默失败。前置拒绝（可读错误 → fatal error）成本最低——世界观在创作流里必先于大纲确认，正常数据不会命中该校验，只有旧数据 / 异常库才会。
- **决策三：`autoCreateCharacters` 增可选 `extraContext` 附加上下文，而非把章节文本拼进伪 Outline 或不给章级素材**：
  1. **可选参数（选定）**：章节规划的「章名 + 概述」是新角色在本幕言行的一手素材，作为附加上下文块追加进 prompt 可显著提升填卡质量；纯增量可选参数，createNovel / regenerateOutline 两个既有调用方零改动
  2. 把章节文本拼进伪 Outline 的 act.summary：污染大纲语义——summary 会作为角色卡的登场情节上下文，却不再是真实的大纲原文，且拼接格式受 Outline schema 字段约束
  3. 不给章级素材：填卡只剩部/幕两级梗概，新角色「在哪一章做什么」无从依据，清单定位里注明登场章的信息被浪费
- **设计要点**：
  - **伪 Outline 仅部/幕两级**：自动创建上下文按「目标部 → 目标幕」组装（结构天然匹配 `Outline`），章不进 Outline——`chapterPlanSchema` 产物与 outlines 章节点结构不变
  - **章级素材经 `extraContext` 注入**：`本次规划的章节列表：\n第i章 <章名>：<概述>` 逐行（取自确认后的规划本体），与世界观 / 伪 Outline / 已有角色行并列进 prompt
  - **注入可替换**：`PlanActChaptersOptions` 增 `worldviewStore` / `characterStore`（缺省默认 SQLite store，测试替换），`planChapters` 增第三参 `{ novelId, characterStore }`
- **结论**：shared `chapterPlanViewSchema` 可选 `newCharacters` + 章节 Agent `list_characters` 工具与 `saveChaptersInputSchema` 结构化入参（产物 `ChapterPlanSubmission = plan + newCharacters`）+ planActChapters 世界观前置校验与确认入库后兜底 diff 自动创建 + `autoCreateCharacters` extraContext + CLI renderView / 客户端 ViewCard 清单渲染。AC：typecheck 3 工程 / lint / 243 用例全过（净增 10）；真实 LLM 端到端待用户复验（客户端幕卡「规划本幕章节」走确认门，观察清单展示、概述点名角色、确认后自动入库）。

## 2026-10-06 大纲新增角色结构化输出与自动入库（任务包经用户确认，SDD 计划 `docs/superpowers/plans/2026-10-06-outline-new-characters.md`）

- **背景**：大纲生成时模型会引入角色库中不存在的新角色（反派、配角等），此前只存在于大纲文本里——写作期按幕规划章节、写正文时这些角色没有角色卡（内核 / 背景 / 创作目的等结构化设定），世界观约束与人物弧光无从落地。需求：大纲 Agent 生成大纲时把「新增角色」结构化输出，用户确认大纲后自动填充角色卡入库。三个关键机制各有取舍，一并落盘。
- **决策一：角色自动创建走 ReAct 循环 + save_character 终态工具（方案 A），而非编排层 for 循环 generateObject / 单次 generateObject 数组生成**：
  1. **ReAct + 终态工具逐卡入库（选定）**：复用既有 `runReactAgent` 基建（isDone 判定 + maxSteps 兜底 + 续跑机制），`save_character` 的 inputSchema 即角色卡 schema——每张卡 SDK 先校验再执行、天然过 zod；工具 execute 内做三重守卫（清单外角色拒绝 / 重复保存拒绝 / 库内同名拒绝），模型被拒后可自行修正重试（集成测试覆盖「守卫拒绝后修正」路径），编排层无需为失败卡写重试逻辑
  2. 编排层 `for(清单) generateObject` 逐卡生成：每次调用独立无上下文，一张失败编排层要自管重试与部分成功回滚；且绕开工具守卫，模型填错名字（漂移）只能整卡作废重跑
  3. 单次 `generateObject` 生成全部角色卡的数组：schema 校验全有或全无——一个角色不合规整批拒绝重跑，token 成本随清单长度线性放大且无增量入库
- **决策二：新增角色清单进 save_outline 确认门连带确认（写库前透明、用户可拦截）**：`saveOutlineInputSchemaFor` 把 `newCharacters`（newCharacterSchema：名字 + 一句话定位，清单内名字不得重复）并入 save_outline 结构化入参，确认视图（CLI renderView 与客户端 ViewCard）以「✨ 本次大纲新增角色（确认后自动入库）」连带展示——角色入库与大纲共用同一道确认门：清单错了用户在大纲确认时反馈修订即可（反馈进 Agent 修订循环，天然收敛），拒绝大纲即连带拦截全部角色入库；若清单不进确认门（确认大纲后静默建角色），用户对「将写入库的新角色」没有否决机会，与项目「写库前经用户确认」的确认门体系相悖。
- **决策三：编排层 `filterNewCharacters` 兜底 diff，不信任模型的「新增」判定**：入库前以库内角色名（trim 全等）剔除清单中已有项、清单内同名去重保留首个、空名剔除——模型可能把库内角色误列入清单（prompt 与 list_characters 工具已约束，但弱模型仍会漂移），自动创建是无人值守写库（无确认门），最后一道防线必须在代码层而非提示词层；守卫三重兜底（filterNewCharacters 前置剔除 + save_character execute 内库内同名拒绝）后，重复入库在结构上不可能。空清单跳过自动创建（零 LLM 调用）。
- **设计要点**：
  - **清单只收名字 + 一句话定位**：完整角色卡字段（13 项）交由自动创建 Agent 依据世界观与大纲填充——大纲阶段让模型同时编 3+ 张完整角色卡会稀释大纲质量，最小信息随大纲确认、扩写后置
  - **maxSteps = 4 + 清单数 × 2**：每卡一轮生成 + 一轮修正余量，耗尽未完成抛可读错误（已入库卡保留，不回滚——增量入库对齐创作流角色段惯例）
  - **isDone 按数量判定**（savedNames.size >= 清单长度）：save_character 是「多终态工具」（每卡一次），hasToolCall 会在首次调用即停止，故沿用 character/outline 的 isDone 模式而非 stopTool
  - **独立导出供复用**：`autoCreateCharacters` / `filterNewCharacters` 不绑定 createNovel——后续章节规划 / 正文生成等写作期工作流引入新角色时可直接复用
- **结论**：shared `newCharacterSchema` + 大纲 Agent `list_characters` 工具与 save_outline 结构化入参 + `agents/auto-character-agent.ts`（autoCreateCharacters / filterNewCharacters）+ createNovel / regenerateOutline 确认入库后兜底 diff 自动创建 + CLI renderView / 客户端 ViewCard 清单渲染。AC：typecheck 3 工程 / lint / 232 用例全过（净增 14）；真实 LLM 端到端待用户复验（`bun run dev` 走到大纲确认门观察清单展示、确认后查 characters 表）。

## 2026-10-02 客户端暗黑模式：nativeTheme.themeSource + prefers-color-scheme 媒体查询（renderer 零主题 JS）

- **背景**：客户端界面需要暗黑模式——默认跟随系统，设置弹窗可手动三选（跟随系统 / 浅色 / 深色），主题机制在三个方案间对比选型。
- **备选方案**：
  1. **main 侧 `nativeTheme.themeSource` + CSS `prefers-color-scheme` 媒体查询**（选定）：设置枚举 system / light / dark 与 Electron 原生主题三态一一对应（零转换），themeSource 一变 renderer 的媒体查询即时重算——renderer 零主题 JS、零 IPC、零双源状态合并；浅色值抽为 31 个语义 CSS 变量（`:root` 基准），暗色块只覆盖变量值
  2. renderer data-theme 属性方案（JS 读设置挂根节点属性 + matchMedia 监听系统切换）：启动时属性未及挂载会白闪；「手动设置」与「跟随系统」两个来源需 matchMedia + IPC 双套逻辑合并——否决
  3. 媒体查询内逐条硬覆盖（不抽变量，暗色块按选择器逐条重写颜色）：同一颜色维护两处，每加一条规则都要双份色值、行数翻倍——否决
- **设计要点**：
  - **强调填充与文字色暗色分化**：`--accent-emphasis` / `--danger-emphasis` / `--danger-hover` / `--fg-on-emphasis` 四变量——暗色下按钮填充蓝/红与文字蓝/红深浅分家（填充 `#1f6feb` vs 文字 `#4493f8`），白字对比度保住；浅色下四者同值异名（填充与文字同色）纯为暗色分化预留伏笔，浅色观感零回归
  - **窗口底色随主题**：`backgroundColor` 取 `nativeTheme.shouldUseDarkColors`（值与 `--bg-app` 一致），`updated` 监听在「跟随系统」下运行中切系统主题时同步底色——防启动白闪与切题闪帧
  - **`NOVEL_CLIENT_THEME=system|light|dark` 诊断钩子**：settings.json 在 userData 目录、无法按次启动覆盖，无头双主题截图验证需要显式主题注入；applyTheme 内仅显式设置（合法三值）时生效，否则回落设置文件——与既有 `NOVEL_CLIENT_*` 诊断家族同款语义
- **实现期发现与裁定（对后续开发有约束力）**：**renderer 不得运行时 import `electron/settings`**——该模块基于 `node:fs`，被浏览器化的 renderer 加载即崩（node:fs 无浏览器实现）；类型需求一律经 `import type` 引用（编译期擦除），运行时取值走 preload IPC。
- **结论**：settings.theme（normalizeTheme 非法值归 system）+ main 侧 applyTheme（启动与 settings:save 后各调一次，主题保存即生效；模型配置仍为下一次会话生效，两者语义不同）+ styles.css 31 变量化 + 暗色媒体查询（GitHub Primer Dark 基准）+ SettingsDialog「外观」分组。AC：typecheck / lint / 218 用例全过（settings 新增 3 用例）；`NOVEL_CLIENT_THEME=light/dark` 无头截图目测通过，系统运行中切换等交互列入人工验收。

## 2026-09-28 模型配置迁移客户端：VS Code 式明文 JSON + 主进程经环境变量注入（用户决策）

- **背景**：模型 Key / 模型名原经根 `.env` 配置，对只用客户端的用户不友好（要手工编辑文件）。讨论中给出三条路线：明文 JSON（VS Code 水位）、`safeStorage`/OS 密钥链加密（Windows DPAPI 等）、自制加密——用户选定明文 JSON；同时确认隐藏原生菜单暂不做。
- **备选方案**：
  1. **userData/settings.json 明文 + 设置弹窗 + childEnv 三级优先级注入（选定）**：与 `.env` 同安全水位（明文、本机、git 不可见——userData 不在仓库内），换来零依赖与人类可直接编辑；`.env` 与继承环境变量保留为兜底来源，老用户无感
  2. safeStorage 加密密文存 settings.json：本机离线文件更安全，但 WSL2（本项目实际运行环境）下桌面密钥服务常不可用，需明文回退双路径，复杂度不成比例——用户明确选择不做，未来可无痛升级（settings.ts 收口读写，单点替换）
  3. agent 直接读配置文件 / argv 传参 / 协议下发：分别破坏进程边界、比 env 更易泄露（/proc 全局可见 argv）、过度设计——均放弃
- **设计要点**：
  - **agent 侧零改动**：配置解析收在 main 进程 `childEnv()`（`resolveModelEnv`：设置 > `.env` > 继承环境变量，逐字段下探、空串视为未配置并删除键），注入后子进程照旧读 `process.env`——providers 的回落与默认值逻辑原样生效
  - **`electron/settings.ts` 不 import electron**（路径由调用方传入），保持 bun:test 可测；client 首批单测（此前 client 无测试），根 test 脚本纳入 apps/client
  - **Key 在弹窗中用 password 输入**防旁窥；设置保存即刻落盘、对子进程在下一次 spawn 生效（会话均短生命周期，无热更新问题）
  - 写作模型三项留空 = 回落 Agent 模型的语义在弹窗内明示
- **结论**：settings.ts + settings:get/save IPC + SettingsDialog（⚙️ 入口）+ childEnv 注入；GUI 弹窗交互待人工验收。

## 2026-09-28 写作模型未配置回落 Agent 会话模型（用户决策，修订「未配置抛错」）

- **背景**：「写作模型 provider」决策原定未配置 `WRITING_MODEL_*` 时抛可读错误——对已配齐两项模型（Agent + 写作）的用户合理，但意味着每个用户必须再申请一个第三方服务 Key 才能用正文生成，抬高门槛。用户要求：未配置时回落主 Agent 模型（DeepSeek）。
- **取舍**：
  1. **整体回落（选定）**：任一变量缺失/空串即回落 `deepseek.ts` 的 `model` 实例——与世界观/大纲等工作流共用同一 DeepSeek 会话模型，正文生成开箱即用；部分配置不拼凑（半配置会在请求期产生 401 类难排查错误，宁可整体回落语义清晰）
  2. 按「部分配置的变量拼凑」继续走 openai-compatible（如仅 baseURL 缺失时默认官方端点）：猜测行为不可预期，放弃
- **联动**：headless 启动 Key 检查由「write-chapter 一律免检」改为「仅 write-chapter 且 `isWritingModelConfigured()` 为真免检」——回落路径经 DeepSeek，Key 必需；`getWritingModel` 返回类型保持 `LanguageModelV4`（deepseek chat model 同为 V4 实现），工作流零改动。
- **结论**：`getWritingModel` 回落 + `isWritingModelConfigured` 导出 + headless 检查联动；`.env.example` 与各级文档同步。原「未配置抛可读错误」行为废止。

## 2026-09-28 正文顶层文件夹改「小说名-<创作 ID 前 8 位>」（用户决策，规避同名小说共享文件夹）

- **背景**：上一条「正文存储改文件系统」按纯小说名组织顶层文件夹，存在边界——两本同名小说共享同一文件夹，删除/改名须逐文件操作避免波及对方。用户给出方案：小说名 + ID 组合命名顶层文件夹，从根上规避共享。
- **备选方案**：
  1. **全量 ID 后缀（36 字符）**：构造性唯一，但文件夹名过长难读；
  2. **创作 ID 前 8 位（选定）**：UUIDv7 前 8 位为时间戳高位（同值窗口约数百毫秒），同名且同窗口才可能共享——个人书库量级实际不可能；即便发生，既有逐文件删除/改名与章名 -N 冲突后缀仍兜底，行为退化为旧方案而无数据风险；
  3. 纯 ID 不带名：唯一且改名零迁移，但用户要的「按小说名浏览」不可见，放弃。
- **联动**：rename 迁移只更新名段（ID 段稳定不变）；writeChapter / 10→11 迁移 / renameNovel 三处路径构造统一；真实库存量正文一次性迁移至新格式文件夹（`万流归序-01a0ce94/…`），旧空目录清理。

## 2026-09-28 正文存储改文件系统：小说名/部/章层级落盘 + 库内只留 file_path（而非 content 进库）

- **背景**：上一条决策把正文整文存进 documents.content（本地 SQLite），用户指出不妥——正文是长文本（数千字/章），进库既撑大 SQLite 又不便直接阅读编辑。要求改为文件保存（客户端文件夹内、按「小说名-部-章节」层级组织），数据库经大纲章节点 document_id 与文件绑定。
- **备选方案**：
  1. **文件存层级目录 + documents 只留元数据（选定）**：`output/<小说名>/<部名>/<章名>.md`，人类在文件管理器里可直接读改；库内 file_path（相对 output 根）+ 字数；document_id → documents 行 → file_path 三级绑定，绑定点仍是章节点（保持既有协议/查询契约形态）
  2. 文件名用 documentId（稳定、免清理），但用户要的「小说名-部-章节」层级不可见，浏览体验差
  3. 全部派生路径（读时按现名重算，不存 file_path）：改名零联动，但历史版本/冲突后缀无法重现，文件挪动即失联
- **设计要点**：
  - **路径构造与冲突**：`sanitizePathSegment`（非法字符归一、压缩空白、去尾部点空格、截断 80、空名回退 ID 片段）+ 同名冲突 `-2…-N` 后缀（大纲重生成后新树复用章名、或孤儿残留时不覆盖既有文件）
  - **先文件后库**：writeChapter 生成后先落文件、再单事务登记元数据并绑定章节点；库失败回滚删除文件，不留孤儿；反向（库成功文件丢）由查询读文件 null 占位兜底
  - **生命周期联动**：deleteNovel 逐文件清理（不删整目录——同名小说共享文件夹边界）；小说 rename 逐文件迁移到新名首段 + updateFilePaths 单事务同步（同名小说共享文件夹时逐文件移动天然正确）；大纲重生成只降级归档章节点，正文行与文件保留
  - **10→11 迁移无损**：存量 content 行在迁移内联落文件（SQL join 取小说/部/章名 + 同款 sanitize，state 层不反向依赖 output 层故本地复制小函数），file_path 回填后 DROP content 列；守卫 version===10，v10 以下库经 CREATE IF NOT EXISTS 直接得 11 形态
  - **同名小说边界**：两本同名小说共享同一层级文件夹（按名组织固有的边界），冲突后缀保证文件不互覆；删除/改名按 documents 登记路径逐文件操作，互不波及
- **结论**：document-writer.ts（output 层）+ documents 元数据化（SCHEMA_VERSION 11）+ writeChapter 落盘联动 + query get/delete/rename 文件联动 + 客户端路径展示。真实库实跑迁移 1 行 3094 字逐字无损；mock 写作端点 e2e 全过。

## 2026-09-28 章节正文生成：headless 会话 + 无确认门 + documents 一章一份（而非一次性 CLI / 确认门流 / 正文版本化）

- **背景**：用户要求在章节预览页加入口，按章节概述用写作模型（OpenAI 接口兼容端点）生成正文，保存本地、预览展示并给章节点绑 document_id。设计时数据层已预留：outlines.document_id 为「待 documents 表落地」的裸列，status 枚举含 writing/completed——本次即该设计的落地点。
- **备选方案**：
  1. **headless 第五会话模式 `write-chapter <novelId> <chapterNodeId>` + 内联入口（无整页会话）**（选定）：LLM 生成正文是数十秒级长调用，library 查询 CLI 的 8s 超时不可用（与 polish-character 决策同理）；但与润色一样是单轮无问答流程，不值得整页会话页——入口按钮 + PreviewPane 内联收口（目标章生成态、run_finished 刷新详情、卸载 agent:stop），对齐角色编辑表单的润色订阅模式
  2. 生成前预览确认门（对齐章节规划流）：正文数千字预览确认交互成本高，且生成结果不满意时「确认门拒绝→重新生成」与直接重新生成的效果相同；v1 无确认门，入库后展示即确认，重写/修订流为后续需求
  3. 正文版本化（对齐角色 character_versions）：写作期迭代确实会发生，但 v1 一章一份（chapter_id 唯一索引拒绝重复保存）先锁最小闭环，版本化待真实使用反馈再定形态
- **设计要点**：
  - **documents 表与双向绑定**：documents（id/novel_id/chapter_id 唯一外键/content/word_count）+ outlines.document_id 回写列，`saveChapterDocument` 单事务「插正文 + 回写 document_id + 章节点 status=completed」——两处同指针向一份数据，列上外键因 SQLite 不支持 ALTER 补加，一致性由事务与 chapter_id 外键保证；word_count 取不含空白字符的近似口径
  - **一章一份与生命周期**：重复生成前置拒绝（省一次 LLM 调用）；deleteNovel 级联先于 outlines 删 documents；大纲重生成只降级归档章节点（行不删），documents 保留——旧正文与归档章的关联留存，历史回溯不吃 schema 变更
  - **写作模型会话不经 DeepSeek**：writeChapter 只调 getWritingModel()，headless 的 DEEPSEEK_API_KEY 启动检查对该模式跳过；模型未配置在库校验之后抛可读错误（客户端错误视图直接呈现缺失变量名）
  - **上下文全取自库**：世界观 JSON + 角色摘要行（六字段压缩，控 prompt 体积）+ 部/幕梗概与情节点 + 本章概述 + 同幕前后章概述（衔接上文、给下文留空间）；2000~3000 字与「只输出正文」写入 prompt 约束，空结果拒绝且库零残留
- **结论**：write-chapter.ts + DocumentStore + documents 表（SCHEMA_VERSION 9→10 纯新增迁移）+ 客户端章卡入口/正文卡。验证以 mock 写作端点协议级端到端替代真实 LLM（无真实端点 Key）；GUI 观感与真实写作模型生成质量待用户复验。

## 2026-09-28 写作模型 provider：官方 openai-compatible 包 + 惰性工厂，而非手写实现 / 常量导出

- **背景**：用户要求为小说正文创作预接一个独立的「写作模型」（可与 Agent 会话模型不同），OpenAI 接口兼容、返回 `LanguageModelV4`，经三个新环境变量（模型名 / API Key / Base URL）配置。正文创作工作流尚未建设，本次仅落 provider 层地基。
- **备选方案**：
  1. **官方 `@ai-sdk/openai-compatible` + 惰性工厂函数 `getWritingModel()`**（选定）：包为 Vercel 官方、专为任意 OpenAI 兼容端点设计（`createOpenAICompatible({ name, baseURL, apiKey })`）；工厂内先校验三变量再创建实例——`baseURL` 是该包的必填设置项，模块级常量导出（deepseek.ts 形态）会在未配置时 import 即抛错，违背「无 Key 场景可安全导入」的项目惯例
  2. 手写 `LanguageModelV4` 实现（`doGenerate` / `doStream` 自实现）：零新依赖，但需自行维护 SSE 解析、工具调用协议、usage 归一等数百行 HTTP 细节，长期跟随 AI SDK 规范升级的成本远高于一个官方包
  3. 用 `@ai-sdk/openai` 的 `createOpenAI({ baseURL })`：可行但为官方 OpenAI 语义（strict 结构化输出等假设），对第三方兼容端点的宽容度不如 openai-compatible
- **依赖统一（连带决策）**：引入 openai-compatible 3.0.57（锁 `@ai-sdk/provider` 4.0.18）后与 `ai` 7.0.99 / deepseek 3.0.44（均锁 4.0.14）形成双 provider 副本，`LanguageModelV4` 结构类型冲突（JSONObject 只读索引签名差异）。选择把 `ai` / `@ai-sdk/deepseek` 在既有 ^ 范围内 patch 升级（7.0.118 / 3.0.54，同锁 4.0.18）全树统一单副本，而非 root resolutions 强制覆写——不引入覆盖机制，升级路径常规。`@ai-sdk/provider` 增设为直接依赖（`ai` 导出的 `LanguageModel` 是 V2/V3/V4 联合类型，按需求标注精确的 `LanguageModelV4` 须从源头包导入）。
- **结论**：`providers/writing-model.ts` 导出 `getWritingModel(): LanguageModelV4`，环境变量定名 `WRITING_MODEL_NAME` / `WRITING_MODEL_API_KEY` / `WRITING_MODEL_BASE_URL`（三项需同时配置，空串视为未配置，未配置抛可读错误指明缺失项）。真实端点生成调用待正文创作工作流接入后端到端复验。

## 2026-09-25 角色版本管理采用「主行不变 + character_versions 快照表」（而非照搬大纲的换行制）

- **背景**：角色编辑需求要求「和大纲的类似」做 version 管理。大纲的机制是同表多版本行并存（新版本 = 新行新 ID + is_current_version 标记，旧行降级归档）；但角色与大纲树结构不同——角色没有父级层级，且角色 ID 已被别处引用（foreshadows.character_ids 服务角色 JSON 列，伏笔浏览/回收尚未建 UI 但数据层已投产），客户端选中态也以 characterId 为键。
- **备选方案**：
  1. 照搬大纲换行制：需新增 lineage 列归组同角色各版本行，编辑后角色 ID 换代——伏笔引用悬空、客户端选中失效需二次重选、listCharacters 需 currentOnly 过滤；
  2. 主行不变 + 快照表：characters 加 version 列，编辑时单事务把旧卡整卡 JSON 快照写入新表 character_versions（记编辑前版本号），主行全量更新并 version+1。
- **结论**：采用方案 2。版本管理语义与大纲等价（版本号递增、旧版本可追溯，历史浏览/回滚 UI 为后续需求），而 ID 稳定使全部外部引用与选中态零失效；代价是角色与大纲的版本机制不同构（大纲树形结构必须行制归档，角色平铺结构用快照更贴合）。

## 2026-09-25 角色 AI 润色走 headless 协议第四会话模式（而非一次性 LLM CLI）

- **背景**：润色是单轮 LLM 结构化输出（无确认门，确认在客户端表单层），通道可选：扩展 query.ts 类一次性 CLI（main IPC spawn，stdout JSON 单次往返）或扩展 headless 协议会话。
- **备选方案**：
  1. 一次性 CLI：不碰协议与 AgentStartOptions，但需要新增「长超时 LLM IPC」类别（现有 library IPC 8s 超时对 LLM 不够），且 IPC invoke 无取消语义——用户取消编辑时进程仍在烧 token；
  2. headless 第四会话模式 `polish-character <novelId> [characterId] <formJson>`：复用 AgentProcess 单例、消息 zod 复验、生命周期管理；表单 JSON 随 argv 传入（几 KB 量级，argv 上限内），结果经新增 `polish-result` 协议消息先行回传，run_finished 收尾。
- **结论**：采用方案 2。agent:stop 可真正中止会话（用户取消编辑即停，不浪费 token）；协议 schema 为 discriminatedUnion 超集扩展，PROTOCOL_VERSION 不动（client 与 agent 同仓同版发布）；代价是「浏览页内联会话」复用了整页会话的单例 AgentProcess——浏览页与创作页本就互斥挂载，无实际冲突。

## 2026-09-25 新增角色直接表单提交，不走创作流多轮确认门

- **背景**：角色组头「＋」新增角色复用编辑表单；创作流内角色经 ReAct Agent 逐字段「发散→确认→保存」多轮收集。
- **备选方案**：新建也走确认门（增加交互轮次，与表单「可编辑后提交」的语义重复）；提交前弹确认框。
- **结论**：表单提交即入库（version=1、无快照），与编辑提交一致；后续角色删除/管理能力可兜底误建。创作流内角色收集逻辑不动。

# 重大决策记录

记录「为什么」而非「做了什么」：决策背景、备选方案、权衡依据与结论。

## 2026-09-25 大纲刷新重生成：版本切换入库 + 树展开收起（任务包经用户确认）

- **背景**：用户要求①结构树大纲节点支持展开收起；②大纲表新增 version / currentVersion 表达版本迭代；③「📖 大纲」组头加刷新按钮——弹框警示（已生成章节将清空）→ 确认后进入重生成会话，填数量表单、Agent 生成新大纲预览调整、确认后入库并将新版置 currentVersion=true / 旧版 false。需求校验发现②的 `version` / `is_current_version` 列**早已存在**（建表即有的多版本设计），缺的是版本切换流——本次零 schema 迁移，落地 `saveOutlineTreeNewVersion`。
- **备选方案**（三项经用户确认）：
  1. **「清空」= 降级归档而非物理删除**（选定）：旧树与旧章 `is_current_version=0` 保留在库（真迭代记录、可回溯）；备选物理删除与「版本迭代记录」意图相悖
  2. **只喂库内数据（书名/logline + 世界观 + 角色），不喂旧大纲**（选定）：真重新生成，避免新版本被旧结构锚定；备选附带旧大纲作参考更连贯但易换汤不换药。类型/受众/核心冲突未入库（仅创作时内存 state），作为已知约束缺失，可在确认门反馈补
  3. **数量表单 = 幕数 + 部数**（选定）：对齐新建流程（3-20 默认 5 / 1~幕数 默认 1），各部幕数由模型分配
- **设计要点**：
  - **版本切换单事务**：降级旧当前行（含章）与插入新树（version=max+1）同事务，中途失败整体回滚；唯一索引只约束当前版本，新旧同 sort 天然不冲突
  - **Agent 松绑不复制**：`createOutline` 入参放宽为 `OutlineContext`（worldview/characters 必带，genre/audience/coreConflict 可选），新建与重生成共用同一 Agent 与确认门，不另建重生成 Agent
  - **会话模式沿用 argv 先例**：headless `regen-outline <novelId>` 第三会话模式，`AgentStartOptions` 纯类型扩展、协议 schema 零结构改动，run_finished 复用
  - **重生成产物覆盖**：`output/<id>.json` 单文件仅存最新版（历史在库），`readOutlineTheme` 读到的始终是当前版主题
  - **完成后选中重置**：旧节点 ID 随降级失效，客户端重置 selection 并 reload 详情；新幕的「规划本幕章节」入口随新树恢复
  - **树展开收起为纯客户端态**：collapsed 集合默认空（全展开）、会话内保持，不做持久化（YAGNI）；切换按钮与节点选中解耦
- **结论**：`saveOutlineTreeNewVersion` + `regenerateOutline`（regen-outline.ts）+ headless 第三会话 + 结构树部/幕收起 + 组头刷新按钮（OutlineRegenDialog 警示弹框 → OutlineRegenFlow 整页会话）。历史版本浏览/切换 UI、章节修订流为后续需求。

## 2026-09-25 新建小说流程不再自动规划第一幕章节（章节规划统一走客户端手动入口）

- **背景**：2026-09-24 曾在大纲确认入库后自动衔接第一幕章节规划（见当日「第一幕章节规划」决策）；同日客户端单幕规划会话（幕卡「规划本幕章节」入口，`planActChapters`）上线，任意未规划幕均可手动发起。两入口重叠：新建流程自动规划第一幕剥夺了用户选择规划时机与幕顺序的自由，且拉长本已多轮的创建会话。用户直接决策：大纲确认入库后会话结束、回主界面，章节一律手动规划。
- **备选方案**：
  1. **移除新建流程中的自动规划段**（选定）：大纲确认入库落盘即收尾（run_finished），章节统一经 `planActChapters` 逐幕手动发起；chapter-agent / `saveChapters` / `chapter` 阶段枚举 / `chapter-plan` 确认视图全部保留（单幕会话在用，零废弃代码）
  2. 保留自动段但先询问「是否现在规划第一幕」：多一道确认门，会话生命周期（用户中途想回书库）复杂化；第一幕相对其他幕已无差异化价值，为其保留专属路径不合算
- **联动取舍**：
  - 客户端 StageBar 七阶段 → 六阶段（创作流不再到达「章节」，避免进度条停在永不完成态；`LABELS` 保留全枚举字典）
  - shared stage 枚举与协议 schema 零结构改动（`chapter` 仍由单幕会话发送），不升协议版本
  - createNovel 收尾 notify 增加手动发起指引（CLI 与客户端共用通知文案）
- **结论**：createNovel 删自动规划段；章节规划唯一入口 = 客户端幕卡「规划本幕章节」（headless `plan-chapters` 模式）。

## 2026-09-24 客户端单幕章节规划会话（幕卡入口 + headless argv 模式）

- **背景**：章节 Agent（planChapters + saveChapters）已建成但只在新建小说全流程末尾对第一幕触发（PROGRESS 待办「后续幕逐幕推进」）。用户要求在大纲预览的幕节点卡上加入口，为任意未规划幕启动章节规划。澄清提问（交互载体 / 按钮显示规则）未获即时答复，按推荐项执行并在此落盘供复核。
- **备选方案**：
  1. **headless argv 会话模式 + 整页问答流**（选定）：spawn 参数选会话（无参 = 新建全流程；`plan-chapters <novelId> <actNodeId>` = 单幕规划），对齐 query CLI 传参先例，协议消息 schema 零结构改动（run_finished 复用）；交互复用创作页整页问答流模式（新 ChapterPlanFlow，与 CreationFlow 共用抽取的 useAgentSession 会话泵）
  2. 协议消息触发：hello 后 client 发「开始规划」类消息——client→agent 消息面从单一 response 扩为多类型、协议版本升级连带两端；且「进程即会话」由 spawn 参数天然表达，无增益
  3. 浏览页右栏内嵌确认区：问答流嵌三栏布局滚动空间小，agent 生命周期挂在常驻浏览页上状态更绕
- **设计要点**：
  - **规划上下文全取自库**：novels.name / description（书名 / logline）+ 幕与所属部节点的 summary / keyPlotPoints；theme 仅存于 output 产物，`readOutlineTheme` 尽力读取、缺失省略（theme 本就是 Agent 可选输入）——不为一个可选项扩 novels 表
  - **按钮显示规则**：未规划幕显示入口；已规划幕隐藏（重复保存被唯一索引拒绝、修订流为既有待办，点击必错不如不给入口）；旧数据幕（内容列 NULL，无规划种子内容）禁用 + title 提示原因
  - **校验兜底在 agent 侧而非 UI**：小说/幕不存在、异小说、非幕、旧数据缺内容、已有章节均在工作流入口抛可读错误（fatal error → 客户端错误视图），客户端显示规则只是第一道体验优化
  - **AgentStartOptions 落 shared 为纯类型**：client 三端（main / preload / renderer）共用「会话参数 → spawn argv」映射契约（create → 无参 / plan-chapters → 传双 ID），零运行时、不升协议版本
  - **run_finished 复用**：语义泛化为「一次 agent 会话正常结束」（新建创作 / 单幕规划），两个会话页互斥挂载各听各的，客户端据 novelId 刷新
  - **完成后保持选中该幕**：详情手动 reload（不动 selection），结构树第三层出现章节点、幕卡入口随之消失（hasChapters 即时生效）
- **结论**：`planActChapters` 工作流（校验 → 组装上下文 → 复用章节 Agent → saveChapters）+ headless argv 分发 + client agent:start 携带会话参数 + ChapterPlanFlow 整页 + OutlineNodeCard 幕卡入口。真实 LLM 协议级端到端实跑通过（确认门 → 5 章入库 → run_finished），重复规划前置拒绝实证。

## 2026-09-24 第一幕章节规划：ReAct 确认门 + 章节挂幕入库（只做第一幕）

> 2026-09-25 更新：新建小说流程内的自动规划段已移除（见当日「不再自动规划第一幕章节」决策），本条的 chapter-agent / saveChapters / chapter-plan 视图与 `chapter` 阶段由单幕规划会话沿用，其余内容仍有效。


- **背景**：大纲确认入库后进入写作准备。用户需求：从第一幕开始，按幕梗概与关键情节点推荐章节数量与各章剧情概述，用户确认后把章节写入大纲表，先做到这一步。
- **备选方案**：
  1. **独立章节 ReAct Agent + save_chapters 终态确认门**（选定）：完全对齐 outline-agent 模式（确认被拒→收集反馈→修订→再确认），结构化组装过 schema、杜绝模型漂移
  2. 编排层 generateObject + askConfirm 轻量直出（受众/冲突模式）：无修订循环，用户不满意只能整体重来；确认视图不结构化，违背「确认视图与提问原子绑定」约定
- **设计要点**：
  - **只规划第一幕**：用户明示「先从第一幕开始」；后续幕逐幕推进、按幕续规划为后续需求，避免一次生成全书章节（上下文超限且与「按幕写作」节奏不符）
  - **章节数量由模型推荐、schema 约束 1~12**：数量是输出而非输入（用户表述「推荐一个章节的数量」）；上限防模型漂移，prompt 引导按情节点密度取 3~8
  - **章节点只携带 summary（本章概述）**：关键情节点仍仅幕节点可携带（既有 outlineNodeSchema refine），章级情节归写作期正文；chapter 类型与树形第三层数据库早已预留，零迁移
  - **确认视图自包含**：`chapter-plan` 视图内嵌幕梗概 + 情节点 + 规划全文，CLI 与 client 渲染不依赖外部上下文；stage 枚举追加 `chapter`（七阶段）
  - **NovelStatus 不新增**：章节规划仍属大纲期尾声，state.status 保持 outlined；写作状态流转（planned→writing）待正文工作流再议
  - **上下文精简**：Agent 输入只给大纲全局（标题/logline/主题）+ 所属部 + 目标幕，不传全量 params——章节拆解决策主要依赖幕内容，全量角色/世界观注入徒增 token
- **结论**：shared 新增 chapterPlanSchema + chapter-plan 视图 + chapter 阶段；OutlineStore.saveChapters 幕下事务批量建章（重复保存撞唯一索引拒绝，多版本流为既有待办）；客户端浏览侧结构树递归建树与章类型标签本就预留，零改动。

## 2026-09-24 新增「伏笔」概念数据层（完整 CRUD，章节关联用裸列）

- **背景**：继位置之后第二个小说世界结构化概念。伏笔有生命周期（未回收 → 部分回收 → 已回收）与多值关联（跨多章回收、服务多个角色），经确认本次交付建表 + 完整操作（add / list / patch / delete），不入创作流。
- **备选方案**：
  1. **独立 foreshadows 表 + 多值字段存 JSON 文本列**（选定）：回收章节 IDs / 服务角色 IDs 对照 `worldviews.taboos` / `outlines.key_plot_points` 惯例，库侧 CHECK 约束枚举与数值范围
  2. 规范化关联表（伏笔-角色、伏笔-回收章节两张子表）：外键完整但当前无「按角色 / 章节反查伏笔」的调用方，三表 join 徒增复杂度（YAGNI），有反查诉求时再迁移
  3. 多值字段并进一个通用 metadata JSON 列：无法逐字段校验，读写漂移面大
- **设计要点**：
  - **出现 / 回收章节 ID 为可空裸列**：chapter 节点写作期才落地，当前无行可挂外键——先例 `outlines.document_id`「暂为可空裸列待 documents 表落地后补外键」；chapter 落地后另起需求补约束与校验
  - **服务角色应用层校验**：JSON 数组元素无法靠外键约束，add / update 时查 characters 表保证每个角色存在且属于同一小说（对照位置父级同小说校验的精神）
  - **patch 语义对齐 outline-node 先例**：undefined=不动 / null=清空 / 值=覆盖；必填三字段（表面行为 / 隐藏真相 / 注意度）与回收状态仅可覆盖不可清空
  - **回收状态英文枚举**（unrecovered / partial / recovered）+ 库侧 CHECK，展示层映射中文——对齐 outlines.type / status 惯例
  - **核心必填 + 其余可选**：创建门槛低，伏笔可先记框架（表面行为 + 隐藏真相 + 注意度）后补埋线方式 / 章节 / 角色等细节
- **结论**：SCHEMA_VERSION 7→8 纯新增表迁移（CREATE TABLE IF NOT EXISTS 幂等落地）；真实库副本实跑数据无损。创作流采集 / 查询与浏览接入为后续需求。

## 2026-09-23 新增「位置」概念数据层（独立 locations 表，本次不接工作流）

- **背景**：大纲内容已入库，用户开始为小说世界补充结构化概念，首个是「位置」（地理位置：名称 / 横纵坐标 / 图层 / 人口 / 父级层级）。经确认本次交付仅落数据层（schema + 表 + store），采集与浏览后续接入——与大纲「先入库、后切读取路径」同样的两步节奏。
- **备选方案**：
  1. **独立 locations 表 + LocationStore**（选定）：对照 characters / outlines 既有模式，坐标 REAL、人口 INTEGER 可空、父级 parent_id 自引用外键（与 outlines 树同型）
  2. 位置存 worldviews 表 JSON 列：无外键 / 类型约束 / 索引，级联删除与未来按位置检索都要手写 JSON 解析
  3. 仿 outlines 多版本行（version / is_current_version）：位置是设定资料而非需回溯的大纲产物，无版本诉求（YAGNI）
- **设计要点**：
  - **图层自由文本不加 CHECK 枚举**：天上 / 地面 / 地底只是举例，架空世界可能有「深渊层」「星界」；zod 侧仅约束非空
  - **人口可空（NULL）**：无人 / 未设定地点存 NULL，与「填 0」语义区分；库侧 CHECK 非负
  - **addLocation 父级先查后插**：外键只保证父级行存在，拦不住跨小说挂接——层级语义要求父子同书，代码层校验并给可读错误
  - **连带修正 5→6 迁移段守卫**：原实现两段 ALTER 在 `version >= 4` 分支内无条件执行，SCHEMA_VERSION 升 7 后 v6 库打开会重放 ALTER 报 duplicate column——补 `version <= 5` 链式守卫（注释「逐级补列」既定意图的实现遗漏，在本次版本递增时暴露）
  - 类型名 `Location` 与 DOM 全局同名：agent / 主进程无 DOM 语义、renderer 按名引用 DOM Location 的场景极罕，沿用最自然的领域命名
- **结论**：SCHEMA_VERSION 6→7 为纯新增表迁移（CREATE TABLE IF NOT EXISTS 幂等落地，旧数据零影响）；真实库副本实跑验证数据无损。创作流采集 / query CLI / 客户端浏览为后续需求。

## 2026-09-23 大纲浏览读取路径切换为 outlines 表节点（按节点展示内容）

- **背景**：内容列（summary / keyPlotPoints）已入库（见当日上一决策），客户端「结构-大纲」仍读 `output/<id>.json` 全量大纲（整树一个选中态）。用户要求：结构树点击节点 → 右栏按节点展示 summary 与 keyPlotPoints；旧数据（迁移前行，两列 NULL）展示空内容，不再从 JSON 读取。
- **备选方案**：
  1. **契约改为节点数组 + 客户端按节点选中**（选定）：`novelDetail.outline: Outline|null` → `outlineNodes: OutlineNodeEntry[]`（id/parentId/type/name/sort/summary/keyPlotPoints，`currentOnly` 当前版本），树按 parentId 建树、选中携带 `outlineNodeId`（对照角色 characterId 模式）
  2. 保留全量 outline 字段、客户端自行拆节点：仍依赖产物文件，与「DB 为浏览数据源」相悖；title/logline/theme 也无库内归宿
  3. 把 title/logline/theme 一并落库并维持全量视图：范围扩大（novels.name 可能已被用户改名、theme 无处可放），且用户要的是节点粒度交互而非总览页
- **设计要点**：
  - **去掉《标题》伪根节点**：伪根不是库表节点、无 summary / keyPlotPoints 可展示；书名已在预览区标题栏，部直接作树根（「大纲」分节标题保留）
  - **节点卡片不进 shared View 体系**：浏览专用 `OutlineNodeCard`（客户端自有组件，复用 viewcard 样式）——避免浏览视图渗入创作流协议（protocol.ts 内嵌 viewSchema 会连带扩大 agent 可发消息面）
  - `readOutlineArtifact` 从 query CLI 退役（`outlineFilePath` 保留给 delete 清产物）；产物缺失不再影响浏览，未生成为空数组
  - 旧数据空占位：「（暂无梗概——旧数据未入库内容）」/「（暂无关键情节点——旧数据未入库内容）」（dim 样式）
- **结论**：创作流协议与 `create-novel.ts` 双写零改动；AC 见 PROGRESS。旧书如需补内容，回填另起需求（此前已决策暂不回填）。

## 2026-09-23 大纲内容（summary / keyPlotPoints）入库 outlines 表，document_id 仍留写作期

- **背景**：outlines 表此前只存树形骨架（标题 / 排序 / 版本），梗概与关键情节点仅存在于 `output/<id>.json`——写作期「按每幕内容生成章节大纲」需要库内数据源，且产物文件一旦丢失内容即不可恢复。
- **备选方案**：
  1. **内容直列入 outlines 表**（选定）：`summary TEXT` + `key_plot_points TEXT`（JSON 文本列，对齐 worldviews.taboos / characters.relationships 惯例），零新表，读写随既有树查询
  2. 内容挂 documents 表经 `document_id` 关联：documents 表定位是写作期章节正文（用户确认 `document_id` 为挂真实章节内容预留），大纲内容与正文是两类数据，混用歪曲其语义；且 documents 表本次不落地
  3. 独立 outline_contents 表：多一次 join，无查询收益
- **设计要点**：
  - keyPlotPoints 仅幕节点携带：outlineNodeSchema refine 强约束（part / chapter 携带即拒绝）；部 / 幕均入库 summary；两列可空——5→6 迁移前的历史行保持 NULL
  - `OutlineTreeInput` 内容必填（与 outlineSchema.parts 结构对齐）：`saveOutlineTree(id, outline.parts)` 类型直接匹配，内容不可再被编译期静默丢弃（此前正是输入类型只声明 name 导致丢弃）
  - patch 放行内容两字段（undefined=不动 / null=清空，合并语义对齐 documentId），为将来修订流预留
  - **读取路径不动**：query CLI / 客户端预览仍读 output JSON——title / logline / theme 尚无库内归宿（novels.name 可能已被用户改名、theme 无处可放），切 DB 读需先解决其落库位置，另起需求；DB 内容服务于写作期（`listOutlineNodes` 消费）
    > 2026-09-23 更新（二）：读取路径已切换——浏览改读 outlines 表节点并按节点展示内容（见当日「大纲浏览读取路径切换」决策）；title/logline/theme 不进浏览大纲的取舍在该决策中重申。
  - **旧数据不回填**：旧行 NULL 即可（读取路径不变、旧书预览不受影响）；回填需读产物文件，属一次性数据维护，写作期涉旧书时再议
- **结论**：SCHEMA_VERSION 5→6，迁移分支按版本链式逐级补列（v4 库直升时 novels 与 outlines 两段列同批补齐，避免跳段漏列）；db.test.ts 三用例（v5 / v4 / 全新建库）+ 真实库实跑验证（4 本小说 14 行大纲无损、旧行未回填、`get` 读取路径行为不变）。

## 2026-09-22 角色字段保存策略：从「保守概括」转为「受控发散」（标识照存 + 描述丰富）

- **背景**：用户要求 save_field 保存角色字段时基于用户描述发散丰富，不要原样保存。原策略（2026-09-16 字段协议确立时）是「概括总结 + 严禁改写 + 不得虚构」——动机是防 deepseek-flash 改写漂移（曾把「记者顾清欢」改写成「修复师苏晚」），但实际效果偏保守，字段内容常是用户原话的复述，缺乏创作价值。
- **新策略（分级发散）**：
  - **标识性字段**（name / gender / narrativeRole）照存用户原词、不扩写：姓名只存名字本身、性别只存性别、叙事定位一句话以内——首次真实 LLM 冒烟发现无分级时 name 被写成「林澜。『澜』是孤儿院那位老领航员替她取的——……」长段来历、gender 混入外貌描写，故必须显式分级
  - **描述性字段**（背景 / 内核 / 性格 / 外貌 / 轨迹等）以用户描述为种子发散丰富成 2~4 句设定文字：补充自然贴合的细节与形象，不照抄原话，发散不得与用户给出的事实相悖
- **防漂移底线保留**：组装仍由代码完成并过 schema 校验（submit_character），逐字段与整卡双重用户确认门不变——发散不满意用户可在确认时反馈修正，漂移兜底机制未削弱。
- **验证**：真实 LLM 定向冒烟两轮——第一轮暴露标识字段污染，分级修正后第二轮：name/gender/narrativeRole 干净照存（林澜 / 女 / 主角），背景从「殖民城市长大的孤儿领航员」扩写为完整身世设定（旧港区孤儿院、桅杆学徒、读星辨潮、黑市码头年轻领航员）。

## 2026-09-21 书库管理：schema 4→5 弃「不匹配即重建」改保数据增量迁移

- **背景**：书库右键管理（重命名 / 置顶 / 收藏 / 删除）需要 novels 表增列 pinned / favorite。既有 schema 版本策略是「user_version 不匹配即 DROP 重建」，前提为「开发期数据可弃」——但三栏浏览 UI 上线后 `data/novel.db` 已承载用户真实书库数据，重建即清空用户书库，不可接受。
- **备选方案**：
  1. **ALTER 增量迁移**（选定）：4→5 执行 `ALTER TABLE novels ADD COLUMN pinned/favorite ... DEFAULT 0`，旧数据零回填
  2. 重建表迁移（CREATE 新表 + INSERT SELECT + 改名）：加列场景下无收益，反而引入外键重挂与窗口期风险
  3. 维持 DROP 重建：直接丢用户数据，被否决
- **权衡依据**：加列 + DEFAULT 是 SQLite 最安全的迁移形态（无行级改写）；DROP 重建仅保留给 <4 的开发期旧库与异常版本（>5 的库被旧代码打开）兜底。**连带决策**：查询 CLI 弃 readonly 连接、统一走 `openDatabase()`——否则纯浏览路径无法触发迁移，旧库首次 `list` 即因缺列报 `no such column`；readonly 的原始动机（防查询触发 DROP 重建）已因保数据迁移而消失。
- **设计要点**：
  - **删除语义**：`deleteNovel` 单事务级联清 outlines（自引用树一条 DELETE 按 novel_id 整删，语句末无孤儿即过约束）→ characters → worldviews → novels；入口层 best-effort 清理 `output/<id>.json` 产物（缺失不算失败）；UI 项内二次确认（文案明示级联范围）
  - **置顶 / 收藏语义**：置顶布尔参与排序（`pinned DESC, created_at DESC, id DESC`，组内按创建时间倒序）；收藏仅星标不影响排序——不引入拖拽自定义排序与收藏筛选（YAGNI）；标记置位不动 updated_at（非内容变更）
- **结论**：SCHEMA_VERSION 5；迁移有单测（v4 库 → openDatabase → 数据保留 + 新列可用 + 版本升 5）；真实库经新代码 list 顺带完成迁移、3 本小说完整保留。

## 2026-09-21 客户端三栏浏览 UI：书库读数走 agent 一次性查询 CLI

- **背景**：客户端从「单次创作会话」升级为三栏浏览主界面（左栏小说列表 / 中栏世界观·角色·大纲结构树 / 右栏预览），需要读 SQLite 库；Electron 主进程是 Node 运行时，无法直接用 agent 侧 `bun:sqlite` store 层。设计规格 `docs/superpowers/specs/2026-09-21-client-browse-ui-design.md`（布局形态 / 创作共存方式 / 读数架构三项关键决策经用户选择确认）。
- **备选方案**（读数架构，用户选定方案 1）：
  1. **agent 侧一次性查询 CLI**（选定）：main spawn `bun run apps/agent/src/query.ts list|get`，stdout 单行 JSON，shared query schema 双端复验
  2. Electron 主进程直读 SQLite（node:sqlite / better-sqlite3）：免子进程，但绕过 store 层双向 zod 校验，且引入原生依赖 / 实验性 API 兼容负担
- **权衡依据**：与既有 headless spawn 模式同构（无新通信范式）；store 层与 shared schema 全复用，双端结构零漂移；查询为低频只读操作，子进程冷启动（百毫秒级）可接受。查询入口以只读连接打开库（先判断库文件存在，readonly 打开），不触发 `openDatabase` 的建表 / 版本重建副作用。
- **设计要点**：
  - **大纲预览以 `output/<id>.json` 产物为数据源**：outlines 表只存树节点名（title / logline / summary / keyPlotPoints 在表外），产物与库在确认流程中同步写入、一一对应；产物缺失或不合法一律按「未生成」降级展示，不阻塞世界观 / 角色浏览
    > 2026-09-23 更新：summary / keyPlotPoints 已随 5→6 升版入库，客户端预览读取路径亦已切换为读 outlines 表节点（见当日两条决策），产物仅供留存；本条「产物为数据源」的表述已被取代。
  - **创作流以覆盖层盖住中+右栏**（用户选定，左栏书库保持可见）：问答流整体迁移为 CreationFlow，挂载即发起会话，run_finished 后关层 → 刷新书库 → 自动选中新作；中途关闭 = 终止子进程（新增 `agent:stop` IPC，语义同 v1 中断，state 已增量落库）
    > 2026-09-22 更新：按用户后续需求，创作流从「覆盖层盖住中+右栏」改为**独立创作页**（App 页面级切换，浏览页汉堡 / 三栏结构不与创作页共存），CreationFlow 内部逻辑与联动不变。
  - **诊断钩子语义修正**：AUTOSTART 从「main 直 spawn agent」改为「renderer 自动打开创作覆盖层」——新架构下 agent 会话必须由 CreationFlow 发起（消息监听与提问应答都在其内），main 裸 spawn 会产生无 UI 的孤儿会话；新增 `NOVEL_CLIENT_SELECT=<novelId>` 支持无头冒烟自动选中并预览
- **结论**：shared 新增 query 契约（novelListItem / novelDetail / characterEntry），agent 新增 query.ts + `NovelStore.listNovels()`，client 新增 library IPC + 三栏组件（NovelListPanel / StructureTreePanel / PreviewPane）+ CreationFlow 覆盖层。核心冲突（coreConflict）未持久化入库，浏览界面不含该类（与现有表能力对齐）。

## 2026-09-19 Monorepo 改造 + Electron 客户端：agent 独立 Bun 进程 + UiChannel 交互抽象 + stdio JSON 协议

- **背景**：为 agent 添加 Electron 桌面客户端并将仓库升级为 monorepo。设计规格见 `docs/superpowers/specs/2026-09-19-monorepo-electron-client-design.md`（经头脑风暴与用户逐节审查）。
- **备选方案**（运行形态）：
  1. **agent 独立 Bun 进程**（选定）：Electron 只做 UI 壳，main spawn `bun run headless.ts`，stdio JSON 行协议通信
  2. agent 嵌入 Electron 主进程（Node 运行时）：须剥离 `bun:sqlite` / `Bun.randomUUIDv7` / `bun:test` 全部 Bun 专属依赖，交互层全重做，丧失 Bun 优势
  3. 核心抽包双入口（agent-core 入 packages，CLI 与 Electron 双壳）：同样要 Node 化核心，双入口长期双倍维护
  4. Docker：与桌面应用错配（用户须装 Docker Desktop、管道变 TCP、数据卷挂载）；一键启动用 spawn 即达成
- **设计要点**：
  - **agent 放 `apps/` 而非 `packages/`**：agent 是「有独立入口、独立运行时、可单独执行」的产品单元；`packages/shared` 只放双端复用的纯 zod 层（领域 schema + 视图 + 协议消息），schema 迁出 agent 是为了 client 渲染与协议引用同源，避免反向依赖
  - **UiChannel 接口收敛全部交互**：workflows/tools/agents 不再直接 import `cli/prompt` 或 console 输出（ESLint no-restricted-imports + no-console 边界规则强制）。两处语义特意的接口设计——①EOF 分层：`askLine` 通道关闭返回 null（ask_user 工具借它让模型优雅收尾），其余提问抛 `UserAbortedError` 中止全流程；②确认视图与提问**原子绑定**：字段摘要/角色卡/大纲草稿作为 `askConfirm` 的 view 载荷随请求下发（延续 2026-09-17 并发确认串行化的「摘要拼入提示」约定），而非 present + ask 两步（会错位）
  - **协议按 id 关联 + 无效应答重问**：request/response 用自增 id，类型不符/越界/空 required 以新 id 重发（对齐 CLI 校验循环）；并发 request 由 client 排队呈现（SerialLineSource 的 UI 等价）；协议消息不合法 fail-fast（开发期暴露协议 bug）
  - **v1 无优雅取消**：一会话一进程，中断 = main 终止子进程（state 增量落库无需善后）；「重启 agent」即从头开始
  - 测试净收获：FakeChannel（脚本化应答）+ mock `ai` 模块的 createNovel 全流程集成测试，纯本地跑通完整创作流（此前端到端必须真实 LLM）
- **结论**：Bun workspaces 三区结构（apps/agent + packages/shared + apps/client）落地；Electron main spawn agent 经 zod 复验转发 IPC；无头冒烟（截图）+ 协议驱动器真实 LLM 端到端验证通过。打包分发（electron-builder + agent 编译进 extraResources）为 v2。

## 2026-09-18 大纲两级结构（部→幕）对齐 outlines 表并接入工作流

- **背景**：outlines 表已落地但大纲仍只落 `output/<id>.json`；用户指定类型瘦身为部/幕/章并要求大纲生成对齐表模型——先问幕数（默认 5）再问部数（默认 1），生成两级大纲，确认后入库+落盘。
- **设计要点**：
  - 枚举去「卷」：层级定型为 部→幕→（写作期）章；章保留在枚举与 CHECK 中作为写作阶段节点，大纲阶段不创建
  - `outlineSchema` 由平铺 acts 重构为 parts 嵌套（部带名称+概述，幕带名称/梗概/情节点）：部的划分是故事宏观结构信息，应由模型基于冲突节奏生成而非入库时机械均分——结构约束（恰好 M 部共 N 幕、每部至少一幕）经 `outlineSchemaFor` refine 在 save_outline 入参层强校验，模型给错被 schema 拒绝重试
  - 入库映射：部为根节点（sort 1..M）、幕为所属部子节点（sort 按父级 1 起），全部 version=1/当前/planned；`saveOutlineTree` 用单事务包住整树写入，中途任一节点失败整树回滚（不留半棵树），重复保存整树被唯一索引拒绝（多版本修订流为后续需求，届时由调用方先降级旧树再入库新树）
  - 破坏性变更接受：output/<id>.json 结构变两级、库因 schema 升版重建——开发期数据可弃（既有约定），旧 JSON 不迁移
- **结论**：createNovel 大纲段流程 = 问幕数 → 问部数 → 两级生成 → 确认循环 → `saveOutlineTree` 入库 + JSON 落盘。真实 LLM 冒烟验证模型能按约束自分配各部幕数（2 部 5 幕 → 3+2）。

## 2026-09-18 outlines 表：树形多版本大纲 + 仅当前版本的 sort 唯一索引

- **背景**：大纲需要从 `output/<id>.json` 单文件演进为库内树形结构（卷/部/幕/章，parent 自引用），并支持同节点多版本（version + is_current_version）与写作生命周期（status + document_id 关联后续正文）。本次仅建表与 Store，不接入 create-novel 工作流（用户确认拆分为后续需求）。
- **设计要点**：
  - 「同一父级下 sort 不重复」约束范围经用户确认为**仅当前版本内唯一**：多版本行并存时旧版本与新版本同 sort 合法，故用部分唯一索引 `WHERE is_current_version = 1`，而非全表唯一（全表唯一会迫使同节点各版本错开 sort，排序语义失效）
  - 根节点 `parent_id` 为 NULL，SQLite 唯一索引视 NULL 互异导致根层级判重失效；采用表达式索引 `COALESCE(parent_id, '')` 归一，并把 `novel_id` 纳入索引实现跨小说隔离
  - 当前版本切换不做隐式降级：Store 保持无状态，调用方先降级旧版本再提升新版本，唯一索引兜底并发/漏降级冲突（测试覆盖「未降级直接提升被拒」路径）
  - type/status 用英文枚举值（volume/part/act/chapter、planned/writing/completed/deprecated）+ CHECK 约束，与代码库英文标识符约定一致；本次未加大纲节点内容字段（用户确认暂不加，后续按需随 schema 升版扩展）
    > 2026-09-23 更新：内容字段已随 5→6 升版加入（见当日决策）。
  - `document_id` 暂为可空裸列：documents 表尚不存在，先不加外键，正文功能落地时补约束
- **结论**：outlines 成为第 4 张表（UUIDv7 主键 + `novel_id` 外键），SCHEMA_VERSION 2→3（开发期不匹配重建）；`OutlineStore` 提供 add/get/list(currentOnly)/update，读写双向 zod 校验，唯一索引违规转译为可读错误。

## 2026-09-17 novels 表 + 全表 UUIDv7 主键 + 外键关联

- **背景**：需要 novels 表保存小说信息（id/name/author/description），角色与世界观经 novel_id 外键关联；ID 从 uuidv4（node randomUUID）切换为 uuidv7。
- **设计要点**：
  - UUIDv7 生成：封装 Bun 原生 `Bun.randomUUIDv7()`（同毫秒内单调递增，主键索引友好）；node 自带 randomUUID 仅 v4，uuid npm 包则与项目零依赖取向不符。保留 `generateUuidV7` 函数壳作为项目内唯一出口（初版曾自实现 RFC 9562 布局，实测 Bun 原生可用后切换）
  - SQLite 外键默认关闭，`openDatabase` 按连接执行 `PRAGMA foreign_keys=ON`；novels 行必须先于角色/世界观入库（工作流在初始化即建行，name/description 大纲确认后回填，author 暂未采集留空）
  - schema 变更用 `PRAGMA user_version` 管理：版本不匹配直接 drop 重建（开发期本地测试数据可弃；接入生产前需改为正式迁移）
- **结论**：三表主键均为应用层 UUIDv7；characters.novel_id 外键（1:N），worldviews.novel_id 唯一外键（1:1）。`foreign_key_check` 与单测均验证约束生效。

## 2026-09-17 worldviews 表 1:1 主键 + taboos JSON 列 + store 共享连接

- **背景**：世界观也要按 schema 入库并与角色分表、按创作 ID 绑定。
- **设计要点**：
  - 世界观与小说是 1:1（一本小说一个世界观），`novel_id` 直接作主键；与角色的 1:N（自增 id + novel_id 索引）区分
  - `taboos` 为字符串数组，SQLite 无数组类型，存 JSON 文本（读写经 schema 校验保证结构正确）
  - 保存语义为 upsert（覆盖更新、created_at 保留）——世界观可能经用户确认后修订重存
  - 两个 store 共享 `getDefaultDatabase()` 懒加载单例连接（同库不同表），避免多连接；测试用 `static open(path)` 独立建库隔离

## 2026-09-17 角色持久化采用 Bun 内置 bun:sqlite，characters 表按 schema 平铺

- **背景**：角色卡确认后需要持久化并绑定创作 ID，为后续「按 ID 恢复继续创作」打基础。
- **备选方案**：better-sqlite3（需原生编译依赖，Bun 环境无必要）；JSON 文件追加（无结构化查询，多角色/多 ID 管理弱）；先做 NovelStateStore 整体 SQLite 化（超出本次范围）。
- **结论**：`bun:sqlite`（零依赖、同步 API）。`characters` 表列与 characterSchema 平铺字段一一对应（嵌套的 basicInfo/core 拆为列），`novel_id` 加索引；读写双向过 zod 校验保证库内数据完整性。角色在每张卡确认后立即增量入库（崩溃时已完成的角色不丢失）；内核/背景/创作目的/结局方向为固定属性，只增不改。NovelState 整体（status/params/outline）的 SQLite 化为后续接入点。

## 2026-09-17 终端交互串行化（并发确认排队 + 提示语轮到时才写）

- **背景**：deepseek 等模型会在 ReAct 单步内并行调用多个 `save_field`，每个 execute 都要用户确认。管道模式靠 FIFO 勉强保持顺序但提示语全部提前打印；TTY 模式下 node:readline 的 `question()` 只有一个回调槽，后调覆盖前调，前一个确认永久挂起。
- **备选方案**：提示词约束模型一次只调一个工具（弱模型不可靠）；按工具聚合批量确认（跨 execute 聚合复杂且改变确认语义）。
- **结论**：`SerialLineSource` 基类在输入层串行化——并发读取 FIFO 排队，同一时刻只有一个未完成提问，提示语在轮到时才写入（展示内容拼进 prompt 参数，摘要与提问原子出现）。附带约定：工具内需要「展示内容 + 确认」时，内容必须拼入确认提示而非先行 console.log。隔离测试（时间戳）与端到端均验证：B 的提示仅在 A 应答后出现，应答按序映射。

## 2026-09-16 角色收集改为 ReAct Agent + 字段协议（save_field 逐字段确认）

- **背景**：角色卡新增「内核/背景/创作目的/结局方向」四个固定必填属性，旧的一次性 generateObject 归一化既无法保证逐项由用户提供，也无法逐项确认（此前实测 deepseek-flash 会改写姓名、虚构角色）。
- **备选方案**：
  1. 沿用 generateObject + 一次性确认——无法满足「必填项必须在生成时提供并逐项确认」
  2. 让 LLM 自由对话后整体提交角色卡——确认粒度粗，且终态参数由模型重组仍有漂移风险
  3. 字段协议：13 个扁平字段（FIELD_NAMES）映射 schema；`save_field` 在 execute 内代码强制「打印总结→用户确认→反馈修正」；`submit_character` 由代码从已确认记录组装并 zod 校验
- **结论**：方案 3。确认语义由代码而非提示词保证；终态数据全部来自已确认字段，模型无法在提交时篡改。姓名虽未列入固定属性，但作为关系引用与大纲引用的句柄一并设为必填。
- **附带决策**：submit_character 校验失败（缺必填）时循环必须继续，因此角色 Agent 不设 stopTool（hasToolCall 会在工具被调用时无条件停止），改用 isDone 判定 + maxSteps 兜底。

## 2026-09-16 ReAct 运行器新增续跑机制

- **背景**：端到端实测 deepseek-flash 偶发「宣告要调用提交工具却只输出文本」即自然结束轮次（同版本模型时好时坏），终态工具未被调用导致整个工作流失败。
- **备选方案**：整体重跑（丢问答上下文、重复消耗用户输入）；换强模型（成本高，且问题仍可能偶发）。
- **结论**：runReactAgent 增加 `isDone` 判定——循环自然结束但终态未达成时，注入提醒消息并携带 `response.messages` 完整历史续跑（默认 1 次）。实测该机制在真实失败场景下成功恢复。

## 2026-09-15 ReAct Agent 采用「终态工具」模式（closure + hasToolCall）

- **背景**：世界观/大纲 subAgent 需要产出结构化结果，且世界观 Agent 需要「向用户提问」的多轮交互。
- **备选方案**：
  1. 解析 `result.steps[].toolResults` 提取结果——依赖 SDK 内部结构（v5→v7 字段多次更名），脆弱
  2. 用 `generateObject` 直接结构化生成——拿不到多轮工具循环，无法 ask_user
  3. 终态工具：提交工具的 `inputSchema` 即结果 schema，execute 闭包记录，`stopWhen: hasToolCall(终态工具)` 停止
- **结论**：方案 3。结果天然经 zod 校验、不依赖 toolResults 内部形状、多轮工具循环由 generateText 原生承载；`stepCountIs(maxSteps)` 作为死循环兜底。

## 2026-09-15 CLI 输入采用双模式（TTY: readline / 管道: 自维护行缓冲）

- **背景**：端到端自动化验证需脚本喂入 stdin；实测 Bun 1.4 的 `node:readline` 在管道输入下，两次 `question` 之间会丢弃剩余缓冲行并触发 close（Node 正常，最小复现确认）。
- **备选方案**：等 Bun 修复（不可控）；全部改用 `Bun.stdin` 手写（TTY 下失去行编辑/回显）。
- **结论**：按 `process.stdin.isTTY` 分流——TTY 用 readline（交互体验完整），管道用自维护行缓冲（顺序消费全部输入）。代价是两套实现，但接口统一为 `LineSource`。

## 2026-09-15 主角/核心冲突收集用 generateObject 归一化 + 用户确认门（而非完整 ReAct Agent）

- **背景**：需求只指定世界观与大纲为 ReAct Agent；主角/冲突是单轮「自由文本 → 结构化」转换。
- **权衡**：为二者也建 ReAct Agent 会增加交互轮次与 token 成本，收益低；但纯 generateObject 有模型漂移风险（实测 deepseek-flash 把「记者顾清欢」改写成「修复师苏晚」并虚构第二角色）。
- **结论**：generateObject + 强约束 prompt（用户描述置尾、明确禁止改写姓名/增减角色）+ 打印角色卡后用户确认（不满意重新描述）。实测收紧后姓名/身份逐字保留；确认门兜底残余漂移。

## 2026-09-15 state 采用 NovelStateStore 接口 + 内存实现；ID 用 UUID

- **背景**：需求要求调用 Agent 前生成唯一 ID 作为后续 state 入库主键，但 state 持久化暂不做。
- **备选方案**：直接用全局变量不抽象（DB 接入时侵入工作流）；先接 SQLite（超出本次范围）。
- **结论**：定义 `NovelStateStore` 接口（get/create/update），提供 `MemoryNovelStateStore`；ID 在工作流入口用 `crypto.randomUUID()` 生成，全程透传。DB 接入时新增实现类即可，工作流零改动。

## 2026-09-14 LLM 接入层选型：Vercel AI SDK + 官方 DeepSeek provider

- **背景**：项目需要接入 LLM 能力，首个目标厂商为 DeepSeek，且未来大概率接入其他厂商。
- **备选方案**：
  1. 直接裸调 DeepSeek HTTP API——无抽象层，换厂商成本高，工具调用协议需自行实现
  2. Vercel AI SDK（`ai`）+ `@ai-sdk/openai-compatible` 自建 DeepSeek 接入——灵活但需自己维护 baseURL 与模型映射
  3. Vercel AI SDK + 官方 `@ai-sdk/deepseek`——厂商差异由官方包收敛，社区生态成熟
- **权衡依据**：AI SDK 的统一 `LanguageModel` 抽象使后续换/加厂商只改 provider 层；`@ai-sdk/deepseek` 在官方 monorepo（vercel/ai）内维护，模型 ID 与接口跟随官方更新。
- **结论**：采用方案 3。`zod` 同步引入（AI SDK 的 tool 参数 schema 依赖）。

## 2026-09-14 TypeScript 固定在 6.x 而非 7.x

- **背景**：`bun init` 默认安装 TS 7.0（原生版），但 typescript-eslint 8.70 支持范围为 `>=4.8.4 <6.1.0`，加载即报错退出。
- **备选方案**：等 typescript-eslint 支持 TS 7（不可控）；按官方建议 TS 6/TS 7 并存（需双包别名，增加维护复杂度）。
- **结论**：devDependencies 固定 `typescript@6` 并移除 `^7` peer 声明。tsconfig 严格选项在 TS 6 下全部可用；待 typescript-eslint 支持 TS 7 后可平滑升级。

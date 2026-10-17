# workflows 模块架构

> 业务编排层：多步骤流程、模型与工具组合所在层，是依赖图的最高层（仅被应用入口 `apps/agent/src/index.ts` 导入）。
> 项目级蓝图见根目录 `ARCHITECTURE.md`；本文件描述模块内部的文件职责、协作协议与数据流。

## 文件职责

```text
apps/agent/src/workflows/
├── index.ts                  # 模块出口：createNovel / planActChapters / regenerateOutline /
│                             #   polishCharacter / writeChapter / collectWorldview /
│                             #   createOutline / planChapters
├── create-novel.ts           # 主编排 createNovel：ID 生成 → 参数收集（类型/叙事视角/受众/核心冲突逐项入 novels）→ 大纲生成确认（连带新增角色与伏笔清单）→
│                             #   入库（title/logline/theme 回填 novels）→ 新增角色兜底 diff + 自动创建入库 → 伏笔清单挂幕入库 → 会话收尾
│                             #   （章节规划不自动衔接，由客户端单幕会话逐幕手动发起）
├── plan-act-chapters.ts      # 单幕章节规划编排 planActChapters：校验（含世界观已确认）并从库组装上下文
│                             #   （含本幕未绑伏笔回传 LLM）→ 复用章节 Agent（确认门，save_chapters 附新增角色
│                             #   与新伏笔清单及绑定指令连带确认）→ saveChapters 幕下建章 → 新增角色兜底 diff
│                             #   + 自动入库（伪 Outline + extraContext 章节列表全文）→ 新伏笔入库与既有未绑
│                             #   地点确定性入库（location-intake，置于角色自动入库之前）→
│                             #   伏笔绑定登场章（foreshadow-intake，同大纲两流程收尾动作）；
│                             #   客户端幕节点「规划本幕章节」入口的会话（headless plan-chapters 模式）
├── polish-character.ts       # 角色 AI 润色编排 polishCharacter：读库校验（小说/角色（传 ID 时）/世界观）
│                             #   → generateObject 以表单当前值+世界观单轮全字段润色（无确认门，
│                             #   结果经 headless polish-result 消息回传客户端表单，不自动入库）
├── regen-outline.ts          # 大纲重新生成编排 regenerateOutline：读库校验（小说/世界观/角色）→
│                             #   幕数/部数表单 → 复用大纲 Agent（库内世界观/角色与小说创作条件，历史缺失项省略，清单连带确认）→
│                             #   saveOutlineTreeNewVersion 新版本入库（旧版与旧章降级归档）→
│                             #   新增角色兜底 diff + 自动创建入库 → 伏笔清单挂接新版幕入库
│                             #   （旧伏笔行保留不动，均同 createNovel 收尾动作）；
│                             #   客户端「📖 大纲」组头刷新按钮的会话（headless regen-outline 模式）
├── write-chapter.ts          # 章节正文生成编排 writeChapter：读库校验（小说/章节点/概述/世界观——
│                             #   已有正文不再拒绝，getDocumentByChapter 有行即 isRegen 重生成路径）
│                             #   → 叙事视角注入（novels.narrative_pov 随【小说】块带出并要求全程保持，
│                             #   未采集零注入）→ 写作偏好生效值解析（resolveSystemWritingPrefs 读系统级环境变量 +
│                             #   shared resolveChapterLength / resolveStylePassScore——小说级 novels 行 >
│                             #   系统级 > 内置默认 2000~3000 / 80；篇幅 min/max 整体覆盖、半设乱序
│                             #   防御性跳过；小说级覆盖生效时 notify 通报）
│                             #   → 库内组上下文（部/幕/角色状态与迁移阶段（chapter-context）/
│                             #   跨幕前后章衔接（chapter-context））+ 本章绑定伏笔
│                             #   （foreshadow-context：登场卡片 / 回收卡片+登场章上下文）+ 参考文风
│                             #   （style-reference-store 按启用过滤，非空注入【参考文风】段于
│                             #   prompt 尾部 + 模仿要求 + notify 名单；无启用文风零改动）
│                             #   → 生成-校验-修订循环（最多 MAX_REVIEW_ROUNDS=3 轮；写作要求篇幅条用
│                             #   生效值、角色变化计划条件条——编号顺延于伏笔/文风之前）：写作模型
│                             #   getWritingModel() 单轮 generateText（无确认门；WRITING_MODEL_*
│                             #   未配置回落 Agent 模型）→ chapter-review 三段校验（reviewModel 缺省
│                             #   Agent 会话模型）产出整改报告 → isReportPassing 通过跳出 /
│                             #   未达标按报告修订式重写（原 prompt +【上一版正文】+【整改报告】块，
│                             #   末条要求替换为按报告逐条修订），3 轮仍未达标保底保存最后一版并警告
│                             #   → 正文落文件（document-writer：<输出目录>/<小说ID>/<部名>/<章名>.md，
│                             #   顶层即创作 ID——同名小说天然分属不同文件夹、改名零联动；章名冲突 -N 后缀；
│                             #   file_path 以绝对路径落库——换输出目录后旧正文仍指向真实位置）
│                             #   → 元数据入库绑定（isRegen 走 replaceChapterDocument 覆盖替换，
│                             #   事务提交后清理旧正文文件——路径相同跳过防误删、幂等容忍缺失；
│                             #   失败回滚删新文件旧正文零影响）；
│                             #   进度经 Options 注入的 onProgress 回调透传（WriteProgressEvent，
│                             #   报告附着 revising/saving 事件）；客户端章节点「✍️ 生成本章正文」
│                             #   /「🔄 重新生成」入口的会话（headless write-chapter 模式）
├── chapter-context.ts        # 章节上下文纯函数模块（无 LLM、零 schema 迁移）：
│                             #   buildCharacterStateContext——角色状态与迁移阶段（阶段**相对目标章**计算，
│                             #   非随生成顺序更新的全局状态：早于起始章=未开始沿用此前状态 / 进行中=
│                             #   旧值+目标值+诱因+过渡描述 / 本章=结束章=本章完成变化 / 晚于结束章=沿用
│                             #   新值；开放区间到起始章后恒为进行中）。登场角色按章节点 character_ids
│                             #   收窄（未绑定回退全库并置 fallbackToLibrary）；**基准卡 + 已结束迁移**
│                             #   组成该章角色参考，进行中与结束章的变化作为**独立计划块**传入，不让目标
│                             #   新值提前覆盖既有特征；诱因与过渡描述标注为创作计划（不得当作已发生），
│                             #   全部已设定字段进入参考；创作目的/轨迹/结局方向独立标为作者指导（所有阶段均不代表角色已知信息或已发生结局）。
│                             #   同版本已确认的全部已结束迁移历史另成块，完整携带角色/字段/旧值→目标/
│                             #   起止章/诱因/过渡/序号/修订；后一段进行中也保留前段历史。计划区间结束
│                             #   不代表正文已兑现，未开始/草案/取消项不注入。
│                             #   只取**同一全书大纲版本**（章所在树根节点 version）的已确认迁移——换版后
│                             #   旧迁移保留在旧版本、不混入新版；倒序生成/重生成旧章天然不使用未来状态。
│                             #   buildNeighborChapterContext——前后章按**全书章序**（部→幕→章，可跨幕）
│                             #   取紧邻前/后章：上一章正文在 PREVIOUS_CHAPTER_PROSE_BUDGET=8000 内整条
│                             #   注入（超出/缺失回退概述），下一章只取概述。migrationPhaseAt 纯函数判定
│                             #   四阶段；write-chapter 直接导入，不入 index.ts 出口
│                             #   resolveChapterTreePosition 解析目标章所属树版本与完整章序，角色迁移与
│                             #   伏笔最终回收判断共用；支持归档目标章，版本之间不比较章序。
├── chapter-review.ts         # 校验 subAgent 模块（无 ReAct、无确认门）：reviewChapter 三段独立
│                             #   单轮 generateObject——①内容约束（世界观 JSON/章名概述/本章伏笔行/
│                             #   本章角色状态与变化计划行——与写作者同源，含 character 维度：过早改变、
│                             #   缺少过渡、未保留应保留特征；foreshadow 维度区分阶段回收与最终回收，
│                             #   最终章未完整揭露真相、未解释表面行为或继续悬置须报问题）
│                             #   ②文风相似度评分（合格线经 input.stylePassScore 注入——write-chapter
│                             #   按写作偏好「小说级 > 系统级 > 内置默认 80」解析后传入，评分 prompt /
│                             #   isReportPassing / formatRevisionBlock 同一条线；无启用样本 skipped 且段事件零发送，
│                             #   模型只产 score/rationale/suggestions、skipped 包装由代码完成）
│                             #   ③前后自洽（仅正文全文，kind 由代码补全 consistency 杜绝类别漂移）
│                             #   → 组装 ReviewReport（round 透传、passed 按 isReportPassing 回填——
│                             #   LLM 不自评）+ isReportPassing 通过判定纯函数 + formatRevisionBlock
│                             #   报告→修订 prompt 块纯函数；校验模型（reviewModel）与段开始回调
│                             #   （onProgress）注入；调用异常直接抛错（编排层终止会话零残留）；
│                             #   write-chapter 直接导入，不入 index.ts 出口
├── foreshadow-context.ts     # 本章伏笔 prompt 块构建纯函数（无 LLM）：buildChapterForeshadowContext——
│                             #   绑定到本章的伏笔分登场/回收两组（同章种收只归回收组标「登场于本章」），
│                             #   登场注入卡片（表面行为/隐藏真相/注意度/埋线方式/创作目的/服务角色名），
│                             #   回收组按登场章全局章序升序注入卡片 + 登场章上下文（正文优先——
│                             #   FORESHADOW_PROSE_BUDGET=8000 字符预算内整条注入不截断；未生成/文件
│                             #   缺失/超预算降级该章概述）+ 多步回收既往回收章概述；去重回收点按目标树
│                             #   全书章序取最大值，前段标阶段回收保留核心真相，最终章要求完整揭露并收尾；
│                             #   回收点缺失/跨版标阶段无法确定，不猜测最终章，阶段指令与审校同源；
│                             #   登场章按 ID 直查不过滤版本（归档旧版章照常解析）；节点不可解析仅注入
│                             #   卡片标注；无绑定伏笔返回空 lines（调用方零注入零通知）；
│                             #   write-chapter 直接导入，不入 index.ts 出口
├── location-intake.ts       # 确定性地点入库模块（无 LLM）：filterNewLocations 兜底 diff（trim 全等剔除
│                             #   库内已有名 / 清单内去重 / 空名剔除）+ plantNewLocations 逐条 addLocation
│                             #   （name + description）并 notify——三编排确认后、角色自动入库之前调用
├── chapter-cast-intake.ts    # 确定性登场角色绑定回填模块（无 LLM）：bindChapterCasts 把规划逐章登场
│                             #   清单（plan.chapters 与 saveChapters 返回节点按序 index 对齐）经
│                             #   resolveCharacterIds 名字→ID 解析后，setChapterCharacters 单事务回填
│                             #   章节点 character_ids——置于新增角色自动建卡之后（绑定前名单全部角色
│                             #   已入库、ID 必然存在）；未匹配名逐章剔除并 notify 警告（防御层），
│                             #   解析后为空的章不传条目、保持 null 未绑定语义
├── foreshadow-intake.ts      # 确定性伏笔入库模块（无 LLM）：resolveCharacterIds 角色名→ID + buildChapterOrder
│                             #   全书章全局序（部sort→幕sort→章sort——回收/登场顺序校验依据）+ 伏笔三路径
│                             #   入库与绑定（resolveCharacterIds 角色名→ID（trim 全等 /
│                             #   重复名幂等 / 未解析名单返回）+ plantOutlineForeshadows 大纲路径（幕名→幕节点、
│                             #   服务角色名→ID，未匹配逐条跳过并 notify 警告）+ plantChapterForeshadows 章节路径
│                             #   （新伏笔带登场章与幕归属入库 + 绑定指令把既有未绑伏笔按 1-based 序号 patch
│                             #   登场章，序号越界 / 章名未匹配跳过并警告）；模块内编排直接导入，不入 index.ts 出口
└── agents/                   # 业务 subAgent（每个对应一个创作环节）
    ├── worldview-agent.ts    # collectWorldview：多轮追问补全世界观（终态工具 submit_worldview）
    ├── character-agent.ts    # createCharacter：字段协议逐字段确认角色卡（save_field / submit_character）
    │                         #   另导出 FIELD_NAMES / FIELD_SPECS / missingRequiredFields / assembleCharacter 纯函数
    ├── outline-agent.ts      # createOutline：生成「部→幕」两级大纲并过用户确认门（save_outline）；
    │                         #   list_characters 角色库查询工具，save_outline 经 saveOutlineInputSchemaFor
    │                         #   结构化入参附 newCharacters 新增角色清单（清单内名字不得重复）与 newForeshadows
    │                         #   伏笔清单（挂幕不挂章，清单内表面行为不得重复）随大纲进确认门连带确认；
    │                         #   产物 OutlineSubmission = outline + newCharacters + newForeshadows；
    │                         #   入参 OutlineContext 松绑（genre/narrativePov/audience/coreConflict 可选，重生成仅喂库内数据）；
    │                         #   system prompt 含叙事视角要求（限知视角的信息遮蔽与揭示节奏、多视角轮换在幕梗概体现切换安排、全书不得漂移）
    │                         #   另导出 outlineSchemaFor（恰好 M 部共 N 幕 refine 强校验）
    ├── chapter-agent.ts      # planChapters：单幕拆章——按幕梗概与情节点推荐章节数量、概述与
    │                         #   逐章登场角色清单（chapters[].characters——库内与新角色全列、
    │                         #   全员必填 role：库内=在本章中的作用 / 新角色=设定级一句话定位），
    │                         #   过用户确认门（save_chapters；chapterPlanSchema 强约束 1~12 章、
    │                         #   每章登场至少 1 人、章内名字不重复）；list_characters 角色库查询工具 +
    │                         #   prompt 已有角色行、叙事视角行（narrativePov 有则带——概述与登场安排
    │                         #   须与该视角一致）与本幕未绑伏笔行（概述尽量点名出场角色、体现伏笔表面
    │                         #   行为），save_chapters 经 saveChaptersInputSchema 结构化入参（顶层
    │                         #   newCharacters 清单已取消——确认视图的新增角色由 execute 内
    │                         #   collectChapterCharacters + filterNewCharacters 对角色库现查派生，单一事实源）
    │                         #   附 newForeshadows 新伏笔清单（登场章名，表面行为不得重复）与
    │                         #   foreshadowBindings 绑定指令（序号不得重复）随规划进确认门连带确认；
    │                         #   产物 ChapterPlanSubmission = { plan, newForeshadows, foreshadowBindings }
    │                         #   （第三参注入 novelId / characterStore / unboundForeshadows）
    ├── auto-character-agent.ts # 新增角色自动创建 autoCreateCharacters（无确认门，仅 notify 通报）：
    │                         #   依据世界观与大纲为清单逐个填充角色卡并调 save_character 终态工具入库，
    │                         #   isDone 按清单数量判定、maxSteps=4+清单×2 耗尽抛可读错误保留已入库卡；
    │                         #   增可选 extraContext 附加上下文块（章节规划全文等填卡一手素材，纯增量、
    │                         #   既有调用方零改动）；
    │                         #   另导出 filterNewCharacters 编排层兜底 diff 纯函数（trim 全等剔除库内
    │                         #   已有名 / 清单内同名去重保留首个 / 空名剔除）与 collectChapterCharacters
    │                         #   （章节规划逐章登场清单→幕级并集，跨章同名保首个 role——确认视图派生
    │                         #   与编排层建卡共用）；独立导出供写作期工作流复用
    ├── character-agent.test.ts  # 字段协议纯函数单测（规格完整性 / 缺失列表 / 组装校验）
    ├── outline-agent.test.ts    # 结构校验单测（outlineSchemaFor 恰好 M 部共 N 幕：通过 / 拒绝含提示 /
    │                         #   底座每部至少一幕；saveOutlineInputSchemaFor：清单合规通过 / 项内字段
    │                         #   空串拒绝 / 清单内名字重复拒绝 / 部幕强校验仍生效；newForeshadows
    │                         #   必填数组、空数组合法 / 清单内表面行为重复拒绝）
    ├── chapter-agent.test.ts    # saveChaptersInputSchema 单测（规划含逐章登场清单合规通过 / 清单缺省、
    │                         #   空清单、空名空定位、同章重名拒绝 / 章节数量约束 1~12 不回归；
    │                         #   newForeshadows / foreshadowBindings 必填数组、空数组合法 /
    │                         #   伏笔表面行为与绑定序号重复拒绝）
    ├── auto-character-agent.test.ts # 角色自动创建单测（filterNewCharacters 剔除库内已有名与去重 /
    │                         #   空清单透传；autoCreateCharacters 全清单入库含守卫拒绝后修正 /
    │                         #   maxSteps 耗尽抛可读错误且已入库卡保留；extraContext 进 prompt、
    │                         #   不传不出现）
    ├── plan-act-chapters.test.ts # 单幕规划集成（mock ai + FakeChannel + 临时 SQLite：
    │                             #   成功路径（确认视图与新增角色自动入库断言）/ 空清单跳过（零 LLM 调用）/
    │                             #   六类前置校验 / 确认门中止）
    ├── regen-outline.test.ts     # 大纲重生成集成（mock ai + FakeChannel + 临时 SQLite：
    │                             #   新版本入库断言 / 确认循环 / 三类前置校验）
    ├── polish-character.test.ts  # 润色集成（mock ai + FakeChannel + 临时 SQLite：两流润色 /
    │                             #   prompt 断言 / 三类前置校验）
    ├── write-chapter.test.ts     # 正文生成集成（mock ai 双脚本 + FakeChannel + 临时 SQLite：入库绑定 /
    │                             #   prompt 上下文断言 / 五类前置校验 / 模型未配置 / 空正文 /
    │                             #   参考文风注入四态 / 本章伏笔注入三态——无绑定零注入零通知回归、
    │                             #   登场与同章种收块位置与编号顺延与通知统计、回收登场章正文
    │                             #   优先与概述兜底及降级计数 / 校验循环五路径——一次通过事件序列
    │                             #   与校验模型注入、第 2 轮修订 prompt 含上一版正文与整改报告、
    │                             #   3 轮保底保存与警告通知、无文风 skipped、校验抛错零残留）
    ├── chapter-context.test.ts   # 章节上下文单测（临时库 + 临时 output：migrationPhaseAt 四阶段与
    │                             #   单章变化与开放区间；buildCharacterStateContext 各章参考与计划块
    │                             #   （未开始/进行中/本章完成/已结束）、同字段多段链与不同字段并行、
    │                             #   倒序生成不用未来状态、旧版本迁移不混入新版、绑定收窄与回退全库、
    │                             #   创作指导字段声明；buildNeighborChapterContext 跨幕前后章与
    │                             #   上一章正文预算回退）
    ├── chapter-review.test.ts    # 校验模块单测（mock ai generateObject 按 prompt 段落标识脚本化：
    │                             #   三段按序调用与载荷断言（③不含世界观/概述）、无文风 skipped
    │                             #   零调用、onProgress 段开始事件序列、isReportPassing 四态、
    │                             #   formatRevisionBlock 格式、调用抛错透传）
    ├── foreshadow-context.test.ts # 本章伏笔上下文单测（临时库 + 临时 output：无绑定空 lines /
    │                             #   登场卡片全字段与可选缺省与服务角色解析兜底原 ID（SQL 直插模拟
    │                             #   数据异常）/ 回收登场章正文优先 / 未写概述兜底 / 文件缺失兜底 /
    │                             #   多步回收既往章概述筛选 / 预算按章序扣减超限整条降级 / 回收组
    │                             #   登场章序排序 / 同章种收归回收组 / 登场章不可解析标注 /
    │                             #   归档登场章照常解析）
    ├── create-novel.test.ts     # 全流程集成（mock ai + FakeChannel + 临时 SQLite，含通道中止）
    ├── location-intake.test.ts # 地点入库单测（filterNewLocations 三态剔除；plantNewLocations 入库 /
    │                           #   notify 通报 / 空清单零调用）
    └── foreshadow-intake.test.ts # 伏笔入库单测（resolveCharacterIds trim 全等 / 未解析名单 / 重复幂等；
                              #   大纲路径——幕未匹配与服务角色全失败跳过、部分失败剔除并警告；
                              #   章节路径——新伏笔带登场章与幕入库、绑定序号越界 / 章名未匹配跳过、
                              #   合法绑定 patch appearChapterId）
```

> 命名辨析：本目录 `agents/` 是业务 subAgent；兄弟层 `src/agents/react.ts` 是跨模块复用的通用 ReAct 运行器（底层设施），二者不是同一层。

## 依赖边界

- `create-novel.ts` → `ai`（generateObject）、`providers/`（model）、`ui/`（UiChannel：全部提问 / 确认 / 展示的唯一出口）、`@novel/shared`（schemas）、`state/`（types / id / memory-store / novel-store / character-store / worldview-store / outline-store / foreshadow-store / location-store）、本模块 `agents/`（createOutline + auto-character-agent 的 autoCreateCharacters / filterNewCharacters）、`foreshadow-intake.ts`（plantOutlineForeshadows 大纲伏笔挂幕入库）与 `location-intake.ts`（filterNewLocations + plantNewLocations 新增地点确定性入库，置于角色自动入库之前）——大纲只入库不落文件（theme 随确认回填 novels 行），不依赖 `output/`
- `plan-act-chapters.ts` → `ui/`（UiChannel 注入）、`state/`（novel-store——theme / narrativePov 自 novels 行读取 / outline-store / worldview-store / character-store / foreshadow-store——`listUnboundByAct` 回传本幕未绑伏笔——location-store——list_locations 工具与地点入库）、`@novel/shared`（Outline 类型——自动创建的伪 Outline 上下文）、本模块 `agents/`（planChapters + auto-character-agent 的 autoCreateCharacters / filterNewCharacters / collectChapterCharacters）、`chapter-cast-intake.ts`（bindChapterCasts 各章登场名单名字→ID 回填绑定）、`foreshadow-intake.ts`（plantChapterForeshadows 新伏笔入库与既有未绑伏笔绑定登场章）与 `location-intake.ts`（章节规划新增地点确定性入库）——不直接触碰 `ai` / `providers/`（模型调用都在章节 Agent 内）；store 可注入（缺省默认 SQLite store，测试替换）
- `regen-outline.ts` → `ui/`（UiChannel 注入）、`state/`（novel-store / worldview-store / character-store / outline-store / foreshadow-store / location-store）、本模块 `agents/`（createOutline + auto-character-agent 的 autoCreateCharacters / filterNewCharacters）、`foreshadow-intake.ts`（plantOutlineForeshadows 新版大纲伏笔挂接新版幕入库）与 `location-intake.ts`（新版大纲新增地点确定性入库，地点只增不改）——不直接触碰 `ai` / `providers/`；store 可注入（缺省默认 SQLite store，测试替换）
- `polish-character.ts` → `providers/`（model——单轮 generateObject，无 ReAct Agent）、`ui/`（UiChannel 注入）、`state/`（novel-store / worldview-store / character-store）；store 可注入（缺省默认 SQLite store，测试替换）
- `write-chapter.ts` → `ai`（generateText）、`providers/`（writing-model getWritingModel——写作模型，非 Agent 会话模型；agent-model model——校验模型缺省实例；writing-prefs resolveSystemWritingPrefs——系统级写作偏好环境变量读取，Options.systemWritingPrefs 可注入替身）、`@novel/shared`（resolveChapterLength / resolveStylePassScore 生效值解析纯函数）、`ui/`（UiChannel 注入）、`state/`（novel-store / outline-store / worldview-store / character-store / document-store / style-reference-store / foreshadow-store / migration-store）、`output/`（document-writer 正文落盘与登场章/上一章正文读取 + outline-writer OUTPUT_DIR）、本模块 `foreshadow-context.ts`（本章伏笔 prompt 块）、`chapter-context.ts`（角色状态与迁移阶段 + 跨幕前后章）与 `chapter-review.ts`（三段校验 + 判定 + 修订块）；model / reviewModel / onProgress / outputDir / systemWritingPrefs 与各 store 可注入（缺省 getWritingModel() + agent-model model + 不回调 + NOVEL_OUTPUT_DIR + resolveSystemWritingPrefs() + 默认 SQLite store，测试替换）
- `chapter-review.ts` → `ai`（generateObject）、`zod`、`@novel/shared`（review schema——reviewIssueSchema 复用为 ① 的输出 schema，② ③ 的输出 schema 模块内定义、kind 补全由代码完成；① 的 characterLines 与写作者同源）；LanguageModelV4 与 onProgress 注入，无 channel / store 依赖
- `chapter-context.ts` → `@novel/shared`（character-migration 的字段读写与 applyCharacterField、CHARACTER_FIELD_SPECS、outline-order 的 buildChapterOrder）、`state/`（character-store / migration-store / outline-store / document-store——类型导入）、`output/`（document-writer readDocumentArtifact 读上一章正文）；纯函数、零 LLM、不经 UiChannel，不入 index.ts 出口
- `foreshadow-context.ts` → `state/`（outline-store / character-store / document-store / foreshadow-store——类型导入）、`output/`（document-writer readDocumentArtifact 读登场章正文）、本模块 `chapter-context.ts`（resolveChapterTreePosition 目标章所属树版本与全局章序——最终回收判定、回收组排序与既往回收章筛选）；纯函数、零 LLM、不经 UiChannel
- `agents/*.ts` → `ai`（tool）、`zod`、`src/agents/`（runReactAgent）、`tools/`（ask-user 工厂，经注入的 channel 提问）、`ui/`（UiChannel 注入：确认门携带结构化视图）、`@novel/shared`（schemas）、`state/types`（仅 outline-agent 需要 NovelParams 类型）、`state/character-store`（outline-agent 与 chapter-agent 的 list_characters 角色库查询、auto-character-agent 的 save_character 入库依赖，可注入、缺省默认 SQLite store）
- 下层不得反向依赖本模块；`createCharacter` 目前仅供模块内编排使用，未入 `index.ts` 出口
- `CreateNovelOptions` 注入 `channel`（必填）与 `store / characterStore / worldviewStore / novelStore / outlineStore / foreshadowStore`，store 缺省用内存 state store + 各默认 SQLite store（测试与未来换实现不改编排代码）
- `PlanActChaptersOptions` 注入 `channel`（必填）+ `novelId / actNodeId` 与 `novelStore / outlineStore / worldviewStore / characterStore / foreshadowStore`（缺省默认 SQLite store）
- `RegenOutlineOptions` 注入 `channel`（必填）+ `novelId` 与五个 store（缺省默认 SQLite store）

## 主工作流数据流（createNovel）

1. **ID 与初始化**：调用 Agent 前确定小说 ID、建立 novels 行和持久化运行记录；恢复按缓存步骤重建内存 state。已完成运行直接返回缓存结果，已有 outlined 状态仍须补完 pending 运行收尾
2. **命名（可选）**：`channel.askText`（optional），跳过则大纲确认后以大纲标题回填
3. **novels 名称回填**：行已在第一条提问前建立，用户命名（如有）在此单独保存，先于角色/世界观入库
4. **【1/6】类型**：静态热门类型菜单单选 + 自定义输入
5. **【2/6】叙事视角**：静态菜单单选（第一人称 / 第三人称限知 / 第三人称全知 / 多视角轮换）+ 自定义输入，选完即存 novels.narrative_pov（第五项创作条件）
6. **【3/6】受众**：`generateObject`（audienceSuggestionSchema）推断候选 → 用户多选 + 自由补充，只存标签
7. **【4/6】世界观**：`channel.askText` 初始描述 → `collectWorldview(desc, channel)` → `channel.present(worldview)` → `worldviewStore.saveWorldview`（upsert 入库）
8. **【5/6】角色**：`for(;;)` 循环（至少一名叙事定位含「主角」的角色）→ `createCharacter(desc, characters, channel)` → `characterStore.addCharacter` 每卡确认后立即增量入库
9. **【6/6】核心冲突**：自由文本 → `generateObject`（coreConflictSchema）归一化
9. **state 落 params**：status → gathering
10. **幕数与部数**：`askInt` 幕数（3-20，回车默认 5）→ `askInt` 部数（1~幕数，回车默认 1）
11. **大纲**：`createOutline(params, { novelTitle, actCount, partCount, novelId, characterStore, locationStore }, channel)`（大纲 Agent 配 `list_characters` 角色库查询工具与 `list_locations` 地点库查询工具；save_outline 结构化入参附 newCharacters 新增角色清单、newForeshadows 伏笔清单与 newLocations 新增地点清单——项内名字 / 表面行为 / 名字不得重复，随大纲进确认门连带确认）→ `channel.present(outline full)` 两级完整展示 → `saveOutlineTree` 整树事务入库（部根节点 / 幕子节点，version=1/当前/planned，梗概与关键情节点随节点入列——供写作期按幕内容生成章节大纲）→ state 收尾与回填（status → outlined；`novelStore.updateNovel`——未命名时 name = outline.title，description = outline.logline，theme = outline.theme ?? null）→ **新增地点确定性入库**（置于角色自动入库之前——毫秒级同步代码先行即「与角色同批次」，不并行避免 notify 交错）：`filterNewLocations` 兜底 diff（剔除库内已有名 / 去重 / 空名剔除，空清单跳过）→ `plantNewLocations`（`location-intake.ts`）逐条 addLocation（name + description）并 notify「✨ 地点已入库：…」+ 汇报名单 → **新增角色自动入库**：`filterNewCharacters` 兜底 diff（trim 全等剔除库内已有名、清单内同名去重保留首个、空名剔除——不信任模型的「新增」判定），空清单跳过（零 LLM 调用），非空经 `autoCreateCharacters` 依据世界观与大纲自动填充角色卡逐张入库（notify 通报进度与名单）。auto 块置于收尾回填之后；其抛错时主运行仍标为失败，恢复复用已确认大纲、剔除已入库角色并继续伏笔收尾；随后**伏笔清单挂幕入库**（置于角色自动入库之后——伏笔清单可能引用本轮自动入库的新角色，服务角色 ID 需角色先入库）：非空时 `plantOutlineForeshadows`（`foreshadow-intake.ts`）确定性创建（幕名→当前版本幕节点、回收幕名→回收幕节点（漂移不阻塞伏笔入库仅留空警告）、服务角色名→角色 ID，未匹配逐条跳过并 notify `⚠️ 伏笔跳过…` 警告不阻塞其余条目），notify「✨ 本次大纲伏笔已入库 N 处（M 处因幕名/角色名未匹配跳过）」，空清单跳过
12. **收尾**：notify 引导从书库幕节点「规划本幕章节」手动发起——大纲确认后会话即结束（run_finished），不自动规划章节（2026-09-25 起，决策见根 DECISIONS）

## 单幕章节规划数据流（planActChapters）

客户端幕节点卡「规划本幕章节」入口（headless `plan-chapters <novelId> <actNodeId>` 模式）触发的独立会话，与 createNovel 共用章节 Agent 与入库函数：

1. **前置校验**（可读错误，协议入口转 fatal error）：`novelStore.getNovel` → 幕节点存在 / 同小说 / 类型 act → 幕 summary 与 keyPlotPoints 非空（旧数据缺内容拒绝）→ `getOutlineNode(parentId)` 得所属部 → 首次规划要求无 chapter 子节点，恢复已有运行则验证已缓存的章节点及原大纲版本（不重新建章）→ `worldviewStore.getWorldview` 有记录（世界观已确认——自动创建新角色需要世界观依据，前置拒绝避免「确认入库后才发现无法自动创建」的中间态，对齐 regen-outline / write-chapter 校验惯例）
2. **上下文组装（全取自库）**：novels.name / description（书名 / logline）+ 部名 / 部梗概 + 幕名 / 幕梗概 / 情节点 + 角色库已有角色行（名 + 叙事定位，随 `planChapters` 第三参注入——与 list_characters 工具同源）+ 本幕「未绑登场章」的伏笔清单行（`foreshadow-store.listUnboundByAct`，随第三参 `unboundForeshadows` 注入、prompt 以「序号. 表面行为——隐藏真相」带出，无则不带）；theme 自 novels 行读取（theme 列——大纲确认后回填，NULL 未采集省略）
3. **复用 `planChapters`**（save_chapters 确认门循环：`saveChaptersInputSchema` 结构化入参 = 规划本体含逐章登场清单（每章至少 1 人、章内名字不重复）+ newForeshadows 新伏笔清单（登场章名，表面行为不得重复）与 foreshadowBindings 绑定指令（回传清单序号 + 登场章名，序号不得重复），确认视图连带展示逐章登场名单与「✨ 本次规划新增角色（确认后自动入库）」——新增角色由 execute 内对角色库派生「✨ 本次规划新增伏笔（确认后自动入库）」「🔗 伏笔绑定（确认后生效）」，拒绝规划即连带作废清单；系统提示约束概述尽量点名出场角色、体现伏笔表面行为）→ `saveChapters` 幕下批量建章 → notify 入库统计；阶段通知 `chapter`
4. **新增地点确定性入库与新增角色自动入库**（确认入库后）：**地点先行**——`filterNewLocations` 兜底 diff（剔除库内已有名 / 去重 / 空名剔除，空清单跳过）→ `plantNewLocations`（`location-intake.ts`）逐条 addLocation（name + description）并 notify（置于角色自动入库之前——同大纲流程语义）；随后登场角色处理：`collectChapterCharacters`（逐章登场清单→幕级并集，跨章同名保首个 role）+ `filterNewCharacters` 对角色库兜底 diff 派生「本次规划新增角色」（空派生跳过、零 LLM 调用）；非空 notify「✨ 本幕规划引入了 N 个新角色，正在自动填充角色卡并入库…」→ 组「部/幕」两级伪 Outline（结构匹配 Outline，章不进——规划产物与章节点结构不变）+ `extraContext`=本次规划的章节列表全文（每章行带登场名单），经 `autoCreateCharacters` 以世界观逐卡入库 → 汇总 notify「✨ 本次章节规划新增 N 个角色已自动入库：<名单>」；随后**各章登场角色绑定回填**（置于建卡之后、伏笔之前——名单含本轮新入库角色）：`bindChapterCasts`（`chapter-cast-intake.ts`）把逐章登场名单名字→ID（resolveCharacterIds）解析后经 setChapterCharacters 单事务回填章节点 character_ids，notify「🎭 正在绑定各章登场角色（N 章）…」+「✨ 各章登场角色已绑定：N 章共 M 人次」；随后**伏笔处理**（置于角色自动入库之后——新伏笔的服务角色名可能引用本轮自动入库的新角色）：`plantChapterForeshadows`（`foreshadow-intake.ts`）确定性执行——newForeshadows 新伏笔带登场章（章名→本次规划章节点）与幕归属（act_node_id 挂本幕）入库；foreshadowBindings 把回传清单中的未绑伏笔按 1-based 序号 patch `appear_chapter_id` 到登场章（对称校验：已有回收章时登场须更早——`buildChapterOrder` 全书章全局序）；foreshadowRecoverBindings 把「本幕待回收」清单（`listUnrecoveredByAct`：回收幕=本幕且回收章未绑，随章节 Agent 第三参注入、prompt 带登场章信息回传）伏笔 patch `recover_chapter_ids` 到回收章（同伏笔多条合并=多步回收；登场未绑 / 回收不晚于登场跳过警告）；章名 / 服务角色名未解析、序号越界逐条跳过并 notify 警告（不阻塞其余条目），notify「✨ 本次规划伏笔入库 N 处、绑定 M 处、回收绑定 K 处（X 处未匹配跳过）」；run_finished 携带小说 ID 供客户端刷新详情（新角色随详情可见）

## 章节正文生成数据流（writeChapter）

客户端章节点卡「✍️ 生成本章正文」/「🔄 重新生成」入口（headless `write-chapter <novelId> <chapterNodeId>` 模式）触发的独立会话，不走 ReAct Agent——无确认门（确认在客户端：重生成经 ChapterRegenDialog 弹框确认覆盖；流程两者完全一致——生成 → 三段校验-修订循环 → 落盘入库）：

1. **前置校验**（可读错误，协议入口转 fatal error）：小说存在 → 章节点存在 / 同小说 / 类型 chapter → summary 非空（旧数据缺概述拒绝）→ 所属幕与部节点存在 → worldviews 有记录（世界观已确认）；已有正文不再拒绝——getDocumentByChapter 有行即 isRegen（notify「🔄 重新生成中（将覆盖现有正文）」）
2. **上下文组装（全取自库）**：书名 / logline + 世界观 JSON + 登场角色摘要行（名/定位/外貌/性格/渴望/恐惧——按章节点 character_ids 绑定过滤注入本章阵容；未绑定（null，17 版前旧章）或绑定角色全不在库时回退全库注入并 notify「🎭 本章未绑定登场角色（旧数据）」）+ 部名与部梗概 + 幕名与幕梗概及关键情节点 + 本章名与概述 + 同幕前后章名与概述（衔接上文、给下文留空间）+ **本章绑定伏笔**（可选增强——`buildChapterForeshadowContext`：登场注入卡片；回收组按登场章全局章序升序注入卡片 + 登场章上下文（正文优先、FORESHADOW_PROSE_BUDGET=8000 预算内整条注入，未生成/文件缺失/超预算降级该章概述）+ 多步回收既往回收章概述；同章种收只归回收组标「登场于本章」；【本章伏笔】块插【下一章】块后【参考文风】前，写作要求条件附加编号顺延，生成前 notify「🔮 本章伏笔：登场 N 条、回收 M 条（X 条降级）」；无绑定伏笔零注入零通知）+ 参考文风（可选增强，不新增校验分支——style-reference-store 按启用过滤，非空在 prompt 尾部【下一章】块后插【参考文风】段（每条「（名字）\n内容」）并在写作要求附模仿条（模仿叙事语言 / 句式节奏 / 描写风格，不抄袭具体情节与专有名词），生成前 notify「🖋️ 本次参考文风：名单」；无启用文风零注入零通知）
3. **生成-校验-修订循环**：初稿 notify（✍️ 正文生成中 / 📏 小说级偏好覆盖 / 🔮 本章伏笔 / 🖋️ 参考文风）后进入 `for round in 1..MAX_REVIEW_ROUNDS`——onProgress(drafting|revising，revising 附上一轮报告) → `getWritingModel()`（按 WRITING_MODEL_PROVIDER 所选接口类型调用对应官方 SDK，环境变量 WRITING_MODEL_* 配置，任一未配置回落 Agent 会话模型）单轮 `generateText`（初稿 prompt 与既有形态逐字节一致；修订轮追加【上一版正文】+【整改报告】块于写作要求前，末条要求替换为按报告逐条修订），写作要求篇幅条用**写作偏好生效值**（`resolveSystemWritingPrefs`（providers/writing-prefs）读系统级环境变量 + shared resolveChapterLength / resolveStylePassScore 按「小说级 novels 行 > 系统级 > 内置默认 2000~3000 / 80」解析——篇幅 min/max 整体覆盖、半设乱序防御性跳过）、只输出正文文本；空结果拒绝。→ `reviewChapter`（chapter-review，reviewModel 缺省 Agent 模型——三段独立单轮 generateObject：①内容约束（世界观/章节概述/本章伏笔 lines 同源）②文风评分（合格线 = 生效阈值；无启用样本 skipped 零调用）③前后自洽（仅正文）；段开始 onProgress(review-*)，每段结束再回传 stageResult；无文风样本回传 skipped 且零模型调用）→ 报告 passed 判定：通过 notify「✅ 校验通过（第 N 轮）」跳出；未达标且 round<3 notify「♻️ 第 N+1 轮：上一版未达标准（内容 X 处、文风 Y 分、自洽 Z 处），按整改报告修订重写…」进入下一轮；round=3 仍未达标 notify「⚠️ 3 轮未全部达标，保存最后一版（…）——建议人工复核或重新发起生成」保底
4. **元数据入库绑定**：onProgress(saving，附最终报告) → 正文落盘（<小说ID>/部名/章名层级，同名章冲突 -N 后缀不覆盖；写失败包「输出目录不可写」上下文直达 fatal error），文件先落、库后入，库失败回滚删文件 → 元数据单事务入库（file_path 绝对路径 + 字数，内容不进库）+ 章节点回写 document_id 并置 status=completed——首次生成走 `saveChapterDocument`，isRegen 走 `replaceChapterDocument` 覆盖替换（删旧行插新行），事务提交后清理旧正文文件（新旧路径相同跳过防误删、幂等容忍缺失）→ notify 保存路径与字数；run_finished 携带小说 ID 供客户端刷新详情（headless 把 onProgress 映射为 write-progress 协议消息；校验依赖 Agent 模型，会话始终要求 AGENT_MODEL_API_KEY）；大纲重生成只降级归档章节点，documents 行与正文文件保留（旧正文与归档章的关联留存）

## 大纲重新生成数据流（regenerateOutline）

客户端「📖 大纲」组头刷新按钮经警告弹框确认后（headless `regen-outline <novelId>` 模式）触发的独立会话，与 createNovel 共用大纲 Agent 与确认门（决策见根 DECISIONS）：

1. **前置校验**（可读错误，协议入口转 fatal error）：小说存在 → worldviews 有记录（世界观已确认）→ characters 至少一行
2. **数量表单**：`askInt` 幕数（3-20 默认 5）→ `askInt` 部数（1~幕数 默认 1）——「章节的数量由用户填写表单获取」的落点，各部幕数由模型分配
3. **复用 `createOutline`**（入参仅 worldview + characters，不喂旧大纲；save_outline 确认门：预览-反馈-调整循环，newCharacters 新增角色清单与 newForeshadows 伏笔清单随大纲连带确认）→ `saveOutlineTreeNewVersion` 单事务版本切换（旧当前行含章全部降级归档、新树 max+1 当前）→ `novelStore.updateNovel` 回填 description（logline）与 theme；阶段通知 `outline`
4. **新增角色自动入库**：同 createNovel 收尾动作——`filterNewCharacters` 对新版大纲清单兜底 diff（剔除库内已有名；空清单跳过、零 LLM 调用）→ `autoCreateCharacters` 依据世界观与新版大纲自动填充角色卡逐张入库（清单已在确认门连带确认过，写库前透明可拦截）
5. **伏笔清单挂接新版幕入库**：同 createNovel 收尾动作——`plantOutlineForeshadows` 对新版大纲 newForeshadows 清单确定性创建（幕名取当前版本树即新版幕节点、服务角色名→角色 ID，未匹配跳过并警告；置于角色自动入库之后）；**旧伏笔行保留不动**（regen 只降级大纲节点，旧伏笔 act_node_id 指向已降级旧幕、悬挂但无害——`listUnboundByAct` 按当前 act 查询天然不回传旧版伏笔，决策见根 DECISIONS）

入库时机小结：novels 初始化即建（先于其余表）｜worldviews 确认后 upsert｜characters 每卡确认后增量｜outlines 大纲确认后整树事务入库——首版走 saveOutlineTree（version=1），重新生成走 saveOutlineTreeNewVersion（旧树与旧章降级归档、新树 max+1 当前；梗概与关键情节点随节点入列，keyPlotPoints 仅幕节点；title/logline/theme 回填 novels 行——大纲 JSON 产物已退役不再落盘；客户端浏览读 outlines 表节点）｜chapters 章节规划确认后幕下事务批量入库（saveChapters，概述随节点入列；各章登场角色 ID 绑定在建卡后经 setChapterCharacters 单事务回填 character_ids——null=未绑定旧章，正文生成回退全库注入；仅客户端单幕规划会话调用——新建小说流程不自动规划章节；随旧版降级归档、绑定随行保留）｜章节规划新增角色（逐章登场清单派生）：chapters[].characters 随规划进确认门连带确认（确认视图 newCharacters 由 `collectChapterCharacters` + `filterNewCharacters` 派生——所见即入库所得，顶层清单已取消），确认入库后编排层同函数派生 → `autoCreateCharacters`（世界观 + 部/幕伪 Outline + `extraContext` 章节列表全文含登场名单）自动填充角色卡入库——无确认门（清单已在规划确认门过目），逐卡 notify 通报，version=1 入 characters 表；planActChapters 会话收尾动作与大纲两流程一致，空派生跳过（零 LLM 调用）｜documents 章节正文由 writeChapter 会话生成后**先落文件**（<输出目录>/<小说ID>/<部名>/<章名>.md，人类可直接阅读编辑；顶层即小说创作 ID——改名零文件联动）**再登记元数据**（file_path 绝对路径 + 字数；历史旧行可能存相对路径由读取层兼容解析）并绑定章节点（一章一份，重复生成被拒；随小说级联删除并清理文件；大纲重生成只降级归档章节点、正文行与文件保留——旧正文与归档章的关联留存）｜大纲新增角色（newCharacters）：清单随大纲进确认门连带确认，编排层 `filterNewCharacters` 兜底 diff（剔除库内已有名 / 去重 / 空名剔除）后经 `autoCreateCharacters` 自动填充角色卡入库——无确认门（清单已在大纲确认门过目），逐卡 notify 通报，version=1 入 characters 表；createNovel 与 regenerateOutline 两流程收尾动作一致，空清单跳过（零 LLM 调用）｜locations 地点：随大纲（新建 / 重生成）与章节规划确认门连带确认（save_outline / save_chapters 附 newLocations——名字 + 一句话定位），确认入库后（角色自动入库之前）经 `location-intake.ts` 确定性入库（filterNewLocations 兜底 diff + plantNewLocations 逐条 addLocation，无 LLM 调用）；重生成地点只增不改，旧地点保留不动｜foreshadows 伏笔：随大纲 / 规划确认门连带确认（save_outline 附 newForeshadows 挂幕+可选回收幕、save_chapters 附 newForeshadows 登场章 + foreshadowBindings 登场绑定 + foreshadowRecoverBindings 回收绑定指令），确认入库后（角色自动入库之后）经 `foreshadow-intake.ts` 确定性入库——createNovel / regenerateOutline 走 plantOutlineForeshadows 挂幕与回收幕（regen 挂接新版幕节点、旧伏笔行保留不动）、planActChapters 走 plantChapterForeshadows（新伏笔带登场章与幕归属、既有未绑伏笔按绑定指令 patch appear_chapter_id（对称校验）、本幕待回收伏笔按回收绑定指令 patch recover_chapter_ids（多步回收合并））——无 LLM 调用，幕名 / 章名 / 角色名 / 序号未匹配或顺序不满足逐条跳过并 notify 警告，回收状态仍手动维护；客户端编辑表单手动规划回收章（全书章序过滤，登场未绑禁用）｜style_references 参考文风：不走创作流、无确认门——客户端结构树「🖋️ 文风」组经 query CLI 三命令（add-style / update-style / delete-style）直写库（内容 TEXT 直接进库不落文件，enabled 控制正文生成注入），writeChapter 生成时按启用过滤注入（无启用文风零注入）｜NovelState 仍为内存态。

## subAgent 协作协议（确认门四 Agent 共性，auto-character-agent 例外见末条）

- **终态工具模式**：`submit_worldview` / `submit_character` / `save_outline` / `save_chapters` 的 `inputSchema` 即结果 schema，execute 闭包记录结果，`isDone` 判定终态；终态未达成时抛错（带 stepCount 与最后输出）。结构化组装一律由代码完成（assembleCharacter / schema.parse），杜绝模型在提交时改写数据
- **停止策略二分**（见根 ARCHITECTURE「ReAct 终态工具模式」）：
  - 提交不会被否决（worldview）：`stopTool: submit_worldview` + maxSteps 16
  - 终态内含用户最终确认、可被拒需继续修订（character / outline / chapter）：不设 stopTool，maxSteps 30 / 12 / 12 + `isDone` + `continuationHint` 续跑提示
- **确认视图原子出现**：字段摘要、角色卡汇总、大纲草稿（含新增角色清单）、章节规划一律作为 `channel.askConfirm` 的 view 载荷与提问原子绑定（并发工具调用时按通道串行化依次呈现），禁止先展示再问
- **用户终止约定**：`ask_user` 返回「用户已终止输入」（EOF）时，Agent 须停止提问并基于已有信息提交/结束，不得拖延
- **确认循环**：用户给出修改意见 → 工具返回 `{ ok: false, feedback }` → 模型按反馈处理后重新调用终态工具，直到确认
- **例外（auto-character-agent）**：无人值守——无确认门（清单已在大纲确认门连带确认）、不配 ask_user；`save_character` 为「多终态工具」（每卡调用一次），不能设 stopTool（hasToolCall 首次调用即停），`isDone` 按清单数量判定 + maxSteps=4+清单×2 兜底；execute 内三重守卫（清单外角色 / 重复保存 / 库内同名）返回 `{ ok: false, note }` 要求模型自行修正重试

## 测试

模块内测试两层：单测聚焦**可脱离 LLM 的纯函数**——字段协议（`FIELD_SPECS` 完整性、`missingRequiredFields`、`assembleCharacter` 过 schema）、大纲结构校验（`outlineSchemaFor` 恰好 M 部共 N 幕；`saveOutlineInputSchemaFor` 新增角色清单合规通过 / 项内字段空串拒绝 / 清单内名字重复拒绝 / 部幕强校验仍生效）、章节规划入参校验（`saveChaptersInputSchema`：规划 + 新增角色清单均合规通过且空清单合法 / newCharacters 缺失或项内字段空串拒绝 / 清单内名字重复拒绝 / 章节数量约束 1~12 不回归）地点入库（`location-intake.test.ts`：filterNewLocations 库内同名剔除 / 清单去重 / 空名剔除 / 空清单；plantNewLocations 入库与 notify、空清单零调用）；与角色自动创建（`filterNewCharacters` 剔除库内已有名与去重、空清单透传；`autoCreateCharacters` 经 mock ai 全清单入库含守卫拒绝后修正、maxSteps 耗尽抛可读错误且已入库卡保留；`extraContext` 传入时进 prompt、不传不出现）；伏笔入库（`foreshadow-intake.test.ts`：`resolveCharacterIds` trim 全等 / 未解析名单 / 重复幂等；`buildChapterOrder` 部→幕→章展开；大纲路径幕未匹配与服务角色全失败跳过、部分失败剔除并警告、回收幕匹配挂幕与漂移留空警告；章节路径新伏笔带登场章与幕入库、绑定序号越界 / 章名未匹配跳过、合法绑定 patch appearChapterId（含对称校验）、回收绑定成功与多步回收合并 / 越界 / 章名漂移 / 登场未绑 / 顺序不满足跳过）；`create-novel.test.ts` / `plan-act-chapters.test.ts` / `regen-outline.test.ts` / `polish-character.test.ts` / `write-chapter.test.ts` 为**全流程 / 会话集成测试**——mock `ai` 模块（generateObject 返回 fixture、generateText 按脚本逐轮执行工具 execute）+ `FakeChannel` 脚本化应答 + 临时 SQLite，不依赖真实 LLM 验证全链路：create-novel 全流程至大纲入库（theme 回填 novels 行、不再落 JSON）、新增地点确定性入库（先于角色）与新增角色自动入库（清单角色入库 / 库内已有名被兜底 diff 剔除零调用 / 空清单跳过；章节规划已不在新建流程内）与伏笔挂幕入库；plan-act-chapters 含六类前置校验（小说不存在 / 异小说 / 非幕 / 旧数据缺内容 / 已有章节 / 世界观未确认）、成功路径断言确认视图与新增角色自动入库、空清单跳过（零 LLM 调用）与确认门中止，及本幕未绑伏笔回传与确认后新伏笔入库 / 既有伏笔绑定登场章 / 本幕待回收伏笔绑定回收章（prompt 清单与落库断言）、新增地点确定性入库（库内同名剔除、先于角色）、本幕无伏笔且规划未引入时跳过伏笔处理（零额外调用）；regen-outline 断言新版本入库（旧树旧章降级归档 / description 与 theme 回填）、确认循环（拒绝→反馈→再确认）与三类前置校验，及新版清单地点确定性入库（地点只增不改）与角色自动入库、伏笔挂接新版（第 2 版）树的幕节点而非旧版归档节点；write-chapter 断言文件落盘层级与内容（临时 output 目录注入）、元数据绑定（document_id 回写 + status=completed）、同名冲突后缀 / 库失败回滚删文件 / prompt 上下文与前置校验 / 写作模型未配置回落 Agent 模型 / 空正文拒绝，及参考文风注入四态（无启用文风零注入零通知 / 启用样本段落位置与模仿要求与名单通知 / 全停用同无文风 / 混合只注入启用条）与本章伏笔注入三态（无绑定零注入零通知且写作要求编号不变 / 登场与同章种收的块位置（【下一章】后【参考文风】前）与条件要求编号顺延与 notify 统计 / 回收登场章正文优先与未写概述兜底及 notify 降级计数），及校验-修订循环五路径（一次通过——进度事件序列 drafting→review-*→saving 且校验调用全部用注入的 reviewModel / 第 2 轮修订——修订 prompt 含【上一版正文】与【整改报告】块且 saving 报告 round=2 / 3 轮保底——照常落盘入库 + 警告通知含文风分与问题计数 / 无启用文风——文风段 skipped 零调用且事件序列无 review-style / 校验抛错——会话终止零残留）与写作偏好三态（小说级覆盖——篇幅进 prompt、合格线进校验 prompt 与通过判定、覆盖生效通报 / 系统级回落——小说未设置时用注入系统值、半设篇幅防御性忽略 / 默认回归——无配置时 2000~3000 字）及重生成三路径（覆盖替换成功——行数仍 1、旧文件清理、notify「🔄 重新生成中」/ 库故障回滚——旧行与旧文件零影响、新文件无残留 / 校验抛错保旧——保存段未到达旧行旧文件原样）；`chapter-review.test.ts` 单测（mock generateObject 按 prompt 段落标识脚本化）：三段按序独立调用与载荷断言（③不含世界观/概述）、文风合格线随入参注入（prompt 与 schema 描述用注入阈值）、无文风样本 skipped 零调用、onProgress 段开始事件序列、isReportPassing 多态（①③有 issue 不通过 / 文风低于合格线不通过 / 恰达合格线或 skipped 通过 / 阈值可注入抬高或放低——缺省 shared 内置默认 80）、formatRevisionBlock 问题逐条类别建议与文风分数段（合格线随入参）、校验调用抛错透传；`foreshadow-context.test.ts` 单测覆盖分组（登场卡片全字段与可选缺省、同章种收只归回收组）、登场章上下文兜底链（正文优先 / 未写概述 / 文件缺失 / 节点不可解析 / 归档章照常解析）、预算护栏（按登场章序扣减、超限整条降级不截断）、回收组章序排序与多步回收既往章概述筛选，及服务角色名解析（未匹配兜底原 ID——SQL 直插模拟 store 校验拦不住的手工改库异常）。真实 LLM 端到端验证记录见 PROGRESS。

## 小说创作条件的持久化边界

createNovel 在类型选择、叙事视角选择、受众多选与补充、核心冲突归一化展示完成时，分别调用 NovelStore.updateNovel 保存 genre / narrativePov / audience / coreConflict；后续中止不撤回已采集结果。regenerateOutline 从小说行读取各非 null 条件（含叙事视角）传入 OutlineContext；旧小说缺失项省略，沿用大纲 Agent 缺省策略。共享字段 schema、JSON 编解码、迁移与详情契约见根 ARCHITECTURE.md。

## 伏笔最终回收与审校（2026-10-14）

大纲 Agent 的 system prompt 要求本次大纲所有幕名全书唯一（跨部不重名）；章节 Agent 要求同一幕内章名唯一（不同幕可重名）。两者均要求提交前改写重名，并同步伏笔清单中的幕名/章名引用。这是 prompt 软约束，暂不增加 schema 或数据库名称唯一约束，也不更换现有按名称匹配的绑定契约。

`resolveChapterTreePosition` 返回目标章所属全书大纲版本与其完整章序，角色迁移和伏笔判定共用排序依据。`foreshadow-context` 对去重的 `recoverChapterIds` 取章序最大者为最终回收章；数组顺序、幕内 sort 和卡片 `recoveryStatus` 不影响判断。非最终回收章标「阶段回收」，按概述推进线索或局部揭示，保留核心真相；最终章须完整揭露真相、解释表面行为与真相的联系并完成收尾，最终收尾要求优先于概述中推迟揭露或继续悬置的描述，概述未提及也不能豁免；其余情节遵循概述，summary 审校不能仅因落实最终收尾而报偏离。任一回收点缺失或不属于目标树版本则标「无法确定」，不猜测最终点。登场章可引用归档资料，同章种收及登场章不可解析不影响已确定的最终收尾要求；无本章绑定仍零注入。

写作初稿、修订稿与内容审校共用带阶段指令的伏笔 lines。eval 的 foreshadow 维度检查阶段章提前完整揭底、最终章未完整揭露/未解释联系/继续悬置，返回带具体建议的伏笔问题，经既有三轮修订闭环处理；三轮仍未达标的保底保存与警告策略保持。测试验证请求契约、最终点计算和整改入库链路，真实模型的揭露效果需人工阅读验收。


## 角色迁移回归边界（2026-10-14）

`chapter-context.describePlan` 每条计划带角色基准姓名，保证同章多角色、同字段且相同旧值时仍可识别归属。`write-chapter` 与内容审校继续消费同一份行列表；集成测试检查两名角色的目标同时出现在写作与审校请求中。迁移链拒绝与原子表单提交由 state/query 负责，陈旧范围由客户端消费修订快照负责，不进入正文生成状态。测试矩阵与真实模型人工验收见根目录 `docs/character-migration-testing.md`，定向入口为 `bun run test:character-migrations`。

## 正文进度的文风阈值（2026-10-15）

writeChapter 在会话开始解析一次 stylePassScore，所有 WriteProgressEvent（初稿/修订、各校验段开始/结束、保存）携带同一数值。headless 将其透传为 shared write-progress 的可选字段，客户端沿用该会话值判定文风阶段警告与建议，避免实时配置变化或固定分数导致与审核结果不一致；旧消息缺字段时使用 shared 内置默认 80。工作流测试同时检查默认阈值与小说级覆盖阈值在各阶段及修订轮次的传递。

## 主流程缓存与恢复（2026-10-15）

- `workflow-cache.ts` 定义 `WorkflowCacheOptions`（resumeRunId / runStore / onRun）与 `runCachedWorkflow`：领取运行、检查缓存格式、记录完成结果，异常标 failed 并释放占用。`step` 同连接同步事务保证副作用和结果标记同时提交；`asyncStep` 保存已完成子任务的 JSON 结果，并注入消息缓存上下文。
- `create-novel.ts` 保存命名、类型、视角、受众、世界观输入与确认结果、按角色序号区分的输入/整卡/入库结果、冲突、数量表单与确认大纲。小说行及运行在第一条问题前建立，失败后可从书库找回；恢复重建内存 state。已存在 outlined state 不等于收尾完成。
- `plan-act-chapters.ts` 固定原上下文、伏笔清单的序号→ID 映射与确认产物。建章、地点、登场名单、伏笔分别有原子完成标记；已建章不再阻断同运行恢复。执行旧伏笔绑定时重读当前记录，暂停期间已编辑或删除的条目跳过并通知，不覆盖用户修改。
- `regen-outline.ts` 保存原树及确认新纲；版本切换与步骤结果同事务，恢复不重复升版。三流程在使用缓存节点前检查当前树，版本漂移可读拒绝。
- 三流程自动建卡重试时重新 diff 当前角色库，复用已保存的部分卡片；确认过的新增角色/地点/伏笔清单先缓存，再执行收尾。同步入库中途失败时整块回滚。文件产物允许按同一确认大纲重复覆盖，数据库节点不重复创建。
- `resume-workflow.ts` 只接 runId，从持久化运行读取模式/小说/目标再分发；不接受调用方另指定目标。完成的运行读取最终结果，不重复提问或写库。

恢复粒度为主步骤边界：失败子 Agent 从已保存输入重新运行；`agents/react.ts` 留存的 SDK 原生消息用于追溯，当前不重新注入以续接子 Agent 内部问答。运行完成与消息记录分离，不能凭工具消息认定业务已提交。正文生成及角色润色不接入本期缓存。根架构文档维护表结构、锁与客户端入口的主说明。

## 伏笔多幕回收规划（2026-10-16）

1. 大纲 `save_outline` 新增伏笔必须提供 `recoverActNames` 非空数组。按部/幕全书顺序验证回收幕真实、唯一且不早于登场幕，允许同幕；注意度保持 1 易发现、10 难发现，越难发现可拉长跨度。
2. `plan-act-chapters.fullOutlineContext` 从当前树按部→幕→章排序，注入所有幕梗概、情节点及已规划章节概述。`chapter-agent.validateChapterForeshadowPlan` 在确认前强校验本幕既有清单覆盖、序号与真实唯一幕章引用；先安排既有伏笔，再安排新伏笔。回收清单带完整回收幕名及阶段/最终回收幕提示。
3. 章节新增伏笔 `recoveryPlan` 为非空幕列表；本幕指定本次真实后章、已有后幕指定真实章，尚未规划后幕章列表为空。`foreshadow-plan.resolveChapterRecoveryPlan` 在确定性入库时将计划解析为全部幕 ID 与已有章 ID；旧确认产物无新字段时按原格式继续，不猜回收点。
4. `foreshadow-intake` 先处理已有登场/回收绑定，既有回收章合并去重；跨幕逆序规划时按已知埋设幕顺序允许先绑回收章，同幕须先确定具体登场章。通过 `editRevision` 区分人工更新与其他幕正常追加，自动绑定不递增计数，用户编辑/删除继续优先。
5. 确认前重试刷新两清单，确认结果连同当次序号映射缓存；旧确认缓存回退原 planning-context 映射。确认后暂停期间原空章计划幕已有章时，`foreshadow-refinement.ts` 的受限细化 Agent 只选择这些伏笔在指定幕的真实回收章，确认与缓存后沿原步骤入库；原章规划和其他设定保持。
6. `foreshadow-context.describeRecoveryStage` 同时考虑全部计划回收幕。后续幕尚未细化时，当前已知最晚回收章仍是阶段回收；计划幕缺失或跨版本时不猜最终章。写作与内容审核继续复用同源上下文。

新增计划解析模块依赖 shared 和 state 类型，不进行模型调用；存储/迁移、查询与展示协议的主说明见根 ARCHITECTURE.md。具体设计和验收矩阵见 docs/superpowers/specs/2026-10-16-foreshadow-recovery-plan-design.md。

## 角色润色输出契约（2026-10-16）

polish-character.ts 的 polishedCharacterSchema 在 characterSchema 基础上将顶层与 basicInfo 全部字段设为必填，与现有全字段补全要求一致，兼容 OpenAI 严格结构化输出；角色输入、存储与固定基准的 schema 保持可选字段不变。polish-character.test.ts 另经独立子进程加载真实 AI SDK / 工作流 / 内存 SQLite，模拟 OpenAI 对 strict required 的递归检查，并验证 DeepSeek / Claude 正常润色与基准零改动。跨模块修复与验收见根 PROGRESS.md。

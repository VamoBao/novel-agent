# 模块架构（项目根目录级）

> Bun workspaces monorepo（`apps/*` 应用 + `packages/*` 共享包）的项目级架构蓝图，维护在根目录；`apps/agent/src/workflows/` 已建立模块文档（见该目录的 `ARCHITECTURE.md` 与 `PROGRESS.md`），其余子目录仍以本文件为准。

## 分层结构

```text
apps/agent/src/
├── index.ts              # CLI 入口：API Key 检查、运行 createNovel、错误处理与优雅退出
├── headless.ts           # 协议模式入口：stdio JSON 行协议（hello 握手 / 消息分发 / EOF·SIGTERM 收尾；
│                         #   会话收尾——run_finished / fatal error 发出后 destroy stdin 解除读监听保活，
│                         #   宿主不关 stdin 管道也能在 stdout 排干后自然退出，否则子进程驻留会卡死客户端下次启动）；
│                         #   argv 选会话模式——无参 = 新建小说全流程，`plan-chapters <novelId> <actNodeId>`
│                         #   = 单幕章节规划，`regen-outline <novelId>` = 大纲重新生成（新版本入库），
│                         #   `polish-character <novelId> [characterId] <formJson>` = 角色 AI 润色
│                         #   （编辑流传角色 ID、新建流不带；结果经 polish-result 消息回传），
│                         #   `write-chapter <novelId> <chapterNodeId>` = 章节正文生成（生成 → 三段
│                         #   校验+修订循环 → 落盘入库；进度经 write-progress 消息回传——onProgress
│                         #   回调映射协议消息；校验经 Agent 模型，会话始终要求 AGENT_MODEL_API_KEY）
├── query.ts              # 库查询与管理入口：一次性 CLI——查询（list / get——get 携带世界观+角色
│                         #   +大纲当前版本节点+章节正文 documents+伏笔 foreshadows+地点 locations
│                         #   +参考文风 style_references 全量行按入库顺序）+ 管理
│                         #   （rename / pin / unpin / favorite / unfavorite / delete
│                         #   / set-writing-prefs——写作偏好小说级覆盖（篇幅 min/max + 文风合格线
│                         #   三项全量替换，null=清空回落系统设置，schema 成对校验）
│                         #   / add-character / update-character——角色版本化编辑
│                         #   / update-foreshadow——伏笔编辑（完整卡转 patch：可选空=清空、回收章保留现值）
│                         #   / add-style / update-style / delete-style——参考文风管理），
│                         #   stdout 单行 JSON（契约见 @novel/shared query.ts）
├── cli/
│   └── prompt.ts         # 终端输入原语（askLine/askSelect/askMultiSelect/askConfirm/askInt）
│                         #   TTY → node:readline；管道/文件 → 自维护行缓冲（见 DECISIONS）
│                         #   并发读取自动串行化：FIFO 排队，提示语轮到时才写入，
│                         #   兼容 ReAct Agent 一步内并行调用多个需用户确认的工具
├── ui/                   # 交互通道层：UiChannel 接口（channel.ts）+ UserAbortedError（aborted.ts）
│                         #   + CliChannel 终端实现（视图文本渲染）/ ProtocolChannel（stdio JSON
│                         #   协议实现）/ FakeChannel 测试替身；
│                         #   业务层（workflows/agents/tools）交互与输出的唯一出口
├── providers/
│   ├── model-factory.ts # 模型接入层：createProviderModel(connection, instanceName) 按所选
│   │                    #   provider（openai / deepseek / claude）调用对应官方 SDK——
│   │                    #   OpenAI 显式 chat(model) 走 Chat Completions、DeepSeek 用官方包
│   │                    #   （结构化输出自动注入 JSON 指令与 schema）、Claude 走 Messages 协议；
│   │                    #   Base URL 留空按 provider 取官方默认（MODEL_PROVIDER_BASE_URLS）
│   ├── agent-model.ts    # Agent 统一配置：resolveAgentModelConfig（provider + Key + 模型名 +
│   │                     #   地址，AGENT_MODEL_* 四字段与旧 DEEPSEEK_* 兼容，provider 缺省按
│   │                     #   有效地址迁移、地址留空沿用 DeepSeek 官方默认、模型名留空仅 DeepSeek
│   │                     #   有默认值）+ describeAgentModelConfigError（非法 provider / 缺模型名
│   │                     #   的可读提示，入口启动检查用；import 期不抛错）+ createAgentModel 与
│   │                     #   导出的 model（ReAct / 归一化 / 润色 / 正文校验共用）
│   ├── writing-model.ts  # 写作模型惰性工厂 getWritingModel(): LanguageModelV4——provider 可
│   │                     #   与 Agent 不同；模型名 / Key / Base URL 三变量齐才创建实例
│   │                     #   （resolveWritingModelConfig，缺省按有效地址迁移、独立写作默认
│   │                     #   OpenAI；非法 provider 抛可读错误），任一未配置回落同一 Agent 模型
│   │                     #   实例（校验模型独立走 Agent 会话模型）
│   └── writing-prefs.ts  # 系统级写作偏好读取 resolveSystemWritingPrefs——NOVEL_CHAPTER_LENGTH_MIN/MAX
│                         #   + NOVEL_STYLE_PASS_SCORE 环境变量（客户端 childEnv 注入；协议宿主/CLI 可直设），
│                         #   非整数/越界静默归 null（该级未覆盖），与小说级共同交 shared 解析纯函数取生效值
├── agents/
│   ├── react.ts          # 通用 ReAct Agent 运行器，按 SDK step 保存原生消息
│   └── session-context.ts # AsyncLocalStorage 传递工作流消息缓存上下文
├── tools/
│   ├── ask-user.ts       # 提供给 LLM 的通用工具：向用户提问并等待回答
│   └── index.ts          # 工具注册表（汇总导出）
├── state/
│   ├── types.ts            # NovelState / NovelParams / NovelStateStore 接口
│   ├── id.ts               # generateUuidV7（封装 Bun.randomUUIDv7，同毫秒单调递增）+ generateNovelId
│   ├── memory-store.ts     # NovelState 内存实现（数据库接入前的过渡，接口不变替换实现即可）
│   ├── db.ts               # SQLite 打开与建表（novels / characters / character_versions /
│   │                       #   worldviews / outlines / documents / locations / foreshadows /
│   │                       #   style_references，外键开启；user_version 版本化迁移）
│   ├── workflow-run-store.ts # 运行记录、步骤结果、SDK ModelMessage 日志与进程互斥
│   ├── novel-store.ts      # 小说信息持久化（create/get/update；genre、narrative_pov、audience JSON、core_conflict JSON 绑定小说，读写校验；name 大纲确认后回填；
│   │                       #   updateWritingPrefs 写作偏好小说级覆盖三列全量替换——novelWritingPrefsSchema 成对校验，null=清空回落系统设置）
│   ├── character-store.ts  # 角色按创作 ID 持久化（add/get/list，读写双向 zod 校验）。固定基准：
│   │                       #   首版入库即基准、只增不改——updateCharacter 已退役（基准不可覆盖），
│   │                       #   character_versions 运行期不再写入（仅供 18→19 升级导入与追溯）
│   ├── migration-store.ts  # 角色迁移存取与链校验（addMigration / updateMigration / confirmMigration
│   │                       #   / cancelMigration / listMigrations / listMigrationVersions）——新增目标值
│   │                       #   一律非空（新增表达一次变化必须有目标，清空可选字段经编辑 patch 实现；
│   │                       #   必填字段保留字段级文案）、服务端
│   │                       #   派生旧值（起始章前最近一条同字段已确认迁移的新值，无则取基准）、
│   │                       #   章节绑定校验（同小说 / 同一全书大纲版本 / 章节点 / start ≤ end）、
│   │                       #   同字段生效区间不重叠（开放区间亦不得被后续确认跨越）、后续依赖时
│   │                       #   禁止改新值或取消、修订前整行 JSON 归档 character_migration_versions
│   │                       #   并 revision+1、sequence 角色内原子分配不复用
│   ├── worldview-store.ts  # 世界观按创作 ID 持久化（upsert/get，taboos 存 JSON）
│   ├── outline-store.ts    # 大纲树按创作 ID 持久化（add/get/list/update + saveOutlineTree 整树事务
│   │                       #   + saveOutlineTreeNewVersion 版本切换（旧当前行降级归档、新树 max+1 入库）
│   │                       #   + saveChapters 幕下批量建章，梗概与关键情节点随节点入库，读写双向 zod 校验）
│   ├── document-store.ts   # 章节正文元数据持久化（saveChapterDocument 单事务：插 documents 行
│   │                       #   （file_path + 字数，内容存文件）+ 章节点回写 document_id 并置
│   │                       #   status=completed；一章一份 chapter_id 唯一；replaceChapterDocument
│   │                       #   重生成覆盖替换（单事务删旧行插新行回写章节点，无旧行等同首次保存）；
│   │                       #   updateFilePaths 改名联动）
│   ├── location-store.ts   # 位置按创作 ID 持久化（add/list，父级同小说校验，读写双向 zod 校验；name+description
│   │                       #   最小形态与全字段形态均可入库——x/y/layer 可空，采集已接入大纲/章节规划自动入库）
│   ├── foreshadow-store.ts # 伏笔按创作 ID 持久化（add/list/update(patch)/delete 完整 CRUD，服务角色同小说校验，回收状态流转；数据层先行，采集与浏览后续接入）
│   └── style-reference-store.ts # 参考文风按创作 ID 持久化（add/get/list/update(patch)/delete 完整 CRUD，
│                              #   内容 TEXT 直接进库不落文件、enabled 启用开关——正文生成按启用过滤注入；
│                              #   读写双向 zod 校验）
├── output/
│   ├── outline-writer.ts # 大纲落盘：output/<id>.json（id 做文件名安全校验）+ readOutlineTheme 尽力读取产物主题（供单幕章节规划，缺失省略）
│   └── document-writer.ts # 章节正文落盘：output/<小说名>-<创作ID前8位>/<部名>/<章名>.md
│                         #   （顶层带 ID 去重——同名小说不共享文件夹；sanitize 段清理 +
│                         #   章名冲突 -N 后缀不覆盖）+ 读 / 移动 / 删除原语 + countWords
└── workflows/
    ├── index.ts         # 模块出口（createNovel / planActChapters / regenerateOutline / polishCharacter
    │                    #   / writeChapter / collectWorldview / createOutline / planChapters）
    ├── foreshadow-plan.ts # 多幕回收计划解析、幕序与缓存绑定合并判断
    ├── foreshadow-refinement.ts # 暂停后未来幕已有章时，仅细化原回收计划并确认
    ├── workflow-cache.ts # 主步骤缓存执行器：同步入库与标记共事务，异步复用完成值
    ├── resume-workflow.ts # 按 runId 分发原模式、小说与幕目标
    ├── create-novel.ts  # 主编排：初始化 → 参数收集 → 大纲生成确认入库 → state 收尾回填 → 新增地点确定性入库
    │                    #   → 新增角色自动入库 → 伏笔清单挂幕入库 → 会话收尾（章节规划由单幕会话手动发起）
    ├── plan-act-chapters.ts # 单幕章节规划编排：校验（含世界观已确认）并从库组装上下文（含本幕未绑伏笔）→
    │                    #   复用章节 Agent（save_chapters 附新增角色与新伏笔清单及绑定指令连带确认）→
    │                    #   saveChapters 幕下建章 → 新增地点确定性入库 → 新增角色兜底 diff + 自动入库
    │                    #   → 新伏笔入库与既有未绑伏笔绑定登场章（同大纲两条流程的收尾动作）
    ├── regen-outline.ts # 大纲重新生成编排：读库校验 → 幕数/部数表单 → 复用大纲 Agent（入参松绑，仅库内数据）
    │                    #   → saveOutlineTreeNewVersion 新版本入库（旧版与旧章降级归档）→ 覆盖产物与 description
    │                    #   → 新增地点确定性入库（同新建流程，地点只增不改）→ 新增角色自动入库
    │                    #   （兜底 diff + autoCreateCharacters，同新建流程）→ 伏笔清单挂接新版幕入库
    │                    #   （同新建流程；旧伏笔行保留不动——决策见 DECISIONS）
    ├── polish-character.ts # 角色 AI 润色编排：读库校验（小说/角色/世界观）→ generateObject 以表单值+世界观
    │                    #   全字段润色（无确认门，结果回填客户端表单，不自动入库）
    ├── write-chapter.ts # 章节正文生成编排：读库校验（小说/章节点/概述/无正文/世界观）→ 库内组上下文
    │                    #   （部/幕/前后章/角色摘要）+ 本章绑定伏笔（foreshadow-context：登场卡片 /
    │                    #   回收卡片+登场章上下文——正文优先概述兜底+预算护栏）+ 参考文风（style-reference-store
    │                    #   按启用过滤，非空注入【参考文风】段于 prompt 尾部 + 模仿要求 + notify 名单，无启用零改动）
    │                    #   → 生成-校验-修订循环（最多 MAX_REVIEW_ROUNDS=3 轮）：写作模型 getWritingModel()
    │                    #   单轮 generateText（无确认门）→ chapter-review 三段校验（Agent 模型）产出整改报告
    │                    #   → isReportPassing 通过跳出 / 未达标按报告修订式重写（原上下文+上一版正文+整改报告），
    │                    #   3 轮仍未达标保底保存最后一版并警告 → 正文落文件（层级目录）+
    │                    #   saveChapterDocument 元数据入库绑定；进度经 Options 注入的 onProgress 回调透传
    │                    #   （单段结束即回传 stageResult，完整报告在 revising/saving 回传；headless 映射 write-progress 协议消息）
    ├── chapter-review.ts # 校验 subAgent 模块（无 ReAct）：reviewChapter 三段独立单轮 generateObject——
    │                    #   ①内容约束（世界观/章节概述/本章伏笔——与写作者同源的 foreshadowContext.lines）
    │                    #   ②文风相似度评分（合格线经 input.stylePassScore 注入——write-chapter 按写作偏好
    │                    #   两级配置解析；无启用样本 skipped 零调用）
    │                    #   ③前后自洽（仅正文全文，kind 由代码补全 consistency）+ isReportPassing 通过判定
    │                    #   + formatRevisionBlock 报告→修订 prompt 块；校验模型与 onProgress 注入；
    │                    #   调用异常直接抛错（编排层终止会话零残留），不入 index.ts 出口
    ├── foreshadow-context.ts # 本章伏笔 prompt 块构建纯函数（无 LLM）：绑定到本章的伏笔分登场/回收两组
    │                    #   （同章种收只归回收组标「登场于本章」），登场注入卡片；回收组按登场章全局章序升序
    │                    #   注入卡片 + 登场章上下文（正文优先——FORESHADOW_PROSE_BUDGET=8000 预算内整条注入
    │                    #   不截断，未生成/文件缺失/超预算降级该章概述；归档旧版章按 ID 直查照常解析）+
    │                    #   多步回收既往回收章概述；按目标树全书章序最大的回收点标最终回收，要求揭露完整
    │                    #   真相并收尾，前段阶段回收保留核心真相；无绑定伏笔空 lines（调用方零注入零通知）；
    │                    #   write-chapter 直接导入，不入 index.ts 出口
    ├── foreshadow-intake.ts # 确定性伏笔入库模块（无 LLM）：resolveCharacterIds 角色名→ID（trim 全等 / 重复名幂等 /
    │                    #   未解析名单返回）+ buildChapterOrder 全书章全局序（部sort→幕sort→章sort，回收/登场
    │                    #   顺序校验依据）+ plantOutlineForeshadows 大纲路径（幕名→幕节点、服务角色名→ID、
    │                    #   回收幕名→回收幕节点——漂移不阻塞伏笔入库仅留空警告，其余未匹配跳过并警告）
    │                    #   + plantChapterForeshadows 章节路径（新伏笔带登场章与幕归属入库 + 登场绑定指令 patch
    │                    #   登场章（对称校验：已有回收章时登场须更早）+ 回收绑定指令把本幕待回收伏笔 patch
    │                    #   回收章（同伏笔多条合并=多步回收；越界/章名漂移/登场未绑/回收不晚于登场跳过并警告）
    ├── location-intake.ts  # 确定性地点入库模块（无 LLM）：filterNewLocations 兜底 diff（trim 全等剔除库内已有名 /
    │                    #   清单内去重 / 空名剔除）+ plantNewLocations 逐条 addLocation（name+description）并 notify；
    │                    #   三编排（create-novel / regen-outline / plan-act-chapters）确认后、角色自动入库之前调用
    └── agents/
        ├── worldview-agent.ts   # 世界观 ReAct Agent（多轮追问 + 终态提交）
        ├── character-agent.ts   # 角色 ReAct Agent（逐字段「发散丰富→确认→保存」：标识性字段照存原词、描述性字段扩写；终态组装校验）
        ├── outline-agent.ts     # 大纲 ReAct Agent（部→幕两级结构，用户确认门 + 幕/部数强校验；
        │                         #   list_characters 角色库查询工具，save_outline 结构化入参附
        │                         #   newCharacters 新增角色清单、newForeshadows 伏笔清单（挂幕不挂章，清单内名字 /
        │                         #   表面行为不得重复）与 newLocations 新增地点清单（名字+一句话定位，名字不得重复）
        │                         #   随大纲进确认门连带确认；另配 list_locations 地点库查询工具；
        │                         #   入参 OutlineContext 松绑——genre/audience/coreConflict 可选，重生成会话仅喂库内数据）
        ├── chapter-agent.ts     # 章节 ReAct Agent（单幕拆章：按幕梗概与情节点推荐章节数量与概述，用户确认门；单幕规划会话调用；
        │                         #   list_characters 角色库查询工具 + prompt 已有角色行与本幕未绑伏笔行——概述尽量点名
        │                         #   出场角色、体现伏笔表面行为，save_chapters 经 saveChaptersInputSchema 结构化入参附顶层
        │                         #   newCharacters 新增角色清单（名字不得重复）、newForeshadows 新伏笔清单（登场章名，
        │                         #   表面行为不得重复）、foreshadowBindings 绑定指令（序号不得重复）与 newLocations
        │                         #   新增地点清单（名字不得重复）随规划进确认门连带确认；另配 list_locations 地点库查询工具
        │                         #   连带确认；产物 ChapterPlanSubmission = plan + newCharacters + newForeshadows
        │                         #   + foreshadowBindings）
        └── auto-character-agent.ts  # 新增角色自动创建 Agent（无确认门：依据世界观与大纲为清单逐个填充角色卡并
                                     #   调 save_character 终态工具入库，isDone 按清单数量判定、maxSteps 耗尽抛
                                     #   可读错误保留已入库卡；增可选 extraContext 附加上下文——章节规划喂章级
                                     #   素材，既有调用方零改动；另导出 filterNewCharacters 编排层兜底 diff 纯函数——
                                     #   剔除库内已有名 / 清单内去重 / 空名剔除；独立导出供写作期工作流复用）

packages/shared/src/     # @novel/shared：双端共享纯 zod 层——领域 schema（model-provider（provider
                         #   三选枚举与官方默认地址 + 按有效地址迁移的生效 provider 解析纯函数，agent
                         #   侧与客户端设置弹窗共用）/ worldview / character /
                         #   character-migration（迁移记录与入参/patch 契约 + 受控字段路径枚举 +
                         #   字段读写与值校验纯函数）/ location / foreshadow / style-reference /
                         #   conflict / outline / chapter-plan / audience / outline-node）+
                         #   outline-order（buildChapterOrder 全书章序纯函数，agent 迁移链校验与
                         #   客户端共用）+ 展示视图（views）+ stdio 协议消息（protocol）+
                         #   库查询结果契约（query），agent 与客户端共同引用，零运行时依赖

apps/client/             # @novel/client：Electron 客户端（electron-vite 三段式 + React）
├── electron/
│   ├── main.ts          # 主进程：窗口（隐藏系统菜单栏——本地工具用不到）+ AgentProcess 适配（注入spawn bun headless——AgentStartOptions
│   │                    #   映射 argv（create / resume / plan-chapters / regen-outline /
│   │                    #   polish-character 含表单载荷 / write-chapter 章节正文生成）、
│   │                    #   消息 zod 复验转发、hello 版本校验、退出回收）
│   │                    #   + library 查询 / 管理 IPC（spawn 一次性查询 CLI、shared
│   │                    #   schema 复验、超时兜底；角色管理 addCharacter、角色迁移 addMigration / updateMigration /
│   │                    #   confirmMigration / cancelMigration、
│   │                    #   伏笔编辑 updateForeshadow、文风管理 addStyle / updateStyle / deleteStyle）
│   │                    #   + 模型设置 IPC（settings:get/save——settings.json 两族模型各含
│   │                    #   provider 接口类型 + Key + 模型名 + Base URL，childEnv 经
│   │                    #   resolveModelEnv 三级优先级注入八个模型变量；get 另回传
│   │                    #   effectiveProviders 生效接口类型供弹窗回显）+ 主题接线：settings.theme →
│   │                    #   applyTheme() → nativeTheme.themeSource（启动与 settings:save 后
│   │                    #   各一次，主题保存即生效）；窗口 backgroundColor 随
│   │                    #   nativeTheme.shouldUseDarkColors、updated 监听同步底色；
│   │                    #   诊断钩子 NOVEL_CLIENT_THEME=system|light|dark 强制覆盖主题
│   ├── agent-process.ts # 协议校验与生命周期宿主：串行停止/启动、close后退出、旧事件隔离；
│   │                    #   run_finished 已到但子进程仍驻留时宽限 2s 等自然关闭、超时终止回收（防 start 永久等待 close）
│   ├── terminate-agent.ts # 等待SIGTERM退出，超时升级SIGKILL
│   └── preload.ts       # contextBridge 最小 API（start（携带会话参数）/ stop / respond /
│                        #   onMessage / onExit / listNovels / getNovelDetail / rename /
│                        #   setPinned / setFavorite / delete / addCharacter / addMigration / updateMigration /
│                        #   confirmMigration / cancelMigration /
│                        #   updateForeshadow / addStyle / updateStyle / deleteStyle +
│                        #   诊断钩子读取）
├── src/                 # renderer（React）：App 页面级切换——三栏浏览主页（书库 / 结构树 /
│                        #   预览）↔ 独立创作页（CreationFlow 问答流）↔ 独立章节规划页
│                        #   （ChapterPlanFlow 幕节点「规划本幕章节」问答流）↔ 独立大纲重生成页
│                        #   （OutlineRegenFlow：弹框确认后进入，幕数/部数表单 + 大纲确认门）——
│                        #   三会话页共用 hooks/use-agent-session（agent 会话泵：消息订阅 / 提问队列 / 重启）
│                        #   + NovelListPanel（右键菜单管理：重命名 / 置顶 / 收藏 / 写作偏好
│                        #   （WritingPrefsDialog 弹窗）/ 删除
│                        #   强确认——DeleteNovelDialog 输入小说名放行）/ StructureTreePanel
│                        #   （角色与大纲分组可整组收起；角色与文风组头「＋」新增；「🖋️ 文风」组
│                        #   在大纲之后可整组收起、空组占位、停用条目带后缀；大纲树部/幕可
│                        #   展开收起，「📖 大纲」组头刷新按钮 → OutlineRegenDialog 警示弹框）/
│                        #   PreviewPane（角色卡只读 + 迁移清单、新建角色态渲染表单；伏笔/文风卡带
│                        #   编辑入口与新建文风态）/ OutlineNodeCard（幕卡
│                        #   含规划入口；章卡含正文卡与「伏笔」区块——详情 foreshadows 过滤登场/
│                        #   回收两组并解析服务角色名，`toChapterForeshadows` → `ChapterForeshadow`）/
│                        #   CharacterEditForm（仅新增：13 字段 + 7 必填校验 + AI 润色回填——基准卡只读，
│                        #   无编辑模式）/ CharacterMigrationPanel（角色卡下方「🧬 角色迁移」清单与表单：
│                        #   逐条序号/状态/修订版/字段/原值→目标值/章节区间/诱因/过渡描述 + 新增·编辑·
│                        #   确认生效·取消·复制为新草案；姓名固定，历史姓名项仅可读与取消；
│                        #   新建目标值一律必填——新增表达一次变化必须有目标，编辑可选字段留空=清空）/
│                        #   chapter-options.ts（章节点下拉选项共用）/
│                        #   character-staleness.ts（staleCastMigrations 按迁移影响范围判定章卡陈旧）/
│                        #   StyleEditForm（参考文风编辑/新建共用：
│                        #   名字 + 内容（软上限 20000 字符）+ 启用开关，编辑态附删除 confirm）/
│                        #   WritingPrefsDialog（书库右键「📏 写作偏好」弹窗：加载小说现值、
│                        #   篇幅 min/max + 文风合格线三项编辑，留空=跟随系统设置，经
│                        #   set-writing-prefs 直写库刷新详情）/ SettingsDialog（⚙️ 设置弹窗：Agent 与
│                        #   写作模型两组字段——各含**接口类型下拉框**（openai / deepseek / claude，
│                        #   回显生效值（可来自 .env / 继承环境），切换只换 Base URL 与模型名提示、
│                        #   不改写已填值，仅未编辑该组连接时保留原 provider）+ API Key + 模型名 + Base URL，
│                        #   另有「写作偏好（默认）」组
│                        #   （三字段，留空=内置默认 2000~3000 / 80）+ 「外观」主题三选——默认跟随
│                        #   系统，保存即生效；两弹窗共用 writing-prefs-form 表单解析）/
│                        #   StageBar / ViewCard / QuestionCard
├── src/styles.css       # 样式：31 个语义 CSS 变量（:root 浅色基准）+ prefers-color-scheme
│                        #   暗色媒体查询（GitHub Primer Dark 基准），规则区零硬编码色值，
│                        #   浅色值不回归
└── electron.vite.config.ts
```

## 依赖边界

- `providers/`：最底层，不依赖其他 src 目录
- `@novel/shared`（packages/shared）：纯 zod schema 包，不依赖任何工作区；apps/agent 各层经 `workspace:*` 依赖引用
- `cli/`：终端输入原语，依赖 node 内置与 `ui/aborted`（中止异常）
- `ui/`：交互通道层（UiChannel 接口与实现），依赖 `cli/`（终端原语）与 `@novel/shared`（视图类型）；业务层不得绕过通道直接触碰 `cli/prompt` 或 console 输出（ESLint 边界规则强制）
- `state/`：依赖 `@novel/shared`（schema 与纯函数类型）；migration-store 复用 character-store / outline-store 的读取（同库同连接）
- `tools/`：依赖 `cli/`（ask-user 需要读用户输入）
- `agents/`：依赖 `providers/`（模型实例）
- `workflows/`：依赖 `agents/ + tools/ + ui/ + state/ + @novel/shared + output/ + cli/ + providers/`，业务编排所在层（模块内部职责与数据流详见 `apps/agent/src/workflows/ARCHITECTURE.md`）
- 任何下层不得反向依赖上层；`apps/agent/src/index.ts` 仅依赖 `workflows/ + cli/`

## 主工作流：createNovel（src/workflows/create-novel.ts）

1. **生成 ID**：调用任何 Agent 之前 `generateNovelId()` 产出 UUIDv7，并立即写入 `novels` 表（name 用户命名或大纲标题回填，description 大纲确认后回填，author 暂未采集）；角色/世界观表经 novel_id 外键关联本表
2. **初始化与恢复**：先创建 novels 行及持久化运行记录；按 runId 或已有小说 ID 查缓存，重建内存 state、复用完成步骤。outlined 内存状态不能跳过未完成的角色/伏笔收尾；已完成运行直接返回缓存结果
3. **命名（可选）**：询问小说名称，可回车跳过——未命名时大纲确认后以大纲标题回填 novels.name；已命名时大纲 title 必须沿用该书名（novels 行创建时即携带）
4. **类型**：静态热门类型菜单单选 + 自定义输入，选择完成立即保存 novels.genre
5. **叙事视角**：静态菜单单选（第一人称 / 第三人称限知 / 第三人称全知 / 多视角轮换）+ 自定义输入，选择完成立即保存 novels.narrative_pov（第五项创作条件——大纲结构、章节规划与正文叙述全程遵循；阶段枚举 `pov` 在 `type` 之后）
6. **受众**：LLM（generateObject）按类型推断候选 → 用户多选 + 自由补充，完成后将标签与补充说明保存为 novels.audience JSON 数组
7. **世界观**：独立 ReAct Agent（`worldview-agent`）——ask_user 工具多轮追问 → submit_worldview 终态提交（schema 校验），确认后按创作 ID upsert 入库（`worldview-store`）
8. **角色**：独立 ReAct Agent（`character-agent`）——字段协议驱动（13 个扁平字段映射到角色卡 schema）：`ask_user` 征集文本 → `save_field` 逐字段「发散丰富 → 用户确认 → 保存」（标识性字段 name/gender/narrativeRole 照存用户原词不扩写，其余描述性字段以用户描述为种子扩写成 2~4 句设定文字、不照抄原话；确认与反馈在工具 execute 内代码强制）→ 必填字段（姓名、内核三维、背景、创作目的、结局方向）齐全后 `submit_character` 组装整卡并**展示给用户做最终确认**（用户确认无补充才结束；有反馈则处理后重新提交），组装由代码完成并过 schema 校验（杜绝模型漂移）；每张角色卡确认后立即按创作 ID 写入 SQLite（增量持久化，`character-store`）；外层循环支持多角色，约束至少一名主角；内核/背景/创作目的/结局方向为生成后固定不变的属性
9. **核心冲突**：自由文本 → generateObject 归一化（由来/影响/理想解决），展示后保存为 novels.core_conflict JSON 对象；上述创作条件各自入库，不等待大纲完成
10. **大纲**：先询问幕数（askInt，3-20，直接回车默认 5）再询问部数（1~幕数，默认 1）→ ReAct Agent（`outline-agent`，配 `list_characters` 角色库查询工具——返回库内全部角色名与叙事定位，梳理新增角色须先调用；另配 `list_locations` 地点库查询工具——返回库内全部地点名与定位，梳理新增地点须先调用）基于全部参数（含叙事视角——system prompt 要求情节组织与幕结构匹配视角：限知视角注意信息遮蔽与揭示节奏、多视角轮换在幕梗概体现切换安排、全书不得漂移）生成「部 → 幕」两级大纲（用户已命名时 title 沿用书名；结构经 `outlineSchemaFor(actCount, partCount)` refine 强校验恰好 M 部共 N 幕、每部至少一幕，各部幕数由模型按剧情节奏分配；登场而角色库没有的角色列入 `newCharacters` 新增角色清单——名字 + 一句话定位，清单内名字不得重复（经 `saveOutlineInputSchemaFor` 在 save_outline 入参层强校验）、库内已有角色不得列入（提示词层约束，由编排层兜底 diff 把关）；某幕安排中若有伏笔（表面事件背后隐藏着指向后续剧情的真相）列入 `newForeshadows` 伏笔清单——表面行为 + 隐藏真相 + 读者注意度 1-10 + 服务角色名（可引用角色库或 newCharacters 清单名）+ 埋设幕名（必须为本大纲真实幕名，清单内表面行为不得重复、入参层强校验）+ 可选回收幕名 recoverActName（真相揭晓的幕——入参层 refine 强校验须为真实幕名且在埋设幕之后），伏笔挂幕不挂章——登场章在后续章节规划时绑定，回收章在该回收幕章节规划时绑定；剧情发生地的真实地理场所不在地点库中的列入 `newLocations` 新增地点清单——名字 + 一句话定位，清单内名字不得重复、库内已有地点不得列入，抽象场所与一次性路过的地点不列）→ `save_outline` 内展示「剧情梗概、主题、每部概述与每幕名称概述 + 新增角色、伏笔与新增地点清单」请用户确认——确认无修改才完成，有修改意见按反馈调整后重新提交确认（循环，清单随大纲连带确认）；确认后 `saveOutlineTree` 两级入库（部为根节点、幕为子节点，整树事务，梗概与关键情节点随节点入列——供写作期按幕内容生成章节大纲）并按 ID 落盘 `output/<id>.json`（`outline-writer`）；随后 state 收尾与回填先行完成（status → outlined；`novelStore.updateNovel`——未命名时 name = 大纲标题，description = logline），随后**新增地点确定性入库**（置于角色自动入库之前——毫秒级同步代码先行即「与角色同批次」，不并行避免 notify 交错；`filterNewLocations` 兜底 diff 剔除库内同名，空清单跳过，非空经 `plantNewLocations`（`workflows/location-intake.ts`）逐条 addLocation（name + description）入库并 notify），再由编排层对角色清单兜底 diff——`filterNewCharacters`（trim 全等剔除库内已有名、清单内同名去重保留首个、空名剔除，不信任模型的「新增」判定），空清单跳过（零 LLM 调用），非空经 `autoCreateCharacters`（`agents/auto-character-agent`）依据世界观与大纲自动填充角色卡并逐张入库（notify 通报进度与名单）。自动入库置于收尾回填之后；auto 块抛错时保留已确认大纲与角色清单，运行仍未完成，恢复会跳过已入库角色并继续伏笔收尾；随后**伏笔清单入库**（置于角色自动入库之后——服务角色 ID 需角色先入库，伏笔清单可能引用本轮自动入库的新角色）：非空时经 `plantOutlineForeshadows`（`workflows/foreshadow-intake.ts`）确定性创建——幕名→当前版本幕节点、回收幕名→回收幕节点（漂移不阻塞伏笔入库——回收幕留空并警告，登场幕匹配是硬条件、回收幕只是规划信息）、服务角色名→角色 ID（`resolveCharacterIds` trim 全等），幕名 / 服务角色名未匹配逐条跳过并 notify `⚠️ 伏笔跳过…`（不阻塞其余条目），入库 notify「✨ 本次大纲伏笔已入库 N 处（M 处因幕名/角色名未匹配跳过）」，空清单跳过
11. **章节规划不自动衔接**（2026-09-25 起，决策见 DECISIONS）：大纲确认入库落盘后会话即收尾（run_finished），不自动规划第一幕章节——章节规划（章名 + 剧情概述，确认后幕下事务建章）由用户在客户端幕节点卡「规划本幕章节」入口经 `planActChapters` 单幕会话逐幕手动发起（见下节）；`chapter` 阶段枚举与 `chapter-plan` 确认视图保留，归单幕规划会话使用
12. 全程通过 `NovelStateStore` 更新 state（initializing → gathering → outlined；写作状态流转待正文工作流）

## 单幕章节规划工作流（src/workflows/plan-act-chapters.ts）

客户端幕节点卡「规划本幕章节」入口的会话编排（headless `plan-chapters <novelId> <actNodeId>` 模式，决策见 DECISIONS）：

1. **前置校验**（全部抛可读错误，由协议入口转 fatal error）：小说存在 → 幕节点存在、同小说且类型为 act → 幕梗概与关键情节点非空（旧数据缺内容拒绝）→ 所属部节点存在 → 该幕尚无章节点（同一幕重复规划被唯一索引拒绝，修订流为既有待办）→ 世界观已确认（worldviews 表有记录——自动创建新角色需要世界观依据，前置拒绝避免「确认入库后才发现无法自动创建」的中间态，对齐 regen-outline / write-chapter 校验惯例）
2. **上下文组装（全取自库）**：novels.name / description（书名 / logline）+ 叙事视角（novels.narrative_pov，未采集省略——章节概述与登场安排须与该视角一致）+ 部名与部梗概 + 幕名 / 幕梗概 / 关键情节点 + 角色库已有角色行（名 + 叙事定位，与 `list_characters` 工具同源）+ 本幕「未绑登场章」的伏笔清单行（`foreshadow-store.listUnboundByAct`——act_node_id 挂本幕且 appear_chapter_id 为空，随 `planChapters` 第三参注入，prompt 以「序号. 表面行为——隐藏真相」带出，无则不带）；theme 经 `readOutlineTheme` 从 output 产物尽力读取，缺失省略
3. **复用章节 Agent**：`planChapters` 配 `list_characters` 角色库查询工具（返回名 + 叙事定位），系统提示约束章节概述尽量点名出场角色（已有角色用真名、新角色用清单名）、体现伏笔表面行为、登场角色不在库中必须列入 `newCharacters`；`save_chapters` 经 `saveChaptersInputSchema` 结构化入参附顶层新增角色清单（newCharacterSchema：名字 + 一句话定位、定位注明登场章，清单内名字不得重复）、新伏笔清单（chapterNewForeshadowSchema：表面行为 + 隐藏真相 + 注意度 + 服务角色名 + 登场章名，表面行为不得重复）、登场绑定指令（foreshadowBindingSchema：回传清单序号 + 登场章名，序号不得重复——既有未绑伏笔要在本幕登场时绑定）、回收绑定指令 foreshadowRecoverBindings（同 schema 复用：序号 + 回收章名，(序号, 章名) 组合不得重复、同序号多条 = 多步回收——「本幕待回收伏笔」清单（回收幕=本幕且回收章未绑）要在本幕揭晓时绑定，回传清单带登场章信息供 LLM 判断顺序）与新增地点清单（newLocationSchema：名字 + 一句话定位，名字不得重复；另配 `list_locations` 地点库查询工具）——确认视图连带展示「✨ 本次规划新增角色（确认后自动入库）」「✨ 本次规划新增伏笔（确认后自动入库）」「🔗 伏笔绑定（确认后生效）」「✨ 本次规划新增地点（确认后自动入库）」，拒绝规划即连带作废清单重新提交
4. **入库、新增地点与新增角色自动创建**：确认后 `saveChapters` 幕下事务批量建章 → 通知入库统计 → **新增地点确定性入库**（`filterNewLocations` 兜底 diff + `plantNewLocations`，置于角色自动入库之前——同大纲流程语义，空清单跳过）→ `filterNewCharacters` 对清单兜底 diff（trim 全等剔除库内已有名、清单内同名去重保留首个、空名剔除），空清单跳过（零 LLM 调用）；非空组「部/幕」两级伪 Outline（章不进 Outline，规划产物与章节点结构不变）并经 `autoCreateCharacters`（`agents/auto-character-agent`）以世界观 + 伪 Outline + `extraContext`（本次规划的章节列表全文——章节概述是新角色言行的一手素材）自动填充角色卡逐张入库（notify「✨ 本幕规划引入了 N 个新角色…」+ 汇总名单）；随后**伏笔处理**（置于角色自动入库之后——新伏笔的服务角色名可能引用本轮自动入库的新角色）：`plantChapterForeshadows`（`workflows/foreshadow-intake.ts`）确定性执行——newForeshadows 新伏笔带登场章（章名→本次规划章节点）与幕归属（act_node_id 挂本幕）入库；登场绑定指令把回传清单中的未绑伏笔按 1-based 序号 patch `appear_chapter_id` 到登场章（**对称顺序校验**：伏笔已有回收章时新登场章须早于最早回收章，`buildChapterOrder` 全书章全局序=部sort→幕sort→章sort）；回收绑定指令把本幕待回收清单伏笔 patch `recover_chapter_ids` 到回收章（同伏笔多条合并为多步回收；登场未绑 / 回收章不晚于登场章跳过并警告）；章名 / 服务角色名未解析、序号越界逐条跳过并 notify 警告（不阻塞其余条目），notify「✨ 本次规划伏笔入库 N 处、绑定 M 处、回收绑定 K 处（X 处未匹配跳过）」；run_finished 携带小说 ID 供客户端刷新

## 大纲重新生成工作流（src/workflows/regen-outline.ts）

客户端「📖 大纲」组头刷新按钮经警告弹框确认后的会话编排（headless `regen-outline <novelId>` 模式，决策见 DECISIONS）：

1. **前置校验**（可读错误 → fatal error）：小说存在 → 世界观已确认（worldviews 表有记录）→ 至少一名已入库角色
2. **数量表单**：askInt 幕数（3-20 默认 5）→ 部数（1~幕数 默认 1），与新建流程一致
3. **复用大纲 Agent**：`createOutline` 入参松绑为 `OutlineContext`（worldview / characters 必带，genre / narrativePov / audience / coreConflict 从 novels 读取，历史未采集项可缺失，重生成复用库内创作条件，不喂旧大纲避免新版本被旧结构锚定）→ save_outline 确认门（预览-反馈-调整循环）
4. **版本切换入库**：`saveOutlineTreeNewVersion` 单事务——该小说全部当前版本行（部/幕/章，含已生成章节）降级 `is_current_version=0` 归档为历史版本，新树以 `version=max+1` 入库为当前版本；覆盖 `output/<id>.json` 产物、回填 novels.description（logline）；旧节点 ID 随降级失效，客户端完成后重置选中并刷新详情（新幕恢复「规划本幕章节」入口）
5. **新增角色自动入库**：同新建流程收尾动作——`filterNewCharacters` 对新版大纲 `newCharacters` 清单兜底 diff（剔除库内已有名，空清单跳过、零 LLM 调用）→ `autoCreateCharacters` 依据世界观与新版大纲自动填充角色卡并逐张入库（清单随大纲在确认门连带确认过，写库前透明可拦截）
6. **新增地点确定性入库**（同新建流程收尾动作，实际执行置于角色自动入库之前）：`filterNewLocations` 对新版大纲 `newLocations` 清单兜底 diff（剔除库内已有名——**地点只增不改**，旧版入库地点保留不动，空清单跳过）→ `plantNewLocations` 逐条 addLocation（name + description）入库并 notify
7. **伏笔清单挂接新版幕入库**：同新建流程收尾动作——`plantOutlineForeshadows` 对新版大纲 `newForeshadows` 清单确定性创建（幕名取当前版本树即新版幕节点、服务角色名→角色 ID，未匹配跳过并警告，清单已在大纲确认门连带确认过）；**旧伏笔行保留不动**——regen 只降级大纲节点，伏笔不随归档也不清理（旧伏笔 act_node_id 指向已降级的旧幕节点，悬挂但无害——`listUnboundByAct` 按当前 act 查询天然不回传旧版伏笔，伏笔数据保留在库，同「正文行与归档章关联留存」先例；决策见 DECISIONS）

## 章节正文生成工作流（src/workflows/write-chapter.ts）

客户端章节点卡「✍️ 生成本章正文」入口的会话编排（headless `write-chapter <novelId> <chapterNodeId>` 模式；写作模型未配置回落 Agent 会话模型——校验模型使用 Agent 模型，会话始终要求 AGENT_MODEL_API_KEY）：

1. **前置校验**（全部抛可读错误，由协议入口转 fatal error）：小说存在 → 章节点存在、同小说且类型为 chapter → 章剧情概述非空（旧数据缺内容拒绝）→ 所属幕与部节点存在 → 世界观已确认（worldviews 表有记录）；已有正文不再拒绝——检测到既有 document 即走重新生成路径（isRegen 分流 notify 与保存路径，流程与首次生成完全一致）
2. **上下文组装（全取自库）**：书名 / logline + 叙事视角（novels.narrative_pov，未采集零注入——随【小说】块注入并要求正文叙述全程保持该视角、人称与信息范围不得中途漂移）+ 世界观 JSON + 本章角色完整参考（全部已设定字段；人物属性与作者指导分开，基准叠加已结束迁移）+ 同大纲版本已确认的已结束完整迁移历史与本章变化计划（角色/字段/旧值→目标/起止章/诱因/过渡/序号/修订；未来、草案、取消不注入；计划区间结束不证明正文已兑现）+ 部名与部梗概 + 幕名与幕梗概及关键情节点 + 本章名与剧情概述 + 全书跨幕前后章衔接（上一章正文在 8000 字符预算内优先、缺失或超预算回退概述，下一章只取概述）+ **本章绑定伏笔（可选增强）**：`buildChapterForeshadowContext`（workflows/foreshadow-context）——登场注入卡片、回收组按登场章全局章序升序注入卡片 + 登场章上下文（正文优先、8000 字符预算内整条注入，未生成/文件缺失/超预算降级概述）+ 多步回收既往回收章概述，【本章伏笔】块插【下一章】块后【参考文风】段前、写作要求条件附加编号顺延、生成前 notify「🔮 本章伏笔」统计与降级计数；无绑定伏笔零注入零通知 + **参考文风（可选增强）**：style_references 表按启用过滤（enabled=1），非空在 prompt 尾部【下一章】块之后插【参考文风】段（每条「（名字）\n内容」，长样本置尾不推远核心上下文且紧邻风格指令）、写作要求附模仿条（模仿叙事语言 / 句式节奏 / 描写风格，不抄袭具体情节与专有名词）、生成前 notify「🖋️ 本次参考文风：名单」；无启用文风零注入零通知（行为与无此功能逐字节一致）
3. **生成-校验-修订循环与落盘**：写作偏好生效值先行解析——`resolveSystemWritingPrefs`（providers/writing-prefs，环境变量读系统级）+ shared `resolveChapterLength` / `resolveStylePassScore`（小说级 novels 行 > 系统级 > 内置默认 2000~3000 字 / 80 分；篇幅 min/max 整体覆盖、半设乱序防御性跳过），小说级覆盖生效时 notify 通报。`getWritingModel()`（providers/writing-model，按 `WRITING_MODEL_PROVIDER` 所选接口类型调用对应官方 SDK，`WRITING_MODEL_*` 三环境变量齐才启用，任一未配置回落 Agent 会话模型）单轮 `generateText`（非 ReAct——无工具无提问），写作要求篇幅条用生效值（`篇幅约 X~Y 字`）、遵守世界观禁忌、只输出正文文本；空结果拒绝且零残留。每轮生成后经 `reviewChapter`（chapter-review，Agent 模型三段独立校验——①内容约束（世界观/章节概述/本章伏笔/**本章角色状态与变化计划**，与写作者同源）②文风相似度（合格线 = 生效阈值，评分 prompt 与判定同一条线；无启用样本 skipped）③前后自洽）产出结构化整改报告：`isReportPassing` 通过（①③零问题且文风达标）→ 落盘；未达标按报告修订式重写（prompt 追加【上一版正文】+【整改报告】块——合格线随 formatRevisionBlock 同行，末条要求替换为按报告逐条修订），最多 3 轮；第 3 轮仍未达标 → ⚠️ 警告（含文风分与问题计数）后保底保存最后一版。进度全程经 onProgress 回调透传（drafting/review-*/revising/saving，报告附着在 revising/saving 事件）。正文经 document-writer 写 `output/<小说名>-<创作ID前8位>/<部名>/<章名>.md`（sanitize 段清理，同名冲突加 `-N` 后缀不覆盖既有文件），文件先落、库后入，库失败回滚删除文件
   三项校验各在开始与结束时发送 `write-progress`，结束事件附 `stageResult`；客户端按轮累积阶段结果，有问题即在对应阶段显示警告与建议，新轮清空阶段结果。完整 `report` 仍随修订 / 保存事件供末尾汇总。
4. **元数据入库绑定**：首次生成走 `saveChapterDocument`、重新生成走 `replaceChapterDocument`（单事务删旧行插新行）插 documents 行（file_path 相对路径 + 字数，内容不进库）+ 章节点回写 `document_id` 并置 `status=completed`；重生成在事务提交后清理旧正文文件（新旧路径相同——旧文件本就缺失——时跳过防误删新文件；幂等容忍缺失）；任一环节失败回滚删新文件，旧正文行与文件零影响；notify 保存路径与字数；run_finished 携带小说 ID 供客户端刷新详情（章节点 ID 稳定，选中与正文展示保持）；大纲重生成只降级归档章节点，documents 行与正文文件保留（旧正文与归档章的关联留存）

> 伏笔回收按目标章所属树的全书章序区分阶段回收与最终回收；最终章要求完整揭露真相并收尾，内容审校按同源材料检查并产出伏笔整改项。缺失/跨版回收点不猜测最终章，保留既有三轮修订与保底警告策略。详细职责与边界见 [workflows 架构：伏笔最终回收与审校](apps/agent/src/workflows/ARCHITECTURE.md#伏笔最终回收与审校2026-10-14)。

## ReAct 终态工具模式（src/agents/react.ts）

- `runReactAgent` 封装 `generateText({ tools, stopWhen })`
- 调用方定义携带 zod schema 的「终态工具」（submit_worldview / save_outline），execute 闭包记录结果
- 两种停止策略，按终态工具是否可能「被用户否决」选择：
  - 提交不会被否决的 Agent（worldview）：`stopWhen: [hasToolCall(终态工具), stepCountIs(maxSteps)]`
  - 终态工具内含用户最终确认、可能被拒需继续修订的 Agent（character / outline）：不设 stopTool，靠 `isDone` 判定 + maxSteps 兜底（hasToolCall 在工具被调用时无条件停止，无法表达「提交被拒需继续」）
- 续跑机制：传入 `isDone` 后，循环自然结束但终态未达成时（弱模型偶发「宣告调用工具却只输出文本」），自动注入提醒消息并携带完整对话历史续跑（默认 1 次）
- 优点：结果天然过 schema 校验；无需解析 toolResults 结构

## 关键约定

- 环境变量（Bun 自动加载 `.env`，参考 `.env.example`）：
  - 模型配置三来源：客户端设置弹窗（`userData/settings.json` 明文 JSON，⚙️ 维护）> `.env` > 继承环境变量（client 侧 childEnv 解析注入，agent 子进程无感）
  - `AGENT_MODEL_PROVIDER`：可选，Agent 接口类型（`openai` / `deepseek` / `claude`，决定调用哪家官方 SDK 与协议）；留空按有效地址迁移（DeepSeek 官方地址 → deepseek，其余 → openai；地址留空沿用 DeepSeek 官方默认 → deepseek），非法值启动即报错
  - `AGENT_MODEL_API_KEY`：必填，Agent API Key（兼容旧 `DEEPSEEK_API_KEY`）
  - `AGENT_MODEL_NAME`：可选，模型名（DeepSeek 留空默认 `deepseek-flash`，`openai` / `claude` 无默认值需填写；兼容旧 `DEEPSEEK_MODEL_NAME`）
  - `AGENT_MODEL_BASE_URL`：可选，Base URL 留空按 provider 取官方默认地址（openai `https://api.openai.com/v1` / deepseek `https://api.deepseek.com` / claude `https://api.anthropic.com/v1`）；其他兼容服务需填写对应模型名与接口地址（自定义地址须支持所选协议）
  - `WRITING_MODEL_PROVIDER`：可选，独立写作模型接口类型（同上三选）；留空按有效地址迁移（独立写作默认 `openai`），非法值在正文生成前抛可读错误
  - `WRITING_MODEL_NAME` / `WRITING_MODEL_API_KEY` / `WRITING_MODEL_BASE_URL`：可选，写作模型（模型名 / Key / Base URL 三项需同时配置）——正文创作时使用，接口类型可与 Agent 会话模型不同；任一未配置回落 Agent 会话模型，正文生成开箱即用
  - `NOVEL_CHAPTER_LENGTH_MIN` / `NOVEL_CHAPTER_LENGTH_MAX` / `NOVEL_STYLE_PASS_SCORE`：可选，写作偏好**系统级默认**（章节篇幅下限/上限字数 + 文风相似度合格线）——客户端设置弹窗「写作偏好（默认）」维护并经 childEnv 注入（三级优先级同模型配置），协议宿主 / CLI 可直设；未配置时正文生成用内置默认（篇幅 2000~3000 字、合格线 80 分），单本小说的书库级覆盖优先级更高（见「写作偏好两级配置」节）
  - `NOVEL_DB_PATH`：可选，SQLite 路径，默认 `data/novel.db`
  - `NOVEL_OUTPUT_DIR`：可选，大纲输出目录，默认 `output`；协议模式下由宿主进程传绝对路径，`hello` 消息回显校验
- SQLite：Bun 内置 `bun:sqlite`，各 store 共享默认连接（懒加载单例），`PRAGMA foreign_keys=ON` 按连接开启。**跨进程并发约定**（agent 会话写库 / 查询 CLI 子进程同时打开库）：所有连接统一 `PRAGMA busy_timeout=5000`（短锁冲突等待重试，而非默认 0 立即抛 database is locked）；`journal_mode` 与 `user_version` 的写入仅在真正需要时执行（幂等读检查 / 只在迁移分支内写）——版本匹配的纯浏览打开是零写操作，WAL 下读连接与写连接天然共存。十一张表主键均为应用层生成的 **UUIDv7**（时间有序，索引友好）：`novels`（小说信息，1 的根，`pinned` / `favorite` 为书库管理标记，置顶优先排序、收藏星标不影响排序；`chapter_length_min` / `chapter_length_max` / `style_pass_score` 为写作偏好**小说级覆盖**三可空列（19→20 增量迁移，NULL=未设置——正文生成按「小说级 > 系统设置 > 内置默认」解析生效值））；`characters` 与 characterSchema 对应（1:N，自增序 + `novel_id` 外键索引，`version` / `updated_at` 为历史元数据），创作流确认后入库 version=1 即**固定基准**——基准卡只增不改（`updateCharacter` 已退役、IPC/preload 删除、CLI 命令显式拒绝、客户端角色卡只读），人物变化一律经 `character_migrations` 表达；`character_versions` 为角色历史版本快照表（`character_id` / `novel_id` 外键 + 索引，`version` 记编辑前版本号、`character` 存整卡 JSON 文本）——运行期不再写入，仅供 18→19 升级导入与追溯；`character_migrations`（角色迁移，一行一个角色的一个字段变化：`migrate_field` 受控字段路径（历史读取覆盖全部叶子字段；新增、编辑与确认禁止姓名，应用层校验）、`old_value` 服务端派生只读、`new_value` 目标值（新增一律非空，清空可选字段经编辑 patch）、`start_chapter_id` / `end_chapter_id` 区间（结束章 NULL = 开放区间）、`trigger` / `transition_guidance` 创作计划文本（确认时必填）、`sequence` 同角色内原子分配不复用、`revision` 每次编辑或状态变更递增、`status` CHECK 草案/已确认/已取消（草案与取消项不参与角色状态解析）、`outline_version` 绑定的**全书大纲版本**（取章所在树根节点 version，非章节点自身 version；未绑定草案可空）、`group_id` 同次历史编辑的字段差异关联）；`character_migration_versions`（迁移修订快照，`migration_id` / `novel_id` 外键 + 索引，每次编辑或状态变更前整行 JSON 归档，与角色卡历史表区分）；`worldviews`（1:1，`novel_id` 唯一外键，upsert 覆盖更新，`taboos` 数组存 JSON 文本）；`outlines`（大纲树，`parent_id` 自引用外键 + `novel_id` 外键索引，`type` CHECK 部/幕/章——部/幕为大纲阶段两级，章为章节规划段在幕下批量创建；**内容随节点入库**：`summary` 为部/幕梗概与章剧情概述、`key_plot_points` 为幕级关键情节点（JSON 文本列，仅幕节点携带，schema refine 强约束），供写作期按幕内容生成章节、按章概述写正文；`character_ids` 为章级登场角色 ID 绑定（JSON 文本列，仅章节点携带，schema refine 强约束——章节规划确认、新增角色自动建卡之后由编排层名字→ID 解析回填，未绑定的旧章为 NULL=回退全库角色注入）；`status` CHECK 计划中/写作中/写作完成/已废弃，同节点多版本行并存 `version`+`is_current_version`，部分唯一表达式索引 `(novel_id, COALESCE(parent_id,''), sort) WHERE is_current_version=1` 保证同父级下当前版本 sort 唯一——根节点 parent 为 NULL，SQLite 唯一索引视 NULL 互异故 COALESCE 归一；大纲确认后经 `saveOutlineTree` 整树事务入库，重复保存被唯一索引拒绝；章节规划确认后经 `saveChapters` 幕下事务批量建章（父级须为幕且同小说，同一幕重复保存同样被唯一索引拒绝），各章登场角色绑定经 `setChapterCharacters` 单事务批量回填（置于新增角色自动建卡之后——绑定前名单中全部角色已入库、ID 必然存在）；当前版本切换由调用方先降级旧版再提升新版，`document_id` 为章节正文绑定回写列——documents 表已落地，由 `saveChapterDocument` 入库事务同指针写并置 status=completed，列上外键因 SQLite 不支持 ALTER 补加而由事务与 documents.chapter_id 外键共同保证一致性）；`documents`（章节正文元数据，一章一份：`chapter_id` 唯一外键挂 outlines 章节点、`file_path` 正文文件相对路径——**内容存文件系统** `output/<小说名>-<创作ID前8位>/<部名>/<章名>.md`（顶层带 ID 去重，sanitize 段清理，同名章冲突 -N 后缀）、`word_count` 不含空白字符字数（入库时计算）——`saveChapterDocument` 单事务「插元数据 + 回写章节点 document_id + status=completed」，重复保存被唯一索引拒绝；deleteNovel 级联时先于 outlines 删元数据行并逐文件清理；小说 rename 经 updateFilePaths 联动迁移文件（ID 段不变、仅名段更新）；10→11 迁移把存量 content 内联按「小说名-ID」层级落文件）；`locations`（小说世界的地理位置，`parent_id` 自引用外键成层级（城市→大陆）+ `novel_id` 外键索引，`description` 一句话定位、坐标 `x`/`y` REAL、图层 `layer` 自由文本（天上/地面/地底等）、`population` 可空非负整数——x/y/layer/population 均可空（12→13 放宽：自动入库只产生「名字+定位」，地图向坐标留给未来地图功能编辑）——**创作流采集已接入**（大纲与章节规划确认后经 `location-intake.ts` 确定性入库），查询 CLI 已读（novelDetail.locations → 客户端结构树地点组））；`foreshadows`（伏笔，`novel_id` 外键索引：`surface_action` 表面行为 / `hidden_truth` 隐藏的真相必填，`attention_level` CHECK 1-10 读者注意度（1 易发现→10 难发现），`recovery_status` CHECK 枚举 unrecovered/partial/recovered 默认未回收，埋线方式 / 创作目的可选，`appear_chapter_id` 出现章节为可空裸列（chapter 节点写作期落地后补约束，先例 document_id），`act_node_id` 埋设幕节点与 `recover_act_node_id` 回收幕节点同为可空裸列（大纲阶段挂幕，章节规划按幕圈定回传「未绑登场章」与「待回收」伏笔并分别绑定登场/回收章；SQLite 不支持 ALTER 补外键，一致性由写入方保证，先例 outlines.document_id），`recover_chapter_ids` 回收章节 / `character_ids` 服务角色存 JSON 文本多值——完整 CRUD 支持回收状态流转，服务角色应用层校验同小说——**创作流采集与回收规划均已接入**（大纲确认挂幕与回收幕、章节规划绑定登场与回收章、编辑表单手动规划回收章），客户端浏览 UI 为后续需求）；`style_references`（参考文风，`novel_id` 外键索引：`name` 名字 / `content` 文本内容必填——**内容直接进库不落文件**（文风是喂给 LLM 的素材而非人类阅读产物、体量小而恒定、每次生成正文全量注入无懒加载空间，决策见 DECISIONS），`enabled` CHECK 0/1 启用开关默认启用——生成正文只注入启用条目——**客户端结构树「🖋️ 文风」组与 query CLI 三命令（add-style / update-style / delete-style）已接入**（不走创作流、无确认门，编辑表单直写库；小说改名零联动、删除随 deleteNovel 级联））。schema 变更用 `PRAGMA user_version` 版本号管理（当前 21）：**4→5 起 client 书库已投产，仅做保数据的 ALTER 增量迁移**（4→5 为 novels 增列 pinned / favorite；5→6 为 outlines 增列 summary / key_plot_points，旧行留 NULL 不回填；6→7 为纯新增 locations 表、7→8 为纯新增 foreshadows 表，均由 CREATE TABLE IF NOT EXISTS 幂等落地；8→9 为 characters 增列 version（ALTER，DEFAULT 1 旧行不回填）+ 新增 character_versions 快照表、9→10 为纯新增 documents 表（均由 CREATE TABLE IF NOT EXISTS 幂等落地）、10→11 为 documents 去 content 列改文件存储（存量行 content 先按层级落文件再 DROP 列，file_path 回填）；11→12 为 foreshadows 增列 act_node_id（守卫 `version >= 8 && version <= 11`——foreshadows 表自 v8 起已存在，8~11 的库都持无此列的旧表形态，CREATE TABLE IF NOT EXISTS 对其不生效，故守卫须覆盖整段而非仅 version === 11）；12→13 为 locations 表重建迁移——放宽 x/y/layer 可空 + 新增 description 列（SQLite 无法 ALTER 放宽 NOT NULL，按官方重建流程：FK 关闭 → 改名旧表 → 建新表 → 拷数据 → 删旧表 → FK 重开，自引用外键下拷贝顺序无关化；守卫 `version >= 7 && version <= 12`，表异常缺失时跳过重建由基线 DDL 直建新形态）；13→14 为 foreshadows 增列 recover_act_node_id（守卫 `version >= 8 && version <= 13`，表异常缺失时跳过由基线 DDL 直建，同 11→12 先例）；14→15 为纯新增 style_references 表（CREATE TABLE IF NOT EXISTS 幂等落地，无 ALTER，同 9→10 先例）；15→16 为 novels 增列 genre / audience / core_conflict（创作条件直接绑定小说，补列与版本号在 immediate 事务中原子提交、取得写锁后复查版本防并发重复迁移，段内显式写 16 供链式直升继续）；16→17 为 outlines 增列 character_ids（登场角色绑定，补列与版本同事务提交，表缺失或列已存在时只写版本标记）；17→18 为 characters 增列 updated_at（角色卡最近更新时间，补列后回填「最新编辑快照时间，从未编辑则取 created_at」——存量数据语义即末次变更时刻；段内显式写 18 供链式直升继续）；18→19 为固定角色基准与角色迁移——新增 character_migrations 与 character_migration_versions 两表（幂等建表），并在**同一 immediate 事务**内完成「version>1 的角色从 character_versions 第 1 版快照恢复基准写入主行（id / novel_id / created_at / version / updated_at 稳定）+ 沿『快照版本升序 + 当前卡』变化链逐字段比较，改动项各建一条 draft 迁移（同次编辑的多个字段共用 group_id，未改字段不建迁移；历史草案不猜测起始章 / 结束章 / 诱因 / 过渡过程）」；找不到或校验不过第一版时**抛错回滚**（绝不把当前卡冒充第一版），建表 / 恢复 / 导入与版本推进原子提交、导入前复查迁移表为空保证重复打开不重复导入；旧正文文件与章节不被改写；19→20 为 novels 增列写作偏好三列（chapter_length_min / chapter_length_max / style_pass_score——小说级覆盖，NULL=未设置即「跟随系统设置」语义、不回填；补列与版本同 immediate 事务原子提交、锁内复查防并发，表缺失或列已存在时只写版本标记，段内显式写 20 供链式直升继续）；20→21 为 novels 增列 narrative_pov（叙事视角创作条件，NULL=未采集——历史小说与大纲重生成按缺省省略；同款 immediate 事务补列 + 锁内复查 + 段内显式写 21）；迁移分支按版本链式逐级补列——每段显式写各自目标版本号（非 SCHEMA_VERSION），否则链式直升时后续段会被短路——每段以来源版本守卫（`version === 4` / `version <= 5`），已是目标形态的段不重放，否则重复 ALTER 报 duplicate column），DROP 重建仅保留给开发期旧库（<4）与异常版本的兜底。NovelState 保留内存接口，由持久化主步骤结果在恢复时重建；整本删除（书库管理）由 `deleteNovel` 单事务级联清各表（outlines / locations 自引用树单语句整删；character_migration_versions 先于 character_migrations、character_migrations 与 character_versions 先于 characters 删除——migration_id / character_id 外键约束；style_references 无文件联动直接随级联清理）并由查询入口清理 `output/<id>.json` 产物
- stdio JSON 协议（协议模式入口 `headless.ts`，Electron 等宿主 spawn）：消息 schema 定义在 `@novel/shared`（protocol.ts）；启动 `hello` 握手回显数据绝对路径与协议版本；提问 request / 应答 response 按自增 id 关联，无效应答（类型不符 / 越界 / 空 required）以新 id 重问（对齐 CLI 校验循环）；并发 request 由 client 按到达顺序排队呈现；stdin EOF / SIGTERM 即会话结束（state 已增量落库，无需善后；EOF 后 line 提问得 null、其余提问抛 UserAbortedError，与 CLI 语义一致）；协议消息不合法 fail-fast（发 error 消息后退出）。会话模式经 argv 选择（client 侧 `AgentStartOptions` 类型与之一一对应）：无参 = 新建小说全流程；`plan-chapters <novelId> <actNodeId>` = 单幕章节规划；`regen-outline <novelId>` = 大纲重新生成；`polish-character <novelId> [characterId] <formJson>` = 角色 AI 润色（表单 JSON 随 argv，结果经新增 polish-result 消息先行回传）——run_finished 为一次会话正常结束（四种模式共用，携带小说 ID）；会话入参不合法走 stderr NOVEL_AGENT_FATAL + 退出 1，会话内校验失败发 fatal error 消息后退出 1（客户端错误视图）
- Electron 客户端（apps/client）：main 进程 spawn `bun run apps/agent/src/headless.ts`（cwd=仓库根；模型配置经 childEnv() → resolveModelEnv 三级优先级注入——userData/settings.json（⚙️ 设置弹窗维护，明文 JSON，两族模型各含 provider 接口类型）> 根 `.env` > 继承环境变量，空值键删除（provider 同款逐层下探，留空不遮蔽下层已配置值，由 agent 侧按最终生效地址迁移）；写作偏好系统级默认经 resolveWritingEnv 同款三级优先级注入 NOVEL_CHAPTER_LENGTH_MIN/MAX + NOVEL_STYLE_PASS_SCORE（只输出已解析到值的键）；`NOVEL_DB_PATH` / `NOVEL_OUTPUT_DIR` 传绝对路径）；`agent:start` IPC 携带 `AgentStartOptions`（新建小说 / `plan-chapters` 单幕规划 / `regen-outline` 大纲重生成 / `polish-character` 角色润色——含表单 JSON 载荷 / `write-chapter` 章节正文生成）映射为 spawn 参数；agent 消息经 zod 复验后 IPC 转发 renderer，hello 时校验协议版本（不匹配拒绝继续）；中断 = 终止子进程（v1 无优雅取消协议）；agent 非零退出 → 错误视图 + 重启按钮（已完成部分已落库）；书库浏览与管理走一次性查询 CLI——`library:*` IPC spawn `bun run apps/agent/src/query.ts`（stdout JSON 经 shared query schema 复验，8s 超时兜底；管理命令 rename / pin / unpin / favorite / unfavorite / delete / set-writing-prefs（写作偏好小说级覆盖，library:setWritingPrefs IPC） / add-character / save-migration / add-migration / update-migration / confirm-migration / cancel-migration / add-style / update-style / delete-style，查询入口统一走 openDatabase 连接以顺带完成版本迁移）；renderer 为页面级切换：三栏浏览主页（左栏书库可汉堡折叠 / 中栏世界观·地点·角色·伏笔·大纲·文风结构树——伏笔组「🔮 伏笔」在角色与大纲之间（按埋设幕两级树：幕顺序对齐当前大纲树、未绑幕与归档旧幕伏笔归「未绑幕」组；组头与幕分组均可收起、会话内保持，点击伏笔叶右栏预览）；文风组「🖋️ 文风」在大纲之后（设定→规划→结构→写作素材），组头可整组收起（默认展开、会话内保持）且带「＋」新建入口（进入右栏新建文风态）、空组「（暂无文风）」占位、叶子禁用条目带「（已停用）」后缀，点击叶子右栏预览——角色与大纲分组可整组收起、角色组头「＋」进入右栏新建角色态，改选节点即退出 / 右栏预览）↔ 独立创作页（CreationFlow 挂载即发起会话，整页呈现、头部「←」终止 agent 返回书库；run_finished 后回浏览页刷新书库并选中新作）↔ 独立章节规划页（ChapterPlanFlow：幕节点卡「规划本幕章节」入口进入，`plan-chapters` 模式 spawn，与 CreationFlow 共用 useAgentSession 会话泵；单阶段会话不展示 StageBar；run_finished 后回浏览页刷新详情并保持选中该幕）↔ 独立大纲重生成页（OutlineRegenFlow：「📖 大纲」组头刷新按钮 → OutlineRegenDialog 警示弹框——告知旧大纲与已生成章节将归档清空——确认后进入，`regen-outline` 模式 spawn，run_finished 后回浏览页刷新详情并重置选中——旧节点 ID 已降级失效）。大纲浏览读 outlines 表当前版本节点——结构树按 parentId 建树（部▸/幕·/章），「📖 大纲」组头三角可整组收起/展开（默认展开、会话内保持），部/幕节点可展开收起（三角切换与节点选中解耦，默认全展开、会话内保持），点击节点右栏 OutlineNodeCard 展示该节点 summary 与 keyPlotPoints，幕卡对未规划幕显示「规划本幕章节」入口（已规划的幕隐藏 / 旧数据幕禁用并提示原因），章卡对无正文章显示「✍️ 生成本章正文」入口、有正文章显示「🔄 重新生成」入口（write-chapter 内联会话由 PreviewPane 收口：目标章 id 记录生成态、各章入口禁用、run_finished 后刷新详情，卸载即 agent:stop——对齐角色润色订阅模式；重生成经 ChapterRegenDialog 弹框确认覆盖——告知旧正文不归档不可恢复与真实模型开销——后复用同一会话，进度区块与正文卡并存展示），有正文时正文卡展示约 N 字全文（详情 documents 按 chapterId 匹配、content 查询时读文件，缺失为 null 占位），历史数据（6 版迁移前入库）两列为 null 时展示空占位；章节点绑定登场角色时以「🎭 登场人物」区块展示（characterIds 经详情 characters 解析名字，未匹配兜底原 ID；未绑定的旧章不渲染）；已生成正文的章若其登场角色存在**影响本章**的迁移修订（当前或修改前已确认范围起始章序 ≤ 本章章序，且修改时间晚于正文生成时间），正文卡顶部给「⚠️ 登场角色的迁移计划已更新（名字 字段 第 N 条）——建议重新生成」提示（起始章更晚的迁移不会让早期章节显示过时、绑定归档旧版大纲的迁移不混入新版；只提示不自动重写——已生成正文为冻结产物）；本章涉及的伏笔以「伏笔」区块展示——详情 foreshadows 过滤登场（appearChapterId 命中本章）/ 回收（recoverChapterIds 含本章）两组（同一伏笔可两组各一条），服务角色 ID 经详情 characters 解析名字（未匹配兜底原 ID），逐条「[登场/回收] 表面行为 ⇢ 隐藏真相（注意度 N，服务：名字…）」、无则不渲染；角色节点右栏为**只读**角色卡（固定基准，无编辑入口）+「🧬 角色迁移」清单 → CharacterMigrationPanel（逐条展示序号 / 状态 / 修订版 / 字段 / 原值→目标值 / 章节区间 / 诱因 / 过渡描述，提供新增·编辑·确认生效·取消·复制为新草案（归档旧版方案重新绑定）；旧值只读由服务端派生、起止章下拉用当前大纲章列表、客户端预校验必填与起止顺序、服务端错误原样回显、成功刷新详情、取消零写入）；「＋」新建角色仍用 CharacterEditForm（空初始值，13 字段、7 必填校验、🪄 AI 润色回填，提交入库 version=1 即基准，提交后自动选中新角色）；伏笔节点右栏为全字段只读卡（表面行为 / 隐藏真相 / 注意度 / 回收状态中文 / 埋设幕名 / 登场章名（未绑定占位）/ 服务角色名 / 埋线方式 / 创作目的——幕/章/角色 ID 解析名字，未匹配兜底原 ID）+「✏️ 编辑伏笔」入口 → ForeshadowEditForm（全字段含登场章下拉单选——选项为当前版本章节点「部/幕/章」名，可清空——与服务角色多选、注意度 1-10 整数与必填校验；提交经 query CLI `update-foreshadow` 直写库——完整卡转 patch：可选空=null 清空、回收章不入 patch 保留现值；成功刷新详情（伏笔 id 稳定选中不失效）、取消零副作用）；文风节点右栏为只读卡（名字 + 启用徽标「启用中/已停用」+ 内容全文 pre-wrap 滚动阅读，不展示 id）+「✏️ 编辑文风」入口 → StyleEditForm（新建/编辑共用：名字与内容必填、内容软上限 20000 字符超限禁提交、启用开关；编辑态附「🗑 删除」confirm 确认；提交经 query CLI 三命令直写库，成功刷新详情、取消零副作用——新建成功自动选中新条目、删除成功重置选中）；`output/<id>.json` 产物仅供留存与 theme 读取（重生成后覆盖为最新版），不再决定浏览读取；WSL2 需 `disableHardwareAcceleration` + `disable-gpu` + `no-sandbox` + `in-process-gpu`（GPU 子进程启动即崩）；诊断钩子 `NOVEL_CLIENT_AUTOSTART=1`（renderer 自动打开创作覆盖层）/ `NOVEL_CLIENT_SELECT=<novelId>`（自动选中并预览）/ `NOVEL_CLIENT_SCREENSHOT=<path>`（无头冒烟 / 截图存盘退出）/ `NOVEL_CLIENT_THEME=system|light|dark`（强制覆盖外观主题，仅显式设置时生效——无头双主题截图验证用）
- deepseek-flash 对主角归一化存在改写漂移，已通过「强约束 prompt + 用户确认门」缓解（见 DECISIONS）

## 小说创作条件持久化

`packages/shared/src/novel.ts` 定义 novelCreationParamsSchema（genre / narrativePov / audience / coreConflict 可空），NovelStore 负责各列的读写校验和 JSON 编解码。数据库 15→16 在 immediate 事务内原子补 genre / audience / core_conflict 三列并更新版本、20→21 补 narrative_pov 列，均锁内复查防并发重复迁移、历史 NULL 不推断回填；新建分阶段保存，普通管理保留字段，详情 novelDetail.novel 暴露原生值（旧载荷缺省 null），书库列表契约不变。大纲重生成复用各非空条件（含叙事视角）。三条创作主流程另经 workflow_runs/workflow_steps 保留步骤结果与确认产物，用于跨进程恢复。


## 角色迁移修改与回归边界（2026-10-14）

- `migration-store.saveMigration` 以 immediate 事务承载表单新建/编辑及可选确认；嵌套存取产生的主行、序号分配与修订快照一起提交或回滚。已确认编辑重新校验完整确认条件并保持状态，不重复确认。
- 确认或编辑已确认迁移后，在提交前校验同字段整条旧值链。插入/重排/改绑大纲版本改变下游依据时拒绝并回滚，不自动改写已确认计划；跨版本编辑同时检查来源链与目标链。
- 详情增加 `migrationVersions`：被修改前的迁移状态与修改发生时间。客户端陈旧提示使用正文生成后发生的修订，取当前确认范围与旧确认范围并集；取消或后移仍提示旧影响范围，重生成后提示消失。历史载荷缺省空列表。
- `CharacterMigrationPanel` 区分新建/编辑状态；复制只提供初始内容，保存创建新行且不修改源记录。表单统一经 `save-migration` CLI 与 `library:saveMigration` IPC 提交，确认失败零写入。
- v18 升级缺少历史表时检查是否有 version>1 角色；有则报出角色 ID 并回滚，不将当前编辑卡视为基准。
- `happy-dom` 是客户端测试开发依赖，交互测试运行真实 React + DOM 并接真实 SQLite；定向入口 `bun run test:character-migrations`，完整回归矩阵见 [角色迁移测试流程](docs/character-migration-testing.md)。

## Agent 模型配置与历史兼容（2026-10-16）

`providers/model-factory.ts` 按所选 provider 调用对应官方 SDK：OpenAI 显式 `chat(model)` 走 Chat Completions（provider 默认的 Responses API 不适用于自定义兼容地址）、DeepSeek 用官方包（`convert-to-deepseek-chat-messages` 在 json 响应格式下自动注入 JSON 指令与 schema——通用兼容接口不注入，DeepSeek 服务端会以 400 拒绝「prompt 不含 json 字样」的 json_object 请求，即此前报错的根因）、Claude 走 Anthropic Messages 协议（鉴权 `x-api-key` + `anthropic-version`，结构化输出经 `output_config` 或强制 json 工具）。业务侧只见统一的 `LanguageModelV4`。

配置解析：`resolveAgentModelConfig` 输出 `{ provider, apiKey, modelName, baseUrl }`——provider 显式值优先，缺省按有效地址迁移（`shared/model-provider.ts` 的 `resolveAgentModelProvider` / `resolveWritingModelProvider`，客户端弹窗回显生效选项用同一对纯函数）；地址留空按 provider 取官方默认；模型名留空仅 DeepSeek 有默认值。非法 provider / 非 DeepSeek 缺模型名的可读错误由 `describeAgentModelConfigError` 交 index.ts 与 headless.ts 的启动检查打印退出（module 级 `model` 常量创建于 import 期，故解析函数本身不抛错）；写作模型的非法 provider 在 `resolveWritingModelConfig` 直接抛错（正文生成前即报出）。客户端 settings 的 `agentModel` / `writingModel` 均为 `provider + 三字段`，provider 空串 = 历史配置未设置且**不做地址推断**（否则会遮蔽 `.env` / 继承环境里已配置的值）；`resolveModelEnv` 输出八个模型变量供 childEnv 注入，空串键删除。设置弹窗经 `settings:get` 回传的 `effectiveProviders`（`resolveEffectiveProviders`：先按三级优先级解析、再交 shared 同一对纯函数推断）显示**生效**接口类型；保存时，编辑该组任一连接字段（接口类型 / Key / 模型名 / Base URL）即保存当前显示的 provider，防止自定义地址再次推断为其他协议；该组连接未编辑时写回设置文件原值（空串保持「按地址迁移」），仅修改外观或写作偏好不遮蔽环境配置。

`@ai-sdk/openai` / `@ai-sdk/deepseek` / `@ai-sdk/anthropic` 与 `ai` 在 apps/agent 中**锁定具体版本**（不用 `^` 范围）：四者的 `@ai-sdk/provider` / `@ai-sdk/provider-utils` 依赖须落在同一副本上，且 DeepSeek 的 JSON 指令注入行为与版本绑定——升级需整组一起升并复跑 provider 协议回归。

## 写作偏好两级配置（2026-10-14）

章节篇幅与文风合格线按「小说级 > 系统级 > 内置默认」解析，正文生成（writeChapter）在组上下文前解析一次生效值：篇幅条直接进写作 prompt（`篇幅约 X~Y 字`），合格线贯穿 chapter-review 的评分 prompt、`isReportPassing` 通过判定与 `formatRevisionBlock` 修订块文案。各阶段进度事件携带同一 `stylePassScore`，经 headless → shared `write-progress` 协议 → PreviewPane → OutlineNodeCard 传递，阶段警告与整改建议使用该会话阈值（含 0 分）；旧消息缺字段时使用内置默认 80。

- **小说级**：novels 表三可空列（chapter_length_min / chapter_length_max / style_pass_score，19→20 迁移、NULL=跟随系统设置），客户端书库右键「📏 写作偏好」经 WritingPrefsDialog → set-writing-prefs 直写库（全量替换、schema 成对校验）；小说级覆盖生效时生成前 notify 通报。
- **系统级**：settings.json `writing` 组（normalizeSettings 逐字段校验、非法归 null），childEnv 经 resolveWritingEnv 三级优先级（设置 > .env > 继承环境变量）注入 NOVEL_CHAPTER_LENGTH_MIN/MAX + NOVEL_STYLE_PASS_SCORE；agent 侧 `providers/writing-prefs.ts` 读取（非法值静默归 null），协议宿主 / CLI 亦可直设。
- **内置默认**：篇幅 2000~3000 字（沿用历史值）；文风合格线 80（用户指定，替代历史硬编码 90）。
- 解析规则（shared `writing-prefs.ts` 纯函数）：篇幅 min/max 为**一个整体**覆盖——某级只有一半或 min > max 时该级整体视为未设置（不拼接两级端点）；文风合格线独立覆盖、逐层取第一个非空合法值。
- 客户端刷新：保存偏好始终刷新书库，仅目标为当前选中小说时重载详情；详情刷新完成或失败时复查最新选中 ID，切换后丢弃迟到响应。WritingPrefsDialog 加载失败显示原始错误与取消按钮，仅加载成功后显示保存入口。

## 主流程缓存与恢复（2026-10-15）

主文档在项目根目录；工作流具体恢复边界见 `apps/agent/src/workflows/ARCHITECTURE.md` 的同名章节。

`WorkflowRunStore` 使用与 `NovelStore.database` 相同的 SQLite 连接。21→22 迁移以 immediate 事务新增三表与索引并更新版本，锁内复查；不修改原业务行。`workflow_runs` 保存模式、小说/幕目标、状态、错误及 owner_pid；同目标未完成运行唯一，活进程占用拒绝再次领取，死进程可重新领取。`workflow_steps` 按 run_id/key 唯一保存结构化结果，确定性数据库副作用与完成标记共事务。缓存只接受普通 JSON；不把工具日志当作业务完成标记。

`agent_message_traces` 保存 system 与 AI SDK 原生 `ModelMessage[]`，读写经 SDK schema 校验，保留原始 JSON 中的工具关联及 provider 元信息。`agents/session-context.ts` 用 AsyncLocalStorage 将缓存上下文传给 ReAct 运行器；每个 SDK step 完成后追加 assistant/tool 消息，失败也保留已发送上下文与已完成步骤消息。缓存不包含模型连接配置或 API Key。

`WorkflowCache` 覆盖 create / plan-chapters / regen-outline 的主输入、已完成子 Agent 产物与入库收尾。未完成子 Agent 从保存输入重跑，消息日志暂不用于恢复子 Agent 问答现场。正文与润色未接入。恢复校验原小说/幕及大纲版本，拒绝把旧计划挂到新版；已完成运行重入只返回结果。

CLI `bun run dev resume <runId>`、headless `resume <runId>` 经 `resume-workflow.ts` 分发；query `list-runs [novelId]` 列未完成运行，详情 `pendingRuns` 返回摘要。shared 协议增加 `workflow-run` 和 resume 启动参数。客户端三类会话页记录 runId 并支持继续，书库中选中小说可恢复未完成流程；结束或返回刷新详情。Electron `agent-process.ts` 从 main 提取协议与生命周期宿主，spawn 和消息出口由 main 注入，`terminate-agent.ts` 等待进程终止。stop 与后续 start 串行，close 后才清理会话并上报退出，保留 stdout 尾部完成消息；子进程实例守卫避免旧事件干扰新会话。

## 伏笔多幕回收规划（2026-10-16）

shared `outlineNewForeshadowSchema` 要求 `recoverActNames` 非空且不重复；`chapterNewForeshadowSchema` 要求 `recoveryPlan`（回收幕 + 章名清单）。注意度保持 1 易发现、10 难发现；更难发现可回收更晚是节奏指导。Agent 确认前校验真实、唯一的幕章引用及顺序，回收幕不得早于登场幕，同幕具体回收章必须更晚。章节 Agent 获得完整当前大纲，既有本幕登场/回收清单必须覆盖；新伏笔对未规划后幕先确定幕，章名留空，已有幕则选真实章。多幕计划在前幕保留核心真相、最后计划幕完整揭露。

22→23 增量迁移在 immediate 事务内新增 `foreshadows.recover_act_node_ids` JSON 数组与 `edit_revision` 整数，旧单幕转单元素数组、无则 []，旧编辑版本 0，原时间戳与注意度不变；锁内复查，失败回滚。store 保留旧 singular 读取为数组首项，add 第四参兼容字符串/数组。查询详情新增 `recoverActNodeIds`（契约可选供旧载荷兼容），不暴露内部编辑计数。每幕按自己的章绑定识别未细化任务，自动回收绑定追加去重并按全书章序排列。

主流程恢复既保存确认产物，也固定确认时清单序号映射。未确认子步骤重跑刷新本幕两清单及当前大纲；已确认缓存沿用原映射。`foreshadow-plan.ts` 将普通编辑修订与工作流绑定追加区分：用户显式更新递增 `editRevision`，自动绑定指定 workflow 来源保持计数；只有核心设定不变、绑定单调增加且编辑版本一致的新快照可合并，旧无版本快照保守保护。原空章回收幕在暂停期间已规划时，通过受限细化步骤选择真实章，再确认并缓存后入库，不丢弃已确认伏笔。

React/CLI 确认门展示全部回收计划，预览逐幕列已绑定章或待细化。`foreshadow-context.ts` 根据目标树版本与后续计划幕检查最终回收；仍有更晚计划幕未细化时只给阶段回收，写作和审校继续复用同源材料。工作流实现与边界详见模块 ARCHITECTURE.md。

### Provider 审查修复（2026-10-16）

角色润色使用本地 polishedCharacterSchema 输出契约：顶层与 basicInfo 的全部字段必填，满足 OpenAI strict json_schema 的 required 要求；输入与持久化仍使用原 characterSchema，可选字段语义保留，不关闭严格输出、不改写角色基准。协议回归经真实工作流、三家 SDK 和内存 SQLite 执行，仅替换网络边界。SettingsDialog 的 modelTouched 按模型组跟踪四个连接字段，编辑时固化当前显示的 provider；主题与写作偏好不触碰模型组。

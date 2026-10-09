# 模块架构（项目根目录级）

> Bun workspaces monorepo（`apps/*` 应用 + `packages/*` 共享包）的项目级架构蓝图，维护在根目录；`apps/agent/src/workflows/` 已建立模块文档（见该目录的 `ARCHITECTURE.md` 与 `PROGRESS.md`），其余子目录仍以本文件为准。

## 分层结构

```text
apps/agent/src/
├── index.ts              # CLI 入口：API Key 检查、运行 createNovel、错误处理与优雅退出
├── headless.ts           # 协议模式入口：stdio JSON 行协议（hello 握手 / 消息分发 / EOF·SIGTERM 收尾）；
│                         #   argv 选会话模式——无参 = 新建小说全流程，`plan-chapters <novelId> <actNodeId>`
│                         #   = 单幕章节规划，`regen-outline <novelId>` = 大纲重新生成（新版本入库），
│                         #   `polish-character <novelId> [characterId] <formJson>` = 角色 AI 润色
│                         #   （编辑流传角色 ID、新建流不带；结果经 polish-result 消息回传），
│                         #   `write-chapter <novelId> <chapterNodeId>` = 章节正文生成（写作模型
│                         #   未配置回落 deepseek——仅写作模型配置齐全时免 DeepSeek Key 检查）
├── query.ts              # 库查询与管理入口：一次性 CLI——查询（list / get——get 携带世界观+角色
│                         #   +大纲当前版本节点+章节正文 documents+伏笔 foreshadows 全量行按入库顺序）+ 管理
│                         #   （rename / pin / unpin / favorite / unfavorite / delete
│                         #   / add-character / update-character——角色版本化编辑
│                         #   / update-foreshadow——伏笔编辑（完整卡转 patch：可选空=清空、回收章保留现值）），
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
│   ├── deepseek.ts       # LLM 接入层：DeepSeek provider 实例与 model 导出（Agent 会话模型）
│   └── writing-model.ts  # 写作模型惰性工厂 getWritingModel(): LanguageModelV4——OpenAI 接口兼容
│                         #   端点（@ai-sdk/openai-compatible），正文创作工作流接入后使用；
│                         #   三变量齐才创建实例，未配置可安全导入、取用抛可读错误
├── agents/
│   └── react.ts          # 通用 ReAct Agent 运行器（generateText + stopWhen 终态工具模式）
├── tools/
│   ├── ask-user.ts       # 提供给 LLM 的通用工具：向用户提问并等待回答
│   └── index.ts          # 工具注册表（汇总导出）
├── state/
│   ├── types.ts            # NovelState / NovelParams / NovelStateStore 接口
│   ├── id.ts               # generateUuidV7（封装 Bun.randomUUIDv7，同毫秒单调递增）+ generateNovelId
│   ├── memory-store.ts     # NovelState 内存实现（数据库接入前的过渡，接口不变替换实现即可）
│   ├── db.ts               # SQLite 打开与建表（novels / characters / character_versions /
│   │                       #   worldviews / outlines / documents / locations / foreshadows，外键开启；
│   │                       #   user_version 版本化迁移）
│   ├── novel-store.ts      # 小说信息持久化（create/get/update，name 大纲确认后回填）
│   ├── character-store.ts  # 角色按创作 ID 持久化（add/list/get + updateCharacter 版本化编辑——
│   │                       #   旧卡快照归档 character_versions、主行 version+1，读写双向 zod 校验）
│   ├── worldview-store.ts  # 世界观按创作 ID 持久化（upsert/get，taboos 存 JSON）
│   ├── outline-store.ts    # 大纲树按创作 ID 持久化（add/get/list/update + saveOutlineTree 整树事务
│   │                       #   + saveOutlineTreeNewVersion 版本切换（旧当前行降级归档、新树 max+1 入库）
│   │                       #   + saveChapters 幕下批量建章，梗概与关键情节点随节点入库，读写双向 zod 校验）
│   ├── document-store.ts   # 章节正文元数据持久化（saveChapterDocument 单事务：插 documents 行
│   │                       #   （file_path + 字数，内容存文件）+ 章节点回写 document_id 并置
│   │                       #   status=completed；一章一份 chapter_id 唯一；updateFilePaths 改名联动）
│   ├── location-store.ts   # 位置按创作 ID 持久化（add/list，父级同小说校验，读写双向 zod 校验；数据层先行，采集与浏览后续接入）
│   └── foreshadow-store.ts # 伏笔按创作 ID 持久化（add/list/update(patch)/delete 完整 CRUD，服务角色同小说校验，回收状态流转；数据层先行，采集与浏览后续接入）
├── output/
│   ├── outline-writer.ts # 大纲落盘：output/<id>.json（id 做文件名安全校验）+ readOutlineTheme 尽力读取产物主题（供单幕章节规划，缺失省略）
│   └── document-writer.ts # 章节正文落盘：output/<小说名>-<创作ID前8位>/<部名>/<章名>.md
│                         #   （顶层带 ID 去重——同名小说不共享文件夹；sanitize 段清理 +
│                         #   章名冲突 -N 后缀不覆盖）+ 读 / 移动 / 删除原语 + countWords
└── workflows/
    ├── index.ts         # 模块出口（createNovel / planActChapters / regenerateOutline / polishCharacter
    │                    #   / writeChapter / collectWorldview / createOutline / planChapters）
    ├── create-novel.ts  # 主编排：初始化 → 参数收集 → 大纲生成确认入库 → state 收尾回填 → 新增角色自动入库
    │                    #   → 伏笔清单挂幕入库 → 会话收尾（章节规划由单幕会话手动发起）
    ├── plan-act-chapters.ts # 单幕章节规划编排：校验（含世界观已确认）并从库组装上下文（含本幕未绑伏笔）→
    │                    #   复用章节 Agent（save_chapters 附新增角色与新伏笔清单及绑定指令连带确认）→
    │                    #   saveChapters 幕下建章 → 新增角色兜底 diff + 自动入库 → 新伏笔入库与既有
    │                    #   未绑伏笔绑定登场章（同大纲两条流程的收尾动作）
    ├── regen-outline.ts # 大纲重新生成编排：读库校验 → 幕数/部数表单 → 复用大纲 Agent（入参松绑，仅库内数据）
    │                    #   → saveOutlineTreeNewVersion 新版本入库（旧版与旧章降级归档）→ 覆盖产物与 description
    │                    #   → 新增角色自动入库（兜底 diff + autoCreateCharacters，同新建流程）
    │                    #   → 伏笔清单挂接新版幕入库（同新建流程；旧伏笔行保留不动——决策见 DECISIONS）
    ├── polish-character.ts # 角色 AI 润色编排：读库校验（小说/角色/世界观）→ generateObject 以表单值+世界观
    │                    #   全字段润色（无确认门，结果回填客户端表单，不自动入库）
    ├── write-chapter.ts # 章节正文生成编排：读库校验（小说/章节点/概述/无正文/世界观）→ 库内组上下文
    │                    #   （部/幕/前后章/角色摘要）→ 写作模型 getWritingModel() 单轮 generateText
    │                    #   （无确认门）→ 正文落文件（层级目录）+ saveChapterDocument 元数据入库绑定
    ├── foreshadow-intake.ts # 确定性伏笔入库模块（无 LLM）：resolveCharacterIds 角色名→ID（trim 全等 / 重复名幂等 /
    │                    #   未解析名单返回）+ plantOutlineForeshadows 大纲路径（幕名→幕节点、服务角色名→ID，
    │                    #   未匹配逐条跳过并 notify 警告）+ plantChapterForeshadows 章节路径（新伏笔带登场章
    │                    #   与幕归属入库 + 绑定指令把既有未绑伏笔 patch 登场章，序号越界 / 章名未匹配跳过并警告）
    └── agents/
        ├── worldview-agent.ts   # 世界观 ReAct Agent（多轮追问 + 终态提交）
        ├── character-agent.ts   # 角色 ReAct Agent（逐字段「发散丰富→确认→保存」：标识性字段照存原词、描述性字段扩写；终态组装校验）
        ├── outline-agent.ts     # 大纲 ReAct Agent（部→幕两级结构，用户确认门 + 幕/部数强校验；
        │                         #   list_characters 角色库查询工具，save_outline 结构化入参附
        │                         #   newCharacters 新增角色清单与 newForeshadows 伏笔清单（挂幕不挂章，
        │                         #   清单内名字 / 表面行为不得重复）随大纲进确认门连带确认；
        │                         #   入参 OutlineContext 松绑——genre/audience/coreConflict 可选，重生成会话仅喂库内数据）
        ├── chapter-agent.ts     # 章节 ReAct Agent（单幕拆章：按幕梗概与情节点推荐章节数量与概述，用户确认门；单幕规划会话调用；
        │                         #   list_characters 角色库查询工具 + prompt 已有角色行与本幕未绑伏笔行——概述尽量点名
        │                         #   出场角色、体现伏笔表面行为，save_chapters 经 saveChaptersInputSchema 结构化入参附顶层
        │                         #   newCharacters 新增角色清单（名字不得重复）、newForeshadows 新伏笔清单（登场章名，
        │                         #   表面行为不得重复）与 foreshadowBindings 绑定指令（序号不得重复）随规划进确认门
        │                         #   连带确认；产物 ChapterPlanSubmission = plan + newCharacters + newForeshadows
        │                         #   + foreshadowBindings）
        └── auto-character-agent.ts  # 新增角色自动创建 Agent（无确认门：依据世界观与大纲为清单逐个填充角色卡并
                                     #   调 save_character 终态工具入库，isDone 按清单数量判定、maxSteps 耗尽抛
                                     #   可读错误保留已入库卡；增可选 extraContext 附加上下文——章节规划喂章级
                                     #   素材，既有调用方零改动；另导出 filterNewCharacters 编排层兜底 diff 纯函数——
                                     #   剔除库内已有名 / 清单内去重 / 空名剔除；独立导出供写作期工作流复用）

packages/shared/src/     # @novel/shared：双端共享纯 zod 层——领域 schema（worldview / character /
                         #   conflict / outline / chapter-plan / audience / outline-node）+ 展示视图（views）+
                         #   stdio 协议消息（protocol）+ 库查询结果契约（query），
                         #   agent 与客户端共同引用，零运行时依赖

apps/client/             # @novel/client：Electron 客户端（electron-vite 三段式 + React）
├── electron/
│   ├── main.ts          # 主进程：窗口 + AgentProcess（spawn bun headless——AgentStartOptions
│   │                    #   映射 argv（create / plan-chapters / regen-outline /
│   │                    #   polish-character 含表单载荷 / write-chapter 章节正文生成）、
│   │                    #   消息 zod 复验转发、hello 版本校验、退出回收）
│   │                    #   + library 查询 / 管理 IPC（spawn 一次性查询 CLI、shared
│   │                    #   schema 复验、超时兜底；角色管理 addCharacter / updateCharacter）
│   │                    #   + 模型设置 IPC（settings:get/save）+ 主题接线：settings.theme →
│   │                    #   applyTheme() → nativeTheme.themeSource（启动与 settings:save 后
│   │                    #   各一次，主题保存即生效）；窗口 backgroundColor 随
│   │                    #   nativeTheme.shouldUseDarkColors、updated 监听同步底色；
│   │                    #   诊断钩子 NOVEL_CLIENT_THEME=system|light|dark 强制覆盖主题
│   └── preload.ts       # contextBridge 最小 API（start（携带会话参数）/ stop / respond /
│                        #   onMessage / onExit / listNovels / getNovelDetail / rename /
│                        #   setPinned / setFavorite / delete / addCharacter / updateCharacter +
│                        #   诊断钩子读取）
├── src/                 # renderer（React）：App 页面级切换——三栏浏览主页（书库 / 结构树 /
│                        #   预览）↔ 独立创作页（CreationFlow 问答流）↔ 独立章节规划页
│                        #   （ChapterPlanFlow 幕节点「规划本幕章节」问答流）↔ 独立大纲重生成页
│                        #   （OutlineRegenFlow：弹框确认后进入，幕数/部数表单 + 大纲确认门）——
│                        #   三会话页共用 hooks/use-agent-session（agent 会话泵：消息订阅 / 提问队列 / 重启）
│                        #   + NovelListPanel（右键菜单管理：重命名 / 置顶 / 收藏 / 删除
│                        #   强确认——DeleteNovelDialog 输入小说名放行）/ StructureTreePanel
│                        #   （角色与大纲分组可整组收起；角色组头「＋」新增角色；大纲树部/幕可
│                        #   展开收起，「📖 大纲」组头刷新按钮 → OutlineRegenDialog 警示弹框）/
│                        #   PreviewPane（角色卡带编辑入口、新建态渲染表单）/ OutlineNodeCard（幕卡
│                        #   含规划入口；章卡含正文卡与「伏笔」区块——详情 foreshadows 过滤登场/
│                        #   回收两组并解析服务角色名，`toChapterForeshadows` → `ChapterForeshadow`）/ CharacterEditForm（编辑/新建共用：13 字段 + 7 必填校验 +
│                        #   AI 润色回填 + 提交/取消）/ SettingsDialog（⚙️ 设置弹窗：Agent 与
│                        #   写作模型两组字段 + 「外观」主题三选——默认跟随系统，保存即生效）/
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
- `state/`：依赖 `schemas/`（类型）
- `tools/`：依赖 `cli/`（ask-user 需要读用户输入）
- `agents/`：依赖 `providers/`（模型实例）
- `workflows/`：依赖 `agents/ + tools/ + ui/ + state/ + @novel/shared + output/ + cli/ + providers/`，业务编排所在层（模块内部职责与数据流详见 `apps/agent/src/workflows/ARCHITECTURE.md`）
- 任何下层不得反向依赖上层；`apps/agent/src/index.ts` 仅依赖 `workflows/ + cli/`

## 主工作流：createNovel（src/workflows/create-novel.ts）

1. **生成 ID**：调用任何 Agent 之前 `generateNovelId()` 产出 UUIDv7，并立即写入 `novels` 表（name 用户命名或大纲标题回填，description 大纲确认后回填，author 暂未采集）；角色/世界观表经 novel_id 外键关联本表
2. **初始化判断**：`store.get(id)` 无记录 → 新小说，`store.create` 落初始 state（status: initializing）
3. **命名（可选）**：询问小说名称，可回车跳过——未命名时大纲确认后以大纲标题回填 novels.name；已命名时大纲 title 必须沿用该书名（novels 行创建时即携带）
4. **类型**：静态热门类型菜单单选 + 自定义输入
5. **受众**：LLM（generateObject）按类型推断候选 → 用户多选 + 自由补充
6. **世界观**：独立 ReAct Agent（`worldview-agent`）——ask_user 工具多轮追问 → submit_worldview 终态提交（schema 校验），确认后按创作 ID upsert 入库（`worldview-store`）
7. **角色**：独立 ReAct Agent（`character-agent`）——字段协议驱动（13 个扁平字段映射到角色卡 schema）：`ask_user` 征集文本 → `save_field` 逐字段「发散丰富 → 用户确认 → 保存」（标识性字段 name/gender/narrativeRole 照存用户原词不扩写，其余描述性字段以用户描述为种子扩写成 2~4 句设定文字、不照抄原话；确认与反馈在工具 execute 内代码强制）→ 必填字段（姓名、内核三维、背景、创作目的、结局方向）齐全后 `submit_character` 组装整卡并**展示给用户做最终确认**（用户确认无补充才结束；有反馈则处理后重新提交），组装由代码完成并过 schema 校验（杜绝模型漂移）；每张角色卡确认后立即按创作 ID 写入 SQLite（增量持久化，`character-store`）；外层循环支持多角色，约束至少一名主角；内核/背景/创作目的/结局方向为生成后固定不变的属性
8. **核心冲突**：自由文本 → generateObject 归一化（由来/影响/理想解决）
9. **大纲**：先询问幕数（askInt，3-20，直接回车默认 5）再询问部数（1~幕数，默认 1）→ ReAct Agent（`outline-agent`，配 `list_characters` 角色库查询工具——返回库内全部角色名与叙事定位，梳理新增角色须先调用）基于全部参数生成「部 → 幕」两级大纲（用户已命名时 title 沿用书名；结构经 `outlineSchemaFor(actCount, partCount)` refine 强校验恰好 M 部共 N 幕、每部至少一幕，各部幕数由模型按剧情节奏分配；登场而角色库没有的角色列入 `newCharacters` 新增角色清单——名字 + 一句话定位，清单内名字不得重复（经 `saveOutlineInputSchemaFor` 在 save_outline 入参层强校验）、库内已有角色不得列入（提示词层约束，由编排层兜底 diff 把关）；某幕安排中若有伏笔（表面事件背后隐藏着指向后续剧情的真相）列入 `newForeshadows` 伏笔清单——表面行为 + 隐藏真相 + 读者注意度 1-10 + 服务角色名（可引用角色库或 newCharacters 清单名）+ 埋设幕名（必须为本大纲真实幕名，清单内表面行为不得重复、入参层强校验），伏笔挂幕不挂章——登场章在后续章节规划时绑定）→ `save_outline` 内展示「剧情梗概、主题、每部概述与每幕名称概述 + 新增角色与伏笔清单」请用户确认——确认无修改才完成，有修改意见按反馈调整后重新提交确认（循环，清单随大纲连带确认）；确认后 `saveOutlineTree` 两级入库（部为根节点、幕为子节点，整树事务，梗概与关键情节点随节点入列——供写作期按幕内容生成章节大纲）并按 ID 落盘 `output/<id>.json`（`outline-writer`）；随后 state 收尾与回填先行完成（status → outlined；`novelStore.updateNovel`——未命名时 name = 大纲标题，description = logline），再由编排层对清单兜底 diff——`filterNewCharacters`（trim 全等剔除库内已有名、清单内同名去重保留首个、空名剔除，不信任模型的「新增」判定），空清单跳过（零 LLM 调用），非空经 `autoCreateCharacters`（`agents/auto-character-agent`）依据世界观与大纲自动填充角色卡并逐张入库（notify 通报进度与名单）。自动入库置于收尾回填之后：auto 块抛错（maxSteps 耗尽 / 会话中止）时小说本身已是自洽终态，不会停留在「半成品」；随后**伏笔清单入库**（置于角色自动入库之后——服务角色 ID 需角色先入库，伏笔清单可能引用本轮自动入库的新角色）：非空时经 `plantOutlineForeshadows`（`workflows/foreshadow-intake.ts`）确定性创建——幕名→当前版本幕节点、服务角色名→角色 ID（`resolveCharacterIds` trim 全等），幕名 / 服务角色名未匹配逐条跳过并 notify `⚠️ 伏笔跳过…`（不阻塞其余条目），入库 notify「✨ 本次大纲伏笔已入库 N 处（M 处因幕名/角色名未匹配跳过）」，空清单跳过
10. **章节规划不自动衔接**（2026-09-25 起，决策见 DECISIONS）：大纲确认入库落盘后会话即收尾（run_finished），不自动规划第一幕章节——章节规划（章名 + 剧情概述，确认后幕下事务建章）由用户在客户端幕节点卡「规划本幕章节」入口经 `planActChapters` 单幕会话逐幕手动发起（见下节）；`chapter` 阶段枚举与 `chapter-plan` 确认视图保留，归单幕规划会话使用
11. 全程通过 `NovelStateStore` 更新 state（initializing → gathering → outlined；写作状态流转待正文工作流）

## 单幕章节规划工作流（src/workflows/plan-act-chapters.ts）

客户端幕节点卡「规划本幕章节」入口的会话编排（headless `plan-chapters <novelId> <actNodeId>` 模式，决策见 DECISIONS）：

1. **前置校验**（全部抛可读错误，由协议入口转 fatal error）：小说存在 → 幕节点存在、同小说且类型为 act → 幕梗概与关键情节点非空（旧数据缺内容拒绝）→ 所属部节点存在 → 该幕尚无章节点（同一幕重复规划被唯一索引拒绝，修订流为既有待办）→ 世界观已确认（worldviews 表有记录——自动创建新角色需要世界观依据，前置拒绝避免「确认入库后才发现无法自动创建」的中间态，对齐 regen-outline / write-chapter 校验惯例）
2. **上下文组装（全取自库）**：novels.name / description（书名 / logline）+ 部名与部梗概 + 幕名 / 幕梗概 / 关键情节点 + 角色库已有角色行（名 + 叙事定位，与 `list_characters` 工具同源）+ 本幕「未绑登场章」的伏笔清单行（`foreshadow-store.listUnboundByAct`——act_node_id 挂本幕且 appear_chapter_id 为空，随 `planChapters` 第三参注入，prompt 以「序号. 表面行为——隐藏真相」带出，无则不带）；theme 经 `readOutlineTheme` 从 output 产物尽力读取，缺失省略
3. **复用章节 Agent**：`planChapters` 配 `list_characters` 角色库查询工具（返回名 + 叙事定位），系统提示约束章节概述尽量点名出场角色（已有角色用真名、新角色用清单名）、体现伏笔表面行为、登场角色不在库中必须列入 `newCharacters`；`save_chapters` 经 `saveChaptersInputSchema` 结构化入参附顶层新增角色清单（newCharacterSchema：名字 + 一句话定位、定位注明登场章，清单内名字不得重复）、新伏笔清单（chapterNewForeshadowSchema：表面行为 + 隐藏真相 + 注意度 + 服务角色名 + 登场章名，表面行为不得重复）与伏笔绑定指令（foreshadowBindingSchema：回传清单序号 + 登场章名，序号不得重复——既有未绑伏笔要在本幕登场时绑定）——确认视图连带展示「✨ 本次规划新增角色（确认后自动入库）」「✨ 本次规划新增伏笔（确认后自动入库）」「🔗 伏笔绑定（确认后生效）」，拒绝规划即连带作废清单重新提交
4. **入库与新增角色自动创建**：确认后 `saveChapters` 幕下事务批量建章 → 通知入库统计 → `filterNewCharacters` 对清单兜底 diff（trim 全等剔除库内已有名、清单内同名去重保留首个、空名剔除），空清单跳过（零 LLM 调用）；非空组「部/幕」两级伪 Outline（章不进 Outline，规划产物与章节点结构不变）并经 `autoCreateCharacters`（`agents/auto-character-agent`）以世界观 + 伪 Outline + `extraContext`（本次规划的章节列表全文——章节概述是新角色言行的一手素材）自动填充角色卡逐张入库（notify「✨ 本幕规划引入了 N 个新角色…」+ 汇总名单）；随后**伏笔处理**（置于角色自动入库之后——新伏笔的服务角色名可能引用本轮自动入库的新角色）：`plantChapterForeshadows`（`workflows/foreshadow-intake.ts`）确定性执行——newForeshadows 新伏笔带登场章（章名→本次规划章节点）与幕归属（act_node_id 挂本幕）入库，foreshadowBindings 绑定指令把回传清单中的未绑伏笔按 1-based 序号 patch `appear_chapter_id` 到登场章；章名 / 服务角色名未解析、序号越界逐条跳过并 notify 警告（不阻塞其余条目），notify「✨ 本次规划伏笔入库 N 处、绑定 M 处（K 处未匹配跳过）」；run_finished 携带小说 ID 供客户端刷新

## 大纲重新生成工作流（src/workflows/regen-outline.ts）

客户端「📖 大纲」组头刷新按钮经警告弹框确认后的会话编排（headless `regen-outline <novelId>` 模式，决策见 DECISIONS）：

1. **前置校验**（可读错误 → fatal error）：小说存在 → 世界观已确认（worldviews 表有记录）→ 至少一名已入库角色
2. **数量表单**：askInt 幕数（3-20 默认 5）→ 部数（1~幕数 默认 1），与新建流程一致
3. **复用大纲 Agent**：`createOutline` 入参松绑为 `OutlineContext`（worldview / characters 必带，genre / audience / coreConflict 可选——这三项未入库，重生成只喂库内数据，不喂旧大纲避免新版本被旧结构锚定）→ save_outline 确认门（预览-反馈-调整循环）
4. **版本切换入库**：`saveOutlineTreeNewVersion` 单事务——该小说全部当前版本行（部/幕/章，含已生成章节）降级 `is_current_version=0` 归档为历史版本，新树以 `version=max+1` 入库为当前版本；覆盖 `output/<id>.json` 产物、回填 novels.description（logline）；旧节点 ID 随降级失效，客户端完成后重置选中并刷新详情（新幕恢复「规划本幕章节」入口）
5. **新增角色自动入库**：同新建流程收尾动作——`filterNewCharacters` 对新版大纲 `newCharacters` 清单兜底 diff（剔除库内已有名，空清单跳过、零 LLM 调用）→ `autoCreateCharacters` 依据世界观与新版大纲自动填充角色卡并逐张入库（清单随大纲在确认门连带确认过，写库前透明可拦截）
6. **伏笔清单挂接新版幕入库**：同新建流程收尾动作——`plantOutlineForeshadows` 对新版大纲 `newForeshadows` 清单确定性创建（幕名取当前版本树即新版幕节点、服务角色名→角色 ID，未匹配跳过并警告，清单已在大纲确认门连带确认过）；**旧伏笔行保留不动**——regen 只降级大纲节点，伏笔不随归档也不清理（旧伏笔 act_node_id 指向已降级的旧幕节点，悬挂但无害——`listUnboundByAct` 按当前 act 查询天然不回传旧版伏笔，伏笔数据保留在库，同「正文行与归档章关联留存」先例；决策见 DECISIONS）

## 章节正文生成工作流（src/workflows/write-chapter.ts）

客户端章节点卡「✍️ 生成本章正文」入口的会话编排（headless `write-chapter <novelId> <chapterNodeId>` 模式；写作模型未配置回落 Agent 会话模型——headless 的 Key 检查仅在「write-chapter 且写作模型配置齐全」时跳过）：

1. **前置校验**（全部抛可读错误，由协议入口转 fatal error）：小说存在 → 章节点存在、同小说且类型为 chapter → 章剧情概述非空（旧数据缺内容拒绝）→ 所属幕与部节点存在 → 该章尚无正文（documents 一章一份，重新生成为后续需求）→ 世界观已确认（worldviews 表有记录）
2. **上下文组装（全取自库）**：书名 / logline + 世界观 JSON + 角色摘要行（名/定位/外貌/性格/渴望/恐惧，控制 prompt 体积）+ 部名与部梗概 + 幕名与幕梗概及关键情节点 + 本章名与剧情概述 + 同幕前后章名与概述（衔接上文、给下文留空间）
3. **生成与落盘**：`getWritingModel()`（providers/writing-model，OpenAI 接口兼容端点，`WRITING_MODEL_*` 三环境变量齐才启用，任一未配置回落 Agent 会话模型 deepseek）单轮 `generateText`（非 ReAct——无工具无提问），写作要求含 2000~3000 字、遵守世界观禁忌、只输出正文文本；空结果拒绝且零残留。正文经 document-writer 写 `output/<小说名>-<创作ID前8位>/<部名>/<章名>.md`（sanitize 段清理，同名冲突加 `-N` 后缀不覆盖既有文件），文件先落、库后入，库失败回滚删除文件
4. **元数据入库绑定**：`saveChapterDocument` 单事务插 documents 行（file_path 相对路径 + 字数，内容不进库）+ 章节点回写 `document_id` 并置 `status=completed`；notify 保存路径与字数；run_finished 携带小说 ID 供客户端刷新详情（章节点 ID 稳定，选中与正文展示保持）；大纲重生成只降级归档章节点，documents 行与正文文件保留（旧正文与归档章的关联留存）

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
  - `DEEPSEEK_API_KEY`：必填，DeepSeek API Key
  - `DEEPSEEK_MODEL_NAME`：可选，默认 `deepseek-flash`
  - `WRITING_MODEL_NAME` / `WRITING_MODEL_API_KEY` / `WRITING_MODEL_BASE_URL`：可选，写作模型（OpenAI 接口兼容端点，模型名 / Key / Base URL 三项需同时配置）——正文创作时使用，可与 Agent 会话模型不同；任一未配置回落 Agent 会话模型（DeepSeek），正文生成开箱即用
  - `NOVEL_DB_PATH`：可选，SQLite 路径，默认 `data/novel.db`
  - `NOVEL_OUTPUT_DIR`：可选，大纲输出目录，默认 `output`；协议模式下由宿主进程传绝对路径，`hello` 消息回显校验
- SQLite：Bun 内置 `bun:sqlite`，各 store 共享默认连接（懒加载单例），`PRAGMA foreign_keys=ON` 按连接开启。**跨进程并发约定**（agent 会话写库 / 查询 CLI 子进程同时打开库）：所有连接统一 `PRAGMA busy_timeout=5000`（短锁冲突等待重试，而非默认 0 立即抛 database is locked）；`journal_mode` 与 `user_version` 的写入仅在真正需要时执行（幂等读检查 / 只在迁移分支内写）——版本匹配的纯浏览打开是零写操作，WAL 下读连接与写连接天然共存。八张表主键均为应用层生成的 **UUIDv7**（时间有序，索引友好）：`novels`（小说信息，1 的根，`pinned` / `favorite` 为书库管理标记，置顶优先排序、收藏星标不影响排序）；`characters` 与 characterSchema 对应（1:N，自增序 + `novel_id` 外键索引，`version` 为当前版本号），创作流确认后入库 version=1，浏览期编辑经 `updateCharacter` 版本化更新（单事务：旧卡整卡 JSON 快照归档 `character_versions`——`character_id` 外键关联，主行字段全量更新并 version+1；id / novel_id / created_at 稳定不变，伏笔 `character_ids` 引用与客户端选中态不因编辑换代失效）；`character_versions` 为角色历史版本快照表（`character_id` / `novel_id` 外键 + 索引，`version` 记编辑前版本号、`character` 存整卡 JSON 文本，历史版本浏览/回滚 UI 为后续需求）；`worldviews`（1:1，`novel_id` 唯一外键，upsert 覆盖更新，`taboos` 数组存 JSON 文本）；`outlines`（大纲树，`parent_id` 自引用外键 + `novel_id` 外键索引，`type` CHECK 部/幕/章——部/幕为大纲阶段两级，章为章节规划段在幕下批量创建；**内容随节点入库**：`summary` 为部/幕梗概与章剧情概述、`key_plot_points` 为幕级关键情节点（JSON 文本列，仅幕节点携带，schema refine 强约束），供写作期按幕内容生成章节、按章概述写正文；`status` CHECK 计划中/写作中/写作完成/已废弃，同节点多版本行并存 `version`+`is_current_version`，部分唯一表达式索引 `(novel_id, COALESCE(parent_id,''), sort) WHERE is_current_version=1` 保证同父级下当前版本 sort 唯一——根节点 parent 为 NULL，SQLite 唯一索引视 NULL 互异故 COALESCE 归一；大纲确认后经 `saveOutlineTree` 整树事务入库，重复保存被唯一索引拒绝；章节规划确认后经 `saveChapters` 幕下事务批量建章（父级须为幕且同小说，同一幕重复保存同样被唯一索引拒绝）；当前版本切换由调用方先降级旧版再提升新版，`document_id` 为章节正文绑定回写列——documents 表已落地，由 `saveChapterDocument` 入库事务同指针写并置 status=completed，列上外键因 SQLite 不支持 ALTER 补加而由事务与 documents.chapter_id 外键共同保证一致性）；`documents`（章节正文元数据，一章一份：`chapter_id` 唯一外键挂 outlines 章节点、`file_path` 正文文件相对路径——**内容存文件系统** `output/<小说名>-<创作ID前8位>/<部名>/<章名>.md`（顶层带 ID 去重，sanitize 段清理，同名章冲突 -N 后缀）、`word_count` 不含空白字符字数（入库时计算）——`saveChapterDocument` 单事务「插元数据 + 回写章节点 document_id + status=completed」，重复保存被唯一索引拒绝；deleteNovel 级联时先于 outlines 删元数据行并逐文件清理；小说 rename 经 updateFilePaths 联动迁移文件（ID 段不变、仅名段更新）；10→11 迁移把存量 content 内联按「小说名-ID」层级落文件）；`locations`（小说世界的地理位置，`parent_id` 自引用外键成层级（城市→大陆）+ `novel_id` 外键索引，坐标 `x`/`y` REAL、图层 `layer` 自由文本（天上/地面/地底等）、`population` 可空非负整数（无人/未设定 NULL）——数据层先行，创作流采集与客户端浏览后续接入）；`foreshadows`（伏笔，`novel_id` 外键索引：`surface_action` 表面行为 / `hidden_truth` 隐藏的真相必填，`attention_level` CHECK 1-10 读者注意度（1 易发现→10 难发现），`recovery_status` CHECK 枚举 unrecovered/partial/recovered 默认未回收，埋线方式 / 创作目的可选，`appear_chapter_id` 出现章节为可空裸列（chapter 节点写作期落地后补约束，先例 document_id），`act_node_id` 埋设幕节点同为可空裸列（大纲阶段挂幕、章节规划按幕圈定回传「未绑登场章」伏笔并绑定登场章；SQLite 不支持 ALTER 补外键，一致性由写入方保证，先例 outlines.document_id），`recover_chapter_ids` 回收章节 / `character_ids` 服务角色存 JSON 文本多值——完整 CRUD 支持回收状态流转，服务角色应用层校验同小说——**创作流采集已接入**（大纲与章节规划确认后确定性入库），客户端浏览 UI 为后续需求）。schema 变更用 `PRAGMA user_version` 版本号管理（当前 12）：**4→5 起 client 书库已投产，仅做保数据的 ALTER 增量迁移**（4→5 为 novels 增列 pinned / favorite；5→6 为 outlines 增列 summary / key_plot_points，旧行留 NULL 不回填；6→7 为纯新增 locations 表、7→8 为纯新增 foreshadows 表，均由 CREATE TABLE IF NOT EXISTS 幂等落地；8→9 为 characters 增列 version（ALTER，DEFAULT 1 旧行不回填）+ 新增 character_versions 快照表、9→10 为纯新增 documents 表（均由 CREATE TABLE IF NOT EXISTS 幂等落地）、10→11 为 documents 去 content 列改文件存储（存量行 content 先按层级落文件再 DROP 列，file_path 回填）；11→12 为 foreshadows 增列 act_node_id（守卫 `version >= 8 && version <= 11`——foreshadows 表自 v8 起已存在，8~11 的库都持无此列的旧表形态，CREATE TABLE IF NOT EXISTS 对其不生效，故守卫须覆盖整段而非仅 version === 11）；迁移分支按版本链式逐级补列——每段以来源版本守卫（`version === 4` / `version <= 5`），已是目标形态的段不重放，否则重复 ALTER 报 duplicate column），DROP 重建仅保留给开发期旧库（<4）与异常版本的兜底。NovelState 整体（status/params/outline）当前仍为内存态，SQLite 化为后续接入点；整本删除（书库管理）由 `deleteNovel` 单事务级联清七表（outlines / locations 自引用树单语句整删；character_versions 先于 characters 删除——character_id 外键约束）并由查询入口清理 `output/<id>.json` 产物
- stdio JSON 协议（协议模式入口 `headless.ts`，Electron 等宿主 spawn）：消息 schema 定义在 `@novel/shared`（protocol.ts）；启动 `hello` 握手回显数据绝对路径与协议版本；提问 request / 应答 response 按自增 id 关联，无效应答（类型不符 / 越界 / 空 required）以新 id 重问（对齐 CLI 校验循环）；并发 request 由 client 按到达顺序排队呈现；stdin EOF / SIGTERM 即会话结束（state 已增量落库，无需善后；EOF 后 line 提问得 null、其余提问抛 UserAbortedError，与 CLI 语义一致）；协议消息不合法 fail-fast（发 error 消息后退出）。会话模式经 argv 选择（client 侧 `AgentStartOptions` 类型与之一一对应）：无参 = 新建小说全流程；`plan-chapters <novelId> <actNodeId>` = 单幕章节规划；`regen-outline <novelId>` = 大纲重新生成；`polish-character <novelId> [characterId] <formJson>` = 角色 AI 润色（表单 JSON 随 argv，结果经新增 polish-result 消息先行回传）——run_finished 为一次会话正常结束（四种模式共用，携带小说 ID）；会话入参不合法走 stderr NOVEL_AGENT_FATAL + 退出 1，会话内校验失败发 fatal error 消息后退出 1（客户端错误视图）
- Electron 客户端（apps/client）：main 进程 spawn `bun run apps/agent/src/headless.ts`（cwd=仓库根；模型配置经 childEnv() → resolveModelEnv 三级优先级注入——userData/settings.json（⚙️ 设置弹窗维护，明文 JSON）> 根 `.env` > 继承环境变量，空值键删除；`NOVEL_DB_PATH` / `NOVEL_OUTPUT_DIR` 传绝对路径）；`agent:start` IPC 携带 `AgentStartOptions`（新建小说 / `plan-chapters` 单幕规划 / `regen-outline` 大纲重生成 / `polish-character` 角色润色——含表单 JSON 载荷 / `write-chapter` 章节正文生成）映射为 spawn 参数；agent 消息经 zod 复验后 IPC 转发 renderer，hello 时校验协议版本（不匹配拒绝继续）；中断 = 终止子进程（v1 无优雅取消协议）；agent 非零退出 → 错误视图 + 重启按钮（已完成部分已落库）；书库浏览与管理走一次性查询 CLI——`library:*` IPC spawn `bun run apps/agent/src/query.ts`（stdout JSON 经 shared query schema 复验，8s 超时兜底；管理命令 rename / pin / unpin / favorite / unfavorite / delete / add-character / update-character，查询入口统一走 openDatabase 连接以顺带完成版本迁移）；renderer 为页面级切换：三栏浏览主页（左栏书库可汉堡折叠 / 中栏世界观·角色·伏笔·大纲结构树——伏笔组「🔮 伏笔」在角色与大纲之间（按埋设幕两级树：幕顺序对齐当前大纲树、未绑幕与归档旧幕伏笔归「未绑幕」组；组头与幕分组均可收起、会话内保持，点击伏笔叶右栏预览）——角色与大纲分组可整组收起、角色组头「＋」进入右栏新建角色态，改选节点即退出 / 右栏预览）↔ 独立创作页（CreationFlow 挂载即发起会话，整页呈现、头部「←」终止 agent 返回书库；run_finished 后回浏览页刷新书库并选中新作）↔ 独立章节规划页（ChapterPlanFlow：幕节点卡「规划本幕章节」入口进入，`plan-chapters` 模式 spawn，与 CreationFlow 共用 useAgentSession 会话泵；单阶段会话不展示 StageBar；run_finished 后回浏览页刷新详情并保持选中该幕）↔ 独立大纲重生成页（OutlineRegenFlow：「📖 大纲」组头刷新按钮 → OutlineRegenDialog 警示弹框——告知旧大纲与已生成章节将归档清空——确认后进入，`regen-outline` 模式 spawn，run_finished 后回浏览页刷新详情并重置选中——旧节点 ID 已降级失效）。大纲浏览读 outlines 表当前版本节点——结构树按 parentId 建树（部▸/幕·/章），「📖 大纲」组头三角可整组收起/展开（默认展开、会话内保持），部/幕节点可展开收起（三角切换与节点选中解耦，默认全展开、会话内保持），点击节点右栏 OutlineNodeCard 展示该节点 summary 与 keyPlotPoints，幕卡对未规划幕显示「规划本幕章节」入口（已规划的幕隐藏 / 旧数据幕禁用并提示原因），章卡对无正文章显示「✍️ 生成本章正文」入口（write-chapter 内联会话由 PreviewPane 收口：目标章 id 记录生成态、各章入口禁用、run_finished 后刷新详情，卸载即 agent:stop——对齐角色润色订阅模式），有正文时正文卡展示约 N 字全文与落盘路径 output/<小说名>-<创作ID前8位>/<部名>/<章名>.md（详情 documents 按 chapterId 匹配、content 查询时读文件，缺失为 null 占位；重新生成为后续需求），历史数据（6 版迁移前入库）两列为 null 时展示空占位；本章涉及的伏笔以「伏笔」区块展示——详情 foreshadows 过滤登场（appearChapterId 命中本章）/ 回收（recoverChapterIds 含本章）两组（同一伏笔可两组各一条），服务角色 ID 经详情 characters 解析名字（未匹配兜底原 ID），逐条「[登场/回收] 表面行为 ⇢ 隐藏真相（注意度 N，服务：名字…）」、无则不渲染；角色节点右栏为角色卡 + 「✏️ 编辑角色」入口 → CharacterEditForm（13 字段、7 必填校验拦截提交；三按钮——🪄 AI 润色经 polish-character 会话回填表单可重复触发、提交走 updateCharacter 版本化入库（id 稳定选中不失效）、取消零副作用）；伏笔节点右栏为全字段只读卡（表面行为 / 隐藏真相 / 注意度 / 回收状态中文 / 埋设幕名 / 登场章名（未绑定占位）/ 服务角色名 / 埋线方式 / 创作目的——幕/章/角色 ID 解析名字，未匹配兜底原 ID）+「✏️ 编辑伏笔」入口 → ForeshadowEditForm（全字段含登场章下拉单选——选项为当前版本章节点「部/幕/章」名，可清空——与服务角色多选、注意度 1-10 整数与必填校验；提交经 query CLI `update-foreshadow` 直写库——完整卡转 patch：可选空=null 清空、回收章不入 patch 保留现值；成功刷新详情（伏笔 id 稳定选中不失效）、取消零副作用）；「＋」新建角色复用同表单（空初始值，提交后自动选中新角色）；`output/<id>.json` 产物仅供留存与 theme 读取（重生成后覆盖为最新版），不再决定浏览读取；WSL2 需 `disableHardwareAcceleration` + `disable-gpu` + `no-sandbox` + `in-process-gpu`（GPU 子进程启动即崩）；诊断钩子 `NOVEL_CLIENT_AUTOSTART=1`（renderer 自动打开创作覆盖层）/ `NOVEL_CLIENT_SELECT=<novelId>`（自动选中并预览）/ `NOVEL_CLIENT_SCREENSHOT=<path>`（无头冒烟 / 截图存盘退出）/ `NOVEL_CLIENT_THEME=system|light|dark`（强制覆盖外观主题，仅显式设置时生效——无头双主题截图验证用）
- deepseek-flash 对主角归一化存在改写漂移，已通过「强约束 prompt + 用户确认门」缓解（见 DECISIONS）

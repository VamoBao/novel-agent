# 模块架构（项目根目录级）

> Bun workspaces monorepo（`apps/*` 应用 + `packages/*` 共享包）的项目级架构蓝图，维护在根目录；`apps/agent/src/workflows/` 已建立模块文档（见该目录的 `ARCHITECTURE.md` 与 `PROGRESS.md`），其余子目录仍以本文件为准。

## 分层结构

```text
apps/agent/src/
├── index.ts              # CLI 入口：API Key 检查、运行 createNovel、错误处理与优雅退出
├── headless.ts           # 协议模式入口：stdio JSON 行协议（hello 握手 / 消息分发 / EOF·SIGTERM 收尾）
├── query.ts              # 库查询与管理入口：一次性 CLI——查询（list / get）+ 管理
│                         #   （rename / pin / unpin / favorite / unfavorite / delete），
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
│   └── deepseek.ts       # LLM 接入层：DeepSeek provider 实例与 model 导出
├── agents/
│   └── react.ts          # 通用 ReAct Agent 运行器（generateText + stopWhen 终态工具模式）
├── tools/
│   ├── ask-user.ts       # 提供给 LLM 的通用工具：向用户提问并等待回答
│   └── index.ts          # 工具注册表（汇总导出）
├── state/
│   ├── types.ts            # NovelState / NovelParams / NovelStateStore 接口
│   ├── id.ts               # generateUuidV7（封装 Bun.randomUUIDv7，同毫秒单调递增）+ generateNovelId
│   ├── memory-store.ts     # NovelState 内存实现（数据库接入前的过渡，接口不变替换实现即可）
│   ├── db.ts               # SQLite 打开与建表（novels / characters / worldviews / outlines /
│   │                       #   locations / foreshadows，外键开启；user_version 版本化迁移）
│   ├── novel-store.ts      # 小说信息持久化（create/get/update，name 大纲确认后回填）
│   ├── character-store.ts  # 角色按创作 ID 持久化（add/list，读写双向 zod 校验）
│   ├── worldview-store.ts  # 世界观按创作 ID 持久化（upsert/get，taboos 存 JSON）
│   ├── outline-store.ts    # 大纲树按创作 ID 持久化（add/get/list/update + saveOutlineTree 整树事务，梗概与关键情节点随节点入库，读写双向 zod 校验）
│   ├── location-store.ts   # 位置按创作 ID 持久化（add/list，父级同小说校验，读写双向 zod 校验；数据层先行，采集与浏览后续接入）
│   └── foreshadow-store.ts # 伏笔按创作 ID 持久化（add/list/update(patch)/delete 完整 CRUD，服务角色同小说校验，回收状态流转；数据层先行，采集与浏览后续接入）
├── output/
│   └── outline-writer.ts # 大纲落盘：output/<id>.json（id 做文件名安全校验）
└── workflows/
    ├── index.ts         # 模块出口（createNovel / collectWorldview / createOutline）
    ├── create-novel.ts  # 主编排：初始化 → 参数收集 → 大纲生成
    └── agents/
        ├── worldview-agent.ts   # 世界观 ReAct Agent（多轮追问 + 终态提交）
        ├── character-agent.ts   # 角色 ReAct Agent（逐字段「发散丰富→确认→保存」：标识性字段照存原词、描述性字段扩写；终态组装校验）
        └── outline-agent.ts     # 大纲 ReAct Agent（部→幕两级结构，用户确认门 + 幕/部数强校验）

packages/shared/src/     # @novel/shared：双端共享纯 zod 层——领域 schema（worldview / character /
                         #   conflict / outline / audience / outline-node）+ 展示视图（views）+
                         #   stdio 协议消息（protocol）+ 库查询结果契约（query），
                         #   agent 与客户端共同引用，零运行时依赖

apps/client/             # @novel/client：Electron 客户端（electron-vite 三段式 + React）
├── electron/
│   ├── main.ts          # 主进程：窗口 + AgentProcess（spawn bun headless、消息 zod 复验、
│   │                    #   IPC 转发、hello 版本校验、退出回收）+ library 查询 / 管理 IPC
│   │                    #   （spawn 一次性查询 CLI、shared schema 复验、超时兜底）
│   └── preload.ts       # contextBridge 最小 API（start/stop / respond / onMessage / onExit /
│                        #   listNovels / getNovelDetail / rename / setPinned / setFavorite /
│                        #   delete + 诊断钩子读取）
├── src/                 # renderer（React）：App 页面级切换——三栏浏览主页（书库 / 结构树 /
│                        #   预览）↔ 独立创作页（CreationFlow 问答流，头部返回书库）
│                        #   + NovelListPanel（右键菜单管理：重命名 / 置顶 / 收藏 / 删除
│                        #   强确认——DeleteNovelDialog 输入小说名放行）/ StructureTreePanel /
│                        #   PreviewPane / OutlineNodeCard / StageBar / ViewCard / QuestionCard
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
9. **大纲**：先询问幕数（askInt，3-20，直接回车默认 5）再询问部数（1~幕数，默认 1）→ ReAct Agent（`outline-agent`）基于全部参数生成「部 → 幕」两级大纲（用户已命名时 title 沿用书名；结构经 `outlineSchemaFor(actCount, partCount)` refine 强校验恰好 M 部共 N 幕、每部至少一幕，各部幕数由模型按剧情节奏分配）→ `save_outline` 内展示「剧情梗概、主题、每部概述与每幕名称概述」请用户确认——确认无修改才完成，有修改意见按反馈调整后重新提交确认（循环）；确认后 `saveOutlineTree` 两级入库（部为根节点、幕为子节点，整树事务，梗概与关键情节点随节点入列——供写作期按幕内容生成章节大纲）并按 ID 落盘 `output/<id>.json`（`outline-writer`）
9. 全程通过 `NovelStateStore` 更新 state（initializing → gathering → outlined）

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
  - `DEEPSEEK_API_KEY`：必填，DeepSeek API Key
  - `DEEPSEEK_MODEL_NAME`：可选，默认 `deepseek-flash`
  - `NOVEL_DB_PATH`：可选，SQLite 路径，默认 `data/novel.db`
  - `NOVEL_OUTPUT_DIR`：可选，大纲输出目录，默认 `output`；协议模式下由宿主进程传绝对路径，`hello` 消息回显校验
- SQLite：Bun 内置 `bun:sqlite`，各 store 共享默认连接（懒加载单例），`PRAGMA foreign_keys=ON` 按连接开启。**跨进程并发约定**（agent 会话写库 / 查询 CLI 子进程同时打开库）：所有连接统一 `PRAGMA busy_timeout=5000`（短锁冲突等待重试，而非默认 0 立即抛 database is locked）；`journal_mode` 与 `user_version` 的写入仅在真正需要时执行（幂等读检查 / 只在迁移分支内写）——版本匹配的纯浏览打开是零写操作，WAL 下读连接与写连接天然共存。六张表主键均为应用层生成的 **UUIDv7**（时间有序，索引友好）：`novels`（小说信息，1 的根，`pinned` / `favorite` 为书库管理标记，置顶优先排序、收藏星标不影响排序）；`characters` 与 worldviewSchema 对应（1:N，自增序 + `novel_id` 外键索引），角色确认后只增不改；`worldviews`（1:1，`novel_id` 唯一外键，upsert 覆盖更新，`taboos` 数组存 JSON 文本）；`outlines`（大纲树，`parent_id` 自引用外键 + `novel_id` 外键索引，`type` CHECK 部/幕/章——章为写作期预留，大纲阶段只建部/幕两级；**内容随节点入库**：`summary` 为部/幕梗概、`key_plot_points` 为幕级关键情节点（JSON 文本列，仅幕节点携带，schema refine 强约束），供写作期按幕内容生成章节大纲；`status` CHECK 计划中/写作中/写作完成/已废弃，同节点多版本行并存 `version`+`is_current_version`，部分唯一表达式索引 `(novel_id, COALESCE(parent_id,''), sort) WHERE is_current_version=1` 保证同父级下当前版本 sort 唯一——根节点 parent 为 NULL，SQLite 唯一索引视 NULL 互异故 COALESCE 归一；大纲确认后经 `saveOutlineTree` 整树事务入库，重复保存被唯一索引拒绝；当前版本切换由调用方先降级旧版再提升新版，`document_id` 暂为可空裸列待 documents 表落地后补外键——预挂写作期章节正文，与大纲内容列职责分离）；`locations`（小说世界的地理位置，`parent_id` 自引用外键成层级（城市→大陆）+ `novel_id` 外键索引，坐标 `x`/`y` REAL、图层 `layer` 自由文本（天上/地面/地底等）、`population` 可空非负整数（无人/未设定 NULL）——数据层先行，创作流采集与客户端浏览后续接入）；`foreshadows`（伏笔，`novel_id` 外键索引：`surface_action` 表面行为 / `hidden_truth` 隐藏的真相必填，`attention_level` CHECK 1-10 读者注意度（1 易发现→10 难发现），`recovery_status` CHECK 枚举 unrecovered/partial/recovered 默认未回收，埋线方式 / 创作目的可选，`appear_chapter_id` 出现章节为可空裸列（chapter 节点写作期落地后补约束，先例 document_id），`recover_chapter_ids` 回收章节 / `character_ids` 服务角色存 JSON 文本多值——完整 CRUD 支持回收状态流转，服务角色应用层校验同小说——数据层先行，采集与浏览后续接入）。schema 变更用 `PRAGMA user_version` 版本号管理（当前 8）：**4→5 起 client 书库已投产，仅做保数据的 ALTER 增量迁移**（4→5 为 novels 增列 pinned / favorite；5→6 为 outlines 增列 summary / key_plot_points，旧行留 NULL 不回填；6→7 为纯新增 locations 表、7→8 为纯新增 foreshadows 表，均由 CREATE TABLE IF NOT EXISTS 幂等落地；迁移分支按版本链式逐级补列——每段以来源版本守卫（`version === 4` / `version <= 5`），已是目标形态的段不重放，否则重复 ALTER 报 duplicate column），DROP 重建仅保留给开发期旧库（<4）与异常版本的兜底。NovelState 整体（status/params/outline）当前仍为内存态，SQLite 化为后续接入点；整本删除（书库管理）由 `deleteNovel` 单事务级联清六表（outlines / locations 自引用树单语句整删）并由查询入口清理 `output/<id>.json` 产物
- stdio JSON 协议（协议模式入口 `headless.ts`，Electron 等宿主 spawn）：消息 schema 定义在 `@novel/shared`（protocol.ts）；启动 `hello` 握手回显数据绝对路径与协议版本；提问 request / 应答 response 按自增 id 关联，无效应答（类型不符 / 越界 / 空 required）以新 id 重问（对齐 CLI 校验循环）；并发 request 由 client 按到达顺序排队呈现；stdin EOF / SIGTERM 即会话结束（state 已增量落库，无需善后；EOF 后 line 提问得 null、其余提问抛 UserAbortedError，与 CLI 语义一致）；协议消息不合法 fail-fast（发 error 消息后退出）
- Electron 客户端（apps/client）：main 进程 spawn `bun run apps/agent/src/headless.ts`（cwd=仓库根；DEEPSEEK_API_KEY 从根 `.env` 解析注入，`NOVEL_DB_PATH` / `NOVEL_OUTPUT_DIR` 传绝对路径）；agent 消息经 zod 复验后 IPC 转发 renderer，hello 时校验协议版本（不匹配拒绝继续）；中断 = 终止子进程（v1 无优雅取消协议）；agent 非零退出 → renderer 错误视图 + 重启按钮（重启即从头开始，state 已增量落库）；书库浏览与管理走一次性查询 CLI——`library:*` IPC spawn `bun run apps/agent/src/query.ts`（stdout JSON 经 shared query schema 复验，8s 超时兜底；管理命令 rename / pin / unpin / favorite / unfavorite / delete，查询入口统一走 openDatabase 连接以顺带完成版本迁移）；renderer 为页面级切换：三栏浏览主页（左栏书库可汉堡折叠 / 中栏世界观·角色·大纲结构树 / 右栏 ViewCard 预览）↔ 独立创作页（CreationFlow 挂载即发起会话，整页呈现、头部「←」终止 agent 返回书库；run_finished 后回浏览页刷新书库并选中新作；大纲浏览读 outlines 表当前版本节点——结构树按 parentId 建树（部▸/幕·），点击节点右栏 OutlineNodeCard 展示该节点 summary 与 keyPlotPoints，历史数据（6 版迁移前入库）两列为 null 时展示空占位；`output/<id>.json` 产物仅供留存，不再决定浏览读取）；WSL2 需 `disableHardwareAcceleration` + `disable-gpu` + `no-sandbox` + `in-process-gpu`（GPU 子进程启动即崩）；诊断钩子 `NOVEL_CLIENT_AUTOSTART=1`（renderer 自动打开创作覆盖层）/ `NOVEL_CLIENT_SELECT=<novelId>`（自动选中并预览）/ `NOVEL_CLIENT_SCREENSHOT=<path>`（无头冒烟 / 截图存盘退出）
- deepseek-flash 对主角归一化存在改写漂移，已通过「强约束 prompt + 用户确认门」缓解（见 DECISIONS）

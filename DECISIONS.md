# 重大决策记录

记录「为什么」而非「做了什么」：决策背景、备选方案、权衡依据与结论。

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

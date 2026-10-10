# 大纲与章节规划地点自动入库 设计规格

> 状态：**已确认**（2026-10-09——三项选型经用户确认：接入范围 = 大纲（新建+重生成）+ 章节规划三处；数据形态 = 确定性入库 + schema 演进（x/y/layer 放宽可选 + 新增 description，12→13 迁移）；客户端 = 含最小展示（结构树地点组 + 右栏只读卡）。设计全文经用户确认后开始执行。）
> 需求来源：用户提出——和伏笔以及角色一样，在生成大纲和生成章节规划的时候自动新增库里没有的地点信息，时机在大纲确认之后，与角色同批次创建入库。
> 前置依赖：locations 表 + LocationStore 数据层已落地（2026-09-23，库内 0 行、无任何读写方）；角色 / 伏笔自动入库模式（清单连带确认 → 确认后确定性执行）已建立。

## 1. 背景与问题

- 位置数据层先行落地后无采集来源：query CLI 不读 locations、客户端不展示、创作流不写入——整张表闲置。
- 大纲与章节规划天然产出地点信息（大陆、城市、山脉、宗门驻地等），目前随正文文本流失，未沉淀为结构化世界设定。
- 角色（清单 → 确认门连带确认 → ReAct 填卡入库）与伏笔（清单 → 确认门 → 确定性入库）两条自动入库链路已成熟，地点应对齐同族模式接入。

## 2. 用户确认的三项决策

1. **接入范围 = 大纲（新建 + 重生成）+ 单幕章节规划三处**：「生成章节内容」解读为章节规划（有确认门，清单可连带确认）；正文生成会话（单轮无确认门）不接入。
2. **数据形态 = 确定性入库 + schema 演进**：清单只带「名字 + 一句话定位」，确认后确定性代码直建（不调 LLM）；`locationSchema` 放宽 x/y/layer 为可选并新增 `description`（SCHEMA_VERSION 12→13）——不编造地图坐标，坐标留给未来地图功能用户编辑。
3. **客户端 = 含最小展示**：query 契约 novelDetail 增 locations 条目；结构树「📍 地点」组（世界观与角色之间，可收起，空组占位）；右栏只读卡。不做编辑表单。

### 备选与权衡（为何确定性入库而非 LLM 填全卡）

- LLM 填全卡（镜像 autoCreateCharacters）：地点卡能填满 x/y/layer/population，但坐标是依世界观推定的编造值——今天无任何消费方（query 不读、无地图 UI），属假精确数据；且每地点多一轮 LLM 调用。违背 YAGNI。
- 仅入名字不改 schema（x=0/y=0/layer=占位）：实现最小但落脏数据，被否。
- 确定性入库 + schema 演进（选定）：description 是大纲提炼的真实信息；地图向字段放宽可选后由未来地图功能按需补；零 LLM 成本；模式对齐伏笔的确定性入库。

## 3. 详细设计

### 3.1 shared schema 演进（`packages/shared/src/location.ts`）

- `locationSchema`：
  - `name`：必填不变；
  - `description`：**新增**，`z.string().min(1).optional()`——一句话定位（采集时来自大纲 / 规划清单的定位句）；
  - `x` / `y` / `layer`：**放宽为可选**（地图向字段，本轮采集不产生，预留未来地图功能编辑）；
  - `population` / `parentId`：不变（可选）。
- 新增 `newLocationSchema = { name: string(min 1), description: string(min 1) }`（均必填，对齐 `newCharacterSchema` 的 name+role 形态）；导出类型 `NewLocation`。大纲与章节规划共用单变体（地点无伏笔「埋设幕 / 登场章」类的挂接差异，无需两变体）。

### 3.2 shared 视图与查询契约

- `views.ts`：`outlineViewSchema` / `chapterPlanViewSchema` 各增 `newLocations: z.array(newLocationSchema).optional()`——旧协议消息零破坏；确认视图连带展示。
- `query.ts`：新增 `locationEntrySchema = locationSchema.extend({ id: z.string().min(1) })`（对齐 `foreshadowEntrySchema` 模式）；`novelDetailSchema` 增 `locations: z.array(locationEntrySchema)`（按入库顺序）。

### 3.3 DB 迁移（SCHEMA_VERSION 12→13，`apps/agent/src/state/db.ts`）

- locations 表重建：x/y/layer 列 NOT NULL → 可空，新增 `description TEXT` 列。SQLite 无法 ALTER 放宽约束，走「新表临时名建目标结构 → 拷数据 → DROP 旧表 → 改名」重建（沿用 4→5 DROP 重建保数据先例）。
- 迁移守卫 `version >= 7 && version <= 12`（表自 v7 落地；对 v7~v12 任意旧库幂等可达）。CREATE TABLE IF NOT EXISTS 基线 DDL 同步改为目标结构（新库直达，不走迁移段）。
- LocationStore：`LocationRow` / INSERT / SELECT / `rowToLocation` 随可空列与 description 适配（description 非空约束在 schema 层，列层面可空）；`addLocation` / `listLocations` 对外签名不变。

### 3.4 大纲 / 章节两 Agent 采集（`workflows/agents/outline-agent.ts` / `chapter-agent.ts`）

- 两 Agent 各增 `list_locations` 工具（对齐 `list_characters`）：返回库内全部地点的 `{ name, description? }`；描述声明「梳理 newLocations 前必须先调用，清单只能列库内没有的地点」。store 经 options 注入（缺省默认 SQLite，测试可替换）。
- SYSTEM_PROMPT 增「地点梳理要求」段：
  - 大纲 / 章节概述中出现的**真实地理场所**（大陆、城市、山脉、宗门驻地、秘境等）且为剧情发生地的，梳理进 `newLocations`：name 为地点名、description 为一句话定位（如「东部边境要塞·主角初战的战场」）；
  - 库内已有地点（`list_locations` 查询结果）不得列入；清单内名字不得重复；
  - 抽象场所（如「梦中」「回忆里」）与一次性路过无设定价值的地点不列，控制清单信噪比；
  - `newLocations` 随大纲 / 规划进确认门连带展示，确认后自动入库。
- `saveOutlineInputSchemaFor` / `saveChaptersInputSchema` 增 `newLocations: array(newLocationSchema)` + 清单内名字不得重复 refine；`OutlineSubmission` / `ChapterPlanSubmission` 增 `newLocations: NewLocation[]`。
- 确认视图连带传 `newLocations`。

### 3.5 确定性入库模块（`workflows/location-intake.ts`，新建）

- `filterNewLocations(newLocations, existingLocations)` 纯函数（镜像 `filterNewCharacters`）：trim 剔除库内已有名（全等比对）、清单内同名去重保留首个、名字 trim 后为空的项剔除；返回过滤后清单。不信任模型「新增」判定的代码级兜底。
- `plantNewLocations({ novelId, newLocations, channel, locationStore? })`：逐条 `addLocation(novelId, { name, description })` 并 notify `✨ 地点已入库：<name>`；返回 `{ created }`。经 filter 后无未匹配依赖（地点无名字→ID 解析环节），无逐条跳过分支。
- 空清单（过滤后 length 0）由调用方跳过——零调用零提示，对齐角色 / 伏笔惯例。

### 3.6 编排接入（create-novel / regen-outline / plan-act-chapters）

- 三处相同模式：**大纲树 / 章节入库之后、角色自动创建之前**插入地点入库块：
  1. `listLocations` 读库 → `filterNewLocations` 兜底 diff；
  2. 非空则 notify `✨ 本次大纲 / 规划引入了 N 个新地点，正在入库…` → `plantNewLocations` → 汇总 notify `✨ 本次新增 N 个地点已自动入库：名单`；
  3. 过滤后为空则整块跳过。
- 位置理由：地点确定性入库是毫秒级操作，先于角色 ReAct Agent 完成即「与角色同批次」；不做 `Promise.all` 并发——两路 notify 消息会在协议流 / 终端交错，而并发收益为零。伏笔块位置不动（其服务角色名解析依赖角色先入库，与地点无依赖关系）。

### 3.7 query CLI（`apps/agent/src/query.ts`）

- `buildNovelDetail` 增读 `LocationStore.listLocations(novelId)`，映射 `{ id, ...location }` 平铺进 `locations`（按入库顺序，对齐 foreshadows 模式）。

### 3.8 CLI 渲染（`ui/cli-channel.ts` renderView）

- outline / chapter-plan 确认分支：`newLocations` 存在且非空时渲染「✨ 本次大纲新增地点（确认后自动入库）」/「✨ 本次规划新增地点（确认后自动入库）」清单块（`名字——定位` 逐行）；缺失或空不渲染。

### 3.9 客户端

- **ViewCard**（`ViewCard.tsx`）：大纲 / 章节规划确认视图渲染 newLocations 块（标题同上，`名字——定位` 逐行）；缺失或空不渲染。
- **结构树**（`StructureTreePanel.tsx`）：「📍 地点」组插在世界观与角色之间——组头可整组收起（默认展开、会话内保持，对齐角色组）；空组显示「（暂无地点）」占位（对齐现有组惯例）；叶子 `📍 <name>` 点击选中。`Selection` 联合增 `{ kind: "location"; locationId: string }`。
- **右栏只读卡**（`PreviewPane.tsx`）：location 分支——名字 + 描述 + 已设定的可选字段（x/y 坐标、layer、population、父级名——经 detail.locations 解析 parentId→名字，未匹配兜底原 ID）；可选字段未设定不渲染；**不展示 id**（全页面去 ID 约定）。无编辑入口（编辑另起需求）。

## 4. 联动清单

| 联动 | 行为 |
| --- | --- |
| 用户拒绝大纲 / 规划 | newLocations 连带作废，不入库（清单只随确认通过落 submission） |
| 清单项与库内地点同名 | filterNewLocations 兜底剔除 |
| newLocations 空数组 / 过滤后空 | 跳过入库与提示 |
| 旧协议消息（无 newLocations 字段） | view schema optional，照常解析 |
| 旧库 locations 行（含必填坐标） | 12→13 重建迁移保数据，照常读取与展示 |
| 正文生成 / 角色润色会话 | 不接入地点 |
| regen-outline 重生成 | 地点只增不改：新版大纲清单 diff 的是全库地点名，旧版入库地点保留 |

## 5. 验收标准（AC）

1. `bun run typecheck`（3 工程）/ `bun run lint` / `bun run test` 全过，净增用例覆盖：schema 两态（有 / 无可选字段）、newLocationSchema、view 可选字段、query 契约、迁移 12→13 重建保数据、store 可空往返、filterNewLocations 纯函数、plantNewLocations、三编排集成（含空清单跳过与库内同名剔除）、CLI renderView 地点块、客户端 SSR 冒烟（结构树组 + 只读卡）。
2. 真实库副本迁移实跑：12→13 无损（description 列落地、x/y/layer 可空、存量行数据一致）。
3. 真实 LLM 端到端待用户复验：`bun run dev` 或客户端走大纲 / 章节规划确认门，观察「✨ 新增地点」清单展示；确认后查 locations 表（name + description 入库）与客户端结构树「📍 地点」组。

## 6. 不做范围

- 地点编辑表单与增删管理（对齐 ForeshadowEditForm 的编辑流另起需求）；
- 父级层级（parentId）的自动梳理——大纲极少给出严格包含关系，且树形展示无消费；仍支持手工指定（store 能力保留）；
- x / y / layer / population 的自动填充（LLM 填卡路线被否）；
- 地图功能；
- 正文生成会话接入地点。

# 模块架构（项目根目录级）

> 本项目暂无多模块划分，架构文档维护在根目录。引入 `src/` 子模块划分后，各模块可另建自己的架构文档。

## 分层结构

```text
src/
├── index.ts              # CLI 入口：API Key 检查、运行 createNovel、错误处理与优雅退出
├── cli/
│   └── prompt.ts         # 交互输入原语（askLine/askSelect/askMultiSelect/askConfirm）
│                         #   TTY → node:readline；管道/文件 → 自维护行缓冲（见 DECISIONS）
│                         #   并发读取自动串行化：FIFO 排队，提示语轮到时才写入，
│                         #   兼容 ReAct Agent 一步内并行调用多个需用户确认的工具
├── schemas/              # zod schema 层：worldview / character / conflict / outline / audience
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
│   ├── db.ts               # SQLite 打开与建表（novels / characters / worldviews，外键开启）
│   ├── novel-store.ts      # 小说信息持久化（create/get/update，name 大纲确认后回填）
│   ├── character-store.ts  # 角色按创作 ID 持久化（add/list，读写双向 zod 校验）
│   └── worldview-store.ts  # 世界观按创作 ID 持久化（upsert/get，taboos 存 JSON）
├── output/
│   └── outline-writer.ts # 大纲落盘：output/<id>.json（id 做文件名安全校验）
└── workflows/
    ├── create-novel.ts   # 主编排：初始化 → 参数收集 → 大纲生成
    └── agents/
        ├── worldview-agent.ts   # 世界观 ReAct Agent（多轮追问 + 终态提交）
        ├── character-agent.ts   # 角色 ReAct Agent（逐字段「概括→确认→保存」+ 终态组装校验）
        └── outline-agent.ts     # 大纲 ReAct Agent（结构化保存）
```

## 依赖边界

- `providers/`：最底层，不依赖其他 src 目录
- `schemas/`：纯类型定义，不依赖其他 src 目录
- `cli/`：只依赖 node 内置模块
- `state/`：依赖 `schemas/`（类型）
- `tools/`：依赖 `cli/`（ask-user 需要读用户输入）
- `agents/`：依赖 `providers/`（模型实例）
- `workflows/`：依赖 `agents/ + tools/ + state/ + schemas/ + cli/ + providers/`，业务编排所在层
- 任何下层不得反向依赖上层；`src/index.ts` 仅依赖 `workflows/ + cli/`

## 主工作流：createNovel（src/workflows/create-novel.ts）

1. **生成 ID**：调用任何 Agent 之前 `generateNovelId()` 产出 UUIDv7，并立即写入 `novels` 表（name 用户命名或大纲标题回填，description 大纲确认后回填，author 暂未采集）；角色/世界观表经 novel_id 外键关联本表
2. **初始化判断**：`store.get(id)` 无记录 → 新小说，`store.create` 落初始 state（status: initializing）
3. **命名（可选）**：询问小说名称，可回车跳过——未命名时大纲确认后以大纲标题回填 novels.name；已命名时大纲 title 必须沿用该书名（novels 行创建时即携带）
4. **类型**：静态热门类型菜单单选 + 自定义输入
5. **受众**：LLM（generateObject）按类型推断候选 → 用户多选 + 自由补充
6. **世界观**：独立 ReAct Agent（`worldview-agent`）——ask_user 工具多轮追问 → submit_worldview 终态提交（schema 校验），确认后按创作 ID upsert 入库（`worldview-store`）
7. **角色**：独立 ReAct Agent（`character-agent`）——字段协议驱动（13 个扁平字段映射到角色卡 schema）：`ask_user` 征集文本 → `save_field` 逐字段「概括总结 → 用户确认 → 保存」（确认与反馈在工具 execute 内代码强制）→ 必填字段（姓名、内核三维、背景、创作目的、结局方向）齐全后 `submit_character` 组装整卡并**展示给用户做最终确认**（用户确认无补充才结束；有反馈则处理后重新提交），组装由代码完成并过 schema 校验（杜绝模型漂移）；每张角色卡确认后立即按创作 ID 写入 SQLite（增量持久化，`character-store`）；外层循环支持多角色，约束至少一名主角；内核/背景/创作目的/结局方向为生成后固定不变的属性
8. **核心冲突**：自由文本 → generateObject 归一化（由来/影响/理想解决）
9. **大纲**：先询问幕数（askInt，3-20，直接回车默认 5）→ ReAct Agent（`outline-agent`）基于全部参数生成大纲（用户已命名时 title 沿用书名；幕数经 `outlineSchemaForActs` refine 强校验恰好 N 幕，模型给错幕数会被 schema 拒绝重试）→ `save_outline` 内展示「剧情梗概、主题、每幕名称与概述」请用户确认——确认无修改才完成；有修改意见则按反馈调整后重新提交确认（循环），完成后按 ID 落盘 `output/<id>.json`（`outline-writer`）
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
- SQLite：Bun 内置 `bun:sqlite`，各 store 共享默认连接（懒加载单例），`PRAGMA foreign_keys=ON` 按连接开启。三张表主键均为应用层生成的 **UUIDv7**（时间有序，索引友好）：`novels`（小说信息，1 的根）；`characters` 与 worldviewSchema 对应（1:N，自增序 + `novel_id` 外键索引），角色确认后只增不改；`worldviews`（1:1，`novel_id` 唯一外键，upsert 覆盖更新，`taboos` 数组存 JSON 文本）。schema 变更用 `PRAGMA user_version` 版本号管理：不匹配即重建（开发期数据可弃，接入生产需改为正式迁移）。NovelState 整体（status/params/outline）当前仍为内存态，SQLite 化为后续接入点
- deepseek-flash 对主角归一化存在改写漂移，已通过「强约束 prompt + 用户确认门」缓解（见 DECISIONS）

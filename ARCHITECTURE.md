# 模块架构（项目根目录级）

> 本项目暂无多模块划分，架构文档维护在根目录。引入 `src/` 子模块划分后，各模块可另建自己的架构文档。

## 分层结构

```text
src/
├── index.ts              # CLI 入口：API Key 检查、运行 createNovel、错误处理与优雅退出
├── cli/
│   └── prompt.ts         # 交互输入原语（askLine/askSelect/askMultiSelect/askConfirm）
│                         #   TTY → node:readline；管道/文件 → 自维护行缓冲（见 DECISIONS）
├── schemas/              # zod schema 层：worldview / character / conflict / outline / audience
├── providers/
│   └── deepseek.ts       # LLM 接入层：DeepSeek provider 实例与 model 导出
├── agents/
│   └── react.ts          # 通用 ReAct Agent 运行器（generateText + stopWhen 终态工具模式）
├── tools/
│   ├── ask-user.ts       # 提供给 LLM 的通用工具：向用户提问并等待回答
│   └── index.ts          # 工具注册表（汇总导出）
├── state/
│   ├── types.ts          # NovelState / NovelParams / NovelStateStore 接口
│   ├── id.ts             # generateNovelId（UUID，state 入库主键）
│   └── memory-store.ts   # 内存实现（数据库接入前的过渡，接口不变替换实现即可）
└── workflows/
    ├── create-novel.ts   # 主编排：初始化 → 参数收集 → 大纲生成
    └── agents/
        ├── worldview-agent.ts  # 世界观 ReAct Agent（多轮追问 + 终态提交）
        └── outline-agent.ts    # 大纲 ReAct Agent（结构化保存）
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

1. **生成 ID**：调用任何 Agent 之前 `generateNovelId()` 产出 UUID，作为 state 存库唯一标识
2. **初始化判断**：`store.get(id)` 无记录 → 新小说，`store.create` 落初始 state（status: initializing）
3. **类型**：静态热门类型菜单单选 + 自定义输入
4. **受众**：LLM（generateObject）按类型推断候选 → 用户多选 + 自由补充
5. **世界观**：独立 ReAct Agent（`worldview-agent`）——ask_user 工具多轮追问 → submit_worldview 终态提交（schema 校验）
6. **主角**：自由文本 → generateObject 按 characterSchema 归一化 → 用户确认（不满意可重新描述），循环支持多主角
7. **核心冲突**：自由文本 → generateObject 归一化（由来/影响/理想解决）
8. **大纲**：ReAct Agent（`outline-agent`）基于全部参数生成 ≥3 幕结构大纲 → save_outline 保存
9. 全程通过 `NovelStateStore` 更新 state（initializing → gathering → outlined）

## ReAct 终态工具模式（src/agents/react.ts）

- `runReactAgent` 封装 `generateText({ tools, stopWhen })`
- 调用方定义携带 zod schema 的「终态工具」（submit_worldview / save_outline），execute 闭包记录结果
- `stopWhen: [hasToolCall(终态工具), stepCountIs(maxSteps)]` 双保险停止
- 优点：结果天然过 schema 校验；无需解析 toolResults 结构

## 关键约定

- 环境变量（Bun 自动加载 `.env`，参考 `.env.example`）：
  - `DEEPSEEK_API_KEY`：必填，DeepSeek API Key
  - `DEEPSEEK_MODEL_NAME`：可选，默认 `deepseek-flash`
- state 当前为内存态（进程重启即失）；数据库接入时实现 `NovelStateStore` 接口替换 `memoryNovelStateStore` 即可，工作流代码零改动
- deepseek-flash 对主角归一化存在改写漂移，已通过「强约束 prompt + 用户确认门」缓解（见 DECISIONS）

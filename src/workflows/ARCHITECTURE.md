# workflows 模块架构

> 业务编排层：多步骤流程、模型与工具组合所在层，是依赖图的最高层（仅被 `src/index.ts` 导入）。
> 项目级蓝图见根目录 `ARCHITECTURE.md`；本文件描述模块内部的文件职责、协作协议与数据流。

## 文件职责

```text
src/workflows/
├── index.ts                  # 模块出口：createNovel / collectWorldview / createOutline
├── create-novel.ts           # 主编排 createNovel：ID 生成 → 参数收集 → 大纲生成 → 入库与落盘
└── agents/                   # 业务 subAgent（每个对应一个创作环节）
    ├── worldview-agent.ts    # collectWorldview：多轮追问补全世界观（终态工具 submit_worldview）
    ├── character-agent.ts    # createCharacter：字段协议逐字段确认角色卡（save_field / submit_character）
    │                         #   另导出 FIELD_NAMES / FIELD_SPECS / missingRequiredFields / assembleCharacter 纯函数
    ├── outline-agent.ts      # createOutline：生成「部→幕」两级大纲并过用户确认门（save_outline）
    │                         #   另导出 outlineSchemaFor（恰好 M 部共 N 幕 refine 强校验）
    ├── character-agent.test.ts  # 字段协议纯函数单测（规格完整性 / 缺失列表 / 组装校验）
    └── outline-agent.test.ts    # 结构校验单测（恰好 M 部共 N 幕：通过 / 拒绝含提示 / 底座每部至少一幕）
```

> 命名辨析：本目录 `agents/` 是业务 subAgent；兄弟层 `src/agents/react.ts` 是跨模块复用的通用 ReAct 运行器（底层设施），二者不是同一层。

## 依赖边界

- `create-novel.ts` → `ai`（generateObject）、`providers/`（model）、`cli/`（askSelect/askMultiSelect/askOptional/askRequired/askInt）、`schemas/`、`state/`（types / id / memory-store / novel-store / character-store / worldview-store / outline-store）、`output/`（outline-writer）、本模块 `agents/`
- `agents/*.ts` → `ai`（tool）、`zod`、`src/agents/`（runReactAgent）、`tools/`（ask-user 工厂）、`cli/`（askConfirm/askOptional/askRequired）、`schemas/`、`state/types`（仅 outline-agent 需要 NovelParams 类型）
- 下层不得反向依赖本模块；`createCharacter` 目前仅供模块内编排使用，未入 `index.ts` 出口
- `CreateNovelOptions` 支持注入 `store / characterStore / worldviewStore / novelStore`，缺省用内存 state store + 各默认 SQLite store（测试与未来换实现不改编排代码）

## 主工作流数据流（createNovel）

1. **ID 与初始化**：`generateNovelId()` 在调用任何 Agent / LLM 之前生成；`store.get(id)` 已有记录则直接返回（续作/恢复预留，目前仅原样返回既有 state）；否则 `store.create`（status: initializing）
2. **命名（可选）**：`askOptional`，跳过则大纲确认后以大纲标题回填
3. **novels 行创建**：先于角色/世界观入库（外键顺序），携带用户命名（如有）
4. **【1/5】类型**：静态热门类型菜单单选 + 自定义输入
5. **【2/5】受众**：`generateObject`（audienceSuggestionSchema）推断候选 → 用户多选 + 自由补充，只存标签
6. **【3/5】世界观**：`askRequired` 初始描述 → `collectWorldview` → 打印确认 → `worldviewStore.saveWorldview`（upsert 入库）
7. **【4/5】角色**：`for(;;)` 循环（至少一名叙事定位含「主角」的角色）→ `createCharacter` → `characterStore.addCharacter` 每卡确认后立即增量入库
8. **【5/5】核心冲突**：自由文本 → `generateObject`（coreConflictSchema）归一化
9. **state 落 params**：status → gathering
10. **幕数与部数**：`askInt` 幕数（3-20，回车默认 5）→ `askInt` 部数（1~幕数，回车默认 1）
11. **大纲**：`createOutline(params, { novelTitle, actCount, partCount })` → `printOutline` 两级完整展示 → `saveOutlineTree` 整树事务入库（部根节点 / 幕子节点，version=1/当前/planned）→ `saveOutline` 落盘 `output/<id>.json`
12. **收尾**：status → outlined；`novelStore.updateNovel` 回填（未命名时 name = outline.title；description = outline.logline）

入库时机小结：novels 初始化即建（先于其余表）｜worldviews 确认后 upsert｜characters 每卡确认后增量｜outlines 大纲确认后整树事务入库（saveOutlineTree）＋大纲 JSON 落盘 output｜NovelState 仍为内存态。

## subAgent 协作协议（三 Agent 共性）

- **终态工具模式**：`submit_worldview` / `submit_character` / `save_outline` 的 `inputSchema` 即结果 schema，execute 闭包记录结果，`isDone` 判定终态；终态未达成时抛错（带 stepCount 与最后输出）。结构化组装一律由代码完成（assembleCharacter / schema.parse），杜绝模型在提交时改写数据
- **停止策略二分**（见根 ARCHITECTURE「ReAct 终态工具模式」）：
  - 提交不会被否决（worldview）：`stopTool: submit_worldview` + maxSteps 16
  - 终态内含用户最终确认、可被拒需继续修订（character / outline）：不设 stopTool，maxSteps 30 / 12 + `isDone` + `continuationHint` 续跑提示
- **确认视图原子出现**：字段摘要、角色卡汇总、大纲草稿一律拼入 `askConfirm` 的提示参数，禁止先 console.log 再问（并发工具调用时提示与提问按队列原子配对，依赖 `cli/prompt.ts` 串行化）
- **用户终止约定**：`ask_user` 返回「用户已终止输入」（EOF）时，Agent 须停止提问并基于已有信息提交/结束，不得拖延
- **确认循环**：用户给出修改意见 → 工具返回 `{ ok: false, feedback }` → 模型按反馈处理后重新调用终态工具，直到确认

## 测试

模块内单测聚焦**可脱离 LLM 的纯函数**：字段协议（`FIELD_SPECS` 完整性、`missingRequiredFields`、`assembleCharacter` 过 schema）与大纲结构校验（`outlineSchemaFor` 恰好 M 部共 N 幕）。Agent 循环本身依赖真实 LLM 与用户交互，走端到端验证（记录见 PROGRESS）。

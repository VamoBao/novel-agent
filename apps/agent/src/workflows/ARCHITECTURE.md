# workflows 模块架构

> 业务编排层：多步骤流程、模型与工具组合所在层，是依赖图的最高层（仅被应用入口 `apps/agent/src/index.ts` 导入）。
> 项目级蓝图见根目录 `ARCHITECTURE.md`；本文件描述模块内部的文件职责、协作协议与数据流。

## 文件职责

```text
apps/agent/src/workflows/
├── index.ts                  # 模块出口：createNovel / planActChapters / collectWorldview /
│                             #   createOutline / planChapters
├── create-novel.ts           # 主编排 createNovel：ID 生成 → 参数收集 → 大纲生成 → 第一幕章节规划 → 入库与落盘
├── plan-act-chapters.ts      # 单幕章节规划编排 planActChapters：校验并从库组装上下文 →
│                             #   复用章节 Agent（确认门）→ saveChapters 幕下建章；
│                             #   客户端幕节点「规划本幕章节」入口的会话（headless plan-chapters 模式）
└── agents/                   # 业务 subAgent（每个对应一个创作环节）
    ├── worldview-agent.ts    # collectWorldview：多轮追问补全世界观（终态工具 submit_worldview）
    ├── character-agent.ts    # createCharacter：字段协议逐字段确认角色卡（save_field / submit_character）
    │                         #   另导出 FIELD_NAMES / FIELD_SPECS / missingRequiredFields / assembleCharacter 纯函数
    ├── outline-agent.ts      # createOutline：生成「部→幕」两级大纲并过用户确认门（save_outline）
    │                         #   另导出 outlineSchemaFor（恰好 M 部共 N 幕 refine 强校验）
    ├── chapter-agent.ts      # planChapters：单幕拆章——按幕梗概与情节点推荐章节数量与概述，
    │                         #   过用户确认门（save_chapters；chapterPlanSchema 强约束 1~12 章）
    ├── character-agent.test.ts  # 字段协议纯函数单测（规格完整性 / 缺失列表 / 组装校验）
    ├── outline-agent.test.ts    # 结构校验单测（恰好 M 部共 N 幕：通过 / 拒绝含提示 / 底座每部至少一幕）
    ├── plan-act-chapters.test.ts # 单幕规划集成（mock ai + FakeChannel + 临时 SQLite：
    │                             #   成功路径 / 五类前置校验 / 确认门中止）
    └── create-novel.test.ts     # 全流程集成（mock ai + FakeChannel + 临时 SQLite，含通道中止）
```

> 命名辨析：本目录 `agents/` 是业务 subAgent；兄弟层 `src/agents/react.ts` 是跨模块复用的通用 ReAct 运行器（底层设施），二者不是同一层。

## 依赖边界

- `create-novel.ts` → `ai`（generateObject）、`providers/`（model）、`ui/`（UiChannel：全部提问 / 确认 / 展示的唯一出口）、`@novel/shared`（schemas）、`state/`（types / id / memory-store / novel-store / character-store / worldview-store / outline-store）、`output/`（outline-writer）、本模块 `agents/`
- `plan-act-chapters.ts` → `ui/`（UiChannel 注入）、`state/`（novel-store / outline-store）、`output/`（outline-writer readOutlineTheme）、本模块 `agents/`（planChapters）——不直接触碰 `ai` / `providers/`（模型调用都在章节 Agent 内）；store 可注入（缺省默认 SQLite store，测试替换）
- `agents/*.ts` → `ai`（tool）、`zod`、`src/agents/`（runReactAgent）、`tools/`（ask-user 工厂，经注入的 channel 提问）、`ui/`（UiChannel 注入：确认门携带结构化视图）、`@novel/shared`（schemas）、`state/types`（仅 outline-agent 需要 NovelParams 类型）
- 下层不得反向依赖本模块；`createCharacter` 目前仅供模块内编排使用，未入 `index.ts` 出口
- `CreateNovelOptions` 注入 `channel`（必填）与 `store / characterStore / worldviewStore / novelStore / outlineStore`，store 缺省用内存 state store + 各默认 SQLite store（测试与未来换实现不改编排代码）
- `PlanActChaptersOptions` 注入 `channel`（必填）+ `novelId / actNodeId` 与 `novelStore / outlineStore`（缺省默认 SQLite store）

## 主工作流数据流（createNovel）

1. **ID 与初始化**：`generateNovelId()` 在调用任何 Agent / LLM 之前生成；`store.get(id)` 已有记录则直接返回（续作/恢复预留，目前仅原样返回既有 state）；否则 `store.create`（status: initializing）
2. **命名（可选）**：`channel.askText`（optional），跳过则大纲确认后以大纲标题回填
3. **novels 行创建**：先于角色/世界观入库（外键顺序），携带用户命名（如有）
4. **【1/5】类型**：静态热门类型菜单单选 + 自定义输入
5. **【2/5】受众**：`generateObject`（audienceSuggestionSchema）推断候选 → 用户多选 + 自由补充，只存标签
6. **【3/5】世界观**：`channel.askText` 初始描述 → `collectWorldview(desc, channel)` → `channel.present(worldview)` → `worldviewStore.saveWorldview`（upsert 入库）
7. **【4/5】角色**：`for(;;)` 循环（至少一名叙事定位含「主角」的角色）→ `createCharacter(desc, characters, channel)` → `characterStore.addCharacter` 每卡确认后立即增量入库
8. **【5/5】核心冲突**：自由文本 → `generateObject`（coreConflictSchema）归一化
9. **state 落 params**：status → gathering
10. **幕数与部数**：`askInt` 幕数（3-20，回车默认 5）→ `askInt` 部数（1~幕数，回车默认 1）
11. **大纲**：`createOutline(params, { novelTitle, actCount, partCount }, channel)` → `channel.present(outline full)` 两级完整展示 → `saveOutlineTree` 整树事务入库（部根节点 / 幕子节点，version=1/当前/planned，梗概与关键情节点随节点入列——供写作期按幕内容生成章节大纲）→ `saveOutline` 落盘 `output/<id>.json`
12. **章节规划（第一幕）**：取 `saveOutlineTree` 返回树中首个 act 节点为第一幕（连同其所属部）→ `planChapters(大纲全局 + 部 + 幕上下文, channel)` 推荐本幕章节规划（数量模型推荐、schema 约束 1~12；每章章名 + 剧情概述）→ `saveChapters` 幕下事务批量建 chapter 子节点（sort 从 1 递增，概述随节点入列）→ notify 入库统计
13. **收尾**：status → outlined；`novelStore.updateNovel` 回填（未命名时 name = outline.title；description = outline.logline）

## 单幕章节规划数据流（planActChapters）

客户端幕节点卡「规划本幕章节」入口（headless `plan-chapters <novelId> <actNodeId>` 模式）触发的独立会话，与 createNovel 共用章节 Agent 与入库函数：

1. **前置校验**（可读错误，协议入口转 fatal error）：`novelStore.getNovel` → 幕节点存在 / 同小说 / 类型 act → 幕 summary 与 keyPlotPoints 非空（旧数据缺内容拒绝）→ `getOutlineNode(parentId)` 得所属部 → `listOutlineNodes(currentOnly)` 无 chapter 子节点（同一幕重复规划被唯一索引拒绝，修订流为既有待办）
2. **上下文组装（全取自库）**：novels.name / description（书名 / logline）+ 部名 / 部梗概 + 幕名 / 幕梗概 / 情节点；theme 经 `readOutlineTheme` 从 `output/<id>.json` 尽力读取，缺失省略
3. **复用 `planChapters`**（save_chapters 确认门循环）→ `saveChapters` 幕下批量建章 → notify 入库统计；阶段通知 `chapter`

入库时机小结：novels 初始化即建（先于其余表）｜worldviews 确认后 upsert｜characters 每卡确认后增量｜outlines 大纲确认后整树事务入库（saveOutlineTree，梗概与关键情节点随节点入列，keyPlotPoints 仅幕节点）＋大纲 JSON 落盘 output（产物仅供留存与 theme 读取；客户端浏览已切换为读 outlines 表节点）｜chapters 章节规划确认后幕下事务批量入库（saveChapters，概述随节点入列；新建小说首幕与客户端单幕会话同走此函数）｜NovelState 仍为内存态。

## subAgent 协作协议（四 Agent 共性）

- **终态工具模式**：`submit_worldview` / `submit_character` / `save_outline` / `save_chapters` 的 `inputSchema` 即结果 schema，execute 闭包记录结果，`isDone` 判定终态；终态未达成时抛错（带 stepCount 与最后输出）。结构化组装一律由代码完成（assembleCharacter / schema.parse），杜绝模型在提交时改写数据
- **停止策略二分**（见根 ARCHITECTURE「ReAct 终态工具模式」）：
  - 提交不会被否决（worldview）：`stopTool: submit_worldview` + maxSteps 16
  - 终态内含用户最终确认、可被拒需继续修订（character / outline / chapter）：不设 stopTool，maxSteps 30 / 12 / 12 + `isDone` + `continuationHint` 续跑提示
- **确认视图原子出现**：字段摘要、角色卡汇总、大纲草稿、章节规划一律作为 `channel.askConfirm` 的 view 载荷与提问原子绑定（并发工具调用时按通道串行化依次呈现），禁止先展示再问
- **用户终止约定**：`ask_user` 返回「用户已终止输入」（EOF）时，Agent 须停止提问并基于已有信息提交/结束，不得拖延
- **确认循环**：用户给出修改意见 → 工具返回 `{ ok: false, feedback }` → 模型按反馈处理后重新调用终态工具，直到确认

## 测试

模块内测试两层：单测聚焦**可脱离 LLM 的纯函数**——字段协议（`FIELD_SPECS` 完整性、`missingRequiredFields`、`assembleCharacter` 过 schema）与大纲结构校验（`outlineSchemaFor` 恰好 M 部共 N 幕）；`create-novel.test.ts` 与 `plan-act-chapters.test.ts` 为**全流程 / 会话集成测试**——mock `ai` 模块（generateObject 返回 fixture、generateText 按脚本逐轮执行工具 execute，含 save_chapters 章节规划轮）+ `FakeChannel` 脚本化应答 + 临时 SQLite，不依赖真实 LLM 验证全链路（含 UserAbortedError 通道中止；plan-act-chapters 另覆盖五类前置校验错误路径）。真实 LLM 端到端验证记录见 PROGRESS。

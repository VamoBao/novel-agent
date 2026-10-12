# 章节正文生成校验-修订闭环 设计规格

> 状态：**已确认**（2026-10-12——三项决策经用户确认：①循环 3 轮上限、仍未达标保存最后一版并警告；②校验模型用 Agent 会话模型 deepseek；③重写采用修订式（原文+报告针对性修订）。设计全文经用户确认后开始执行。）
> 需求来源：用户提出——正文保存到本地之前新增校验步骤：用新 subagent（独立 LLM 调用、上下文不继承生成对话）做三段校验（内容约束 / 文风相似度 / 前后自洽），汇总为结构化整改报告；未达标按报告重新生成直至验收通过（校验也是一个 loop）；客户端展示流程进度（生成 → 校验 → 重新生成 → 通过保存）。
> 前置依赖：write-chapter 链路已成熟（上下文组装、伏笔注入 `foreshadow-context.ts`、文风注入、文件落盘+元数据入库、store 注入式测试替身惯例）；stdio JSON 协议 `agentMessageSchema` 可扩展（zod discriminatedUnion 旧消息零破坏先例：polish-result）；客户端 PreviewPane 内联会话订阅模式（write-chapter 收口）已成型。

## 1. 背景与问题

当前 write-chapter 是「单轮 generateText → 落文件 → 入库」的直通链路：正文质量完全依赖写作模型一次性发挥，没有任何事后把关。三个具体问题：

1. **设定违背无拦截**：正文与世界观（尤其 taboos）、章节概述的偏离只能在生成后靠人眼发现；
2. **伏笔体现无验证**：注入了伏笔卡片但正文是否真的「自然带出登场伏笔 / 呼应登场细节回收」没有验证（伏笔上下文是上一需求刚落地的，其效果缺少闭环）；
3. **文风无量化把关**：参考文风注入后模仿得像不像全凭感觉，用户明确要求「相似度达到 90 分才算合格」；
4. **前后自洽无校验**：一章内部的描述矛盾（前文说「五个字」后文说「四个字」、说了从未说过的话等）无人检查。

本需求在「生成之后、落盘之前」插入三段式校验与按报告修订的循环，并让客户端可见全流程。

## 2. 用户确认的决策

1. **循环上限 3 轮，仍未达标保存最后一版并警告**：初稿 + 最多 2 轮修订；第 3 轮仍不达标 → 照常落盘入库（用户选择产物优先），notify 附未达标警告与报告摘要（文风分、各类问题数）。否决「不达标即失败」（产物优先）；否决「不设上限」（成本失控风险）。
2. **校验模型 = Agent 会话模型 deepseek**：校验是结构化分析任务（输出 JSON 报告），deepseek 擅长且便宜；配置了独立写作模型时天然「他评」而非「自评」。**连带影响：write-chapter 会话从此始终需要 `DEEPSEEK_API_KEY`**（headless 启动时「写作模型配置齐全即免 Key 检查」的豁免退役）。否决「写作模型」（自评偏松）；否决「新增 REVIEW_MODEL_* 三变量」（当前阶段过度设计）。
3. **修订式重写**：修订轮 prompt = 原始写作上下文 + 【上一版正文】+【整改报告】→ 按报告逐条修订。已达标部分稳定保留、token 更省、收敛快。否决「全量重写」（每轮成本高且可能引入新问题、循环不易收敛）。

## 3. 详细设计

### 3.1 总体流程（writeChapter 改造后）

```
前置校验（不变）→ 库内组上下文（不变：世界观/角色/部幕/概述/前后章/伏笔/文风）
┌─ 第 N 轮（N=1 初稿；N=2,3 修订）
│    生成：写作模型单轮 generateText
│      N=1：现有 prompt 原样；N≥2：原 prompt + 【上一版正文】+【整改报告】块 + 修订要求
│    校验（新模块 chapter-review.ts，deepseek，三段各自独立单轮调用）：
│      ① 内容约束：世界观 JSON + 章节概述 + 本章伏笔上下文行 + 正文 → issue[]
│      ② 文风对比：启用文风样本 + 正文 → { skipped | score+rationale+suggestions[] }
│      ③ 前后自洽：正文全文 → issue[]
│    三段并入一份 reviewReport（shared schema），经 onProgress 透传客户端
│    通过判定：①③ 无 issue 且（② skipped 或 score ≥ 90）
├─ 未通过且 N<3 → 修订式重写，进入第 N+1 轮
└─ 通过 或 N=3 → 落文件 + 入库（既有链路）→ run_finished
```

- `MAX_REVIEW_ROUNDS = 3`（模块常量）；`STYLE_PASS_SCORE = 90`（文风合格线，用户指定）。
- 最坏成本 3 生成 + 9 校验 = 12 次调用；一次通过 1 生成 + 3 校验（文风未启用时 2 次校验）。

### 3.2 校验 subAgent：workflows/chapter-review.ts（新模块）

**形态**：三段各自独立单轮 `generateObject`（无 ReAct、无工具、无确认门）——「上下文不继承生成对话」的直接落地：三段 prompt 互不共享，也与生成轮对话无关联；结果天然过 zod schema（对齐 polish-character 单轮 generateObject 先例）。「新 subagent」落为独立模块 + 独立模型注入（`reviewModel`，缺省 deepseek `model`）。

导出面：
- `reviewChapter({ novelId, chapterName, summary, worldview, foreshadowLines, styleSamples, content, reviewModel, channel })` → `ReviewReport`：按 ①→②→③ 顺序执行，逐段完成经 `onProgress` 回调上报（回调由编排层注入，本模块只调）；channel 仅用于可选 notify（进度文案由编排层 notify，本模块保持安静——最终改为无 channel 依赖的纯编排函数 + progress 回调参数）。
  - 具体签名：`reviewChapter(input: ChapterReviewInput, deps: { reviewModel: LanguageModelV4; onProgress?: (phase: ReviewPhase, report?: ReviewReport) => void }): Promise<ReviewReport>`。
- `isReportPassing(report): boolean` 纯函数：`content.issues.length === 0 && consistency.issues.length === 0 && (style.skipped || (style.score ?? 0) >= STYLE_PASS_SCORE)`。
- `formatRevisionBlock(report): string` 纯函数：报告 → 修订 prompt 块（问题逐条「问题 N（类别）：描述 → 建议」+ 文风段「相似度 X 分（合格线 90）：评语与建议」）。

三段 prompt 要点：
- **① 内容约束**（`reviewContentSchema`）：系统位「小说设定审校编辑」；用户载荷 = 世界观 JSON + 本章名与剧情概述 + 本章伏笔上下文（**与写作者同源**——直接复用 `buildChapterForeshadowContext` 的 lines，保证「校验所见即写作者所见」）+ 待检正文。要求输出 `issues[]`：`kind`（`worldview` 违背世界观 / `foreshadow` 伏笔该体现未体现或点破不该点破的真相 / `summary` 偏离章节概述情节走向）+ `description`（问题描述，引用正文依据）+ `suggestion`（改进建议）。无问题输出空数组。
- **② 文风对比**（`reviewStyleSchema`）：`skipped` 设计——无启用文风时**不发起调用**，直接返回 `{ skipped: true }`（与生成侧「零注入」对称，省一次调用）；有文风时载荷 = 参考文风样本（名字+内容）+ 正文，要求输出 `score`（0-100 整数相似度评分）+ `rationale`（评分依据）+ `suggestions[]`（未达标时的具体改进建议，达标可为空）。
- **③ 前后自洽**（`reviewConsistencySchema`）：载荷 = 正文全文（自洽是章内属性，不需要世界观等外部上下文——避免无关上下文稀释注意力）。要求输出 `issues[]`：`description`（矛盾描述，含两处原文引用）+ `suggestion`。检查项举例进 prompt：数量/时间/称谓等基础描述前后矛盾、人物说了未出现过的内容、前后行为逻辑冲突、已交代事实被推翻。

**schema 校验失败 / 调用异常**：直接抛错 → 编排层终止会话（协议入口转 fatal error），零残留不入库；不做静默重试（对齐空正文拒绝先例）。

### 3.3 结构化报告 schema（packages/shared/src/review.ts 新文件）

```ts
reviewIssueKindSchema = z.enum(["worldview", "foreshadow", "summary", "consistency"])
reviewIssueSchema     = { kind: reviewIssueKindSchema, description: z.string().min(1), suggestion: z.string().min(1) }
styleReviewSchema     = { skipped: z.literal(true) } | { skipped: z.literal(false), score: z.number().int().min(0).max(100), rationale: z.string(), suggestions: z.array(z.string()) }
reviewReportSchema    = { round: z.number().int().min(1), passed: z.boolean(), content: { issues: reviewIssueSchema.array() }, style: styleReviewSchema, consistency: { issues: reviewIssueSchema.array() } }
```

- `passed` 由编排层按 `isReportPassing` 回填（LLM 不自评通过与否，杜绝口径漂移）。
- 报告**仅会话内透传**（协议消息携带），不入库不落盘（持久化为后续需求）。

### 3.4 协议进度消息（packages/shared/src/protocol.ts 扩展）

```ts
writeProgressPhaseSchema = z.enum(["drafting", "review-content", "review-style", "review-consistency", "revising", "saving"])
agentMessageSchema 增：
  { type: "write-progress", chapterNodeId: string, round: int, totalRounds: 3,
    phase: writeProgressPhaseSchema, report?: reviewReportSchema }
```

- 传递路径：`WriteChapterOptions` 增可选 `onProgress?: (event: WriteProgressEvent) => void` 回调（对齐 polish-result 由 headless 层 send 收口的先例——工作流不感知协议，CLI 模式不传即零开销）；headless 把回调映射为 `write-progress` 协议消息。`chapterNodeId` 随消息携带，客户端据此路由到目标章卡。报告不随校验段事件重复携带（校验模块只发三段开始事件），由编排层附着到其后的 `revising`（按此报告修订）或 `saving`（按此报告保存/已通过）事件上透传。
- 里程碑文案仍同步 `channel.notify`（CLI 与协议双通道可读）：「✍️ 第 N 轮：正文生成中…」「🔍 校验中：内容约束 / 文风 / 前后自洽…」「♻️ 校验未通过（内容 N 处、文风 X 分、自洽 M 处），按整改报告修订…」「✅ 校验通过（第 N 轮）」「⚠️ 3 轮仍未达标，保存最后一版（文风 X 分，内容 N 处、自洽 M 处问题）——建议人工复核或重新发起生成」。

### 3.5 writeChapter 循环编排（write-chapter.ts）

- Options 增：`reviewModel?: LanguageModelV4`（缺省 deepseek `model`——直接 import providers/deepseek，与 getWritingModel 同层注入惯例）、`onProgress?: (event) => void`。
- 现有「生成 → 空结果拒绝」包裹进 `for (round = 1; round <= MAX_REVIEW_ROUNDS; round++)`：
  - 第 1 轮 prompt 与现状逐字节一致（含伏笔/文风条件附加编号顺延逻辑不动）；
  - 修订轮在既有 prompt 尾部（写作要求之后）追加两块：`【上一版正文】\n<content>` 与 `【整改报告（请逐条修订）】\n<formatRevisionBlock(report)>`，并把末条「只输出正文文本」顺延为最后一条（编号顺延逻辑内聚在块组装处）；
  - 每轮生成前 `onProgress({ phase: round === 1 ? "drafting" : "revising", round, ... })`；
  - 校验三段各自 onProgress（`review-content` / `review-style` / `review-consistency`，段开始事件；报告附着在其后的 `revising` / `saving` 事件上携带——客户端在报告到达时展示摘要）；
  - `isReportPassing` → 通过：notify + `onProgress({ phase: "saving" })` → 既有落盘入库链路（文件先落、库失败回滚删文件，零改动）；未通过且 round < 3 → notify + 下一轮；
  - round = 3 仍未通过：notify 警告（含文风分与问题计数）→ 照常落盘入库。
- `write-chapter.test.ts` 既有用例适配：mock 写作模型 + 新增 mock reviewModel 脚本（三段 generateObject fixture）；「一次通过」路径下断言既有入库/prompt 断言不回归。

### 3.6 headless 接线（headless.ts）

- `runSession` write-chapter 分支传 `onProgress: (event) => send({ type: "write-progress", ...event })`；
- **Key 检查收窄**：`writingModelOnly` 豁免删除——write-chapter 始终要求 `DEEPSEEK_API_KEY`（校验模型依赖）；`isWritingModelConfigured` 恢复仅供 providers 内部回落判定使用（headless 导入移除）。注释同步（头部模式说明、Key 检查说明）。

### 3.7 客户端进度展示

- **PreviewPane**：内联会话订阅扩展——监听 `write-progress`（现有 useEffect 消息订阅内新增分支），按 `chapterNodeId` 匹配 `writingNodeId` 时更新进度状态 `{ round, phase, report }`；run_finished 清进度态并刷新详情（现状不变）；error 清进度态。进度态经 props 下传 OutlineNodeCard。
- **OutlineNodeCard 章卡**：`writing` 态下新增「生成进度」区块——六阶段步骤条（正文生成 → 内容约束校验 → 文风校验 → 前后自洽校验 → 修订（第 N/3 轮）→ 保存），当前 phase 高亮、已过阶段打勾；`report` 到达后展示摘要行（「内容 N 处问题 · 文风 X 分 · 自洽 M 处问题」）与可折叠问题列表（逐条「[类别] 描述 → 建议」）；修订轮显示轮次。非 write-chapter 会话（`writingNodeId` 为 null）零渲染，现状回归。
- 样式沿用 styles.css 语义变量，新增少量类（进度条/徽标），浅暗两主题均用既有变量不引入硬编码色值。

## 4. 数据流

1. 章卡「✍️ 生成本章正文」→ writeChapter（前置校验与上下文组装不变）；
2. 循环体：写作模型生成（初稿/修订）→ chapter-review 三段校验（deepseek，各自独立调用）→ 报告合并 → onProgress 透传 + notify → isReportPassing 判定；
3. 通过或 3 轮保底 → 落文件 + saveChapterDocument 入库绑定（既有链路）→ run_finished；
4. 客户端 PreviewPane 收 write-progress 更新章卡进度区块；run_finished 后刷新详情展示正文。

## 5. 错误处理

- 校验调用抛错（网络 / schema 不合 / JSON 解析失败）：中止会话，协议入口转 fatal error，零落盘零入库（现状「空正文拒绝」同级语义）；
- 写作模型空正文：现状拒绝逻辑保留在循环内（任一轮空正文即 fatal，不进校验）；
- 3 轮未达标：不抛错——用户明确选择「保存最后一版并警告」；
- 客户端中途关闭 / 卸载：现状 agent:stop 兜底不变（进度态随组件卸载消失）。

## 6. 测试计划（bun:test）

**shared**（protocol / review schema 单测）：reviewReport 三段合法样例 parse 通过；缺字段 / score 越界 / 非法 kind 拒绝；write-progress 消息 schema（含可选 report 有无两态）；既有消息回归（旧样例仍 parse 通过）。

**chapter-review**（mock ai generateObject 脚本）：三段顺序调用与载荷断言（世界观/概述/伏笔行进 ①、文风样本进 ②、正文全文进 ③）；无启用文风 skipped 零调用；isReportPassing 四态（①③ 有 issue 不通过 / 文风 <90 不通过 / skipped 视为通过 / 全绿通过）；formatRevisionBlock 格式断言；模型注入生效（收到的 model 实例即注入值）。

**write-chapter 集成**（mock 双模型 + FakeChannel + 临时库）：
- 一次通过：生成 1 次 + 校验 3 次（无文风 2 次）→ 落盘入库，notify 与 onProgress 事件序列断言；
- 第 2 轮修订后通过：首轮报告带 issue → 修订轮 prompt 断言含【上一版正文】与【整改报告】块 → 第二稿通过 → 入库；round=2 记录；
- 3 轮保底：三轮均不通过 → 仍落盘入库 + 警告 notify（含文风分与问题计数）；
- 无启用文风：文风段 skipped（校验调用计数 -1）；
- 校验抛错：fatal 中止、零残留（无文件无 documents 行）；
- 既有回归：一次通过路径下 prompt 逐字节断言不变、伏笔/文风注入既有用例全保留。

**headless**：write-chapter 会话 write-progress 消息经 protocol schema 复验（既有 protocol-e2e mock 写作端点脚本适配三段校验 fixture）。

**客户端**：OutlineNodeCard 进度区块 SSR 冒烟（writing + progress 各阶段渲染、报告摘要渲染、非生成态零渲染）。

## 7. 不做范围（Out of Scope）

- 整改报告与校验结果**持久化**（入库 / 落盘文件）——本次仅会话内透传，历史可追溯为后续需求；
- 已有正文章节的重新生成 / 重写流（既有「一章一份」约束不动，本次循环只发生在单次生成会话内部）；
- 校验自动修改库内数据（世界观 / 伏笔 / 文风均只读）；
- 文风校验反向调整 style_references 或自动停用低分包；
- CLI 终端 write-chapter 入口（现状即无，notify 文案仅供未来复用）;
- 跨章一致性（与前文正文的矛盾检查）——本次仅章内自洽；跨章上下文已随生成 prompt 注入（同幕前后章概述），其校验依赖登场章正文注入机制的扩展，另行规划。

# 章节规划新增角色梳理与自动入库 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 单幕章节规划的 `save_chapters` 结构化入参附顶层「新增角色清单」（进确认门连带确认），章节概述尽量点名出场角色，确认入库后复用 `autoCreateCharacters` 自动建卡入库。

**架构：** 镜像已落地的大纲 newCharacters 链路——章节 Agent 增 `list_characters` 工具与已有角色上下文；`autoCreateCharacters` 增可选 `extraContext` 携带章节规划文本；`planActChapters` 增世界观前置校验与确认后兜底 diff + 自动入库（伪 Outline 由部/幕节点组装）。规格见 `docs/superpowers/specs/2026-10-06-chapter-plan-new-characters-design.md`。

**技术栈：** Bun 1.4 + TypeScript 6（strict）、Vercel AI SDK 7、zod 4、`bun:sqlite`、`bun:test`。

**执行约定（项目规范，优先于通用惯例）：**
- SDD 流水线：worktree 分支逐任务提交（每任务一个实现子代理 + 独立任务审查），全部完成后整分支最终审查，收尾时 squash 合并回 master 为唯一原子提交。
- 开始任务 1 前把任务清单落盘 `apps/agent/src/workflows/PROGRESS.md`「进行中」区域；每完成一个任务立即勾选。
- 每个任务闭环 = 该任务聚焦测试绿；最后一个任务跑全量 `bun run typecheck` / `bun run lint` / `bun run test`。
- 真实 LLM 端到端由用户复验，不在任务内。

---

## 文件结构（创建 / 修改清单）

| 文件 | 动作 | 职责 |
| --- | --- | --- |
| `packages/shared/src/views.ts` | 修改 | `chapterPlanViewSchema` 增可选 `newCharacters`（`chapterPlanSchema` 本体不动） |
| `packages/shared/src/index.test.ts` | 修改 | 视图可选字段两态单测 |
| `apps/agent/src/workflows/agents/chapter-agent.ts` | 修改 | `saveChaptersInputSchema` 工厂 + `list_characters` 工具 + `ChapterPlanSubmission` 返回 + prompt 角色梳理 |
| `apps/agent/src/workflows/agents/chapter-agent.test.ts` | 创建 | 入参 schema 单测（新测试文件，镜像 outline-agent.test.ts） |
| `apps/agent/src/workflows/agents/auto-character-agent.ts` | 修改 | `AutoCreateCharactersOptions` 增可选 `extraContext`，prompt 条件追加 |
| `apps/agent/src/workflows/agents/auto-character-agent.test.ts` | 修改 | extraContext 进 prompt 断言 |
| `apps/agent/src/workflows/plan-act-chapters.ts` | 修改 | 世界观前置校验 + 注入两 store + 确认后兜底 diff 与自动入库 |
| `apps/agent/src/workflows/plan-act-chapters.test.ts` | 修改 | seed 补世界观/角色 store、7 处调用点补注入、自动入库断言、世界观缺失新用例、空清单跳过用例 |
| `apps/agent/src/ui/cli-channel.ts` | 修改 | `formatChapterPlan` 渲染清单 |
| `apps/agent/src/ui/cli-channel.test.ts` | 修改 | 渲染断言 |
| `apps/client/src/components/ViewCard.tsx` | 修改 | chapter-plan 分支渲染清单 |
| 任务 6 另涉及 | 修改 | `AGENTS.md`、根 `ARCHITECTURE.md` / `PROGRESS.md` / `DECISIONS.md`、`apps/agent/src/workflows/ARCHITECTURE.md` / `PROGRESS.md` |

命名约定（全计划统一）：
- `saveChaptersInputSchema`：save_chapters 新入参 schema（chapter-agent.ts 导出）
- `ChapterPlanSubmission = { plan: ChapterPlan; newCharacters: NewCharacterOutline[] }`（chapter-agent.ts 定义导出）
- `PlanChaptersAgentOptions = { novelId: string; characterStore?: CharacterStore }`（planChapters 第三参）
- `extraContext?: string`（AutoCreateCharactersOptions 增量可选字段）

---

### 任务 1：shared views——chapterPlan 视图可选 newCharacters

**文件：**
- 修改：`packages/shared/src/views.ts`（`chapterPlanViewSchema`，import 行）
- 测试：`packages/shared/src/index.test.ts`

- [ ] **步骤 1：编写失败的测试**

`packages/shared/src/index.test.ts` 顶部 import 加入 `chapterPlanViewSchema`（自 `./index`），文件末尾追加：

```typescript
describe("chapterPlanViewSchema 的 newCharacters 可选字段", () => {
  const baseView = {
    kind: "chapter-plan",
    actName: "第2幕",
    actSummary: "本幕梗概",
    keyPlotPoints: ["情节点A"],
    plan: { chapters: [{ name: "第一章·雨夜", summary: "雨夜夺脉" }] },
  };

  test("携带 newCharacters 的确认视图通过校验", () => {
    const view = chapterPlanViewSchema.parse({
      ...baseView,
      newCharacters: [{ name: "萧无咎", role: "第1章登场·血宗宗主" }],
    });
    expect(view.newCharacters).toHaveLength(1);
  });

  test("不携带 newCharacters 的视图仍通过（旧消息兼容）", () => {
    const view = chapterPlanViewSchema.parse(baseView);
    expect(view.newCharacters).toBeUndefined();
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`bun test packages/shared`
预期：FAIL——`newCharacters` 为未知字段（视图解析被拒）或字段不存在。

- [ ] **步骤 3：编写实现**

`views.ts` import 行改为 `import { newCharacterSchema, outlineSchema } from "./outline";`，`chapterPlanViewSchema` 改为：

```typescript
/** 章节规划确认门：自包含（幕信息 + 规划全文），UI 渲染不依赖外部上下文 */
export const chapterPlanViewSchema = z.object({
  kind: z.literal("chapter-plan"),
  actName: z.string().describe("幕名（规划的拆解对象）"),
  actSummary: z.string().describe("幕梗概"),
  keyPlotPoints: z.array(z.string()).describe("幕关键情节点"),
  plan: chapterPlanSchema.describe("推荐的本幕章节规划"),
  /** 确认门携带的「新增角色清单」（名字+一句话定位）；旧消息不带 */
  newCharacters: z.array(newCharacterSchema).optional(),
});
```

- [ ] **步骤 4：运行测试验证通过**

运行：`bun test packages/shared`
预期：PASS（新增 2 条全绿，既有零回归）。

- [ ] **步骤 5：更新 PROGRESS 任务清单**（勾选任务 1，不 commit）

---

### 任务 2：章节 Agent——list_characters + save_chapters 结构化扩展

本任务含 `plan-act-chapters.ts` 的**签名机械适配**（传 `{ novelId }`、解构 `plan`、fixture 补空清单），保证任务边界全量测试绿；行为接线在任务 4。

**文件：**
- 修改：`apps/agent/src/workflows/agents/chapter-agent.ts`
- 修改：`apps/agent/src/workflows/plan-act-chapters.ts:71-85`
- 修改：`apps/agent/src/workflows/plan-act-chapters.test.ts`（`chapterPlanFixture`）
- 测试（创建）：`apps/agent/src/workflows/agents/chapter-agent.test.ts`

- [ ] **步骤 1：编写失败的测试（新文件）**

新建 `apps/agent/src/workflows/agents/chapter-agent.test.ts`：

```typescript
import { describe, expect, test } from "bun:test";
import { saveChaptersInputSchema } from "./chapter-agent";
import { chapterPlanSchema, type ChapterPlan } from "@novel/shared";

const threeChapterPlan: ChapterPlan = chapterPlanSchema.parse({
  chapters: [
    { name: "第一章·雨夜", summary: "雨夜夺脉的剧情概述" },
    { name: "第二章·来客", summary: "神秘来客的剧情概述" },
    { name: "第三章·破晓", summary: "黎明反击的剧情概述" },
  ],
});

describe("saveChaptersInputSchema", () => {
  const submission = { ...threeChapterPlan, newCharacters: [{ name: "萧无咎", role: "第2章登场·血宗宗主" }] };

  test("规划 + 新增角色清单均合规时通过；空清单合法", () => {
    expect(saveChaptersInputSchema.parse(submission).newCharacters).toHaveLength(1);
    expect(saveChaptersInputSchema.parse({ ...threeChapterPlan, newCharacters: [] }).newCharacters).toEqual([]);
  });

  test("newCharacters 缺失或项内字段空串被拒绝", () => {
    expect(() => saveChaptersInputSchema.parse(threeChapterPlan)).toThrow();
    expect(() => saveChaptersInputSchema.parse({ ...threeChapterPlan, newCharacters: [{ name: "萧无咎" }] })).toThrow();
    expect(() => saveChaptersInputSchema.parse({ ...threeChapterPlan, newCharacters: [{ name: "", role: "反派" }] })).toThrow();
  });

  test("清单内名字重复被拒绝", () => {
    expect(() =>
      saveChaptersInputSchema.parse({
        ...threeChapterPlan,
        newCharacters: [
          { name: "萧无咎", role: "第2章登场·血宗宗主" },
          { name: "萧无咎", role: "同一人重复列出" },
        ],
      }),
    ).toThrow("不得重复");
  });

  test("章节规划自身约束不回归（0 章与 13 章均拒绝）", () => {
    expect(() => saveChaptersInputSchema.parse({ chapters: [], newCharacters: [] })).toThrow();
    expect(() =>
      saveChaptersInputSchema.parse({
        chapters: Array.from({ length: 13 }, (_, i) => ({ name: `第${i + 1}章`, summary: `第${i + 1}章概述` })),
        newCharacters: [],
      }),
    ).toThrow();
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`bun test apps/agent/src/workflows/agents/chapter-agent.test.ts`
预期：FAIL——`saveChaptersInputSchema` 未导出。

- [ ] **步骤 3：编写实现**

`chapter-agent.ts` 改造：

imports 增加：

```typescript
import { z } from "zod";
import { getDefaultCharacterStore, type CharacterStore } from "../../state/character-store";
import { chapterPlanSchema, newCharacterSchema, type ChapterPlan, type NewCharacterOutline } from "@novel/shared";
```

`PlanChaptersInput` 之后新增：

```typescript
/** 章节 Agent 的注入项：角色库查询按 novelId 进行，store 可替换（测试） */
export interface PlanChaptersAgentOptions {
  /** 目标小说创作 ID（list_characters 工具按此查询角色库） */
  novelId: string;
  /** 角色库 store；缺省默认 SQLite store（测试可替换） */
  characterStore?: CharacterStore;
}

/** save_chapters 的结构化入参：章节规划 + 新增角色清单（项内名字不得重复） */
export const saveChaptersInputSchema = chapterPlanSchema.extend({
  newCharacters: z
    .array(newCharacterSchema)
    .refine((list) => new Set(list.map((c) => c.name)).size === list.length, "新增角色清单内名字不得重复"),
});

/** 章节 Agent 的最终产物：确认通过的规划本体 + 随规划连带确认的新增角色清单 */
export interface ChapterPlanSubmission {
  plan: ChapterPlan;
  newCharacters: NewCharacterOutline[];
}
```

`planChapters` 主体（替换既有签名 / saveChapters 工具 / prompt / 返回）：

```typescript
export async function planChapters(
  input: PlanChaptersInput,
  channel: UiChannel,
  options: PlanChaptersAgentOptions,
): Promise<ChapterPlanSubmission> {
  const { novelId } = options;
  const characterStore = options.characterStore ?? getDefaultCharacterStore();
  let saved: ChapterPlanSubmission | undefined;

  /** 角色库查询工具：返回库内全部角色名与叙事定位，供模型点名概述与梳理「新增角色」 */
  const listCharacters = tool({
    description:
      "查询角色库中已有的全部角色（名字与叙事定位）。梳理 newCharacters 时必须先调用此工具：清单中只能列角色库中没有的角色，库内已有角色不得列入。",
    inputSchema: z.object({}),
    execute: async () => {
      const rows = characterStore.listCharacters(novelId);
      return {
        characters: rows.map((r) => ({ name: r.character.basicInfo.name, narrativeRole: r.character.core.narrativeRole })),
      };
    },
  });

  const saveChapters = tool({
    description:
      "章节规划完成后调用此工具保存（参数 = 完整规划 + newCharacters 新增角色清单）。会把本幕梗概、关键情节点、推荐的章节列表与新增角色清单展示给用户做最终确认：用户确认后保存完成；用户提出修改意见时，需根据反馈调整规划后重新调用。",
    inputSchema: saveChaptersInputSchema,
    execute: async (inputPlan) => {
      const { newCharacters, ...plan } = inputPlan;
      const confirmed = await channel.askConfirm("以上章节规划是否确认？", {
        default: true,
        view: {
          kind: "chapter-plan",
          actName: input.actName,
          actSummary: input.actSummary,
          keyPlotPoints: [...input.keyPlotPoints],
          plan,
          newCharacters,
        },
      });
      if (confirmed) {
        saved = { plan, newCharacters };
        return { ok: true as const };
      }
      const feedback = await channel.askText("请说明章节规划需要调整的地方> ");
      return {
        ok: false as const,
        feedback,
        note: "用户要求调整，请根据反馈修改章节规划后重新调用 save_chapters",
      };
    },
  });

  const libraryRows = characterStore.listCharacters(novelId);

  const result = await runReactAgent({
    system: SYSTEM_PROMPT,
    prompt: [
      `小说：《${input.novelTitle}》——${input.logline}`,
      ...(input.theme ? [`主题：${input.theme}`] : []),
      `所属部：${input.partName}（${input.partSummary}）`,
      `目标幕：${input.actName}`,
      `本幕梗概：${input.actSummary}`,
      `本幕关键情节点：\n${input.keyPlotPoints.map((p, i) => `${i + 1}. ${p}`).join("\n")}`,
      libraryRows.length > 0
        ? `角色库已有角色：${libraryRows.map((r) => `${r.character.basicInfo.name}（${r.character.core.narrativeRole}）`).join("、")}`
        : "角色库暂无角色",
      "请基于以上内容推荐本幕的章节规划并调用 save_chapters 保存。",
    ].join("\n\n"),
    tools: { save_chapters: saveChapters, list_characters: listCharacters },
    // 不设 stopTool：save_chapters 可能被用户否决（需继续修订）
    maxSteps: 12,
    isDone: () => saved !== undefined,
    continuationHint:
      "请立即调用 save_chapters 工具保存章节规划（参数为完整规划与 newCharacters 新增角色清单），不要只输出文本。",
  });

  if (!saved) {
    throw new Error(
      `章节 Agent 未能在 ${result.stepCount} 步内完成规划。最后输出：\n${result.text}`,
    );
  }
  return saved;
}
```

`SYSTEM_PROMPT` 在「完成后调用 save_chapters…」段之前插入：

```text
角色梳理要求：
1. 章节概述尽量点名本章出场角色——角色库已有角色使用其真实名字，新角色使用其清单中的名字，让后续写作能直接按概述确定出场阵容；
2. 登场角色不在角色库中时，必须将其列入 save_chapters 的 newCharacters：name 为角色名，role 为一句话定位并注明登场章（如「第3章登场·血宗打手」）；清单内名字不得重复，角色库已有角色不得列入；
3. 可用 list_characters 工具查询角色库现状。newCharacters 会在确认时随规划一并展示给用户：确认后这些角色将自动填充角色卡并入库。
```

调用方机械适配：
- `plan-act-chapters.ts:71-83`：`const { plan } = await planChapters({...既有 input 不变...}, channel, { novelId });`（后续 `plan.chapters` 引用不变）
- `plan-act-chapters.test.ts` 的 `chapterPlanFixture` 增加 `newCharacters: []`

- [ ] **步骤 4：运行测试验证通过**

运行：`bun test apps/agent/src/workflows/agents/chapter-agent.test.ts && bun test apps/agent/src/workflows`
预期：PASS——schema 单测 4 条全绿；plan-act-chapters 集成既有断言零回归。

- [ ] **步骤 5：更新 PROGRESS 任务清单**（勾选任务 2，不 commit）

---

### 任务 3：auto-character-agent 增可选 extraContext

**文件：**
- 修改：`apps/agent/src/workflows/agents/auto-character-agent.ts`
- 测试：`apps/agent/src/workflows/agents/auto-character-agent.test.ts`

- [ ] **步骤 1：编写失败的测试**

`auto-character-agent.test.ts`：mock 的 `generateText` 入参签名增 `prompt` 并记录到模块级变量（既有 mock 均不传 prompt，记录无副作用）：

```typescript
let lastPrompt = "";
// mock.module 的 generateText 改为：
generateText: async ({ tools, prompt }: { tools: Record<string, MockTool>; prompt: string }) => {
  lastPrompt = prompt;
  /* ……其余消费逻辑不变…… */
},
```

文件末尾追加用例（复用既有 `worldview` / `outline` / `newCard` / `existing` fixture）：

```typescript
describe("autoCreateCharacters extraContext", () => {
  test("传入 extraContext 时作为附加上下文块进入 prompt；不传时不出现", async () => {
    const tempDir2 = await mkdtemp(join(tmpdir(), "novel-auto-extra-"));
    const db = openDatabase(join(tempDir2, "test.db"));
    const characterStore = new CharacterStore(db);
    new (await import("../../state/novel-store")).NovelStore(db).createNovel({ id: "novel-extra" });
    const channel = new FakeChannel([]);

    const baseOptions = {
      novelId: "novel-extra",
      worldview: worldview as never,
      outline: outline as never,
      newCharacters: [{ name: "萧无咎", role: "第2章登场·血宗宗主" }],
      existingCharacters: [] as never[],
      channel,
      characterStore,
    };
    const extraText = "本次规划的章节列表：\n第1章 雨夜：雨夜夺脉，萧无咎现身";
    textScript = [[{ tool: "save_character", args: newCard("萧无咎") }]];

    await autoCreateCharacters({ ...baseOptions, extraContext: extraText });
    expect(lastPrompt).toContain(extraText);

    textScript = [[{ tool: "save_character", args: newCard("叶青璃") }]];
    await autoCreateCharacters({
      ...baseOptions,
      newCharacters: [{ name: "叶青璃", role: "第1章登场·灵医传人" }],
      extraContext: undefined,
    });
    expect(lastPrompt).not.toContain("本次规划的章节列表");
    db.close();
    await rm(tempDir2, { recursive: true, force: true });
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`bun test apps/agent/src/workflows/agents/auto-character-agent.test.ts`
预期：FAIL——`extraContext` 传入报未知属性类型错误 / `lastPrompt` 不含 extraText。

- [ ] **步骤 3：编写实现**

`auto-character-agent.ts`：

`AutoCreateCharactersOptions` 增字段（置于 `outline` 之后）：

```typescript
  /** 附加上下文（如章节规划的「章名+概述」全文），存在时追加进 prompt 供填卡参考 */
  extraContext?: string;
```

`autoCreateCharacters` 解构增 `extraContext`；prompt 数组在「大纲（JSON）」行之后条件插入：

```typescript
      `大纲（JSON）：\n${JSON.stringify(outline, null, 2)}`,
      ...(extraContext ? [extraContext] : []),
```

- [ ] **步骤 4：运行测试验证通过**

运行：`bun test apps/agent/src/workflows/agents/auto-character-agent.test.ts`
预期：PASS——新用例与既有 5 条全绿。

- [ ] **步骤 5：更新 PROGRESS 任务清单**（勾选任务 3，不 commit）

---

### 任务 4：plan-act-chapters 接入自动入库

**文件：**
- 修改：`apps/agent/src/workflows/plan-act-chapters.ts`
- 测试：`apps/agent/src/workflows/plan-act-chapters.test.ts`

- [ ] **步骤 1：编写失败的测试**

`plan-act-chapters.test.ts` 改造：

(a) 静态导入区增 `WorldviewStore` / `CharacterStore`；fixture 增：

```typescript
const worldviewFixture = {
  background: { geography: "九州大陆" },
  taboos: ["不可出现现代科技"],
};

const autoCard = {
  basicInfo: { name: "萧无咎", gender: "男" },
  core: { desire: "掌控九州灵脉", fear: "宗门基业毁于己手", narrativeRole: "反派" },
  background: "血宗宗主，靠垄断灵脉崛起",
  creationPurpose: "作为主要反派逼出主角的成长",
  endingDirection: "被主角击败，宗门垄断瓦解",
};
```

(b) `Seeded` 接口增 `worldviewStore: WorldviewStore; characterStore: CharacterStore;`；`seed()` 增可选参 `withWorldview = true`，建库后：

```typescript
  const worldviewStore = new WorldviewStore(db);
  const characterStore = new CharacterStore(db);
  if (withWorldview) {
    worldviewStore.saveWorldview(NOVEL_ID, worldviewFixture);
  }
```

返回对象补两 store。**全部既有 `planActChapters({...})` 调用点（7 处）补注入 `worldviewStore: world.worldviewStore, characterStore: world.characterStore`**（默认 store 会打到真实 `data/novel.db`，必须显式注入）。

(c) 主流程用例（「指定幕规划成功」）改造：

```typescript
    textScript = [
      [[{ tool: "save_chapters", args: { ...chapterPlanFixture, newCharacters: [{ name: "萧无咎", role: "第2章登场·血宗宗主" }] } }]],
      [[{ tool: "save_character", args: autoCard }]],
    ];
```

断言追加：

```typescript
    expect(channel.notifies.some((n) => n.includes("本幕规划引入了 1 个新角色"))).toBe(true);
    expect(channel.notifies.some((n) => n.includes("新角色已自动入库：萧无咎"))).toBe(true);
    expect(channel.notifies.some((n) => n.includes("本次章节规划新增 1 个角色已自动入库"))).toBe(true);
    expect(
      world.characterStore.listCharacters(NOVEL_ID).map((c) => c.character.basicInfo.name),
    ).toEqual(["萧无咎"]);
```

(d) 新增两个用例：

```typescript
  test("世界观未确认：前置拒绝，不启动 Agent", async () => {
    const world = await seed(false);
    textScript = [];
    const channel = new FakeChannel([]);
    await expect(
      planActChapters({
        channel, novelId: NOVEL_ID, actNodeId: world.actNodes[0]!.id,
        novelStore: world.novelStore, outlineStore: world.outlineStore,
        worldviewStore: world.worldviewStore, characterStore: world.characterStore,
      }),
    ).rejects.toThrow("世界观未确认");
    expect(channel.notifies).toHaveLength(0);
  });

  test("规划未引入新角色：空清单跳过自动创建（零 LLM 调用）", async () => {
    const world = await seed();
    textScript = [[[{ tool: "save_chapters", args: chapterPlanFixture }]]]; // fixture 的 newCharacters 为 []
    const channel = new FakeChannel([true]);
    await planActChapters({
      channel, novelId: NOVEL_ID, actNodeId: world.actNodes[0]!.id,
      novelStore: world.novelStore, outlineStore: world.outlineStore,
      worldviewStore: world.worldviewStore, characterStore: world.characterStore,
    });
    expect(textScript).toHaveLength(0);
    expect(channel.notifies.some((n) => n.includes("自动入库"))).toBe(false);
    expect(world.characterStore.listCharacters(NOVEL_ID)).toHaveLength(0);
  });
```

- [ ] **步骤 2：运行测试验证失败**

运行：`bun test apps/agent/src/workflows/plan-act-chapters.test.ts`
预期：FAIL——无自动入库 notify 与角色行（新用例 (d) 第一条因实现尚无校验而实际驱动了 Agent，亦会失败；空清单用例可能因世界观校验缺失而行为不同）。

- [ ] **步骤 3：编写实现**

`plan-act-chapters.ts`：

imports 增加：

```typescript
import { getDefaultWorldviewStore, type WorldviewStore } from "../state/worldview-store";
import { getDefaultCharacterStore, type CharacterStore } from "../state/character-store";
import type { Outline } from "@novel/shared";
import { autoCreateCharacters, filterNewCharacters } from "./agents/auto-character-agent";
```

`PlanActChaptersOptions` 增两个可选注入（缺省默认 store）；函数体开头补：

```typescript
  const worldviewStore = options.worldviewStore ?? getDefaultWorldviewStore();
  const characterStore = options.characterStore ?? getDefaultCharacterStore();
```

「已有章节规划」校验之后、`channel.stage("chapter")` 之前插入：

```typescript
  // 自动创建新角色需要世界观依据；前置拒绝避免「确认入库后才发现无法自动创建」的中间态
  const storedWorldview = worldviewStore.getWorldview(novelId);
  if (!storedWorldview) {
    throw new Error("该小说世界观未确认（库中无记录），无法规划章节");
  }
```

`planChapters` 调用改为 `const { plan, newCharacters } = await planChapters({...}, channel, { novelId, characterStore });`；「章节已入库」notify 之后、`return` 之前插入：

```typescript
  // 章节规划新增角色自动入库：代码级兜底 diff（剔除库内已有名 + 去重），空清单跳过（零 LLM 调用）
  const existingCharacters = characterStore.listCharacters(novelId).map((c) => c.character);
  const pendingNew = filterNewCharacters(newCharacters, existingCharacters);
  if (pendingNew.length > 0) {
    channel.notify(`\n✨ 本幕规划引入了 ${pendingNew.length} 个新角色，正在自动填充角色卡并入库…`);
    // 部/幕节点组装伪 Outline（结构匹配 Outline，供自动创建 Agent 作登场情节上下文）
    const outlineContext: Outline = {
      title: novel.name ?? "未命名小说",
      logline: novel.description ?? "",
      parts: [
        {
          name: part.node.name,
          summary: part.node.summary ?? "",
          acts: [
            {
              name: act.node.name,
              summary: act.node.summary,
              keyPlotPoints: act.node.keyPlotPoints,
            },
          ],
        },
      ],
    };
    await autoCreateCharacters({
      novelId,
      worldview: storedWorldview.worldview,
      outline: outlineContext,
      newCharacters: pendingNew,
      existingCharacters,
      channel,
      characterStore,
      extraContext: `本次规划的章节列表：\n${plan.chapters
        .map((c, i) => `第${i + 1}章 ${c.name}：${c.summary}`)
        .join("\n")}`,
    });
    channel.notify(
      `✨ 本次章节规划新增 ${pendingNew.length} 个角色已自动入库：${pendingNew.map((c) => c.name).join("、")}`,
    );
  }
```

（docstring 补一句自动入库行为说明；`PlanActChaptersResult` 返回值不变。）

- [ ] **步骤 4：运行测试验证通过**

运行：`bun test apps/agent/src/workflows/plan-act-chapters.test.ts`
预期：PASS——自动入库 / 世界观拒绝 / 空清单跳过断言全绿，既有校验用例零回归。

- [ ] **步骤 5：更新 PROGRESS 任务清单**（勾选任务 4，不 commit）

---

### 任务 5：双端渲染联动

**文件：**
- 修改：`apps/agent/src/ui/cli-channel.ts`（`renderView` chapter-plan 分支 + `formatChapterPlan`）
- 测试：`apps/agent/src/ui/cli-channel.test.ts`
- 修改：`apps/client/src/components/ViewCard.tsx`（chapter-plan 分支）

- [ ] **步骤 1：编写失败的测试**

`cli-channel.test.ts` 追加：

```typescript
test("chapter-plan：携带 newCharacters 时渲染新增角色清单，缺失不渲染", () => {
  const view = {
    kind: "chapter-plan",
    actName: "第2幕",
    actSummary: "本幕梗概",
    keyPlotPoints: ["情节点A"],
    plan: { chapters: [{ name: "第一章·雨夜", summary: "雨夜夺脉" }] },
    newCharacters: [{ name: "萧无咎", role: "第1章登场·血宗宗主" }],
  } as const;
  const withNew = renderView(view as never);
  expect(withNew).toContain("本次规划新增角色");
  expect(withNew).toContain("萧无咎——第1章登场·血宗宗主");
  const withoutNew = renderView({ ...view, newCharacters: undefined } as never);
  expect(withoutNew).not.toContain("新增角色");
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`bun test apps/agent/src/ui/cli-channel.test.ts`
预期：FAIL——渲染文本不含「本次规划新增角色」。

- [ ] **步骤 3：编写实现**

`cli-channel.ts`：`renderView` 的 `case "chapter-plan"` 改为 `formatChapterPlan(view, view.newCharacters)`（函数签名增第二可选参 `NewCharacterOutline[]`，import 补类型）；`formatChapterPlan` 在章节列表行之后追加：

```typescript
  if (newCharacters && newCharacters.length > 0) {
    lines.push(`  ✨ 本次规划新增角色（确认后自动入库）：`);
    for (const c of newCharacters) {
      lines.push(`    · ${c.name}——${c.role}`);
    }
  }
```

`ViewCard.tsx` chapter-plan 分支在章列表 map 之后、`</section>` 之前追加：

```tsx
{view.newCharacters && view.newCharacters.length > 0 ? (
  <>
    <p className="part-name">✨ 本次规划新增角色（确认后自动入库）</p>
    {view.newCharacters.map((c) => (
      <p key={c.name} className="act">
        · {c.name}——{c.role}
      </p>
    ))}
  </>
) : null}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`bun test apps/agent/src/ui/cli-channel.test.ts && bun run typecheck`
预期：PASS；client typecheck 过。

- [ ] **步骤 5：更新 PROGRESS 任务清单**（勾选任务 5，不 commit）

---

### 任务 6：全量校验 + 文档同步 + 提交

**文件：**
- 修改：`AGENTS.md`、根 `ARCHITECTURE.md` / `DECISIONS.md`、根与模块 `PROGRESS.md`、`apps/agent/src/workflows/ARCHITECTURE.md`

- [ ] **步骤 1：全量工程校验**

运行：`bun run typecheck && bun run lint && bun run test`
预期：100% 通过（基线 233 + 净增用例）。

- [ ] **步骤 2：文档同步**

- `AGENTS.md`：单幕章节规划流程描述补「newCharacters 顶层清单 + 确认门连带确认 + 确认后自动入库（含世界观前置校验）」；workflows / client 条目相应补语。
- 根 `ARCHITECTURE.md`：「单幕章节规划工作流」补前置校验世界观、save_chapters 结构化与自动入库链路；文件树 `chapter-agent` 条目补语。
- 根 `DECISIONS.md`：追加 2026-10-06 决策——顶层清单 vs 按章归属的取舍；世界观前置校验（对齐 regen-outline / write-chapter，避免确认入库后才发现无法自动创建）；extraContext 可选参数（章节概述是填卡一手素材，纯增量不破坏既有调用方）。
- 根与模块 `PROGRESS.md`：「进行中」清单删除归一为完成总结（最近 5 条滚动归档）；AC 含全量校验结果与真实 LLM 待复验步骤（客户端幕卡「规划本幕章节」走确认门，观察清单展示、概述点名角色、确认后自动入库）。
- `apps/agent/src/workflows/ARCHITECTURE.md`：chapter-agent / plan-act-chapters 条目、单幕规划数据流、入库时机小结、依赖边界（plan-act-chapters 增 worldview-store / character-store / auto-character-agent 依赖）。

- [ ] **步骤 3：提交**

```bash
git add -A
git commit -m "docs: 章节规划新增角色需求同步入口/架构/进度/决策文档"
```

（提交前 `git status` 复核不得混入 `files/`、`.env`、临时产物。）

---

## 自检记录（编写时已执行）

1. **规格覆盖度**：§3.1→任务 1；§3.2→任务 2；§3.3→任务 3；§3.4→任务 4；§3.5→任务 5；§4 边界（重名清单 schema 拒 / diff 兜底 / 世界观缺失拒绝 / 空清单跳过）落在任务 2/4 测试；§5 测试计划与各任务一一对应；§6 文档→任务 6。无遗漏。
2. **占位符扫描**：无待定/TODO/「类似任务 N」；每个代码步骤有完整代码块。
3. **类型一致性**：`saveChaptersInputSchema` / `ChapterPlanSubmission` / `PlanChaptersAgentOptions` / `extraContext` 命名全计划一致；`newCharacterSchema` / `filterNewCharacters` / `autoCreateCharacters`（含 `pendingNames.size` 基准）均与上一需求落地后的最终代码形态对齐；plan-act-chapters.test.ts 的 7 处调用点补注入已在任务 4 显式列出（默认 store 指向真实库的坑）。

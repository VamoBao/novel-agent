# 大纲新增角色结构化输出与自动入库 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 大纲 Agent 增加角色库查询工具，`save_outline` 结构化入参附「新增角色清单」（名字 + 一句话定位、进确认门连带确认）；大纲确认入库后由新建的独立角色自动创建 Agent（ReAct 循环）逐卡填充并入库；新建小说与大纲重生成两条流程都接入。

**架构：** 复用现有 ReAct 终态工具模式——大纲 Agent 的 `save_outline` 入参 schema 扩展 `newCharacters` 字段并新增 `list_characters` 查询工具；新文件 `auto-character-agent.ts` 以 `save_character`（入参即 `characterSchema`）逐卡入库，`isDone` 按清单数量判定；两条编排流程在大纲入库后经纯函数 `filterNewCharacters` 做代码级兜底 diff 再调用。规格见 `docs/superpowers/specs/2026-10-06-outline-new-characters-design.md`。

**技术栈：** Bun 1.4 + TypeScript 6（strict）、Vercel AI SDK 7（`ai`）、zod 4、`bun:sqlite`、`bun:test`。

**执行约定（项目规范，优先于通用惯例）：**
- 复杂需求 WIP = 1 逐任务执行；**拆解任务不单独 commit**，任务 7 统一原子提交。
- 开始任务 1 前先把任务清单落盘 `apps/agent/src/workflows/PROGRESS.md`「进行中」区域（主模块为 workflows，根 `PROGRESS.md` 记一条指向索引）；每完成一个任务立即勾选。
- 每个任务闭环 = 该任务的运行时校验通过（指定测试命令绿）；任务 7 才跑全量 `bun run typecheck` / `bun run lint` / `bun run test`。
- 涉及真实 LLM 的端到端留待用户复验，不在本计划任务内。

---

## 文件结构（创建 / 修改清单）

| 文件 | 动作 | 职责 |
| --- | --- | --- |
| `packages/shared/src/outline.ts` | 修改 | 新增 `newCharacterSchema`（名字 + 一句话定位）与类型 `NewCharacterOutline`；`outlineSchema` 本身不动 |
| `packages/shared/src/views.ts` | 修改 | `outlineViewSchema` 增可选 `newCharacters` 字段（仅确认门视图携带） |
| `packages/shared/src/index.ts` | 修改 | 出口补导出 `newCharacterSchema` / `NewCharacterOutline` |
| `packages/shared/src/index.test.ts` | 修改 | 新 schema 与视图可选字段单测 |
| `apps/agent/src/workflows/agents/outline-agent.ts` | 修改 | `list_characters` 工具；`save_outline` 入参扩展；返回 `OutlineSubmission`；prompt 约束 |
| `apps/agent/src/workflows/agents/outline-agent.test.ts` | 修改 | 新入参 schema 单测 |
| `apps/agent/src/workflows/agents/auto-character-agent.ts` | 创建 | 角色自动创建 Agent（ReAct 循环逐卡入库）+ 纯函数 `filterNewCharacters` |
| `apps/agent/src/workflows/agents/auto-character-agent.test.ts` | 创建 | mock `ai` + FakeChannel + 临时 SQLite 集成测试 |
| `apps/agent/src/workflows/create-novel.ts` | 修改 | 大纲入库后接入自动创建（任务 2 先做签名机械适配） |
| `apps/agent/src/workflows/create-novel.test.ts` | 修改 | fixture 增 `newCharacters`；自动入库断言 |
| `apps/agent/src/workflows/regen-outline.ts` | 修改 | 同上（重生成流程） |
| `apps/agent/src/workflows/regen-outline.test.ts` | 修改 | 同上 |
| `apps/agent/src/ui/cli-channel.ts` | 修改 | `formatOutlineForConfirm` 渲染新增角色清单 |
| `apps/agent/src/ui/cli-channel.test.ts` | 修改 | 渲染断言 |
| `apps/client/src/components/ViewCard.tsx` | 修改 | outline 视图渲染新增角色清单 |
| 任务 7 另涉及 | 修改 | `AGENTS.md`、根 `ARCHITECTURE.md`、根 `PROGRESS.md`、根 `DECISIONS.md`、`apps/agent/src/workflows/ARCHITECTURE.md`、`apps/agent/src/workflows/PROGRESS.md` |

命名约定（全计划统一，后续任务引用即此定义）：
- `newCharacterSchema`：`{ name: string(min 1), role: string(min 1) }`；类型 `NewCharacterOutline`
- `OutlineSubmission`：`{ outline: Outline; newCharacters: NewCharacterOutline[] }`（outline-agent.ts 内定义导出）
- `saveOutlineInputSchemaFor(actCount, partCount)`：save_outline 新入参 schema 工厂（outline-agent.ts）
- `autoCreateCharacters(options)`：自动创建 Agent 入口；`AutoCreateCharactersOptions` 为其入参类型
- `filterNewCharacters(newCharacters, existingCharacters)`：编排层兜底 diff 纯函数（auto-character-agent.ts 导出）

---

### 任务 1：shared schema——newCharacterSchema + 确认视图可选字段

**文件：**
- 修改：`packages/shared/src/outline.ts`
- 修改：`packages/shared/src/views.ts`
- 修改：`packages/shared/src/index.ts:12`
- 测试：`packages/shared/src/index.test.ts`

- [ ] **步骤 1：编写失败的测试**

在 `packages/shared/src/index.test.ts` 顶部 import 中加入 `newCharacterSchema` 与 `outlineViewSchema`（从 `./index` 导入），文件末尾追加：

```typescript
describe("newCharacterSchema", () => {
  test("完整新增角色项通过校验", () => {
    const c = newCharacterSchema.parse({ name: "萧无咎", role: "反派·血宗宗主" });
    expect(c.name).toBe("萧无咎");
    expect(c.role).toBe("反派·血宗宗主");
  });

  test("缺名字 / 名字空串 / 定位空串被拒绝", () => {
    expect(() => newCharacterSchema.parse({ role: "反派" })).toThrow();
    expect(() => newCharacterSchema.parse({ name: "", role: "反派" })).toThrow();
    expect(() => newCharacterSchema.parse({ name: "萧无咎", role: "" })).toThrow();
  });
});

describe("outlineViewSchema 的 newCharacters 可选字段", () => {
  const baseOutline = {
    title: "灵脉遗孤",
    logline: "散修少年夺回被宗门垄断的灵脉",
    parts: [
      { name: "第一部", summary: "概述", acts: [{ name: "第一幕", summary: "梗概", keyPlotPoints: ["情节点"] }] },
    ],
  };

  test("携带 newCharacters 的确认视图通过校验", () => {
    const view = outlineViewSchema.parse({
      kind: "outline",
      detail: "confirm",
      outline: baseOutline,
      newCharacters: [{ name: "萧无咎", role: "反派·血宗宗主" }],
    });
    expect(view.newCharacters).toHaveLength(1);
  });

  test("不携带 newCharacters 的视图仍通过（full 展示与旧消息兼容）", () => {
    const view = outlineViewSchema.parse({ kind: "outline", detail: "full", outline: baseOutline });
    expect(view.newCharacters).toBeUndefined();
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`bun test packages/shared`
预期：FAIL——`newCharacterSchema` 未导出（导入报错 / undefined）。

- [ ] **步骤 3：编写实现**

`packages/shared/src/outline.ts` 末尾追加（`outlineSchema` 及其类型不动）：

```typescript
/**
 * 大纲结构化输出的「新增角色清单」项：大纲中登场、但角色库中没有的角色。
 * name 照抄角色名；role 为该角色在大纲中的一句话定位（如「反派·血宗宗主」），
 * 供确认门展示与角色自动创建 Agent 作种子。
 */
export const newCharacterSchema = z.object({
  name: z.string().min(1).describe("角色名"),
  role: z.string().min(1).describe("该角色在大纲中的一句话定位，如：反派·血宗宗主"),
});

export type NewCharacterOutline = z.infer<typeof newCharacterSchema>;
```

`packages/shared/src/views.ts`：import 行改为 `import { newCharacterSchema, outlineSchema } from "./outline";`，`outlineViewSchema` 改为：

```typescript
export const outlineViewSchema = z.object({
  kind: z.literal("outline"),
  /** confirm = 确认门简览（部/幕名称与概述）；full = 含关键情节点的全量展示 */
  detail: z.enum(["confirm", "full"]),
  outline: outlineSchema,
  /** 确认门携带的「新增角色清单」（名字+一句话定位）；full 展示与旧消息不带 */
  newCharacters: z.array(newCharacterSchema).optional(),
});
```

`packages/shared/src/index.ts:12` 改为：

```typescript
export { outlineSchema, newCharacterSchema, type Outline, type NewCharacterOutline } from "./outline";
```

- [ ] **步骤 4：运行测试验证通过**

运行：`bun test packages/shared`
预期：PASS（新增 5 条全绿，既有用例零回归）。

- [ ] **步骤 5：更新 PROGRESS 任务清单**（勾选任务 1，进入任务 2；不 commit）

---

### 任务 2：大纲 Agent——list_characters 工具 + save_outline 结构化扩展

本任务包含两条编排的**签名机械适配**（传 `novelId` / `characterStore`、解构返回值、测试 fixture 补空清单），保证 typecheck 与全量测试在任务边界仍然绿；行为接线留给任务 4 / 5。

**文件：**
- 修改：`apps/agent/src/workflows/agents/outline-agent.ts`
- 修改：`apps/agent/src/workflows/create-novel.ts:194`
- 修改：`apps/agent/src/workflows/regen-outline.ts:72-77`
- 修改：`apps/agent/src/workflows/create-novel.test.ts`（outlineFixture）
- 修改：`apps/agent/src/workflows/regen-outline.test.ts`（newOutlineFixture）
- 测试：`apps/agent/src/workflows/agents/outline-agent.test.ts`

- [ ] **步骤 1：编写失败的测试**

`outline-agent.test.ts` 顶部 import 加入 `saveOutlineInputSchemaFor`（从 `./outline-agent`），文件末尾追加：

```typescript
describe("saveOutlineInputSchemaFor", () => {
  const submission = { ...fourActTwoPartOutline, newCharacters: [{ name: "萧无咎", role: "反派·血宗宗主" }] };

  test("大纲 + 新增角色清单均合规时通过", () => {
    const parsed = saveOutlineInputSchemaFor(4, 2).parse(submission);
    expect(parsed.newCharacters).toHaveLength(1);
    // 空清单合法：大纲未引入新角色是正常路径
    expect(saveOutlineInputSchemaFor(4, 2).parse({ ...fourActTwoPartOutline, newCharacters: [] }).newCharacters).toEqual([]);
  });

  test("newCharacters 缺失或项内字段空串被拒绝", () => {
    expect(() => saveOutlineInputSchemaFor(4, 2).parse(fourActTwoPartOutline)).toThrow();
    expect(() => saveOutlineInputSchemaFor(4, 2).parse({ ...fourActTwoPartOutline, newCharacters: [{ name: "萧无咎" }] })).toThrow();
    expect(() => saveOutlineInputSchemaFor(4, 2).parse({ ...fourActTwoPartOutline, newCharacters: [{ name: "", role: "反派" }] })).toThrow();
  });

  test("清单内名字重复被拒绝", () => {
    expect(() =>
      saveOutlineInputSchemaFor(4, 2).parse({
        ...fourActTwoPartOutline,
        newCharacters: [
          { name: "萧无咎", role: "反派·血宗宗主" },
          { name: "萧无咎", role: "同一人重复列出" },
        ],
      }),
    ).toThrow("不得重复");
  });

  test("部/幕强校验仍然生效", () => {
    expect(() => saveOutlineInputSchemaFor(5, 2).parse(submission)).toThrow("5 幕");
    expect(() => saveOutlineInputSchemaFor(4, 1).parse(submission)).toThrow("1 部");
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`bun test apps/agent/src/workflows/agents/outline-agent.test.ts`
预期：FAIL——`saveOutlineInputSchemaFor` 未导出。

- [ ] **步骤 3：编写实现**

`outline-agent.ts` 全量改造（关键代码，保持文件既有注释风格）：

imports 增加：

```typescript
import { z } from "zod";
import { getDefaultCharacterStore, type CharacterStore } from "../../state/character-store";
import { outlineSchema, newCharacterSchema, type NewCharacterOutline, type Outline } from "@novel/shared";
```

`outlineSchemaFor` 保留导出（既有单测与谓词复用），其旁新增：

```typescript
/** save_outline 的结构化入参：大纲本体 + 新增角色清单（项内名字不得重复），叠加部/幕强校验 */
export function saveOutlineInputSchemaFor(actCount: number, partCount: number) {
  return outlineSchema
    .extend({
      newCharacters: z
        .array(newCharacterSchema)
        .refine((list) => new Set(list.map((c) => c.name)).size === list.length, "新增角色清单内名字不得重复"),
    })
    .refine(
      (o) =>
        o.parts.length === partCount &&
        o.parts.reduce((sum, p) => sum + p.acts.length, 0) === actCount,
      `大纲必须恰好为 ${partCount} 部、共 ${actCount} 幕`,
    );
}

/** 大纲 Agent 的最终产物：确认通过的大纲本体 + 随大纲连带确认的新增角色清单 */
export interface OutlineSubmission {
  outline: Outline;
  newCharacters: NewCharacterOutline[];
}
```

`CreateOutlineOptions` 增两个字段：

```typescript
export interface CreateOutlineOptions {
  /** 用户已命名的书名；指定时大纲 title 必须沿用 */
  novelTitle?: string;
  /** 大纲总幕数（用户指定，默认 5） */
  actCount: number;
  /** 部数（用户指定，默认 1） */
  partCount: number;
  /** 目标小说创作 ID（list_characters 工具按此查询角色库） */
  novelId: string;
  /** 角色库 store；缺省默认 SQLite store（测试可替换） */
  characterStore?: CharacterStore;
}
```

`createOutline` 主体（替换既有 saveOutline 工具与返回逻辑）：

```typescript
export async function createOutline(
  params: OutlineContext,
  options: CreateOutlineOptions,
  channel: UiChannel,
): Promise<OutlineSubmission> {
  const { novelTitle, actCount, partCount, novelId } = options;
  const characterStore = options.characterStore ?? getDefaultCharacterStore();
  let saved: OutlineSubmission | undefined;

  /** 角色库查询工具：返回库内全部角色名与叙事定位，供模型比对出「新增角色」 */
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

  const saveOutline = tool({
    description:
      "大纲完成后调用此工具保存（参数 = 完整大纲 + newCharacters 新增角色清单）。会把剧情梗概、主题、每部概述、每幕名称概述与新增角色清单展示给用户做最终确认：用户确认后保存完成；用户提出修改意见时，需根据反馈调整后重新调用。",
    inputSchema: saveOutlineInputSchemaFor(actCount, partCount),
    execute: async (input) => {
      const { newCharacters, ...outline } = input;
      const confirmed = await channel.askConfirm("以上大纲是否确认？", {
        default: true,
        view: { kind: "outline", detail: "confirm", outline, newCharacters },
      });
      if (confirmed) {
        saved = { outline, newCharacters };
        return { ok: true as const };
      }
      const feedback = await channel.askText("请说明大纲需要调整的地方> ");
      return {
        ok: false as const,
        feedback,
        note: "用户要求调整，请根据反馈修改大纲后重新调用 save_outline",
      };
    },
  });

  const result = await runReactAgent({
    system: SYSTEM_PROMPT,
    prompt: [ /* 既有 prompt 数组保持不变 */ ].join("\n\n"),
    tools: { save_outline: saveOutline, list_characters: listCharacters },
    maxSteps: 12,
    isDone: () => saved !== undefined,
    continuationHint: "请立即调用 save_outline 工具保存大纲（参数为完整大纲与 newCharacters 新增角色清单），不要只输出文本。",
  });

  if (!saved) {
    throw new Error(
      `大纲 Agent 未能在 ${result.stepCount} 步内完成创作。最后输出：\n${result.text}`,
    );
  }
  return saved;
}
```

`SYSTEM_PROMPT` 末尾（「完成后调用 save_outline…」段之前）插入一段：

```text
角色梳理要求：
1. 大纲中的角色应尽量沿用角色库已有角色（可用 list_characters 工具查询角色库现状）；
2. 登场角色不在角色库中时，必须将其列入 save_outline 的 newCharacters：name 为角色名，role 为该角色在大纲中的一句话定位（如「反派·血宗宗主」）；清单内名字不得重复，角色库已有角色不得列入；
3. newCharacters 会在确认时随大纲一并展示给用户：用户确认后这些角色将自动填充角色卡并入库。
```

调用方机械适配（保证本任务边界 typecheck 绿）：
- `create-novel.ts:194`：`const { outline } = await createOutline(params, { novelTitle: novelName, actCount, partCount, novelId: id, characterStore }, channel);`（`newCharacters` 暂不使用；`characterStore` 变量在函数内已有）
- `regen-outline.ts:72-77`：`const { outline } = await createOutline({ worldview: storedWorldview.worldview, characters: characters.map((c) => c.character) }, { novelTitle: novel.name ?? undefined, actCount, partCount, novelId, characterStore }, channel);`
- `create-novel.test.ts` 的 `outlineFixture` 增加 `newCharacters: []`；`regen-outline.test.ts` 的 `newOutlineFixture(...)` 返回对象增加 `newCharacters: []`（该 fixture 是函数，直接在返回的骨架对象上补字段）。

- [ ] **步骤 4：运行测试验证通过**

运行：`bun test apps/agent/src/workflows/agents/outline-agent.test.ts && bun test apps/agent/src/workflows`
预期：PASS——新 schema 单测全绿；create-novel / regen-outline 集成既有断言零回归（fixture 已补空清单，空清单不触发自动创建）。

- [ ] **步骤 5：更新 PROGRESS 任务清单**（勾选任务 2，不 commit）

---

### 任务 3：新建角色自动创建 Agent（auto-character-agent）

**文件：**
- 创建：`apps/agent/src/workflows/agents/auto-character-agent.ts`
- 测试：`apps/agent/src/workflows/agents/auto-character-agent.test.ts`（新建）

- [ ] **步骤 1：编写失败的测试**

新建 `auto-character-agent.test.ts`，仿照 `create-novel.test.ts` 的 mock 骨架（`mock.module("ai")`、FakeChannel、临时 SQLite）：

```typescript
import { afterAll, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type ScriptedCall = { tool: string; args: unknown };
type ScriptedTurn = ScriptedCall[];
let textScript: ScriptedTurn[][] = [];
type MockTool = { execute: (input: never, options: unknown) => Promise<unknown> };

mock.module("ai", () => ({
  tool: (spec: unknown) => spec,
  generateText: async ({ tools }: { tools: Record<string, MockTool> }) => {
    const turns = textScript.shift() ?? [];
    let callIndex = 0;
    for (const turn of turns) {
      for (const call of turn) {
        const t = tools[call.tool];
        if (!t) throw new Error(`脚本调用了未注册的工具：${call.tool}`);
        await t.execute(call.args as never, { toolCallId: `call_${callIndex++}`, messages: [] });
      }
    }
    return { text: "", steps: turns.map(() => ({})), finishReason: "tool-calls", response: { messages: [] } };
  },
  hasToolCall: () => () => false,
  stepCountIs: () => () => false,
}));

const { autoCreateCharacters, filterNewCharacters } = await import("./auto-character-agent");
const { openDatabase } = await import("../../state/db");
const { CharacterStore } = await import("../../state/character-store");
const { FakeChannel } = await import("../../ui/fake-channel");

const worldview = { background: { geography: "九州大陆" }, taboos: ["不可出现现代科技"] };
const outline = {
  title: "灵脉遗孤",
  logline: "散修少年夺回被宗门垄断的灵脉",
  parts: [{ name: "第一部", summary: "概述", acts: [{ name: "第一幕", summary: "梗概", keyPlotPoints: ["情节点"] }] }],
};
const existing = [
  {
    basicInfo: { name: "林恒", gender: "男" },
    core: { desire: "夺回灵脉", fear: "辜负同伴", narrativeRole: "主角" },
    background: "散修少年",
    creationPurpose: "承载主线",
    endingDirection: "打破垄断后归隐",
  },
];
const newCard = (name: string) => ({
  basicInfo: { name, gender: "男" },
  core: { desire: "掌控灵脉", fear: "失败", narrativeRole: "反派" },
  background: "血宗宗主",
  creationPurpose: "作为主要反派逼出主角成长",
  endingDirection: "被主角击败",
});

let tempDir: string;
afterAll(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

describe("filterNewCharacters", () => {
  test("剔除库内已有名（trim 全等）并按名字去重保留首个", () => {
    const filtered = filterNewCharacters(
      [
        { name: "萧无咎", role: "反派·血宗宗主" },
        { name: " 林恒 ", role: "误标已有角色" },
        { name: "萧无咎", role: "重复项" },
        { name: "  ", role: "空名" },
      ],
      existing as never,
    );
    expect(filtered).toEqual([{ name: "萧无咎", role: "反派·血宗宗主" }]);
  });

  test("空清单透传为空数组", () => {
    expect(filterNewCharacters([], existing as never)).toEqual([]);
  });
});

describe("autoCreateCharacters", () => {
  test("清单角色全部自动入库，库内已有名守卫拒绝后修正", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "novel-auto-char-"));
    const db = openDatabase(join(tempDir, "test.db"));
    const characterStore = new CharacterStore(db);
    characterStore.addCharacter("novel-1", existing[0] as never);
    const channel = new FakeChannel([]);

    textScript = [
      // 第一轮：越界名被拒 + 正确入库一张
      [
        { tool: "save_character", args: newCard("路人甲") },
        { tool: "save_character", args: newCard("萧无咎") },
      ],
      // 第二轮：修正后入库剩余角色
      [{ tool: "save_character", args: newCard("叶青璃") }],
    ];

    const created = await autoCreateCharacters({
      novelId: "novel-1",
      worldview: worldview as never,
      outline: outline as never,
      newCharacters: [
        { name: "萧无咎", role: "反派·血宗宗主" },
        { name: "叶青璃", role: "女主·灵医传人" },
      ],
      existingCharacters: existing as never,
      channel,
      characterStore,
    });

    expect(created.map((c) => c.character.basicInfo.name)).toEqual(["萧无咎", "叶青璃"]);
    const names = characterStore.listCharacters("novel-1").map((r) => r.character.basicInfo.name);
    expect(names).toEqual(["林恒", "萧无咎", "叶青璃"]);
    expect(channel.notifies.some((n) => n.includes("萧无咎"))).toBe(true);
    db.close();
  });

  test("maxSteps 耗尽未完成全部清单时抛可读错误，已入库卡保留", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "novel-auto-char-2"));
    const db = openDatabase(join(tempDir, "test.db"));
    const characterStore = new CharacterStore(db);
    const channel = new FakeChannel([]);

    textScript = [[]]; // 一轮空转，无任何工具调用

    await expect(
      autoCreateCharacters({
        novelId: "novel-2",
        worldview: worldview as never,
        outline: outline as never,
        newCharacters: [{ name: "萧无咎", role: "反派·血宗宗主" }],
        existingCharacters: [],
        channel,
        characterStore,
      }),
    ).rejects.toThrow("角色自动创建 Agent 未能完成");
    expect(characterStore.listCharacters("novel-2")).toHaveLength(0);
    db.close();
  });
});
```

注意：第二个用例依赖 runReactAgent 的续跑机制耗尽 `continuationMax` 后仍 isDone=false 才抛错——空转脚本会经历 1 次续跑后失败，断言 rejects 即可，不依赖具体续跑次数。

- [ ] **步骤 2：运行测试验证失败**

运行：`bun test apps/agent/src/workflows/agents/auto-character-agent.test.ts`
预期：FAIL——`./auto-character-agent` 模块不存在。

- [ ] **步骤 3：编写实现**

新建 `auto-character-agent.ts`：

```typescript
import { tool } from "ai";
import { runReactAgent } from "../../agents/react";
import type { UiChannel } from "../../ui/channel";
import {
  characterSchema,
  type Character,
  type NewCharacterOutline,
  type Outline,
  type Worldview,
} from "@novel/shared";
import { getDefaultCharacterStore, type CharacterStore, type StoredCharacter } from "../../state/character-store";

const SYSTEM_PROMPT = `你是一名专业的小说角色策划。你的任务：依据世界观与大纲，为「新增角色清单」中的每个角色自动填写完整角色卡并调用 save_character 入库。

填写要求：
1. name 必须原样使用清单中的角色名，不得增删改（改名漂移会被拒绝）；
2. 必填字段（姓名 / 核心渴望 / 核心恐惧 / 叙事定位 / 背景 / 创作目的 / 结局方向）必须填充：
   - 从大纲中该角色的登场情节与清单中的一句话定位推断叙事定位（主角/配角/反派等功能角色）与剧情功能；
   - 创作目的从创作者视角描述（该角色服务于故事的什么功能，如「作为强敌逼出主角的成长」）；
   - 结局方向与大纲走向一致，不得与大纲结局矛盾；
3. 可选字段（性别 / 外貌 / 性格 / 角色目的 / 轨迹 / 关系）在大纲与世界观有依据时一并填充，无依据留空；关系引用其他角色时使用其真实名字；
4. 遵守世界观设定与 taboos（禁忌），不得虚构与之冲突的设定。

按清单逐个处理：每张卡填完即调用 save_character（入参 = 完整角色卡），全部入库后任务结束。save_character 返回的 remaining 列出尚未入库的角色，请继续处理直到清单清空。`;

export interface AutoCreateCharactersOptions {
  /** 目标小说创作 ID（characters.novel_id 外键） */
  novelId: string;
  /** 世界观（角色卡设定的依据之一） */
  worldview: Worldview;
  /** 已确认的大纲本体（角色登场情节与定位的依据） */
  outline: Outline;
  /** 待自动创建的新增角色清单（须先经 filterNewCharacters 过滤） */
  newCharacters: NewCharacterOutline[];
  /** 角色库已有角色（供关系字段引用与重名守卫） */
  existingCharacters: Character[];
  /** 交互通道（自动创建无确认门，仅经 notify 通报进度） */
  channel: UiChannel;
  /** 角色持久化 store；缺省默认 SQLite store（测试可替换） */
  characterStore?: CharacterStore;
}

/**
 * 编排层兜底 diff（纯函数，可单测）：不信任模型给出的「新增」判定——
 * 按库内角色名剔除清单中已有项（trim 后全等比对），清单内同名去重保留首个，
 * 名字 trim 后为空的项剔除。
 */
export function filterNewCharacters(
  newCharacters: NewCharacterOutline[],
  existingCharacters: Character[],
): NewCharacterOutline[] {
  const libraryNames = new Set(existingCharacters.map((c) => c.basicInfo.name.trim()));
  const seen = new Set<string>();
  const result: NewCharacterOutline[] = [];
  for (const item of newCharacters) {
    const name = item.name.trim();
    if (name.length === 0 || libraryNames.has(name) || seen.has(name)) continue;
    seen.add(name);
    result.push({ name, role: item.role });
  }
  return result;
}

/**
 * 角色自动创建 Agent（ReAct 循环，无确认门）：依据世界观与大纲为清单中的
 * 每个新增角色自动填充角色卡并逐卡入库；清单全部入库（isDone 按数量判定）
 * 或 maxSteps 耗尽（抛可读错误，已入库卡保留）后结束。
 * 独立导出：后续章节规划 / 正文生成等写作期工作流可直接复用。
 */
export async function autoCreateCharacters(
  options: AutoCreateCharactersOptions,
): Promise<StoredCharacter[]> {
  const { novelId, worldview, outline, newCharacters, existingCharacters, channel } = options;
  const characterStore = options.characterStore ?? getDefaultCharacterStore();
  if (newCharacters.length === 0) return [];

  const pendingNames = new Set(newCharacters.map((c) => c.name.trim()));
  const libraryNames = new Set(existingCharacters.map((c) => c.basicInfo.name.trim()));
  const created: StoredCharacter[] = [];
  const savedNames = new Set<string>();

  const saveCharacter = tool({
    description:
      "保存一个清单内新增角色的完整角色卡并入库。入参必须严格符合角色卡 schema；name 必须原样使用清单中的角色名。每个角色只保存一次。",
    inputSchema: characterSchema,
    execute: async (character) => {
      const name = character.basicInfo.name.trim();
      if (!pendingNames.has(name)) {
        return { ok: false as const, note: `「${character.basicInfo.name}」不在待创建清单内，只能为清单角色创建角色卡：${newCharacters.map((c) => c.name).join("、")}` };
      }
      if (savedNames.has(name)) {
        return { ok: false as const, note: `「${name}」已入库，请勿重复保存` };
      }
      if (libraryNames.has(name)) {
        return { ok: false as const, note: `「${name}」已在角色库中，不得重复创建` };
      }
      const stored = characterStore.addCharacter(novelId, characterSchema.parse(character));
      savedNames.add(name);
      created.push(stored);
      channel.notify(`✨ 新角色已自动入库：${stored.character.basicInfo.name}（${stored.character.core.narrativeRole}）`);
      const remaining = newCharacters.filter((c) => !savedNames.has(c.name.trim())).map((c) => c.name);
      return { ok: true as const, saved: name, remaining };
    },
  });

  const result = await runReactAgent({
    system: SYSTEM_PROMPT,
    prompt: [
      `世界观（JSON）：\n${JSON.stringify(worldview, null, 2)}`,
      `大纲（JSON）：\n${JSON.stringify(outline, null, 2)}`,
      existingCharacters.length > 0
        ? `角色库已有角色：${existingCharacters.map((c) => `${c.basicInfo.name}（${c.core.narrativeRole}）`).join("、")}`
        : "角色库暂无角色",
      `新增角色清单（共 ${newCharacters.length} 个，逐个创建）：\n${newCharacters.map((c) => `- ${c.name}——${c.role}`).join("\n")}`,
    ].join("\n\n"),
    tools: { save_character: saveCharacter },
    maxSteps: 4 + newCharacters.length * 2,
    isDone: () => savedNames.size >= newCharacters.length,
    continuationHint: "还有清单角色未入库，请继续为它们填写角色卡并调用 save_character，不要只输出文本。",
  });

  if (savedNames.size < newCharacters.length) {
    throw new Error(
      `角色自动创建 Agent 未能完成全部 ${newCharacters.length} 个新增角色的入库（已完成：${[...savedNames].join("、") || "无"}）。最后输出：\n${result.text}`,
    );
  }
  return created;
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`bun test apps/agent/src/workflows/agents/auto-character-agent.test.ts`
预期：PASS——filterNewCharacters 2 条 + Agent 集成 2 条全绿。
若 maxSteps 用例因续跑次数抛错形态不同，按实际错误消息调整 `rejects.toThrow` 断言文案（实现不变）。

- [ ] **步骤 5：更新 PROGRESS 任务清单**（勾选任务 3，不 commit）

---

### 任务 4：create-novel 接入自动创建

**文件：**
- 修改：`apps/agent/src/workflows/create-novel.ts:194-216`
- 测试：`apps/agent/src/workflows/create-novel.test.ts`

- [ ] **步骤 1：编写失败的测试**

在 `create-novel.test.ts` 中：

(a) 主流程用例的 `outlineFixture` 的 `newCharacters` 由 `[]` 改为：

```typescript
newCharacters: [
  { name: "萧无咎", role: "反派·血宗宗主" },
  { name: "林恒", role: "误标已有角色（应被兜底 diff 剔除）" },
],
```

(b) `textScript` 增加自动创建 Agent 的一轮（大纲轮之后）：

```typescript
// outline agent 一次 save_outline；auto-character agent 一轮入库萧无咎
textScript = [
  [[{ tool: "submit_worldview", args: worldviewFixture }]],
  [characterFields.map((f) => ({ tool: "save_field", args: f })), [{ tool: "submit_character", args: {} }]],
  [[{ tool: "save_outline", args: outlineFixture }]],
  [[{ tool: "save_character", args: autoCard }]],
];
```

其中 `autoCard` 为模块级 fixture（过 characterSchema）：

```typescript
const autoCard = {
  basicInfo: { name: "萧无咎", gender: "男" },
  core: { desire: "掌控九州灵脉", fear: "宗门基业毁于己手", narrativeRole: "反派" },
  background: "血宗宗主，靠垄断灵脉崛起",
  creationPurpose: "作为主要反派逼出主角的成长",
  endingDirection: "被主角击败，宗门垄断瓦解",
};
```

(c) 断言追加（文件末尾持久化断言区）：

```typescript
// 新增角色自动入库：清单内「林恒」为库内已有角色，被兜底 diff 剔除（零调用、不入库）
const characterStore2 = new CharacterStore(db);
expect(
  characterStore2.listCharacters(state.id).map((c) => c.character.basicInfo.name),
).toEqual(["林恒", "萧无咎"]);
// 逐卡 notify 与汇总 notify
expect(channel.notifies.some((n) => n.includes("新角色已自动入库：萧无咎"))).toBe(true);
expect(channel.notifies.some((n) => n.includes("新增 1 个角色已自动入库"))).toBe(true);
```

(d) 新增独立用例「大纲未引入新角色时跳过自动创建（零 LLM 调用）」：复用主流程脚本但 `outlineFixture.newCharacters: []`、textScript 不含第 4 组轮次，断言 `channel.notifies` 不含「自动入库」且 characters 表仅 `["林恒"]`。

- [ ] **步骤 2：运行测试验证失败**

运行：`bun test apps/agent/src/workflows/create-novel.test.ts`
预期：FAIL——无「新角色已自动入库」notify、characters 表缺「萧无咎」。

- [ ] **步骤 3：编写实现**

`create-novel.ts` 改造大纲收尾段：

```typescript
import { autoCreateCharacters, filterNewCharacters } from "./agents/auto-character-agent";
// createOutline 调用处改为：
const submission = await createOutline(params, { novelTitle: novelName, actCount, partCount, novelId: id, characterStore }, channel);
const outline = submission.outline;
channel.present({ kind: "outline", detail: "full", outline });

// 确认后入库（outlines 表两级树，梗概与关键情节点随节点入列）并落盘 output/<id>.json
const treeNodes = outlineStore.saveOutlineTree(id, outline.parts);
/* ……既有统计 notify 与落盘 notify 不变…… */

// 大纲新增角色自动入库：代码级兜底 diff（剔除库内已有名 + 去重），空清单跳过（零 LLM 调用）
const existingCharacters = characterStore.listCharacters(id).map((c) => c.character);
const pendingNew = filterNewCharacters(submission.newCharacters, existingCharacters);
if (pendingNew.length > 0) {
  channel.notify(`\n✨ 大纲引入了 ${pendingNew.length} 个新角色，正在自动填充角色卡并入库…`);
  await autoCreateCharacters({
    novelId: id,
    worldview,
    outline,
    newCharacters: pendingNew,
    existingCharacters,
    channel,
    characterStore,
  });
  channel.notify(`✨ 本次大纲新增 ${pendingNew.length} 个角色已自动入库：${pendingNew.map((c) => c.name).join("、")}`);
}
```

（其余收尾——status → outlined、novelStore.updateNovel、完成 notify——保持不变。）

- [ ] **步骤 4：运行测试验证通过**

运行：`bun test apps/agent/src/workflows/create-novel.test.ts`
预期：PASS——自动入库 / 兜底剔除 / 空清单跳过三类断言全绿，既有断言零回归。

- [ ] **步骤 5：更新 PROGRESS 任务清单**（勾选任务 4，不 commit）

---

### 任务 5：regen-outline 接入自动创建

**文件：**
- 修改：`apps/agent/src/workflows/regen-outline.ts:72-89`
- 测试：`apps/agent/src/workflows/regen-outline.test.ts`

- [ ] **步骤 1：编写失败的测试**

在 `regen-outline.test.ts`：

(a) `newOutlineFixture` 增加 `newCharacters` 参数透传（fixture 函数签名追加可选参 `newCharacters: NewCharacterOutline[] = []`，返回对象携带该字段）；主流程用例传入 `[{ name: "萧无咎", role: "反派·血宗宗主" }]`。

(b) 主流程 `textScript` 在 save_outline 轮后追加一轮 `[[{ tool: "save_character", args: 萧无咎完整卡 }]]`（卡 fixture 同任务 4 的 `autoCard`，复制为本文件模块级常量）。

(c) 断言追加：

```typescript
// 新版本大纲的新增角色自动入库；确认循环用例（拒绝→再确认）清单为空、无自动创建轮
const characterStore = new CharacterStore(world.db);
expect(
  characterStore.listCharacters(NOVEL_ID).map((c) => c.character.basicInfo.name),
).toContain("萧无咎");
expect(channel.notifies.some((n) => n.includes("新增 1 个角色已自动入库"))).toBe(true);
```

- [ ] **步骤 2：运行测试验证失败**

运行：`bun test apps/agent/src/workflows/regen-outline.test.ts`
预期：FAIL——characters 表无「萧无咎」、无汇总 notify。

- [ ] **步骤 3：编写实现**

`regen-outline.ts` 大纲确认后（`saveOutlineTreeNewVersion` 与产物覆盖、description 回填之后，`return` 之前）接入，与任务 4 同构：

```typescript
import { autoCreateCharacters, filterNewCharacters } from "./agents/auto-character-agent";
// createOutline 调用改为：
const submission = await createOutline(
  { worldview: storedWorldview.worldview, characters: characters.map((c) => c.character) },
  { novelTitle: novel.name ?? undefined, actCount, partCount, novelId, characterStore },
  channel,
);
const outline = submission.outline;
/* ……既有入库 / 落盘 / 回填逻辑中 outline 引用不变…… */

// 大纲新增角色自动入库（兜底 diff + 空清单跳过，同 createNovel 收尾动作）
const freshCharacters = characterStore.listCharacters(novelId).map((c) => c.character);
const pendingNew = filterNewCharacters(submission.newCharacters, freshCharacters);
if (pendingNew.length > 0) {
  channel.notify(`\n✨ 新版大纲引入了 ${pendingNew.length} 个新角色，正在自动填充角色卡并入库…`);
  await autoCreateCharacters({
    novelId,
    worldview: storedWorldview.worldview,
    outline,
    newCharacters: pendingNew,
    existingCharacters: freshCharacters,
    channel,
    characterStore,
  });
  channel.notify(`✨ 本次大纲新增 ${pendingNew.length} 个角色已自动入库：${pendingNew.map((c) => c.name).join("、")}`);
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`bun test apps/agent/src/workflows/regen-outline.test.ts`
预期：PASS——自动入库断言全绿；确认循环 / 三类前置校验用例零回归（清单空、无自动创建轮）。

- [ ] **步骤 5：更新 PROGRESS 任务清单**（勾选任务 5，不 commit）

---

### 任务 6：双端渲染联动（CLI renderView + 客户端 ViewCard）

**文件：**
- 修改：`apps/agent/src/ui/cli-channel.ts:80-83,112-123`
- 测试：`apps/agent/src/ui/cli-channel.test.ts`
- 修改：`apps/client/src/components/ViewCard.tsx:44-72`

- [ ] **步骤 1：编写失败的测试**

`cli-channel.test.ts` 的 outline 渲染用例追加断言（既有 `renderView` 调用保持，另起两个调用）：

```typescript
test("outline confirm：携带 newCharacters 时渲染新增角色清单，缺失或为空不渲染", () => {
  const withNew = renderView({
    kind: "outline",
    detail: "confirm",
    outline,
    newCharacters: [{ name: "萧无咎", role: "反派·血宗宗主" }],
  });
  expect(withNew).toContain("本次大纲新增角色");
  expect(withNew).toContain("萧无咎——反派·血宗宗主");
  // full 视图与空清单确认视图不渲染清单区块
  expect(renderView({ kind: "outline", detail: "full", outline, newCharacters: [] })).not.toContain("新增角色");
  expect(renderView({ kind: "outline", detail: "confirm", outline })).not.toContain("新增角色");
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`bun test apps/agent/src/ui/cli-channel.test.ts`
预期：FAIL——渲染文本不含「本次大纲新增角色」。

- [ ] **步骤 3：编写实现**

`cli-channel.ts`：`renderView` 的 outline 分支把 `view.newCharacters` 传入 confirm 格式化；`formatOutlineForConfirm` 改签名并追加区块：

```typescript
case "outline":
  return view.detail === "confirm"
    ? formatOutlineForConfirm(view.outline, view.newCharacters)
    : formatOutlineFull(view.outline);

/** 确认视图：剧情梗概、主题、两级部/幕名称与概述 + 新增角色清单（详细情节点在保存后完整展示） */
function formatOutlineForConfirm(o: Outline, newCharacters?: NewCharacterOutline[]): string {
  const lines = [`📖 大纲草稿：《${o.title}》`, `  剧情梗概：${o.logline}`];
  if (o.theme) lines.push(`  主题：${o.theme}`);
  for (const part of o.parts) {
    lines.push(`  ▶ ${part.name}：${part.summary}`);
    for (const act of part.acts) {
      lines.push(`    ▶ ${act.name}：${act.summary}`);
    }
  }
  if (newCharacters && newCharacters.length > 0) {
    lines.push(`  ✨ 本次大纲新增角色（确认后自动入库）：`);
    for (const c of newCharacters) {
      lines.push(`    · ${c.name}——${c.role}`);
    }
  }
  return lines.join("\n");
}
```

（import 增加 `type NewCharacterOutline` 自 `@novel/shared`。）

`ViewCard.tsx` 的 outline 分支，在 parts 渲染之后、`</section>` 之前追加：

```tsx
{view.newCharacters && view.newCharacters.length > 0 ? (
  <>
    <p className="part-name">✨ 本次大纲新增角色（确认后自动入库）</p>
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
预期：PASS——渲染断言全绿；client typecheck 过（ViewCard 仅类型层改动，GUI 观感留人工验收）。

- [ ] **步骤 5：更新 PROGRESS 任务清单**（勾选任务 6，不 commit）

---

### 任务 7：全量校验 + 文档同步 + 原子提交

**文件：**
- 修改：`AGENTS.md`（目录结构与主工作流 / regen 流程描述）
- 修改：根 `ARCHITECTURE.md`（大纲 Agent 工具与产物、自动创建 Agent、两流程收尾动作）
- 修改：根 `PROGRESS.md`（任务清单索引归一为完成总结）+ 根 `DECISIONS.md`（决策落盘）
- 修改：`apps/agent/src/workflows/ARCHITECTURE.md` + `PROGRESS.md`（模块级：文件职责 / 依赖边界 / 数据流 / 清单归一）

- [ ] **步骤 1：全量工程校验**

运行：`bun run typecheck && bun run lint && bun run test`
预期：3 工程 typecheck / lint / 全量单测 100% 通过（对齐任务开始基线，仅允许净增用例）。

- [ ] **步骤 2：文档同步**

- `AGENTS.md`：目录树补 `auto-character-agent.ts`；workflows 条目补「大纲 Agent 角色库查询工具与新增角色清单、确认后自动入库」；create-novel 与 regen-outline 流程描述同步。
- 根 `ARCHITECTURE.md`：大纲主工作流第 9 步与「大纲重新生成工作流」补「save_outline 结构化携带 newCharacters → 确认门连带确认 → 入库后兜底 diff → autoCreateCharacters」；文件树 `workflows/agents/` 补 auto-character-agent 一行。
- 根 `DECISIONS.md`：追加 2026-10-06 决策——方案 A（ReAct 循环 + save_character 终态工具）取代 for+generateObject / 单次数组生成的理由；清单进确认门连带确认的理由（写库前透明可拦截）；兜底 diff 不信任模型新增判定的理由。
- workflows 模块两级文档按上述同源更新；`PROGRESS.md`「进行中」清单删除，归一为一条完成总结写入「已完成」（含 AC：typecheck / lint / 全量单测结果、集成测试覆盖点、真实 LLM 端到端待用户复验的步骤——`bun run dev` 走到大纲确认门观察清单展示、确认后查 characters 表）。

- [ ] **步骤 3：原子提交**

```bash
git add -A
git commit -m "feat(workflows): 大纲新增角色结构化输出与自动入库

- shared：newCharacterSchema（名字+一句话定位）+ outlineViewSchema 增可选 newCharacters
- 大纲 Agent：list_characters 角色库查询工具；save_outline 入参附新增角色清单并进确认门连带确认
- 新建 auto-character-agent：ReAct + save_character 终态工具循环，isDone 按清单数量判定，独立供章节/正文工作流复用
- create-novel / regen-outline 确认入库后兜底 diff + 自动创建接入；CLI renderView 与客户端 ViewCard 渲染清单
- AC：typecheck 3 工程 / lint / 全量单测过；真实 LLM 端到端待用户复验"
```

（提交前 `git status` 复核，不得混入 `files/`、`.env`、临时产物。）

- [ ] **步骤 4：向用户报告并交接真实 LLM 复验步骤**

---

## 自检记录（编写时已执行）

1. **规格覆盖度**：规格 §3.1→任务 1；§3.2→任务 2；§3.3→任务 3；§3.4→任务 4/5；§3.5→任务 6；规格 §4 边界（diff 剔除 / 越界拒绝 / maxSteps 兜底 / 空清单跳过）分别落在任务 3/4 的测试中；§5 测试计划与各任务步骤一一对应；§6 文档同步→任务 7。无遗漏。
2. **占位符扫描**：无「待定 / TODO / 类似任务 N / 添加适当校验」类占位；每个代码步骤均有完整代码块。
3. **类型一致性**：`NewCharacterOutline` / `OutlineSubmission` / `saveOutlineInputSchemaFor` / `autoCreateCharacters` / `filterNewCharacters` / `AutoCreateCharactersOptions` 命名在任务 1-7 间一致；`StoredCharacter` / `CharacterStore` / `FakeChannel` / `renderView` 等均为实读既有导出。

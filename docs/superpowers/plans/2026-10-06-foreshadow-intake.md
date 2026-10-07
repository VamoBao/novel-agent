# 大纲与章节规划伏笔接入 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 大纲与章节规划的结构化输出附「未创建伏笔清单」（进确认门连带确认），内容与角色入库后由确定性代码创建入库（服务角色名→ID、幕名→幕节点、章名→章节点）；章节规划回传本幕未绑伏笔由 LLM 绑定登场章。

**架构：** 镜像 newCharacters 模式但**无 LLM Agent**——伏笔字段全部来自 `save_outline` / `save_chapters` 结构化清单，创建逻辑收敛在独立模块 `workflows/foreshadow-intake.ts`（两个 plant 函数 + 名字解析纯函数）；数据层 `foreshadows` 增可空 `act_node_id` 列（SCHEMA_VERSION 11→12）精确圈定「该幕未绑章」回传范围。规格见 `docs/superpowers/specs/2026-10-06-foreshadow-intake-design.md`。

**技术栈：** Bun 1.4 + TypeScript 6（strict）、Vercel AI SDK 7、zod 4、`bun:sqlite`（user_version 链式迁移）、`bun:test`。

**执行约定（项目规范，优先于通用惯例）：**
- SDD 流水线（本会话第三轮）：worktree 分支逐任务提交（每任务一个实现子代理 + 独立任务审查），全部完成后整分支最终审查，收尾 squash 合并回 master 为唯一原子提交。
- 开始任务 1 前把任务清单落盘 `apps/agent/src/workflows/PROGRESS.md`「进行中」区域；每完成一个任务立即勾选。
- 每个任务闭环 = 该任务聚焦测试绿；任务 9 跑全量 `bun run typecheck` / `bun run lint` / `bun run test` 与真实库副本迁移实跑。
- 真实 LLM 端到端由用户复验，不在任务内。

---

## 文件结构（创建 / 修改清单）

| 文件 | 动作 | 职责 |
| --- | --- | --- |
| `packages/shared/src/foreshadow.ts` | 修改 | 追加 `newForeshadowSchema` / `outlineNewForeshadowSchema` / `chapterNewForeshadowSchema` / `foreshadowBindingSchema` 与类型（`foreshadowSchema` / `foreshadowPatchSchema` 不动） |
| `packages/shared/src/views.ts` | 修改 | outline 与 chapterPlan 两视图增可选 `newForeshadows`（chapter 另增 `foreshadowBindings`） |
| `packages/shared/src/index.ts` | 修改 | 出口补齐新 schema 与类型 |
| `packages/shared/src/index.test.ts` | 修改 | 新 schema 边界与视图两态单测 |
| `apps/agent/src/state/db.ts` | 修改 | SCHEMA_VERSION 11→12：迁移段 ALTER + CREATE TABLE 增列 |
| `apps/agent/src/state/db.test.ts` | 修改 | v11→12 迁移用例 |
| `apps/agent/src/state/foreshadow-store.ts` | 修改 | `act_node_id` 读写、`addForeshadow` 第三可选参、`listUnboundByAct` |
| `apps/agent/src/state/foreshadow-store.test.ts` | 修改 | act 列与新查询用例 |
| `apps/agent/src/workflows/foreshadow-intake.ts` | 创建 | `resolveCharacterIds` / `plantOutlineForeshadows` / `plantChapterForeshadows` |
| `apps/agent/src/workflows/foreshadow-intake.test.ts` | 创建 | 两条路径全分支单测 |
| `apps/agent/src/workflows/agents/outline-agent.ts` | 修改 | save_outline 入参扩展 + `OutlineSubmission` + prompt 伏笔梳理 + 确认视图 |
| `apps/agent/src/workflows/agents/outline-agent.test.ts` | 修改 | schema 扩展用例 |
| `apps/agent/src/workflows/create-novel.ts` | 修改 | 角色入库后伏笔入库（任务 4 先机械适配） |
| `apps/agent/src/workflows/regen-outline.ts` | 修改 | 同上 |
| `apps/agent/src/workflows/create-novel.test.ts` / `regen-outline.test.ts` | 修改 | fixture 与断言 |
| `apps/agent/src/workflows/agents/chapter-agent.ts` | 修改 | 未绑伏笔回传 + save_chapters 两组扩展 + `ChapterPlanSubmission` + prompt |
| `apps/agent/src/workflows/agents/chapter-agent.test.ts` | 修改 | schema 扩展用例 |
| `apps/agent/src/workflows/plan-act-chapters.ts` | 修改 | 回传 + 确认后创建与绑定 |
| `apps/agent/src/workflows/plan-act-chapters.test.ts` | 修改 | 回传与入库断言 |
| `apps/agent/src/ui/cli-channel.ts` | 修改 | 两视图伏笔/绑定区块渲染 |
| `apps/agent/src/ui/cli-channel.test.ts` | 修改 | 渲染断言 |
| `apps/client/src/components/ViewCard.tsx` | 修改 | 两分支同步渲染 |
| 任务 9 另涉及 | 修改 | `AGENTS.md`、根 `ARCHITECTURE.md` / `PROGRESS.md` / `DECISIONS.md`、`workflows/ARCHITECTURE.md` / `PROGRESS.md` |

命名约定（全计划统一）：
- `newForeshadowSchema`（基础四字段）/ `outlineNewForeshadowSchema`（+actName）/ `chapterNewForeshadowSchema`（+chapterName）/ `foreshadowBindingSchema`（index+chapterName）；类型 `NewForeshadow` / `OutlineNewForeshadow` / `ChapterNewForeshadow` / `ForeshadowBinding`
- `resolveCharacterIds(names, characters)` → `{ ids, unresolved }`；`plantOutlineForeshadows(options)` → `{ created, skipped }`；`plantChapterForeshadows(options)` → `{ created, skipped, bound }`（均在 `foreshadow-intake.ts` 导出）
- `addForeshadow(novelId, foreshadow, actNodeId?)`；`listUnboundByAct(novelId, actNodeId)`；`StoredForeshadow.actNodeId: string | null`

---

### 任务 1：shared schema——伏笔清单三变体 + 绑定指令 + 两视图可选字段

**文件：**
- 修改：`packages/shared/src/foreshadow.ts`、`views.ts`、`index.ts`
- 测试：`packages/shared/src/index.test.ts`

- [ ] **步骤 1：编写失败的测试**

`index.test.ts` 顶部 import 加入 `newForeshadowSchema, outlineNewForeshadowSchema, chapterNewForeshadowSchema, foreshadowBindingSchema`，文件末尾追加：

```typescript
describe("newForeshadowSchema 及变体", () => {
  const base = {
    surfaceAction: "老周把主角派去北境送信",
    hiddenTruth: "暗示老周已经投敌，借刀除掉主角",
    attentionLevel: 4,
    characterNames: ["林恒", "萧无咎"],
  };

  test("基础项通过；大纲变体带 actName、章节变体带 chapterName 各自通过", () => {
    expect(newForeshadowSchema.parse(base).attentionLevel).toBe(4);
    expect(outlineNewForeshadowSchema.parse({ ...base, actName: "第1幕" }).actName).toBe("第1幕");
    expect(chapterNewForeshadowSchema.parse({ ...base, chapterName: "第一章·雨夜" }).chapterName).toBe("第一章·雨夜");
  });

  test("注意度越界 / 非整数、characterNames 空数组或缺字段被拒绝", () => {
    expect(() => newForeshadowSchema.parse({ ...base, attentionLevel: 0 })).toThrow();
    expect(() => newForeshadowSchema.parse({ ...base, attentionLevel: 11 })).toThrow();
    expect(() => newForeshadowSchema.parse({ ...base, attentionLevel: 4.5 })).toThrow();
    expect(() => newForeshadowSchema.parse({ ...base, characterNames: [] })).toThrow();
    expect(() => newForeshadowSchema.parse({ ...base, hiddenTruth: "" })).toThrow();
  });

  test("变体缺归属字段被拒绝（大纲缺 actName / 章节缺 chapterName）", () => {
    expect(() => outlineNewForeshadowSchema.parse(base)).toThrow();
    expect(() => chapterNewForeshadowSchema.parse(base)).toThrow();
  });

  test("foreshadowBindingSchema：合法通过；序号 0 或章名空串被拒绝", () => {
    expect(foreshadowBindingSchema.parse({ index: 1, chapterName: "第一章·雨夜" }).index).toBe(1);
    expect(() => foreshadowBindingSchema.parse({ index: 0, chapterName: "第一章" })).toThrow();
    expect(() => foreshadowBindingSchema.parse({ index: 1, chapterName: "" })).toThrow();
  });
});

describe("两确认视图的伏笔可选字段", () => {
  const baseOutlineView = {
    kind: "outline",
    detail: "confirm",
    outline: {
      title: "灵脉遗孤",
      logline: "散修少年夺回灵脉",
      parts: [{ name: "第一部", summary: "概述", acts: [{ name: "第一幕", summary: "梗概", keyPlotPoints: ["情节点"] }] }],
    },
  };
  const fs = {
    surfaceAction: "老周把主角派去北境送信",
    hiddenTruth: "暗示老周已投敌",
    attentionLevel: 4,
    characterNames: ["林恒"],
  };

  test("outline 视图携带 newForeshadows 通过；缺失仍通过", () => {
    expect(outlineViewSchema.parse({ ...baseOutlineView, newForeshadows: [{ ...fs, actName: "第一幕" }] }).newForeshadows).toHaveLength(1);
    expect(outlineViewSchema.parse(baseOutlineView).newForeshadows).toBeUndefined();
  });

  test("chapter-plan 视图携带 newForeshadows 与 foreshadowBindings 通过；缺失仍通过", () => {
    const base = {
      kind: "chapter-plan",
      actName: "第1幕",
      actSummary: "梗概",
      keyPlotPoints: ["情节点"],
      plan: { chapters: [{ name: "第一章·雨夜", summary: "概述" }] },
    };
    const view = chapterPlanViewSchema.parse({
      ...base,
      newForeshadows: [{ ...fs, chapterName: "第一章·雨夜" }],
      foreshadowBindings: [{ index: 1, chapterName: "第一章·雨夜" }],
    });
    expect(view.foreshadowBindings).toHaveLength(1);
    expect(chapterPlanViewSchema.parse(base).newForeshadows).toBeUndefined();
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`bun test packages/shared`——预期 FAIL（导出不存在）。

- [ ] **步骤 3：编写实现**

`foreshadow.ts` 末尾追加：

```typescript
/**
 * 大纲 / 章节规划结构化输出的「未创建伏笔」项：创建入库由代码完成（无需 LLM），
 * characterNames / actName / chapterName 在入库时解析为 ID。
 */
export const newForeshadowSchema = z.object({
  surfaceAction: z.string().min(1).describe("表面行为：伏笔的表面表现，如某角色被派去执行危险任务"),
  hiddenTruth: z.string().min(1).describe("隐藏的真相：伏笔真正要反映的剧情体现"),
  attentionLevel: z.number().int().min(1).max(10).describe("读者注意度：1 最容易被读者发现，10 最难发现"),
  characterNames: z.array(z.string().min(1)).min(1).describe("服务角色名（引用角色库名或本次新增角色清单名）"),
});

export type NewForeshadow = z.infer<typeof newForeshadowSchema>;

/** 大纲阶段变体：埋设幕名（入库时解析为幕节点 ID） */
export const outlineNewForeshadowSchema = newForeshadowSchema.extend({
  actName: z.string().min(1).describe("埋设幕名（必须是大纲中真实的幕名）"),
});

export type OutlineNewForeshadow = z.infer<typeof outlineNewForeshadowSchema>;

/** 章节规划阶段变体：登场章名（入库时解析为章节点 ID） */
export const chapterNewForeshadowSchema = newForeshadowSchema.extend({
  chapterName: z.string().min(1).describe("登场章名（必须是本次规划中的真实章名）"),
});

export type ChapterNewForeshadow = z.infer<typeof chapterNewForeshadowSchema>;

/** 章节规划时「既有未绑伏笔 → 登场章」的绑定指令（index 对应回传清单序号，1-based） */
export const foreshadowBindingSchema = z.object({
  index: z.number().int().min(1).describe("回传伏笔清单中的序号（从 1 起）"),
  chapterName: z.string().min(1).describe("登场章名（必须是本次规划中的真实章名）"),
});

export type ForeshadowBinding = z.infer<typeof foreshadowBindingSchema>;
```

`views.ts`：import 自 `./foreshadow` 增 `chapterNewForeshadowSchema, foreshadowBindingSchema, outlineNewForeshadowSchema`；`outlineViewSchema` 增 `newForeshadows: z.array(outlineNewForeshadowSchema).optional()`（newCharacters 之后）；`chapterPlanViewSchema` 增 `newForeshadows: z.array(chapterNewForeshadowSchema).optional()` 与 `foreshadowBindings: z.array(foreshadowBindingSchema).optional()`（newCharacters 之后）。均带中文注释「确认门携带的伏笔清单；旧消息不带」。

`index.ts` 的 foreshadow 出口块补齐四个 schema 与四个类型导出。

- [ ] **步骤 4：运行测试验证通过**

运行：`bun test packages/shared`——预期 PASS（新增 6 条全绿，既有零回归）。

- [ ] **步骤 5：更新 PROGRESS 任务清单**（勾选任务 1，不 commit）

---

### 任务 2：数据层——SCHEMA_VERSION 11→12 与 ForeshadowStore 扩展

**文件：**
- 修改：`apps/agent/src/state/db.ts`、`foreshadow-store.ts`
- 测试：`apps/agent/src/state/db.test.ts`、`foreshadow-store.test.ts`

- [ ] **步骤 1：编写失败的测试**

`db.test.ts` 追加（参照文件内既有迁移用例的组织方式；v11 中间态库手工构造——只需 foreshadows 与 novels 两表）：

```typescript
test("v11 库升 12：foreshadows 增 act_node_id 列，存量伏笔数据无损", () => {
  const dir = await mkdtemp(join(tmpdir(), "novel-db-mig-v12-"));
  const dbPath = join(dir, "test.db");
  const raw = new Database(dbPath);
  raw.exec("PRAGMA foreign_keys = ON;");
  raw.exec(`CREATE TABLE novels (id TEXT PRIMARY KEY, name TEXT, author TEXT, description TEXT, pinned INTEGER NOT NULL DEFAULT 0, favorite INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
  raw.exec(`CREATE TABLE foreshadows (
    id TEXT PRIMARY KEY, novel_id TEXT NOT NULL REFERENCES novels(id),
    surface_action TEXT NOT NULL, hidden_truth TEXT NOT NULL,
    attention_level INTEGER NOT NULL CHECK (attention_level BETWEEN 1 AND 10),
    recovery_status TEXT NOT NULL DEFAULT 'unrecovered' CHECK (recovery_status IN ('unrecovered','partial','recovered')),
    planting_method TEXT, purpose TEXT, appear_chapter_id TEXT, recover_chapter_ids TEXT, character_ids TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
  raw.exec("INSERT INTO novels (id, created_at, updated_at) VALUES ('n-1', '2026-01-01', '2026-01-01');");
  raw.exec("INSERT INTO foreshadows (id, novel_id, surface_action, hidden_truth, attention_level, created_at, updated_at) VALUES ('f-1', 'n-1', '表面', '真相', 4, '2026-01-01', '2026-01-01');");
  raw.exec("PRAGMA user_version = 11;");
  raw.close();

  const db = openDatabase(dbPath);
  expect((db.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(12);
  const columns = (db.query("PRAGMA table_info(foreshadows)").all() as { name: string }[]).map((c) => c.name);
  expect(columns).toContain("act_node_id");
  const row = db.query("SELECT surface_action, hidden_truth, attention_level, act_node_id FROM foreshadows WHERE id = 'f-1';").get() as Record<string, unknown>;
  expect(row.surface_action).toBe("表面");
  expect(row.hidden_truth).toBe("真相");
  expect(row.attention_level).toBe(4);
  expect(row.act_node_id).toBeNull();
  db.close();
  await rm(dir, { recursive: true, force: true });
});
```

`foreshadow-store.test.ts` 追加（沿用文件既有 setup / makeForeshadow 辅助）：

```typescript
describe("act_node_id 与 listUnboundByAct", () => {
  test("addForeshadow 第三参写入 act_node_id，缺省为 null", () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-fs-act-"));
    const store = setup(join(dir, "t.db"));
    const stored = store.addForeshadow(NOVEL_A, makeForeshadow(), "act-node-1");
    expect(stored.actNodeId).toBe("act-node-1");
    expect(store.addForeshadow(NOVEL_A, makeForeshadow({ surfaceAction: "另一处伏笔" })).actNodeId).toBeNull();
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("listUnboundByAct：命中本幕未绑章；排除他幕 / 已绑章 / 无 act", () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-fs-unbound-"));
    const store = setup(join(dir, "t.db"));
    store.addForeshadow(NOVEL_A, makeForeshadow(), "act-1");                                     // 命中
    store.addForeshadow(NOVEL_A, makeForeshadow({ surfaceAction: "已绑章的伏笔", appearChapterId: "ch-1" }), "act-1"); // 已绑章排除
    store.addForeshadow(NOVEL_A, makeForeshadow({ surfaceAction: "他幕的伏笔" }), "act-2");       // 他幕排除
    store.addForeshadow(NOVEL_A, makeForeshadow({ surfaceAction: "无幕的伏笔" }));               // 无 act 排除
    const unbound = store.listUnboundByAct(NOVEL_A, "act-1");
    expect(unbound.map((f) => f.foreshadow.surfaceAction)).toEqual(["老周把主角派去北境送信"]);
    expect(unbound[0]?.actNodeId).toBe("act-1");
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`bun test apps/agent/src/state`——预期 FAIL（SCHEMA_VERSION 仍 11 / actNodeId 属性不存在）。

- [ ] **步骤 3：编写实现**

`db.ts`：
- `const SCHEMA_VERSION = 11;` → `12`；
- 迁移段 `if (version === 10) { ... }` 之后追加：

```typescript
      if (version === 11) {
        // 11→12：foreshadows 增列 act_node_id（埋设幕节点，可空裸列——章节规划按幕圈定回传
        // 未绑章伏笔；SQLite 不支持 ALTER 补外键，一致性由写入方保证，先例 outlines.document_id）
        db.exec("ALTER TABLE foreshadows ADD COLUMN act_node_id TEXT;");
      }
```

- `CREATE TABLE IF NOT EXISTS foreshadows` 的 `appear_chapter_id TEXT,` 之后插一行 `act_node_id TEXT,`；
- 重建兜底分支的注释「>11 的库被旧代码打开」改为「>12 的库被旧代码打开」。

`foreshadow-store.ts`：
- `ForeshadowRow` 增 `act_node_id: string | null;`；`StoredForeshadow` 增 `actNodeId: string | null;`
- `INSERT_SQL` 列清单在 `character_ids` 之后加 `act_node_id`（占位符加一）；两条 SELECT SQL 的列清单末尾加 `act_node_id`；
- `addForeshadow(novelId: string, foreshadow: Foreshadow, actNodeId?: string)`：`.run(id, novelId, ...foreshadowToColumns(validated), actNodeId ?? null, now, now)`；返回对象带 `actNodeId: actNodeId ?? null`；
- `rowToStored` 增 `actNodeId: row.act_node_id`；
- 新增：

```typescript
  /** 某本小说指定幕下「未绑登场章」的伏笔（章节规划回传清单，按入库顺序） */
  listUnboundByAct(novelId: string, actNodeId: string): StoredForeshadow[] {
    const rows = this.db
      .prepare(
        `SELECT id, novel_id, surface_action, hidden_truth, attention_level, recovery_status,
                planting_method, purpose, appear_chapter_id, recover_chapter_ids, character_ids, act_node_id,
                created_at, updated_at
         FROM foreshadows
         WHERE novel_id = ? AND act_node_id = ? AND appear_chapter_id IS NULL
         ORDER BY created_at ASC, id ASC;`,
      )
      .all(novelId, actNodeId) as ForeshadowRow[];
    return rows.map(rowToStored);
  }
```

- [ ] **步骤 4：运行测试验证通过**

运行：`bun test apps/agent/src/state`——预期 PASS（新用例全绿；既有 store / 迁移用例零回归——若既有用例直接构造 12 列 INSERT 则同步适配，报告说明）。

- [ ] **步骤 5：更新 PROGRESS 任务清单**（勾选任务 2，不 commit）

---

### 任务 3：伏笔落地模块 foreshadow-intake

**文件：**
- 创建：`apps/agent/src/workflows/foreshadow-intake.ts`
- 测试（创建）：`apps/agent/src/workflows/foreshadow-intake.test.ts`

- [ ] **步骤 1：编写失败的测试**

新建 `foreshadow-intake.test.ts`（FakeChannel + 临时 SQLite，种子参照 foreshadow-store.test 的 setup 形态：NovelStore 两行 + CharacterStore 角色陈默/老周）：

```typescript
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../state/db";
import { NovelStore } from "../state/novel-store";
import { CharacterStore, type StoredCharacter } from "../state/character-store";
import { ForeshadowStore } from "../state/foreshadow-store";
import { FakeChannel } from "../ui/fake-channel";

const { plantOutlineForeshadows, plantChapterForeshadows, resolveCharacterIds } = await import("./foreshadow-intake");

const NOVEL = "n-foreshadow-1";
let tempDir: string;
afterAll(async () => { if (tempDir) await rm(tempDir, { recursive: true, force: true }); });

const baseItem = {
  surfaceAction: "老周把主角派去北境送信",
  hiddenTruth: "暗示老周已经投敌，借刀除掉主角",
  attentionLevel: 4,
};

describe("resolveCharacterIds", () => {
  const characters = [
    { id: "c-1", name: "陈默" },
    { id: "c-2", name: "老周" },
  ];
  test("trim 全等解析；未解析名单返回；重复名幂等", () => {
    expect(resolveCharacterIds(["陈默", " 老周 ", "无名氏", "陈默"], characters)).toEqual({
      ids: ["c-1", "c-2"],
      unresolved: ["无名氏"],
    });
  });
});

describe("plantOutlineForeshadows", () => {
  test("正常入库绑幕与角色；幕未匹配跳过整条；服务角色全失败跳过、部分失败剔除并警告", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "novel-intake-outline-"));
    const db = openDatabase(join(tempDir, "t.db"));
    new NovelStore(db).createNovel({ id: NOVEL });
    const characterStore = new CharacterStore(db);
    const chen = characterStore.addCharacter(NOVEL, makeCharacter("陈默"));
    const zhou = characterStore.addCharacter(NOVEL, makeCharacter("老周"));
    const characters: StoredCharacter[] = [chen, zhou];
    const store = new ForeshadowStore(db);
    const channel = new FakeChannel([]);
    const actNodes = [
      { id: "act-1", name: "第1幕" },
      { id: "act-2", name: "第2幕" },
    ];

    const result = plantOutlineForeshadows({
      novelId: NOVEL,
      newForeshadows: [
        { ...baseItem, characterNames: ["陈默", "老周"], actName: "第1幕" },
        { ...baseItem, surfaceAction: "幕名漂移的伏笔", characterNames: ["陈默"], actName: "不存在的幕" },
        { ...baseItem, surfaceAction: "角色全失败的伏笔", characterNames: ["无名氏"], actName: "第2幕" },
        { ...baseItem, surfaceAction: "角色部分失败的伏笔", characterNames: ["老周", "路人们"], actName: "第2幕" },
      ],
      characters,
      actNodes,
      channel,
      foreshadowStore: store,
    });

    expect(result).toEqual({ created: 2, skipped: 2 });
    const all = store.listForeshadows(NOVEL);
    expect(all.map((f) => f.foreshadow.surfaceAction)).toEqual([baseItem.surfaceAction, "角色部分失败的伏笔"]);
    expect(all[0]?.actNodeId).toBe("act-1");
    expect(all[0]?.foreshadow.characterIds).toEqual([chen.id, zhou.id]);
    expect(all[0]?.foreshadow.recoveryStatus).toBe("unrecovered");
    expect(all[1]?.foreshadow.characterIds).toEqual([zhou.id]);
    expect(channel.notifies.some((n) => n.includes("幕「不存在的幕」未在大纲中找到"))).toBe(true);
    expect(channel.notifies.some((n) => n.includes("服务角色全部无法解析"))).toBe(true);
    expect(channel.notifies.some((n) => n.includes("未解析服务角色已剔除：路人们"))).toBe(true);
    expect(channel.notifies.some((n) => n.includes("伏笔已入库"))).toBe(true);
    db.close();
  });
});

describe("plantChapterForeshadows", () => {
  test("新伏笔带登场章与幕入库；绑定序号越界/章名未匹配跳过；合法绑定 patch appearChapterId", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "novel-intake-chapter-"));
    const db = openDatabase(join(tempDir, "t.db"));
    new NovelStore(db).createNovel({ id: NOVEL });
    const characterStore = new CharacterStore(db);
    const chen = characterStore.addCharacter(NOVEL, makeCharacter("陈默"));
    const store = new ForeshadowStore(db);
    const channel = new FakeChannel([]);
    const unbound = [
      store.addForeshadow(NOVEL, { ...baseItem, recoveryStatus: "unrecovered" } as never, "act-1"),
      store.addForeshadow(NOVEL, { ...baseItem, surfaceAction: "第二条未绑伏笔", recoveryStatus: "unrecovered" } as never, "act-1"),
    ];
    const chapterNodes = [
      { id: "ch-1", name: "第一章·雨夜" },
      { id: "ch-2", name: "第二章·来客" },
    ];

    const result = plantChapterForeshadows({
      novelId: NOVEL,
      actNodeId: "act-1",
      newForeshadows: [
        { ...baseItem, surfaceAction: "章节新伏笔", characterNames: ["陈默"], chapterName: "第二章·来客" },
        { ...baseItem, surfaceAction: "章名漂移的新伏笔", characterNames: ["陈默"], chapterName: "不存在的章" },
      ],
      bindings: [
        { index: 1, chapterName: "第一章·雨夜" },
        { index: 9, chapterName: "第一章·雨夜" },
        { index: 2, chapterName: "不存在的章" },
      ],
      characters: [chen],
      chapterNodes,
      unbound,
      channel,
      foreshadowStore: store,
    });

    expect(result).toEqual({ created: 1, skipped: 2, bound: 1 });
    const all = store.listForeshadows(NOVEL);
    const createdRow = all.find((f) => f.foreshadow.surfaceAction === "章节新伏笔");
    expect(createdRow?.actNodeId).toBe("act-1");
    expect(createdRow?.foreshadow.appearChapterId).toBe("ch-2");
    expect(createdRow?.foreshadow.characterIds).toEqual([chen.id]);
    expect(store.getForeshadow(unbound[0]!.id)?.foreshadow.appearChapterId).toBe("ch-1");
    expect(store.getForeshadow(unbound[1]!.id)?.foreshadow.appearChapterId).toBeUndefined();
    expect(store.listUnboundByAct(NOVEL, "act-1").map((f) => f.foreshadow.surfaceAction)).toEqual(["第二条未绑伏笔"]);
    expect(channel.notifies.some((n) => n.includes("序号 9 越界"))).toBe(true);
    db.close();
  });
});

function makeCharacter(name: string) {
  return {
    basicInfo: { name },
    core: { desire: `${name}的渴望`, fear: "身份暴露", narrativeRole: "配角" },
    background: "北境边军旧部",
    creationPurpose: "承载伏笔的角色",
    endingDirection: "结局未定",
  };
}
```

- [ ] **步骤 2：运行测试验证失败**

运行：`bun test apps/agent/src/workflows/foreshadow-intake.test.ts`——预期 FAIL（模块不存在）。

- [ ] **步骤 3：编写实现**

新建 `foreshadow-intake.ts`：

```typescript
import type { UiChannel } from "../ui/channel";
import type { StoredCharacter } from "../state/character-store";
import {
  getDefaultForeshadowStore,
  type ForeshadowStore,
  type StoredForeshadow,
} from "../state/foreshadow-store";
import type {
  ChapterNewForeshadow,
  ForeshadowBinding,
  OutlineNewForeshadow,
} from "@novel/shared";

export interface PlantOutlineResult {
  created: number;
  skipped: number;
}

export interface PlantChapterResult {
  created: number;
  skipped: number;
  bound: number;
}

/** 服务角色名 → ID（trim 全等；重复名幂等；未解析名单返回供警告） */
export function resolveCharacterIds(
  names: readonly string[],
  characters: readonly { id: string; name: string }[],
): { ids: string[]; unresolved: string[] } {
  const byName = new Map(characters.map((c) => [c.name.trim(), c.id]));
  const ids: string[] = [];
  const unresolved: string[] = [];
  for (const name of names) {
    const id = byName.get(name.trim());
    if (id === undefined) {
      unresolved.push(name);
    } else if (!ids.includes(id)) {
      ids.push(id);
    }
  }
  return { ids, unresolved };
}

/**
 * 大纲阶段伏笔入库（确定性代码，无 LLM）：幕名→幕节点、服务角色名→ID 逐条解析，
 * 未匹配按策略跳过并经 notify 警告——不阻塞其余条目；回收状态恒为未回收。
 */
export function plantOutlineForeshadows(options: {
  novelId: string;
  newForeshadows: OutlineNewForeshadow[];
  characters: readonly StoredCharacter[];
  actNodes: readonly { id: string; name: string }[];
  channel: UiChannel;
  foreshadowStore?: ForeshadowStore;
}): PlantOutlineResult {
  const store = options.foreshadowStore ?? getDefaultForeshadowStore();
  const characters = options.characters.map((c) => ({ id: c.id, name: c.character.basicInfo.name }));
  let created = 0;
  let skipped = 0;
  for (const item of options.newForeshadows) {
    const act = options.actNodes.find((a) => a.name === item.actName.trim());
    if (!act) {
      options.channel.notify(`⚠️ 伏笔跳过（埋设幕「${item.actName}」未在大纲中找到）：${item.surfaceAction}`);
      skipped += 1;
      continue;
    }
    const { ids, unresolved } = resolveCharacterIds(item.characterNames, characters);
    if (ids.length === 0) {
      options.channel.notify(`⚠️ 伏笔跳过（服务角色全部无法解析：${unresolved.join("、")}）：${item.surfaceAction}`);
      skipped += 1;
      continue;
    }
    if (unresolved.length > 0) {
      options.channel.notify(`⚠️ 伏笔「${item.surfaceAction}」的未解析服务角色已剔除：${unresolved.join("、")}`);
    }
    store.addForeshadow(
      options.novelId,
      {
        surfaceAction: item.surfaceAction,
        hiddenTruth: item.hiddenTruth,
        attentionLevel: item.attentionLevel,
        recoveryStatus: "unrecovered",
        characterIds: ids,
      },
      act.id,
    );
    options.channel.notify(`✨ 伏笔已入库：${item.surfaceAction}（埋设：${act.name}）`);
    created += 1;
  }
  return { created, skipped };
}

/**
 * 章节规划阶段伏笔处理（章节入库后调用）：新伏笔带登场章与幕归属入库；
 * 绑定指令把回传清单中的未绑伏笔 patch 到登场章——序号越界 / 章名未匹配跳过并警告。
 */
export function plantChapterForeshadows(options: {
  novelId: string;
  actNodeId: string;
  newForeshadows: ChapterNewForeshadow[];
  bindings: ForeshadowBinding[];
  characters: readonly StoredCharacter[];
  chapterNodes: readonly { id: string; name: string }[];
  unbound: readonly StoredForeshadow[];
  channel: UiChannel;
  foreshadowStore?: ForeshadowStore;
}): PlantChapterResult {
  const store = options.foreshadowStore ?? getDefaultForeshadowStore();
  const characters = options.characters.map((c) => ({ id: c.id, name: c.character.basicInfo.name }));
  let created = 0;
  let skipped = 0;
  let bound = 0;
  for (const item of options.newForeshadows) {
    const chapter = options.chapterNodes.find((c) => c.name === item.chapterName.trim());
    if (!chapter) {
      options.channel.notify(`⚠️ 新伏笔跳过（登场章「${item.chapterName}」未在本次规划中找到）：${item.surfaceAction}`);
      skipped += 1;
      continue;
    }
    const { ids, unresolved } = resolveCharacterIds(item.characterNames, characters);
    if (ids.length === 0) {
      options.channel.notify(`⚠️ 新伏笔跳过（服务角色全部无法解析：${unresolved.join("、")}）：${item.surfaceAction}`);
      skipped += 1;
      continue;
    }
    if (unresolved.length > 0) {
      options.channel.notify(`⚠️ 伏笔「${item.surfaceAction}」的未解析服务角色已剔除：${unresolved.join("、")}`);
    }
    store.addForeshadow(
      options.novelId,
      {
        surfaceAction: item.surfaceAction,
        hiddenTruth: item.hiddenTruth,
        attentionLevel: item.attentionLevel,
        recoveryStatus: "unrecovered",
        appearChapterId: chapter.id,
        characterIds: ids,
      },
      options.actNodeId,
    );
    options.channel.notify(`✨ 伏笔已入库：${item.surfaceAction}（登场：${chapter.name}）`);
    created += 1;
  }
  for (const binding of options.bindings) {
    const target = options.unbound[binding.index - 1];
    if (!target) {
      options.channel.notify(`⚠️ 伏笔绑定跳过（序号 ${binding.index} 越界，清单共 ${options.unbound.length} 条）`);
      skipped += 1;
      continue;
    }
    const chapter = options.chapterNodes.find((c) => c.name === binding.chapterName.trim());
    if (!chapter) {
      options.channel.notify(`⚠️ 伏笔绑定跳过（登场章「${binding.chapterName}」未在本次规划中找到）：${target.foreshadow.surfaceAction}`);
      skipped += 1;
      continue;
    }
    store.updateForeshadow(target.id, { appearChapterId: chapter.id });
    options.channel.notify(`🔗 伏笔已绑定登场章：${target.foreshadow.surfaceAction}（${chapter.name}）`);
    bound += 1;
  }
  return { created, skipped, bound };
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`bun test apps/agent/src/workflows/foreshadow-intake.test.ts`——预期 PASS。

- [ ] **步骤 5：更新 PROGRESS 任务清单**（勾选任务 3，不 commit）

---

### 任务 4：大纲 Agent——save_outline 伏笔扩展

本任务含两编排**签名机械适配**（fixture 补 `newForeshadows: []`），行为接线在任务 5。

**文件：**
- 修改：`apps/agent/src/workflows/agents/outline-agent.ts`
- 修改：`apps/agent/src/workflows/create-novel.ts` / `regen-outline.ts`（fixture 所在测试文件同步）
- 修改：`apps/agent/src/workflows/create-novel.test.ts` / `regen-outline.test.ts`（fixture）
- 测试：`apps/agent/src/workflows/agents/outline-agent.test.ts`

- [ ] **步骤 1：编写失败的测试**

`outline-agent.test.ts` 的 `saveOutlineInputSchemaFor` describe 内追加：

```typescript
  const outlineFs = { surfaceAction: "送信伏笔", hiddenTruth: "暗示投敌", attentionLevel: 4, characterNames: ["林恒"], actName: "第一幕" };

  test("newForeshadows 缺省省略不合法（必填数组）、空数组合法、完整条目通过", () => {
    expect(() => saveOutlineInputSchemaFor(4, 2).parse(submission)).toThrow(); // submission 不含伏笔字段
    expect(saveOutlineInputSchemaFor(4, 2).parse({ ...submission, newForeshadows: [] }).newForeshadows).toEqual([]);
    expect(saveOutlineInputSchemaFor(4, 2).parse({ ...submission, newForeshadows: [outlineFs] }).newForeshadows).toHaveLength(1);
  });

  test("伏笔清单内表面行为重复被拒绝", () => {
    expect(() =>
      saveOutlineInputSchemaFor(4, 2).parse({
        ...submission,
        newForeshadows: [outlineFs, { ...outlineFs, actName: "第二幕" }],
      }),
    ).toThrow("不得重复");
  });
```

（`submission` 为该 describe 既有常量 `{ ...fourActTwoPartOutline, newCharacters: [...] }`——注意第一条用例断言「缺失被拒」与既有用例冲突时以本用例为准：newForeshadows 为**必填**数组。）

- [ ] **步骤 2：运行测试验证失败**

运行：`bun test apps/agent/src/workflows/agents/outline-agent.test.ts`——预期 FAIL。

- [ ] **步骤 3：编写实现**

`outline-agent.ts`：
- import 增 `outlineNewForeshadowSchema, type OutlineNewForeshadow`（自 `@novel/shared`）；
- `saveOutlineInputSchemaFor` 的 extend 增第二字段（newCharacters 之后）：

```typescript
      newForeshadows: z
        .array(outlineNewForeshadowSchema)
        .refine((list) => new Set(list.map((f) => f.surfaceAction)).size === list.length, "伏笔清单内表面行为不得重复"),
```

- `OutlineSubmission` 增 `newForeshadows: OutlineNewForeshadow[]`；
- `save_outline` execute 解构改 `const { newCharacters, newForeshadows, ...outline } = input;`，确认视图载荷增 `newForeshadows`，`saved = { outline, newCharacters, newForeshadows }`；工具 description 补「+ newForeshadows 伏笔清单」；
- SYSTEM_PROMPT 在「角色梳理要求」段之后插入：

```text
伏笔梳理要求：
1. 某幕的剧情安排中若有伏笔（表面事件背后隐藏着指向后续剧情的真相），将其列入 save_outline 的 newForeshadows：
   - surfaceAction 表面行为（读者可见的表现）、hiddenTruth 隐藏的真相（真正指向的剧情）、attentionLevel 读者注意度 1-10（1 最易发现，10 最难发现）；
   - characterNames 服务角色名（可引用角色库或 newCharacters 清单中的名字，必须真实存在）；
   - actName 埋设幕名（必须是本大纲中真实的幕名）；
2. 伏笔挂幕不挂章（章节尚不存在，登场章在后续章节规划时绑定）；
3. 清单内 surfaceAction 不得重复；newForeshadows 会在确认时随大纲一并展示，确认后自动入库。
```

- `continuationHint` 补「与 newCharacters / newForeshadows 清单」；
- 两编排调用处不动（`submission.outline` / 解构已兼容），两集成测试 fixture 的 save_outline 入参各补 `newForeshadows: []`（create-novel.test.ts 的 outlineFixture、regen-outline.test.ts 的 newOutlineFixture 返回骨架）。

- [ ] **步骤 4：运行测试验证通过**

运行：`bun test apps/agent/src/workflows/agents/outline-agent.test.ts && bun test apps/agent/src/workflows`——预期 PASS，既有用例零回归。

- [ ] **步骤 5：更新 PROGRESS 任务清单**（勾选任务 4，不 commit）

---

### 任务 5：大纲两编排接入伏笔入库

**文件：**
- 修改：`apps/agent/src/workflows/create-novel.ts`、`regen-outline.ts`
- 测试：`create-novel.test.ts`、`regen-outline.test.ts`

- [ ] **步骤 1：编写失败的测试**

`create-novel.test.ts`：`outlineFixture` 的 `newForeshadows` 由 `[]` 改为两条（一条幕名与 fixture 幕名「第1幕」匹配、一条幕名漂移）：

```typescript
  newForeshadows: [
    { surfaceAction: "宗主赐下断脉散", hiddenTruth: "药中掺了追踪灵脉的蛊种", attentionLevel: 6, characterNames: ["林恒", "萧无咎"], actName: "第1幕" },
    { surfaceAction: "幕名漂移的伏笔", hiddenTruth: "不会入库", attentionLevel: 3, characterNames: ["林恒"], actName: "不存在的幕" },
  ],
```

断言追加（持久化区）：

```typescript
    // 大纲伏笔入库：幕名匹配的入库（角色 ID 解析自林恒+自动入库的萧无咎），幕名漂移的跳过
    const foreshadowStore = new ForeshadowStore(db);
    const all = foreshadowStore.listForeshadows(state.id);
    expect(all.map((f) => f.foreshadow.surfaceAction)).toEqual(["宗主赐下断脉散"]);
    const fsRow = all[0]!;
    const ids = characterStore2.listCharacters(state.id).map((c) => c.id);
    expect(fsRow.foreshadow.characterIds).toEqual(ids); // 林恒、萧无咎按入库顺序
    expect(fsRow.foreshadow.recoveryStatus).toBe("unrecovered");
    expect(fsRow.actNodeId).toBeDefined();
    const actNode = new OutlineStore(db).listOutlineNodes(state.id, { currentOnly: true }).find((n) => n.node.name === "第1幕");
    expect(fsRow.actNodeId).toBe(actNode?.id);
    expect(channel.notifies.some((n) => n.includes("大纲安排了 2 处伏笔"))).toBe(true);
    expect(channel.notifies.some((n) => n.includes("本次大纲伏笔已入库 1 处（1 处因幕名/角色名未匹配跳过）"))).toBe(true);
```

`regen-outline.test.ts`：主流程用例的 `newOutlineFixture` 透传 `newForeshadows: [{ surfaceAction: "新版伏笔", hiddenTruth: "新真相", attentionLevel: 5, characterNames: ["林恒"], actName: "第1幕" }]`（fixture 工厂已有可选参先例——增第五可选参），断言 `foreshadowStore.listForeshadows(NOVEL_ID)` 含该行且 `actNodeId` 为新版第 1 幕节点 ID。

- [ ] **步骤 2：运行测试验证失败**

运行：`bun test apps/agent/src/workflows/create-novel.test.ts && bun test apps/agent/src/workflows/regen-outline.test.ts`——预期 FAIL（无伏笔入库）。

- [ ] **步骤 3：编写实现**

`create-novel.ts`：import 增 `plantOutlineForeshadows`（`./foreshadow-intake`）与 `getDefaultForeshadowStore, type ForeshadowStore`；`CreateNovelOptions` 增 `foreshadowStore?: ForeshadowStore`，函数体增 `const foreshadowStore = options.foreshadowStore ?? getDefaultForeshadowStore();`；角色自动入库块**之后**、完成 notify 之前插入：

```typescript
  // 大纲伏笔入库：确定性代码创建（角色已入库，服务角色名可解析）；幕名/角色名未匹配逐条跳过并警告
  if (submission.newForeshadows.length > 0) {
    channel.notify(`\n✨ 大纲安排了 ${submission.newForeshadows.length} 处伏笔，正在入库…`);
    const actNodes = outlineStore
      .listOutlineNodes(id, { currentOnly: true })
      .filter((n) => n.node.type === "act")
      .map((n) => ({ id: n.id, name: n.node.name }));
    const { created, skipped } = plantOutlineForeshadows({
      novelId: id,
      newForeshadows: submission.newForeshadows,
      characters: characterStore.listCharacters(id),
      actNodes,
      channel,
      foreshadowStore,
    });
    channel.notify(
      `✨ 本次大纲伏笔已入库 ${created} 处${skipped > 0 ? `（${skipped} 处因幕名/角色名未匹配跳过）` : ""}`,
    );
  }
```

`regen-outline.ts` 同构：`RegenOutlineOptions` 增 `foreshadowStore?`；在角色自动入库块之后（`return` 之前）插入同款块（notify 前缀「新版大纲安排了」/汇总「本次大纲伏笔已入库」；actNodes 取 `saveOutlineTreeNewVersion` 之后的当前版本树）。

- [ ] **步骤 4：运行测试验证通过**

运行：`bun test apps/agent/src/workflows/create-novel.test.ts && bun test apps/agent/src/workflows/regen-outline.test.ts`——预期 PASS。

- [ ] **步骤 5：更新 PROGRESS 任务清单**（勾选任务 5，不 commit）

---

### 任务 6：章节 Agent——伏笔回传与 save_chapters 扩展

本任务含 `plan-act-chapters.ts` fixture 机械适配（`newForeshadows: []` / `foreshadowBindings: []`），行为接线在任务 7。

**文件：**
- 修改：`apps/agent/src/workflows/agents/chapter-agent.ts`
- 修改：`apps/agent/src/workflows/plan-act-chapters.test.ts`（fixture）
- 测试：`apps/agent/src/workflows/agents/chapter-agent.test.ts`

- [ ] **步骤 1：编写失败的测试**

`chapter-agent.test.ts` 的 `saveChaptersInputSchema` describe 内追加：

```typescript
  const chapterFs = { surfaceAction: "送信伏笔", hiddenTruth: "暗示投敌", attentionLevel: 4, characterNames: ["林恒"], chapterName: "第一章·雨夜" };

  test("newForeshadows 与 foreshadowBindings 均必填数组，空数组合法，完整条目通过", () => {
    const base = { ...threeChapterPlan, newCharacters: [] };
    expect(() => saveChaptersInputSchema.parse(base)).toThrow();
    const parsed = saveChaptersInputSchema.parse({ ...base, newForeshadows: [], foreshadowBindings: [] });
    expect(parsed.newForeshadows).toEqual([]);
    expect(
      saveChaptersInputSchema.parse({ ...base, newForeshadows: [chapterFs], foreshadowBindings: [{ index: 1, chapterName: "第一章·雨夜" }] }).foreshadowBindings,
    ).toHaveLength(1);
  });

  test("伏笔清单内表面行为重复被拒绝；绑定指令内序号重复被拒绝", () => {
    const base = { ...threeChapterPlan, newCharacters: [], foreshadowBindings: [] as never[] };
    expect(() => saveChaptersInputSchema.parse({ ...base, newForeshadows: [chapterFs, chapterFs] })).toThrow("不得重复");
    expect(() =>
      saveChaptersInputSchema.parse({
        ...base,
        newForeshadows: [],
        foreshadowBindings: [
          { index: 1, chapterName: "第一章·雨夜" },
          { index: 1, chapterName: "第二章·来客" },
        ],
      }),
    ).toThrow("不得重复");
  });
```

- [ ] **步骤 2：运行测试验证失败**

运行：`bun test apps/agent/src/workflows/agents/chapter-agent.test.ts`——预期 FAIL。

- [ ] **步骤 3：编写实现**

`chapter-agent.ts`：
- import 增 `chapterNewForeshadowSchema, foreshadowBindingSchema, type ChapterNewForeshadow, type ForeshadowBinding`（`@novel/shared`）与 `type StoredForeshadow`（`../../state/foreshadow-store`）；
- `PlanChaptersAgentOptions` 增：

```typescript
  /** 本幕「未绑登场章」的伏笔（编排层查好传入；有则带序号回传给 LLM 供绑定登场章） */
  unboundForeshadows?: readonly StoredForeshadow[];
```

- `saveChaptersInputSchema` extend 增两字段（newCharacters 之后）：

```typescript
  newForeshadows: z
    .array(chapterNewForeshadowSchema)
    .refine((list) => new Set(list.map((f) => f.surfaceAction)).size === list.length, "伏笔清单内表面行为不得重复"),
  foreshadowBindings: z
    .array(foreshadowBindingSchema)
    .refine((list) => new Set(list.map((b) => b.index)).size === list.length, "伏笔绑定指令内序号不得重复"),
```

- `ChapterPlanSubmission` 增 `newForeshadows: ChapterNewForeshadow[]` 与 `foreshadowBindings: ForeshadowBinding[]`；execute 解构 `const { newCharacters, newForeshadows, foreshadowBindings, ...plan } = inputPlan;`，视图载荷带两组，`saved` 记录四项；工具 description 补「+ newForeshadows 新伏笔与 foreshadowBindings 绑定」；
- prompt 数组在「角色库已有角色」行之后条件插入（`options.unboundForeshadows` 非空时）：

```typescript
      ...(options.unboundForeshadows && options.unboundForeshadows.length > 0
        ? [
            `本幕未绑登场章的伏笔（序号. 表面行为——隐藏真相）：\n${options.unboundForeshadows
              .map((f, i) => `${i + 1}. ${f.foreshadow.surfaceAction}——${f.foreshadow.hiddenTruth}`)
              .join("\n")}`,
          ]
        : []),
```

- SYSTEM_PROMPT 在「角色梳理要求」段之后插入：

```text
伏笔梳理要求：
1. 若「本幕未绑登场章的伏笔」清单中的伏笔会在你规划的章节中出现，必须在 foreshadowBindings 中输出绑定（index = 清单序号，chapterName = 登场章名——必须是本次规划中的真实章名）；不在本幕出现的伏笔不要绑定；
2. 规划中发现新的伏笔时列入 newForeshadows（surfaceAction / hiddenTruth / attentionLevel 1-10 / characterNames 服务角色名 / chapterName 登场章名）；
3. 章节概述尽量体现伏笔的表面行为，让正文写作有据可依；
4. 两组清单内 surfaceAction / 序号均不得重复；确认后新伏笔自动入库、绑定自动生效。
```

- `continuationHint` 补「与 newCharacters / newForeshadows / foreshadowBindings 清单」；
- `plan-act-chapters.test.ts` 的 `chapterPlanFixture` 补 `newForeshadows: [], foreshadowBindings: []`。

- [ ] **步骤 4：运行测试验证通过**

运行：`bun test apps/agent/src/workflows/agents/chapter-agent.test.ts && bun test apps/agent/src/workflows`——预期 PASS 零回归。

- [ ] **步骤 5：更新 PROGRESS 任务清单**（勾选任务 6，不 commit）

---

### 任务 7：章节编排接入——回传与确认后创建绑定

**文件：**
- 修改：`apps/agent/src/workflows/plan-act-chapters.ts`
- 测试：`apps/agent/src/workflows/plan-act-chapters.test.ts`

- [ ] **步骤 1：编写失败的测试**

`plan-act-chapters.test.ts`：

(a) `Seeded` 增 `foreshadowStore: ForeshadowStore`，`seed()` 建库后追加：

```typescript
  const foreshadowStore = new ForeshadowStore(db);
```

（默认不种伏笔；需要伏笔的用例显式种。全部既有调用点补注入 `foreshadowStore: world.foreshadowStore`。）

(b) 主流程用例改造：seed 后种一条挂第 2 幕的未绑伏笔（服务角色需 seed 角色——`seed()` 增角色：`new CharacterStore(db).addCharacter(NOVEL_ID, { basicInfo: { name: "林恒" }, core: { desire: "夺脉", fear: "失败", narrativeRole: "主角" }, background: "散修", creationPurpose: "主线", endingDirection: "归隐" })`，注意外键顺序——novels 已建）；textScript save_chapters 轮入参改为：

```typescript
    const seededFs = world.foreshadowStore.addForeshadow(
      NOVEL_ID,
      {
        surfaceAction: "宗主赐下断脉散",
        hiddenTruth: "药中掺了追踪灵脉的蛊种",
        attentionLevel: 6,
        recoveryStatus: "unrecovered",
      },
      secondAct.id,
    );
    textScript = [
      [[{
        tool: "save_chapters",
        args: {
          ...chapterPlanFixture,
          newCharacters: [{ name: "萧无咎", role: "第2章登场·血宗宗主" }],
          newForeshadows: [{ surfaceAction: "来客留下半块玉佩", hiddenTruth: "玉佩是主角身世信物", attentionLevel: 5, characterNames: ["林恒"], chapterName: "第二章·来客" }],
          foreshadowBindings: [{ index: 1, chapterName: "第一章·雨夜" }],
        },
      }]],
      [[{ tool: "save_character", args: autoCard }]],
    ];
```

断言追加：

```typescript
    // 伏笔：新伏笔带登场章与幕入库；既有未绑伏笔绑定第一章
    const fs = world.foreshadowStore.listForeshadows(NOVEL_ID);
    const created = fs.find((f) => f.foreshadow.surfaceAction === "来客留下半块玉佩");
    const chapterIds = world.outlineStore.listOutlineNodes(NOVEL_ID).filter((n) => n.node.type === "chapter");
    expect(created?.foreshadow.appearChapterId).toBe(chapterIds.find((n) => n.node.name === "第二章·来客")?.id);
    expect(created?.actNodeId).toBe(secondAct.id);
    expect(world.foreshadowStore.getForeshadow(seededFs.id)?.foreshadow.appearChapterId).toBe(chapterIds.find((n) => n.node.name === "第一章·雨夜")?.id);
    expect(channel.notifies.some((n) => n.includes("本次规划伏笔入库 1 处、绑定 1 处"))).toBe(true);
```

(c) 新增用例「本幕无伏笔且规划未引入：跳过伏笔处理（零额外调用）」：fixture 全空清单，断言 notifies 无「伏笔」字样、foreshadows 表零行。

- [ ] **步骤 2：运行测试验证失败**

运行：`bun test apps/agent/src/workflows/plan-act-chapters.test.ts`——预期 FAIL。

- [ ] **步骤 3：编写实现**

`plan-act-chapters.ts`：import 增 `plantChapterForeshadows` 与 `getDefaultForeshadowStore, type ForeshadowStore`；`PlanActChaptersOptions` 增 `foreshadowStore?`，函数体增缺省；世界观校验后查回传清单：

```typescript
  const unboundForeshadows = foreshadowStore.listUnboundByAct(novelId, act.id);
```

`planChapters` 调用 options 增 `unboundForeshadows`；解构改 `const { plan, newCharacters, newForeshadows, foreshadowBindings } = ...`；角色自动入库块之后、`return` 之前插入：

```typescript
  // 伏笔处理：新伏笔带登场章与幕入库、既有未绑伏笔按 LLM 绑定指令 patch（确定性代码）
  if (newForeshadows.length > 0 || foreshadowBindings.length > 0) {
    channel.notify(`\n✨ 本幕伏笔处理中：新增 ${newForeshadows.length} 处、绑定 ${foreshadowBindings.length} 处…`);
    const chapterNodeRefs = chapterNodes.map((n) => ({ id: n.id, name: n.node.name }));
    const { created, skipped, bound } = plantChapterForeshadows({
      novelId,
      actNodeId: act.id,
      newForeshadows,
      bindings: foreshadowBindings,
      characters: characterStore.listCharacters(novelId),
      chapterNodes: chapterNodeRefs,
      unbound: unboundForeshadows,
      channel,
      foreshadowStore,
    });
    channel.notify(
      `✨ 本次规划伏笔入库 ${created} 处、绑定 ${bound} 处${skipped > 0 ? `（${skipped} 处未匹配跳过）` : ""}`,
    );
  }
```

（docstring 补伏笔回传与确认后处理一句；`PlanActChaptersResult` 不变。）

- [ ] **步骤 4：运行测试验证通过**

运行：`bun test apps/agent/src/workflows/plan-act-chapters.test.ts`——预期 PASS。

- [ ] **步骤 5：更新 PROGRESS 任务清单**（勾选任务 7，不 commit）

---

### 任务 8：双端渲染联动

**文件：**
- 修改：`apps/agent/src/ui/cli-channel.ts`、`apps/client/src/components/ViewCard.tsx`
- 测试：`apps/agent/src/ui/cli-channel.test.ts`

- [ ] **步骤 1：编写失败的测试**

`cli-channel.test.ts` 追加：

```typescript
test("outline confirm：携带 newForeshadows 时渲染伏笔区块，缺失不渲染", () => {
  const withFs = renderView({
    kind: "outline", detail: "confirm", outline,
    newForeshadows: [{ surfaceAction: "送信伏笔", hiddenTruth: "暗示投敌", attentionLevel: 4, characterNames: ["林恒"], actName: "第一幕" }],
  } as never);
  expect(withFs).toContain("本次大纲伏笔");
  expect(withFs).toContain("[第一幕] 送信伏笔");
  expect(renderView({ kind: "outline", detail: "confirm", outline } as never)).not.toContain("本次大纲伏笔");
});

test("chapter-plan：携带 newForeshadows / foreshadowBindings 时渲染两区块，缺失不渲染", () => {
  const view = {
    kind: "chapter-plan", actName: "第2幕", actSummary: "梗概", keyPlotPoints: ["情节点"],
    plan: { chapters: [{ name: "第一章·雨夜", summary: "概述" }] },
    newForeshadows: [{ surfaceAction: "送信伏笔", hiddenTruth: "暗示投敌", attentionLevel: 4, characterNames: ["林恒"], chapterName: "第一章·雨夜" }],
    foreshadowBindings: [{ index: 1, chapterName: "第一章·雨夜" }],
  };
  const rendered = renderView(view as never);
  expect(rendered).toContain("本次规划新增伏笔");
  expect(rendered).toContain("送信伏笔");
  expect(rendered).toContain("伏笔绑定");
  expect(rendered).toContain("1) 送信伏笔 → 第一章·雨夜");
  expect(renderView({ ...view, newForeshadows: undefined, foreshadowBindings: undefined } as never)).not.toContain("伏笔");
});
```

（outline 常量为该文件既有的 `outline` fixture；绑定区块渲染格式「`序号) 表面行为 → 章名`」——回传清单未随视图携带，渲染用序号+章名即可。）

- [ ] **步骤 2：运行测试验证失败**

运行：`bun test apps/agent/src/ui/cli-channel.test.ts`——预期 FAIL。

- [ ] **步骤 3：编写实现**

`cli-channel.ts`：
- `renderView` outline confirm 分支改 `formatOutlineForConfirm(view.outline, view.newCharacters, view.newForeshadows)`，chapter-plan 分支改 `formatChapterPlan(view, view.newCharacters, view.newForeshadows, view.foreshadowBindings)`；import 增两类型 `OutlineNewForeshadow` / `ChapterNewForeshadow` / `ForeshadowBinding`；
- `formatOutlineForConfirm` 增第三可选参，newCharacters 区块之后追加：

```typescript
  if (newForeshadows && newForeshadows.length > 0) {
    lines.push(`  ✨ 本次大纲伏笔（确认后自动入库）：`);
    for (const f of newForeshadows) {
      lines.push(`    · [${f.actName}] ${f.surfaceAction} ⇢ ${f.hiddenTruth}（注意度 ${f.attentionLevel}，服务：${f.characterNames.join("、")}）`);
    }
  }
```

- `formatChapterPlan` 增两可选参，newCharacters 区块之后追加：

```typescript
  if (newForeshadows && newForeshadows.length > 0) {
    lines.push(`  ✨ 本次规划新增伏笔（确认后自动入库）：`);
    for (const f of newForeshadows) {
      lines.push(`    · [${f.chapterName}] ${f.surfaceAction} ⇢ ${f.hiddenTruth}（注意度 ${f.attentionLevel}，服务：${f.characterNames.join("、")}）`);
    }
  }
  if (foreshadowBindings && foreshadowBindings.length > 0) {
    lines.push(`  🔗 伏笔绑定（确认后生效）：`);
    for (const b of foreshadowBindings) {
      lines.push(`    ${b.index}) → ${b.chapterName}`);
    }
  }
```

（测试断言「1) 送信伏笔 → 第一章·雨夜」与渲染「`${b.index}) → ${b.chapterName}`」不一致——以测试断言为准，渲染行改为 `${b.index}) 第${b.index}号伏笔 → ${b.chapterName}` 也不含「送信伏笔」；**实现采用**：绑定区块渲染需要伏笔表面行为，而视图未携带回传清单——因此 chapter-plan 确认视图的 `foreshadowBindings` 渲染为 `${b.index}) → ${b.chapterName}`，测试断言相应改为 `toContain("1) → 第一章·雨夜")`。以本括号说明为准，勿照抄上方测试中的「送信伏笔 →」断言。）

`ViewCard.tsx`：outline 分支 newCharacters 区块之后、chapter-plan 分支 newCharacters 区块之后，分别追加同内容 JSX（`.part-name` 标题 + `.act` 行；chapter-plan 绑定区块 `.plot` 行 `${index}) → ${chapterName}`；条件渲染缺失或空不渲染）。

- [ ] **步骤 4：运行测试验证通过**

运行：`bun test apps/agent/src/ui/cli-channel.test.ts && bun run typecheck`——预期 PASS。

- [ ] **步骤 5：更新 PROGRESS 任务清单**（勾选任务 8，不 commit）

---

### 任务 9：全量校验 + 真实库迁移实跑 + 文档同步 + 提交

**文件：**
- 修改：`AGENTS.md`、根 `ARCHITECTURE.md` / `DECISIONS.md`、根与模块 `PROGRESS.md`、`workflows/ARCHITECTURE.md`

- [ ] **步骤 1：全量工程校验**

运行：`bun run typecheck && bun run lint && bun run test`——预期 100% 通过（基线 243 + 净增用例）。

- [ ] **步骤 2：真实库副本迁移实跑（不动真实库）**

```bash
cp data/novel.db /tmp/novel-v12-check.db && \
NOVEL_DB_PATH=/tmp/novel-v12-check.db bun -e "import {openDatabase} from './apps/agent/src/state/db'; const db = openDatabase(); console.log(db.query('PRAGMA user_version').get()); console.log(db.query('PRAGMA table_info(foreshadows)').all().map(c=>c.name).includes('act_node_id')); db.close();"
rm /tmp/novel-v12-check.db
```

预期输出 `{"user_version":12}` 与 `true`；再抽一行既有数据核实无损。**绝不直接对 `data/novel.db` 跑迁移。**

- [ ] **步骤 3：文档同步**

- `AGENTS.md`：大纲与章节规划流程描述补伏笔链路；workflows 条目补 foreshadow-intake；shared 条目补新 schema。
- 根 `ARCHITECTURE.md`：主工作流 / regen 工作流 / 单幕章节规划工作流补伏笔段；文件树补 foreshadow-intake.ts；foreshadows 表描述补 `act_node_id` 与「创作流采集已接入（大纲与章节规划）」。
- 根 `DECISIONS.md`：追加 2026-10-06 决策——act 列精确圈定 vs 全量回传、未解析名跳过策略、regen 保留旧伏笔、伏笔无需 LLM Agent（与角色链路的差异论证）。
- 根与模块 `PROGRESS.md`：进行中清单归一为完成总结（最近 5 条滚动归档；AC 含全量校验、迁移实跑、真实 LLM 待复验步骤）。
- `workflows/ARCHITECTURE.md`：文件树补 foreshadow-intake；两条数据流补伏笔段；依赖边界（两编排 + plan-act-chapters 增 foreshadow-store / foreshadow-intake 依赖）。

- [ ] **步骤 4：提交**

```bash
git add -A
git commit -m "docs: 伏笔接入需求同步入口/架构/进度/决策文档"
```

---

## 自检记录（编写时已执行）

1. **规格覆盖度**：§3.1→任务 1；§3.2→任务 2；§3.3→任务 3；§3.4/3.5→任务 4/5；§3.6/3.7→任务 6/7；§3.8→任务 8；§4 边界各支路落在任务 3/5/7 测试；§5 测试计划逐一对应；§6→任务 9。无遗漏。
2. **占位符扫描**：无待定/TODO/「类似任务 N」；每个代码步骤有完整代码块（任务 8 步骤 3 内含一处对测试断言的显式修正说明，非占位符）。
3. **类型一致性**：`newForeshadowSchema` 三变体 / `foreshadowBindingSchema` / `plantOutlineForeshadows` / `plantChapterForeshadows` / `resolveCharacterIds` / `addForeshadow(novelId, foreshadow, actNodeId?)` / `listUnboundByAct` / `StoredForeshadow.actNodeId` 命名全计划一致；两 Agent 的 `OutlineSubmission` / `ChapterPlanSubmission` 扩展与既有字段并存；机械适配点（任务 4/6 的 fixture）显式列出。

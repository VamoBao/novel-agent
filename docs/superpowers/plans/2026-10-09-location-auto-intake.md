# 大纲与章节规划地点自动入库 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。
> **项目约定覆盖**：按 `docs/feature-check-guide.md`，拆分任务不单独 commit；每任务以校验闭环收尾，全部完成后 T8 统一原子提交（规格 / 计划文档各自独立 docs 提交）。

**目标：** 大纲（新建 + 重生成）与单幕章节规划确认后，自动把「库内没有的地点」（名字 + 一句话定位）确定性入库，并在客户端结构树 / 右栏只读卡可见。

**架构：** 对齐角色 / 伏笔的「清单连带确认 → 确认后自动执行」模式——两 Agent 经 `save_outline` / `save_chapters` 结构化入参附 `newLocations` 清单进确认门；确认后编排层 `filterNewLocations` 兜底 diff + `plantNewLocations` 确定性入库（无 LLM）；schema 演进（x/y/layer 放宽可选 + 新增 description，SCHEMA_VERSION 12→13）；query 契约与客户端补最小展示。

**技术栈：** Bun 1.4 + TypeScript 6（strict）、zod 4、Vercel AI SDK 7（`tool()`）、`bun:sqlite`、React 19（renderer）、`bun:test`。

**规格：** `docs/superpowers/specs/2026-10-09-location-auto-intake-design.md`

---

### 任务 1：shared——locationSchema 演进 + newLocationSchema + 视图/查询契约

**文件：**
- 修改：`packages/shared/src/location.ts`
- 修改：`packages/shared/src/views.ts`（两视图 schema 增可选 newLocations）
- 修改：`packages/shared/src/query.ts`（locationEntrySchema + novelDetail.locations）
- 修改：`packages/shared/src/index.ts`（补导出）
- 测试：`packages/shared/src/index.test.ts`

- [ ] **步骤 1：编写失败的测试**（index.test.ts 追加，对齐既有 describe 风格）

```ts
describe("locationSchema 演进（12→13：坐标放宽可选 + description）", () => {
  test("仅名字+定位（自动入库形态）通过；可选字段缺省不携带", () => {
    const loc = locationSchema.parse({ name: "青云城", description: "东部边境要塞·主角初战的战场" });
    expect(loc.name).toBe("青云城");
    expect("x" in loc).toBe(false);
    expect("y" in loc).toBe(false);
    expect("layer" in loc).toBe(false);
  });

  test("全字段（旧地图形态）仍通过；名字空串与空定位被拒绝", () => {
    expect(() =>
      locationSchema.parse({ name: "北境大陆", description: "x", x: 1.5, y: 2.5, layer: "地面", population: 3000 }),
    ).not.toThrow();
    expect(() => locationSchema.parse({ name: "", description: "x" })).toThrow();
    expect(() => locationSchema.parse({ name: "青云城", description: "" })).toThrow();
  });

  test("newLocationSchema：名字+一句话定位通过，缺定位被拒绝", () => {
    expect(newLocationSchema.parse({ name: "青云城", description: "东部边境要塞" })).toEqual({
      name: "青云城",
      description: "东部边境要塞",
    });
    expect(() => newLocationSchema.parse({ name: "青云城" })).toThrow();
  });
});

describe("视图与查询契约接入地点", () => {
  const loc = { name: "青云城", description: "东部边境要塞" };

  test("outline / chapter-plan 确认视图携带 newLocations 解析通过；不带（旧消息）也通过", () => {
    const outlineView = { kind: "outline", detail: "confirm", outline: minimalOutline, newLocations: [loc] };
    expect(viewSchema.parse(outlineView).newLocations).toHaveLength(1);
    expect(viewSchema.parse({ ...outlineView, newLocations: undefined })).not.toHaveProperty("newLocations");
    const planView = { kind: "chapter-plan", actName: "第一幕", actSummary: "梗概", keyPlotPoints: ["点1"],
      plan: minimalPlan, newLocations: [loc] };
    expect(viewSchema.parse(planView).newLocations).toHaveLength(1);
  });

  test("locationEntrySchema 与 novelDetail.locations 契约", () => {
    const entry = locationEntrySchema.parse({ id: "loc-1", name: "青云城", description: "要塞" });
    expect(entry.id).toBe("loc-1");
    // novelDetail 增 locations 数组：最小详情（其余字段对齐既有用例构造）解析通过
    expect(novelDetailSchema.shape.locations).toBeDefined();
  });
});
```

（`minimalOutline` / `minimalPlan` 复用该文件既有的最小 outline / plan fixture；若文件中尚无，按 `outlineSchema` / `chapterPlanSchema` 最小合规形态就地构造。）

- [ ] **步骤 2：运行测试验证失败**

运行：`bun test packages/shared`
预期：FAIL——`newLocationSchema` / `locationEntrySchema` 未导出、locationSchema 拒绝无 x/y/layer 形态。

- [ ] **步骤 3：实现 location.ts**

```ts
import { z } from "zod";

/**
 * 位置 schema：小说世界里的地理位置。
 *
 * 字段一览：
 * - name 名称：如 xx大陆、xx城
 * - description 定位：一句话定位（如「东部边境要塞·主角初战的战场」）；
 *   大纲 / 章节规划自动入库时携带，未设定缺省
 * - x / y 坐标：小说世界平面坐标（横 / 纵），浮点数——地图向字段，未设定缺省
 *   （自动入库不产生，留给未来地图功能编辑）
 * - layer 图层：纵向位置（如天上、地面、地底），自由文本——架空世界可能有
 *   「深渊层」「星界」等，不做枚举约束；未设定缺省
 * - population 人口：该地点主要物种的数量（不一定是人）；无人 / 未设定缺省
 * - parentId 父级：父级位置 ID（如某城市的父级是某片大陆）；顶级位置缺省
 */
export const locationSchema = z.object({
  name: z.string().min(1).describe("位置名称，如 xx大陆、xx城"),
  description: z.string().min(1).optional().describe("一句话定位；大纲/章节规划自动入库携带，未设定缺省"),
  x: z.number().optional().describe("横坐标（小说世界平面坐标）；未设定缺省"),
  y: z.number().optional().describe("纵坐标（小说世界平面坐标）；未设定缺省"),
  layer: z.string().min(1).optional().describe("图层：纵向位置，如天上、地面、地底；未设定缺省"),
  population: z.number().int().min(0).optional().describe("主要物种数量；无人 / 未设定缺省"),
  parentId: z.string().min(1).optional().describe("父级位置 ID；顶级位置（如大陆）缺省"),
});

export type Location = z.infer<typeof locationSchema>;

/** 大纲 / 章节规划回传的「新增地点」清单项：名字 + 一句话定位（对齐 newCharacterSchema 的 name+role 形态） */
export const newLocationSchema = z.object({
  name: z.string().min(1).describe("地点名称，如 北境大陆、青云城"),
  description: z.string().min(1).describe("该地点在大纲/规划中的一句话定位，如「东部边境要塞·主角初战的战场」"),
});

export type NewLocation = z.infer<typeof newLocationSchema>;
```

- [ ] **步骤 4：views.ts / query.ts / index.ts 接线**

views.ts——import 增 `newLocationSchema`（`from "./location"`）；`outlineViewSchema` 在 newForeshadows 后加：

```ts
  /** 确认门携带的新增地点清单（名字+一句话定位）；旧消息不带 */
  newLocations: z.array(newLocationSchema).optional(),
```

`chapterPlanViewSchema` 在 foreshadowBindings 后加同款（注释改「确认门携带的新增地点清单」）。

query.ts——import 增 `locationSchema`（`from "./location"`）；foreshadowEntrySchema 之后加：

```ts
/** 地点条目：locations 表当前行（按入库顺序）；description 与坐标等可选字段未设定时缺省不携带 */
export const locationEntrySchema = locationSchema.extend({
  id: z.string().min(1).describe("locations 表主键（UUIDv7）"),
});
export type LocationEntry = z.infer<typeof locationEntrySchema>;
```

`novelDetailSchema` 在 foreshadows 之后加：

```ts
  locations: z
    .array(locationEntrySchema)
    .describe("全部地点（按入库顺序，未生成为空数组；结构树地点组取用）"),
```

index.ts——location 导出行扩为 `export { locationSchema, newLocationSchema, type Location, type NewLocation } from "./location";`；query 导出块补 `locationEntrySchema` 与 `type LocationEntry`。

- [ ] **步骤 5：运行测试验证通过**

运行：`bun test packages/shared`
预期：PASS（既有用例零回归——所有旧 location 用例带全字段，可选化不破坏）。

---

### 任务 2：数据层——SCHEMA_VERSION 13 + locations 表重建迁移 + LocationStore 适配

**文件：**
- 修改：`apps/agent/src/state/db.ts`（版本 13、迁移段、基线 DDL、头注释）
- 修改：`apps/agent/src/state/location-store.ts`（行结构 / SQL / rowToLocation 适配）
- 测试：`apps/agent/src/state/db.test.ts`（新增 12→13 用例 + 既有 user_version 断言 12→13）
- 测试：`apps/agent/src/state/location-store.test.ts`（无坐标两态往返用例）

- [ ] **步骤 1：编写失败的测试**

db.test.ts——新增迁移用例（放在既有 v9/v11 迁移用例之后）：

```ts
test("v12 库升 13：locations 重建——description 列落地、x/y/layer 可空、存量数据无损", async () => {
  const dir = await mkdtemp(join(tmpdir(), "novel-db-mig12-"));
  tempDirs.push(dir);
  const dbPath = join(dir, "v12.db");
  // 手工构造 v12 形态：novels + 旧形态 locations（x/y/layer NOT NULL、无 description）
  const legacy = new Database(dbPath, { create: true });
  legacy.exec("PRAGMA foreign_keys = ON;");
  legacy.exec(`
    CREATE TABLE novels (
      id TEXT PRIMARY KEY, name TEXT, author TEXT, description TEXT,
      pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
      favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `);
  legacy.exec(`
    CREATE TABLE locations (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL REFERENCES novels(id),
      parent_id TEXT REFERENCES locations(id),
      name TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      layer TEXT NOT NULL,
      population INTEGER CHECK (population IS NULL OR population >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  legacy.exec("CREATE INDEX idx_locations_novel_id ON locations(novel_id);");
  legacy.exec("CREATE INDEX idx_locations_parent_id ON locations(parent_id);");
  legacy.prepare("INSERT INTO novels (id, name, created_at, updated_at) VALUES (?, ?, ?, ?);")
    .run(NOVEL_ID, "旧世界之书", NOW, NOW);
  legacy.prepare(
    `INSERT INTO locations (id, novel_id, parent_id, name, x, y, layer, population, created_at, updated_at)
     VALUES ('dddddddd-0000-7000-8000-000000000007', ?, NULL, '北境大陆', 1.5, 2.5, '地面', 3000, ?, ?);`,
  ).run(NOVEL_ID, NOW, NOW);
  legacy.prepare(
    `INSERT INTO locations (id, novel_id, parent_id, name, x, y, layer, population, created_at, updated_at)
     VALUES ('dddddddd-0000-7000-8000-000000000008', ?, 'dddddddd-0000-7000-8000-000000000007', '青云城', 0, 0, '地面', NULL, ?, ?);`,
  ).run(NOVEL_ID, NOW, NOW);
  legacy.exec("PRAGMA user_version = 12;");
  legacy.close();

  const db = openDatabase(dbPath);
  expect((db.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(13);
  expect(tableColumns(db, "locations")).toEqual([
    "id", "novel_id", "parent_id", "name", "description", "x", "y", "layer",
    "population", "created_at", "updated_at",
  ]);
  // 存量两行无损（父级指向保持）
  const parent = db.query(
    "SELECT name, description, x, y, layer, population FROM locations WHERE parent_id IS NULL;",
  ).get() as Record<string, unknown>;
  expect(parent).toEqual({ name: "北境大陆", description: null, x: 1.5, y: 2.5, layer: "地面", population: 3000 });
  const child = db.query(
    "SELECT name, parent_id FROM locations WHERE id = 'dddddddd-0000-7000-8000-000000000008';",
  ).get() as { name: string; parent_id: string };
  expect(child.name).toBe("青云城");
  expect(child.parent_id).toBe("dddddddd-0000-7000-8000-000000000007");
  // 可空实证：无坐标行可直插（旧形态 NOT NULL 会拒绝）
  db.prepare(
    `INSERT INTO locations (id, novel_id, parent_id, name, description, x, y, layer, population, created_at, updated_at)
     VALUES ('dddddddd-0000-7000-8000-000000000009', ?, NULL, '落霞谷', '隐世疗伤地', NULL, NULL, NULL, NULL, ?, ?);`,
  ).run(NOVEL_ID, NOW, NOW);
  // 索引随重建落地
  const indexes = db
    .query("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'locations';")
    .all() as Array<{ name: string }>;
  expect(indexes.map((i) => i.name)).toEqual(
    expect.arrayContaining(["idx_locations_novel_id", "idx_locations_parent_id"]),
  );
  db.close();
});
```

同时把既有用例中全部 `user_version 断言 toBe(12)` 改为 `toBe(13)`（grep 定位）；v7 库用例补一行断言 `tableColumns(db, "locations")` 新形态（列含 description）。

location-store.test.ts——新增：

```ts
test("无坐标形态（自动入库产物）往返：仅 name+description 入库读出一致", () => {
  const stored = store.addLocation(novelId, { name: "青云城", description: "东部边境要塞·主角初战的战场" });
  expect(stored.location).toEqual({ name: "青云城", description: "东部边境要塞·主角初战的战场" });
  const listed = store.listLocations(novelId);
  expect(listed.at(-1)?.location.description).toBe("东部边境要塞·主角初战的战场");
  expect(listed.at(-1)?.location).not.toHaveProperty("x");
});
```

（`store` / `novelId` 复用该文件既有的临时库 setUp 结构。）

- [ ] **步骤 2：运行测试验证失败**

运行：`bun test apps/agent/src/state/db.test.ts apps/agent/src/state/location-store.test.ts`
预期：FAIL——迁移段缺失（列不含 description / user_version 停在 12）、addLocation 无坐标被拒。

- [ ] **步骤 3：实现 db.ts**

- `const SCHEMA_VERSION = 13;`
- 头注释 locations 行改为：`locations：小说世界的地理位置（名称/定位描述/坐标/图层/人口——x/y/layer/population 可空，自动入库只产生名字+定位，地图向字段留给未来编辑），parent_id 自引用外键（城市→大陆层级）`
- 迁移链在 11→12 段之后追加：

```ts
      if (version >= 7 && version <= 12) {
        // 12→13：locations 放宽 x/y/layer 可空 + 新增 description（地点自动入库只产生
        // 「名字+定位」，坐标是地图向字段）。SQLite 无法 ALTER 放宽 NOT NULL，按官方
        // 重建流程：FK 关闭 → 改名旧表 → 建新表 → 拷数据 → 删旧表 → FK 重开
        // （自引用外键下拷贝顺序无关化）。守卫覆盖 7~12：表自 v7 已存在，均持旧形态；
        // 随表改名与 DROP 走的旧索引由下方 CREATE INDEX IF NOT EXISTS 重建
        db.exec("PRAGMA foreign_keys = OFF;");
        db.exec("ALTER TABLE locations RENAME TO locations_v12;");
        db.exec(`
          CREATE TABLE locations (
            id TEXT PRIMARY KEY,
            novel_id TEXT NOT NULL REFERENCES novels(id),
            parent_id TEXT REFERENCES locations(id),
            name TEXT NOT NULL,
            description TEXT,
            x REAL,
            y REAL,
            layer TEXT,
            population INTEGER CHECK (population IS NULL OR population >= 0),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
        `);
        db.exec(`
          INSERT INTO locations (id, novel_id, parent_id, name, description, x, y, layer, population, created_at, updated_at)
          SELECT id, novel_id, parent_id, name, NULL, x, y, layer, population, created_at, updated_at FROM locations_v12;
        `);
        db.exec("DROP TABLE locations_v12;");
        db.exec("PRAGMA foreign_keys = ON;");
      }
```

- 底部基线 `CREATE TABLE IF NOT EXISTS locations` DDL 同步改为目标结构（与迁移段一致——新库不走迁移直达）。

- [ ] **步骤 4：实现 location-store.ts 适配**

- `LocationRow`：`description: string | null; x: number | null; y: number | null; layer: string | null;`
- `INSERT_SQL` 列序加 `description`（`id, novel_id, parent_id, name, description, x, y, layer, population, created_at, updated_at`），run 参数相应 `validated.description ?? null, validated.x ?? null, validated.y ?? null, validated.layer ?? null`
- `SELECT_SQL` 加 `description`；`rowToLocation` 可空列 `?? undefined`
- 类头注释补「description 随 12→13 迁移落地；x/y/layer 可空（自动入库产物只有名字+定位）」

- [ ] **步骤 5：运行测试验证通过**

运行：`bun test apps/agent/src/state/`
预期：PASS（含既有 db 迁移用例断言随 13 改写后全绿）。

---

### 任务 3：workflows——location-intake.ts（filterNewLocations + plantNewLocations）

**文件：**
- 创建：`apps/agent/src/workflows/location-intake.ts`
- 测试：`apps/agent/src/workflows/location-intake.test.ts`

- [ ] **步骤 1：编写失败的测试**（镜像 foreshadow-intake.test.ts 的 FakeChannel + 临时库结构）

```ts
import { describe, expect, test } from "bun:test";
// …临时库 setUp（对齐 foreshadow-intake.test.ts：mkdtemp + openDatabase + LocationStore + FakeChannel）

describe("filterNewLocations", () => {
  test("剔除库内同名（trim 全等）、清单内去重保留首个、空名剔除", () => {
    const filtered = filterNewLocations(
      [
        { name: "青云城", description: "首次" },
        { name: " 青云城 ", description: "重复" },
        { name: "  ", description: "空名" },
        { name: "北境大陆", description: "库内已有" },
        { name: "落霞谷", description: "保留" },
      ],
      [{ name: "北境大陆", description: "既有" }],
    );
    expect(filtered).toEqual([
      { name: "青云城", description: "首次" },
      { name: "落霞谷", description: "保留" },
    ]);
  });
});

describe("plantNewLocations", () => {
  test("逐条确定性入库（name+description），notify 逐条通报，返回 created 计数", () => {
    const channel = new FakeChannel();
    const { created } = plantNewLocations({
      novelId,
      newLocations: [
        { name: "青云城", description: "东部边境要塞" },
        { name: "落霞谷", description: "隐世疗伤地" },
      ],
      channel,
      locationStore: store,
    });
    expect(created).toBe(2);
    const rows = store.listLocations(novelId);
    expect(rows.map((r) => r.location.name)).toEqual(["青云城", "落霞谷"]);
    expect(rows[0]?.location.description).toBe("东部边境要塞");
    expect(channel.notifications.some((n) => n.includes("✨ 地点已入库：青云城"))).toBe(true);
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`bun test apps/agent/src/workflows/location-intake.test.ts`
预期：FAIL——模块不存在。

- [ ] **步骤 3：实现 location-intake.ts**

```ts
import type { UiChannel } from "../ui/channel";
import type { Location, NewLocation } from "@novel/shared";
import { getDefaultLocationStore, type LocationStore } from "../state/location-store";

export interface PlantLocationsResult {
  created: number;
}

/**
 * 编排层兜底 diff（纯函数，可单测）：不信任模型给出的「新增」判定——
 * 按库内地点名剔除清单中已有项（trim 后全等比对），清单内同名去重保留首个，
 * 名字 trim 后为空的项剔除。
 */
export function filterNewLocations(
  newLocations: NewLocation[],
  existingLocations: Location[],
): NewLocation[] {
  const libraryNames = new Set(existingLocations.map((l) => l.name.trim()));
  const seen = new Set<string>();
  const result: NewLocation[] = [];
  for (const item of newLocations) {
    const name = item.name.trim();
    if (name.length === 0 || libraryNames.has(name) || seen.has(name)) continue;
    seen.add(name);
    result.push({ name, description: item.description });
  }
  return result;
}

/**
 * 地点确定性入库（无 LLM，对齐伏笔入库的确定性风格）：逐条 addLocation（name +
 * description），notify 逐条通报。经 filterNewLocations 过滤后无名字解析环节，
 * 无逐条跳过分支；空清单由调用方整块跳过（零调用零提示）。
 */
export function plantNewLocations(options: {
  novelId: string;
  newLocations: NewLocation[];
  channel: UiChannel;
  locationStore?: LocationStore;
}): PlantLocationsResult {
  const store = options.locationStore ?? getDefaultLocationStore();
  let created = 0;
  for (const item of options.newLocations) {
    store.addLocation(options.novelId, { name: item.name, description: item.description });
    options.channel.notify(`✨ 地点已入库：${item.name}`);
    created += 1;
  }
  return { created };
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`bun test apps/agent/src/workflows/location-intake.test.ts`
预期：PASS。

---

### 任务 4：大纲/章节 Agent——list_locations 工具 + prompt + save 入参 + 确认视图 + CLI renderView

**文件：**
- 修改：`apps/agent/src/workflows/agents/outline-agent.ts`
- 修改：`apps/agent/src/workflows/agents/chapter-agent.ts`
- 修改：`apps/agent/src/ui/cli-channel.ts`（formatOutlineForConfirm / formatChapterPlan）
- 测试：`apps/agent/src/workflows/agents/outline-agent.test.ts`、`chapter-agent.test.ts`
- 测试：CLI renderView 渲染块用例（对齐既有 renderView 测试文件——见步骤 4 定位）

- [ ] **步骤 1：编写失败的测试**

outline-agent.test.ts（saveOutlineInputSchemaFor describe 内追加）：

```ts
test("newLocations 缺省省略不合法（必填数组）、空数组合法、完整条目通过", () => {
  expect(() => saveOutlineInputSchemaFor(4, 2).parse({ ...submission, newForeshadows: [] })).toThrow();
  const parsed = saveOutlineInputSchemaFor(4, 2).parse({
    ...submission, newForeshadows: [], newLocations: [{ name: "青云城", description: "东部边境要塞" }],
  });
  expect(parsed.newLocations).toHaveLength(1);
  expect(saveOutlineInputSchemaFor(4, 2).parse({
    ...submission, newForeshadows: [], newLocations: [],
  }).newLocations).toEqual([]);
});

test("地点清单内名字重复被拒绝；项内空名字/空定位被拒绝", () => {
  const dup = { ...submission, newForeshadows: [], newLocations: [
    { name: "青云城", description: "a" }, { name: "青云城", description: "b" },
  ] };
  expect(() => saveOutlineInputSchemaFor(4, 2).parse(dup)).toThrow("地点");
  const empty = { ...submission, newForeshadows: [], newLocations: [{ name: " ", description: "a" }] };
  expect(() => saveOutlineInputSchemaFor(4, 2).parse(empty)).toThrow();
  const noDesc = { ...submission, newForeshadows: [], newLocations: [{ name: "青云城", description: "" }] };
  expect(() => saveOutlineInputSchemaFor(4, 2).parse(noDesc)).toThrow();
});
```

（`submission` 为该 describe 既有 fixture——补齐 newForeshadows 后按上用例形态扩展。）

chapter-agent.test.ts 同款两条（对象为 `saveChaptersInputSchema`，基座为既有 plan fixture）。

CLI renderView：在既有 renderView outline confirm / chapter-plan 渲染用例文件中各加一条「view 携带 newLocations 时输出『✨ 本次大纲新增地点（确认后自动入库）』行与 `名字——定位` 明细；缺失不输出」。

- [ ] **步骤 2：运行测试验证失败**

运行：`bun test apps/agent/src/workflows/agents/ apps/agent/src/ui/`
预期：FAIL——newLocations 未接入。

- [ ] **步骤 3：实现两 Agent**

outline-agent.ts：
1. import 增 `newLocationSchema, type NewLocation`（shared）与 `getDefaultLocationStore, type LocationStore`（state）。
2. `CreateOutlineOptions` 增 `locationStore?: LocationStore`。
3. `saveOutlineInputSchemaFor` 增：

```ts
      newLocations: z
        .array(newLocationSchema)
        .refine((list) => new Set(list.map((l) => l.name)).size === list.length, "新增地点清单内名字不得重复"),
```

4. `OutlineSubmission` 增 `newLocations: NewLocation[]`。
5. SYSTEM_PROMPT 伏笔梳理要求之后追加：

```
地点梳理要求：
1. 大纲中作为剧情发生地的真实地理场所（大陆、城市、山脉、宗门驻地、秘境等），不在地点库中的列入 save_outline 的 newLocations：name 为地点名，description 为一句话定位（如「东部边境要塞·主角初战的战场」）；清单内名字不得重复，地点库已有地点不得列入（可用 list_locations 工具查询地点库现状）；
2. 抽象场所（如梦中、回忆里）与一次性路过、无设定价值的地点不列入，保持清单信噪比；
3. newLocations 会在确认时随大纲一并展示给用户：用户确认后自动入库。
```

6. `createOutline` 内增 list_locations 工具（tools 注册 `list_locations`）：

```ts
  const locationStore = options.locationStore ?? getDefaultLocationStore();
  /** 地点库查询工具：返回库内全部地点名与定位，供模型比对出「新增地点」 */
  const listLocations = tool({
    description:
      "查询地点库中已有的全部地点（名字与定位）。梳理 newLocations 时必须先调用此工具：清单中只能列地点库中没有的地点，库内已有地点不得列入。",
    inputSchema: z.object({}),
    execute: async () => {
      const rows = locationStore.listLocations(novelId);
      return { locations: rows.map((r) => ({ name: r.location.name, description: r.location.description })) };
    },
  });
```

7. `saveOutline` execute 解构增 `newLocations`，view 与 `saved` 均携带；saveOutline 工具 description 与 continuationHint 文案补 newLocations。

chapter-agent.ts：同款 7 步（`PlanChaptersAgentOptions` 增 `locationStore?: LocationStore`；`saveChaptersInputSchema` 增 newLocations + 去重 refine；`ChapterPlanSubmission` 增 `newLocations: NewLocation[]`；SYSTEM_PROMPT 地点梳理要求——「本章概述中作为剧情发生地的真实地理场所…列入 save_chapters 的 newLocations」；list_locations 工具同款注册；saveChapters execute 携带）。

- [ ] **步骤 4：实现 cli-channel.ts 渲染**

`formatOutlineForConfirm(outline, newCharacters?, newForeshadows?, newLocations?)` 增第四参，伏笔块后追加：

```ts
  if (newLocations && newLocations.length > 0) {
    lines.push(`  ✨ 本次大纲新增地点（确认后自动入库）：`);
    for (const l of newLocations) {
      lines.push(`  - ${l.name}——${l.description}`);
    }
  }
```

renderView outline 分支调用处传 `view.newLocations`；`formatChapterPlan` 同款（标题「✨ 本次规划新增地点（确认后自动入库）」）并传参。

- [ ] **步骤 5：运行测试验证通过**

运行：`bun test apps/agent/src/workflows/agents/ apps/agent/src/ui/`
预期：PASS（本任务会暂时编译失败于 create-novel 等 import submission 处？——不会：submission 增字段由 Agent 产出，编排层尚未消费，类型仍自洽；`bun run typecheck` 复核）。

---

### 任务 5：编排接入——create-novel / regen-outline / plan-act-chapters

**文件：**
- 修改：`apps/agent/src/workflows/create-novel.ts`
- 修改：`apps/agent/src/workflows/regen-outline.ts`
- 修改：`apps/agent/src/workflows/plan-act-chapters.ts`
- 测试：`apps/agent/src/workflows/create-novel.test.ts`、`regen-outline.test.ts`、`plan-act-chapters.test.ts`

- [ ] **步骤 1：编写失败的测试**

create-novel.test.ts：
1. `outlineFixture` 增 `newLocations: [{ name: "青云城", description: "东部边境要塞·主角初战的战场" }]`——既有主流程用例断言增强：`new LocationStore(db).listLocations(id)` 含「青云城」且 description 一致；notify 出现「✨ 地点已入库：青云城」。
2. 新用例「newLocations 与库内同名被兜底剔除」：大纲前手工 `addLocation`「青云城」，清单仍含之 → 入库列表不含重复行（filter 生效）。
3. 既有「newCharacters 置空」用例平行补一条：`newLocations: []` 时零入库、无「地点已入库」notify（textScript 无额外轮次——地点入库无 LLM）。

regen-outline.test.ts / plan-act-chapters.test.ts：各自的 outline / chapters fixture 增 newLocations，断言重生成 / 章节规划确认后 locations 表落行；plan 用例断言入库块先于角色自动创建（notify 顺序：「地点已入库」早于「新角色已自动入库」）。

- [ ] **步骤 2：运行测试验证失败**

运行：`bun test apps/agent/src/workflows/create-novel.test.ts apps/agent/src/workflows/regen-outline.test.ts apps/agent/src/workflows/plan-act-chapters.test.ts`
预期：FAIL——编排层未消费 newLocations。

- [ ] **步骤 3：实现三编排**

create-novel.ts——大纲树入库与落盘之后、`state.update` 之前不行——按规格放在「状态收尾与回填之后、角色自动入库之前」：

```ts
  // 大纲新增地点确定性入库：置于角色自动入库之前——毫秒级同步代码先行完成即
  // 「与角色同批次」，不并行（两路 notify 交错无收益）；空清单（过滤后）整块跳过。
  const existingLocations = getDefaultLocationStore().listLocations(id).map((l) => l.location);
  const pendingLocations = filterNewLocations(submission.newLocations, existingLocations);
  if (pendingLocations.length > 0) {
    channel.notify(`\n✨ 大纲引入了 ${pendingLocations.length} 个新地点，正在入库…`);
    plantNewLocations({ novelId: id, newLocations: pendingLocations, channel });
    channel.notify(
      `✨ 本次大纲新增 ${pendingLocations.length} 个地点已自动入库：${pendingLocations.map((l) => l.name).join("、")}`,
    );
  }
```

import 增 `filterNewLocations, plantNewLocations`（`./location-intake`）与 `getDefaultLocationStore`（`../state/location-store`）；`createOutline(...)` 调用的 options 透传 `locationStore: getDefaultLocationStore()`（供 list_locations 工具；测试注入临时库 store——测试文件里 createNovel 的 options 若未透传，编排内部默认即可，测试经 NOVEL_DB_PATH/默认库隔离沿用既有临时库方案，若既有用例以真实库注入 characterStore 的方式运行，则对齐注入）。

regen-outline.ts——同款块置于 `novelStore.updateNovel(novelId, { description: outline.logline });` 之后、角色自动入库之前（notify 文案「新版大纲引入了 N 个新地点」）；`createOutline` options 同样透传 locationStore。

plan-act-chapters.ts——`saveChapters` 入库 notify 之后、角色自动入库之前：

```ts
  // 章节规划新增地点确定性入库：置于角色自动入库之前（同 createNovel 收尾动作语义）
  const existingLocations = getDefaultLocationStore().listLocations(novelId).map((l) => l.location);
  const pendingLocations = filterNewLocations(newLocations, existingLocations);
  if (pendingLocations.length > 0) {
    channel.notify(`\n✨ 本幕规划引入了 ${pendingLocations.length} 个新地点，正在入库…`);
    plantNewLocations({ novelId, newLocations: pendingLocations, channel });
    channel.notify(
      `✨ 本次规划新增 ${pendingLocations.length} 个地点已自动入库：${pendingLocations.map((l) => l.name).join("、")}`,
    );
  }
```

（`planChapters` 返回值解构增 `newLocations`；options 透传 locationStore。）

- [ ] **步骤 4：运行测试验证通过**

运行：`bun test apps/agent/src/workflows/`
预期：PASS。

---

### 任务 6：query CLI——buildNovelDetail 读 locations

**文件：**
- 修改：`apps/agent/src/query.ts`
- 测试：query CLI 集成测试文件（grep `buildNovelDetail` 定位既有用例文件，追加断言）

- [ ] **步骤 1：编写失败的测试**

既有 buildNovelDetail 集成用例追加：临时库 `addLocation` 两行（其一仅 name+description）后，`buildNovelDetail(db, novelId)` 返回 `locations` 数组按入库顺序携带 `{ id, name, description }`，无坐标字段。

- [ ] **步骤 2：运行测试验证失败**

运行：定位到的测试文件
预期：FAIL——locations 字段缺失（novelDetailSchema.parse 拒绝多余键? 否——zod object 默认剥离未知键，断言 locations undefined 失败）。

- [ ] **步骤 3：实现**

query.ts——import 增 `type LocationEntry`（shared）与 `LocationStore`（state）；buildNovelDetail 在 foreshadows 之后：

```ts
  // 地点条目：locations 表全量行（按入库顺序），结构树地点组取用
  const locations: LocationEntry[] = new LocationStore(db)
    .listLocations(novelId)
    .map((stored) => ({ id: stored.id, ...stored.location }));
```

返回对象 `novelDetailSchema.parse({ ..., foreshadows, locations })`；头注释命令一览的 get 行补「地点」。

- [ ] **步骤 4：运行测试验证通过**

运行：query 测试文件
预期：PASS。

---

### 任务 7：客户端——ViewCard 地点块 + 结构树地点组 + 右栏只读卡

**文件：**
- 修改：`apps/client/src/components/ViewCard.tsx`（两确认视图 newLocations 块）
- 修改：`apps/client/src/components/StructureTreePanel.tsx`（Selection 增 location + 「📍 地点」组）
- 修改：`apps/client/src/components/PreviewPane.tsx`（LocationPreview 只读卡分支）
- 测试：客户端 SSR 冒烟测试文件（grep `renderToString` / 既有冒烟用例文件定位，追加地点组与只读卡冒烟）

- [ ] **步骤 1：编写失败的测试**

SSR 冒烟（对齐既有用例形态）：`renderToString(<StructureTreePanel detail={detailWithLocations} ... />)` 含「📍 地点」与「📍 青云城」；无地点 detail 含「（暂无地点）」；`PreviewPane` selection location 时右栏含「青云城」与定位文本、不含 id 值。

- [ ] **步骤 2：运行测试验证失败**

运行：客户端冒烟测试
预期：FAIL。

- [ ] **步骤 3：实现**

ViewCard.tsx——outline 分支（newForeshadows 块后）：

```tsx
          {view.detail === "confirm" && view.newLocations && view.newLocations.length > 0 ? (
            <div className="confirm-list">
              <p className="part-name">✨ 本次大纲新增地点（确认后自动入库）</p>
              {view.newLocations.map((l) => (
                <p key={l.name} className="list-item">
                  📍 {l.name}——{l.description}
                </p>
              ))}
            </div>
          ) : null}
```

chapter-plan 分支同款（标题「✨ 本次规划新增地点（确认后自动入库）」，置于 foreshadowBindings 块之后）。（类名对齐 ViewCard 既有清单块的真实类名——实现时以 newCharacters 块为准复用。）

StructureTreePanel.tsx：
1. `Selection` 联合增 `{ kind: "location"; locationId: string }`。
2. 组状态 `const [locCollapsed, setLocCollapsed] = useState(false);`
3. 世界观节点与角色组之间插入（结构对齐角色组）：

```tsx
          <div className="tree-group">
            {detail.locations.length > 0 ? (
              <button
                className="tree-toggle"
                title={locCollapsed ? "展开地点" : "收起地点"}
                onClick={() => setLocCollapsed((v) => !v)}
              >
                {locCollapsed ? "▸" : "▾"}
              </button>
            ) : null}
            <span>📍 地点</span>
          </div>
          {detail.locations.length === 0 ? (
            <TreeNode label="（暂无地点）" depth={1} muted />
          ) : locCollapsed ? null : (
            detail.locations.map((location) => (
              <TreeNode
                key={location.id}
                label={`📍 ${location.name}`}
                depth={1}
                active={selection?.kind === "location" && selection.locationId === location.id}
                onClick={() => onSelect({ kind: "location", locationId: location.id })}
              />
            ))
          )}
```

PreviewPane.tsx——新增 LocationPreview（只读、无编辑入口、不展示 id）：

```tsx
/** 地点卡预览（只读）：名字 + 定位 + 已设定的可选字段；坐标/图层/人口/父级名（parentId 经
 *  detail.locations 解析，未匹配兜底原 ID）未设定不渲染——不展示 id（全页面去 ID 约定） */
function LocationPreview({ entry, detail }: { entry: LocationEntry; detail: NovelDetail }) {
  const parentName = entry.parentId
    ? detail.locations.find((l) => l.id === entry.parentId)?.name ?? entry.parentId
    : null;
  return (
    <section className="viewcard">
      <p className="card-label">地点</p>
      <h3 className="preview-title">{entry.name}</h3>
      {entry.description ? <p className="outline-summary">{entry.description}</p> : null}
      {entry.x !== undefined && entry.y !== undefined ? (
        <p className="outline-summary">坐标：({entry.x}, {entry.y})</p>
      ) : null}
      {entry.layer ? <p className="outline-summary">图层：{entry.layer}</p> : null}
      {entry.population !== undefined ? <p className="outline-summary"> population：{entry.population}</p> : null}
      {parentName ? <p className="outline-summary">父级：{parentName}</p> : null}
    </section>
  );
}
```

（字段行文案与类名对齐 ForeshadowPreview 只读卡风格——`preview-title` 若无现成类名则用既有标题类；population 行文案用「主要物种数量：」中文表述。）dispatch 链在 foreshadow 分支后加：

```tsx
  } else if (selection.kind === "location") {
    const entry = detail.locations.find((l) => l.id === selection.locationId);
    body = entry ? (
      <LocationPreview key={entry.id} entry={entry} detail={detail} />
    ) : (
      <p className="pane-error">该地点内容未能加载（数据缺失）。</p>
    );
  }
```

import 增 `type LocationEntry`。

- [ ] **步骤 4：运行测试验证通过**

运行：客户端测试（`bun test apps/client`）
预期：PASS。

---

### 任务 8：收尾——全量校验 + 真实库迁移实跑 + 文档同步 + 统一提交

**文件：**
- 校验：全仓 `bun run typecheck` / `bun run lint` / `bun run test`
- 实跑：真实库副本 12→13 迁移（`NOVEL_DB_PATH` 指向 `data/novel.db` 副本，openDatabase 后核对 user_version=13、locations 列形态、原库不动）
- 文档：`AGENTS.md`（query get 描述补地点、结构树描述补地点组、save_outline/save_chapters 描述补地点清单、location-intake 模块行）、根 `ARCHITECTURE.md`（workflows 文件清单补 location-intake、SCHEMA_VERSION 13）、`apps/agent/src/workflows/ARCHITECTURE.md`（模块文件职责）、根 `PROGRESS.md`（进行中清单归一为已完成记录）、根 `DECISIONS.md`（选型决策落盘）
- 提交：整需求一次原子提交（feat）

- [ ] **步骤 1：全量校验**——typecheck 3 工程 / lint / 全量测试 100% 过。
- [ ] **步骤 2：真实库迁移实跑**——副本迁移无损（user_version 13、description 列落地、x/y/layer 可空、存量 0 行不受影响）；真实库 `data/novel.db` 不动。
- [ ] **步骤 3：文档同步**（按上表；AGENTS.md 的 save_outline/save_chapters/结构树/query 描述与 location-intake 模块行）。
- [ ] **步骤 4：PROGRESS 归一 + 原子提交**——「进行中」清单删除，归一条完成总结进「已完成」（超 5 条滚动最旧入历史归档）；git 单次 feat 提交（代码 + 文档）。
- [ ] **步骤 5：遗留交接**——真实 LLM 端到端待用户复验步骤写入完成总结（大纲/章节规划确认门看「✨ 新增地点」清单 → 确认后查客户端结构树「📍 地点」组与右栏只读卡）。

---

## 自检记录

- **规格覆盖度**：规格 3.1→T1、3.2→T1、3.3→T2、3.4→T4、3.5→T3、3.6→T5、3.7→T6、3.8→T4 步骤 4、3.9→T7、AC→T2/T8——全覆盖；联动清单各行为 T4（拒绝作废）/T3+T5（filter 与空清单）/T1（optional 零破坏）/T2（迁移保数据）覆盖。
- **占位符扫描**：无「待定/TODO/类似任务 N」；ViewCard 类名与 LocationPreview 文案标注「对齐既有块」并指明参照物，属实现期对齐而非缺内容。
- **类型一致性**：`newLocationSchema`/`NewLocation`（T1 定义，T3/T4/T5 消费）、`locationEntrySchema`/`LocationEntry`（T1 定义，T6/T7 消费）、`filterNewLocations`/`plantNewLocations`（T3 定义，T5 消费）——签名一致。

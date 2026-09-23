import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NovelStore } from "./novel-store";
import { LocationStore } from "./location-store";
import { locationSchema, type Location } from "@novel/shared";

let tempDir: string;

afterAll(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

const V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const NOVEL_A = "11111111-2222-7333-8444-555566667777";
const NOVEL_B = "11111111-2222-7333-8444-555566667778";

function makeLocation(name: string, overrides: Partial<Location> = {}): Location {
  return locationSchema.parse({
    name,
    x: 123.45,
    y: -67.8,
    layer: "地面",
    population: 250000,
    ...overrides,
  });
}

/** FK 依赖：locations.novel_id 关联 novels.id，须先建小说行 */
function setup(dbPath: string): LocationStore {
  const novelStore = NovelStore.open(dbPath);
  novelStore.createNovel({ id: NOVEL_A });
  novelStore.createNovel({ id: NOVEL_B });
  novelStore.close();
  return LocationStore.open(dbPath);
}

describe("LocationStore", () => {
  test("addLocation 入库后 listLocations 按顺序取回，浮点坐标与人口无损往返", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "novel-loc-db-"));
    const dbPath = join(tempDir, "test.db");
    const store = setup(dbPath);

    const continent = store.addLocation(
      NOVEL_A,
      makeLocation("北境大陆", { x: 0, y: 0, population: undefined }),
    );
    expect(continent.id).toMatch(V7_RE);

    const city = store.addLocation(
      NOVEL_A,
      makeLocation("雾港城", { parentId: continent.id }),
    );
    expect(city.location.parentId).toBe(continent.id);

    const listed = store.listLocations(NOVEL_A);
    expect(listed.map((s) => s.location.name)).toEqual(["北境大陆", "雾港城"]);
    expect(listed[0]?.location.x).toBe(0);
    expect(listed[0]?.location.population).toBeUndefined();
    expect(listed[1]?.location.x).toBe(123.45);
    expect(listed[1]?.location.y).toBe(-67.8);
    expect(listed[1]?.location.population).toBe(250000);
    expect(listed[1]?.location.layer).toBe("地面");
    store.close();
  });

  test("父级链读写一致：孙节点可回溯到根（大陆 → 城市 → 街区）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-loc-db-tree-"));
    const store = LocationStore.open(join(dir, "test.db"));
    const novels = NovelStore.open(join(dir, "test.db"));
    novels.createNovel({ id: NOVEL_A });
    novels.close();

    const continent = store.addLocation(NOVEL_A, makeLocation("北境大陆"));
    const city = store.addLocation(
      NOVEL_A,
      makeLocation("雾港城", { parentId: continent.id }),
    );
    const district = store.addLocation(
      NOVEL_A,
      makeLocation("旧港区", { parentId: city.id, layer: "地底" }),
    );

    const byId = new Map(store.listLocations(NOVEL_A).map((s) => [s.id, s]));
    expect(byId.get(district.id)?.location.parentId).toBe(city.id);
    expect(byId.get(city.id)?.location.parentId).toBe(continent.id);
    expect(byId.get(continent.id)?.location.parentId).toBeUndefined();
    expect(byId.get(district.id)?.location.layer).toBe("地底");
    store.close();
  });

  test("父级不存在或属于其他小说时给可读错误", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-loc-db-parent-"));
    tempDir = tempDir || dir;
    const store = setup(join(dir, "test.db"));

    expect(() =>
      store.addLocation(
        NOVEL_A,
        makeLocation("雾港城", { parentId: "eeeeeeee-0000-7000-8000-000000000009" }),
      ),
    ).toThrow("父级位置不存在");

    const foreign = store.addLocation(NOVEL_B, makeLocation("异界大陆"));
    expect(() =>
      store.addLocation(NOVEL_A, makeLocation("雾港城", { parentId: foreign.id })),
    ).toThrow("父级位置属于其他小说");
    store.close();
  });

  test("schema 拒绝透传：空名称与负数人口不入库", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-loc-db-schema-"));
    tempDir = tempDir || dir;
    const store = setup(join(dir, "test.db"));

    expect(() => store.addLocation(NOVEL_A, makeLocation(""))).toThrow();
    expect(() =>
      store.addLocation(NOVEL_A, makeLocation("雾港城", { population: -1 })),
    ).toThrow();
    expect(store.listLocations(NOVEL_A)).toHaveLength(0);
    store.close();
  });

  test("listLocations 对无位置的小说返回空数组", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-loc-db-empty-"));
    tempDir = tempDir || dir;
    const store = setup(join(dir, "test.db"));
    expect(store.listLocations(NOVEL_A)).toEqual([]);
    store.close();
  });
});

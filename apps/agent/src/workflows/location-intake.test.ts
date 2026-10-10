import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../state/db";
import { NovelStore } from "../state/novel-store";
import { LocationStore } from "../state/location-store";
import { FakeChannel } from "../ui/fake-channel";

const { filterNewLocations, plantNewLocations } = await import("./location-intake");

const NOVEL = "n-location-1";
let tempDir: string;
afterAll(async () => { if (tempDir) await rm(tempDir, { recursive: true, force: true }); });

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

  test("空清单与全被剔除时返回空数组（调用方整块跳过）", () => {
    expect(filterNewLocations([], [])).toEqual([]);
    expect(
      filterNewLocations([{ name: "北境大陆", description: "重复既有" }], [{ name: "北境大陆" }]),
    ).toEqual([]);
  });
});

describe("plantNewLocations", () => {
  test("逐条确定性入库（name+description），notify 逐条通报，返回 created 计数", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "novel-intake-location-"));
    const db = openDatabase(join(tempDir, "t.db"));
    new NovelStore(db).createNovel({ id: NOVEL });
    const store = new LocationStore(db);
    const channel = new FakeChannel([]);

    const { created } = plantNewLocations({
      novelId: NOVEL,
      newLocations: [
        { name: "青云城", description: "东部边境要塞·主角初战的战场" },
        { name: "落霞谷", description: "隐世疗伤地" },
      ],
      channel,
      locationStore: store,
    });
    expect(created).toBe(2);

    const rows = store.listLocations(NOVEL);
    expect(rows.map((r) => r.location.name)).toEqual(["青云城", "落霞谷"]);
    expect(rows[0]?.location.description).toBe("东部边境要塞·主角初战的战场");
    expect(rows[1]?.location.x).toBeUndefined();
    expect(channel.notifies.some((n) => n.includes("✨ 地点已入库：青云城"))).toBe(true);
    expect(channel.notifies.some((n) => n.includes("✨ 地点已入库：落霞谷"))).toBe(true);
    db.close();
  });

  test("空清单零入库零通报", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-intake-location-empty-"));
    tempDir = tempDir || dir;
    const db = openDatabase(join(dir, "t.db"));
    new NovelStore(db).createNovel({ id: NOVEL });
    const channel = new FakeChannel([]);

    const { created } = plantNewLocations({
      novelId: NOVEL,
      newLocations: [],
      channel,
      locationStore: new LocationStore(db),
    });
    expect(created).toBe(0);
    expect(channel.notifies).toHaveLength(0);
    db.close();
  });
});

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { CharacterStore } from "./state/character-store";
import { openDatabase } from "./state/db";
import { NovelStore } from "./state/novel-store";
import { WorldviewStore } from "./state/worldview-store";
import { buildNovelDetail, buildNovelList } from "./query";

const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** 每个用例独立临时库（建表 + 返回 store 与目录句柄） */
async function newFixture(): Promise<{ db: Database; dir: string; outputDir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "novel-query-"));
  tempDirs.push(dir);
  return {
    db: openDatabase(join(dir, "test.db")),
    dir,
    outputDir: join(dir, "output"),
  };
}

const worldview = {
  background: {
    geography: "维斯特洛大陆",
    fantasyAttributes: "魔法世界",
    realWorldMapping: "封建领主制",
  },
  taboos: ["不能出现现代科技物品"],
};

const character = {
  basicInfo: { name: "林澜", gender: "女" },
  core: { desire: "找到妹妹", fear: "失去同伴", narrativeRole: "主角" },
  background: "殖民城市长大的孤儿领航员",
  creationPurpose: "驱动主线冲突的核心视角",
  endingDirection: "公开真相并拯救城市",
};

describe("query CLI（buildNovelList / buildNovelDetail）", () => {
  test("空库 list 返回空数组", async () => {
    const { db } = await newFixture();
    expect(buildNovelList(db)).toEqual([]);
    db.close();
  });

  test("未命名小说 name 为 null，新创建的排在前面", async () => {
    const { db } = await newFixture();
    const novels = new NovelStore(db);
    novels.createNovel({ id: "aaaaaaaa-0000-7000-8000-000000000001", name: "灵脉破晓" });
    novels.createNovel({ id: "aaaaaaaa-0000-7000-8000-000000000002" });
    const list = buildNovelList(db);
    expect(list).toHaveLength(2);
    expect(list[0]?.name).toBeNull();
    expect(list[1]?.name).toBe("灵脉破晓");
    db.close();
  });

  test("get 全量资料：世界观 + 角色 + 大纲产物", async () => {
    const { db, outputDir } = await newFixture();
    const id = "bbbbbbbb-0000-7000-8000-000000000001";
    new NovelStore(db).createNovel({ id, name: "九州残脉" });
    new WorldviewStore(db).saveWorldview(id, worldview);
    new CharacterStore(db).addCharacter(id, character);
    const { saveOutline } = await import("./output/outline-writer");
    await saveOutline(
      id,
      {
        title: "九州残脉",
        logline: "残脉少年重走修行路",
        parts: [
          {
            name: "第一部·风起",
            summary: "少年觉醒",
            acts: [
              {
                name: "第一幕·开端",
                summary: "残脉初现",
                keyPlotPoints: ["测灵受辱", "得遇残卷"],
              },
            ],
          },
        ],
      },
      outputDir,
    );

    const detail = buildNovelDetail(db, id, outputDir);
    expect(detail.novel.name).toBe("九州残脉");
    expect(detail.worldview?.background.geography).toBe("维斯特洛大陆");
    expect(detail.characters).toHaveLength(1);
    expect(detail.characters[0]?.basicInfo.name).toBe("林澜");
    expect(detail.outline?.parts[0]?.acts[0]?.keyPlotPoints).toHaveLength(2);
    db.close();
  });

  test("大纲产物缺失时 outline 为 null（世界观 / 角色仍可见）", async () => {
    const { db, outputDir } = await newFixture();
    const id = "cccccccc-0000-7000-8000-000000000001";
    new NovelStore(db).createNovel({ id });
    new WorldviewStore(db).saveWorldview(id, worldview);

    const detail = buildNovelDetail(db, id, outputDir);
    expect(detail.novel.name).toBeNull();
    expect(detail.worldview).not.toBeNull();
    expect(detail.characters).toEqual([]);
    expect(detail.outline).toBeNull();
    db.close();
  });

  test("get 不存在的小说抛错", async () => {
    const { db, outputDir } = await newFixture();
    expect(() =>
      buildNovelDetail(db, "dddddddd-0000-7000-8000-00000000dead", outputDir),
    ).toThrow("小说不存在");
    db.close();
  });
});

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { CharacterStore } from "./state/character-store";
import { openDatabase } from "./state/db";
import { NovelStore } from "./state/novel-store";
import { OutlineStore } from "./state/outline-store";
import { WorldviewStore } from "./state/worldview-store";
import {
  buildNovelDetail,
  buildNovelList,
  deleteNovel,
  renameNovel,
  setNovelFavorite,
  setNovelPinned,
} from "./query";

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

  test("get 全量资料：世界观 + 角色 + 大纲节点（读 outlines 表，含梗概与情节点）", async () => {
    const { db } = await newFixture();
    const id = "bbbbbbbb-0000-7000-8000-000000000001";
    new NovelStore(db).createNovel({ id, name: "九州残脉" });
    new WorldviewStore(db).saveWorldview(id, worldview);
    new CharacterStore(db).addCharacter(id, character);
    new OutlineStore(db).saveOutlineTree(id, [
      {
        name: "第一部·风起",
        summary: "少年觉醒",
        acts: [
          { name: "第一幕·开端", summary: "残脉初现", keyPlotPoints: ["测灵受辱", "得遇残卷"] },
          { name: "第二幕·对抗", summary: "宗门追杀", keyPlotPoints: ["夜遁青云"] },
        ],
      },
    ]);

    const detail = buildNovelDetail(db, id);
    expect(detail.novel.name).toBe("九州残脉");
    expect(detail.worldview?.background.geography).toBe("维斯特洛大陆");
    expect(detail.characters).toHaveLength(1);
    expect(detail.characters[0]?.basicInfo.name).toBe("林澜");

    // 节点按「父级分组 + sort」排序：部在前，幕按所属部 sort 递增
    expect(detail.outlineNodes).toHaveLength(3);
    const [part, act1, act2] = detail.outlineNodes;
    expect(part?.type).toBe("part");
    expect(part?.parentId).toBeNull();
    expect(part?.summary).toBe("少年觉醒");
    expect(part?.keyPlotPoints).toBeNull();
    expect(act1?.type).toBe("act");
    expect(act1?.parentId).toBe(part?.id);
    expect(act1?.summary).toBe("残脉初现");
    expect(act1?.keyPlotPoints).toEqual(["测灵受辱", "得遇残卷"]);
    expect(act2?.sort).toBe(2);
    db.close();
  });

  test("表有节点但 output 产物缺失时照常返回（产物不再决定浏览读取）", async () => {
    const { db, outputDir } = await newFixture();
    const id = "bbbbbbbb-0000-7000-8000-000000000002";
    new NovelStore(db).createNovel({ id });
    new OutlineStore(db).saveOutlineTree(id, [
      { name: "孤部", summary: "梗概", acts: [{ name: "孤幕", summary: "幕梗概", keyPlotPoints: ["点"] }] },
    ]);
    expect(existsSync(join(outputDir, `${id}.json`))).toBe(false);

    const detail = buildNovelDetail(db, id);
    expect(detail.outlineNodes).toHaveLength(2);
    expect(detail.outlineNodes[0]?.name).toBe("孤部");
    db.close();
  });

  test("大纲未入库时 outlineNodes 为空数组（世界观 / 角色仍可见）", async () => {
    const { db } = await newFixture();
    const id = "cccccccc-0000-7000-8000-000000000001";
    new NovelStore(db).createNovel({ id });
    new WorldviewStore(db).saveWorldview(id, worldview);

    const detail = buildNovelDetail(db, id);
    expect(detail.novel.name).toBeNull();
    expect(detail.worldview).not.toBeNull();
    expect(detail.characters).toEqual([]);
    expect(detail.outlineNodes).toEqual([]);
    db.close();
  });

  test("get 不存在的小说抛错", async () => {
    const { db } = await newFixture();
    expect(() =>
      buildNovelDetail(db, "dddddddd-0000-7000-8000-00000000dead"),
    ).toThrow("小说不存在");
    db.close();
  });
});

describe("query CLI 管理命令（rename / pin / favorite / delete）", () => {
  test("rename trim 校验并回读新名称", async () => {
    const { db } = await newFixture();
    const id = "aaaaaaaa-0000-7000-8000-000000000010";
    new NovelStore(db).createNovel({ id, name: "旧名" });
    const renamed = renameNovel(db, id, "  新书名  ");
    expect(renamed.name).toBe("新书名");
    expect(() => renameNovel(db, id, "   ")).toThrow("不能为空");
    db.close();
  });

  test("pin / favorite 后 list 排序与标记生效", async () => {
    const { db } = await newFixture();
    const novels = new NovelStore(db);
    novels.createNovel({ id: "aaaaaaaa-0000-7000-8000-000000000011", name: "甲" });
    novels.createNovel({ id: "aaaaaaaa-0000-7000-8000-000000000012", name: "乙" });
    setNovelPinned(db, "aaaaaaaa-0000-7000-8000-000000000011", true);
    setNovelFavorite(db, "aaaaaaaa-0000-7000-8000-000000000012", true);
    const list = buildNovelList(db);
    expect(list[0]?.name).toBe("甲");
    expect(list[0]?.pinned).toBe(true);
    expect(list[1]?.favorite).toBe(true);
    db.close();
  });

  test("delete 级联删除并清理 output 产物（产物缺失不报错）", async () => {
    const { db, outputDir } = await newFixture();
    const id = "aaaaaaaa-0000-7000-8000-000000000013";
    new NovelStore(db).createNovel({ id, name: "待删" });
    const { mkdirSync } = await import("node:fs");
    mkdirSync(outputDir, { recursive: true });
    const artifact = join(outputDir, `${id}.json`);
    await writeFile(artifact, "{}\n", { flag: "wx" });

    const result = deleteNovel(db, id, outputDir);
    expect(result.deleted).toBe(id);
    expect(existsSync(artifact)).toBe(false);
    expect(new NovelStore(db).listNovels()).toHaveLength(0);
    // 产物本就不存在时再删一本也不报错
    new NovelStore(db).createNovel({ id: "aaaaaaaa-0000-7000-8000-000000000014" });
    expect(deleteNovel(db, "aaaaaaaa-0000-7000-8000-000000000014", outputDir).deleted).toBe(
      "aaaaaaaa-0000-7000-8000-000000000014",
    );
    db.close();
  });
});

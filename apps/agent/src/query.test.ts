import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { CharacterStore } from "./state/character-store";
import { DocumentStore } from "./state/document-store";
import { ForeshadowStore } from "./state/foreshadow-store";
import { LocationStore } from "./state/location-store";
import { openDatabase } from "./state/db";
import { NovelStore } from "./state/novel-store";
import { OutlineStore } from "./state/outline-store";
import { WorldviewStore } from "./state/worldview-store";
import { WorkflowRunStore } from "./state/workflow-run-store";
import { writeDocumentArtifact } from "./output/document-writer";
import {
  addMigrationEntry,
  addStyleEntry,
  buildNovelDetail,
  buildNovelList,
  deleteNovel,
  deleteStyleEntry,
  renameNovel,
  setNovelFavorite,
  cancelMigrationEntry,
  confirmMigrationEntry,
  setNovelPinned,
  setWritingPrefs,
  saveMigrationEntry,
  updateForeshadowEntry,
  updateMigrationEntry,
  updateStyleEntry,
} from "./query";

const tempDirs: string[] = [];

test("详情只暴露本小说未完成流程摘要，完成或删除后移除恢复入口", () => {
  const db = openDatabase(":memory:");
  try {
    const novels = new NovelStore(db);
    const one = novels.createNovel({});
    const two = novels.createNovel({});
    const runs = new WorkflowRunStore(db);
    const pending = runs.create({ kind: "create", novelId: one.id });
    runs.finish(pending.id, "failed", "额度耗尽");
    runs.create({ kind: "create", novelId: two.id });
    expect(buildNovelDetail(db, one.id).pendingRuns).toEqual([{
      id: pending.id, kind: "create", targetId: null, status: "failed", error: "额度耗尽",
      updatedAt: runs.get(pending.id)!.updatedAt,
    }]);
    runs.finish(pending.id, "completed");
    expect(buildNovelDetail(db, one.id).pendingRuns).toEqual([]);
    deleteNovel(db, two.id);
    expect(runs.listPending()).toEqual([]);
  } finally { db.close(); }
});

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
  test("详情返回小说创作条件，列表继续使用原有契约，旧小说字段为空", () => {
    const db = openDatabase(":memory:");
    try {
      const novels = new NovelStore(db);
      novels.createNovel({ id: "params", genre: "悬疑", audience: ["推理读者", "重视公平线索"], coreConflict: { origin: "失踪事件", impact: "信任破裂", idealResolution: "查明真相" } });
      novels.createNovel({ id: "legacy" });
      expect(buildNovelDetail(db, "params").novel).toMatchObject({ genre: "悬疑", audience: ["推理读者", "重视公平线索"], coreConflict: { origin: "失踪事件", impact: "信任破裂", idealResolution: "查明真相" } });
      expect(buildNovelDetail(db, "legacy").novel).toMatchObject({ genre: null, audience: null, coreConflict: null });
      expect(buildNovelList(db).find((n) => n.id === "params")).not.toHaveProperty("coreConflict");
    } finally { db.close(); }
  });

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

  test("get 携带章节正文：文件在则拼 content，文件缺失为 null 不抛错", async () => {
    const { db, outputDir } = await newFixture();
    const id = "bbbbbbbb-0000-7000-8000-000000000003";
    new NovelStore(db).createNovel({ id, name: "正文之书" });
    new OutlineStore(db).saveOutlineTree(id, [
      { name: "部一", summary: "梗概", acts: [{ name: "幕一", summary: "幕梗概", keyPlotPoints: ["点"] }] },
    ]);
    const actNode = new OutlineStore(db).listOutlineNodes(id, { currentOnly: true }).find((n) => n.node.type === "act")!;
    const chapters = new OutlineStore(db).saveChapters(id, actNode.id, [
      { name: "章一", summary: "概述" },
      { name: "章二", summary: "概述" },
    ]);
    const documentStore = new DocumentStore(db);
    documentStore.saveChapterDocument(id, chapters[0]!.id, "正文之书/部一/章一.md", 5);
    await writeDocumentArtifact("正文之书/部一/章一.md", "章一正文全文。", outputDir);
    // 章二登记了元数据但文件不存在（模拟被手动移动）
    documentStore.saveChapterDocument(id, chapters[1]!.id, "正文之书/部一/章二.md", 6);

    const detail = buildNovelDetail(db, id, outputDir);
    expect(detail.documents).toHaveLength(2);
    const first = detail.documents.find((d) => d.chapterId === chapters[0]!.id)!;
    const second = detail.documents.find((d) => d.chapterId === chapters[1]!.id)!;
    expect(first.content).toBe("章一正文全文。");
    expect(first.filePath).toBe(join("正文之书", "部一", "章一.md"));
    expect(second.content).toBeNull();
    db.close();
  });

  test("get 全量资料携带伏笔条目（登场 / 回收 / 未绑定三形态，按入库顺序）", async () => {
    const { db } = await newFixture();
    const id = "bbbbbbbb-0000-7000-8000-00000000000f";
    new NovelStore(db).createNovel({ id, name: "伏笔之书" });
    const characters = new CharacterStore(db);
    const charId = characters.addCharacter(id, character).id;
    const store = new ForeshadowStore(db);
    const fs = store.addForeshadow(
      id,
      {
        surfaceAction: "宗主赐下断脉散",
        hiddenTruth: "药中掺了追踪灵脉的蛊种",
        attentionLevel: 6,
        recoveryStatus: "unrecovered",
        appearChapterId: "ch-1",
        characterIds: [charId],
      },
    );
    store.addForeshadow(id, {
      surfaceAction: "半块玉佩",
      hiddenTruth: "主角身世信物",
      attentionLevel: 3,
      recoveryStatus: "unrecovered",
      recoverChapterIds: ["ch-9"],
    });
    store.addForeshadow(id, {
      surfaceAction: "尚未绑定的伏笔",
      hiddenTruth: "等待章节规划",
      attentionLevel: 5,
      recoveryStatus: "unrecovered",
    });
    const detail = buildNovelDetail(db, id);
    expect(detail.foreshadows.map((f) => f.surfaceAction)).toEqual([
      "宗主赐下断脉散",
      "半块玉佩",
      "尚未绑定的伏笔",
    ]);
    expect(detail.foreshadows[0]).toMatchObject({
      id: fs.id,
      appearChapterId: "ch-1",
      characterIds: [charId],
      recoveryStatus: "unrecovered",
    });
    expect(detail.foreshadows[1]?.recoverChapterIds).toEqual(["ch-9"]);
    expect(detail.foreshadows[2]?.appearChapterId).toBeUndefined();
    db.close();
  });

  test("get 全量资料携带地点条目（自动入库最小形态与全字段形态，按入库顺序）", async () => {
    const { db } = await newFixture();
    const id = "bbbbbbbb-0000-7000-8000-000000000010";
    new NovelStore(db).createNovel({ id, name: "地点之书" });
    const store = new LocationStore(db);
    const bare = store.addLocation(id, { name: "青云城", description: "东部边境要塞·主角初战的战场" });
    store.addLocation(id, { name: "北境大陆", x: 1.5, y: 2.5, layer: "地面", population: 3000 });
    const detail = buildNovelDetail(db, id);
    expect(detail.locations.map((l) => l.name)).toEqual(["青云城", "北境大陆"]);
    expect(detail.locations[0]).toMatchObject({ id: bare.id, name: "青云城", description: "东部边境要塞·主角初战的战场" });
    expect(detail.locations[0]?.x).toBeUndefined();
    expect(detail.locations[1]).toMatchObject({ x: 1.5, y: 2.5, layer: "地面", population: 3000 });
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

  test("rename 连带迁移按小说名落盘的正文文件与 file_path", async () => {
    const { db, outputDir } = await newFixture();
    const id = "aaaaaaaa-0000-7000-8000-000000000016";
    new NovelStore(db).createNovel({ id, name: "旧名" });
    const documentStore = new DocumentStore(db);
    // 种子：一章 + 正文文件（旧名首段）
    new OutlineStore(db).saveOutlineTree(id, [
      { name: "部一", summary: "梗概", acts: [{ name: "幕一", summary: "幕梗概", keyPlotPoints: ["点"] }] },
    ]);
    const actNode = new OutlineStore(db).listOutlineNodes(id, { currentOnly: true }).find((n) => n.node.type === "act")!;
    const chapter = new OutlineStore(db).saveChapters(id, actNode.id, [{ name: "章一", summary: "概述" }])[0]!;
    documentStore.saveChapterDocument(id, chapter.id, "旧名/部一/章一.md", 5);
    await writeDocumentArtifact("旧名/部一/章一.md", "正文内容。", outputDir);

    renameNovel(db, id, "新名", outputDir);

    // 文件移动到新名首段，库内 file_path 同步，读取可达
    expect(existsSync(join(outputDir, "旧名", "部一", "章一.md"))).toBe(false);
    expect(existsSync(join(outputDir, "新名-aaaaaaaa", "部一", "章一.md"))).toBe(true);
    const detail = buildNovelDetail(db, id, outputDir);
    expect(detail.documents[0]?.filePath).toBe(join("新名-aaaaaaaa", "部一", "章一.md"));
    expect(detail.documents[0]?.content).toBe("正文内容。");
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

    // 章节正文文件随 delete 一并清理
    new OutlineStore(db).saveOutlineTree(id, [
      { name: "部一", summary: "梗概", acts: [{ name: "幕一", summary: "幕梗概", keyPlotPoints: ["点"] }] },
    ]);
    const actNode = new OutlineStore(db).listOutlineNodes(id, { currentOnly: true }).find((n) => n.node.type === "act")!;
    const chapter = new OutlineStore(db).saveChapters(id, actNode.id, [{ name: "章一", summary: "概述" }])[0]!;
    new DocumentStore(db).saveChapterDocument(id, chapter.id, "待删/部一/章一.md", 5);
    await writeDocumentArtifact("待删/部一/章一.md", "随书删除的正文。", outputDir);

    const result = deleteNovel(db, id, outputDir);
    expect(result.deleted).toBe(id);
    expect(existsSync(artifact)).toBe(false);
    expect(existsSync(join(outputDir, "待删", "部一", "章一.md"))).toBe(false);
    expect(new NovelStore(db).listNovels()).toHaveLength(0);
    // 产物本就不存在时再删一本也不报错
    new NovelStore(db).createNovel({ id: "aaaaaaaa-0000-7000-8000-000000000014" });
    expect(deleteNovel(db, "aaaaaaaa-0000-7000-8000-000000000014", outputDir).deleted).toBe(
      "aaaaaaaa-0000-7000-8000-000000000014",
    );
    db.close();
  });
});

describe("query CLI 写作偏好（set-writing-prefs + 详情契约）", () => {
  test("设置与清空全量替换，详情携带三字段，非法 JSON 与半设拒绝且零写入", async () => {
    const { db } = await newFixture();
    try {
      const id = "aaaaaaaa-0000-7000-8000-000000000021";
      new NovelStore(db).createNovel({ id, name: "偏好之书" });
      expect(buildNovelDetail(db, id).novel).toMatchObject({
        chapterLengthMin: null,
        chapterLengthMax: null,
        stylePassScore: null,
      });
      setWritingPrefs(db, id, JSON.stringify({ chapterLengthMin: 3000, chapterLengthMax: 4500, stylePassScore: 85 }));
      expect(buildNovelDetail(db, id).novel).toMatchObject({
        chapterLengthMin: 3000,
        chapterLengthMax: 4500,
        stylePassScore: 85,
      });
      // 只改阈值：全量替换语义（未携带的篇幅被清空）
      setWritingPrefs(db, id, JSON.stringify({ chapterLengthMin: null, chapterLengthMax: null, stylePassScore: 95 }));
      expect(buildNovelDetail(db, id).novel).toMatchObject({
        chapterLengthMin: null,
        chapterLengthMax: null,
        stylePassScore: 95,
      });
      // 非法载荷：JSON 损坏 / 半设 / 越界——抛可读错误且库中值不变
      expect(() => setWritingPrefs(db, id, "{ 不是 JSON")).toThrow("解析失败");
      expect(() =>
        setWritingPrefs(db, id, JSON.stringify({ chapterLengthMin: 3000, chapterLengthMax: null, stylePassScore: null })),
      ).toThrow("同时");
      expect(() =>
        setWritingPrefs(db, id, JSON.stringify({ chapterLengthMin: null, chapterLengthMax: null, stylePassScore: 101 })),
      ).toThrow();
      expect(buildNovelDetail(db, id).novel).toMatchObject({ stylePassScore: 95, chapterLengthMin: null });
      // 不存在的小说抛可读错误
      expect(() =>
        setWritingPrefs(db, "ffffffff-0000-7000-8000-0000000000ff", JSON.stringify({ chapterLengthMin: null, chapterLengthMax: null, stylePassScore: null })),
      ).toThrow("不存在");
    } finally {
      db.close();
    }
  });

  test("set-writing-prefs 真实 CLI 往返：落库并回读详情", async () => {
    const { db, dir } = await newFixture();
    const id = "aaaaaaaa-0000-7000-8000-000000000022";
    new NovelStore(db).createNovel({ id, name: "CLI 往返" });
    const dbPath = db.filename;
    db.close();
    const run = (prefs: unknown) =>
      execFileSync("bun", [join(import.meta.dir, "query.ts"), "set-writing-prefs", id, JSON.stringify(prefs)], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, NOVEL_DB_PATH: dbPath },
      });
    const listed = JSON.parse(run({ chapterLengthMin: 2500, chapterLengthMax: 4000, stylePassScore: 75 }));
    expect(listed).toMatchObject({ id, name: "CLI 往返" });
    // 非法载荷非零退出（stderr 可读错误）
    expect(() => run({ chapterLengthMin: 4000, chapterLengthMax: 2500, stylePassScore: null })).toThrow();
    const reopened = openDatabase(dbPath);
    try {
      expect(buildNovelDetail(reopened, id).novel).toMatchObject({
        chapterLengthMin: 2500,
        chapterLengthMax: 4000,
        stylePassScore: 75,
      });
    } finally {
      reopened.close();
    }
    await rm(dir, { recursive: true, force: true });
  });
});

describe("query CLI update-foreshadow", () => {
  test("改必填值 / 清空可选项（null 语义）/ 改登场章与服务角色 / 回收章随编辑覆盖或清空 / 返回条目含 actNodeId 与 recoverActNodeId", async () => {
    const { db } = await newFixture();
    const id = "dddddddd-0000-7000-8000-000000000001";
    new NovelStore(db).createNovel({ id, name: "伏笔编辑之书" });
    const outlineStore = new OutlineStore(db);
    const tree = outlineStore.saveOutlineTree(id, [
      { name: "第一部", summary: "概述", acts: [
        { name: "第1幕", summary: "梗概", keyPlotPoints: ["情节点"] },
        { name: "第2幕", summary: "梗概", keyPlotPoints: ["情节点"] },
      ] },
    ]);
    const act1 = tree.find((n) => n.node.type === "act")!;
    const chapters = outlineStore.saveChapters(id, act1.id, [
      { name: "第一章", summary: "概述" },
      { name: "第二章", summary: "概述" },
    ]);
    const chapter1 = chapters[0]!;
    const characterStore = new CharacterStore(db);
    const charA = characterStore.addCharacter(id, character);
    const charB = characterStore.addCharacter(id, { ...character, basicInfo: { name: "老周", gender: "男" } });
    const fs = new ForeshadowStore(db).addForeshadow(id, {
      surfaceAction: "宗主赐下断脉散",
      hiddenTruth: "药中掺了蛊种",
      attentionLevel: 6,
      recoveryStatus: "unrecovered",
      plantingMethod: "对话",
      purpose: "引子",
      appearChapterId: chapter1.id,
      recoverChapterIds: ["chapter-recover-keep"],
      characterIds: [charA.id],
    }, act1.id, act1.id);

    const updated = updateForeshadowEntry(db, id, fs.id, JSON.stringify({
      surfaceAction: "宗主赐下的药",
      hiddenTruth: "药中掺了追踪蛊种",
      attentionLevel: 8,
      recoveryStatus: "partial",
      appearChapterId: chapters[1]!.id,
      characterIds: [charB.id],
      recoverChapterIds: [chapters[1]!.id],
    }));

    expect(updated.id).toBe(fs.id);
    expect(updated.actNodeId).toBe(act1.id);          // 幕归属不受编辑影响
    expect(updated.surfaceAction).toBe("宗主赐下的药");
    expect(updated.attentionLevel).toBe(8);
    expect(updated.recoveryStatus).toBe("partial");
    expect(updated.plantingMethod).toBeUndefined();   // 未携带 → 清空
    expect(updated.purpose).toBeUndefined();
    expect(updated.appearChapterId).toBe(chapters[1]!.id);
    expect(updated.characterIds).toEqual([charB.id]);
    expect(updated.recoverChapterIds).toEqual([chapters[1]!.id]); // 回收章随编辑覆盖
    expect(updated.recoverActNodeId).toBe(act1.id);               // 回收幕不受编辑影响（编辑面只编辑回收章）
    expect(new ForeshadowStore(db).getForeshadow(fs.id)?.foreshadow.hiddenTruth).toBe("药中掺了追踪蛊种");

    // 再提交不携带回收章 → null 清空（编辑面语义：未勾选 = 清空全部回收章）
    const cleared = updateForeshadowEntry(db, id, fs.id, JSON.stringify({
      surfaceAction: "宗主赐下的药",
      hiddenTruth: "药中掺了追踪蛊种",
      attentionLevel: 8,
      recoveryStatus: "partial",
      appearChapterId: chapters[1]!.id,
      characterIds: [charB.id],
    }));
    expect(cleared.recoverChapterIds).toBeUndefined();
    db.close();
  });

  test("伏笔不存在：抛可读错误", async () => {
    const { db } = await newFixture();
    const id = "dddddddd-0000-7000-8000-000000000002";
    new NovelStore(db).createNovel({ id });
    expect(() =>
      updateForeshadowEntry(db, id, "no-such-fs", JSON.stringify({
        surfaceAction: "x", hiddenTruth: "y", attentionLevel: 1, recoveryStatus: "unrecovered",
      })),
    ).toThrow("伏笔不存在");
    db.close();
  });
});

describe("query CLI 参考文风（add-style / update-style / delete-style）", () => {
  test("add-style 入库后 buildNovelDetail 携带条目（按入库顺序）；小说不存在与 JSON 非法抛可读错误", async () => {
    const { db } = await newFixture();
    const id = "eeeeeeee-0000-7000-8000-000000000001";
    new NovelStore(db).createNovel({ id, name: "文风之书" });

    const added = addStyleEntry(db, id, JSON.stringify({
      name: "江南式打斗",
      content: "刀光一闪，血溅三步。",
    }));
    expect(added.name).toBe("江南式打斗");
    expect(added.enabled).toBe(true);
    addStyleEntry(db, id, JSON.stringify({ name: "张爱玲腔", content: "生命是一袭华美的袍。", enabled: false }));

    const detail = buildNovelDetail(db, id);
    expect(detail.styleReferences).toHaveLength(2);
    expect(detail.styleReferences.map((s) => s.name)).toEqual(["江南式打斗", "张爱玲腔"]);
    expect(detail.styleReferences[1]?.enabled).toBe(false);

    expect(() => addStyleEntry(db, "no-such-novel", JSON.stringify({ name: "x", content: "y" }))).toThrow(
      "小说不存在",
    );
    expect(() => addStyleEntry(db, id, "{not-json")).toThrow("解析失败");
    expect(() => addStyleEntry(db, id, JSON.stringify({ name: "", content: "y" }))).toThrow("不合法");
    db.close();
  });

  test("update-style 全量编辑返回更新后条目；delete-style 删除后清单减少", async () => {
    const { db } = await newFixture();
    const id = "eeeeeeee-0000-7000-8000-000000000002";
    new NovelStore(db).createNovel({ id });
    const added = addStyleEntry(db, id, JSON.stringify({ name: "原名", content: "原内容" }));

    const updated = updateStyleEntry(db, id, added.id, JSON.stringify({
      name: "新名",
      content: "新内容",
      enabled: false,
    }));
    expect(updated.id).toBe(added.id);
    expect(updated).toEqual({
      id: added.id,
      name: "新名",
      content: "新内容",
      enabled: false,
    });

    deleteStyleEntry(db, added.id);
    expect(buildNovelDetail(db, id).styleReferences).toHaveLength(0);
    expect(() => deleteStyleEntry(db, added.id)).toThrow("参考文风不存在");
    expect(() =>
      updateStyleEntry(db, id, "no-such-style", JSON.stringify({ name: "x", content: "y", enabled: true })),
    ).toThrow("参考文风不存在");
    db.close();
  });
});

describe("query CLI 角色迁移（add / update / confirm / cancel + 详情契约）", () => {
  /** 小说 + 部/幕 + 若干章 + 一名角色：迁移命令的最小可用库 */
  async function migrationFixture() {
    const { db } = await newFixture();
    const novelId = "12121212-0000-7000-8000-000000000001";
    new NovelStore(db).createNovel({ id: novelId });
    const outlineStore = new OutlineStore(db);
    outlineStore.saveOutlineTree(novelId, [
      { name: "第一部", summary: "部梗概", acts: [{ name: "第一幕", summary: "幕梗概", keyPlotPoints: ["点一"] }] },
    ]);
    const act = outlineStore
      .listOutlineNodes(novelId, { currentOnly: true })
      .find((node) => node.node.type === "act")!;
    const chapters = outlineStore.saveChapters(novelId, act.id, [
      { name: "第一章", summary: "概述一" },
      { name: "第二章", summary: "概述二" },
      { name: "第三章", summary: "概述三" },
      { name: "第四章", summary: "概述四" },
    ]);
    const character = new CharacterStore(db).addCharacter(novelId, {
      basicInfo: { name: "林澜", gender: "女" },
      core: { desire: "找到妹妹", fear: "失去同伴", narrativeRole: "主角" },
      background: "殖民城市长大的孤儿领航员",
      personality: "热情",
      creationPurpose: "驱动主线冲突的核心视角",
      endingDirection: "公开真相并拯救城市",
    });
    return { db, novelId, chapters, character };
  }

  test("原子新建并确认：失败零行零快照，重试不会重复草案或消耗序号", async () => {
    const { db, novelId, chapters, character } = await migrationFixture();
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        expect(() => saveMigrationEntry(db, novelId, character.id, JSON.stringify({
          action: "create", input: { migrateField: "personality", newValue: "谨慎" }, confirm: true,
        }))).toThrow("起始章");
        expect(buildNovelDetail(db, novelId).migrations).toHaveLength(0);
        expect(buildNovelDetail(db, novelId).migrationVersions).toHaveLength(0);
      }
      const confirmed = saveMigrationEntry(db, novelId, character.id, JSON.stringify({
        action: "create", input: {
          migrateField: "personality", newValue: "谨慎", startChapterId: chapters[0]!.id,
          trigger: "背叛", transitionGuidance: "收敛",
        }, confirm: true,
      }));
      expect(confirmed).toMatchObject({ status: "confirmed", sequence: 1, revision: 2, oldValue: "热情" });
      expect(buildNovelDetail(db, novelId).migrations).toHaveLength(1);
    } finally { db.close(); }
  });

  test("原子编辑并确认的重叠校验失败：草案整行与既有历史都回滚", async () => {
    const { db, novelId, chapters, character } = await migrationFixture();
    try {
      saveMigrationEntry(db, novelId, character.id, JSON.stringify({
        action: "create", input: {
          migrateField: "personality", newValue: "谨慎", startChapterId: chapters[0]!.id,
          endChapterId: chapters[1]!.id, trigger: "背叛", transitionGuidance: "收敛",
        }, confirm: true,
      }));
      const draft = addMigrationEntry(db, novelId, character.id, JSON.stringify({ migrateField: "personality", newValue: "冷漠" }));
      const before = buildNovelDetail(db, novelId);
      expect(() => saveMigrationEntry(db, novelId, character.id, JSON.stringify({
        action: "update", migrationId: draft.id, patch: {
          newValue: "多疑", startChapterId: chapters[1]!.id,
          trigger: "失望", transitionGuidance: "失去信任",
        }, confirm: true,
      }))).toThrow("重叠");
      const after = buildNovelDetail(db, novelId);
      expect(after.migrations).toEqual(before.migrations);
      expect(after.migrationVersions).toEqual(before.migrationVersions);
    } finally { db.close(); }
  });

  test("原子编辑已确认记录保持确认状态，取消后详情携带确认快照", async () => {
    const { db, novelId, chapters, character } = await migrationFixture();
    try {
      const confirmed = saveMigrationEntry(db, novelId, character.id, JSON.stringify({
        action: "create", input: {
          migrateField: "personality", newValue: "谨慎", startChapterId: chapters[0]!.id,
          trigger: "背叛", transitionGuidance: "收敛",
        }, confirm: true,
      }));
      const edited = saveMigrationEntry(db, novelId, character.id, JSON.stringify({
        action: "update", migrationId: confirmed.id, patch: { trigger: "背叛与孤立" }, confirm: true,
      }));
      expect(edited).toMatchObject({ status: "confirmed", revision: 3, trigger: "背叛与孤立" });
      cancelMigrationEntry(db, novelId, confirmed.id);
      const detail = buildNovelDetail(db, novelId);
      expect(detail.migrationVersions).toHaveLength(3);
      expect(detail.migrationVersions[2]).toMatchObject({ migrationId: confirmed.id, revision: 3, migration: { status: "confirmed", trigger: "背叛与孤立" } });
    } finally { db.close(); }
  });

  test("原子提交不得更新另一个角色的迁移，载荷不合法也零写入", async () => {
    const { db, novelId, character } = await migrationFixture();
    try {
      const other = new CharacterStore(db).addCharacter(novelId, { ...character.character, basicInfo: { name: "其他角色" } });
      const draft = addMigrationEntry(db, novelId, character.id, JSON.stringify({ migrateField: "personality", newValue: "谨慎" }));
      expect(() => saveMigrationEntry(db, novelId, other.id, JSON.stringify({ action: "update", migrationId: draft.id, patch: { newValue: "冷漠" }, confirm: false }))).toThrow("不属于该角色");
      expect(() => saveMigrationEntry(db, novelId, character.id, JSON.stringify({ action: "update", patch: {}, confirm: true }))).toThrow("不合法");
      expect(buildNovelDetail(db, novelId).migrations).toEqual([draft]);
      expect(buildNovelDetail(db, novelId).migrationVersions).toHaveLength(0);
    } finally { db.close(); }
  });

  test("save-migration 真实 CLI 往返：合法提交入库，重叠失败不残留新草案", async () => {
    const { db, novelId, character, chapters } = await migrationFixture();
    const dbPath = db.filename;
    db.close();
    const run = (request: unknown) => execFileSync("bun", [join(import.meta.dir, "query.ts"), "save-migration", novelId, character.id, JSON.stringify(request)], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NOVEL_DB_PATH: dbPath },
    });
    const request = { action: "create", input: { migrateField: "personality", newValue: "谨慎", startChapterId: chapters[0]!.id, trigger: "背叛", transitionGuidance: "收敛" }, confirm: true };
    expect(JSON.parse(run(request))).toMatchObject({ status: "confirmed", oldValue: "热情" });
    expect(() => run(request)).toThrow();
    const reopened = openDatabase(dbPath);
    try {
      expect(buildNovelDetail(reopened, novelId).migrations).toHaveLength(1);
      expect(buildNovelDetail(reopened, novelId).migrationVersions).toHaveLength(1);
    } finally { reopened.close(); }
  });

  test("add-migration 新建草案：旧值服务端派生，详情契约返回迁移", async () => {
    const { db, novelId, chapters, character } = await migrationFixture();
    const draft = addMigrationEntry(
      db,
      novelId,
      character.id,
      JSON.stringify({
        migrateField: "personality",
        newValue: "谨慎",
        startChapterId: chapters[0]!.id,
        trigger: "经历背叛",
        transitionGuidance: "逐渐收敛外放",
      }),
    );
    expect(draft).toMatchObject({
      novelId,
      characterId: character.id,
      migrateField: "personality",
      oldValue: "热情",
      newValue: "谨慎",
      sequence: 1,
      revision: 1,
      status: "draft",
      outlineVersion: 1,
      groupId: null,
    });

    const detail = buildNovelDetail(db, novelId);
    expect(detail.migrations).toHaveLength(1);
    expect(detail.migrations[0]!.id).toBe(draft.id);
    db.close();
  });

  test("update / confirm / cancel 往返：patch 语义与状态流转", async () => {
    const { db, novelId, chapters, character } = await migrationFixture();
    const draft = addMigrationEntry(
      db,
      novelId,
      character.id,
      JSON.stringify({
        migrateField: "personality",
        newValue: "谨慎",
        startChapterId: chapters[0]!.id,
      }),
    );
    const patched = updateMigrationEntry(
      db,
      novelId,
      draft.id,
      JSON.stringify({ endChapterId: chapters[2]!.id, trigger: "经历背叛", transitionGuidance: "逐渐收敛" }),
    );
    expect(patched.endChapterId).toBe(chapters[2]!.id);
    expect(patched.revision).toBe(2);

    const confirmed = confirmMigrationEntry(db, novelId, draft.id);
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.oldValue).toBe("热情");
    expect(confirmed.revision).toBe(3);

    expect(() => confirmMigrationEntry(db, novelId, draft.id)).toThrow("已确认");
    const cancelled = cancelMigrationEntry(db, novelId, draft.id);
    expect(cancelled.status).toBe("cancelled");
    expect(() => cancelMigrationEntry(db, novelId, draft.id)).toThrow("已取消");
    db.close();
  });

  test("非法入参被拒：未知字段 / 必填目标值为空 / 非章节点起始章", async () => {
    const { db, novelId, character } = await migrationFixture();
    expect(() =>
      addMigrationEntry(db, novelId, character.id, JSON.stringify({ migrateField: "nope", newValue: "x" })),
    ).toThrow("迁移数据不合法");
    expect(() =>
      addMigrationEntry(
        db,
        novelId,
        character.id,
        JSON.stringify({ migrateField: "core.desire", newValue: "" }),
      ),
    ).toThrow("必填");
    expect(() =>
      addMigrationEntry(
        db,
        novelId,
        character.id,
        JSON.stringify({ migrateField: "personality", newValue: "谨慎", startChapterId: "no-such-chapter" }),
      ),
    ).toThrow("起始章不存在");
    expect(() => updateMigrationEntry(db, novelId, "no-such-migration", JSON.stringify({}))).toThrow(
      "迁移记录不存在",
    );
    db.close();
  });

  test("update-character 命令已退役：基准卡不可直接编辑", async () => {
    // 经真实 CLI 子进程调用（其余命令走导出函数，此处验证命令入口的显式拒绝语义）
    const script = join(import.meta.dir, "query.ts");
    const { db, dir } = await newFixture();
    db.close();
    try {
      execFileSync("bun", ["run", script, "update-character", "novel", "char", "{}"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, NOVEL_DB_PATH: join(dir, "test.db") },
      });
      throw new Error("应当以非零退出");
    } catch (error) {
      const stderr = (error as { stderr?: string }).stderr ?? "";
      expect(stderr).toContain("角色基准卡不可直接编辑");
    }
  });

  test("delete 级联清理迁移与修订快照", async () => {
    const { db, novelId, chapters, character } = await migrationFixture();
    const draft = addMigrationEntry(
      db,
      novelId,
      character.id,
      JSON.stringify({
        migrateField: "personality",
        newValue: "谨慎",
        startChapterId: chapters[0]!.id,
        trigger: "经历背叛",
        transitionGuidance: "逐渐收敛",
      }),
    );
    confirmMigrationEntry(db, novelId, draft.id);
    deleteNovel(db, novelId);
    const raw = db as unknown as { query: (sql: string) => { get: () => unknown } };
    expect(raw.query("SELECT COUNT(*) AS c FROM character_migrations").get()).toEqual({ c: 0 });
    expect(raw.query("SELECT COUNT(*) AS c FROM character_migration_versions").get()).toEqual({ c: 0 });
    db.close();
  });
});

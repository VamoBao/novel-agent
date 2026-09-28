import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./db";
import { DocumentStore } from "./document-store";
import { NovelStore } from "./novel-store";
import { OutlineStore } from "./outline-store";

/**
 * DocumentStore 单元测试（元数据形态：正文内容存文件、库内只留 file_path 与字数）：
 * 临时目录 SQLite 上验证保存绑定事务（元数据入库 + 章节点 document_id 回写 +
 * status=completed）、一章一份 / 节点类型 / 归属校验、路径批量更新与整本删除级联。
 */

const NOVEL_ID = "aaaaaaaa-0000-7000-8000-0000000000a0";
const OTHER_NOVEL_ID = "aaaaaaaa-0000-7000-8000-0000000000a1";

interface TestContext {
  novelStore: NovelStore;
  outlineStore: OutlineStore;
  documentStore: DocumentStore;
  actNodeId: string;
  chapterNodeId: string;
  secondChapterNodeId: string;
  partNodeId: string;
  cleanup: () => Promise<void>;
}

async function setupDb(): Promise<TestContext> {
  const dir = await mkdtemp(join(tmpdir(), "novel-document-"));
  const db = openDatabase(join(dir, "test.db"));
  const novelStore = new NovelStore(db);
  const outlineStore = new OutlineStore(db);
  const documentStore = new DocumentStore(db);
  novelStore.createNovel({ id: NOVEL_ID, name: "灵脉拾遗" });
  novelStore.createNovel({ id: OTHER_NOVEL_ID });
  const [part, act] = outlineStore.saveOutlineTree(NOVEL_ID, [
    {
      name: "第一部",
      summary: "灵脉断绝，少年拾遗",
      acts: [{ name: "第一幕", summary: "市集风波", keyPlotPoints: ["拾得灵脉碎片"] }],
    },
  ]);
  const chapters = outlineStore.saveChapters(NOVEL_ID, act!.id, [
    { name: "第一章", summary: "少年在市集拾得碎片" },
    { name: "第二章", summary: "宗门来人追查" },
  ]);
  return {
    novelStore,
    outlineStore,
    documentStore,
    partNodeId: part!.id,
    actNodeId: act!.id,
    chapterNodeId: chapters[0]!.id,
    secondChapterNodeId: chapters[1]!.id,
    cleanup: async () => {
      db.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

describe("DocumentStore", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterAll(async () => {
    await Promise.all(cleanups.map((fn) => fn()));
  });

  test("保存元数据：单事务入库 + 章节点绑定 document_id 并置 completed", async () => {
    const ctx = await setupDb();
    cleanups.push(ctx.cleanup);

    const filePath = join("灵脉拾遗", "第一部", "第一章.md");
    const document = ctx.documentStore.saveChapterDocument(
      NOVEL_ID,
      ctx.chapterNodeId,
      filePath,
      24,
    );

    expect(document.novelId).toBe(NOVEL_ID);
    expect(document.chapterId).toBe(ctx.chapterNodeId);
    expect(document.filePath).toBe(filePath);
    expect(document.wordCount).toBe(24);

    // 章节点回写：document_id 指向正文主键、状态计划中 → 写作完成
    const chapter = ctx.outlineStore.getOutlineNode(ctx.chapterNodeId)!;
    expect(chapter.node.documentId).toBe(document.id);
    expect(chapter.node.status).toBe("completed");

    // getDocumentByChapter / listDocuments 读回一致
    expect(ctx.documentStore.getDocumentByChapter(ctx.chapterNodeId)?.id).toBe(document.id);
    expect(ctx.documentStore.listDocuments(NOVEL_ID)).toHaveLength(1);
  });

  test("一章一份：同章重复保存被拒绝（可读错误）", async () => {
    const ctx = await setupDb();
    cleanups.push(ctx.cleanup);
    ctx.documentStore.saveChapterDocument(NOVEL_ID, ctx.chapterNodeId, "a/b/c.md", 9);
    expect(() =>
      ctx.documentStore.saveChapterDocument(NOVEL_ID, ctx.chapterNodeId, "a/b/c-2.md", 9),
    ).toThrow("已有正文");
  });

  test("目标校验：不存在 / 异小说 / 非章节点（幕与部）均报可读错误", async () => {
    const ctx = await setupDb();
    cleanups.push(ctx.cleanup);

    expect(() =>
      ctx.documentStore.saveChapterDocument(NOVEL_ID, "ffffffff-0000-7000-8000-0000000000f1", "a.md", 1),
    ).toThrow("章节节点不存在或不属于该小说");

    expect(() =>
      ctx.documentStore.saveChapterDocument(OTHER_NOVEL_ID, ctx.chapterNodeId, "a.md", 1),
    ).toThrow("章节节点不存在或不属于该小说");

    expect(() =>
      ctx.documentStore.saveChapterDocument(NOVEL_ID, ctx.actNodeId, "a.md", 1),
    ).toThrow("不是章");
    expect(() =>
      ctx.documentStore.saveChapterDocument(NOVEL_ID, ctx.partNodeId, "a.md", 1),
    ).toThrow("不是章");
  });

  test("空路径被 schema 拒绝（file_path 必须非空）", async () => {
    const ctx = await setupDb();
    cleanups.push(ctx.cleanup);
    expect(() => ctx.documentStore.saveChapterDocument(NOVEL_ID, ctx.chapterNodeId, "", 1)).toThrow();
    // 失败后章节点不残留绑定
    const chapter = ctx.outlineStore.getOutlineNode(ctx.chapterNodeId)!;
    expect(chapter.node.documentId).toBeNull();
    expect(ctx.documentStore.listDocuments(NOVEL_ID)).toHaveLength(0);
  });

  test("另一章可独立保存（幕下多章各自一份正文）", async () => {
    const ctx = await setupDb();
    cleanups.push(ctx.cleanup);
    ctx.documentStore.saveChapterDocument(NOVEL_ID, ctx.chapterNodeId, "n/p/1.md", 6);
    const second = ctx.documentStore.saveChapterDocument(
      NOVEL_ID,
      ctx.secondChapterNodeId,
      "n/p/2.md",
      6,
    );
    expect(second.chapterId).toBe(ctx.secondChapterNodeId);
    expect(ctx.documentStore.listDocuments(NOVEL_ID)).toHaveLength(2);
  });

  test("updateFilePaths：批量更新路径（小说改名迁移联动），空路径被拒绝", async () => {
    const ctx = await setupDb();
    cleanups.push(ctx.cleanup);
    const first = ctx.documentStore.saveChapterDocument(NOVEL_ID, ctx.chapterNodeId, "旧名/部/章.md", 6);
    const second = ctx.documentStore.saveChapterDocument(
      NOVEL_ID,
      ctx.secondChapterNodeId,
      "旧名/部/章2.md",
      6,
    );

    ctx.documentStore.updateFilePaths([
      { id: first.id, filePath: "新名/部/章.md" },
      { id: second.id, filePath: "新名/部/章2.md" },
    ]);
    const paths = ctx.documentStore
      .listDocuments(NOVEL_ID)
      .map((d) => d.filePath)
      .sort();
    expect(paths).toEqual(["新名/部/章.md", "新名/部/章2.md"].sort());

    expect(() =>
      ctx.documentStore.updateFilePaths([{ id: first.id, filePath: "" }]),
    ).toThrow();
    // 事务原子：非法项拒绝后，第一条路径不被部分更新
    expect(ctx.documentStore.getDocumentByChapter(ctx.chapterNodeId)!.filePath).toBe("新名/部/章.md");
  });

  test("整本删除级联清理正文元数据（deleteNovel 单事务）", async () => {
    const ctx = await setupDb();
    cleanups.push(ctx.cleanup);
    ctx.documentStore.saveChapterDocument(NOVEL_ID, ctx.chapterNodeId, "n/p/章.md", 8);
    ctx.novelStore.deleteNovel(NOVEL_ID);
    expect(ctx.documentStore.listDocuments(NOVEL_ID)).toHaveLength(0);
  });
});

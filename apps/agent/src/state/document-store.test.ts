import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./db";
import { DocumentStore } from "./document-store";
import { NovelStore } from "./novel-store";
import { OutlineStore } from "./outline-store";

/**
 * DocumentStore 单元测试：临时目录 SQLite 上验证保存绑定事务
 * （正文入库 + 章节点 document_id 回写 + status=completed）、
 * 一章一份 / 节点类型 / 归属校验与整本删除级联。
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
  novelStore.createNovel({ id: NOVEL_ID });
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

  test("保存正文：单事务入库 + 章节点绑定 document_id 并置 completed，字数不计空白", async () => {
    const ctx = await setupDb();
    cleanups.push(ctx.cleanup);

    const document = ctx.documentStore.saveChapterDocument(
      NOVEL_ID,
      ctx.chapterNodeId,
      "灵脉断绝的第九十九年。\n\n少年在市集的角落里睁开眼。",
    );

    expect(document.novelId).toBe(NOVEL_ID);
    expect(document.chapterId).toBe(ctx.chapterNodeId);
    // 两句正文共 24 个汉字/标点，空白（换行）不计
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
    ctx.documentStore.saveChapterDocument(NOVEL_ID, ctx.chapterNodeId, "第一次生成的正文。");
    expect(() =>
      ctx.documentStore.saveChapterDocument(NOVEL_ID, ctx.chapterNodeId, "第二次生成的正文。"),
    ).toThrow("已有正文");
  });

  test("目标校验：不存在 / 异小说 / 非章节点（幕与部）均报可读错误", async () => {
    const ctx = await setupDb();
    cleanups.push(ctx.cleanup);

    expect(() =>
      ctx.documentStore.saveChapterDocument(NOVEL_ID, "ffffffff-0000-7000-8000-0000000000f1", "正文"),
    ).toThrow("章节节点不存在或不属于该小说");

    expect(() =>
      ctx.documentStore.saveChapterDocument(OTHER_NOVEL_ID, ctx.chapterNodeId, "正文"),
    ).toThrow("章节节点不存在或不属于该小说");

    expect(() =>
      ctx.documentStore.saveChapterDocument(NOVEL_ID, ctx.actNodeId, "正文"),
    ).toThrow("不是章");
    expect(() =>
      ctx.documentStore.saveChapterDocument(NOVEL_ID, ctx.partNodeId, "正文"),
    ).toThrow("不是章");
  });

  test("空内容被 schema 拒绝（正文必须非空）", async () => {
    const ctx = await setupDb();
    cleanups.push(ctx.cleanup);
    expect(() =>
      ctx.documentStore.saveChapterDocument(NOVEL_ID, ctx.chapterNodeId, ""),
    ).toThrow();
    // 失败后章节点不残留绑定
    const chapter = ctx.outlineStore.getOutlineNode(ctx.chapterNodeId)!;
    expect(chapter.node.documentId).toBeNull();
    expect(ctx.documentStore.listDocuments(NOVEL_ID)).toHaveLength(0);
  });

  test("另一章可独立保存（幕下多章各自一份正文）", async () => {
    const ctx = await setupDb();
    cleanups.push(ctx.cleanup);
    ctx.documentStore.saveChapterDocument(NOVEL_ID, ctx.chapterNodeId, "第一章正文。");
    const second = ctx.documentStore.saveChapterDocument(
      NOVEL_ID,
      ctx.secondChapterNodeId,
      "第二章正文。",
    );
    expect(second.chapterId).toBe(ctx.secondChapterNodeId);
    expect(ctx.documentStore.listDocuments(NOVEL_ID)).toHaveLength(2);
  });

  test("整本删除级联清理正文（deleteNovel 单事务）", async () => {
    const ctx = await setupDb();
    cleanups.push(ctx.cleanup);
    ctx.documentStore.saveChapterDocument(NOVEL_ID, ctx.chapterNodeId, "即将随小说删除的正文。");
    ctx.novelStore.deleteNovel(NOVEL_ID);
    expect(ctx.documentStore.listDocuments(NOVEL_ID)).toHaveLength(0);
  });
});

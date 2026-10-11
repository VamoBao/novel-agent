import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../state/db";
import { NovelStore } from "../state/novel-store";
import { OutlineStore } from "../state/outline-store";
import { CharacterStore } from "../state/character-store";
import { DocumentStore } from "../state/document-store";
import { ForeshadowStore } from "../state/foreshadow-store";
import { writeDocumentArtifact } from "../output/document-writer";
import type { Character, Foreshadow } from "@novel/shared";
import { FORESHADOW_PROSE_BUDGET, buildChapterForeshadowContext } from "./foreshadow-context";

/**
 * foreshadow-context 模块单测：临时库建小说/角色/一部一幕四章/伏笔/正文行，
 * 直接调 buildChapterForeshadowContext 断言 prompt 行与计数——零 LLM、零 channel。
 */

const NOVEL_ID = "eeeeeeee-4444-7444-8555-666677778888";

const characterFixture = {
  basicInfo: { name: "林恒" },
  core: { desire: "夺回灵脉", fear: "辜负同伴", narrativeRole: "主角" },
  background: "青云市集的散修少年",
  creationPurpose: "承载打破宗门垄断的主线",
  endingDirection: "打破垄断后归隐",
} satisfies Character;

const PROSE_C1 = "　　少年把碎片藏进袖中，指腹擦过那道细如发丝的刻痕。\n\n　　宗门的告示贴在市集口，墨迹未干。";

function foreshadowFixture(overrides: Partial<Foreshadow> = {}): Foreshadow {
  return {
    surfaceAction: "少年拾得的碎片刻有宗门印记",
    hiddenTruth: "碎片是宗门失窃的镇脉之物",
    attentionLevel: 7,
    recoveryStatus: "unrecovered",
    ...overrides,
  };
}

interface TestCtx {
  db: ReturnType<typeof openDatabase>;
  outlineStore: OutlineStore;
  characterStore: CharacterStore;
  documentStore: DocumentStore;
  foreshadowStore: ForeshadowStore;
  outputDir: string;
  linId: string;
  chenId: string;
  c1: string;
  c2: string;
  c3: string;
  c4: string;
  build: (chapterNodeId: string) => ReturnType<typeof buildChapterForeshadowContext>;
  cleanup: () => Promise<void>;
}

async function setupDb(): Promise<TestCtx> {
  const dir = await mkdtemp(join(tmpdir(), "novel-fctx-"));
  const db = openDatabase(join(dir, "test.db"));
  const outputDir = join(dir, "output");
  const novelStore = new NovelStore(db);
  const outlineStore = new OutlineStore(db);
  const characterStore = new CharacterStore(db);
  const documentStore = new DocumentStore(db);
  const foreshadowStore = new ForeshadowStore(db);
  novelStore.createNovel({ id: NOVEL_ID, name: "灵脉拾遗" });
  const lin = characterStore.addCharacter(NOVEL_ID, characterFixture);
  const chen = characterStore.addCharacter(NOVEL_ID, {
    ...characterFixture,
    basicInfo: { name: "陈默" },
  });
  const [, act] = outlineStore.saveOutlineTree(NOVEL_ID, [
    {
      name: "第一部",
      summary: "灵脉断绝，少年拾遗",
      acts: [{ name: "第一幕", summary: "市集风波", keyPlotPoints: ["拾得灵脉碎片"] }],
    },
  ]);
  const chapters = outlineStore.saveChapters(NOVEL_ID, act!.id, [
    { name: "第一章", summary: "少年在市集拾得碎片" },
    { name: "第二章", summary: "宗门来人追查" },
    { name: "第三章", summary: "碎片来历初现" },
    { name: "第四章", summary: "印记之谜揭晓" },
  ]);
  return {
    db,
    outlineStore,
    characterStore,
    documentStore,
    foreshadowStore,
    outputDir,
    linId: lin.id,
    chenId: chen.id,
    c1: chapters[0]!.id,
    c2: chapters[1]!.id,
    c3: chapters[2]!.id,
    c4: chapters[3]!.id,
    build: (chapterNodeId: string) =>
      buildChapterForeshadowContext({
        novelId: NOVEL_ID,
        chapterNodeId,
        foreshadowStore,
        outlineStore,
        documentStore,
        characterStore,
        outputDir,
      }),
    cleanup: async () => {
      db.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

describe("buildChapterForeshadowContext", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterAll(async () => {
    await Promise.all(cleanups.map((fn) => fn()));
  });

  test("无绑定伏笔：lines 为空、计数全 0（零注入信号）", async () => {
    const ctx = await setupDb();
    cleanups.push(ctx.cleanup);
    const result = ctx.build(ctx.c2);
    expect(result.lines).toEqual([]);
    expect(result.appearCount).toBe(0);
    expect(result.recoverCount).toBe(0);
    expect(result.degradedCount).toBe(0);
  });

  test("登场伏笔：卡片全字段注入（可选字段与服务角色名解析、未匹配兜底原 ID）", async () => {
    const ctx = await setupDb();
    cleanups.push(ctx.cleanup);
    ctx.foreshadowStore.addForeshadow(NOVEL_ID, {
      ...foreshadowFixture({
        plantingMethod: "借市集喧闹一笔带过",
        purpose: "为第四幕宗门追查埋线",
        appearChapterId: ctx.c2,
        characterIds: [ctx.linId, ctx.chenId],
      }),
    });
    // 未匹配角色 ID 属数据异常（store 写入侧有同小说校验拦不住手工改库）——SQL 直插模拟
    ctx.db
      .prepare(
        `INSERT INTO foreshadows (
           id, novel_id, surface_action, hidden_truth, attention_level, recovery_status,
           planting_method, purpose, appear_chapter_id, recover_chapter_ids, character_ids,
           act_node_id, recover_act_node_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'unrecovered', ?, ?, ?, ?, ?, NULL, NULL, ?, ?);`,
      )
      .run(
        "ffffffff-0000-7000-8000-00000000b0gus",
        NOVEL_ID,
        "告示栏多出一张无名告示",
        "告示出自宗门内鬼",
        5,
        null,
        null,
        ctx.c2,
        null,
        JSON.stringify(["bogus-character-id"]),
        new Date().toISOString(),
        new Date().toISOString(),
      );
    const result = ctx.build(ctx.c2);
    const text = result.lines.join("\n");
    expect(result.lines[0]).toBe("【本章伏笔】");
    expect(text).toContain("一、本章登场");
    expect(text).toContain("表面行为：少年拾得的碎片刻有宗门印记");
    expect(text).toContain("隐藏真相（仅供把握分寸，本章不得点破）：碎片是宗门失窃的镇脉之物");
    expect(text).toContain("注意度：7/10");
    expect(text).toContain("埋线方式：借市集喧闹一笔带过");
    expect(text).toContain("创作目的：为第四幕宗门追查埋线");
    expect(text).toContain(`服务角色：林恒、陈默`);
    expect(text).toContain("表面行为：告示栏多出一张无名告示");
    expect(text).toContain("服务角色：bogus-character-id");
    expect(text).not.toContain("二、本章回收");
    expect(result.appearCount).toBe(2);
    expect(result.recoverCount).toBe(0);
    expect(result.degradedCount).toBe(0);
  });

  test("登场伏笔可选字段缺省：对应行不渲染", async () => {
    const ctx = await setupDb();
    cleanups.push(ctx.cleanup);
    ctx.foreshadowStore.addForeshadow(NOVEL_ID, foreshadowFixture({ appearChapterId: ctx.c1 }));
    const text = ctx.build(ctx.c1).lines.join("\n");
    expect(text).not.toContain("埋线方式：");
    expect(text).not.toContain("创作目的：");
    expect(text).not.toContain("服务角色：");
  });

  test("回收伏笔登场章有正文：正文优先全文注入", async () => {
    const ctx = await setupDb();
    cleanups.push(ctx.cleanup);
    const rel = join("灵脉拾遗-eeeeeeee", "第一部", "第一章.md");
    writeDocumentArtifact(rel, PROSE_C1, ctx.outputDir);
    ctx.documentStore.saveChapterDocument(NOVEL_ID, ctx.c1, rel, 52);
    ctx.foreshadowStore.addForeshadow(
      NOVEL_ID,
      foreshadowFixture({ appearChapterId: ctx.c1, recoverChapterIds: [ctx.c2] }),
    );
    const result = ctx.build(ctx.c2);
    const text = result.lines.join("\n");
    expect(text).toContain("二、本章回收");
    expect(text).toContain("登场于《第一章》");
    expect(text).toContain("登场章正文（呼应其细节，不要照抄）：");
    expect(text).toContain(PROSE_C1);
    expect(text).not.toContain("剧情概述");
    expect(result.recoverCount).toBe(1);
    expect(result.degradedCount).toBe(0);
  });

  test("回收伏笔登场章未写：概述兜底并计数降级", async () => {
    const ctx = await setupDb();
    cleanups.push(ctx.cleanup);
    ctx.foreshadowStore.addForeshadow(
      NOVEL_ID,
      foreshadowFixture({ appearChapterId: ctx.c1, recoverChapterIds: [ctx.c2] }),
    );
    const result = ctx.build(ctx.c2);
    const text = result.lines.join("\n");
    expect(text).toContain("登场章正文未生成——该章剧情概述：少年在市集拾得碎片");
    expect(text).not.toContain("登场章正文（呼应其细节，不要照抄）：");
    expect(result.degradedCount).toBe(1);
  });

  test("回收伏笔登场章文件缺失（有元数据行无文件）：概述兜底并计数降级", async () => {
    const ctx = await setupDb();
    cleanups.push(ctx.cleanup);
    ctx.documentStore.saveChapterDocument(
      NOVEL_ID,
      ctx.c1,
      join("灵脉拾遗-eeeeeeee", "第一部", "第一章.md"),
      52,
    );
    ctx.foreshadowStore.addForeshadow(
      NOVEL_ID,
      foreshadowFixture({ appearChapterId: ctx.c1, recoverChapterIds: [ctx.c2] }),
    );
    const result = ctx.build(ctx.c2);
    expect(result.lines.join("\n")).toContain("登场章正文未生成——该章剧情概述：少年在市集拾得碎片");
    expect(result.degradedCount).toBe(1);
  });

  test("多步回收：只注入全局章序在当前章之前的既往回收章概述", async () => {
    const ctx = await setupDb();
    cleanups.push(ctx.cleanup);
    const f = ctx.foreshadowStore.addForeshadow(
      NOVEL_ID,
      foreshadowFixture({ appearChapterId: ctx.c1, recoverChapterIds: [ctx.c2, ctx.c3, ctx.c4] }),
    );
    // 当前章 = 第四章：既往回收 = 第二章、第三章（各一行，按 recoverChapterIds 去重后的章序）
    const late = ctx.build(ctx.c4).lines.join("\n");
    expect(late).toContain("既往回收：《第二章》——宗门来人追查");
    expect(late).toContain("既往回收：《第三章》——碎片来历初现");
    expect(late).not.toContain("既往回收：《第四章》");
    // 当前章 = 第三章：既往回收只剩第二章；第四章在其后，不得出现
    const mid = ctx.build(ctx.c3).lines.join("\n");
    expect(mid).toContain("既往回收：《第二章》——宗门来人追查");
    expect(mid).not.toContain("既往回收：《第三章》");
    expect(mid).not.toContain("既往回收：《第四章》");
    expect(f.id).toBeDefined();
  });

  test("预算护栏：按登场章序升序逐条扣减，超出整条降级概述、不截断已注入正文", async () => {
    const ctx = await setupDb();
    cleanups.push(ctx.cleanup);
    const rel1 = join("灵脉拾遗-eeeeeeee", "第一部", "第一章.md");
    const rel2 = join("灵脉拾遗-eeeeeeee", "第一部", "第二章.md");
    writeDocumentArtifact(rel1, "甲".repeat(FORESHADOW_PROSE_BUDGET - 500), ctx.outputDir);
    writeDocumentArtifact(rel2, "乙".repeat(600), ctx.outputDir);
    ctx.documentStore.saveChapterDocument(NOVEL_ID, ctx.c1, rel1, FORESHADOW_PROSE_BUDGET - 500);
    ctx.documentStore.saveChapterDocument(NOVEL_ID, ctx.c2, rel2, 600);
    ctx.foreshadowStore.addForeshadow(
      NOVEL_ID,
      foreshadowFixture({ surfaceAction: "先登场伏笔", appearChapterId: ctx.c1, recoverChapterIds: [ctx.c4] }),
    );
    ctx.foreshadowStore.addForeshadow(
      NOVEL_ID,
      foreshadowFixture({ surfaceAction: "后登场伏笔", appearChapterId: ctx.c2, recoverChapterIds: [ctx.c4] }),
    );
    const result = ctx.build(ctx.c4);
    const text = result.lines.join("\n");
    // 先登场（第一章）保住整条正文（预算内），后登场（第二章）超预算降级概述
    expect(text).toContain("甲".repeat(FORESHADOW_PROSE_BUDGET - 500));
    expect(text).not.toContain("乙".repeat(600));
    expect(text).toContain("登场章正文未生成——该章剧情概述：宗门来人追查");
    expect(result.degradedCount).toBe(1);
  });

  test("回收组排序：登场章全局章序升序（与入库顺序无关）", async () => {
    const ctx = await setupDb();
    cleanups.push(ctx.cleanup);
    // 先入库的伏笔登场章更晚（第二章），后入库的更早（第一章）——输出须按章序：先第一章
    ctx.foreshadowStore.addForeshadow(
      NOVEL_ID,
      foreshadowFixture({ surfaceAction: "晚登场条目", appearChapterId: ctx.c2, recoverChapterIds: [ctx.c4] }),
    );
    ctx.foreshadowStore.addForeshadow(
      NOVEL_ID,
      foreshadowFixture({ surfaceAction: "早登场条目", appearChapterId: ctx.c1, recoverChapterIds: [ctx.c4] }),
    );
    const text = ctx.build(ctx.c4).lines.join("\n");
    expect(text.indexOf("早登场条目")).toBeGreaterThan(-1);
    expect(text.indexOf("早登场条目")).toBeLessThan(text.indexOf("晚登场条目"));
  });

  test("同章种收：归回收组标「登场于本章」，不注入任何章内容", async () => {
    const ctx = await setupDb();
    cleanups.push(ctx.cleanup);
    ctx.foreshadowStore.addForeshadow(
      NOVEL_ID,
      foreshadowFixture({ appearChapterId: ctx.c2, recoverChapterIds: [ctx.c2] }),
    );
    const result = ctx.build(ctx.c2);
    const text = result.lines.join("\n");
    // 归回收组而非登场组：不重复注入卡片、不渲染登场分组
    expect(text).not.toContain("一、本章登场");
    expect(text).toContain("二、本章回收");
    expect(text).toContain("登场于本章：");
    expect((text.match(/表面行为：少年拾得的碎片刻有宗门印记/g) ?? []).length).toBe(1);
    expect(text).not.toContain("登场于《");
    expect(text).not.toContain("登场章正文");
    expect(result.appearCount).toBe(0);
    expect(result.recoverCount).toBe(1);
  });

  test("登场章节点不可解析（数据异常）：卡片照注入并标注，不计降级、不阻塞", async () => {
    const ctx = await setupDb();
    cleanups.push(ctx.cleanup);
    ctx.foreshadowStore.addForeshadow(
      NOVEL_ID,
      foreshadowFixture({
        appearChapterId: "ffffffff-0000-7000-8000-00000000dead",
        recoverChapterIds: [ctx.c2],
      }),
    );
    const result = ctx.build(ctx.c2);
    const text = result.lines.join("\n");
    expect(text).toContain("（登场章信息不可用）");
    expect(text).toContain("表面行为：少年拾得的碎片刻有宗门印记");
    expect(text).not.toContain("登场章正文");
    expect(result.degradedCount).toBe(0);
  });

  test("归档登场章（大纲换版后）：章名与正文照常解析（getOutlineNode 按 ID 直查不过滤版本）", async () => {
    const ctx = await setupDb();
    cleanups.push(ctx.cleanup);
    const rel = join("灵脉拾遗-eeeeeeee", "第一部", "第一章.md");
    writeDocumentArtifact(rel, PROSE_C1, ctx.outputDir);
    ctx.documentStore.saveChapterDocument(NOVEL_ID, ctx.c1, rel, 52);
    const f = ctx.foreshadowStore.addForeshadow(
      NOVEL_ID,
      foreshadowFixture({ appearChapterId: ctx.c1, recoverChapterIds: [ctx.c2] }),
    );
    // 大纲换版：旧树（含 c1/c2）整体归档，新树新幕下建新章
    const [, newAct] = ctx.outlineStore.saveOutlineTreeNewVersion(NOVEL_ID, [
      {
        name: "第一部（新版）",
        summary: "重整旗鼓",
        acts: [{ name: "第一幕（新版）", summary: "再起风波", keyPlotPoints: ["追查重启"] }],
      },
    ]);
    const newChapters = ctx.outlineStore.saveChapters(NOVEL_ID, newAct!.id, [
      { name: "新第一章", summary: "宗门重启追查" },
    ]);
    // 用户把回收章重绑到新版章（登场章保留指向归档旧章）
    ctx.foreshadowStore.updateForeshadow(f.id, { recoverChapterIds: [newChapters[0]!.id] });
    const result = ctx.build(newChapters[0]!.id);
    const text = result.lines.join("\n");
    expect(text).toContain("登场于《第一章》");
    expect(text).toContain(PROSE_C1);
    expect(result.degradedCount).toBe(0);
  });
});

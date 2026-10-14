import { afterAll, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { characterSchema, type Character } from "@novel/shared";
import { openDatabase } from "../state/db";
import { CharacterStore } from "../state/character-store";
import { CharacterMigrationStore } from "../state/migration-store";
import { DocumentStore } from "../state/document-store";
import { NovelStore } from "../state/novel-store";
import { OutlineStore, type StoredOutlineNode } from "../state/outline-store";
import { writeDocumentArtifact } from "../output/document-writer";
import {
  PREVIOUS_CHAPTER_PROSE_BUDGET,
  buildCharacterStateContext,
  buildNeighborChapterContext,
  migrationPhaseAt,
} from "./chapter-context";

const NOVEL_ID = "aaaaaaaa-2222-7000-8000-000000000001";

const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

function makeCharacter(name: string): Character {
  return characterSchema.parse({
    basicInfo: { name, gender: "男", appearance: "短发精瘦" },
    core: { desire: "打破垄断", fear: "辜负同伴", narrativeRole: "主角" },
    background: "青云市集的散修少年",
    personality: "热情",
    characterGoal: "建立散修联盟",
    trajectory: "杂役走向联盟开创者",
    relationships: "与旧友是亲兄弟",
    creationPurpose: "承载打破垄断的主线",
    endingDirection: "打破宗门垄断",
  });
}

interface Fixture {
  db: Database;
  outputDir: string;
  outlineStore: OutlineStore;
  characterStore: CharacterStore;
  migrationStore: CharacterMigrationStore;
  documentStore: DocumentStore;
  chapters: StoredOutlineNode[];
  character: ReturnType<CharacterStore["addCharacter"]>;
}

/** 一部两幕各三章（全书章序 1~6），一名角色 */
async function fixture(): Promise<Fixture> {
  const dir = await mkdtemp(join(tmpdir(), "novel-chapter-context-"));
  tempDirs.push(dir);
  const outputDir = join(dir, "output");
  const db = openDatabase(join(dir, "test.db"));
  new NovelStore(db).createNovel({ id: NOVEL_ID });
  const outlineStore = new OutlineStore(db);
  outlineStore.saveOutlineTree(NOVEL_ID, [
    {
      name: "第一部",
      summary: "部梗概",
      acts: [
        { name: "第一幕", summary: "幕一梗概", keyPlotPoints: ["点一"] },
        { name: "第二幕", summary: "幕二梗概", keyPlotPoints: ["点二"] },
      ],
    },
  ]);
  const acts = outlineStore
    .listOutlineNodes(NOVEL_ID, { currentOnly: true })
    .filter((node) => node.node.type === "act");
  const chapters: StoredOutlineNode[] = [];
  acts.forEach((act, actIndex) => {
    chapters.push(
      ...outlineStore.saveChapters(
        NOVEL_ID,
        act.id,
        Array.from({ length: 3 }, (_, index) => ({
          name: `第${actIndex * 3 + index + 1}章`,
          summary: `第${actIndex * 3 + index + 1}章概述`,
        })),
      ),
    );
  });
  const characterStore = new CharacterStore(db);
  const character = characterStore.addCharacter(NOVEL_ID, makeCharacter("陈默"));
  return {
    db,
    outputDir,
    outlineStore,
    characterStore,
    migrationStore: new CharacterMigrationStore(db),
    documentStore: new DocumentStore(db),
    chapters,
    character,
  };
}

/** 建并确认一条迁移（默认已填诱因与过渡描述） */
function plantConfirmed(
  f: Fixture,
  input: {
    migrateField: Parameters<CharacterMigrationStore["addMigration"]>[2]["migrateField"];
    newValue: string | null;
    startIndex: number;
    endIndex?: number | null;
  },
) {
  const draft = f.migrationStore.addMigration(NOVEL_ID, f.character.id, {
    migrateField: input.migrateField,
    newValue: input.newValue,
    startChapterId: f.chapters[input.startIndex]!.id,
    ...(input.endIndex === undefined || input.endIndex === null
      ? {}
      : { endChapterId: f.chapters[input.endIndex]!.id }),
    trigger: "经历背叛",
    transitionGuidance: "逐渐收敛外放",
  });
  return f.migrationStore.confirmMigration(NOVEL_ID, draft.id);
}

function contextFor(f: Fixture, chapterIndex: number) {
  return buildCharacterStateContext({
    novelId: NOVEL_ID,
    chapterNodeId: f.chapters[chapterIndex]!.id,
    characterStore: f.characterStore,
    migrationStore: f.migrationStore,
    outlineStore: f.outlineStore,
    castIds: [f.character.id],
  });
}

describe("migrationPhaseAt（纯函数四阶段与开放区间）", () => {
  test("早于起始章 / 进行中 / 结束章 / 晚于结束章", () => {
    expect(migrationPhaseAt(4, 7, 3)).toBe("not-started");
    expect(migrationPhaseAt(4, 7, 4)).toBe("in-progress");
    expect(migrationPhaseAt(4, 7, 6)).toBe("in-progress");
    expect(migrationPhaseAt(4, 7, 7)).toBe("ending");
    expect(migrationPhaseAt(4, 7, 8)).toBe("completed");
  });

  test("单章变化：起始即结束", () => {
    expect(migrationPhaseAt(4, 4, 3)).toBe("not-started");
    expect(migrationPhaseAt(4, 4, 4)).toBe("ending");
    expect(migrationPhaseAt(4, 4, 5)).toBe("completed");
  });

  test("结束章为空（开放区间）：到起始章后恒为进行中，不自动套用已结束状态", () => {
    expect(migrationPhaseAt(4, null, 3)).toBe("not-started");
    expect(migrationPhaseAt(4, null, 4)).toBe("in-progress");
    expect(migrationPhaseAt(4, null, 99)).toBe("in-progress");
  });
});

describe("buildCharacterStateContext 阶段解析", () => {
  test("基准角色的全部已设定字段进入上下文，作者指导单独标明", async () => {
    const f = await fixture();
    const text = contextFor(f, 0).lines.join("\n");
    expect(text).toContain("性别：男");
    expect(text).toContain("背景：青云市集的散修少年");
    expect(text).toContain("角色目的：建立散修联盟");
    expect(text).toContain("轨迹：杂役走向联盟开创者");
    expect(text).toContain("关系：与旧友是亲兄弟");
    expect(text).toContain("【作者创作指导");
    expect(text).toContain("创作目的：承载打破垄断的主线");
    expect(text).toContain("结局方向：打破宗门垄断");
    expect(text).toContain("不是角色已知信息");
  });

  test("后段迁移进行中时仍注入此前完整历史，不把未开始变化或草案当历史", async () => {
    const f = await fixture();
    const first = plantConfirmed(f, { migrateField: "personality", newValue: "谨慎", startIndex: 0, endIndex: 1 });
    f.migrationStore.updateMigration(NOVEL_ID, first.id, { trigger: "历史独有诱因", transitionGuidance: "历史独有过渡" });
    plantConfirmed(f, { migrateField: "personality", newValue: "沉稳", startIndex: 3, endIndex: 4 });
    plantConfirmed(f, { migrateField: "relationships", newValue: "未来关系目标", startIndex: 5, endIndex: 5 });
    f.migrationStore.addMigration(NOVEL_ID, f.character.id, { migrateField: "background", newValue: "草案秘密" });
    const text = contextFor(f, 3).lines.join("\n");
    expect(text).toContain("【已结束角色迁移历史");
    expect(text).toContain("陈默 · 性格（计划区间已结束，第 1 章起至第 2 章");
    expect(text).toContain("旧值「热情」→ 目标「谨慎」");
    expect(text).toContain("诱因：历史独有诱因");
    expect(text).toContain("过渡描述：历史独有过渡");
    expect(text).toContain("旧值「谨慎」→ 目标「沉稳」");
    expect(text).not.toContain("未来关系目标");
    expect(text).not.toContain("草案秘密");
    expect(text).toContain("不代表正文已兑现");
  });

  test("作者指导在基准、进行中、结束章与结束后都不能被当作角色事实", async () => {
    const f = await fixture();
    plantConfirmed(f, { migrateField: "endingDirection", newValue: "未来为同伴牺牲", startIndex: 1, endIndex: 2 });
    for (const index of [0, 1, 2, 3]) {
      const text = contextFor(f, index).lines.join("\n");
      expect(text).toContain("【作者创作指导");
      expect(text).toContain("不是角色已知信息");
      expect(text).toContain("不代表结局事件已经发生");
      expect(text).not.toContain("结局方向「未来为同伴牺牲」为已结束迁移");
    }
    expect(contextFor(f, 3).lines.join("\n")).toContain("结局方向：未来为同伴牺牲");
  });

  test("同字段连续两条已结束迁移完整保留各自修订和变化依据", async () => {
    const f = await fixture();
    const first = plantConfirmed(f, { migrateField: "personality", newValue: "谨慎", startIndex: 0, endIndex: 1 });
    f.migrationStore.updateMigration(NOVEL_ID, first.id, { trigger: "第一段诱因", transitionGuidance: "第一段过渡" });
    const second = plantConfirmed(f, { migrateField: "personality", newValue: "沉稳", startIndex: 3, endIndex: 4 });
    f.migrationStore.updateMigration(NOVEL_ID, second.id, { trigger: "第二段诱因", transitionGuidance: "第二段过渡" });
    const text = contextFor(f, 5).lines.join("\n");
    for (const expected of ["旧值「热情」→ 目标「谨慎」", "旧值「谨慎」→ 目标「沉稳」", "序号 1 · 修订 v3", "序号 2 · 修订 v3", "诱因：第一段诱因", "过渡描述：第一段过渡", "诱因：第二段诱因", "过渡描述：第二段过渡"]) expect(text).toContain(expected);
    expect(contextFor(f, 5).lines[1]).toContain("性格：沉稳");
  });
  test("同章两个角色同字段迁移的计划各自标明角色，目标不会混在匿名清单", async () => {
    const f = await fixture();
    const second = f.characterStore.addCharacter(NOVEL_ID, makeCharacter("柳三"));
    plantConfirmed(f, { migrateField: "personality", newValue: "谨慎", startIndex: 1, endIndex: 4 });
    const draft = f.migrationStore.addMigration(NOVEL_ID, second.id, {
      migrateField: "personality", newValue: "冷漠",
      startChapterId: f.chapters[1]!.id, endChapterId: f.chapters[4]!.id,
      trigger: "受到打击", transitionGuidance: "逐渐变化",
    });
    f.migrationStore.confirmMigration(NOVEL_ID, draft.id);
    const context = buildCharacterStateContext({
      novelId: NOVEL_ID, chapterNodeId: f.chapters[2]!.id,
      characterStore: f.characterStore, migrationStore: f.migrationStore,
      outlineStore: f.outlineStore, castIds: [f.character.id, second.id],
    });
    const planLines = context.lines.join("\n").split("\n").filter((line) => line.includes("→ 目标"));
    expect(planLines).toHaveLength(2);
    expect(planLines.find((line) => line.includes("陈默"))).toContain("谨慎");
    expect(planLines.find((line) => line.includes("柳三"))).toContain("冷漠");
    f.db.close();
  });

  test("基准『热情』→ 第 2 章起、第 5 章结束、目标『谨慎』：各章参考与计划块正确", async () => {
    const f = await fixture();
    plantConfirmed(f, { migrateField: "personality", newValue: "谨慎", startIndex: 1, endIndex: 4 });

    // 第 1 章：未开始，沿用基准（无计划块，也不泄露目标值）
    const first = contextFor(f, 0);
    expect(first.lines[1]).toContain("性格：热情");
    expect(first.planCount).toBe(0);
    expect(first.completedCount).toBe(0);
    expect(first.lines.join("\n")).not.toContain("谨慎");

    // 第 2~4 章：进行中，参考仍是旧值，计划块给出旧值→目标与诱因/过渡
    const second = contextFor(f, 1);
    expect(second.lines[1]).toContain("性格：热情");
    expect(second.planCount).toBe(1);
    expect(second.lines.join("\n")).toContain("进行中，第 2 章起至第 5 章");
    expect(second.lines.join("\n")).toContain("旧值「热情」→ 目标「谨慎」");
    expect(second.lines.join("\n")).toContain("诱因：经历背叛");
    expect(second.lines.join("\n")).toContain("过渡描述：逐渐收敛外放");
    expect(contextFor(f, 3).lines[1]).toContain("性格：热情");

    // 第 5 章：结束章，参考仍为旧值 + 「本章完成变化」
    const fifth = contextFor(f, 4);
    expect(fifth.lines[1]).toContain("性格：热情");
    expect(fifth.lines.join("\n")).toContain("本章完成变化");

    // 第 6 章：计划已结束，参考沿用新值并给出说明
    const sixth = contextFor(f, 5);
    expect(sixth.lines[1]).toContain("性格：谨慎");
    expect(sixth.completedCount).toBe(1);
    expect(sixth.planCount).toBe(0);
    expect(sixth.lines.join("\n")).toContain("已结束迁移");
  });

  test("第二次同字段迁移旧值派生自第一次新值；不同字段并行互不干扰", async () => {
    const f = await fixture();
    plantConfirmed(f, { migrateField: "personality", newValue: "谨慎", startIndex: 1, endIndex: 2 });
    plantConfirmed(f, { migrateField: "core.fear", newValue: "失去同伴", startIndex: 0, endIndex: 1 });
    plantConfirmed(f, { migrateField: "personality", newValue: "沉稳", startIndex: 4, endIndex: 5 });

    // 第 5 章：性格链第二段进行中（旧值「谨慎」），恐惧链已结束
    const fourth = contextFor(f, 4);
    const text = fourth.lines.join("\n");
    expect(text).toContain("性格：谨慎");
    expect(text).toContain("恐惧：失去同伴");
    expect(text).toContain("旧值「谨慎」→ 目标「沉稳」");
    expect(fourth.completedCount).toBe(1);
    expect(fourth.planCount).toBe(1);
  });

  test("倒序生成 / 重生成旧章：不使用未来迁移的状态", async () => {
    const f = await fixture();
    plantConfirmed(f, { migrateField: "personality", newValue: "谨慎", startIndex: 3, endIndex: 4 });
    // 先「生成」第 6 章（已结束），再解析第 2 章（未开始）
    expect(contextFor(f, 5).lines[1]).toContain("性格：谨慎");
    const second = contextFor(f, 1);
    expect(second.lines[1]).toContain("性格：热情");
    expect(second.planCount).toBe(0);
    expect(second.lines.join("\n")).not.toContain("谨慎");
  });

  test("旧大纲版本的迁移不混入新版", async () => {
    const f = await fixture();
    plantConfirmed(f, { migrateField: "personality", newValue: "谨慎", startIndex: 0, endIndex: 2 });
    // 换版：新树 + 新章
    f.outlineStore.saveOutlineTreeNewVersion(NOVEL_ID, [
      { name: "第一部", summary: "新部", acts: [{ name: "第一幕", summary: "新幕", keyPlotPoints: ["新点"] }] },
    ]);
    const newAct = f.outlineStore
      .listOutlineNodes(NOVEL_ID, { currentOnly: true })
      .find((node) => node.node.type === "act")!;
    const newChapters = f.outlineStore.saveChapters(NOVEL_ID, newAct.id, [
      { name: "新版第一章", summary: "概述" },
      { name: "新版第二章", summary: "概述" },
    ]);
    const context = buildCharacterStateContext({
      novelId: NOVEL_ID,
      chapterNodeId: newChapters[1]!.id,
      characterStore: f.characterStore,
      migrationStore: f.migrationStore,
      outlineStore: f.outlineStore,
      castIds: [f.character.id],
    });
    expect(context.lines[1]).toContain("性格：热情");
    expect(context.planCount).toBe(0);
    expect(context.completedCount).toBe(0);
  });

  test("登场角色按章节点绑定收窄；未绑定回退全库并置标志", async () => {
    const f = await fixture();
    const other = f.characterStore.addCharacter(NOVEL_ID, makeCharacter("柳三"));
    const narrowed = contextFor(f, 0);
    expect(narrowed.characterCount).toBe(1);
    expect(narrowed.fallbackToLibrary).toBe(false);
    expect(narrowed.lines.join("\n")).not.toContain("柳三");

    const fallback = buildCharacterStateContext({
      novelId: NOVEL_ID,
      chapterNodeId: f.chapters[0]!.id,
      characterStore: f.characterStore,
      migrationStore: f.migrationStore,
      outlineStore: f.outlineStore,
      castIds: null,
    });
    expect(fallback.characterCount).toBe(2);
    expect(fallback.fallbackToLibrary).toBe(true);
    expect(fallback.lines.join("\n")).toContain("柳三");
    expect(other.id.length).toBeGreaterThan(0);
  });

  test("创作指导字段的迁移计划块标明「作者创作指导」，不是角色已知信息", async () => {
    const f = await fixture();
    plantConfirmed(f, { migrateField: "endingDirection", newValue: "为同伴赴死", startIndex: 0, endIndex: 1 });
    const context = contextFor(f, 0);
    expect(context.lines.join("\n")).toContain("结局方向");
    expect(context.lines.join("\n")).toContain("作者的创作指导");
  });
});

describe("buildNeighborChapterContext 跨幕前后章与预算回退", () => {
  test("跨幕衔接：第二幕首章的上一章是第一幕末章", async () => {
    const f = await fixture();
    const context = buildNeighborChapterContext({
      novelId: NOVEL_ID,
      chapterNodeId: f.chapters[3]!.id,
      outlineStore: f.outlineStore,
      documentStore: f.documentStore,
      outputDir: f.outputDir,
    });
    expect(context.previous?.name).toBe("第3章");
    expect(context.next?.name).toBe("第5章");
  });

  test("上一章正文可用时纳入；未生成 / 超预算回退概述；下一章只取概述", async () => {
    const f = await fixture();
    const previous = f.chapters[2]!;
    const prose = "上一章的正文内容。";
    writeDocumentArtifact(`${NOVEL_ID}/第一部/第3章.md`, prose, f.outputDir);
    f.documentStore.saveChapterDocument(NOVEL_ID, previous.id, `${NOVEL_ID}/第一部/第3章.md`, 9);

    const withProse = buildNeighborChapterContext({
      novelId: NOVEL_ID,
      chapterNodeId: f.chapters[3]!.id,
      outlineStore: f.outlineStore,
      documentStore: f.documentStore,
      outputDir: f.outputDir,
    });
    expect(withProse.previousProse).toBe(prose);
    expect(withProse.next?.summary).toBe("第5章概述");

    // 超预算：整条降级为概述（不截断）
    const big = "字".repeat(PREVIOUS_CHAPTER_PROSE_BUDGET + 1);
    writeDocumentArtifact(`${NOVEL_ID}/第一部/第3章.md`, big, f.outputDir);
    const overBudget = buildNeighborChapterContext({
      novelId: NOVEL_ID,
      chapterNodeId: f.chapters[3]!.id,
      outlineStore: f.outlineStore,
      documentStore: f.documentStore,
      outputDir: f.outputDir,
    });
    expect(overBudget.previousProse).toBeNull();
    expect(overBudget.previous?.summary).toBe("第3章概述");
  });

  test("首章无上一章 / 末章无下一章", async () => {
    const f = await fixture();
    const first = buildNeighborChapterContext({
      novelId: NOVEL_ID,
      chapterNodeId: f.chapters[0]!.id,
      outlineStore: f.outlineStore,
      documentStore: f.documentStore,
      outputDir: f.outputDir,
    });
    expect(first.previous).toBeNull();
    expect(first.next?.name).toBe("第2章");

    const last = buildNeighborChapterContext({
      novelId: NOVEL_ID,
      chapterNodeId: f.chapters[5]!.id,
      outlineStore: f.outlineStore,
      documentStore: f.documentStore,
      outputDir: f.outputDir,
    });
    expect(last.next).toBeNull();
    expect(last.previous?.name).toBe("第5章");
  });
});

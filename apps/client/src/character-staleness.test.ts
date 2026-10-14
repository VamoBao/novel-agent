import { describe, expect, test } from "bun:test";
import type {
  CharacterEntry,
  CharacterMigrationEntry,
  DocumentEntry,
  NovelDetail,
  OutlineNodeEntry,
} from "@novel/shared";
import { staleCastMigrations } from "./character-staleness";

const NOVEL_ID = "eeeeeeee-4444-7444-8555-666677778888";

const part: OutlineNodeEntry = {
  id: "part-1",
  parentId: null,
  type: "part",
  name: "第一部",
  sort: 1,
  summary: "部梗概",
  keyPlotPoints: null,
  characterIds: null,
};
const act: OutlineNodeEntry = {
  id: "act-1",
  parentId: "part-1",
  type: "act",
  name: "第一幕",
  sort: 1,
  summary: "幕梗概",
  keyPlotPoints: ["点一"],
  characterIds: null,
};

function makeChapter(id: string, sort: number, characterIds: string[] | null): OutlineNodeEntry {
  return {
    id,
    parentId: "act-1",
    type: "chapter",
    name: `第${sort}章`,
    sort,
    summary: `第${sort}章概述`,
    keyPlotPoints: null,
    characterIds,
  };
}

function makeCharacter(id: string, name: string): CharacterEntry {
  return {
    id,
    version: 1,
    updatedAt: "2026-09-01T00:00:00.000Z",
    basicInfo: { name },
    core: { desire: "夺回灵脉", fear: "辜负同伴", narrativeRole: "主角" },
    background: "青云市集的散修少年",
    creationPurpose: "承载打破宗门垄断的主线",
    endingDirection: "打破垄断后归隐",
  };
}

function makeDocument(chapterId: string, updatedAt: string): DocumentEntry {
  return {
    id: `doc-${chapterId}`,
    chapterId,
    filePath: `灵脉拾遗-eeeeeeee/第一部/${chapterId}.md`,
    wordCount: 38,
    updatedAt,
    content: "正文内容。",
  };
}

function makeMigration(over: Partial<CharacterMigrationEntry> = {}): CharacterMigrationEntry {
  return {
    id: "m-1",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-05T00:00:00.000Z",
    novelId: NOVEL_ID,
    characterId: "c-1",
    outlineVersion: 1,
    migrateField: "personality",
    oldValue: "热情",
    newValue: "谨慎",
    startChapterId: "chapter-2",
    endChapterId: "chapter-3",
    trigger: "经历背叛",
    transitionGuidance: "逐渐收敛",
    sequence: 1,
    revision: 2,
    status: "confirmed",
    groupId: null,
    ...over,
  };
}

function makeDetail(
  over: Partial<NovelDetail> = {},
): NovelDetail {
  return {
    novel: {
      id: NOVEL_ID,
      name: "灵脉拾遗",
      pinned: false,
      favorite: false,
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
      genre: null,
      audience: null,
      coreConflict: null,
      chapterLengthMin: null,
      chapterLengthMax: null,
      stylePassScore: null,
    },
    worldview: null,
    characters: [makeCharacter("c-1", "林恒"), makeCharacter("c-2", "萧无咎")],
    migrations: [],
    migrationVersions: [],
    outlineNodes: [part, act, makeChapter("chapter-1", 1, ["c-1"]), makeChapter("chapter-2", 2, ["c-1", "c-2"]), makeChapter("chapter-3", 3, ["c-1"])],
    documents: [],
    foreshadows: [],
    locations: [],
    styleReferences: [],
    ...over,
  };
}

describe("staleCastMigrations（按迁移影响范围判定）", () => {
  test("确认后生成正文，再取消迁移：仍提示曾受影响的章", () => {
    const confirmed = makeMigration({ updatedAt: "2026-10-01T00:00:00.000Z" });
    const detail = makeDetail({
      migrations: [makeMigration({ status: "cancelled", revision: 3 })],
      migrationVersions: [{ id: "v-2", migrationId: "m-1", revision: 2, migration: confirmed, createdAt: "2026-10-05T00:00:00.000Z" }],
      documents: [makeDocument("chapter-2", "2026-10-02T00:00:00.000Z")],
    });
    expect(staleCastMigrations(makeChapter("chapter-2", 2, ["c-1"]), detail)).toEqual([
      { name: "林恒", fieldLabel: "性格", sequence: 1 },
    ]);
  });

  test("起始章后移：原区间的已写章也需要复查，同迁移只提示一次", () => {
    const detail = makeDetail({
      migrations: [makeMigration({ startChapterId: "chapter-3", endChapterId: "chapter-3", revision: 3 })],
      migrationVersions: [{ id: "v-2", migrationId: "m-1", revision: 2, migration: makeMigration(), createdAt: "2026-10-05T00:00:00.000Z" }],
      documents: [makeDocument("chapter-2", "2026-10-02T00:00:00.000Z"), makeDocument("chapter-3", "2026-10-02T00:00:00.000Z")],
    });
    const expected = [{ name: "林恒", fieldLabel: "性格", sequence: 1 }];
    expect(staleCastMigrations(makeChapter("chapter-2", 2, ["c-1"]), detail)).toEqual(expected);
    expect(staleCastMigrations(makeChapter("chapter-3", 3, ["c-1"]), detail)).toEqual(expected);
    expect(staleCastMigrations(makeChapter("chapter-1", 1, ["c-1"]), detail)).toEqual([]);
  });

  test("取消之后重新生成正文：历史确认快照不造成永久陈旧", () => {
    const detail = makeDetail({
      migrations: [makeMigration({ status: "cancelled", revision: 3 })],
      migrationVersions: [{ id: "v-2", migrationId: "m-1", revision: 2, migration: makeMigration(), createdAt: "2026-10-05T00:00:00.000Z" }],
      documents: [makeDocument("chapter-2", "2026-10-06T00:00:00.000Z")],
    });
    expect(staleCastMigrations(makeChapter("chapter-2", 2, ["c-1"]), detail)).toEqual([]);
  });

  test("迁移在本章起生效且确认晚于正文：本章列入，之前的章不受影响", () => {
    const detail = makeDetail({
      migrations: [makeMigration()],
      documents: [
        makeDocument("chapter-1", "2026-10-01T00:00:00.000Z"),
        makeDocument("chapter-2", "2026-10-01T00:00:00.000Z"),
      ],
    });
    // 第 2 章：迁移自第 2 章起生效，确认时间（10-05）晚于正文（10-01）→ 陈旧
    expect(staleCastMigrations(makeChapter("chapter-2", 2, ["c-1", "c-2"]), detail)).toEqual([
      { name: "林恒", fieldLabel: "性格", sequence: 1 },
    ]);
    // 第 1 章：迁移尚未开始生效 → 不提示（避免未来迁移让所有早期章节显示过时）
    expect(staleCastMigrations(makeChapter("chapter-1", 1, ["c-1"]), detail)).toEqual([]);
  });

  test("迁移确认早于正文生成（含同刻）：不算陈旧", () => {
    const detail = makeDetail({
      migrations: [makeMigration({ updatedAt: "2026-10-01T00:00:00.000Z" })],
      documents: [makeDocument("chapter-2", "2026-10-01T00:00:00.000Z")],
    });
    expect(staleCastMigrations(makeChapter("chapter-2", 2, ["c-1"]), detail)).toEqual([]);
  });

  test("草案与已取消迁移不参与判定", () => {
    const detail = makeDetail({
      migrations: [
        makeMigration({ id: "m-draft", status: "draft" }),
        makeMigration({ id: "m-cancelled", status: "cancelled" }),
      ],
      documents: [makeDocument("chapter-2", "2026-10-01T00:00:00.000Z")],
    });
    expect(staleCastMigrations(makeChapter("chapter-2", 2, ["c-1"]), detail)).toEqual([]);
  });

  test("绑定归档旧版大纲的迁移（本章序不可解析）不混入新版", () => {
    const detail = makeDetail({
      migrations: [makeMigration({ startChapterId: "archived-chapter" })],
      documents: [makeDocument("chapter-2", "2026-10-01T00:00:00.000Z")],
    });
    expect(staleCastMigrations(makeChapter("chapter-2", 2, ["c-1"]), detail)).toEqual([]);
  });

  test("未生成正文 / 未绑定登场角色 / 绑定角色不在库：返回空", () => {
    const detail = makeDetail({ migrations: [makeMigration()], documents: [] });
    expect(staleCastMigrations(makeChapter("chapter-2", 2, ["c-1"]), detail)).toEqual([]);

    const withDoc = makeDetail({
      migrations: [makeMigration()],
      documents: [makeDocument("chapter-2", "2026-10-01T00:00:00.000Z")],
    });
    expect(staleCastMigrations(makeChapter("chapter-2", 2, null), withDoc)).toEqual([]);
    expect(staleCastMigrations(makeChapter("chapter-2", 2, ["c-missing"]), withDoc)).toEqual([]);
  });

  test("多字段 / 多角色迁移逐条列出", () => {
    const detail = makeDetail({
      migrations: [
        makeMigration(),
        makeMigration({ id: "m-2", migrateField: "core.fear", sequence: 2 }),
        makeMigration({ id: "m-3", characterId: "c-2", sequence: 1 }),
      ],
      documents: [makeDocument("chapter-2", "2026-10-01T00:00:00.000Z")],
    });
    expect(staleCastMigrations(makeChapter("chapter-2", 2, ["c-1", "c-2"]), detail)).toEqual([
      { name: "林恒", fieldLabel: "性格", sequence: 1 },
      { name: "林恒", fieldLabel: "恐惧", sequence: 2 },
      { name: "萧无咎", fieldLabel: "性格", sequence: 1 },
    ]);
  });
});

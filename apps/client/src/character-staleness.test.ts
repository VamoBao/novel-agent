import { describe, expect, test } from "bun:test";
import type { CharacterEntry, DocumentEntry, NovelDetail, OutlineNodeEntry } from "@novel/shared";
import { staleCastCharacters } from "./character-staleness";

const NOVEL_ID = "eeeeeeee-4444-7444-8555-666677778888";

function makeCharacter(id: string, name: string, updatedAt: string, version = 1): CharacterEntry {
  return {
    id,
    version,
    updatedAt,
    basicInfo: { name },
    core: { desire: "夺回灵脉", fear: "辜负同伴", narrativeRole: "主角" },
    background: "青云市集的散修少年",
    creationPurpose: "承载打破宗门垄断的主线",
    endingDirection: "打破垄断后归隐",
  };
}

function makeChapter(characterIds: string[] | null): OutlineNodeEntry {
  return {
    id: "chapter-1",
    parentId: "act-1",
    type: "chapter",
    name: "第一章·雨夜",
    sort: 1,
    summary: "少年拾得碎片",
    keyPlotPoints: null,
    characterIds,
  };
}

function makeDocument(updatedAt: string): DocumentEntry {
  return {
    id: "doc-1",
    chapterId: "chapter-1",
    filePath: "灵脉拾遗-eeeeeeee/第一部/第一章.md",
    wordCount: 38,
    updatedAt,
    content: "正文内容。",
  };
}

function makeDetail(characters: CharacterEntry[], documents: DocumentEntry[]): NovelDetail {
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
    },
    worldview: null,
    characters,
    outlineNodes: [makeChapter(["c-1", "c-2"])],
    documents,
    foreshadows: [],
    locations: [],
    styleReferences: [],
  };
}

describe("staleCastCharacters", () => {
  test("角色在正文生成后被编辑：列入并带当前版本号", () => {
    const detail = makeDetail(
      [
        makeCharacter("c-1", "林恒", "2026-10-05T00:00:00.000Z", 3),
        makeCharacter("c-2", "萧无咎", "2026-09-01T00:00:00.000Z", 1),
      ],
      [makeDocument("2026-10-01T00:00:00.000Z")],
    );
    expect(staleCastCharacters(makeChapter(["c-1", "c-2"]), detail)).toEqual([
      { name: "林恒", version: 3 },
    ]);
  });

  test("角色编辑早于正文生成（含同刻）：不算陈旧", () => {
    const detail = makeDetail(
      [
        makeCharacter("c-1", "林恒", "2026-09-01T00:00:00.000Z", 2),
        makeCharacter("c-2", "萧无咎", "2026-10-01T00:00:00.000Z", 2),
      ],
      [makeDocument("2026-10-01T00:00:00.000Z")],
    );
    expect(staleCastCharacters(makeChapter(["c-1", "c-2"]), detail)).toEqual([]);
  });

  test("未生成正文的章 / 未绑定登场角色的旧章：返回空（无正文即无陈旧问题）", () => {
    const detail = makeDetail(
      [makeCharacter("c-1", "林恒", "2026-10-05T00:00:00.000Z", 3)],
      [],
    );
    expect(staleCastCharacters(makeChapter(["c-1"]), detail)).toEqual([]);

    const withDoc = makeDetail(
      [makeCharacter("c-1", "林恒", "2026-10-05T00:00:00.000Z", 3)],
      [makeDocument("2026-10-01T00:00:00.000Z")],
    );
    expect(staleCastCharacters(makeChapter(null), withDoc)).toEqual([]);
  });

  test("绑定的角色已不在库中：跳过不报错", () => {
    const detail = makeDetail([], [makeDocument("2026-10-01T00:00:00.000Z")]);
    expect(staleCastCharacters(makeChapter(["c-missing"]), detail)).toEqual([]);
  });
});

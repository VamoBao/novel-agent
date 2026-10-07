import { describe, expect, test } from "bun:test";
import { saveChaptersInputSchema } from "./chapter-agent";
import { chapterPlanSchema, type ChapterPlan } from "@novel/shared";

const threeChapterPlan: ChapterPlan = chapterPlanSchema.parse({
  chapters: [
    { name: "第一章·雨夜", summary: "雨夜夺脉的剧情概述" },
    { name: "第二章·来客", summary: "神秘来客的剧情概述" },
    { name: "第三章·破晓", summary: "黎明反击的剧情概述" },
  ],
});

describe("saveChaptersInputSchema", () => {
  const submission = { ...threeChapterPlan, newCharacters: [{ name: "萧无咎", role: "第2章登场·血宗宗主" }] };

  test("规划 + 新增角色清单均合规时通过；空清单合法", () => {
    expect(
      saveChaptersInputSchema.parse({ ...submission, newForeshadows: [], foreshadowBindings: [] }).newCharacters,
    ).toHaveLength(1);
    expect(
      saveChaptersInputSchema.parse({ ...threeChapterPlan, newCharacters: [], newForeshadows: [], foreshadowBindings: [] })
        .newCharacters,
    ).toEqual([]);
  });

  test("newCharacters 缺失或项内字段空串被拒绝", () => {
    expect(() => saveChaptersInputSchema.parse(threeChapterPlan)).toThrow();
    expect(() =>
      saveChaptersInputSchema.parse({ ...threeChapterPlan, newCharacters: [{ name: "萧无咎" }], newForeshadows: [], foreshadowBindings: [] }),
    ).toThrow();
    expect(() =>
      saveChaptersInputSchema.parse({ ...threeChapterPlan, newCharacters: [{ name: "", role: "反派" }], newForeshadows: [], foreshadowBindings: [] }),
    ).toThrow();
  });

  test("清单内名字重复被拒绝", () => {
    expect(() =>
      saveChaptersInputSchema.parse({
        ...threeChapterPlan,
        newCharacters: [
          { name: "萧无咎", role: "第2章登场·血宗宗主" },
          { name: "萧无咎", role: "同一人重复列出" },
        ],
        newForeshadows: [],
        foreshadowBindings: [],
      }),
    ).toThrow("不得重复");
  });

  test("章节规划自身约束不回归（0 章与 13 章均拒绝）", () => {
    expect(() => saveChaptersInputSchema.parse({ chapters: [], newCharacters: [], newForeshadows: [], foreshadowBindings: [] })).toThrow();
    expect(() =>
      saveChaptersInputSchema.parse({
        chapters: Array.from({ length: 13 }, (_, i) => ({ name: `第${i + 1}章`, summary: `第${i + 1}章概述` })),
        newCharacters: [],
        newForeshadows: [],
        foreshadowBindings: [],
      }),
    ).toThrow();
  });

  const chapterFs = { surfaceAction: "送信伏笔", hiddenTruth: "暗示投敌", attentionLevel: 4, characterNames: ["林恒"], chapterName: "第一章·雨夜" };

  test("newForeshadows 与 foreshadowBindings 均必填数组，空数组合法，完整条目通过", () => {
    const base = { ...threeChapterPlan, newCharacters: [] };
    expect(() => saveChaptersInputSchema.parse(base)).toThrow();
    const parsed = saveChaptersInputSchema.parse({ ...base, newForeshadows: [], foreshadowBindings: [] });
    expect(parsed.newForeshadows).toEqual([]);
    expect(
      saveChaptersInputSchema.parse({ ...base, newForeshadows: [chapterFs], foreshadowBindings: [{ index: 1, chapterName: "第一章·雨夜" }] }).foreshadowBindings,
    ).toHaveLength(1);
  });

  test("伏笔清单内表面行为重复被拒绝；绑定指令内序号重复被拒绝", () => {
    const base = { ...threeChapterPlan, newCharacters: [], foreshadowBindings: [] as never[] };
    expect(() => saveChaptersInputSchema.parse({ ...base, newForeshadows: [chapterFs, chapterFs] })).toThrow("不得重复");
    expect(() =>
      saveChaptersInputSchema.parse({
        ...base,
        newForeshadows: [],
        foreshadowBindings: [
          { index: 1, chapterName: "第一章·雨夜" },
          { index: 1, chapterName: "第二章·来客" },
        ],
      }),
    ).toThrow("不得重复");
  });
});

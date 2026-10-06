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
    expect(saveChaptersInputSchema.parse(submission).newCharacters).toHaveLength(1);
    expect(saveChaptersInputSchema.parse({ ...threeChapterPlan, newCharacters: [] }).newCharacters).toEqual([]);
  });

  test("newCharacters 缺失或项内字段空串被拒绝", () => {
    expect(() => saveChaptersInputSchema.parse(threeChapterPlan)).toThrow();
    expect(() => saveChaptersInputSchema.parse({ ...threeChapterPlan, newCharacters: [{ name: "萧无咎" }] })).toThrow();
    expect(() => saveChaptersInputSchema.parse({ ...threeChapterPlan, newCharacters: [{ name: "", role: "反派" }] })).toThrow();
  });

  test("清单内名字重复被拒绝", () => {
    expect(() =>
      saveChaptersInputSchema.parse({
        ...threeChapterPlan,
        newCharacters: [
          { name: "萧无咎", role: "第2章登场·血宗宗主" },
          { name: "萧无咎", role: "同一人重复列出" },
        ],
      }),
    ).toThrow("不得重复");
  });

  test("章节规划自身约束不回归（0 章与 13 章均拒绝）", () => {
    expect(() => saveChaptersInputSchema.parse({ chapters: [], newCharacters: [] })).toThrow();
    expect(() =>
      saveChaptersInputSchema.parse({
        chapters: Array.from({ length: 13 }, (_, i) => ({ name: `第${i + 1}章`, summary: `第${i + 1}章概述` })),
        newCharacters: [],
      }),
    ).toThrow();
  });
});

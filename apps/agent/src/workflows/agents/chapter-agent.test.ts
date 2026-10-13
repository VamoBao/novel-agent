import { describe, expect, test } from "bun:test";
import { saveChaptersInputSchema } from "./chapter-agent";
import { chapterPlanSchema, type ChapterPlan } from "@novel/shared";

const threeChapterPlan: ChapterPlan = chapterPlanSchema.parse({
  chapters: [
    {
      name: "第一章·雨夜",
      summary: "雨夜夺脉的剧情概述",
      characters: [{ name: "林恒", role: "本章主视角" }],
    },
    {
      name: "第二章·来客",
      summary: "神秘来客的剧情概述",
      characters: [
        { name: "林恒", role: "遭伏击的组织者" },
        { name: "萧无咎", role: "血宗宗主·本章首次登场的主要反派" },
      ],
    },
    {
      name: "第三章·破晓",
      summary: "黎明反击的剧情概述",
      characters: [{ name: "林恒", role: "反击领袖" }],
    },
  ],
});

describe("saveChaptersInputSchema", () => {
  test("规划（含逐章登场清单）与各清单均合规时通过", () => {
    const parsed = saveChaptersInputSchema.parse({
      ...threeChapterPlan,
      newForeshadows: [],
      foreshadowBindings: [],
      foreshadowRecoverBindings: [],
      newLocations: [],
    });
    expect(parsed.chapters[1]?.characters).toHaveLength(2);
    expect(parsed.chapters[1]?.characters[1]).toEqual({
      name: "萧无咎",
      role: "血宗宗主·本章首次登场的主要反派",
    });
  });

  test("逐章登场清单：缺省 / 空清单 / 空名或空定位 / 同章重名被拒绝", () => {
    const stripCast = (chapters: ChapterPlan["chapters"]) =>
      chapters.map((c) => ({ name: c.name, summary: c.summary }));
    expect(() =>
      saveChaptersInputSchema.parse({
        chapters: stripCast(threeChapterPlan.chapters),
        newForeshadows: [],
        foreshadowBindings: [],
        foreshadowRecoverBindings: [],
        newLocations: [],
      }),
    ).toThrow();
    expect(() =>
      saveChaptersInputSchema.parse({
        chapters: [{ ...threeChapterPlan.chapters[0]!, characters: [] }],
        newForeshadows: [],
        foreshadowBindings: [],
        foreshadowRecoverBindings: [],
        newLocations: [],
      }),
    ).toThrow();
    expect(() =>
      saveChaptersInputSchema.parse({
        chapters: [
          { ...threeChapterPlan.chapters[0]!, characters: [{ name: "", role: "主角" }] },
        ],
        newForeshadows: [],
        foreshadowBindings: [],
        foreshadowRecoverBindings: [],
        newLocations: [],
      }),
    ).toThrow();
    expect(() =>
      saveChaptersInputSchema.parse({
        chapters: [
          {
            ...threeChapterPlan.chapters[0]!,
            characters: [
              { name: "林恒", role: "主视角" },
              { name: "林恒", role: "重复" },
            ],
          },
        ],
        newForeshadows: [],
        foreshadowBindings: [],
        foreshadowRecoverBindings: [],
        newLocations: [],
      }),
    ).toThrow("不得重复");
  });

  test("章节规划自身约束不回归（0 章与 13 章均拒绝）", () => {
    const cast = [{ name: "林恒", role: "本章主视角" }];
    expect(() =>
      saveChaptersInputSchema.parse({
        chapters: [],
        newForeshadows: [],
        foreshadowBindings: [],
        foreshadowRecoverBindings: [],
        newLocations: [],
      }),
    ).toThrow();
    expect(() =>
      saveChaptersInputSchema.parse({
        chapters: Array.from({ length: 13 }, (_, i) => ({
          name: `第${i + 1}章`,
          summary: `第${i + 1}章概述`,
          characters: cast,
        })),
        newForeshadows: [],
        foreshadowBindings: [],
        foreshadowRecoverBindings: [],
        newLocations: [],
      }),
    ).toThrow();
  });

  const chapterFs = { surfaceAction: "送信伏笔", hiddenTruth: "暗示投敌", attentionLevel: 4, characterNames: ["林恒"], chapterName: "第一章·雨夜" };

  test("newForeshadows 与 foreshadowBindings 均必填数组，空数组合法，完整条目通过", () => {
    const base = { ...threeChapterPlan };
    expect(() => saveChaptersInputSchema.parse(base)).toThrow();
    const parsed = saveChaptersInputSchema.parse({ ...base, newForeshadows: [], foreshadowBindings: [], foreshadowRecoverBindings: [], newLocations: [] });
    expect(parsed.newForeshadows).toEqual([]);
    expect(
      saveChaptersInputSchema.parse({ ...base, newForeshadows: [chapterFs], foreshadowBindings: [{ index: 1, chapterName: "第一章·雨夜" }], foreshadowRecoverBindings: [], newLocations: [] }).foreshadowBindings,
    ).toHaveLength(1);
  });

  test("伏笔清单内表面行为重复被拒绝；绑定指令内序号重复被拒绝", () => {
    const base = { ...threeChapterPlan, foreshadowBindings: [] };
    expect(() => saveChaptersInputSchema.parse({ ...base, newForeshadows: [chapterFs, chapterFs], foreshadowRecoverBindings: [], newLocations: [] })).toThrow("不得重复");
    expect(() =>
      saveChaptersInputSchema.parse({
        ...base,
        newForeshadows: [],
        foreshadowBindings: [
          { index: 1, chapterName: "第一章·雨夜" },
          { index: 1, chapterName: "第二章·来客" },
        ],
        newLocations: [],
      }),
    ).toThrow("不得重复");
  });

  const chapterLoc = { name: "青云城", description: "第2章主战场·东部边境要塞" };

  test("newLocations 必填数组：缺省省略不合法、空数组合法、完整条目通过", () => {
    const base = { ...threeChapterPlan, newForeshadows: [] as never[], foreshadowBindings: [] as never[], foreshadowRecoverBindings: [] as never[] };
    expect(() => saveChaptersInputSchema.parse(base)).toThrow();
    expect(saveChaptersInputSchema.parse({ ...base, newLocations: [] }).newLocations).toEqual([]);
    expect(saveChaptersInputSchema.parse({ ...base, newLocations: [chapterLoc] }).newLocations).toHaveLength(1);
  });

  test("地点清单内名字重复被拒绝；项内空名字/空定位被拒绝", () => {
    const base = { ...threeChapterPlan, newForeshadows: [] as never[], foreshadowBindings: [] as never[], foreshadowRecoverBindings: [] as never[] };
    expect(() =>
      saveChaptersInputSchema.parse({ ...base, newLocations: [chapterLoc, { ...chapterLoc, description: "同一地点重复" }] }),
    ).toThrow("不得重复");
    expect(() => saveChaptersInputSchema.parse({ ...base, newLocations: [{ name: "", description: "要塞" }] })).toThrow();
    expect(() => saveChaptersInputSchema.parse({ ...base, newLocations: [{ name: "青云城", description: "" }] })).toThrow();
  });

  test("foreshadowRecoverBindings 必填数组：缺省不合法、空合法、同 index 不同章合法（多步回收）、(index, chapterName) 组合重复被拒绝", () => {
    const base = {
      ...threeChapterPlan,
      newForeshadows: [] as never[],
      foreshadowBindings: [] as never[],
      newLocations: [] as never[],
    };
    expect(() => saveChaptersInputSchema.parse(base)).toThrow();
    expect(
      saveChaptersInputSchema.parse({ ...base, foreshadowRecoverBindings: [] }).foreshadowRecoverBindings,
    ).toEqual([]);
    expect(
      saveChaptersInputSchema.parse({
        ...base,
        foreshadowRecoverBindings: [
          { index: 1, chapterName: "第二章·来客" },
          { index: 1, chapterName: "第三章·破晓" },
        ],
      }).foreshadowRecoverBindings,
    ).toHaveLength(2);
    expect(() =>
      saveChaptersInputSchema.parse({
        ...base,
        foreshadowRecoverBindings: [
          { index: 1, chapterName: "第二章·来客" },
          { index: 1, chapterName: "第二章·来客" },
        ],
      }),
    ).toThrow("不得重复");
  });
});

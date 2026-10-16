import { describe, expect, test } from "bun:test";
import { saveChaptersInputSchema, validateChapterForeshadowPlan, type PlanChaptersInput } from "./chapter-agent";
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

  const chapterFs = { surfaceAction: "送信伏笔", hiddenTruth: "暗示投敌", attentionLevel: 4, characterNames: ["林恒"], chapterName: "第一章·雨夜", recoveryPlan: [{ actName: "目标幕", chapterNames: ["第三章·破晓"] }] };

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


const fullContext: PlanChaptersInput = {
  novelTitle: "伏笔测试", logline: "跨部多幕", partName: "上部", partSummary: "上部梗概",
  actName: "目标幕", actSummary: "本幕梗概", keyPlotPoints: ["推进线索"],
  fullOutline: [
    { id: "a0", partName: "上部", name: "前幕", summary: "起因", keyPlotPoints: ["埋设"], chapters: [{ id: "c0", name: "序章", summary: "既有登场" }] },
    { id: "a1", partName: "上部", name: "目标幕", summary: "发展", keyPlotPoints: ["推进"], chapters: [] },
    { id: "a2", partName: "下部", name: "已规划后幕", summary: "阶段回收", keyPlotPoints: ["后续"], chapters: [{ id: "f1", name: "后续一章", summary: "线索" }, { id: "f2", name: "后续二章", summary: "揭示" }] },
    { id: "a3", partName: "下部", name: "未规划后幕", summary: "终局", keyPlotPoints: ["最终揭晓"], chapters: [] },
  ],
};
const planningBase = { ...threeChapterPlan, newForeshadows: [], foreshadowBindings: [], foreshadowRecoverBindings: [], newLocations: [] };
const freshForeshadow = {
  surfaceAction: "新线索", hiddenTruth: "隐藏真相", attentionLevel: 10,
  characterNames: ["林恒"], chapterName: "第一章·雨夜",
  recoveryPlan: [
    { actName: "目标幕", chapterNames: ["第三章·破晓"] },
    { actName: "已规划后幕", chapterNames: ["后续二章"] },
    { actName: "未规划后幕", chapterNames: [] },
  ],
};

function existingForeshadow(id: string, actNodeId: string, appearChapterId?: string) {
  return {
    id, novelId: "novel", actNodeId, recoverActNodeId: "a1", recoverActNodeIds: ["a1"],
    createdAt: "2026-10-16", updatedAt: "2026-10-16", editRevision: 0,
    foreshadow: { surfaceAction: id, hiddenTruth: "真相", attentionLevel: 5,
      recoveryStatus: "unrecovered" as const, ...(appearChapterId ? { appearChapterId } : {}) },
  };
}

describe("章节伏笔确认前上下文校验", () => {
  test("新伏笔允许同幕不同章、跨部已规划后幕真实章及未规划后幕留空", () => {
    const plan = saveChaptersInputSchema.parse({ ...planningBase, newForeshadows: [freshForeshadow] });
    expect(validateChapterForeshadowPlan(plan, fullContext, { recoverableForeshadows: [] })).toEqual([]);
  });

  test("新伏笔拒绝前幕、未知幕、虚构章、同章种收、早于登场、重复引用及缺失的具体章", () => {
    const badPlans = [
      [{ actName: "前幕", chapterNames: ["序章"] }],
      [{ actName: "虚构幕", chapterNames: [] }],
      [{ actName: "目标幕", chapterNames: ["第一章·雨夜"] }],
      [{ actName: "目标幕", chapterNames: ["虚构章"] }],
      [{ actName: "目标幕", chapterNames: [] }],
      [{ actName: "已规划后幕", chapterNames: [] }],
      [{ actName: "已规划后幕", chapterNames: ["虚构未来章"] }],
      [{ actName: "已规划后幕", chapterNames: ["后续一章", "后续一章"] }],
      [{ actName: "未规划后幕", chapterNames: ["凭空生成未来章"] }],
    ];
    for (const recoveryPlan of badPlans) {
      const plan = saveChaptersInputSchema.parse({ ...planningBase, newForeshadows: [{ ...freshForeshadow, recoveryPlan }] });
      expect(validateChapterForeshadowPlan(plan, fullContext, { recoverableForeshadows: [] }).length).toBeGreaterThan(0);
    }
    const early = saveChaptersInputSchema.parse({ ...planningBase, newForeshadows: [{ ...freshForeshadow,
      chapterName: "第三章·破晓", recoveryPlan: [{ actName: "目标幕", chapterNames: ["第二章·来客"] }],
    }] });
    expect(validateChapterForeshadowPlan(early, fullContext, { recoverableForeshadows: [] }).join()).toContain("严格晚于");
  });

  test("新输出必须带非空回收计划，旧字段不能替代；回收幕不重复", () => {
    const legacy = { surfaceAction: "新线索", hiddenTruth: "真相", attentionLevel: 5,
      characterNames: ["林恒"], chapterName: "第一章·雨夜" };
    for (const fs of [legacy, { ...legacy, recoveryPlan: [] }, { ...legacy,
      recoveryPlan: [{ actName: "目标幕", chapterNames: [] }, { actName: "目标幕", chapterNames: [] }],
    }]) {
      expect(saveChaptersInputSchema.safeParse({ ...planningBase, newForeshadows: [fs] }).success).toBe(false);
    }
  });

  test("先安排本幕种收时联合校验登场顺序；同章种收拒绝，逆序规划允许埋设在更早幕", () => {
    const local = existingForeshadow("local", "a1");
    const earlierUnplanned = existingForeshadow("earlier", "a0");
    const options = { unboundForeshadows: [local], recoverableForeshadows: [local, earlierUnplanned] };
    const valid = saveChaptersInputSchema.parse({ ...planningBase,
      foreshadowBindings: [{ index: 1, chapterName: "第一章·雨夜" }],
      foreshadowRecoverBindings: [{ index: 1, chapterName: "第三章·破晓" }, { index: 2, chapterName: "第二章·来客" }],
    });
    expect(validateChapterForeshadowPlan(valid, fullContext, options)).toEqual([]);
    const invalid = { ...valid, foreshadowRecoverBindings: [{ index: 1, chapterName: "第一章·雨夜" }, { index: 2, chapterName: "第二章·来客" }] };
    expect(validateChapterForeshadowPlan(invalid, fullContext, options).join()).toContain("严格晚于");
    expect(validateChapterForeshadowPlan({ ...valid, foreshadowBindings: [] }, fullContext, options).join()).toContain("遗漏");
    expect(validateChapterForeshadowPlan({ ...valid, foreshadowRecoverBindings: [] }, fullContext, options).join()).toContain("遗漏");
  });

  test("更早幕尚未绑登场可回收，但埋设于当前或更晚幕且无登场不能回收", () => {
    const plan = saveChaptersInputSchema.parse({ ...planningBase, foreshadowRecoverBindings: [{ index: 1, chapterName: "第三章·破晓" }] });
    for (const actNodeId of ["a1", "a2", "missing"]) {
      expect(validateChapterForeshadowPlan(plan, fullContext, { recoverableForeshadows: [existingForeshadow("f", actNodeId)] }).join()).toContain("无法确定");
    }
    expect(validateChapterForeshadowPlan(plan, fullContext, { recoverableForeshadows: [existingForeshadow("f", "a0")] })).toEqual([]);
  });
});


test("新增回收计划引用歧义幕名或该幕重名章时确认前拒绝", () => {
  const plan = saveChaptersInputSchema.parse({ ...planningBase, newForeshadows: [freshForeshadow] });
  const duplicateAct = { ...fullContext, fullOutline: [
    ...fullContext.fullOutline!, { ...fullContext.fullOutline![2]!, id: "a4" },
  ] };
  expect(validateChapterForeshadowPlan(plan, duplicateAct, { recoverableForeshadows: [] }).length).toBeGreaterThan(0);
  const duplicateChapter = { ...fullContext, fullOutline: fullContext.fullOutline!.map((act) => act.id !== "a2" ? act : {
    ...act, chapters: [...act.chapters, { id: "f3", name: "后续二章", summary: "另一同名章" }],
  }) };
  expect(validateChapterForeshadowPlan(plan, duplicateChapter, { recoverableForeshadows: [] }).length).toBeGreaterThan(0);
  const onlyLocal = saveChaptersInputSchema.parse({ ...planningBase, newForeshadows: [{ ...freshForeshadow,
    recoveryPlan: [{ actName: "目标幕", chapterNames: ["第三章·破晓"] }],
  }] });
  expect(validateChapterForeshadowPlan(onlyLocal, duplicateAct, { recoverableForeshadows: [] })).toEqual([]);
  expect(validateChapterForeshadowPlan(onlyLocal, duplicateChapter, { recoverableForeshadows: [] })).toEqual([]);
});

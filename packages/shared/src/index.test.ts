import { describe, expect, test } from "bun:test";
import {
  audienceSuggestionSchema,
  chapterPlanSchema,
  characterSchema,
  coreConflictSchema,
  foreshadowPatchSchema,
  foreshadowSchema,
  locationSchema,
  outlineNodePatchSchema,
  outlineNodeSchema,
  outlineSchema,
  worldviewSchema,
} from "./index";

describe("worldviewSchema", () => {
  test("完整世界观通过校验", () => {
    const wv = worldviewSchema.parse({
      background: {
        geography: "维斯特洛大陆",
        fantasyAttributes: "魔法世界，人们可以使用元素魔法",
        realWorldMapping: "封建领主制，对应中世纪欧洲政治模式",
      },
      taboos: ["不能出现现代科技物品", "普通人不能复活"],
    });
    expect(wv.background.geography).toBe("维斯特洛大陆");
    expect(wv.taboos).toHaveLength(2);
  });

  test("可选字段缺失仍通过（现实向世界观）", () => {
    const wv = worldviewSchema.parse({
      background: { geography: "当代上海" },
      taboos: ["不能出现超自然力量"],
    });
    expect(wv.background.fantasyAttributes).toBeUndefined();
  });

  test("缺少 taboos 被拒绝", () => {
    expect(() =>
      worldviewSchema.parse({ background: { geography: "当代上海" } }),
    ).toThrow();
  });
});

describe("characterSchema", () => {
  const validCharacter = {
    basicInfo: { name: "林澜", gender: "女", appearance: "短发，左颊有疤" },
    core: { desire: "找到失踪的妹妹", fear: "再次失去重要的人", narrativeRole: "主角" },
    background: "殖民城市长大的孤儿领航员",
    personality: "冷静理性",
    characterGoal: "查明妹妹下落",
    creationPurpose: "驱动主线冲突的核心视角",
    trajectory: "领航员 → 追查者 → 拯救者",
    endingDirection: "公开真相并拯救城市",
    relationships: "与老周是师徒；与军方指挥官敌对",
  };

  test("完整角色卡通过校验", () => {
    const c = characterSchema.parse(validCharacter);
    expect(c.core.narrativeRole).toBe("主角");
    expect(c.creationPurpose).toBe("驱动主线冲突的核心视角");
  });

  test("仅提供必填项通过，可选项缺省为 undefined", () => {
    const c = characterSchema.parse({
      basicInfo: { name: "灰袍人" },
      core: { desire: "夺回神器", fear: "身份暴露", narrativeRole: "反派" },
      background: "前朝国师",
      creationPurpose: "逼迫主角觉醒上古血脉",
      endingDirection: "被主角击败，临终揭露真相",
    });
    expect(c.personality).toBeUndefined();
    expect(c.relationships).toBeUndefined();
  });

  test("缺少任一必填属性被拒绝（内核/背景/创作目的/结局方向）", () => {
    const requiredKeys = ["core", "background", "creationPurpose", "endingDirection"] as const;
    for (const key of requiredKeys) {
      const broken: Record<string, unknown> = { ...validCharacter };
      delete broken[key];
      expect(() => characterSchema.parse(broken)).toThrow();
    }
    expect(() =>
      characterSchema.parse({ ...validCharacter, core: { desire: "x", fear: "y" } }),
    ).toThrow();
    expect(() =>
      characterSchema.parse({ ...validCharacter, basicInfo: { name: "" } }),
    ).toThrow();
  });
});

describe("locationSchema", () => {
  test("完整位置通过校验（含人口与父级）", () => {
    const loc = locationSchema.parse({
      name: "雾港城",
      x: 123.45,
      y: -67.8,
      layer: "地面",
      population: 250000,
      parentId: "cccccccc-0000-7000-8000-000000000001",
    });
    expect(loc.name).toBe("雾港城");
    expect(loc.population).toBe(250000);
  });

  test("仅必填项通过，人口与父级缺省为 undefined", () => {
    const loc = locationSchema.parse({
      name: "北境大陆",
      x: 0,
      y: 0,
      layer: "地面",
    });
    expect(loc.population).toBeUndefined();
    expect(loc.parentId).toBeUndefined();
  });

  test("空名称 / 空图层 / 缺坐标被拒绝", () => {
    const base = { name: "雾港城", x: 1.5, y: 2.5, layer: "地面" };
    expect(() => locationSchema.parse({ ...base, name: "" })).toThrow();
    expect(() => locationSchema.parse({ ...base, layer: "" })).toThrow();
    expect(() => {
      const { y: _y, ...noY } = base;
      locationSchema.parse(noY);
    }).toThrow();
  });

  test("人口为负数或非整数被拒绝", () => {
    const base = { name: "雾港城", x: 1.5, y: 2.5, layer: "地面" };
    expect(() => locationSchema.parse({ ...base, population: -1 })).toThrow();
    expect(() => locationSchema.parse({ ...base, population: 1.5 })).toThrow();
    expect(locationSchema.parse({ ...base, population: 0 })).toBeDefined();
  });
});

describe("foreshadowSchema", () => {
  const base = {
    surfaceAction: "老周把主角派去北境送信",
    hiddenTruth: "暗示老周已经投敌，借刀除掉主角",
    attentionLevel: 4,
  };

  test("完整伏笔通过校验（含全部可选字段）", () => {
    const f = foreshadowSchema.parse({
      ...base,
      recoveryStatus: "partial",
      plantingMethod: "对话中的一个物件描述",
      purpose: "北境之战的引子",
      appearChapterId: "cccccccc-0000-7000-8000-0000000000c1",
      recoverChapterIds: ["cccccccc-0000-7000-8000-0000000000d1", "cccccccc-0000-7000-8000-0000000000d2"],
      characterIds: ["cccccccc-0000-7000-8000-0000000000e1", "cccccccc-0000-7000-8000-0000000000e2"],
    });
    expect(f.recoveryStatus).toBe("partial");
    expect(f.recoverChapterIds).toHaveLength(2);
  });

  test("仅核心必填项通过，回收状态缺省 unrecovered、可选项缺省 undefined", () => {
    const f = foreshadowSchema.parse(base);
    expect(f.recoveryStatus).toBe("unrecovered");
    expect(f.plantingMethod).toBeUndefined();
    expect(f.recoverChapterIds).toBeUndefined();
  });

  test("核心必填缺一或为空被拒绝", () => {
    for (const key of ["surfaceAction", "hiddenTruth", "attentionLevel"] as const) {
      const broken: Record<string, unknown> = { ...base };
      delete broken[key];
      expect(() => foreshadowSchema.parse(broken)).toThrow();
    }
    expect(() => foreshadowSchema.parse({ ...base, surfaceAction: "" })).toThrow();
    expect(() => foreshadowSchema.parse({ ...base, hiddenTruth: "" })).toThrow();
  });

  test("注意度越界与非整数被拒绝，边界 1 / 10 通过", () => {
    expect(() => foreshadowSchema.parse({ ...base, attentionLevel: 0 })).toThrow();
    expect(() => foreshadowSchema.parse({ ...base, attentionLevel: 11 })).toThrow();
    expect(() => foreshadowSchema.parse({ ...base, attentionLevel: 1.5 })).toThrow();
    expect(foreshadowSchema.parse({ ...base, attentionLevel: 1 }).attentionLevel).toBe(1);
    expect(foreshadowSchema.parse({ ...base, attentionLevel: 10 }).attentionLevel).toBe(10);
  });

  test("非法回收状态与空多值数组被拒绝", () => {
    expect(() =>
      foreshadowSchema.parse({ ...base, recoveryStatus: "recycled" }),
    ).toThrow();
    expect(() => foreshadowSchema.parse({ ...base, recoverChapterIds: [] })).toThrow();
    expect(() => foreshadowSchema.parse({ ...base, characterIds: [] })).toThrow();
  });
});

describe("foreshadowPatchSchema", () => {
  test("放行字段覆盖与 null 清空，空 patch 合法", () => {
    const patch = foreshadowPatchSchema.parse({
      recoveryStatus: "recovered",
      plantingMethod: null,
      recoverChapterIds: ["cccccccc-0000-7000-8000-0000000000d9"],
    });
    expect(patch.recoveryStatus).toBe("recovered");
    expect(patch.plantingMethod).toBeNull();
    expect(foreshadowPatchSchema.parse({})).toEqual({});
  });

  test("必填字段与回收状态不允许 null 清空，越界值仍被拒绝", () => {
    expect(() =>
      foreshadowPatchSchema.parse({ surfaceAction: null }),
    ).toThrow();
    expect(() => foreshadowPatchSchema.parse({ hiddenTruth: null })).toThrow();
    expect(() => foreshadowPatchSchema.parse({ attentionLevel: null })).toThrow();
    expect(() => foreshadowPatchSchema.parse({ recoveryStatus: null })).toThrow();
    expect(() => foreshadowPatchSchema.parse({ attentionLevel: 11 })).toThrow();
  });
});

describe("coreConflictSchema", () => {
  test("三项俱全通过", () => {
    const conflict = coreConflictSchema.parse({
      origin: "主角团与反派争夺可扭转时空的神器",
      impact: "主角团被迫流亡，同伴接连牺牲",
      idealResolution: "主角团获得神器，逆转结局拯救世界",
    });
    expect(conflict.idealResolution).toContain("神器");
  });
});

describe("outlineSchema", () => {
  const act = (name: string) => ({
    name,
    summary: `${name}的梗概`,
    keyPlotPoints: ["情节点1"],
  });

  test("部→幕两级结构通过", () => {
    const outline = outlineSchema.parse({
      title: "星轨之下",
      logline: "一名失忆的领航员必须找回记忆，才能阻止殖民地坠落。",
      theme: "记忆与身份",
      parts: [
        { name: "上部·失序", summary: "失序阶段的宏观概述", acts: [act("第一幕·开端"), act("第二幕·对抗")] },
        { name: "下部·归位", summary: "归位阶段的宏观概述", acts: [act("第三幕·结局")] },
      ],
    });
    expect(outline.parts).toHaveLength(2);
    expect(outline.parts[0]?.acts).toHaveLength(2);
  });

  test("零部与空幕部均被拒绝", () => {
    expect(() =>
      outlineSchema.parse({ title: "星轨之下", logline: "一句话", parts: [] }),
    ).toThrow();
    expect(() =>
      outlineSchema.parse({
        title: "星轨之下",
        logline: "一句话",
        parts: [{ name: "上部", summary: "概述", acts: [] }],
      }),
    ).toThrow();
  });
});

describe("chapterPlanSchema", () => {
  const chapter = (name: string) => ({ name, summary: `${name}的剧情概述` });

  test("多章规划通过，章名与概述均保留", () => {
    const plan = chapterPlanSchema.parse({
      chapters: Array.from({ length: 5 }, (_, i) => chapter(`第${i + 1}章`)),
    });
    expect(plan.chapters).toHaveLength(5);
    expect(plan.chapters[0]?.summary).toBe("第1章的剧情概述");
  });

  test("零章与超过 12 章被拒绝（数量防漂移上下限）", () => {
    expect(() => chapterPlanSchema.parse({ chapters: [] })).toThrow();
    expect(() =>
      chapterPlanSchema.parse({
        chapters: Array.from({ length: 13 }, (_, i) => chapter(`第${i + 1}章`)),
      }),
    ).toThrow();
  });

  test("空章名或空概述被拒绝", () => {
    expect(() => chapterPlanSchema.parse({ chapters: [{ name: "", summary: "概述" }] })).toThrow();
    expect(() => chapterPlanSchema.parse({ chapters: [{ name: "第一章", summary: "" }] })).toThrow();
  });
});

describe("outlineNodeSchema", () => {
  const baseNode = {
    parentId: null,
    type: "act" as const,
    name: "第一幕·开端",
    summary: "主角发现异常",
    keyPlotPoints: ["异常初现", "决定追查"],
    sort: 1,
    version: 1,
    isCurrentVersion: true,
    status: "planned" as const,
    documentId: null,
  };

  test("幕节点携带梗概与关键情节点通过", () => {
    const node = outlineNodeSchema.parse(baseNode);
    expect(node.summary).toBe("主角发现异常");
    expect(node.keyPlotPoints).toEqual(["异常初现", "决定追查"]);
  });

  test("内容两列为 null 仍通过（历史行兼容）", () => {
    const node = outlineNodeSchema.parse({ ...baseNode, type: "part", summary: null, keyPlotPoints: null });
    expect(node.summary).toBeNull();
    expect(node.keyPlotPoints).toBeNull();
  });

  test("非幕节点携带关键情节点被拒绝", () => {
    expect(() => outlineNodeSchema.parse({ ...baseNode, type: "part" })).toThrow(
      "关键情节点仅幕节点可携带",
    );
    expect(() => outlineNodeSchema.parse({ ...baseNode, type: "chapter" })).toThrow(
      "关键情节点仅幕节点可携带",
    );
  });

  test("空关键情节点数组被拒绝（null 与缺省以外的最小约束）", () => {
    expect(() => outlineNodeSchema.parse({ ...baseNode, keyPlotPoints: [] })).toThrow();
    expect(() => outlineNodeSchema.parse({ ...baseNode, keyPlotPoints: [""] })).toThrow();
  });

  test("patch 放行内容字段更新与清空", () => {
    const patch = outlineNodePatchSchema.parse({
      summary: "修订后的梗概",
      keyPlotPoints: null,
    });
    expect(patch).toEqual({ summary: "修订后的梗概", keyPlotPoints: null });
  });
});

describe("audienceSuggestionSchema", () => {
  test("选项数量下限生效", () => {
    expect(() =>
      audienceSuggestionSchema.parse({ options: [{ label: "a", description: "b" }] }),
    ).toThrow();
  });
});

import { describe, expect, test } from "bun:test";
import {
  audienceSuggestionSchema,
  characterSchema,
  coreConflictSchema,
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

describe("audienceSuggestionSchema", () => {
  test("选项数量下限生效", () => {
    expect(() =>
      audienceSuggestionSchema.parse({ options: [{ label: "a", description: "b" }] }),
    ).toThrow();
  });
});

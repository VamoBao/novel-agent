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
  test("最小字段通过且数组字段应用默认值", () => {
    const c = characterSchema.parse({
      name: "林澜",
      identity: "剑修",
      personality: "外冷内热",
      background: "下山寻找失踪的师姐",
      motivation: "查明师姐失踪真相",
    });
    expect(c.abilities).toEqual([]);
    expect(c.relationships).toEqual([]);
  });

  test("缺少必填字段被拒绝", () => {
    expect(() => characterSchema.parse({ name: "林澜" })).toThrow();
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

  test("三幕结构通过", () => {
    const outline = outlineSchema.parse({
      title: "星轨之下",
      logline: "一名失忆的领航员必须找回记忆，才能阻止殖民地坠落。",
      theme: "记忆与身份",
      acts: [act("第一幕·开端"), act("第二幕·对抗"), act("第三幕·结局")],
    });
    expect(outline.acts).toHaveLength(3);
  });

  test("少于三幕被拒绝", () => {
    expect(() =>
      outlineSchema.parse({
        title: "星轨之下",
        logline: "一句话",
        acts: [act("第一幕"), act("第二幕")],
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

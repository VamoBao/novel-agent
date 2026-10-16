import { describe, expect, test } from "bun:test";
import { renderView } from "./cli-channel";
import { characterSchema, type Character, type Outline } from "@novel/shared";

const character: Character = characterSchema.parse({
  basicInfo: { name: "林恒", gender: "男", appearance: "短发精瘦" },
  core: { desire: "证道长生", fear: "辜负同伴", narrativeRole: "主角" },
  background: "青云市集的散修少年",
  personality: "坚韧寡言",
  creationPurpose: "承载打破垄断的主线",
  endingDirection: "打破宗门垄断",
});

const outline: Outline = {
  title: "灵脉遗孤",
  logline: "散修少年夺回被宗门垄断的灵脉",
  parts: [
    {
      name: "第一部·风起",
      summary: "少年失去依托，踏上夺脉之路",
      acts: [
        {
          name: "第一幕·开端",
          summary: "市集少年目睹灵脉断绝",
          keyPlotPoints: ["情节点A：灵眼被夺", "情节点B：远走他乡"],
        },
      ],
    },
  ],
};

describe("renderView", () => {
  test("field-summary：标签与摘要", () => {
    expect(renderView({ kind: "field-summary", label: "姓名", summary: "林恒" })).toBe(
      "📋 【姓名】林恒",
    );
  });

  test("character-card：必填字段全渲染", () => {
    const text = renderView({ kind: "character-card", character });
    expect(text).toContain("📝 角色卡汇总：");
    expect(text).toContain("林恒（主角，男）");
    expect(text).toContain("渴望：证道长生");
    expect(text).toContain("恐惧：辜负同伴");
    expect(text).toContain("创作目的：承载打破垄断的主线");
    expect(text).toContain("结局方向：打破宗门垄断");
  });

  test("outline：confirm 简览不含关键情节点，full 含", () => {
    const confirm = renderView({ kind: "outline", detail: "confirm", outline });
    const full = renderView({ kind: "outline", detail: "full", outline });
    expect(confirm).toContain("📖 大纲草稿：《灵脉遗孤》");
    expect(confirm).not.toContain("情节点A");
    expect(full).toContain("✅ 大纲已生成：");
    expect(full).toContain("情节点A：灵眼被夺");
  });

  test("outline confirm：携带 newCharacters 时渲染新增角色清单，缺失或为空不渲染", () => {
    const withNew = renderView({
      kind: "outline",
      detail: "confirm",
      outline,
      newCharacters: [{ name: "萧无咎", role: "反派·血宗宗主" }],
    });
    expect(withNew).toContain("本次大纲新增角色");
    expect(withNew).toContain("萧无咎——反派·血宗宗主");
    // full 视图与空清单确认视图不渲染清单区块
    expect(renderView({ kind: "outline", detail: "full", outline, newCharacters: [] })).not.toContain("新增角色");
    expect(renderView({ kind: "outline", detail: "confirm", outline })).not.toContain("新增角色");
  });

  test("chapter-plan：幕梗概、情节点与章节列表齐全", () => {
    const text = renderView({
      kind: "chapter-plan",
      actName: "第1幕",
      actSummary: "第1幕梗概",
      keyPlotPoints: ["第1幕情节点"],
      plan: {
        chapters: [
          {
            name: "第一章·雨夜",
            summary: "雨夜的剧情概述",
            characters: [{ name: "林恒", role: "本章主视角" }],
          },
          {
            name: "第二章·来客",
            summary: "来客的剧情概述",
            characters: [
              { name: "林恒", role: "遭伏击的组织者" },
              { name: "萧无咎", role: "血宗宗主·本章首次登场的主要反派" },
            ],
          },
        ],
      },
    });
    expect(text).toContain("📑 章节规划草稿（第1幕）");
    expect(text).toContain("本幕梗概：第1幕梗概");
    expect(text).toContain("1) 第1幕情节点");
    expect(text).toContain("拟分 2 章：");
    expect(text).toContain("第1章 第一章·雨夜：雨夜的剧情概述（登场：林恒）");
    expect(text).toContain(
      "第2章 第二章·来客：来客的剧情概述（登场：林恒、萧无咎）",
    );
  });

  test("chapter-plan：携带 newCharacters 时渲染新增角色清单，缺失不渲染", () => {
    const view = {
      kind: "chapter-plan",
      actName: "第2幕",
      actSummary: "本幕梗概",
      keyPlotPoints: ["情节点A"],
      plan: {
        chapters: [
          {
            name: "第一章·雨夜",
            summary: "雨夜夺脉",
            characters: [{ name: "萧无咎", role: "血宗宗主·本章首次登场" }],
          },
        ],
      },
      newCharacters: [{ name: "萧无咎", role: "第1章登场·血宗宗主" }],
    } as const;
    const withNew = renderView(view as never);
    expect(withNew).toContain("本次规划新增角色");
    expect(withNew).toContain("萧无咎——第1章登场·血宗宗主");
    const withoutNew = renderView({ ...view, newCharacters: undefined } as never);
    expect(withoutNew).not.toContain("新增角色");
  });

  test("outline confirm：携带 newForeshadows 时渲染伏笔区块，缺失不渲染", () => {
    const withFs = renderView({
      kind: "outline", detail: "confirm", outline,
      newForeshadows: [{ surfaceAction: "送信伏笔", hiddenTruth: "暗示投敌", attentionLevel: 4, characterNames: ["林恒"], actName: "第一幕", recoverActNames: ["第三幕"] }],
    } as never);
    expect(withFs).toContain("本次大纲伏笔");
    expect(withFs).toContain("[第一幕] 送信伏笔");
    expect(renderView({ kind: "outline", detail: "confirm", outline } as never)).not.toContain("本次大纲伏笔");
  });

  test("outline confirm：携带 newLocations 时渲染地点区块，缺失或空不渲染", () => {
    const withLoc = renderView({
      kind: "outline", detail: "confirm", outline,
      newLocations: [{ name: "青云城", description: "东部边境要塞·主角初战的战场" }],
    } as never);
    expect(withLoc).toContain("本次大纲新增地点");
    expect(withLoc).toContain("青云城——东部边境要塞·主角初战的战场");
    expect(renderView({ kind: "outline", detail: "confirm", outline, newLocations: [] } as never)).not.toContain("新增地点");
    expect(renderView({ kind: "outline", detail: "confirm", outline } as never)).not.toContain("新增地点");
  });

  test("chapter-plan：携带 newForeshadows / foreshadowBindings 时渲染两区块，缺失不渲染", () => {
    const view = {
      kind: "chapter-plan", actName: "第2幕", actSummary: "梗概", keyPlotPoints: ["情节点"],
      plan: {
        chapters: [
          { name: "第一章·雨夜", summary: "概述", characters: [{ name: "林恒", role: "本章主视角" }] },
        ],
      },
      newForeshadows: [{ surfaceAction: "送信伏笔", hiddenTruth: "暗示投敌", attentionLevel: 4, characterNames: ["林恒"], chapterName: "第一章·雨夜", recoveryPlan: [{ actName: "第三幕", chapterNames: [] }] }],
      foreshadowBindings: [{ index: 1, chapterName: "第一章·雨夜" }],
    };
    const rendered = renderView(view as never);
    expect(rendered).toContain("本次规划新增伏笔");
    expect(rendered).toContain("送信伏笔");
    expect(rendered).toContain("伏笔绑定");
    expect(rendered).toContain("1) → 第一章·雨夜");
    expect(renderView({ ...view, newForeshadows: undefined, foreshadowBindings: undefined } as never)).not.toContain("伏笔");
  });

  test("outline confirm：伏笔单回收幕计划行内显示，缺失伏笔清单不显示", () => {
    const withRecover = renderView({
      kind: "outline", detail: "confirm", outline,
      newForeshadows: [{ surfaceAction: "送信伏笔", hiddenTruth: "暗示投敌", attentionLevel: 4, characterNames: ["林恒"], actName: "第一幕", recoverActNames: ["第三幕"] }],
    } as never);
    expect(withRecover).toContain("回收幕：第三幕");
    const withoutRecover = renderView({
      kind: "outline", detail: "confirm", outline,
    } as never);
    expect(withoutRecover).not.toContain("回收幕：");
  });

  test("outline confirm：展示每个计划回收幕", () => {
    const text = renderView({
      kind: "outline", detail: "confirm", outline,
      newForeshadows: [{ surfaceAction: "送信伏笔", hiddenTruth: "暗示投敌", attentionLevel: 8,
        characterNames: ["林恒"], actName: "第一幕", recoverActNames: ["第三幕", "终局幕"] }],
    } as never);
    expect(text).toContain("回收幕：第三幕、终局幕");
  });

  test("chapter-plan：新增伏笔展示多幕具体回收章与待细化计划", () => {
    const text = renderView({
      kind: "chapter-plan", actName: "第一幕", actSummary: "梗概", keyPlotPoints: [],
      plan: { chapters: [{ name: "起行章", summary: "概述", characters: [{ name: "林恒", role: "主角" }] }] },
      newForeshadows: [{ surfaceAction: "送信伏笔", hiddenTruth: "暗示投敌", attentionLevel: 8,
        characterNames: ["林恒"], chapterName: "起行章", recoveryPlan: [
          { actName: "第三幕", chapterNames: ["解铃章", "证词章"] },
          { actName: "终局幕", chapterNames: [] },
        ] }],
      foreshadowRecoverBindings: [{ index: 2, chapterName: "破局章" }],
    } as never);
    expect(text).toContain("第三幕：解铃章、证词章");
    expect(text).toContain("终局幕：待细化");
    expect(text).toContain("♻ 伏笔回收绑定（确认后生效）");
    expect(text).toContain("2) → 破局章");
  });

  test("chapter-plan：携带 foreshadowRecoverBindings 时渲染回收绑定区块，缺失或空不渲染", () => {
    const view = {
      kind: "chapter-plan", actName: "第2幕", actSummary: "梗概", keyPlotPoints: ["情节点"],
      plan: {
        chapters: [
          { name: "第一章·雨夜", summary: "概述", characters: [{ name: "林恒", role: "本章主视角" }] },
        ],
      },
      foreshadowRecoverBindings: [{ index: 1, chapterName: "第二章·来客" }],
    };
    const rendered = renderView(view as never);
    expect(rendered).toContain("♻ 伏笔回收绑定（确认后生效）");
    expect(rendered).toContain("1) → 第二章·来客");
    expect(renderView({ ...view, foreshadowRecoverBindings: [] } as never)).not.toContain("回收绑定");
    expect(renderView({ ...view, foreshadowRecoverBindings: undefined } as never)).not.toContain("回收绑定");
  });

  test("chapter-plan：携带 newLocations 时渲染地点区块，缺失或空不渲染", () => {
    const view = {
      kind: "chapter-plan", actName: "第2幕", actSummary: "梗概", keyPlotPoints: ["情节点"],
      plan: {
        chapters: [
          { name: "第一章·雨夜", summary: "概述", characters: [{ name: "林恒", role: "本章主视角" }] },
        ],
      },
      newLocations: [{ name: "青云城", description: "第2章主战场·东部边境要塞" }],
    };
    const rendered = renderView(view as never);
    expect(rendered).toContain("本次规划新增地点");
    expect(rendered).toContain("青云城——第2章主战场·东部边境要塞");
    expect(renderView({ ...view, newLocations: [] } as never)).not.toContain("新增地点");
    expect(renderView({ ...view, newLocations: undefined } as never)).not.toContain("新增地点");
  });

  test("worldview：可选行缺省不渲染", () => {
    const text = renderView({
      kind: "worldview",
      worldview: { background: { geography: "九州大陆" }, taboos: ["不可出现现代科技"] },
    });
    expect(text).toContain("地理位置：九州大陆");
    expect(text).not.toContain("架空属性");
    expect(text).toContain("禁忌：不可出现现代科技");
  });

  test("conflict：三要素齐全", () => {
    const text = renderView({
      kind: "conflict",
      conflict: { origin: "宗门垄断灵脉", impact: "散修如草芥", idealResolution: "灵脉归于众生" },
    });
    expect(text).toContain("由来：宗门垄断灵脉");
    expect(text).toContain("影响：散修如草芥");
    expect(text).toContain("理想解决：灵脉归于众生");
  });
});

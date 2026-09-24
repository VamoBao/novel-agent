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

  test("chapter-plan：幕梗概、情节点与章节列表齐全", () => {
    const text = renderView({
      kind: "chapter-plan",
      actName: "第1幕",
      actSummary: "第1幕梗概",
      keyPlotPoints: ["第1幕情节点"],
      plan: {
        chapters: [
          { name: "第一章·雨夜", summary: "雨夜的剧情概述" },
          { name: "第二章·来客", summary: "来客的剧情概述" },
        ],
      },
    });
    expect(text).toContain("📑 章节规划草稿（第1幕）");
    expect(text).toContain("本幕梗概：第1幕梗概");
    expect(text).toContain("1) 第1幕情节点");
    expect(text).toContain("拟分 2 章：");
    expect(text).toContain("第1章 第一章·雨夜：雨夜的剧情概述");
    expect(text).toContain("第2章 第二章·来客：来客的剧情概述");
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

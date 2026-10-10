import { describe, expect, test } from "bun:test";
import { outlineSchemaFor, saveOutlineInputSchemaFor } from "./outline-agent";
import { outlineSchema, type Outline } from "@novel/shared";

const act = (name: string) => ({
  name,
  summary: `${name}的梗概`,
  keyPlotPoints: ["情节点1"],
});

const fourActTwoPartOutline: Outline = outlineSchema.parse({
  title: "四幕之书",
  logline: "一名测试员验证部幕两级约束。",
  parts: [
    { name: "第一部·风起", summary: "风起的宏观概述", acts: [act("第一幕"), act("第二幕")] },
    { name: "第二部·云涌", summary: "云涌的宏观概述", acts: [act("第三幕"), act("第四幕")] },
  ],
});

describe("outlineSchemaFor", () => {
  test("部数与幕数均符合要求时通过", () => {
    const parsed = outlineSchemaFor(4, 2).parse(fourActTwoPartOutline);
    expect(parsed.parts).toHaveLength(2);
    expect(parsed.parts[0]?.acts).toHaveLength(2);

    const onePart = outlineSchema.parse({
      ...fourActTwoPartOutline,
      parts: [
        { name: "全一册", summary: "概述", acts: [...fourActTwoPartOutline.parts.flatMap((p) => p.acts), act("第五幕")] },
      ],
    });
    expect(outlineSchemaFor(5, 1).parse(onePart).parts[0]?.acts).toHaveLength(5);
  });

  test("幕数或部数不符时拒绝且提示含期望数量", () => {
    expect(() => outlineSchemaFor(5, 2).parse(fourActTwoPartOutline)).toThrow("5 幕");
    expect(() => outlineSchemaFor(3, 2).parse(fourActTwoPartOutline)).toThrow("3 幕");
    expect(() => outlineSchemaFor(4, 1).parse(fourActTwoPartOutline)).toThrow("1 部");
  });

  test("底座 schema 的每部至少一幕约束仍然生效", () => {
    const broken = {
      ...fourActTwoPartOutline,
      parts: [
        { name: "第一部", summary: "概述", acts: [act("第一幕")] },
        { name: "第二部", summary: "概述", acts: [] },
      ],
    };
    expect(() => outlineSchemaFor(1, 2).parse(broken)).toThrow();
  });
});

describe("saveOutlineInputSchemaFor", () => {
  const submission = { ...fourActTwoPartOutline, newCharacters: [{ name: "萧无咎", role: "反派·血宗宗主" }] };

  test("大纲 + 新增角色清单均合规时通过", () => {
    const parsed = saveOutlineInputSchemaFor(4, 2).parse({ ...submission, newForeshadows: [], newLocations: [] });
    expect(parsed.newCharacters).toHaveLength(1);
    // 空清单合法：大纲未引入新角色是正常路径
    expect(saveOutlineInputSchemaFor(4, 2).parse({ ...fourActTwoPartOutline, newCharacters: [], newForeshadows: [], newLocations: [] }).newCharacters).toEqual([]);
  });

  test("newCharacters 缺失或项内字段空串被拒绝", () => {
    expect(() => saveOutlineInputSchemaFor(4, 2).parse(fourActTwoPartOutline)).toThrow();
    expect(() => saveOutlineInputSchemaFor(4, 2).parse({ ...fourActTwoPartOutline, newCharacters: [{ name: "萧无咎" }], newForeshadows: [], newLocations: [] })).toThrow();
    expect(() => saveOutlineInputSchemaFor(4, 2).parse({ ...fourActTwoPartOutline, newCharacters: [{ name: "", role: "反派" }], newForeshadows: [], newLocations: [] })).toThrow();
  });

  test("清单内名字重复被拒绝", () => {
    expect(() =>
      saveOutlineInputSchemaFor(4, 2).parse({
        ...fourActTwoPartOutline,
        newCharacters: [
          { name: "萧无咎", role: "反派·血宗宗主" },
          { name: "萧无咎", role: "同一人重复列出" },
        ],
        newForeshadows: [], newLocations: [],
      }),
    ).toThrow("不得重复");
  });

  test("部/幕强校验仍然生效", () => {
    expect(() => saveOutlineInputSchemaFor(5, 2).parse({ ...submission, newForeshadows: [], newLocations: [] })).toThrow("5 幕");
    expect(() => saveOutlineInputSchemaFor(4, 1).parse({ ...submission, newForeshadows: [], newLocations: [] })).toThrow("1 部");
  });

  const outlineFs = { surfaceAction: "送信伏笔", hiddenTruth: "暗示投敌", attentionLevel: 4, characterNames: ["林恒"], actName: "第一幕" };

  test("newForeshadows 缺省省略不合法（必填数组）、空数组合法、完整条目通过", () => {
    expect(() => saveOutlineInputSchemaFor(4, 2).parse(submission)).toThrow(); // submission 不含伏笔字段
    expect(saveOutlineInputSchemaFor(4, 2).parse({ ...submission, newForeshadows: [], newLocations: [] }).newForeshadows).toEqual([]);
    expect(saveOutlineInputSchemaFor(4, 2).parse({ ...submission, newForeshadows: [outlineFs], newLocations: [] }).newForeshadows).toHaveLength(1);
  });

  const outlineLoc = { name: "青云城", description: "东部边境要塞·主角初战的战场" };

  test("newLocations 必填数组：缺省省略不合法、空数组合法、完整条目通过", () => {
    expect(() => saveOutlineInputSchemaFor(4, 2).parse({ ...submission, newForeshadows: [], newLocations: [] as never[] })).not.toThrow();
    expect(() => saveOutlineInputSchemaFor(4, 2).parse({ ...submission, newForeshadows: [] })).toThrow();
    expect(saveOutlineInputSchemaFor(4, 2).parse({ ...submission, newForeshadows: [], newLocations: [outlineLoc] }).newLocations).toHaveLength(1);
    expect(saveOutlineInputSchemaFor(4, 2).parse({ ...submission, newForeshadows: [], newLocations: [] }).newLocations).toEqual([]);
  });

  test("地点清单内名字重复被拒绝；项内空名字/空定位被拒绝", () => {
    expect(() =>
      saveOutlineInputSchemaFor(4, 2).parse({
        ...submission,
        newForeshadows: [],
        newLocations: [outlineLoc, { ...outlineLoc, description: "同一地点重复列出" }],
      }),
    ).toThrow("不得重复");
    expect(() =>
      saveOutlineInputSchemaFor(4, 2).parse({ ...submission, newForeshadows: [], newLocations: [{ name: "", description: "要塞" }] }),
    ).toThrow();
    expect(() =>
      saveOutlineInputSchemaFor(4, 2).parse({ ...submission, newForeshadows: [], newLocations: [{ name: "青云城", description: "" }] }),
    ).toThrow();
  });

  test("recoverActName 幕序校验：晚于埋设幕通过；缺省合法；同名幕 / 更早幕 / 不存在的幕被拒绝", () => {
    const base = { ...submission, newLocations: [] as never[] };
    expect(() =>
      saveOutlineInputSchemaFor(4, 2).parse({
        ...base,
        newForeshadows: [{ ...outlineFs, recoverActName: "第二幕" }],
      }),
    ).not.toThrow();
    expect(() =>
      saveOutlineInputSchemaFor(4, 2).parse({ ...base, newForeshadows: [outlineFs] }),
    ).not.toThrow();
    expect(() =>
      saveOutlineInputSchemaFor(4, 2).parse({
        ...base,
        newForeshadows: [{ ...outlineFs, recoverActName: "第一幕" }],
      }),
    ).toThrow("回收幕");
    expect(() =>
      saveOutlineInputSchemaFor(4, 2).parse({
        ...base,
        newForeshadows: [{ ...outlineFs, recoverActName: "不存在的幕" }],
      }),
    ).toThrow("回收幕");
  });

  test("伏笔清单内表面行为重复被拒绝", () => {
    expect(() =>
      saveOutlineInputSchemaFor(4, 2).parse({
        ...submission,
        newForeshadows: [outlineFs, { ...outlineFs, actName: "第二幕" }], newLocations: [],
      }),
    ).toThrow("不得重复");
  });
});

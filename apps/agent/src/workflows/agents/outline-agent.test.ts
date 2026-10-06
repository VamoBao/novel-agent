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
    const parsed = saveOutlineInputSchemaFor(4, 2).parse(submission);
    expect(parsed.newCharacters).toHaveLength(1);
    // 空清单合法：大纲未引入新角色是正常路径
    expect(saveOutlineInputSchemaFor(4, 2).parse({ ...fourActTwoPartOutline, newCharacters: [] }).newCharacters).toEqual([]);
  });

  test("newCharacters 缺失或项内字段空串被拒绝", () => {
    expect(() => saveOutlineInputSchemaFor(4, 2).parse(fourActTwoPartOutline)).toThrow();
    expect(() => saveOutlineInputSchemaFor(4, 2).parse({ ...fourActTwoPartOutline, newCharacters: [{ name: "萧无咎" }] })).toThrow();
    expect(() => saveOutlineInputSchemaFor(4, 2).parse({ ...fourActTwoPartOutline, newCharacters: [{ name: "", role: "反派" }] })).toThrow();
  });

  test("清单内名字重复被拒绝", () => {
    expect(() =>
      saveOutlineInputSchemaFor(4, 2).parse({
        ...fourActTwoPartOutline,
        newCharacters: [
          { name: "萧无咎", role: "反派·血宗宗主" },
          { name: "萧无咎", role: "同一人重复列出" },
        ],
      }),
    ).toThrow("不得重复");
  });

  test("部/幕强校验仍然生效", () => {
    expect(() => saveOutlineInputSchemaFor(5, 2).parse(submission)).toThrow("5 幕");
    expect(() => saveOutlineInputSchemaFor(4, 1).parse(submission)).toThrow("1 部");
  });
});

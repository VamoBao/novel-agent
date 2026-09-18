import { describe, expect, test } from "bun:test";
import { outlineSchemaFor } from "./outline-agent";
import { outlineSchema, type Outline } from "../../schemas";

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

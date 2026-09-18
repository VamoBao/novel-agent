import { describe, expect, test } from "bun:test";
import { outlineSchemaForActs } from "./outline-agent";
import { outlineSchema, type Outline } from "../../schemas";

const act = (name: string) => ({
  name,
  summary: `${name}的梗概`,
  keyPlotPoints: ["情节点1"],
});

const fourActOutline: Outline = outlineSchema.parse({
  title: "四幕之书",
  logline: "一名测试员验证幕数约束。",
  acts: [act("第一幕"), act("第二幕"), act("第三幕"), act("第四幕")],
});

describe("outlineSchemaForActs", () => {
  test("幕数与要求一致时通过", () => {
    expect(outlineSchemaForActs(4).parse(fourActOutline).acts).toHaveLength(4);
    expect(outlineSchemaForActs(5).parse({ ...fourActOutline, acts: [...fourActOutline.acts, act("第五幕")] }).acts).toHaveLength(5);
  });

  test("幕数不符时拒绝且提示信息含期望幕数", () => {
    expect(() => outlineSchemaForActs(5).parse(fourActOutline)).toThrow("大纲必须恰好为 5 幕");
    expect(() => outlineSchemaForActs(3).parse(fourActOutline)).toThrow("大纲必须恰好为 3 幕");
  });

  test("底座 schema 的最少三幕约束仍然生效", () => {
    expect(() =>
      outlineSchemaForActs(3).parse({ ...fourActOutline, acts: [act("第一幕"), act("第二幕")] }),
    ).toThrow();
  });
});

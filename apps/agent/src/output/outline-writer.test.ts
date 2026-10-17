import { describe, expect, test } from "bun:test";
import { outlineFilePath } from "./outline-writer";

/** 大纲 JSON 产物已随大纲入库退役（theme 存 novels 表）：本模块仅剩历史残留清理路径 */
describe("outlineFilePath", () => {
  test("UUID id 生成 output/<id>.json 路径", () => {
    expect(outlineFilePath("4ce040f8-ce7b-4578-b19b-11c17ba7b9d8")).toBe(
      "output/4ce040f8-ce7b-4578-b19b-11c17ba7b9d8.json",
    );
  });

  test("含路径分隔符等危险字符的 id 被拒绝", () => {
    expect(() => outlineFilePath("../evil")).toThrow("非法");
    expect(() => outlineFilePath("a/b")).toThrow("非法");
    expect(() => outlineFilePath("a b")).toThrow("非法");
  });
});

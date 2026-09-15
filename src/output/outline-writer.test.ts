import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { outlineFilePath, saveOutline } from "./outline-writer";
import { outlineSchema, type Outline } from "../schemas";

let tempDir: string;

afterAll(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

const outline: Outline = outlineSchema.parse({
  title: "测试之书",
  logline: "一名测试员验证落盘流程。",
  acts: [
    { name: "第一幕", summary: "开端", keyPlotPoints: ["点1"] },
    { name: "第二幕", summary: "对抗", keyPlotPoints: ["点2"] },
    { name: "第三幕", summary: "结局", keyPlotPoints: ["点3"] },
  ],
});

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

describe("saveOutline", () => {
  test("写入 JSON 且内容可完整读回（roundtrip 通过 schema 校验）", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "novel-output-"));
    const id = "0f0e0d0c-1111-4222-8333-444455556666";
    const path = await saveOutline(id, outline, tempDir);
    expect(path).toBe(join(tempDir, `${id}.json`));

    const raw = await Bun.file(path).text();
    const parsed = outlineSchema.parse(JSON.parse(raw));
    expect(parsed.title).toBe("测试之书");
    expect(parsed.acts).toHaveLength(3);
  });

  test("目录不存在时自动创建", async () => {
    const dir = join(tempDir, "not-exist-yet");
    await mkdir(tempDir, { recursive: true });
    const path = await saveOutline("safe-id-1", outline, dir);
    expect(await Bun.file(path).exists()).toBe(true);
  });
});

import { describe, expect, test } from "bun:test";
import { generateUuidV7 } from "./id";

const V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("generateUuidV7", () => {
  test("符合 UUIDv7 格式（版本位 7，变体位 10xx）", () => {
    for (let i = 0; i < 100; i++) {
      expect(generateUuidV7()).toMatch(V7_RE);
    }
  });

  test("批量生成不重复", () => {
    const set = new Set(Array.from({ length: 1000 }, () => generateUuidV7()));
    expect(set.size).toBe(1000);
  });

  test("前 48bit 为毫秒时间戳（可解析还原）", () => {
    const ts = 1789000001234;
    const u = generateUuidV7(ts);
    const tsHex = u.replace(/-/g, "").slice(0, 12);
    expect(Number.parseInt(tsHex, 16)).toBe(ts);
  });

  test("时间戳不同则字典序不同（时间有序）", () => {
    const early = generateUuidV7(1_000_000);
    const late = generateUuidV7(2_000_000);
    expect(early < late).toBe(true);
  });
});

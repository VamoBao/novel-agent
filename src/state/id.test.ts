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

  test("前 48bit 为毫秒时间戳（落在生成时刻区间内）", () => {
    const before = Date.now();
    const u = generateUuidV7();
    const after = Date.now();
    const ts = Number.parseInt(u.replace(/-/g, "").slice(0, 12), 16);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  test("连续生成保持字典序（Bun 原生同毫秒单调递增）", () => {
    for (let i = 0; i < 200; i++) {
      const a = generateUuidV7();
      const b = generateUuidV7();
      expect(a < b).toBe(true);
    }
  });
});

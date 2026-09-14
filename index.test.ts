import { describe, expect, test } from "bun:test";

describe("smoke", () => {
  test("bun test runner is wired up", () => {
    expect(1 + 1).toBe(2);
  });
});

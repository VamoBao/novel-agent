import { describe, expect, test } from "bun:test";
import { MemoryNovelStateStore } from "./memory-store";
import { generateNovelId } from "./id";
import type { NovelState } from "./types";

function makeState(id: string): NovelState {
  return { id, status: "initializing", createdAt: "2026-09-15T00:00:00.000Z", updatedAt: "2026-09-15T00:00:00.000Z" };
}

describe("generateNovelId", () => {
  test("生成 UUIDv7 格式的唯一 ID", () => {
    const a = generateNovelId();
    const b = generateNovelId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
});

describe("MemoryNovelStateStore", () => {
  test("create 后可 get 到；未知 id 返回 undefined", async () => {
    const store = new MemoryNovelStateStore();
    await store.create(makeState("id-1"));
    expect((await store.get("id-1"))?.status).toBe("initializing");
    expect(await store.get("unknown")).toBeUndefined();
  });

  test("create 重复 id 抛错（id 是唯一标识）", async () => {
    const store = new MemoryNovelStateStore();
    await store.create(makeState("dup"));
    expect(store.create(makeState("dup"))).rejects.toThrow("已存在");
  });

  test("update 合并 patch 并自动盖章 updatedAt", async () => {
    const store = new MemoryNovelStateStore();
    await store.create(makeState("id-2"));
    const updated = await store.update("id-2", { status: "gathering" });
    expect(updated.status).toBe("gathering");
    expect(updated.createdAt).toBe("2026-09-15T00:00:00.000Z");
    expect(updated.updatedAt >= "2026-09-15T00:00:00.000Z").toBe(true);
    expect((await store.get("id-2"))?.status).toBe("gathering");
  });

  test("update 不存在的 id 抛错", async () => {
    const store = new MemoryNovelStateStore();
    expect(store.update("ghost", { status: "gathering" })).rejects.toThrow("不存在");
  });
});

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NovelStore } from "./novel-store";

let tempDir: string;

afterAll(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

const V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("NovelStore", () => {
  test("createNovel 自动生成 UUIDv7 id，getNovel 取回", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "novel-db-"));
    const store = NovelStore.open(join(tempDir, "test.db"));
    const created = store.createNovel();
    expect(created.id).toMatch(V7_RE);
    expect(created.name).toBeNull();

    const got = store.getNovel(created.id);
    expect(got?.id).toBe(created.id);
    expect(got?.createdAt).toBe(created.createdAt);
    store.close();
  });

  test("指定 id 创建与重复 id 拒绝", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-db2-"));
    const store = NovelStore.open(join(dir, "test.db"));
    const id = "eeeeeeee-0000-7000-8000-000000000001";
    store.createNovel({ id, name: "测试之书", author: "vamobao", description: "一句话" });
    expect(store.getNovel(id)?.name).toBe("测试之书");
    expect(() => store.createNovel({ id })).toThrow("已存在");
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("updateNovel 部分更新并盖章 updated_at（未给字段保留原值）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-db3-"));
    const store = NovelStore.open(join(dir, "test.db"));
    const created = store.createNovel({ name: "旧名" });
    await new Promise((r) => setTimeout(r, 20));
    const updated = store.updateNovel(created.id, {
      name: "新名",
      description: "新的梗概",
    });
    expect(updated.name).toBe("新名");
    expect(updated.description).toBe("新的梗概");
    expect(updated.author).toBeNull();
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt > created.updatedAt).toBe(true);
    expect(() => store.updateNovel("eeeeeeee-0000-7000-8000-ffffffffffff", {})).toThrow(
      "不存在",
    );
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("不存在的 id 返回 undefined", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-db4-"));
    const store = NovelStore.open(join(dir, "test.db"));
    expect(store.getNovel("eeeeeeee-0000-7000-8000-0000000000ff")).toBeUndefined();
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
});

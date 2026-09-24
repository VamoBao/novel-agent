import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { NovelStore } from "./novel-store";
import { openDatabase } from "./db";

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

describe("书库管理（pinned / favorite / 级联删除 / v4 迁移）", () => {
  test("setNovelPinned / setNovelFavorite 置位返回更新后记录，不动 updated_at", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-mgmt-"));
    const store = NovelStore.open(join(dir, "test.db"));
    const created = store.createNovel({ name: "测试之书" });
    const pinned = store.setNovelPinned(created.id, true);
    const favorited = store.setNovelFavorite(created.id, true);
    expect(pinned.pinned).toBe(true);
    expect(pinned.updatedAt).toBe(created.updatedAt);
    expect(favorited.favorite).toBe(true);
    expect(() => store.setNovelPinned("eeeeeeee-0000-7000-8000-00000000bad", true)).toThrow(
      "不存在",
    );
    expect(() => store.setNovelFavorite("eeeeeeee-0000-7000-8000-00000000bad", true)).toThrow(
      "不存在",
    );
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("listNovels 置顶优先，组内按创建时间倒序", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-order-"));
    const store = NovelStore.open(join(dir, "test.db"));
    const older = store.createNovel({ id: "aaaaaaaa-0000-7000-8000-000000000001", name: "旧书" });
    store.createNovel({ id: "aaaaaaaa-0000-7000-8000-000000000002", name: "新书" });
    let list = store.listNovels();
    expect(list.map((n) => n.name)).toEqual(["新书", "旧书"]);

    store.setNovelPinned(older.id, true);
    list = store.listNovels();
    expect(list.map((n) => n.name)).toEqual(["旧书", "新书"]);
    expect(list[0]?.pinned).toBe(true);
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("deleteNovel 单事务级联清空六表关联数据", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-del-"));
    const db = openDatabase(join(dir, "test.db"));
    const store = new NovelStore(db);
    const id = "aaaaaaaa-0000-7000-8000-000000000003";
    store.createNovel({ id, name: "待删之书" });
    db
      .prepare(
        `INSERT INTO worldviews (id, novel_id, geography, fantasy_attributes,
         real_world_mapping, taboos, created_at, updated_at)
         VALUES ('wv-1', ?, '大陆', NULL, NULL, '[]', ?, ?);`,
      )
      .run(id, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z");
    db
      .prepare(
        `INSERT INTO characters (id, novel_id, name, desire, fear, narrative_role, background,
         creation_purpose, ending_direction, created_at)
         VALUES ('ch-1', ?, '甲', '愿', '惧', '主角', '背景', '目的', '结局', ?);`,
      )
      .run(id, "2026-01-01T00:00:00Z");
    db
      .prepare(
        `INSERT INTO outlines (id, novel_id, parent_id, type, name, sort, version,
         is_current_version, status, created_at, updated_at)
         VALUES ('part-1', ?, NULL, 'part', '第一部', 1, 1, 1, 'planned', ?, ?),
                ('act-1', ?, 'part-1', 'act', '第一幕', 1, 1, 1, 'planned', ?, ?);`,
      )
      .run(id, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", id, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z");
    db
      .prepare(
        `INSERT INTO locations (id, novel_id, parent_id, name, x, y, layer, population,
         created_at, updated_at)
         VALUES ('loc-1', ?, NULL, '北境大陆', 0, 0, '地面', NULL, ?, ?),
                ('loc-2', ?, 'loc-1', '雾港城', 123.5, -67.8, '地面', 250000, ?, ?);`,
      )
      .run(id, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", id, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z");
    db
      .prepare(
        `INSERT INTO foreshadows (id, novel_id, surface_action, hidden_truth, attention_level,
         recovery_status, recover_chapter_ids, character_ids, created_at, updated_at)
         VALUES ('fs-1', ?, '送信任务', '借刀杀人', 4, 'partial', '["ch-a", "ch-b"]', '["ch-1"]', ?, ?);`,
      )
      .run(id, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z");

    store.deleteNovel(id);
    expect(store.getNovel(id)).toBeUndefined();
    expect((db.prepare("SELECT COUNT(*) AS c FROM worldviews").get() as { c: number }).c).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS c FROM characters").get() as { c: number }).c).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS c FROM outlines").get() as { c: number }).c).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS c FROM locations").get() as { c: number }).c).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS c FROM foreshadows").get() as { c: number }).c).toBe(0);
    expect(() => store.deleteNovel(id)).toThrow("不存在");
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("v4 旧库经 openDatabase 迁移：数据保留、新列可用、版本升到 8", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-mig-"));
    const dbPath = join(dir, "v4.db");
    // 手工构造 v4 形态的库：旧 novels 结构（无 pinned / favorite）+ 旧 outlines 结构
    //（无内容列，v4 库必含该表——跨版本直升时 5→6 段会对其补列）+ 一行真实数据
    const legacy = new Database(dbPath, { create: true });
    legacy.exec("PRAGMA foreign_keys = ON;");
    legacy.exec(`
      CREATE TABLE novels (
        id TEXT PRIMARY KEY,
        name TEXT,
        author TEXT,
        description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE outlines (
        id TEXT PRIMARY KEY,
        novel_id TEXT NOT NULL REFERENCES novels(id),
        parent_id TEXT REFERENCES outlines(id),
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        sort INTEGER NOT NULL,
        version INTEGER NOT NULL,
        is_current_version INTEGER NOT NULL,
        status TEXT NOT NULL,
        document_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    legacy
      .prepare(
        "INSERT INTO novels (id, name, author, description, created_at, updated_at) VALUES (?, ?, NULL, NULL, ?, ?);",
      )
      .run("aaaaaaaa-0000-7000-8000-000000000004", "旧世界之书", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z");
    legacy.exec("PRAGMA user_version = 4;");
    legacy.close();

    const db = openDatabase(dbPath);
    const store = new NovelStore(db);
    const record = store.getNovel("aaaaaaaa-0000-7000-8000-000000000004");
    expect(record?.name).toBe("旧世界之书");
    expect(record?.pinned).toBe(false);
    expect(record?.favorite).toBe(false);
    store.setNovelPinned("aaaaaaaa-0000-7000-8000-000000000004", true);
    expect(store.listNovels()[0]?.pinned).toBe(true);
    expect(
      (db.query("PRAGMA user_version").get() as { user_version: number }).user_version,
    ).toBe(8);
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("并发防锁：busy_timeout 生效，版本匹配的重复打开零写不冲突", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-lock-"));
    const dbPath = join(dir, "test.db");
    const setup = openDatabase(dbPath);
    setup.close();

    // 写锁被另一连接持有时（模拟 agent 进程写库），纯读路径照常工作
    const holder = new Database(dbPath);
    holder.exec("BEGIN IMMEDIATE;");
    const reader = openDatabase(dbPath);
    expect(
      (reader.query("PRAGMA busy_timeout").get() as { timeout: number }).timeout,
    ).toBe(5000);
    expect(new NovelStore(reader).listNovels()).toEqual([]);
    reader.close();
    holder.exec("COMMIT;");
    holder.close();
    await rm(dir, { recursive: true, force: true });
  });
});

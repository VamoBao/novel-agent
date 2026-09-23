import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./db";

/** v4/v5 形态的 outlines 建表（无内容列）——5→6 迁移的目标表 */
const LEGACY_OUTLINES_SQL = `
  CREATE TABLE outlines (
    id TEXT PRIMARY KEY,
    novel_id TEXT NOT NULL REFERENCES novels(id),
    parent_id TEXT REFERENCES outlines(id),
    type TEXT NOT NULL CHECK (type IN ('part', 'act', 'chapter')),
    name TEXT NOT NULL,
    sort INTEGER NOT NULL CHECK (sort >= 1),
    version INTEGER NOT NULL CHECK (version >= 1),
    is_current_version INTEGER NOT NULL CHECK (is_current_version IN (0, 1)),
    status TEXT NOT NULL CHECK (status IN ('deprecated', 'planned', 'writing', 'completed')),
    document_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

const NOVEL_ID = "aaaaaaaa-0000-7000-8000-000000000004";
const NOW = "2026-01-01T00:00:00Z";

/**
 * 手工构造旧版本形态的库：novels（v4 无 pinned/favorite / v5 有）+ outlines（均无内容列），
 * 各插一行真实数据并写 user_version，随后关闭交由 openDatabase 触发迁移。
 */
function createLegacyDb(path: string, version: 4 | 5): void {
  const legacy = new Database(path, { create: true });
  legacy.exec("PRAGMA foreign_keys = ON;");
  const pinnedCols =
    version === 5
      ? "pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)), favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),"
      : "";
  legacy.exec(`
    CREATE TABLE novels (
      id TEXT PRIMARY KEY,
      name TEXT,
      author TEXT,
      description TEXT,
      ${pinnedCols}
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  legacy.exec(LEGACY_OUTLINES_SQL);
  if (version === 5) {
    legacy
      .prepare(
        "INSERT INTO novels (id, name, author, description, pinned, favorite, created_at, updated_at) VALUES (?, ?, NULL, NULL, 1, 0, ?, ?);",
      )
      .run(NOVEL_ID, "旧世界之书", NOW, NOW);
  } else {
    legacy
      .prepare(
        "INSERT INTO novels (id, name, author, description, created_at, updated_at) VALUES (?, ?, NULL, NULL, ?, ?);",
      )
      .run(NOVEL_ID, "旧世界之书", NOW, NOW);
  }
  legacy
    .prepare(
      "INSERT INTO outlines (id, novel_id, parent_id, type, name, sort, version, is_current_version, status, created_at, updated_at) VALUES (?, ?, NULL, 'part', '第一部', 1, 1, 1, 'planned', ?, ?);",
    )
    .run("bbbbbbbb-0000-7000-8000-000000000004", NOVEL_ID, NOW, NOW);
  legacy.exec(`PRAGMA user_version = ${version};`);
  legacy.close();
}

function tableColumns(db: Database, table: string): string[] {
  return (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

describe("openDatabase 迁移（SCHEMA_VERSION 6）", () => {
  const tempDirs: string[] = [];

  afterAll(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  test("v5 库迁移：outlines 补内容列、数据无损、版本升 6", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-db-mig5-"));
    tempDirs.push(dir);
    const dbPath = join(dir, "v5.db");
    createLegacyDb(dbPath, 5);

    const db = openDatabase(dbPath);
    const cols = tableColumns(db, "outlines");
    expect(cols).toContain("summary");
    expect(cols).toContain("key_plot_points");

    // 迁移只补列不回填：旧大纲行内容列为 NULL，结构字段原样保留
    const outline = db
      .query("SELECT name, summary, key_plot_points FROM outlines WHERE id = 'bbbbbbbb-0000-7000-8000-000000000004'")
      .get() as { name: string; summary: string | null; key_plot_points: string | null };
    expect(outline.name).toBe("第一部");
    expect(outline.summary).toBeNull();
    expect(outline.key_plot_points).toBeNull();

    // v5 已有的 novels 管理列与数据（pinned=1）不受迁移影响
    const novel = db
      .query("SELECT name, pinned, favorite FROM novels WHERE id = ?")
      .get(NOVEL_ID) as { name: string; pinned: number; favorite: number };
    expect(novel.name).toBe("旧世界之书");
    expect(novel.pinned).toBe(1);
    expect(novel.favorite).toBe(0);

    expect(
      (db.query("PRAGMA user_version").get() as { user_version: number }).user_version,
    ).toBe(6);
    db.close();
  });

  test("v4 库跨版本直升：novels 与 outlines 两段列同批补齐、数据保留", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-db-mig4-"));
    tempDirs.push(dir);
    const dbPath = join(dir, "v4.db");
    createLegacyDb(dbPath, 4);

    const db = openDatabase(dbPath);
    expect(tableColumns(db, "novels")).toContain("pinned");
    expect(tableColumns(db, "novels")).toContain("favorite");
    expect(tableColumns(db, "outlines")).toContain("summary");
    expect(tableColumns(db, "outlines")).toContain("key_plot_points");

    const novel = db
      .query("SELECT name, pinned FROM novels WHERE id = ?")
      .get(NOVEL_ID) as { name: string; pinned: number };
    expect(novel.name).toBe("旧世界之书");
    expect(novel.pinned).toBe(0);
    expect(
      (db.query("SELECT COUNT(*) AS c FROM outlines").get() as { c: number }).c,
    ).toBe(1);
    expect(
      (db.query("PRAGMA user_version").get() as { user_version: number }).user_version,
    ).toBe(6);
    db.close();
  });

  test("全新库：建表即含内容列且版本为 6", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-db-fresh-"));
    tempDirs.push(dir);
    const db = openDatabase(join(dir, "fresh.db"));
    const cols = tableColumns(db, "outlines");
    expect(cols).toContain("summary");
    expect(cols).toContain("key_plot_points");
    expect(
      (db.query("PRAGMA user_version").get() as { user_version: number }).user_version,
    ).toBe(6);
    db.close();
  });
});

import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./db";

/** v4/v5/v6/v7 形态的 outlines 建表（v6 起含内容列）——增量迁移的目标表 */
function legacyOutlinesSql(version: 4 | 5 | 6 | 7): string {
  const contentCols = version >= 6 ? "summary TEXT, key_plot_points TEXT," : "";
  return `
    CREATE TABLE outlines (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL REFERENCES novels(id),
      parent_id TEXT REFERENCES outlines(id),
      type TEXT NOT NULL CHECK (type IN ('part', 'act', 'chapter')),
      name TEXT NOT NULL,
      ${contentCols}
      sort INTEGER NOT NULL CHECK (sort >= 1),
      version INTEGER NOT NULL CHECK (version >= 1),
      is_current_version INTEGER NOT NULL CHECK (is_current_version IN (0, 1)),
      status TEXT NOT NULL CHECK (status IN ('deprecated', 'planned', 'writing', 'completed')),
      document_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `;
}

const NOVEL_ID = "aaaaaaaa-0000-7000-8000-000000000004";
const NOW = "2026-01-01T00:00:00Z";

/**
 * 手工构造旧版本形态的库：novels（v4 无 pinned/favorite / v5 起有）+ outlines（v6 起含内容列）
 * + locations（v7 起有），各插一行真实数据并写 user_version，随后关闭交由 openDatabase 触发迁移。
 */
function createLegacyDb(path: string, version: 4 | 5 | 6 | 7): void {
  const legacy = new Database(path, { create: true });
  legacy.exec("PRAGMA foreign_keys = ON;");
  const pinnedCols =
    version >= 5
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
  legacy.exec(legacyOutlinesSql(version));
  legacy.exec(`
    CREATE TABLE characters (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL REFERENCES novels(id),
      name TEXT NOT NULL,
      gender TEXT,
      appearance TEXT,
      desire TEXT NOT NULL,
      fear TEXT NOT NULL,
      narrative_role TEXT NOT NULL,
      background TEXT NOT NULL,
      personality TEXT,
      character_goal TEXT,
      creation_purpose TEXT NOT NULL,
      trajectory TEXT,
      ending_direction TEXT NOT NULL,
      relationships TEXT,
      created_at TEXT NOT NULL
    );
  `);
  if (version >= 7) {
    legacy.exec(`
      CREATE TABLE locations (
        id TEXT PRIMARY KEY,
        novel_id TEXT NOT NULL REFERENCES novels(id),
        parent_id TEXT REFERENCES locations(id),
        name TEXT NOT NULL,
        x REAL NOT NULL,
        y REAL NOT NULL,
        layer TEXT NOT NULL,
        population INTEGER CHECK (population IS NULL OR population >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }
  if (version >= 5) {
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
  const summaryCol = version === 6 || version === 7 ? ", summary" : "";
  legacy
    .prepare(
      `INSERT INTO outlines (id, novel_id, parent_id, type, name${summaryCol}, sort, version, is_current_version, status, created_at, updated_at) VALUES (?, ?, NULL, 'part', '第一部'${version >= 6 ? ", '旧部梗概留存'" : ""}, 1, 1, 1, 'planned', ?, ?);`,
    )
    .run("bbbbbbbb-0000-7000-8000-000000000004", NOVEL_ID, NOW, NOW);
  legacy
    .prepare(
      `INSERT INTO characters (id, novel_id, name, desire, fear, narrative_role, background, creation_purpose, ending_direction, created_at)
       VALUES ('eeeeeeee-0000-7000-8000-000000000009', ?, '旧角色', '旧渴望', '旧恐惧', '主角', '旧背景', '旧创作目的', '旧结局方向', ?);`,
    )
    .run(NOVEL_ID, NOW);
  if (version >= 7) {
    legacy
      .prepare(
        `INSERT INTO locations (id, novel_id, parent_id, name, x, y, layer, population, created_at, updated_at)
         VALUES ('dddddddd-0000-7000-8000-000000000007', ?, NULL, '北境大陆', 0, 0, '地面', NULL, ?, ?);`,
      )
      .run(NOVEL_ID, NOW, NOW);
  }
  legacy.exec(`PRAGMA user_version = ${version};`);
  legacy.close();
}

function tableColumns(db: Database, table: string): string[] {
  return (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

/** 手工构造 v9 形态的库（当前投产版本，缺 documents 表）：v7 形态 + foreshadows
 *  + character_versions + characters.version 列，写 user_version=9 */
function createV9Db(path: string): void {
  createLegacyDb(path, 7);
  const legacy = new Database(path);
  legacy.exec("PRAGMA foreign_keys = ON;");
  legacy.exec(`
    CREATE TABLE foreshadows (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL REFERENCES novels(id),
      surface_action TEXT NOT NULL,
      hidden_truth TEXT NOT NULL,
      attention_level INTEGER NOT NULL CHECK (attention_level BETWEEN 1 AND 10),
      recovery_status TEXT NOT NULL DEFAULT 'unrecovered'
        CHECK (recovery_status IN ('unrecovered', 'partial', 'recovered')),
      planting_method TEXT,
      purpose TEXT,
      appear_chapter_id TEXT,
      recover_chapter_ids TEXT,
      character_ids TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  legacy.exec(`
    CREATE TABLE character_versions (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL REFERENCES characters(id),
      novel_id TEXT NOT NULL REFERENCES novels(id),
      version INTEGER NOT NULL CHECK (version >= 1),
      character TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  legacy.exec("ALTER TABLE characters ADD COLUMN version INTEGER NOT NULL DEFAULT 1;");
  legacy.exec("PRAGMA user_version = 9;");
  legacy.close();
}

describe("openDatabase 迁移（SCHEMA_VERSION 10）", () => {
  const tempDirs: string[] = [];

  afterAll(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  test("v5 库迁移：outlines 补内容列、数据无损、版本升 10", async () => {
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

    // 8→9 段：characters 补 version 列，旧行保留且默认版本 1
    expect(tableColumns(db, "characters")).toContain("version");
    const legacyChar = db
      .query("SELECT name, version FROM characters WHERE id = 'eeeeeeee-0000-7000-8000-000000000009'")
      .get() as { name: string; version: number };
    expect(legacyChar.name).toBe("旧角色");
    expect(legacyChar.version).toBe(1);

    // v5 已有的 novels 管理列与数据（pinned=1）不受迁移影响
    const novel = db
      .query("SELECT name, pinned, favorite FROM novels WHERE id = ?")
      .get(NOVEL_ID) as { name: string; pinned: number; favorite: number };
    expect(novel.name).toBe("旧世界之书");
    expect(novel.pinned).toBe(1);
    expect(novel.favorite).toBe(0);

    expect(
      (db.query("PRAGMA user_version").get() as { user_version: number }).user_version,
    ).toBe(10);
    db.close();
  });

  test("v6 库迁移：locations 表落地、既有数据无损、版本升 10（5→6 段不重复执行）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-db-mig6-"));
    tempDirs.push(dir);
    const dbPath = join(dir, "v6.db");
    createLegacyDb(dbPath, 6);

    // 6→7 为纯新增表迁移：v6 库打开不再重放 5→6 的 ALTER（守卫 version <= 5），
    // 能顺利建完 locations 即说明守卫生效——否则先报 duplicate column
    const db = openDatabase(dbPath);
    expect(
      db
        .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'locations'")
        .get(),
    ).toBeDefined();
    expect(tableColumns(db, "locations")).toEqual([
      "id",
      "novel_id",
      "parent_id",
      "name",
      "x",
      "y",
      "layer",
      "population",
      "created_at",
      "updated_at",
    ]);

    // v6 已入库的大纲内容与小说数据不受迁移影响
    const outline = db
      .query(
        "SELECT name, summary FROM outlines WHERE id = 'bbbbbbbb-0000-7000-8000-000000000004'",
      )
      .get() as { name: string; summary: string | null };
    expect(outline.name).toBe("第一部");
    expect(outline.summary).toBe("旧部梗概留存");
    const novel = db
      .query("SELECT name, pinned FROM novels WHERE id = ?")
      .get(NOVEL_ID) as { name: string; pinned: number };
    expect(novel.name).toBe("旧世界之书");
    expect(novel.pinned).toBe(1);

    expect(
      (db.query("PRAGMA user_version").get() as { user_version: number }).user_version,
    ).toBe(10);
    db.close();
  });

  test("v7 库迁移：foreshadows 表落地、既有数据无损、版本升 10", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-db-mig7-"));
    tempDirs.push(dir);
    const dbPath = join(dir, "v7.db");
    createLegacyDb(dbPath, 7);

    // 7→8 为纯新增表迁移（同 6→7 模式）：幂等建 foreshadows，不动既有五表
    const db = openDatabase(dbPath);
    expect(
      db
        .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'foreshadows'")
        .get(),
    ).toBeDefined();
    expect(tableColumns(db, "foreshadows")).toEqual([
      "id",
      "novel_id",
      "surface_action",
      "hidden_truth",
      "attention_level",
      "recovery_status",
      "planting_method",
      "purpose",
      "appear_chapter_id",
      "recover_chapter_ids",
      "character_ids",
      "created_at",
      "updated_at",
    ]);

    // v7 已入库的位置与大纲内容不受迁移影响
    const loc = db
      .query(
        "SELECT name, layer FROM locations WHERE id = 'dddddddd-0000-7000-8000-000000000007'",
      )
      .get() as { name: string; layer: string };
    expect(loc.name).toBe("北境大陆");
    expect(loc.layer).toBe("地面");
    const outline = db
      .query(
        "SELECT summary FROM outlines WHERE id = 'bbbbbbbb-0000-7000-8000-000000000004'",
      )
      .get() as { summary: string | null };
    expect(outline.summary).toBe("旧部梗概留存");

    expect(
      (db.query("PRAGMA user_version").get() as { user_version: number }).user_version,
    ).toBe(10);
    db.close();
  });

  test("v9 库迁移：documents 表落地、既有数据无损、版本升 10（真实投产库的升级路径）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-db-mig9-"));
    tempDirs.push(dir);
    const dbPath = join(dir, "v9.db");
    createV9Db(dbPath);

    // 9→10 为纯新增表迁移（同 6→7 模式）：幂等建 documents，不动既有七表
    const db = openDatabase(dbPath);
    expect(tableColumns(db, "documents")).toEqual([
      "id",
      "novel_id",
      "chapter_id",
      "content",
      "word_count",
      "created_at",
      "updated_at",
    ]);
    // chapter_id 唯一索引与 novel_id 普通索引随建表落地
    const indexes = (
      db.query("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'documents'").all()
    ).map((r) => (r as { name: string }).name);
    expect(indexes).toContain("sqlite_autoindex_documents_1");
    expect(indexes).toContain("idx_documents_novel_id");

    // v9 已入库的大纲 / 角色 / 位置数据不受迁移影响
    const outline = db
      .query(
        "SELECT summary FROM outlines WHERE id = 'bbbbbbbb-0000-7000-8000-000000000004'",
      )
      .get() as { summary: string | null };
    expect(outline.summary).toBe("旧部梗概留存");
    expect(
      (db.query("SELECT COUNT(*) AS c FROM characters").get() as { c: number }).c,
    ).toBe(1);

    expect(
      (db.query("PRAGMA user_version").get() as { user_version: number }).user_version,
    ).toBe(10);
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
    ).toBe(10);
    db.close();
  });

  test("全新库：建表即含内容列与 locations / foreshadows / documents 表、版本为 10", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-db-fresh-"));
    tempDirs.push(dir);
    const db = openDatabase(join(dir, "fresh.db"));
    const cols = tableColumns(db, "outlines");
    expect(cols).toContain("summary");
    expect(cols).toContain("key_plot_points");
    expect(tableColumns(db, "locations")).toContain("population");
    expect(tableColumns(db, "foreshadows")).toContain("recovery_status");
    expect(tableColumns(db, "characters")).toContain("version");
    expect(tableColumns(db, "character_versions")).toContain("character");
    expect(tableColumns(db, "documents")).toContain("word_count");
    expect(
      (db.query("PRAGMA user_version").get() as { user_version: number }).user_version,
    ).toBe(10);
    db.close();
  });
});

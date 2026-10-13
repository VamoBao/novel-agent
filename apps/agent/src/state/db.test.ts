import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
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

/** 手工构造 v10 形态的库：v9 形态 + documents 表（含 content 列，正文进库的旧形态），
 *  幕与章节点及一行带正文的 documents 数据——10→11 迁移的目标数据 */
function createV10Db(path: string): void {
  createV9Db(path);
  const legacy = new Database(path);
  legacy.exec("PRAGMA foreign_keys = ON;");
  legacy.exec(`
    CREATE TABLE documents (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL REFERENCES novels(id),
      chapter_id TEXT NOT NULL UNIQUE REFERENCES outlines(id),
      content TEXT NOT NULL,
      word_count INTEGER NOT NULL CHECK (word_count >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  // createV9Db 只建了部节点，补幕与章两级，再挂一行正文
  legacy
    .prepare(
      `INSERT INTO outlines (id, novel_id, parent_id, type, name, summary, sort, version, is_current_version, status, created_at, updated_at)
       VALUES ('cccccccc-0000-7000-8000-000000000010', ?, 'bbbbbbbb-0000-7000-8000-000000000004', 'act', '第一幕·市集', '市集风波', 1, 1, 1, 'planned', ?, ?);`,
    )
    .run(NOVEL_ID, NOW, NOW);
  legacy
    .prepare(
      `INSERT INTO outlines (id, novel_id, parent_id, type, name, summary, sort, version, is_current_version, status, document_id, created_at, updated_at)
       VALUES ('cccccccc-0000-7000-8000-000000000011', ?, 'cccccccc-0000-7000-8000-000000000010', 'chapter', '第一章·碎片', '少年拾得碎片', 1, 1, 1, 'completed', 'dddddddd-0000-7000-8000-0000000000d1', ?, ?);`,
    )
    .run(NOVEL_ID, NOW, NOW);
  legacy
    .prepare(
      `INSERT INTO documents (id, novel_id, chapter_id, content, word_count, created_at, updated_at)
       VALUES ('dddddddd-0000-7000-8000-0000000000d1', ?, 'cccccccc-0000-7000-8000-000000000011', '旧形态入库的正文内容。', 11, ?, ?);`,
    )
    .run(NOVEL_ID, NOW, NOW);
  legacy.exec("PRAGMA user_version = 10;");
  legacy.close();
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

describe("openDatabase 迁移（SCHEMA_VERSION 19）", () => {
  const tempDirs: string[] = [];

  afterAll(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  test("v15 版本标记写入前中断：新增列与版本一起回滚，再打开可恢复", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-db-mig16-interrupt-"));
    tempDirs.push(dir);
    const path = join(dir, "test.db");
    const legacy = new Database(path, { create: true });
    legacy.exec(`CREATE TABLE novels (id TEXT PRIMARY KEY, name TEXT, author TEXT, description TEXT,
      pinned INTEGER NOT NULL DEFAULT 0, favorite INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      PRAGMA user_version = 15;`);
    legacy.close();
    const originalExec = Database.prototype.exec;
    let closeInterruptedDb = (): void => {};
    const interruption = spyOn(Database.prototype, "exec").mockImplementation(function(this: Database, sql: string) {
      if (sql.includes("PRAGMA user_version = 16")) {
        closeInterruptedDb = () => this.close();
        throw new Error("模拟版本标记前中断");
      }
      return originalExec.call(this, sql);
    });
    try { expect(() => openDatabase(path)).toThrow("模拟版本标记前中断"); }
    finally {
      interruption.mockRestore();
      closeInterruptedDb();
    }
    const raw = new Database(path);
    try {
      expect(tableColumns(raw, "novels")).not.toContain("genre");
      expect(raw.query("PRAGMA user_version").get()).toEqual({ user_version: 15 });
    } finally { raw.close(); }
    const recovered = openDatabase(path);
    try {
      expect(tableColumns(recovered, "novels")).toContain("core_conflict");
      expect(recovered.query("PRAGMA user_version").get()).toEqual({ user_version: 19 });
    } finally { recovered.close(); }
  });

  test("新库小说创作参数三列可用，未采集默认 NULL", () => {
    const db = openDatabase(":memory:");
    try {
      expect(tableColumns(db, "novels")).toContain("genre");
      expect(tableColumns(db, "novels")).toContain("audience");
      expect(tableColumns(db, "novels")).toContain("core_conflict");
      db.prepare("INSERT INTO novels (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(NOVEL_ID, "新小说", NOW, NOW);
      expect(db.query("SELECT genre, audience, core_conflict FROM novels WHERE id = ?").get(NOVEL_ID)).toEqual({ genre: null, audience: null, core_conflict: null });
    } finally {
      db.close();
    }
  });

  test("两连接穿插启动：版本读取后另一连接完成迁移，锁内复查避免重复补列", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-db-mig16-race-"));
    tempDirs.push(dir);
    const path = join(dir, "test.db");
    const legacy = new Database(path, { create: true });
    legacy.exec(`CREATE TABLE novels (id TEXT PRIMARY KEY, name TEXT, author TEXT, description TEXT,
      pinned INTEGER NOT NULL DEFAULT 0, favorite INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      PRAGMA user_version = 15;`);
    legacy.close();
    const originalQuery = Database.prototype.query;
    let interleaved = false;
    // 原生 query 原样返回 Statement；call 转发会丢失泛型，恢复其原有方法签名。
    const race = spyOn(Database.prototype, "query").mockImplementation((function(this: Database, sql: string) {
      const statement = originalQuery.call(this, sql);
      if (sql === "PRAGMA user_version" && !interleaved) {
        const originalGet = statement.get.bind(statement);
        statement.get = () => {
          const snapshot = originalGet();
          if (!interleaved) {
            interleaved = true;
            const other = openDatabase(path);
            other.close();
          }
          return snapshot;
        };
      }
      return statement;
    }) as Database["query"]);
    try {
      const db = openDatabase(path);
      try {
        expect(tableColumns(db, "novels")).toContain("core_conflict");
        expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 19 });
      } finally { db.close(); }
    } finally { race.mockRestore(); }
  });

  test("v15 增量补创作参数：小说与关联世界观保留，重开不重复迁移", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-db-mig15-"));
    tempDirs.push(dir);
    const path = join(dir, "v15.db");
    const legacy = new Database(path, { create: true });
    legacy.exec(`
      CREATE TABLE novels (id TEXT PRIMARY KEY, name TEXT, author TEXT, description TEXT,
        pinned INTEGER NOT NULL DEFAULT 0, favorite INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE worldviews (id TEXT PRIMARY KEY, novel_id TEXT NOT NULL UNIQUE REFERENCES novels(id),
        geography TEXT NOT NULL, fantasy_attributes TEXT, real_world_mapping TEXT,
        taboos TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      PRAGMA user_version = 15;
    `);
    legacy.prepare("INSERT INTO novels VALUES (?, '旧小说', '作者', '简介', 1, 1, ?, ?)").run(NOVEL_ID, NOW, NOW);
    legacy.prepare("INSERT INTO worldviews VALUES ('wv-15', ?, '九州', NULL, NULL, '[\"不可复活\"]', ?, ?)").run(NOVEL_ID, NOW, NOW);
    legacy.close();
    const db = openDatabase(path);
    try {
      expect(tableColumns(db, "novels")).toContain("genre");
      expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 19 });
      expect(db.query("SELECT name, author, description, pinned, favorite, genre, audience, core_conflict FROM novels WHERE id = ?").get(NOVEL_ID)).toEqual({ name: "旧小说", author: "作者", description: "简介", pinned: 1, favorite: 1, genre: null, audience: null, core_conflict: null });
      expect(db.query("SELECT geography, taboos FROM worldviews WHERE novel_id = ?").get(NOVEL_ID)).toEqual({ geography: "九州", taboos: '["不可复活"]' });
      db.prepare("UPDATE novels SET genre = '仙侠', audience = '[]' WHERE id = ?").run(NOVEL_ID);
    } finally {
      db.close();
    }
    const reopened = openDatabase(path);
    try {
      expect(reopened.query("SELECT genre, audience FROM novels WHERE id = ?").get(NOVEL_ID)).toEqual({ genre: "仙侠", audience: "[]" });
    } finally {
      reopened.close();
    }
  });

  test("v16 库迁移：outlines 补 character_ids 列、旧章行留 NULL、版本升 19、重开不重复迁移", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-db-mig17-"));
    tempDirs.push(dir);
    const path = join(dir, "v16.db");
    const legacy = new Database(path, { create: true });
    legacy.exec(`
      CREATE TABLE novels (id TEXT PRIMARY KEY, name TEXT, author TEXT, description TEXT,
        pinned INTEGER NOT NULL DEFAULT 0, favorite INTEGER NOT NULL DEFAULT 0,
        genre TEXT, audience TEXT, core_conflict TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE outlines (
        id TEXT PRIMARY KEY,
        novel_id TEXT NOT NULL REFERENCES novels(id),
        parent_id TEXT REFERENCES outlines(id),
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        summary TEXT,
        key_plot_points TEXT,
        sort INTEGER NOT NULL,
        version INTEGER NOT NULL,
        is_current_version INTEGER NOT NULL,
        status TEXT NOT NULL,
        document_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      PRAGMA user_version = 16;
    `);
    legacy.prepare("INSERT INTO novels VALUES (?, '旧小说', NULL, NULL, 0, 0, NULL, NULL, NULL, ?, ?)").run(NOVEL_ID, NOW, NOW);
    legacy.prepare(
      "INSERT INTO outlines VALUES ('chap-16', ?, NULL, 'chapter', '第一章·雨夜', '雨夜概述', NULL, 1, 1, 1, 'planned', NULL, ?, ?)",
    ).run(NOVEL_ID, NOW, NOW);
    legacy.close();
    const db = openDatabase(path);
    try {
      expect(tableColumns(db, "outlines")).toContain("character_ids");
      expect((db.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(19);
      // 迁移只补列不回填：旧章行未绑定（NULL 即「未绑定」语义，正文生成回退全库注入）
      const row = db
        .query("SELECT name, character_ids FROM outlines WHERE id = 'chap-16'")
        .get() as { name: string; character_ids: string | null };
      expect(row.name).toBe("第一章·雨夜");
      expect(row.character_ids).toBeNull();
    } finally {
      db.close();
    }
    const reopened = openDatabase(path);
    try {
      expect((reopened.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(19);
    } finally {
      reopened.close();
    }
  });

  test("v17 库迁移：characters 补 updated_at 并按末次编辑快照时间回填、版本升 19、重开不重复迁移", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-db-mig18-"));
    tempDirs.push(dir);
    const path = join(dir, "v17.db");
    const legacy = new Database(path, { create: true });
    legacy.exec(`
      CREATE TABLE novels (id TEXT PRIMARY KEY, name TEXT, author TEXT, description TEXT,
        pinned INTEGER NOT NULL DEFAULT 0, favorite INTEGER NOT NULL DEFAULT 0,
        genre TEXT, audience TEXT, core_conflict TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
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
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        created_at TEXT NOT NULL
      );
      CREATE TABLE character_versions (
        id TEXT PRIMARY KEY,
        character_id TEXT NOT NULL REFERENCES characters(id),
        novel_id TEXT NOT NULL REFERENCES novels(id),
        version INTEGER NOT NULL CHECK (version >= 1),
        character TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      PRAGMA user_version = 17;
    `);
    legacy.prepare("INSERT INTO novels VALUES (?, '旧小说', NULL, NULL, 0, 0, NULL, NULL, NULL, ?, ?)").run(NOVEL_ID, NOW, NOW);
    // 从未编辑的角色（version=1，无快照）
    legacy
      .prepare(
        `INSERT INTO characters VALUES ('char-new', ?, '新角色', NULL, NULL, '渴望', '恐惧', '配角', '背景', NULL, NULL, '目的', NULL, '结局', NULL, 1, '2026-01-01T00:00:00.000Z')`,
      )
      .run(NOVEL_ID);
    // 编辑过的角色（version=2，末次编辑快照时间 2026-03-01）
    legacy
      .prepare(
        `INSERT INTO characters VALUES ('char-edited', ?, '旧角色', NULL, NULL, '渴望', '恐惧', '主角', '背景', NULL, NULL, '目的', NULL, '结局', NULL, 2, '2026-01-01T00:00:00.000Z')`,
      )
      .run(NOVEL_ID);
    legacy
      .prepare(
        "INSERT INTO character_versions VALUES ('ver-1', 'char-edited', ?, 1, ?, '2026-03-01T00:00:00.000Z')",
      )
      .run(
        NOVEL_ID,
        JSON.stringify({
          basicInfo: { name: "旧角色" },
          core: { desire: "渴望", fear: "恐惧", narrativeRole: "主角" },
          background: "旧背景",
          creationPurpose: "目的",
          endingDirection: "结局",
        }),
      );
    legacy.close();

    const db = openDatabase(path);
    try {
      expect(tableColumns(db, "characters")).toContain("updated_at");
      expect((db.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(19);
      // 回填语义 = 末次变更时刻：编辑过的取最新快照时间，从未编辑的取 created_at
      expect(db.query("SELECT updated_at FROM characters WHERE id = 'char-edited'").get()).toEqual({
        updated_at: "2026-03-01T00:00:00.000Z",
      });
      expect(db.query("SELECT updated_at FROM characters WHERE id = 'char-new'").get()).toEqual({
        updated_at: "2026-01-01T00:00:00.000Z",
      });
    } finally {
      db.close();
    }
    const reopened = openDatabase(path);
    try {
      expect((reopened.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(19);
    } finally {
      reopened.close();
    }
  });

  test("v5 库迁移：outlines 补内容列、数据无损、版本升 12", async () => {
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
    ).toBe(19);
    db.close();
  });

  test("v6 库迁移：locations 表落地、既有数据无损、版本升 12（5→6 段不重复执行）", async () => {
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
      "description",
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
    ).toBe(19);
    db.close();
  });

  test("v7 库迁移：foreshadows 表落地、既有数据无损、版本升 12", async () => {
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
      "act_node_id",
      "recover_act_node_id",
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
    // v7 的 locations 亦随 12→13 重建：description 列落地
    expect(tableColumns(db, "locations")).toContain("description");
    const outline = db
      .query(
        "SELECT summary FROM outlines WHERE id = 'bbbbbbbb-0000-7000-8000-000000000004'",
      )
      .get() as { summary: string | null };
    expect(outline.summary).toBe("旧部梗概留存");

    expect(
      (db.query("PRAGMA user_version").get() as { user_version: number }).user_version,
    ).toBe(19);
    db.close();
  });

  test("v9 库迁移：documents 表落地、既有数据无损、版本升 12（真实投产库的升级路径）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-db-mig9-"));
    tempDirs.push(dir);
    const dbPath = join(dir, "v9.db");
    createV9Db(dbPath);

    // 9→10→11 连续两段：幂等建 documents（10），随后 v10→11 段不重放（守卫 version === 10），
    // 直接得到 11 形态——file_path 列、无 content 列
    const db = openDatabase(dbPath);
    expect(tableColumns(db, "documents")).toEqual([
      "id",
      "novel_id",
      "chapter_id",
      "file_path",
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
    // v9 库的 foreshadows 为旧表形态（无 act_node_id），11→12 段经 ALTER 补列
    expect(tableColumns(db, "foreshadows")).toContain("act_node_id");

    expect(
      (db.query("PRAGMA user_version").get() as { user_version: number }).user_version,
    ).toBe(19);
    db.close();
  });

  test("v10 库迁移：存量正文按小说/部/章层级落文件、file_path 回填、content 列移除、版本升 12", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-db-mig10-"));
    tempDirs.push(dir);
    const dbPath = join(dir, "v10.db");
    const outputDir = join(dir, "output");
    createV10Db(dbPath);

    const savedOutputDir = process.env.NOVEL_OUTPUT_DIR;
    process.env.NOVEL_OUTPUT_DIR = outputDir;
    let db: Database;
    try {
      db = openDatabase(dbPath);
    } finally {
      if (savedOutputDir === undefined) {
        delete process.env.NOVEL_OUTPUT_DIR;
      } else {
        process.env.NOVEL_OUTPUT_DIR = savedOutputDir;
      }
    }

    // 存量 content 已落文件：output/旧世界之书-aaaaaaaa/第一部/第一章·碎片.md
    const artifact = join(outputDir, "旧世界之书-aaaaaaaa", "第一部", "第一章·碎片.md");
    expect(existsSync(artifact)).toBe(true);
    expect(readFileSync(artifact, "utf8")).toBe("旧形态入库的正文内容。");

    // 表形态：file_path 回填相对路径、content 列移除
    expect(tableColumns(db, "documents")).toEqual([
      "id",
      "novel_id",
      "chapter_id",
      "word_count",
      "created_at",
      "updated_at",
      "file_path",
    ]);
    const row = db
      .query("SELECT file_path, word_count FROM documents WHERE id = 'dddddddd-0000-7000-8000-0000000000d1'")
      .get() as { file_path: string; word_count: number };
    expect(row.file_path).toBe(join("旧世界之书-aaaaaaaa", "第一部", "第一章·碎片.md"));
    expect(row.word_count).toBe(11);

    // 章节点绑定不受迁移影响
    const chapter = db
      .query("SELECT document_id, status FROM outlines WHERE id = 'cccccccc-0000-7000-8000-000000000011'")
      .get() as { document_id: string; status: string };
    expect(chapter.document_id).toBe("dddddddd-0000-7000-8000-0000000000d1");
    expect(chapter.status).toBe("completed");

    expect(
      (db.query("PRAGMA user_version").get() as { user_version: number }).user_version,
    ).toBe(19);
    db.close();
  });

  test("v11 库升 12：foreshadows 增 act_node_id 列，存量伏笔数据无损", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-db-mig-v12-"));
    const dbPath = join(dir, "test.db");
    const raw = new Database(dbPath);
    raw.exec("PRAGMA foreign_keys = ON;");
    raw.exec(`CREATE TABLE novels (id TEXT PRIMARY KEY, name TEXT, author TEXT, description TEXT, pinned INTEGER NOT NULL DEFAULT 0, favorite INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
    raw.exec(`CREATE TABLE foreshadows (
      id TEXT PRIMARY KEY, novel_id TEXT NOT NULL REFERENCES novels(id),
      surface_action TEXT NOT NULL, hidden_truth TEXT NOT NULL,
      attention_level INTEGER NOT NULL CHECK (attention_level BETWEEN 1 AND 10),
      recovery_status TEXT NOT NULL DEFAULT 'unrecovered' CHECK (recovery_status IN ('unrecovered','partial','recovered')),
      planting_method TEXT, purpose TEXT, appear_chapter_id TEXT, recover_chapter_ids TEXT, character_ids TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
    raw.exec("INSERT INTO novels (id, created_at, updated_at) VALUES ('n-1', '2026-01-01', '2026-01-01');");
    raw.exec("INSERT INTO foreshadows (id, novel_id, surface_action, hidden_truth, attention_level, created_at, updated_at) VALUES ('f-1', 'n-1', '表面', '真相', 4, '2026-01-01', '2026-01-01');");
    raw.exec("PRAGMA user_version = 11;");
    raw.close();

    const db = openDatabase(dbPath);
    expect((db.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(19);
    const columns = (db.query("PRAGMA table_info(foreshadows)").all() as { name: string }[]).map((c) => c.name);
    expect(columns).toContain("act_node_id");
    const row = db.query("SELECT surface_action, hidden_truth, attention_level, act_node_id FROM foreshadows WHERE id = 'f-1';").get() as Record<string, unknown>;
    expect(row.surface_action).toBe("表面");
    expect(row.hidden_truth).toBe("真相");
    expect(row.attention_level).toBe(4);
    expect(row.act_node_id).toBeNull();
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("v12 库升 13：locations 重建——description 列落地、x/y/layer 可空、存量数据无损", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-db-mig13-"));
    tempDirs.push(dir);
    const dbPath = join(dir, "v12.db");
    // 手工构造 v12 形态：novels + 旧形态 locations（x/y/layer NOT NULL、无 description）
    const legacy = new Database(dbPath, { create: true });
    legacy.exec("PRAGMA foreign_keys = ON;");
    legacy.exec(`CREATE TABLE novels (
      id TEXT PRIMARY KEY, name TEXT, author TEXT, description TEXT,
      pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
      favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
    legacy.exec(`CREATE TABLE locations (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL REFERENCES novels(id),
      parent_id TEXT REFERENCES locations(id),
      name TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      layer TEXT NOT NULL,
      population INTEGER CHECK (population IS NULL OR population >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL);`);
    legacy.exec("CREATE INDEX idx_locations_novel_id ON locations(novel_id);");
    legacy.exec("CREATE INDEX idx_locations_parent_id ON locations(parent_id);");
    legacy
      .prepare("INSERT INTO novels (id, name, created_at, updated_at) VALUES (?, ?, ?, ?);")
      .run(NOVEL_ID, "旧世界之书", NOW, NOW);
    legacy
      .prepare(
        `INSERT INTO locations (id, novel_id, parent_id, name, x, y, layer, population, created_at, updated_at)
         VALUES ('dddddddd-0000-7000-8000-000000000007', ?, NULL, '北境大陆', 1.5, 2.5, '地面', 3000, ?, ?);`,
      )
      .run(NOVEL_ID, NOW, NOW);
    legacy
      .prepare(
        `INSERT INTO locations (id, novel_id, parent_id, name, x, y, layer, population, created_at, updated_at)
         VALUES ('dddddddd-0000-7000-8000-000000000008', ?, 'dddddddd-0000-7000-8000-000000000007', '青云城', 0, 0, '地面', NULL, ?, ?);`,
      )
      .run(NOVEL_ID, NOW, NOW);
    legacy.exec("PRAGMA user_version = 12;");
    legacy.close();

    const db = openDatabase(dbPath);
    expect((db.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(19);
    expect(tableColumns(db, "locations")).toEqual([
      "id",
      "novel_id",
      "parent_id",
      "name",
      "description",
      "x",
      "y",
      "layer",
      "population",
      "created_at",
      "updated_at",
    ]);
    // 存量两行无损（父级指向保持，坐标与图层保留，description 为 null）
    const parent = db
      .query("SELECT name, description, x, y, layer, population FROM locations WHERE parent_id IS NULL;")
      .get() as Record<string, unknown>;
    expect(parent).toEqual({
      name: "北境大陆",
      description: null,
      x: 1.5,
      y: 2.5,
      layer: "地面",
      population: 3000,
    });
    const child = db
      .query("SELECT name, parent_id FROM locations WHERE id = 'dddddddd-0000-7000-8000-000000000008';")
      .get() as { name: string; parent_id: string };
    expect(child.name).toBe("青云城");
    expect(child.parent_id).toBe("dddddddd-0000-7000-8000-000000000007");
    // 可空实证：无坐标行可直插（旧形态 NOT NULL 会拒绝）
    db.prepare(
      `INSERT INTO locations (id, novel_id, parent_id, name, description, x, y, layer, population, created_at, updated_at)
       VALUES ('dddddddd-0000-7000-8000-000000000009', ?, NULL, '落霞谷', '隐世疗伤地', NULL, NULL, NULL, NULL, ?, ?);`,
    ).run(NOVEL_ID, NOW, NOW);
    // 索引随重建落地（旧索引随改名表 DROP，底部 CREATE INDEX 重建）
    const indexes = db
      .query("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'locations';")
      .all() as Array<{ name: string }>;
    expect(indexes.map((i) => i.name)).toEqual(
      expect.arrayContaining(["idx_locations_novel_id", "idx_locations_parent_id"]),
    );
    db.close();
  });

  test("v13 库升 14：foreshadows 增 recover_act_node_id 列，存量数据无损", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-db-mig14-"));
    tempDirs.push(dir);
    const dbPath = join(dir, "v13.db");
    // 手工构造 v13 形态：novels + foreshadows（无 recover_act_node_id 列）
    const legacy = new Database(dbPath, { create: true });
    legacy.exec("PRAGMA foreign_keys = ON;");
    legacy.exec(`CREATE TABLE novels (
      id TEXT PRIMARY KEY, name TEXT, author TEXT, description TEXT,
      pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
      favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
    legacy.exec(`CREATE TABLE foreshadows (
      id TEXT PRIMARY KEY, novel_id TEXT NOT NULL REFERENCES novels(id),
      surface_action TEXT NOT NULL, hidden_truth TEXT NOT NULL,
      attention_level INTEGER NOT NULL CHECK (attention_level BETWEEN 1 AND 10),
      recovery_status TEXT NOT NULL DEFAULT 'unrecovered' CHECK (recovery_status IN ('unrecovered','partial','recovered')),
      planting_method TEXT, purpose TEXT, appear_chapter_id TEXT, act_node_id TEXT, recover_chapter_ids TEXT, character_ids TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
    legacy.exec("INSERT INTO novels (id, name, created_at, updated_at) VALUES ('n-1', '旧书', '2026-01-01', '2026-01-01');");
    legacy.exec("INSERT INTO foreshadows (id, novel_id, surface_action, hidden_truth, attention_level, act_node_id, created_at, updated_at) VALUES ('f-1', 'n-1', '表面', '真相', 4, 'act-1', '2026-01-01', '2026-01-01');");
    legacy.exec("PRAGMA user_version = 13;");
    legacy.close();

    const db = openDatabase(dbPath);
    expect((db.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(19);
    const columns = (db.query("PRAGMA table_info(foreshadows)").all() as { name: string }[]).map((c) => c.name);
    expect(columns).toContain("recover_act_node_id");
    const row = db.query("SELECT surface_action, act_node_id, recover_act_node_id FROM foreshadows WHERE id = 'f-1';").get() as Record<string, unknown>;
    expect(row.surface_action).toBe("表面");
    expect(row.act_node_id).toBe("act-1");
    expect(row.recover_act_node_id).toBeNull();
    db.close();
  });

  test("v14 库升 15：style_references 表落地（纯新增表迁移），存量数据无损", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-db-mig15-"));
    tempDirs.push(dir);
    const dbPath = join(dir, "v14.db");
    // 手工构造 v14 形态：novels + foreshadows（14 形态含 recover_act_node_id）
    const legacy = new Database(dbPath, { create: true });
    legacy.exec("PRAGMA foreign_keys = ON;");
    legacy.exec(`CREATE TABLE novels (
      id TEXT PRIMARY KEY, name TEXT, author TEXT, description TEXT,
      pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
      favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
    legacy.exec(`CREATE TABLE foreshadows (
      id TEXT PRIMARY KEY, novel_id TEXT NOT NULL REFERENCES novels(id),
      surface_action TEXT NOT NULL, hidden_truth TEXT NOT NULL,
      attention_level INTEGER NOT NULL CHECK (attention_level BETWEEN 1 AND 10),
      recovery_status TEXT NOT NULL DEFAULT 'unrecovered' CHECK (recovery_status IN ('unrecovered','partial','recovered')),
      planting_method TEXT, purpose TEXT, appear_chapter_id TEXT, act_node_id TEXT, recover_act_node_id TEXT,
      recover_chapter_ids TEXT, character_ids TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
    legacy.exec("INSERT INTO novels (id, name, created_at, updated_at) VALUES ('n-1', '旧书', '2026-01-01', '2026-01-01');");
    legacy.exec("INSERT INTO foreshadows (id, novel_id, surface_action, hidden_truth, attention_level, recover_act_node_id, created_at, updated_at) VALUES ('f-1', 'n-1', '表面', '真相', 4, 'act-2', '2026-01-01', '2026-01-01');");
    legacy.exec("PRAGMA user_version = 14;");
    legacy.close();

    const db = openDatabase(dbPath);
    expect((db.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(19);
    // 纯新增表由 CREATE TABLE IF NOT EXISTS 幂等落地，含启用开关 CHECK 与 novel_id 索引
    expect(tableColumns(db, "style_references")).toEqual([
      "id",
      "novel_id",
      "name",
      "content",
      "enabled",
      "created_at",
      "updated_at",
    ]);
    const indexes = (
      db.query("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'style_references'").all()
    ).map((r) => (r as { name: string }).name);
    expect(indexes).toContain("idx_style_references_novel_id");
    // enabled CHECK 生效：非法值被拒绝，0/1 合法
    expect(() =>
      db.exec(
        `INSERT INTO style_references (id, novel_id, name, content, enabled, created_at, updated_at)
         VALUES ('s-bad', 'n-1', '文风', '样本', 2, '2026-01-01', '2026-01-01');`,
      ),
    ).toThrow();
    db.prepare(
      `INSERT INTO style_references (id, novel_id, name, content, enabled, created_at, updated_at)
       VALUES ('s-1', 'n-1', '江南式打斗', '刀光一闪。', 0, '2026-01-01', '2026-01-01');`,
    ).run();
    const row = db
      .query("SELECT name, content, enabled FROM style_references WHERE id = 's-1'")
      .get() as { name: string; content: string; enabled: number };
    expect(row.enabled).toBe(0);
    // 存量伏笔数据无损
    const fs = db
      .query("SELECT surface_action, recover_act_node_id FROM foreshadows WHERE id = 'f-1'")
      .get() as { surface_action: string; recover_act_node_id: string };
    expect(fs.surface_action).toBe("表面");
    expect(fs.recover_act_node_id).toBe("act-2");
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
    ).toBe(19);
    db.close();
  });

  test("全新库：建表即含内容列与 locations / foreshadows / documents（file_path）/ style_references 表、版本为当前", async () => {
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
    expect(tableColumns(db, "style_references")).toContain("enabled");
    expect(tableColumns(db, "character_migrations")).toContain("migrate_field");
    expect(tableColumns(db, "character_migration_versions")).toContain("migration");
    expect(
      (db.query("PRAGMA user_version").get() as { user_version: number }).user_version,
    ).toBe(19);
    db.close();
  });

  /** v18 形态库：novels + characters（含 version / updated_at）+ character_versions */
  function createV18Db(
    path: string,
    options: { withBaseline?: boolean; brokenBaseline?: boolean } = {},
  ): void {
    const { withBaseline = true, brokenBaseline = false } = options;
    const legacy = new Database(path, { create: true });
    legacy.exec("PRAGMA foreign_keys = ON;");
    legacy.exec(`
      CREATE TABLE novels (id TEXT PRIMARY KEY, name TEXT, author TEXT, description TEXT,
        pinned INTEGER NOT NULL DEFAULT 0, favorite INTEGER NOT NULL DEFAULT 0,
        genre TEXT, audience TEXT, core_conflict TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE characters (
        id TEXT PRIMARY KEY,
        novel_id TEXT NOT NULL REFERENCES novels(id),
        name TEXT NOT NULL, gender TEXT, appearance TEXT,
        desire TEXT NOT NULL, fear TEXT NOT NULL, narrative_role TEXT NOT NULL,
        background TEXT NOT NULL, personality TEXT, character_goal TEXT,
        creation_purpose TEXT NOT NULL, trajectory TEXT, ending_direction TEXT NOT NULL,
        relationships TEXT,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE character_versions (
        id TEXT PRIMARY KEY,
        character_id TEXT NOT NULL REFERENCES characters(id),
        novel_id TEXT NOT NULL REFERENCES novels(id),
        version INTEGER NOT NULL CHECK (version >= 1),
        character TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      PRAGMA user_version = 18;
    `);
    legacy
      .prepare("INSERT INTO novels VALUES (?, '旧小说', NULL, NULL, 0, 0, NULL, NULL, NULL, ?, ?)")
      .run(NOVEL_ID, NOW, NOW);
    // version=1：首版即基准，保持原卡
    legacy
      .prepare(
        `INSERT INTO characters VALUES ('char-plain', ?, '未改角色', NULL, NULL, '渴望', '恐惧', '配角', '背景', NULL, NULL, '目的', NULL, '结局', NULL, 1, ?, ?)`,
      )
      .run(NOVEL_ID, NOW, NOW);
    // version=3：两次编辑，主行内容为第三版（基准 = 第 1 版快照）
    legacy
      .prepare(
        `INSERT INTO characters VALUES ('char-edited', ?, '改过角色', NULL, NULL, '渴望', '恐惧', '主角', '新背景', '坚韧', NULL, '目的', NULL, '结局', NULL, 3, ?, ?)`,
      )
      .run(NOVEL_ID, NOW, NOW);
    const card = (over: Record<string, unknown>): string =>
      JSON.stringify({
        basicInfo: { name: "改过角色" },
        core: { desire: "渴望", fear: "恐惧", narrativeRole: "主角" },
        background: "旧背景",
        creationPurpose: "目的",
        endingDirection: "结局",
        ...over,
      });
    if (brokenBaseline) {
      legacy
        .prepare("INSERT INTO character_versions VALUES ('ver-1', 'char-edited', ?, 1, ?, ?)")
        .run(NOVEL_ID, "{ 不是合法 JSON", NOW);
    } else if (withBaseline) {
      legacy
        .prepare("INSERT INTO character_versions VALUES ('ver-1', 'char-edited', ?, 1, ?, ?)")
        .run(NOVEL_ID, card({}), NOW);
      legacy
        .prepare("INSERT INTO character_versions VALUES ('ver-2', 'char-edited', ?, 2, ?, ?)")
        .run(NOVEL_ID, card({ background: "旧背景二版", personality: "坚韧" }), NOW);
    }
    legacy.close();
  }

  test("v18 库迁移：version>1 恢复第一版基准并逐字段差异导入草案，version=1 保持原卡", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-db-mig19-"));
    tempDirs.push(dir);
    const path = join(dir, "v18.db");
    createV18Db(path);

    const db = openDatabase(path);
    try {
      expect((db.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(19);
      // 主行内容恢复为第一版（基准），version / created_at / updated_at 保持稳定
      const edited = db
        .query("SELECT background, personality, version, created_at, updated_at FROM characters WHERE id = 'char-edited'")
        .get() as {
        background: string;
        personality: string | null;
        version: number;
        created_at: string;
        updated_at: string;
      };
      expect(edited.background).toBe("旧背景");
      expect(edited.personality).toBeNull();
      expect(edited.version).toBe(3);
      expect(edited.created_at).toBe(NOW);
      expect(edited.updated_at).toBe(NOW);
      // version=1 的角色原卡不动
      expect(
        db.query("SELECT background, version FROM characters WHERE id = 'char-plain'").get(),
      ).toEqual({ background: "背景", version: 1 });

      // 逐字段差异导入草案：第一次编辑（背景 + 性格）两条 + 第二次编辑（背景）一条
      const drafts = db
        .query(
          "SELECT migrate_field, old_value, new_value, sequence, status, group_id, start_chapter_id, end_chapter_id, trigger, transition_guidance, outline_version FROM character_migrations ORDER BY sequence ASC;",
        )
        .all() as Array<Record<string, unknown>>;
      expect(drafts).toHaveLength(3);
      expect(drafts.map((d) => d.migrate_field)).toEqual([
        "background",
        "personality",
        "background",
      ]);
      expect(drafts[0]).toMatchObject({
        old_value: "旧背景",
        new_value: "旧背景二版",
        sequence: 1,
        status: "draft",
        start_chapter_id: null,
        end_chapter_id: null,
        trigger: null,
        transition_guidance: null,
        outline_version: null,
      });
      expect(drafts[1]).toMatchObject({
        migrate_field: "personality",
        old_value: null,
        new_value: "坚韧",
        sequence: 2,
      });
      expect(drafts[2]).toMatchObject({
        old_value: "旧背景二版",
        new_value: "新背景",
        sequence: 3,
      });
      // 同一次历史编辑的多个字段共用 group_id；不同编辑不同组
      expect(drafts[0]!.group_id).toBe(drafts[1]!.group_id);
      expect(drafts[0]!.group_id).not.toBe(drafts[2]!.group_id);
      // 原 character_versions 历史记录保留
      expect(
        (db.query("SELECT COUNT(*) AS c FROM character_versions WHERE character_id = 'char-edited'").get() as { c: number }).c,
      ).toBe(2);
    } finally {
      db.close();
    }
    // 重复打开不重复导入
    const reopened = openDatabase(path);
    try {
      expect(
        (reopened.query("SELECT COUNT(*) AS c FROM character_migrations").get() as { c: number }).c,
      ).toBe(3);
      expect((reopened.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(19);
    } finally {
      reopened.close();
    }
  });

  test("v18 库迁移：version>1 角色缺失第一版快照时拒绝猜测、整体回滚", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-db-mig19-missing-"));
    tempDirs.push(dir);
    const path = join(dir, "v18.db");
    createV18Db(path, { withBaseline: false });

    expect(() => openDatabase(path)).toThrow("缺少第一版快照");
    const raw = new Database(path);
    try {
      expect((raw.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(18);
      // 主行未被冒充为第一版；迁移表未落地（DDL 随事务回滚）
      expect(raw.query("SELECT background FROM characters WHERE id = 'char-edited'").get()).toEqual({
        background: "新背景",
      });
      expect(
        raw.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'character_migrations'").get(),
      ).toBeNull();
    } finally {
      raw.close();
    }
  });

  test("v18 库迁移：第一版快照损坏时拒绝猜测、整体回滚", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-db-mig19-broken-"));
    tempDirs.push(dir);
    const path = join(dir, "v18.db");
    createV18Db(path, { brokenBaseline: true });

    expect(() => openDatabase(path)).toThrow("快照损坏");
    const raw = new Database(path);
    try {
      expect((raw.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(18);
      expect(raw.query("SELECT background FROM characters WHERE id = 'char-edited'").get()).toEqual({
        background: "新背景",
      });
    } finally {
      raw.close();
    }
  });
});

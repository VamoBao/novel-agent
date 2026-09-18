import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** 数据库文件路径（相对项目根；可用环境变量 NOVEL_DB_PATH 覆盖，测试用） */
export const DEFAULT_DB_PATH = process.env.NOVEL_DB_PATH ?? "data/novel.db";

/** schema 版本：结构变更时递增；不匹配时开发期直接重建（本地测试数据可弃） */
const SCHEMA_VERSION = 3;

/**
 * 打开（必要时创建）数据库并完成建表。
 * 四张表主键均为应用层生成的 UUIDv7（时间有序，索引友好）：
 * - novels：小说信息（其余业务表经 novel_id 外键关联）
 * - characters：角色卡，1:N（novel_id 索引）
 * - worldviews：世界观，1:1（novel_id 唯一），taboos 数组存 JSON 文本
 * - outlines：大纲树（卷/部/幕/章），parent_id 自引用外键，多版本行并存
 */
export function openDatabase(path: string = DEFAULT_DB_PATH): Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  // SQLite 外键约束默认关闭，必须按连接显式开启
  db.exec("PRAGMA foreign_keys = ON;");

  const versionRow = db.query("PRAGMA user_version").get() as { user_version: number };
  if (versionRow.user_version !== SCHEMA_VERSION) {
    db.exec("DROP TABLE IF EXISTS outlines;");
    db.exec("DROP TABLE IF EXISTS characters;");
    db.exec("DROP TABLE IF EXISTS worldviews;");
    db.exec("DROP TABLE IF EXISTS novels;");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS novels (
      id TEXT PRIMARY KEY,
      name TEXT,
      author TEXT,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS characters (
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
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_characters_novel_id ON characters(novel_id);",
  );
  db.exec(`
    CREATE TABLE IF NOT EXISTS worldviews (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL UNIQUE REFERENCES novels(id),
      geography TEXT NOT NULL,
      fantasy_attributes TEXT,
      real_world_mapping TEXT,
      taboos TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS outlines (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL REFERENCES novels(id),
      parent_id TEXT REFERENCES outlines(id),
      type TEXT NOT NULL CHECK (type IN ('volume', 'part', 'act', 'chapter')),
      name TEXT NOT NULL,
      sort INTEGER NOT NULL CHECK (sort >= 1),
      version INTEGER NOT NULL CHECK (version >= 1),
      is_current_version INTEGER NOT NULL CHECK (is_current_version IN (0, 1)),
      status TEXT NOT NULL CHECK (status IN ('deprecated', 'planned', 'writing', 'completed')),
      document_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_outlines_novel_id ON outlines(novel_id);",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_outlines_parent_id ON outlines(parent_id);",
  );
  // sort 唯一性仅约束「同小说 + 同父级 + 当前版本」：根节点 parent_id 为 NULL，
  // SQLite 唯一索引视 NULL 互异，故用 COALESCE 归一后再判重；历史版本行不受限
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_outlines_current_sort
    ON outlines(novel_id, COALESCE(parent_id, ''), sort)
    WHERE is_current_version = 1;
  `);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  return db;
}

let defaultDb: Database | undefined;

/** 默认全局数据库连接（懒加载：避免模块导入即建库文件；各 store 共享） */
export function getDefaultDatabase(): Database {
  defaultDb ??= openDatabase();
  return defaultDb;
}

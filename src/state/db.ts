import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** 数据库文件路径（相对项目根；可用环境变量 NOVEL_DB_PATH 覆盖，测试用） */
export const DEFAULT_DB_PATH = process.env.NOVEL_DB_PATH ?? "data/novel.db";

/**
 * 打开（必要时创建）数据库并完成建表。
 * 表结构随功能演进在此追加；characters 表字段与 characterSchema 一一对应（平铺）。
 */
export function openDatabase(path: string = DEFAULT_DB_PATH): Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id TEXT NOT NULL,
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
  // 世界观与小说 1:1：novel_id 直接作主键；taboos 为字符串数组，存 JSON 文本
  db.exec(`
    CREATE TABLE IF NOT EXISTS worldviews (
      novel_id TEXT PRIMARY KEY,
      geography TEXT NOT NULL,
      fantasy_attributes TEXT,
      real_world_mapping TEXT,
      taboos TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}

let defaultDb: Database | undefined;

/** 默认全局数据库连接（懒加载：避免模块导入即建库文件；各 store 共享） */
export function getDefaultDatabase(): Database {
  defaultDb ??= openDatabase();
  return defaultDb;
}

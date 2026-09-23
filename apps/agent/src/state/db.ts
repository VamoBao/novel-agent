import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** 数据库文件路径（相对项目根；可用环境变量 NOVEL_DB_PATH 覆盖，测试用） */
export const DEFAULT_DB_PATH = process.env.NOVEL_DB_PATH ?? "data/novel.db";

/** schema 版本：结构变更时递增；4→5 起 client 书库已投产，仅做保数据的增量迁移，
 *  DROP 重建仅保留给开发期旧库（<4）与异常版本的兜底 */
const SCHEMA_VERSION = 7;

/**
 * 打开（必要时创建）数据库并完成建表。
 * 五张表主键均为应用层生成的 UUIDv7（时间有序，索引友好）：
 * - novels：小说信息（pinned / favorite 为书库管理标记；name 在大纲确认后回填），
 *   其余业务表经 novel_id 外键关联
 * - characters：角色卡，1:N（novel_id 索引）
 * - worldviews：世界观，1:1（novel_id 唯一），taboos 数组存 JSON 文本
 * - outlines：大纲树（部/幕两级入库，章为写作期预留），parent_id 自引用外键，多版本行并存；
 *   内容随节点入库（summary 梗概，key_plot_points 关键情节点存 JSON 文本，仅幕节点携带）
 * - locations：小说世界的地理位置（坐标/图层/人口），parent_id 自引用外键（城市→大陆层级），
 *   population 可空（无人/未设定）
 */
export function openDatabase(path: string = DEFAULT_DB_PATH): Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  // 跨进程并发（agent 会话写库 / 查询 CLI 打开库）时短锁冲突等待重试，
  // 而非默认 busy_timeout=0 立即抛 "database is locked"
  db.exec("PRAGMA busy_timeout = 5000;");
  // SQLite 外键约束默认关闭，必须按连接显式开启
  db.exec("PRAGMA foreign_keys = ON;");
  // journal_mode 幂等设置：已是 WAL 不再执行设置语句（该语句本身要取库级锁，
  // 无条件执行会让纯浏览路径与写进程冲突）
  const modeRow = db.query("PRAGMA journal_mode").get() as { journal_mode: string };
  if (modeRow.journal_mode.toLowerCase() !== "wal") {
    db.exec("PRAGMA journal_mode = WAL;");
  }

  const versionRow = db.query("PRAGMA user_version").get() as { user_version: number };
  if (versionRow.user_version !== SCHEMA_VERSION) {
    const version = versionRow.user_version;
    if (version >= 4 && version < SCHEMA_VERSION) {
      // 已投产库（>=4）保数据增量迁移，逐级补列（每段以来源版本守卫，跨版本直升
      // 时各段按链式顺序同批执行，已是目标形态的段不重复跑——重复 ALTER 会报 duplicate column）
      if (version === 4) {
        // 4→5：novels 增列 pinned / favorite（书库管理），新列有 DEFAULT，旧数据无需回填
        db.exec("ALTER TABLE novels ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;");
        db.exec("ALTER TABLE novels ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;");
      }
      if (version <= 5) {
        // 5→6：outlines 增列内容（summary 梗概 / key_plot_points 情节点 JSON 文本），
        // 旧行留 NULL 不回填（决策见 DECISIONS：读取路径暂不动，旧书预览走 output 产物）
        db.exec("ALTER TABLE outlines ADD COLUMN summary TEXT;");
        db.exec("ALTER TABLE outlines ADD COLUMN key_plot_points TEXT;");
      }
      // 6→7：新增 locations 表，无 ALTER——由下方 CREATE TABLE IF NOT EXISTS 幂等落地
    } else {
      // 开发期旧库（<4，无客户端投产数据）或异常版本（>7 的库被旧代码打开）：重建兜底
      db.exec("DROP TABLE IF EXISTS outlines;");
      db.exec("DROP TABLE IF EXISTS locations;");
      db.exec("DROP TABLE IF EXISTS characters;");
      db.exec("DROP TABLE IF EXISTS worldviews;");
      db.exec("DROP TABLE IF EXISTS novels;");
    }
    // 版本号写入只发生在真正迁移 / 重建时——PRAGMA user_version 赋值是写语句，
    // 无条件执行会让「版本已匹配」的纯浏览路径也去抢写锁（跨进程并发即 locked）
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS novels (
      id TEXT PRIMARY KEY,
      name TEXT,
      author TEXT,
      description TEXT,
      pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
      favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
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
      type TEXT NOT NULL CHECK (type IN ('part', 'act', 'chapter')),
      name TEXT NOT NULL,
      summary TEXT,
      key_plot_points TEXT,
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
  db.exec(`
    CREATE TABLE IF NOT EXISTS locations (
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
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_locations_novel_id ON locations(novel_id);",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_locations_parent_id ON locations(parent_id);",
  );
  return db;
}

let defaultDb: Database | undefined;

/** 默认全局数据库连接（懒加载：避免模块导入即建库文件；各 store 共享） */
export function getDefaultDatabase(): Database {
  defaultDb ??= openDatabase();
  return defaultDb;
}

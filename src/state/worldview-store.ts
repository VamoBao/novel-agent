import type { Database } from "bun:sqlite";
import { worldviewSchema, type Worldview } from "../schemas";
import { DEFAULT_DB_PATH, getDefaultDatabase, openDatabase } from "./db";

/** 数据库中的世界观记录：世界观 + 库表元信息 */
export interface StoredWorldview {
  novelId: string;
  createdAt: string;
  updatedAt: string;
  worldview: Worldview;
}

/** worldviews 表行结构（列与 worldviewSchema 对应，taboos 存 JSON 文本） */
interface WorldviewRow {
  novel_id: string;
  geography: string;
  fantasy_attributes: string | null;
  real_world_mapping: string | null;
  taboos: string;
  created_at: string;
  updated_at: string;
}

const UPSERT_SQL = `
  INSERT INTO worldviews (
    novel_id, geography, fantasy_attributes, real_world_mapping,
    taboos, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(novel_id) DO UPDATE SET
    geography = excluded.geography,
    fantasy_attributes = excluded.fantasy_attributes,
    real_world_mapping = excluded.real_world_mapping,
    taboos = excluded.taboos,
    updated_at = excluded.updated_at;
`;

const SELECT_SQL = `
  SELECT novel_id, geography, fantasy_attributes, real_world_mapping,
         taboos, created_at, updated_at
  FROM worldviews WHERE novel_id = ?;
`;

function rowToWorldview(row: WorldviewRow): Worldview {
  // 列值经 schema 还原为世界观结构，读侧同样过 zod 校验（库内数据完整性兜底）
  return worldviewSchema.parse({
    background: {
      geography: row.geography,
      fantasyAttributes: row.fantasy_attributes ?? undefined,
      realWorldMapping: row.real_world_mapping ?? undefined,
    },
    taboos: JSON.parse(row.taboos) as string[],
  });
}

/**
 * 世界观持久化：按创作 ID 绑定存储（与小说 1:1，novel_id 即主键）。
 * 世界观经 Agent 与用户确认后保存；重复保存为覆盖更新（created_at 保留）。
 */
export class WorldviewStore {
  /** 共享数据库连接构造（与其他 store 同库不同表） */
  constructor(private readonly db: Database) {}

  static open(path: string = DEFAULT_DB_PATH): WorldviewStore {
    return new WorldviewStore(openDatabase(path));
  }

  /** upsert 保存世界观（先过 schema 校验），返回库内最终记录 */
  saveWorldview(novelId: string, worldview: Worldview): StoredWorldview {
    const validated = worldviewSchema.parse(worldview);
    const now = new Date().toISOString();
    this.db
      .prepare(UPSERT_SQL)
      .run(
        novelId,
        validated.background.geography,
        validated.background.fantasyAttributes ?? null,
        validated.background.realWorldMapping ?? null,
        JSON.stringify(validated.taboos),
        now,
        now,
      );
    return this.getWorldviewOrThrow(novelId);
  }

  /** 取某本小说的世界观；无记录返回 undefined */
  getWorldview(novelId: string): StoredWorldview | undefined {
    const row = this.db.prepare(SELECT_SQL).get(novelId) as WorldviewRow | null;
    if (!row) return undefined;
    return {
      novelId: row.novel_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      worldview: rowToWorldview(row),
    };
  }

  private getWorldviewOrThrow(novelId: string): StoredWorldview {
    const stored = this.getWorldview(novelId);
    if (!stored) {
      throw new Error(`世界观保存后读取失败：${novelId}`);
    }
    return stored;
  }

  close(): void {
    this.db.close();
  }
}

let defaultStore: WorldviewStore | undefined;

/** 默认全局 store（懒加载，与其他 store 共享默认数据库连接） */
export function getDefaultWorldviewStore(): WorldviewStore {
  defaultStore ??= new WorldviewStore(getDefaultDatabase());
  return defaultStore;
}

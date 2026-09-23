import type { Database } from "bun:sqlite";
import { locationSchema, type Location } from "@novel/shared";
import { DEFAULT_DB_PATH, getDefaultDatabase, openDatabase } from "./db";
import { generateUuidV7 } from "./id";

/** 数据库中的位置记录：位置 + 库表元信息（id 为 UUIDv7） */
export interface StoredLocation {
  id: string;
  novelId: string;
  createdAt: string;
  updatedAt: string;
  location: Location;
}

/** locations 表行结构（列与 locationSchema 平铺字段对应） */
interface LocationRow {
  id: string;
  novel_id: string;
  parent_id: string | null;
  name: string;
  x: number;
  y: number;
  layer: string;
  population: number | null;
  created_at: string;
  updated_at: string;
}

const INSERT_SQL = `
  INSERT INTO locations (
    id, novel_id, parent_id, name, x, y, layer, population,
    created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
`;

const SELECT_SQL = `
  SELECT id, novel_id, parent_id, name, x, y, layer, population,
         created_at, updated_at
  FROM locations WHERE novel_id = ? ORDER BY created_at ASC, id ASC;
`;

function rowToLocation(row: LocationRow): Location {
  // 列值经 schema 还原为位置结构，读侧同样过 zod 校验（库内数据完整性兜底）
  return locationSchema.parse({
    name: row.name,
    x: row.x,
    y: row.y,
    layer: row.layer,
    population: row.population ?? undefined,
    parentId: row.parent_id ?? undefined,
  });
}

/**
 * 位置持久化：按创作 ID 绑定存储（与小说 1:N，父级经 parent_id 自引用成层级，
 * 如某城市的父级是某片大陆）。位置为追加式写入；更新 / 删除留待有调用方时再补。
 */
export class LocationStore {
  /** 共享数据库连接构造（与其他 store 同库不同表） */
  constructor(private readonly db: Database) {}

  static open(path: string = DEFAULT_DB_PATH): LocationStore {
    return new LocationStore(openDatabase(path));
  }

  /** 写入位置（先过 schema 校验；携带父级时父级须存在且属于同一小说），返回带库表元信息的记录 */
  addLocation(novelId: string, location: Location): StoredLocation {
    const validated = locationSchema.parse(location);
    if (validated.parentId) {
      // 外键只保证父级行存在，拦不住跨小说挂接——层级语义要求父子同书，先查后插给可读错误
      const parent = this.db
        .prepare("SELECT novel_id FROM locations WHERE id = ?;")
        .get(validated.parentId) as { novel_id: string } | undefined;
      if (!parent) {
        throw new Error(`父级位置不存在：${validated.parentId}`);
      }
      if (parent.novel_id !== novelId) {
        throw new Error(`父级位置属于其他小说，无法挂接：${validated.parentId}`);
      }
    }
    const id = generateUuidV7();
    const now = new Date().toISOString();
    this.db
      .prepare(INSERT_SQL)
      .run(
        id,
        novelId,
        validated.parentId ?? null,
        validated.name,
        validated.x,
        validated.y,
        validated.layer,
        validated.population ?? null,
        now,
        now,
      );
    return {
      id,
      novelId,
      createdAt: now,
      updatedAt: now,
      location: validated,
    };
  }

  /** 取某本小说的全部位置（按入库顺序） */
  listLocations(novelId: string): StoredLocation[] {
    const rows = this.db.prepare(SELECT_SQL).all(novelId) as LocationRow[];
    return rows.map((row) => ({
      id: row.id,
      novelId: row.novel_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      location: rowToLocation(row),
    }));
  }

  close(): void {
    this.db.close();
  }
}

let defaultStore: LocationStore | undefined;

/** 默认全局 store（懒加载，与其他 store 共享默认数据库连接） */
export function getDefaultLocationStore(): LocationStore {
  defaultStore ??= new LocationStore(getDefaultDatabase());
  return defaultStore;
}

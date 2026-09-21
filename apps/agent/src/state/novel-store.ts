import type { Database } from "bun:sqlite";
import { DEFAULT_DB_PATH, getDefaultDatabase, openDatabase } from "./db";
import { generateNovelId } from "./id";

/** novels 表记录：小说基本信息（name 在大纲确认后回填；pinned / favorite 为书库管理标记） */
export interface NovelRecord {
  id: string;
  name: string | null;
  author: string | null;
  description: string | null;
  pinned: boolean;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NovelInput {
  /** 指定 ID（如工作流已生成的创作 ID）；缺省自动生成 UUIDv7 */
  id?: string;
  name?: string;
  author?: string;
  description?: string;
}

export type NovelPatch = Partial<Pick<NovelInput, "name" | "author" | "description">>;

const INSERT_SQL = `
  INSERT INTO novels (id, name, author, description, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?);
`;

const SELECT_SQL = `
  SELECT id, name, author, description, pinned, favorite, created_at, updated_at
  FROM novels WHERE id = ?;
`;

const LIST_SQL = `
  SELECT id, name, author, description, pinned, favorite, created_at, updated_at
  FROM novels ORDER BY pinned DESC, created_at DESC, id DESC;
`;

/**
 * 小说信息持久化。novels 行必须先于 characters / worldviews 创建
 *（二者 novel_id 外键关联本表）。
 */
export class NovelStore {
  /** 共享数据库连接构造（与其他 store 同库不同表） */
  constructor(private readonly db: Database) {}

  static open(path: string = DEFAULT_DB_PATH): NovelStore {
    return new NovelStore(openDatabase(path));
  }

  /** 创建小说记录；ID 重复抛错 */
  createNovel(input: NovelInput = {}): NovelRecord {
    const id = input.id ?? generateNovelId();
    if (this.getNovel(id)) {
      throw new Error(`小说已存在：${id}`);
    }
    const now = new Date().toISOString();
    this.db
      .prepare(INSERT_SQL)
      .run(id, input.name ?? null, input.author ?? null, input.description ?? null, now, now);
    return this.getNovelOrThrow(id);
  }

  getNovel(id: string): NovelRecord | undefined {
    const row = this.db.prepare(SELECT_SQL).get(id) as NovelRow | null;
    return row ? rowToNovel(row) : undefined;
  }

  /** 全部小说（置顶优先，组内按创建时间倒序），供库查询入口列出 */
  listNovels(): NovelRecord[] {
    const rows = this.db.prepare(LIST_SQL).all() as NovelRow[];
    return rows.map(rowToNovel);
  }

  /** 置顶 / 收藏标记置位（书库管理右键菜单），返回更新后记录 */
  setNovelPinned(id: string, pinned: boolean): NovelRecord {
    return this.updateFlag(id, "pinned", pinned);
  }

  setNovelFavorite(id: string, favorite: boolean): NovelRecord {
    return this.updateFlag(id, "favorite", favorite);
  }

  /** 整本删除：单事务级联清掉 outlines（自引用树整删）→ characters → worldviews → novels */
  deleteNovel(id: string): void {
    if (!this.getNovel(id)) {
      throw new Error(`小说不存在，无法删除：${id}`);
    }
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM outlines WHERE novel_id = ?;").run(id);
      this.db.prepare("DELETE FROM characters WHERE novel_id = ?;").run(id);
      this.db.prepare("DELETE FROM worldviews WHERE novel_id = ?;").run(id);
      this.db.prepare("DELETE FROM novels WHERE id = ?;").run(id);
    })();
  }

  /** 部分更新（name/author/description），自动盖章 updated_at */
  updateNovel(id: string, patch: NovelPatch): NovelRecord {
    const current = this.getNovel(id);
    if (!current) {
      throw new Error(`小说不存在，无法更新：${id}`);
    }
    this.db
      .prepare(
        "UPDATE novels SET name = ?, author = ?, description = ?, updated_at = ? WHERE id = ?;",
      )
      .run(
        patch.name ?? current.name,
        patch.author ?? current.author,
        patch.description ?? current.description,
        new Date().toISOString(),
        id,
      );
    return this.getNovelOrThrow(id);
  }

  close(): void {
    this.db.close();
  }

  private getNovelOrThrow(id: string): NovelRecord {
    const record = this.getNovel(id);
    if (!record) {
      throw new Error(`小说记录写入后读取失败：${id}`);
    }
    return record;
  }

  /** 置位 pinned / favorite 管理标记（不动 updated_at——非内容变更） */
  private updateFlag(id: string, column: "pinned" | "favorite", value: boolean): NovelRecord {
    if (!this.getNovel(id)) {
      throw new Error(`小说不存在，无法更新：${id}`);
    }
    this.db.prepare(`UPDATE novels SET ${column} = ? WHERE id = ?;`).run(value ? 1 : 0, id);
    return this.getNovelOrThrow(id);
  }
}

interface NovelRow {
  id: string;
  name: string | null;
  author: string | null;
  description: string | null;
  pinned: number;
  favorite: number;
  created_at: string;
  updated_at: string;
}

function rowToNovel(row: NovelRow): NovelRecord {
  return {
    id: row.id,
    name: row.name,
    author: row.author,
    description: row.description,
    pinned: row.pinned === 1,
    favorite: row.favorite === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

let defaultStore: NovelStore | undefined;

/** 默认全局 store（懒加载，与其他 store 共享默认数据库连接） */
export function getDefaultNovelStore(): NovelStore {
  defaultStore ??= new NovelStore(getDefaultDatabase());
  return defaultStore;
}

import type { Database } from "bun:sqlite";
import {
  novelCreationParamsSchema,
  novelWritingPrefsSchema,
  type NovelCreationParams,
  type NovelWritingPrefs,
} from "@novel/shared";
import { DEFAULT_DB_PATH, getDefaultDatabase, openDatabase } from "./db";
import { generateNovelId } from "./id";

/** novels 表记录：小说基本信息（name 在大纲确认后回填；pinned / favorite 为书库管理标记；
 *  创作条件含叙事视角 narrativePov（未采集 null）；写作偏好三字段为小说级覆盖，null=未设置
 *  ——正文生成按「小说级 > 系统设置 > 内置默认」解析） */
export interface NovelRecord extends NovelCreationParams {
  id: string;
  name: string | null;
  author: string | null;
  description: string | null;
  chapterLengthMin: number | null;
  chapterLengthMax: number | null;
  stylePassScore: number | null;
  pinned: boolean;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NovelInput extends Partial<NovelCreationParams> {
  /** 指定 ID（如工作流已生成的创作 ID）；缺省自动生成 UUIDv7 */
  id?: string;
  name?: string;
  author?: string;
  description?: string;
}

export type NovelPatch = Partial<Pick<NovelInput, "name" | "author" | "description" | keyof NovelCreationParams>>;

const INSERT_SQL = `
  INSERT INTO novels (id, name, author, description, genre, audience, core_conflict, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
`;

const SELECT_SQL = `
  SELECT id, name, author, description, genre, narrative_pov, audience, core_conflict,
         chapter_length_min, chapter_length_max, style_pass_score, pinned, favorite, created_at, updated_at
  FROM novels WHERE id = ?;
`;

const LIST_SQL = `
  SELECT id, name, author, description, genre, narrative_pov, audience, core_conflict,
         chapter_length_min, chapter_length_max, style_pass_score, pinned, favorite, created_at, updated_at
  FROM novels ORDER BY pinned DESC, created_at DESC, id DESC;
`;

/**
 * 小说信息持久化。novels 行必须先于 characters / worldviews 创建
 *（二者 novel_id 外键关联本表）。
 */
export class NovelStore {
  /** 共享数据库连接构造（与其他 store 同库不同表） */
  constructor(private readonly db: Database) {}

  /** 与步骤缓存共用连接，使业务写入和完成标记处于同一事务。 */
  get database(): Database {
    return this.db;
  }

  static open(path: string = DEFAULT_DB_PATH): NovelStore {
    return new NovelStore(openDatabase(path));
  }

  /** 创建小说记录；ID 重复抛错 */
  createNovel(input: NovelInput = {}): NovelRecord {
    const params = novelCreationParamsSchema.parse({
      genre: input.genre ?? null,
      narrativePov: input.narrativePov ?? null,
      audience: input.audience ?? null,
      coreConflict: input.coreConflict ?? null,
    });
    const id = input.id ?? generateNovelId();
    if (this.getNovel(id)) {
      throw new Error(`小说已存在：${id}`);
    }
    const now = new Date().toISOString();
    this.db
      .prepare(INSERT_SQL)
      .run(
        id,
        input.name ?? null,
        input.author ?? null,
        input.description ?? null,
        params.genre,
        encodeJson(params.audience),
        encodeJson(params.coreConflict),
        now,
        now,
      );
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

  /** 整本删除：单事务级联清掉 documents（章节正文）→ outlines / locations（自引用树单语句整删）→ foreshadows → style_references → character_migration_versions → character_migrations → character_versions → characters → worldviews → novels */
  deleteNovel(id: string): void {
    if (!this.getNovel(id)) {
      throw new Error(`小说不存在，无法删除：${id}`);
    }
    this.db.transaction(() => {
      // 章节正文先于大纲节点删除（chapter_id 外键约束）
      this.db.prepare("DELETE FROM documents WHERE novel_id = ?;").run(id);
      this.db.prepare("DELETE FROM outlines WHERE novel_id = ?;").run(id);
      this.db.prepare("DELETE FROM locations WHERE novel_id = ?;").run(id);
      this.db.prepare("DELETE FROM foreshadows WHERE novel_id = ?;").run(id);
      this.db.prepare("DELETE FROM style_references WHERE novel_id = ?;").run(id);
      // 迁移修订快照先于迁移行、迁移行先于角色主行删除（migration_id / character_id 外键约束）
      this.db.prepare("DELETE FROM character_migration_versions WHERE novel_id = ?;").run(id);
      this.db.prepare("DELETE FROM character_migrations WHERE novel_id = ?;").run(id);
      // 角色历史快照先于角色主行删除（character_id 外键约束）
      this.db.prepare("DELETE FROM character_versions WHERE novel_id = ?;").run(id);
      this.db.prepare("DELETE FROM characters WHERE novel_id = ?;").run(id);
      this.db.prepare("DELETE FROM worldviews WHERE novel_id = ?;").run(id);
      this.db.prepare("DELETE FROM novels WHERE id = ?;").run(id);
    })();
  }

  /** 部分更新基本信息与创作条件；创作条件 undefined=保留、null=清空，写前校验。 */
  updateNovel(id: string, patch: NovelPatch): NovelRecord {
    if (!this.getNovel(id)) {
      throw new Error(`小说不存在，无法更新：${id}`);
    }
    const params = novelCreationParamsSchema.partial().parse(patch);
    // 只写显式给定字段，不用读取快照回填未修改列：查询进程改名与 Agent
    // 保存创作条件可并发，后提交的改名不能覆盖先提交的条件。
    const assignments: string[] = [];
    const values: (string | null)[] = [];
    const set = (column: string, value: string | null | undefined): void => {
      if (value === undefined) return;
      assignments.push(`${column} = ?`);
      values.push(value);
    };
    set("name", patch.name ?? undefined);
    set("author", patch.author ?? undefined);
    set("description", patch.description ?? undefined);
    set("genre", params.genre);
    set("narrative_pov", params.narrativePov);
    set("audience", params.audience === undefined ? undefined : encodeJson(params.audience));
    set("core_conflict", params.coreConflict === undefined ? undefined : encodeJson(params.coreConflict));
    set("updated_at", new Date().toISOString());
    this.db
      .prepare(`UPDATE novels SET ${assignments.join(", ")} WHERE id = ?;`)
      .run(...values, id);
    return this.getNovelOrThrow(id);
  }

  /** 写作偏好的小说级覆盖：全量替换三项（null=清空该级覆盖，回落系统设置）。
   *  schema 层强校验篇幅 min/max 同设或同空且 min ≤ max；返回更新后记录 */
  updateWritingPrefs(id: string, prefs: NovelWritingPrefs): NovelRecord {
    if (!this.getNovel(id)) {
      throw new Error(`小说不存在，无法更新写作偏好：${id}`);
    }
    const parsed = novelWritingPrefsSchema.parse(prefs);
    this.db
      .prepare(
        `UPDATE novels SET chapter_length_min = ?, chapter_length_max = ?, style_pass_score = ?,
         updated_at = ? WHERE id = ?;`,
      )
      .run(
        parsed.chapterLengthMin,
        parsed.chapterLengthMax,
        parsed.stylePassScore,
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
  genre: string | null;
  narrative_pov: string | null;
  audience: string | null;
  core_conflict: string | null;
  chapter_length_min: number | null;
  chapter_length_max: number | null;
  style_pass_score: number | null;
  pinned: number;
  favorite: number;
  created_at: string;
  updated_at: string;
}

function rowToNovel(row: NovelRow): NovelRecord {
  const params = novelCreationParamsSchema.safeParse({
    genre: row.genre,
    narrativePov: row.narrative_pov,
    audience: decodeJson(row.id, "audience", row.audience),
    coreConflict: decodeJson(row.id, "coreConflict", row.core_conflict),
  });
  if (!params.success) {
    const issue = params.error.issues[0];
    throw new Error(`小说 ${row.id} 的 ${issue?.path.join(".") ?? "创作条件"} 字段损坏：${issue?.message ?? "格式不合法"}`, { cause: params.error });
  }
  return {
    ...params.data,
    id: row.id,
    name: row.name,
    author: row.author,
    description: row.description,
    chapterLengthMin: row.chapter_length_min,
    chapterLengthMax: row.chapter_length_max,
    stylePassScore: row.style_pass_score,
    pinned: row.pinned === 1,
    favorite: row.favorite === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function encodeJson(value: NovelCreationParams["audience"] | NovelCreationParams["coreConflict"]): string | null {
  return value === null ? null : JSON.stringify(value);
}

function decodeJson(novelId: string, field: string, raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`小说 ${novelId} 的 ${field} 字段损坏：JSON 解析失败`, { cause: error });
  }
}

let defaultStore: NovelStore | undefined;

/** 默认全局 store（懒加载，与其他 store 共享默认数据库连接） */
export function getDefaultNovelStore(): NovelStore {
  defaultStore ??= new NovelStore(getDefaultDatabase());
  return defaultStore;
}

import type { Database } from "bun:sqlite";
import { styleReferenceSchema, type StyleReference } from "@novel/shared";
import { DEFAULT_DB_PATH, getDefaultDatabase, openDatabase } from "./db";
import { generateUuidV7 } from "./id";

/** 文风录入与编辑入参：schema 字段 + enabled 可选（缺省 true——新增即启用） */
export interface StyleReferenceInput {
  name: string;
  content: string;
  enabled?: boolean;
}

/** 参考文风 patch：undefined = 不动（对齐 ForeshadowPatch 的编辑语义） */
export interface StyleReferencePatch {
  name?: string;
  content?: string;
  enabled?: boolean;
}

/** 数据库中的参考文风记录：文风 + 库表元信息（id 为 UUIDv7） */
export interface StoredStyleReference {
  id: string;
  novelId: string;
  createdAt: string;
  updatedAt: string;
  styleReference: StyleReference;
}

/** style_references 表行结构（列名蛇形；enabled 0/1 整数与 schema 布尔互转） */
interface StyleReferenceRow {
  id: string;
  novel_id: string;
  name: string;
  content: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

const COLUMNS = "id, novel_id, name, content, enabled, created_at, updated_at";

const SELECT_SQL = `
  SELECT ${COLUMNS} FROM style_references WHERE novel_id = ? ORDER BY created_at ASC, id ASC;
`;

/** 列值经 schema 还原（库内数据完整性兜底，与其他 store 的读侧校验一致） */
function rowToStyleReference(row: StyleReferenceRow): StyleReference {
  return styleReferenceSchema.parse({
    name: row.name,
    content: row.content,
    enabled: row.enabled === 1,
  });
}

/**
 * 参考文风持久化：按创作 ID 绑定存储（与小说 1:N，内容直接进库不落文件——
 * 文风是喂给 LLM 的素材而非人类阅读产物，决策见根 DECISIONS）。
 * 完整 CRUD：正文生成按 enabled 过滤注入，结构树文风组浏览与编辑表单走同一入口。
 */
export class StyleReferenceStore {
  /** 共享数据库连接构造（与其他 store 同库不同表） */
  constructor(private readonly db: Database) {}

  static open(path: string = DEFAULT_DB_PATH): StyleReferenceStore {
    return new StyleReferenceStore(openDatabase(path));
  }

  /** 写入文风（先过 schema 校验；enabled 缺省 true），返回带库表元信息的记录 */
  addStyleReference(novelId: string, input: StyleReferenceInput): StoredStyleReference {
    const validated = styleReferenceSchema.parse({
      name: input.name,
      content: input.content,
      enabled: input.enabled ?? true,
    });
    const id = generateUuidV7();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO style_references (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?);`,
      )
      .run(id, novelId, validated.name, validated.content, validated.enabled ? 1 : 0, now, now);
    return { id, novelId, createdAt: now, updatedAt: now, styleReference: validated };
  }

  /** 取某本小说的全部文风（按入库顺序） */
  listStyleReferences(novelId: string): StoredStyleReference[] {
    const rows = this.db.prepare(SELECT_SQL).all(novelId) as StyleReferenceRow[];
    return rows.map((row) => ({
      id: row.id,
      novelId: row.novel_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      styleReference: rowToStyleReference(row),
    }));
  }

  /** 按主键取单条；无记录返回 undefined */
  getStyleReference(id: string): StoredStyleReference | undefined {
    const row = this.db
      .prepare(`SELECT ${COLUMNS} FROM style_references WHERE id = ?;`)
      .get(id) as StyleReferenceRow | null;
    return row
      ? {
          id: row.id,
          novelId: row.novel_id,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          styleReference: rowToStyleReference(row),
        }
      : undefined;
  }

  /** patch 更新（undefined = 不动），自动盖章 updated_at；行不存在抛可读错误 */
  updateStyleReference(id: string, patch: StyleReferencePatch): StoredStyleReference {
    const current = this.getStyleReference(id);
    if (!current) {
      throw new Error(`参考文风不存在，无法更新：${id}`);
    }
    const validated = styleReferenceSchema.parse({
      name: patch.name ?? current.styleReference.name,
      content: patch.content ?? current.styleReference.content,
      enabled: patch.enabled ?? current.styleReference.enabled,
    });
    const now = new Date().toISOString();
    this.db
      .prepare(
        "UPDATE style_references SET name = ?, content = ?, enabled = ?, updated_at = ? WHERE id = ?;",
      )
      .run(validated.name, validated.content, validated.enabled ? 1 : 0, now, id);
    return { id, novelId: current.novelId, createdAt: current.createdAt, updatedAt: now, styleReference: validated };
  }

  /** 删除文风；行不存在抛可读错误 */
  deleteStyleReference(id: string): void {
    const result = this.db.prepare("DELETE FROM style_references WHERE id = ?;").run(id);
    if (result.changes === 0) {
      throw new Error(`参考文风不存在，无法删除：${id}`);
    }
  }

  close(): void {
    this.db.close();
  }
}

let defaultStore: StyleReferenceStore | undefined;

/** 默认全局 store（懒加载，与其他 store 共享默认数据库连接） */
export function getDefaultStyleReferenceStore(): StyleReferenceStore {
  defaultStore ??= new StyleReferenceStore(getDefaultDatabase());
  return defaultStore;
}

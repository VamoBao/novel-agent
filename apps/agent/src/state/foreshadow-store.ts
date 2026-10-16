import type { Database, SQLQueryBindings } from "bun:sqlite";
import {
  foreshadowSchema,
  foreshadowPatchSchema,
  type Foreshadow,
  type ForeshadowPatch,
} from "@novel/shared";
import { DEFAULT_DB_PATH, getDefaultDatabase, openDatabase } from "./db";
import { generateUuidV7 } from "./id";

/** 数据库中的伏笔记录：伏笔 + 库表元信息（id 为 UUIDv7） */
export interface StoredForeshadow {
  id: string;
  novelId: string;
  /** 埋设幕节点（outlines 幕节点 ID，可空裸列——章节规划按幕圈定回传未绑章伏笔） */
  actNodeId: string | null;
  /** 回收幕节点（大纲规划的真相揭晓幕，可空裸列——章节规划按幕圈定回传「待回收」伏笔） */
  recoverActNodeId: string | null;
  /** 全部回收幕；旧单幕兼容字段始终取本数组首项。 */
  recoverActNodeIds: string[];
  /** 普通编辑修订号；工作流自动绑定不递增，用于恢复时识别用户修改。 */
  editRevision: number;
  createdAt: string;
  updatedAt: string;
  foreshadow: Foreshadow;
}

/** foreshadows 表行结构（列与 foreshadowSchema 平铺字段对应，多值字段存 JSON 文本） */
interface ForeshadowRow {
  id: string;
  novel_id: string;
  surface_action: string;
  hidden_truth: string;
  attention_level: number;
  recovery_status: string;
  planting_method: string | null;
  purpose: string | null;
  appear_chapter_id: string | null;
  act_node_id: string | null;
  recover_act_node_id: string | null;
  recover_act_node_ids: string;
  edit_revision: number;
  recover_chapter_ids: string | null;
  character_ids: string | null;
  created_at: string;
  updated_at: string;
}

const INSERT_SQL = `
  INSERT INTO foreshadows (
    id, novel_id, surface_action, hidden_truth, attention_level, recovery_status,
    planting_method, purpose, appear_chapter_id, recover_chapter_ids, character_ids, act_node_id, recover_act_node_id, recover_act_node_ids,
    created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
`;

const SELECT_BY_NOVEL_SQL = `
  SELECT id, novel_id, surface_action, hidden_truth, attention_level, recovery_status,
         planting_method, purpose, appear_chapter_id, recover_chapter_ids, character_ids, act_node_id, recover_act_node_id, recover_act_node_ids,
         edit_revision, created_at, updated_at
  FROM foreshadows WHERE novel_id = ? ORDER BY created_at ASC, id ASC;
`;

const SELECT_BY_ID_SQL = `
  SELECT id, novel_id, surface_action, hidden_truth, attention_level, recovery_status,
         planting_method, purpose, appear_chapter_id, recover_chapter_ids, character_ids, act_node_id, recover_act_node_id, recover_act_node_ids,
         edit_revision, created_at, updated_at
  FROM foreshadows WHERE id = ?;
`;

const UPDATE_SQL = `
  UPDATE foreshadows SET
    surface_action = ?, hidden_truth = ?, attention_level = ?, recovery_status = ?,
    planting_method = ?, purpose = ?, appear_chapter_id = ?,
    recover_chapter_ids = ?, character_ids = ?, updated_at = ?, edit_revision = edit_revision + ?
  WHERE id = ?;
`;

/** JSON 文本列还原为数组；损坏时抛带伏笔 ID 的可读错误（库内数据完整性兜底） */
function parseJsonArrayColumn(id: string, column: string, raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.some((v) => typeof v !== "string")) {
      throw new Error("非字符串数组");
    }
    return parsed as string[];
  } catch (error) {
    throw new Error(`伏笔 ${id} 的 ${column} 列损坏：${String(error)}`, { cause: error });
  }
}

function rowToForeshadow(row: ForeshadowRow): Foreshadow {
  // 列值经 schema 还原为伏笔结构，读侧同样过 zod 校验
  return foreshadowSchema.parse({
    surfaceAction: row.surface_action,
    hiddenTruth: row.hidden_truth,
    attentionLevel: row.attention_level,
    recoveryStatus: row.recovery_status,
    plantingMethod: row.planting_method ?? undefined,
    purpose: row.purpose ?? undefined,
    appearChapterId: row.appear_chapter_id ?? undefined,
    recoverChapterIds: row.recover_chapter_ids
      ? parseJsonArrayColumn(row.id, "recover_chapter_ids", row.recover_chapter_ids)
      : undefined,
    characterIds: row.character_ids
      ? parseJsonArrayColumn(row.id, "character_ids", row.character_ids)
      : undefined,
  });
}

function rowToStored(row: ForeshadowRow): StoredForeshadow {
  const recoverActNodeIds = parseJsonArrayColumn(row.id, "recover_act_node_ids", row.recover_act_node_ids);
  if (recoverActNodeIds.some((id) => id.length === 0)) {
    throw new Error(`伏笔 ${row.id} 的 recover_act_node_ids 列损坏：幕 ID 不可为空`);
  }
  return {
    id: row.id,
    novelId: row.novel_id,
    actNodeId: row.act_node_id,
    recoverActNodeId: recoverActNodeIds[0] ?? null,
    recoverActNodeIds,
    editRevision: row.edit_revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    foreshadow: rowToForeshadow(row),
  };
}

/** 伏笔结构 → 列参数（可选字段缺省写 NULL，多值字段存 JSON 文本） */
function foreshadowToColumns(f: Foreshadow): SQLQueryBindings[] {
  return [
    f.surfaceAction,
    f.hiddenTruth,
    f.attentionLevel,
    f.recoveryStatus,
    f.plantingMethod ?? null,
    f.purpose ?? null,
    f.appearChapterId ?? null,
    f.recoverChapterIds ? JSON.stringify(f.recoverChapterIds) : null,
    f.characterIds ? JSON.stringify(f.characterIds) : null,
  ];
}

/**
 * 伏笔持久化：按创作 ID 绑定存储（与小说 1:N）。
 * 完整 CRUD：伏笔有生命周期（未回收 → 部分回收 → 已回收），patch 支持回收状态
 * 流转、追加回收章节与内容修订；patch 语义 undefined=不动 / null=清空 / 值=覆盖。
 */
export class ForeshadowStore {
  /** 共享数据库连接构造（与其他 store 同库不同表） */
  constructor(private readonly db: Database) {}

  static open(path: string = DEFAULT_DB_PATH): ForeshadowStore {
    return new ForeshadowStore(openDatabase(path));
  }

  /** 写入伏笔（先过 schema 校验；携带服务角色时角色须存在且属于同一小说；actNodeId 为
   *  埋设幕节点，第四参支持单个或多个回收幕；缺省不规划回收幕），
   *  返回带库表元信息的记录 */
  addForeshadow(
    novelId: string,
    foreshadow: Foreshadow,
    actNodeId?: string,
    recoverActNodeId?: string | readonly string[],
  ): StoredForeshadow {
    const validated = foreshadowSchema.parse(foreshadow);
    const recoverActNodeIds = [...new Set(typeof recoverActNodeId === "string"
      ? [recoverActNodeId] : (recoverActNodeId ?? []))];
    if (recoverActNodeIds.some((id) => typeof id !== "string" || id.length === 0)) {
      throw new Error("回收幕 ID 必须为非空字符串");
    }
    this.assertCharactersInNovel(novelId, validated.characterIds);
    const id = generateUuidV7();
    const now = new Date().toISOString();
    this.db
      .prepare(INSERT_SQL)
      .run(id, novelId, ...foreshadowToColumns(validated), actNodeId ?? null, recoverActNodeIds[0] ?? null, JSON.stringify(recoverActNodeIds), now, now);
    return {
      id,
      novelId,
      actNodeId: actNodeId ?? null,
      recoverActNodeId: recoverActNodeIds[0] ?? null,
      recoverActNodeIds,
      editRevision: 0,
      createdAt: now,
      updatedAt: now,
      foreshadow: validated,
    };
  }

  /** 取某本小说的全部伏笔（按入库顺序） */
  listForeshadows(novelId: string): StoredForeshadow[] {
    const rows = this.db
      .prepare(SELECT_BY_NOVEL_SQL)
      .all(novelId) as ForeshadowRow[];
    return rows.map(rowToStored);
  }

  /** 某本小说指定幕下「未绑登场章」的伏笔（章节规划回传清单，按入库顺序） */
  listUnboundByAct(novelId: string, actNodeId: string): StoredForeshadow[] {
    const rows = this.db
      .prepare(
        `SELECT id, novel_id, surface_action, hidden_truth, attention_level, recovery_status,
                planting_method, purpose, appear_chapter_id, recover_chapter_ids, character_ids, act_node_id, recover_act_node_id, recover_act_node_ids,
                edit_revision, created_at, updated_at
         FROM foreshadows
         WHERE novel_id = ? AND act_node_id = ? AND appear_chapter_id IS NULL
         ORDER BY created_at ASC, id ASC;`,
      )
      .all(novelId, actNodeId) as ForeshadowRow[];
    return rows.map(rowToStored);
  }

  /** 本幕尚未细化回收章的伏笔；其他幕已有回收章不影响本幕待办。 */
  listUnrecoveredByAct(novelId: string, actNodeId: string): StoredForeshadow[] {
    const chapters = this.db.prepare(
      "SELECT id FROM outlines WHERE novel_id = ? AND parent_id = ? AND type = 'chapter';",
    ).all(novelId, actNodeId) as Array<{ id: string }>;
    const chapterIds = new Set(chapters.map((chapter) => chapter.id));
    return this.listForeshadows(novelId).filter((stored) =>
      stored.recoverActNodeIds.includes(actNodeId)
      && !stored.foreshadow.recoverChapterIds?.some((id) => chapterIds.has(id)),
    );
  }

  /** patch 更新并盖章 updated_at；普通编辑递增修订号，工作流自动绑定保留修订号。 */
  updateForeshadow(id: string, patch: ForeshadowPatch, options?: { source?: "workflow" }): StoredForeshadow {
    const validated = foreshadowPatchSchema.parse(patch);
    const current = this.getForeshadow(id);
    if (!current) {
      throw new Error(`伏笔不存在，无法更新：${id}`);
    }
    if (validated.characterIds) {
      this.assertCharactersInNovel(current.novelId, validated.characterIds);
    }
    // 逐字段合并：null 清空（还原为缺省），undefined 保留现值
    const merged: Foreshadow = { ...current.foreshadow };
    for (const [key, value] of Object.entries(validated)) {
      if (value === undefined) continue;
      if (value === null) {
        delete merged[key as keyof Foreshadow];
      } else {
        (merged as Record<string, unknown>)[key] = value;
      }
    }
    const updated = foreshadowSchema.parse(merged);
    const updatedAt = new Date().toISOString();
    this.db
      .prepare(UPDATE_SQL)
      .run(...foreshadowToColumns(updated), updatedAt, options?.source === "workflow" ? 0 : 1, id);
    const stored = this.getForeshadow(id);
    if (!stored) {
      throw new Error(`伏笔更新后读取失败：${id}`);
    }
    return stored;
  }

  /** 删除单条伏笔；不存在抛可读错误 */
  deleteForeshadow(id: string): void {
    const result = this.db.prepare("DELETE FROM foreshadows WHERE id = ?;").run(id);
    if (result.changes === 0) {
      throw new Error(`伏笔不存在，无法删除：${id}`);
    }
  }

  /** 取单条伏笔；无记录返回 undefined */
  getForeshadow(id: string): StoredForeshadow | undefined {
    const row = this.db.prepare(SELECT_BY_ID_SQL).get(id) as ForeshadowRow | null;
    return row ? rowToStored(row) : undefined;
  }

  /**
   * 服务角色校验：JSON 数组内的角色 ID 无法靠外键约束，应用层保证
   * 每个角色存在且属于同一小说（跨小说挂接破坏伏笔的角色归属语义）
   */
  private assertCharactersInNovel(novelId: string, characterIds: string[] | undefined): void {
    if (!characterIds) return;
    for (const characterId of characterIds) {
      const row = this.db
        .prepare("SELECT novel_id FROM characters WHERE id = ?;")
        .get(characterId) as { novel_id: string } | undefined;
      if (!row) {
        throw new Error(`服务的角色不存在：${characterId}`);
      }
      if (row.novel_id !== novelId) {
        throw new Error(`服务的角色属于其他小说，无法关联：${characterId}`);
      }
    }
  }

  close(): void {
    this.db.close();
  }
}

let defaultStore: ForeshadowStore | undefined;

/** 默认全局 store（懒加载，与其他 store 共享默认数据库连接） */
export function getDefaultForeshadowStore(): ForeshadowStore {
  defaultStore ??= new ForeshadowStore(getDefaultDatabase());
  return defaultStore;
}

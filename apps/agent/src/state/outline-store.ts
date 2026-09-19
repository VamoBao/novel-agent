import type { Database, SQLQueryBindings } from "bun:sqlite";
import {
  outlineNodePatchSchema,
  outlineNodeSchema,
  type OutlineNode,
  type OutlineNodePatch,
  type OutlineNodeStatus,
  type OutlineNodeType,
} from "@novel/shared";
import { DEFAULT_DB_PATH, getDefaultDatabase, openDatabase } from "./db";
import { generateUuidV7 } from "./id";

/** 数据库中的大纲节点记录：树节点 + 库表元信息（id 为 UUIDv7） */
export interface StoredOutlineNode {
  id: string;
  novelId: string;
  createdAt: string;
  updatedAt: string;
  node: OutlineNode;
}

export interface OutlineNodeInput {
  parentId?: string | null;
  type: OutlineNodeType;
  name: string;
  sort: number;
  /** 缺省 1，首次生成的节点即第一版 */
  version?: number;
  /** 缺省 true；提升新版本前须先把旧版本降级（唯一索引约束当前版本 sort） */
  isCurrentVersion?: boolean;
  status?: OutlineNodeStatus;
  documentId?: string | null;
}

/** 大纲树入库输入：部（根节点）→ 幕（子节点）两级；章为写作期节点，此处不建 */
export interface OutlineTreeInput {
  name: string;
  acts: ReadonlyArray<{ name: string }>;
}

/** outlines 表行结构（列名蛇形，is_current_version 存 0/1） */
interface OutlineRow {
  id: string;
  novel_id: string;
  parent_id: string | null;
  type: string;
  name: string;
  sort: number;
  version: number;
  is_current_version: number;
  status: string;
  document_id: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS = `
  id, novel_id, parent_id, type, name, sort, version, is_current_version,
  status, document_id, created_at, updated_at
`;

const INSERT_SQL = `
  INSERT INTO outlines (
    id, novel_id, parent_id, type, name, sort, version, is_current_version,
    status, document_id, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
`;

const GET_SQL = `
  SELECT ${COLUMNS} FROM outlines WHERE id = ?;
`;

/** 列表按「父级分组 + sort」排序，便于重组树；同父级多版本时版本号小的在前 */
const LIST_SQL = `
  SELECT ${COLUMNS} FROM outlines WHERE novel_id = ?
  ORDER BY COALESCE(parent_id, '') ASC, sort ASC, version ASC, id ASC;
`;

const LIST_CURRENT_SQL = `
  SELECT ${COLUMNS} FROM outlines WHERE novel_id = ? AND is_current_version = 1
  ORDER BY COALESCE(parent_id, '') ASC, sort ASC;
`;

const UPDATE_SQL = `
  UPDATE outlines
  SET name = ?, sort = ?, is_current_version = ?, status = ?, document_id = ?, updated_at = ?
  WHERE id = ?;
`;

function rowToStored(row: OutlineRow): StoredOutlineNode {
  return {
    id: row.id,
    novelId: row.novel_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // 列值经 schema 还原为大纲节点结构，读侧同样过 zod 校验（库内数据完整性兜底）
    node: outlineNodeSchema.parse({
      parentId: row.parent_id,
      type: row.type,
      name: row.name,
      sort: row.sort,
      version: row.version,
      isCurrentVersion: row.is_current_version === 1,
      status: row.status,
      documentId: row.document_id,
    }),
  };
}

/**
 * 大纲树持久化：按创作 ID 绑定存储部/幕/章节点。
 * 同一节点可有多个版本行并存；当前版本切换由调用方先降级旧版本再提升新版本，
 * 唯一索引保证同父级下各当前版本 sort 不重复。
 */
export class OutlineStore {
  /** 共享数据库连接构造（与其他 store 同库不同表） */
  constructor(private readonly db: Database) {}

  static open(path: string = DEFAULT_DB_PATH): OutlineStore {
    return new OutlineStore(openDatabase(path));
  }

  /** 写入大纲节点（先过 schema 校验，缺省 version=1/当前版本/status=planned） */
  addOutlineNode(novelId: string, input: OutlineNodeInput): StoredOutlineNode {
    const node = outlineNodeSchema.parse({
      parentId: input.parentId ?? null,
      type: input.type,
      name: input.name,
      sort: input.sort,
      version: input.version ?? 1,
      isCurrentVersion: input.isCurrentVersion ?? true,
      status: input.status ?? "planned",
      documentId: input.documentId ?? null,
    });
    const id = generateUuidV7();
    const now = new Date().toISOString();
    this.runGuarded(INSERT_SQL, [
      id,
      novelId,
      node.parentId,
      node.type,
      node.name,
      node.sort,
      node.version,
      node.isCurrentVersion ? 1 : 0,
      node.status,
      node.documentId,
      now,
      now,
    ], node);
    return this.getOutlineNodeOrThrow(id);
  }

  /** 取单个大纲节点；无记录返回 undefined */
  getOutlineNode(id: string): StoredOutlineNode | undefined {
    const row = this.db.prepare(GET_SQL).get(id) as OutlineRow | null;
    return row ? rowToStored(row) : undefined;
  }

  /** 取某本小说的大纲节点（按父级分组 + sort 排序）；currentOnly 只取各节点当前版本 */
  listOutlineNodes(
    novelId: string,
    options: { currentOnly?: boolean } = {},
  ): StoredOutlineNode[] {
    const sql = options.currentOnly ? LIST_CURRENT_SQL : LIST_SQL;
    const rows = this.db.prepare(sql).all(novelId) as OutlineRow[];
    return rows.map(rowToStored);
  }

  /** 部分更新（改名/排序/版本切换/状态/正文回填），自动盖章 updated_at */
  updateOutlineNode(id: string, patch: OutlineNodePatch): StoredOutlineNode {
    const current = this.getOutlineNode(id);
    if (!current) {
      throw new Error(`大纲节点不存在，无法更新：${id}`);
    }
    const validated = outlineNodePatchSchema.parse(patch);
    const next = outlineNodeSchema.parse({
      parentId: current.node.parentId,
      type: current.node.type,
      name: validated.name ?? current.node.name,
      sort: validated.sort ?? current.node.sort,
      version: current.node.version,
      isCurrentVersion: validated.isCurrentVersion ?? current.node.isCurrentVersion,
      status: validated.status ?? current.node.status,
      documentId:
        validated.documentId === undefined ? current.node.documentId : validated.documentId,
    });
    this.runGuarded(
      UPDATE_SQL,
      [
        next.name,
        next.sort,
        next.isCurrentVersion ? 1 : 0,
        next.status,
        next.documentId,
        new Date().toISOString(),
        id,
      ],
      next,
    );
    return this.getOutlineNodeOrThrow(id);
  }

  /**
   * 整棵大纲树入库（事务原子）：部为根节点（sort 从 1 递增）、幕为其子节点
   * （sort 按所属部从 1 递增），全部为 version=1 / 当前版本 / planned。
   * 任一节点失败整树回滚，不留半棵树。
   */
  saveOutlineTree(novelId: string, parts: readonly OutlineTreeInput[]): StoredOutlineNode[] {
    if (parts.length === 0) {
      throw new Error("大纲树为空，拒绝入库");
    }
    if (parts.some((p) => p.acts.length === 0)) {
      throw new Error("大纲树每部至少一幕，拒绝入库");
    }
    const saveTree = this.db.transaction((tree: readonly OutlineTreeInput[]) => {
      const created: StoredOutlineNode[] = [];
      tree.forEach((part, partIndex) => {
        const partNode = this.addOutlineNode(novelId, {
          type: "part",
          name: part.name,
          sort: partIndex + 1,
        });
        created.push(partNode);
        part.acts.forEach((act, actIndex) => {
          created.push(
            this.addOutlineNode(novelId, {
              type: "act",
              name: act.name,
              sort: actIndex + 1,
              parentId: partNode.id,
            }),
          );
        });
      });
      return created;
    });
    return saveTree(parts);
  }

  close(): void {
    this.db.close();
  }

  /** 唯一索引违规转译为可读错误（sort 冲突场景），其余原样抛出 */
  private runGuarded(sql: string, params: SQLQueryBindings[], node: OutlineNode): void {
    try {
      this.db.prepare(sql).run(...params);
    } catch (error) {
      if (error instanceof Error && error.message.includes("idx_outlines_current_sort")) {
        throw new Error(
          `同一父级下当前版本的 sort 已被占用（parent=${node.parentId ?? "根"}，sort=${node.sort}）`,
          { cause: error },
        );
      }
      throw error;
    }
  }

  private getOutlineNodeOrThrow(id: string): StoredOutlineNode {
    const stored = this.getOutlineNode(id);
    if (!stored) {
      throw new Error(`大纲节点写入后读取失败：${id}`);
    }
    return stored;
  }
}

let defaultStore: OutlineStore | undefined;

/** 默认全局 store（懒加载，与其他 store 共享默认数据库连接） */
export function getDefaultOutlineStore(): OutlineStore {
  defaultStore ??= new OutlineStore(getDefaultDatabase());
  return defaultStore;
}

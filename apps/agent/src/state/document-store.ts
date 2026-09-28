import type { Database } from "bun:sqlite";
import { documentSchema, type Document } from "@novel/shared";
import { DEFAULT_DB_PATH, getDefaultDatabase, openDatabase } from "./db";
import { generateUuidV7 } from "./id";

/** outlines 表行中与章节点绑定相关的列（保存正文时同事务回写） */
interface ChapterRow {
  novel_id: string;
  type: string;
  name: string;
}

/** documents 表行结构（列名蛇形；file_path 为正文文件相对路径，内容不进库） */
interface DocumentRow {
  id: string;
  novel_id: string;
  chapter_id: string;
  file_path: string;
  word_count: number;
  created_at: string;
  updated_at: string;
}

const COLUMNS = "id, novel_id, chapter_id, file_path, word_count, created_at, updated_at";

const LIST_SQL = `
  SELECT ${COLUMNS} FROM documents WHERE novel_id = ? ORDER BY chapter_id ASC;
`;

/** 列值经 schema 还原（库内数据完整性兜底，与其他 store 的读侧校验一致） */
function rowToDocument(row: DocumentRow): Document {
  return documentSchema.parse({
    id: row.id,
    novelId: row.novel_id,
    chapterId: row.chapter_id,
    filePath: row.file_path,
    wordCount: row.word_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

/**
 * 章节正文持久化（元数据）：documents 表一章一份（chapter_id 唯一索引保证），
 * **正文内容存文件系统**（output/document-writer 写 `<output>/<小说名>/<部名>/<章名>.md`），
 * 库内只留 file_path（相对 output 根）与字数。`saveChapterDocument` 单事务完成
 * 「插入元数据 + 章节点回写 document_id 并置 status=completed」——文件先写、
 * 库后入（由工作流编排，库失败时回滚删除文件），两处指向同一份文件。
 */
export class DocumentStore {
  /** 共享数据库连接构造（与其他 store 同库不同表） */
  constructor(private readonly db: Database) {}

  static open(path: string = DEFAULT_DB_PATH): DocumentStore {
    return new DocumentStore(openDatabase(path));
  }

  /**
   * 登记章正文元数据并绑定章节点（事务原子）：校验目标为该小说的 chapter 节点、
   * 尚无正文（一章一份，重新生成为后续需求）且 filePath 非空；
   * 同事务 UPDATE outlines 回写 document_id + status='completed'。
   */
  saveChapterDocument(
    novelId: string,
    chapterNodeId: string,
    filePath: string,
    wordCount: number,
  ): Document {
    const chapter = this.db
      .prepare("SELECT novel_id, type, name FROM outlines WHERE id = ?;")
      .get(chapterNodeId) as ChapterRow | null;
    if (!chapter || chapter.novel_id !== novelId) {
      throw new Error(`章节节点不存在或不属于该小说：${chapterNodeId}`);
    }
    if (chapter.type !== "chapter") {
      throw new Error(`所选节点不是章（类型为 ${chapter.type}），无法保存正文：${chapter.name}`);
    }
    if (
      this.db.prepare("SELECT 1 FROM documents WHERE chapter_id = ?;").get(chapterNodeId)
    ) {
      throw new Error(`章「${chapter.name}」已有正文，重新生成为后续需求`);
    }
    const validated = documentSchema.pick({ filePath: true, wordCount: true }).parse({
      filePath,
      wordCount,
    });
    const id = generateUuidV7();
    const now = new Date().toISOString();
    const save = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO documents (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?);`,
        )
        .run(id, novelId, chapterNodeId, validated.filePath, validated.wordCount, now, now);
      this.db
        .prepare(
          "UPDATE outlines SET document_id = ?, status = 'completed', updated_at = ? WHERE id = ?;",
        )
        .run(id, now, chapterNodeId);
    });
    save();
    return this.getDocumentByChapterOrThrow(chapterNodeId);
  }

  /** 按章节点取正文元数据；无记录返回 undefined */
  getDocumentByChapter(chapterNodeId: string): Document | undefined {
    const row = this.db
      .prepare(`SELECT ${COLUMNS} FROM documents WHERE chapter_id = ?;`)
      .get(chapterNodeId) as DocumentRow | null;
    return row ? rowToDocument(row) : undefined;
  }

  /** 某本小说的全部正文元数据（章节点预览按 chapterId 取用，内容由查询层读文件） */
  listDocuments(novelId: string): Document[] {
    const rows = this.db.prepare(LIST_SQL).all(novelId) as DocumentRow[];
    return rows.map(rowToDocument);
  }

  /** 批量更新正文文件路径（事务原子）：小说改名后文件迁移的库内联动 */
  updateFilePaths(updates: ReadonlyArray<{ id: string; filePath: string }>): void {
    if (updates.length === 0) return;
    const update = this.db.transaction((list: ReadonlyArray<{ id: string; filePath: string }>) => {
      const stmt = this.db.prepare(
        "UPDATE documents SET file_path = ?, updated_at = ? WHERE id = ?;",
      );
      const now = new Date().toISOString();
      for (const item of list) {
        const { filePath } = documentSchema.pick({ filePath: true }).parse(item);
        stmt.run(filePath, now, item.id);
      }
    });
    update(updates);
  }

  close(): void {
    this.db.close();
  }

  private getDocumentByChapterOrThrow(chapterNodeId: string): Document {
    const document = this.getDocumentByChapter(chapterNodeId);
    if (!document) {
      throw new Error(`正文写入后读取失败（章节点 ${chapterNodeId}）`);
    }
    return document;
  }
}

let defaultStore: DocumentStore | undefined;

/** 默认全局 store（懒加载，与其他 store 共享默认数据库连接） */
export function getDefaultDocumentStore(): DocumentStore {
  defaultStore ??= new DocumentStore(getDefaultDatabase());
  return defaultStore;
}

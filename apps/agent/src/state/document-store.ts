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

/** documents 表行结构（列名蛇形；file_path 为正文文件绝对路径，内容不进库） */
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
 * **正文内容存文件系统**（output/document-writer 写 `<output>/<小说ID>/<部名>/<章名>.md`），
 * 库内只留 file_path（绝对路径，历史旧行可能存相对路径由读取层兼容解析）与字数。
 * `saveChapterDocument` 单事务完成「插入元数据 + 章节点回写 document_id 并置
 * status=completed」——文件先写、库后入（由工作流编排，库失败时回滚删除文件），
 * 两处指向同一份文件。
 */
export class DocumentStore {
  /** 共享数据库连接构造（与其他 store 同库不同表） */
  constructor(private readonly db: Database) {}

  static open(path: string = DEFAULT_DB_PATH): DocumentStore {
    return new DocumentStore(openDatabase(path));
  }

  /**
   * 登记章正文元数据并绑定章节点（事务原子）：校验目标为该小说的 chapter 节点、
   * 尚无正文（一章一份）且 filePath 非空；
   * 同事务 UPDATE outlines 回写 document_id + status='completed'。
   */
  saveChapterDocument(
    novelId: string,
    chapterNodeId: string,
    filePath: string,
    wordCount: number,
  ): Document {
    const chapter = this.requireChapter(novelId, chapterNodeId);
    if (
      this.db.prepare("SELECT 1 FROM documents WHERE chapter_id = ?;").get(chapterNodeId)
    ) {
      throw new Error(`章「${chapter.name}」已有正文，请走重新生成`);
    }
    const validated = this.validatePayload(filePath, wordCount);
    const insert = this.db.transaction(() => {
      this.insertDocumentRow(novelId, chapterNodeId, validated);
      this.bindChapterNode(chapterNodeId);
    });
    insert();
    return this.getDocumentByChapterOrThrow(chapterNodeId);
  }

  /**
   * 重新生成场景的覆盖替换（事务原子）：删旧 documents 行 → 插新行 →
   * 同事务 UPDATE outlines 回写 document_id + status='completed'；
   * 无旧行时等同首次保存。目标校验同 save（不拒已有正文）。
   * 新旧文件的清理时序由调用方编排（新文件先写、事务提交后删旧文件、
   * 失败回滚删新文件——本方法只保证库行原子切换）。
   */
  replaceChapterDocument(
    novelId: string,
    chapterNodeId: string,
    filePath: string,
    wordCount: number,
  ): Document {
    this.requireChapter(novelId, chapterNodeId);
    const validated = this.validatePayload(filePath, wordCount);
    const replace = this.db.transaction(() => {
      this.db.prepare("DELETE FROM documents WHERE chapter_id = ?;").run(chapterNodeId);
      this.insertDocumentRow(novelId, chapterNodeId, validated);
      this.bindChapterNode(chapterNodeId);
    });
    replace();
    return this.getDocumentByChapterOrThrow(chapterNodeId);
  }

  /** 章节点存在性 / 归属 / 类型校验（save 与 replace 共用），返回行供错误文案取章名 */
  private requireChapter(novelId: string, chapterNodeId: string): ChapterRow {
    const chapter = this.db
      .prepare("SELECT novel_id, type, name FROM outlines WHERE id = ?;")
      .get(chapterNodeId) as ChapterRow | null;
    if (!chapter || chapter.novel_id !== novelId) {
      throw new Error(`章节节点不存在或不属于该小说：${chapterNodeId}`);
    }
    if (chapter.type !== "chapter") {
      throw new Error(`所选节点不是章（类型为 ${chapter.type}），无法保存正文：${chapter.name}`);
    }
    return chapter;
  }

  /** filePath 非空与字数经 schema 校验（save 与 replace 共用） */
  private validatePayload(filePath: string, wordCount: number) {
    return documentSchema.pick({ filePath: true, wordCount: true }).parse({
      filePath,
      wordCount,
    });
  }

  private insertDocumentRow(
    novelId: string,
    chapterNodeId: string,
    validated: { filePath: string; wordCount: number },
  ): void {
    const id = generateUuidV7();
    const now = new Date().toISOString();
    this.db
      .prepare(`INSERT INTO documents (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?);`)
      .run(id, novelId, chapterNodeId, validated.filePath, validated.wordCount, now, now);
  }

  private bindChapterNode(chapterNodeId: string): void {
    this.db
      .prepare(
        "UPDATE outlines SET document_id = (SELECT id FROM documents WHERE chapter_id = ?), status = 'completed', updated_at = ? WHERE id = ?;",
      )
      .run(chapterNodeId, new Date().toISOString(), chapterNodeId);
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

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

/** documents 表行结构（列名蛇形，word_count 为不含空白字符的字数） */
interface DocumentRow {
  id: string;
  novel_id: string;
  chapter_id: string;
  content: string;
  word_count: number;
  created_at: string;
  updated_at: string;
}

const COLUMNS = "id, novel_id, chapter_id, content, word_count, created_at, updated_at";

const LIST_SQL = `
  SELECT ${COLUMNS} FROM documents WHERE novel_id = ? ORDER BY chapter_id ASC;
`;

/** 列值经 schema 还原（库内数据完整性兜底，与其他 store 的读侧校验一致） */
function rowToDocument(row: DocumentRow): Document {
  return documentSchema.parse({
    id: row.id,
    novelId: row.novel_id,
    chapterId: row.chapter_id,
    content: row.content,
    wordCount: row.word_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

/** 正文字数：不含任何空白字符（中文正文以汉字计的近似口径） */
export function countWords(content: string): number {
  return content.replace(/\s+/g, "").length;
}

/**
 * 章节正文持久化：documents 表一章一份（chapter_id 唯一索引保证）。
 * `saveChapterDocument` 单事务完成「插入正文 + 章节点回写 document_id 并置
 * status=completed」——两处指向同一份数据，入库原子维护，任一步失败整体回滚。
 */
export class DocumentStore {
  /** 共享数据库连接构造（与其他 store 同库不同表） */
  constructor(private readonly db: Database) {}

  static open(path: string = DEFAULT_DB_PATH): DocumentStore {
    return new DocumentStore(openDatabase(path));
  }

  /**
   * 保存章正文并绑定章节点（事务原子）：校验目标为该小说的 chapter 节点、
   * 尚无正文（一章一份，重新生成为后续需求）且内容非空；
   * 同事务 UPDATE outlines 回写 document_id + status='completed'。
   */
  saveChapterDocument(novelId: string, chapterNodeId: string, content: string): Document {
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
    const validated = documentSchema.pick({ content: true }).parse({ content });
    const id = generateUuidV7();
    const now = new Date().toISOString();
    const save = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO documents (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?);`,
        )
        .run(
          id,
          novelId,
          chapterNodeId,
          validated.content,
          countWords(validated.content),
          now,
          now,
        );
      this.db
        .prepare(
          "UPDATE outlines SET document_id = ?, status = 'completed', updated_at = ? WHERE id = ?;",
        )
        .run(id, now, chapterNodeId);
    });
    save();
    return this.getDocumentByChapterOrThrow(chapterNodeId);
  }

  /** 按章节点取正文；无记录返回 undefined */
  getDocumentByChapter(chapterNodeId: string): Document | undefined {
    const row = this.db
      .prepare(`SELECT ${COLUMNS} FROM documents WHERE chapter_id = ?;`)
      .get(chapterNodeId) as DocumentRow | null;
    return row ? rowToDocument(row) : undefined;
  }

  /** 某本小说的全部正文（章节点预览按 chapterId 取用） */
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

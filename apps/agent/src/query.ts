import { unlinkSync } from "node:fs";
import { join } from "node:path";
import {
  characterEntrySchema,
  characterSchema,
  novelDeletedResultSchema,
  novelDetailSchema,
  novelListItemSchema,
  type Character,
  type CharacterEntry,
  type DocumentEntry,
  type NovelDeletedResult,
  type NovelDetail,
  type NovelListItem,
  type OutlineNodeEntry,
} from "@novel/shared";
import { CharacterStore, type StoredCharacter } from "./state/character-store";
import { openDatabase } from "./state/db";
import { NovelStore, type NovelRecord } from "./state/novel-store";
import { OutlineStore } from "./state/outline-store";
import { WorldviewStore } from "./state/worldview-store";
import { DocumentStore } from "./state/document-store";
import { OUTPUT_DIR, outlineFilePath } from "./output/outline-writer";
import {
  moveDocumentArtifact,
  readDocumentArtifact,
  removeDocumentArtifact,
  sanitizePathSegment,
} from "./output/document-writer";

/**
 * 库查询与管理入口（一次性 CLI）：Electron 客户端等宿主经
 * `bun run apps/agent/src/query.ts <命令> [参数]` 调用——
 * stdout 输出单行 JSON（结构见 @novel/shared query.ts），失败走 stderr 并非零退出。
 * 与 headless.ts 的长驻问答协议相区分：无会话状态、即起即退。
 *
 * 命令一览：
 * - 查询：`list`（全部小说，置顶优先）/ `get <novelId>`（单本全量资料，
 *   大纲读 outlines 表当前版本节点、正文读 documents 表并在查询时读文件拼
 *   content——output 产物仅供留存，不再决定浏览读取）
 * - 管理：`rename <novelId> <name>`（连带迁移按小说名落盘的正文文件）/ `pin|unpin <novelId>`
 *   / `favorite|unfavorite <novelId>` / `delete <novelId>`（级联删除关联数据并清理
 *   output 产物——大纲 JSON 与正文文件）
 *   / `add-character <novelId> <角色卡JSON>`（新增角色，version=1）
 *   / `update-character <novelId> <characterId> <角色卡JSON>`（版本化编辑角色，旧卡快照归档）
 *
 * 连接统一走 openDatabase：4→5 起有保数据迁移，纯浏览路径也须能完成版本升级
 * （readonly 连接会在旧库上因缺列报错）。
 */

function toListItem(record: NovelRecord): NovelListItem {
  return novelListItemSchema.parse({
    id: record.id,
    name: record.name,
    pinned: record.pinned,
    favorite: record.favorite,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
}

/** list 载荷：全部小说（置顶优先，组内按创建时间倒序） */
export function buildNovelList(db: ReturnType<typeof openDatabase>): NovelListItem[] {
  return new NovelStore(db).listNovels().map(toListItem);
}

/** get 载荷：单本小说全量资料；小说不存在抛错。章节正文的 content 在查询时
 *  从 output 根读文件拼装（内容不进库），文件缺失 / 被移动为 null（客户端占位） */
export function buildNovelDetail(
  db: ReturnType<typeof openDatabase>,
  novelId: string,
  outputDir: string = OUTPUT_DIR,
): NovelDetail {
  const novel = new NovelStore(db).getNovel(novelId);
  if (!novel) {
    throw new Error(`小说不存在：${novelId}`);
  }
  const worldview = new WorldviewStore(db).getWorldview(novelId)?.worldview ?? null;
  const characters = new CharacterStore(db)
    .listCharacters(novelId)
    .map((stored) => ({ id: stored.id, version: stored.version, ...stored.character }));
  const outlineNodes: OutlineNodeEntry[] = new OutlineStore(db)
    .listOutlineNodes(novelId, { currentOnly: true })
    .map((stored) => ({
      id: stored.id,
      parentId: stored.node.parentId,
      type: stored.node.type,
      name: stored.node.name,
      sort: stored.node.sort,
      summary: stored.node.summary,
      keyPlotPoints: stored.node.keyPlotPoints,
    }));
  const documents: DocumentEntry[] = new DocumentStore(db)
    .listDocuments(novelId)
    .map(({ id, chapterId, filePath, wordCount, updatedAt }) => ({
      id,
      chapterId,
      filePath,
      wordCount,
      updatedAt,
      content: readDocumentArtifact(filePath, outputDir),
    }));
  return novelDetailSchema.parse({
    novel: toListItem(novel),
    worldview,
    characters,
    outlineNodes,
    documents,
  });
}

/** rename 载荷：更新名称（trim 非空校验），返回更新后列表项。
 *  正文按小说名落盘层级存储，改名连带迁移该小说的全部正文文件
 *  （逐文件移动到新名首段，库内 file_path 同步；文件缺失时只更新路径） */
export function renameNovel(
  db: ReturnType<typeof openDatabase>,
  novelId: string,
  name: string,
  outputDir: string = OUTPUT_DIR,
): NovelListItem {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error("小说名称不能为空");
  }
  const documentStore = new DocumentStore(db);
  const documents = documentStore.listDocuments(novelId);
  const updated = new NovelStore(db).updateNovel(novelId, { name: trimmed });
  if (documents.length > 0) {
    const newSegment = `${sanitizePathSegment(trimmed, "未命名小说")}-${novelId.slice(0, 8)}`;
    const moves = documents
      .map((document) => {
        const segments = document.filePath.split(/[\\/]/);
        if (segments.length < 2) return null;
        const rest = segments.slice(1).join("/");
        return { id: document.id, from: document.filePath, to: join(newSegment, rest) };
      })
      .filter((move): move is { id: string; from: string; to: string } => move !== null);
    for (const move of moves) {
      moveDocumentArtifact(move.from, move.to, outputDir);
    }
    documentStore.updateFilePaths(moves.map(({ id, to }) => ({ id, filePath: to })));
  }
  return toListItem(updated);
}

/** 置顶 / 收藏载荷：置位后返回更新后列表项 */
export function setNovelPinned(
  db: ReturnType<typeof openDatabase>,
  novelId: string,
  pinned: boolean,
): NovelListItem {
  return toListItem(new NovelStore(db).setNovelPinned(novelId, pinned));
}

export function setNovelFavorite(
  db: ReturnType<typeof openDatabase>,
  novelId: string,
  favorite: boolean,
): NovelListItem {
  return toListItem(new NovelStore(db).setNovelFavorite(novelId, favorite));
}

/** delete 载荷：级联删除关联数据 + best-effort 清理 output 产物（大纲 JSON 与
 *  章节正文文件——正文文件按 documents 登记的 file_path 逐一删除，缺失不报错） */
export function deleteNovel(
  db: ReturnType<typeof openDatabase>,
  novelId: string,
  outputDir: string = OUTPUT_DIR,
): NovelDeletedResult {
  const documents = new DocumentStore(db).listDocuments(novelId);
  new NovelStore(db).deleteNovel(novelId);
  for (const document of documents) {
    removeDocumentArtifact(document.filePath, outputDir);
  }
  try {
    unlinkSync(outlineFilePath(novelId, outputDir));
  } catch {
    // 产物不存在（未生成 / 已删）不算失败
  }
  return novelDeletedResultSchema.parse({ deleted: novelId });
}

/** 角色卡 JSON → schema 校验后的 Character（库表管理命令共用；错误信息带首个 issue 定位） */
function parseCharacterJson(json: string): Character {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    throw new Error(`角色卡 JSON 解析失败：${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
  const result = characterSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(
      `角色卡数据不合法（${issue?.path.join(".") || "根"}）：${issue?.message ?? "未知问题"}`,
    );
  }
  return result.data;
}

function toCharacterEntry(stored: StoredCharacter): CharacterEntry {
  return characterEntrySchema.parse({ id: stored.id, version: stored.version, ...stored.character });
}

/** add-character 载荷：入库新角色（version=1，无历史快照），返回角色条目 */
export function addCharacterEntry(
  db: ReturnType<typeof openDatabase>,
  novelId: string,
  characterJson: string,
): CharacterEntry {
  if (!new NovelStore(db).getNovel(novelId)) {
    throw new Error(`小说不存在，无法新增角色：${novelId}`);
  }
  const character = parseCharacterJson(characterJson);
  return toCharacterEntry(new CharacterStore(db).addCharacter(novelId, character));
}

/** update-character 载荷：版本化更新角色（旧卡快照归档、version+1），返回更新后条目 */
export function updateCharacterEntry(
  db: ReturnType<typeof openDatabase>,
  novelId: string,
  characterId: string,
  characterJson: string,
): CharacterEntry {
  const character = parseCharacterJson(characterJson);
  return toCharacterEntry(new CharacterStore(db).updateCharacter(novelId, characterId, character));
}

function main(argv: string[]): number {
  const [command, novelId, ...rest] = argv;
  const db = openDatabase();
  try {
    switch (command) {
      case "list":
        process.stdout.write(`${JSON.stringify(buildNovelList(db))}\n`);
        return 0;
      case "get":
        if (!novelId) break;
        process.stdout.write(`${JSON.stringify(buildNovelDetail(db, novelId))}\n`);
        return 0;
      case "rename":
        if (!novelId || rest.length === 0) break;
        process.stdout.write(`${JSON.stringify(renameNovel(db, novelId, rest.join(" ")))}\n`);
        return 0;
      case "pin":
      case "unpin":
        if (!novelId) break;
        process.stdout.write(`${JSON.stringify(setNovelPinned(db, novelId, command === "pin"))}\n`);
        return 0;
      case "favorite":
      case "unfavorite":
        if (!novelId) break;
        process.stdout.write(
          `${JSON.stringify(setNovelFavorite(db, novelId, command === "favorite"))}\n`,
        );
        return 0;
      case "delete":
        if (!novelId) break;
        process.stdout.write(`${JSON.stringify(deleteNovel(db, novelId))}\n`);
        return 0;
      case "add-character":
        if (!novelId || rest.length !== 1 || !rest[0]) break;
        process.stdout.write(`${JSON.stringify(addCharacterEntry(db, novelId, rest[0]))}\n`);
        return 0;
      case "update-character":
        if (!novelId || rest.length !== 2 || !rest[0] || !rest[1]) break;
        process.stdout.write(`${JSON.stringify(updateCharacterEntry(db, novelId, rest[0], rest[1]))}\n`);
        return 0;
      default:
        break;
    }
  } finally {
    db.close();
  }
  process.stderr.write(
    "用法：bun run apps/agent/src/query.ts <list | get <id> | rename <id> <name> | pin <id> | unpin <id> | favorite <id> | unfavorite <id> | delete <id> | add-character <novelId> <角色卡JSON> | update-character <novelId> <characterId> <角色卡JSON>>\n",
  );
  return 1;
}

if (import.meta.main) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

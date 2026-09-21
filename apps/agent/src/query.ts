import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import {
  novelDetailSchema,
  novelListItemSchema,
  outlineSchema,
  type NovelDetail,
  type NovelListItem,
  type Outline,
} from "@novel/shared";
import { CharacterStore } from "./state/character-store";
import { DEFAULT_DB_PATH } from "./state/db";
import { NovelStore, type NovelRecord } from "./state/novel-store";
import { WorldviewStore } from "./state/worldview-store";
import { OUTPUT_DIR, outlineFilePath } from "./output/outline-writer";

/**
 * 库查询入口（一次性 CLI）：Electron 客户端等宿主经
 * `bun run apps/agent/src/query.ts <list | get <novelId>>` 调用——
 * stdout 输出单行 JSON（结构见 @novel/shared query.ts），失败走 stderr 并非零退出。
 * 与 headless.ts 的长驻问答协议相区分：无会话状态、即起即退；
 * 以只读连接打开库，绝不触发 openDatabase 的建表 / 版本重建逻辑。
 */

function toListItem(record: NovelRecord): NovelListItem {
  return novelListItemSchema.parse({
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
}

/** 只读连接；库文件不存在（从未创作过）返回 null，由调用方输出空结果 */
function openReadonly(path: string = DEFAULT_DB_PATH): Database | null {
  if (!existsSync(path)) return null;
  return new Database(path, { readonly: true });
}

/** 大纲产物读取：output/<id>.json 缺失或结构不合法一律视为未生成 */
function readOutlineArtifact(novelId: string, outputDir: string): Outline | null {
  let file: string;
  try {
    file = outlineFilePath(novelId, outputDir);
  } catch {
    return null;
  }
  try {
    const parsed = outlineSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** list 载荷：全部小说（新创建的在前） */
export function buildNovelList(db: Database): NovelListItem[] {
  return new NovelStore(db).listNovels().map(toListItem);
}

/** get 载荷：单本小说全量资料；小说不存在抛错 */
export function buildNovelDetail(
  db: Database,
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
    .map((stored) => ({ id: stored.id, ...stored.character }));
  return novelDetailSchema.parse({
    novel: toListItem(novel),
    worldview,
    characters,
    outline: readOutlineArtifact(novelId, outputDir),
  });
}

function main(argv: string[]): number {
  const [command, novelId] = argv;
  if (command === "list") {
    const db = openReadonly();
    const payload = db ? buildNovelList(db) : [];
    db?.close();
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    return 0;
  }
  if (command === "get" && novelId) {
    const db = openReadonly();
    if (!db) {
      process.stderr.write(`小说不存在：${novelId}（数据库尚未创建）\n`);
      return 1;
    }
    try {
      process.stdout.write(`${JSON.stringify(buildNovelDetail(db, novelId))}\n`);
    } finally {
      db.close();
    }
    return 0;
  }
  process.stderr.write("用法：bun run apps/agent/src/query.ts <list | get <novelId>>\n");
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

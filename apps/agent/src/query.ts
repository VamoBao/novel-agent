import { unlinkSync } from "node:fs";
import {
  novelDeletedResultSchema,
  novelDetailSchema,
  novelListItemSchema,
  type NovelDeletedResult,
  type NovelDetail,
  type NovelListItem,
  type OutlineNodeEntry,
} from "@novel/shared";
import { CharacterStore } from "./state/character-store";
import { openDatabase } from "./state/db";
import { NovelStore, type NovelRecord } from "./state/novel-store";
import { OutlineStore } from "./state/outline-store";
import { WorldviewStore } from "./state/worldview-store";
import { OUTPUT_DIR, outlineFilePath } from "./output/outline-writer";

/**
 * 库查询与管理入口（一次性 CLI）：Electron 客户端等宿主经
 * `bun run apps/agent/src/query.ts <命令> [参数]` 调用——
 * stdout 输出单行 JSON（结构见 @novel/shared query.ts），失败走 stderr 并非零退出。
 * 与 headless.ts 的长驻问答协议相区分：无会话状态、即起即退。
 *
 * 命令一览：
 * - 查询：`list`（全部小说，置顶优先）/ `get <novelId>`（单本全量资料，
 *   大纲读 outlines 表当前版本节点——output 产物仅供留存，不再决定浏览读取）
 * - 管理：`rename <novelId> <name>` / `pin|unpin <novelId>` / `favorite|unfavorite <novelId>`
 *   / `delete <novelId>`（级联删除关联数据并清理 output 产物）
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

/** get 载荷：单本小说全量资料；小说不存在抛错 */
export function buildNovelDetail(
  db: ReturnType<typeof openDatabase>,
  novelId: string,
): NovelDetail {
  const novel = new NovelStore(db).getNovel(novelId);
  if (!novel) {
    throw new Error(`小说不存在：${novelId}`);
  }
  const worldview = new WorldviewStore(db).getWorldview(novelId)?.worldview ?? null;
  const characters = new CharacterStore(db)
    .listCharacters(novelId)
    .map((stored) => ({ id: stored.id, ...stored.character }));
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
  return novelDetailSchema.parse({
    novel: toListItem(novel),
    worldview,
    characters,
    outlineNodes,
  });
}

/** rename 载荷：更新名称（trim 非空校验），返回更新后列表项 */
export function renameNovel(db: ReturnType<typeof openDatabase>, novelId: string, name: string): NovelListItem {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error("小说名称不能为空");
  }
  return toListItem(new NovelStore(db).updateNovel(novelId, { name: trimmed }));
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

/** delete 载荷：级联删除四表关联数据 + best-effort 清理 output 产物 */
export function deleteNovel(
  db: ReturnType<typeof openDatabase>,
  novelId: string,
  outputDir: string = OUTPUT_DIR,
): NovelDeletedResult {
  new NovelStore(db).deleteNovel(novelId);
  try {
    unlinkSync(outlineFilePath(novelId, outputDir));
  } catch {
    // 产物不存在（未生成 / 已删）不算失败
  }
  return novelDeletedResultSchema.parse({ deleted: novelId });
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
      default:
        break;
    }
  } finally {
    db.close();
  }
  process.stderr.write(
    "用法：bun run apps/agent/src/query.ts <list | get <id> | rename <id> <name> | pin <id> | unpin <id> | favorite <id> | unfavorite <id> | delete <id>>\n",
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

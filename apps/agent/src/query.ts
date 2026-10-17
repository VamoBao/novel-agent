import { unlinkSync } from "node:fs";
import { WorkflowRunStore } from "./state/workflow-run-store";
import {
  characterEntrySchema,
  characterMigrationEntrySchema,
  characterMigrationPatchSchema,
  characterSchema,
  foreshadowSchema,
  newCharacterMigrationSchema,
  saveCharacterMigrationSchema,
  novelDeletedResultSchema,
  novelDetailSchema,
  novelListItemSchema,
  novelWritingPrefsSchema,
  styleReferenceSchema,
  type Character,
  type CharacterEntry,
  type CharacterMigrationEntry,
  type CharacterMigrationPatch,
  type DocumentEntry,
  type Foreshadow,
  type ForeshadowEntry,
  type ForeshadowPatch,
  type LocationEntry,
  type NewCharacterMigration,
  type SaveCharacterMigration,
  type NovelDeletedResult,
  type NovelDetail,
  type NovelListItem,
  type OutlineNodeEntry,
  type StyleReference,
  type StyleReferenceEntry,
} from "@novel/shared";
import { CharacterStore, type StoredCharacter } from "./state/character-store";
import { CharacterMigrationStore, type StoredCharacterMigration } from "./state/migration-store";
import { openDatabase } from "./state/db";
import { NovelStore, type NovelRecord } from "./state/novel-store";
import { OutlineStore } from "./state/outline-store";
import { WorldviewStore } from "./state/worldview-store";
import { DocumentStore } from "./state/document-store";
import { ForeshadowStore, type StoredForeshadow } from "./state/foreshadow-store";
import { LocationStore } from "./state/location-store";
import { StyleReferenceStore } from "./state/style-reference-store";
import { OUTPUT_DIR, outlineFilePath } from "./output/outline-writer";
import { readDocumentArtifact, removeDocumentArtifact } from "./output/document-writer";

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
 *   / `set-writing-prefs <novelId> <偏好JSON>`（写作偏好小说级覆盖：篇幅 min/max +
 *   文风合格线三项全量替换，null=清空回落系统设置）
 *   / `add-character <novelId> <角色卡JSON>`（新增角色，version=1）
 *   / `update-foreshadow <novelId> <foreshadowId> <伏笔JSON>`（patch 语义编辑伏笔）
 *   / `add-migration <novelId> <characterId> <迁移JSON>`（新建角色迁移草案，旧值服务端派生）
 *   / `save-migration <novelId> <characterId> <提交JSON>`（原子保存新建/编辑与可选确认）
 *   / `update-migration <novelId> <migrationId> <patchJSON>`（patch 编辑迁移）
 *   / `confirm-migration <novelId> <migrationId>`（确认生效：必填校验 + 旧值重解析 + 区间校验）
 *   / `cancel-migration <novelId> <migrationId>`（取消迁移；已确认且有后续依赖时拒绝）
 *   / `add-style <novelId> <文风JSON>`（新增参考文风，enabled 缺省启用）
 *   / `update-style <novelId> <styleId> <文风JSON>`（全量编辑参考文风：名字/内容/启用开关）
 *   / `delete-style <styleId>`（删除参考文风）
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
    .map((stored) => toCharacterEntry(stored));
  // 角色迁移：全量行（按角色入库序 + 序号升序），角色卡预览的迁移清单取用
  const migrations: CharacterMigrationEntry[] = new CharacterMigrationStore(db)
    .listMigrations(novelId)
    .map(toMigrationEntry);
  const migrationVersions = migrations.flatMap((migration) =>
    new CharacterMigrationStore(db).listMigrationVersions(migration.id),
  );
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
      characterIds: stored.node.characterIds,
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
  // 伏笔条目：foreshadows 表全量行（按入库顺序），章卡按 appearChapterId / recoverChapterIds 取用
  const foreshadows: ForeshadowEntry[] = new ForeshadowStore(db)
    .listForeshadows(novelId)
    .map(toForeshadowEntry);
  // 地点条目：locations 表全量行（按入库顺序），结构树地点组取用
  const locations: LocationEntry[] = new LocationStore(db)
    .listLocations(novelId)
    .map((stored) => ({ id: stored.id, ...stored.location }));
  // 参考文风条目：style_references 表全量行（按入库顺序），结构树文风组与正文生成注入取用
  const styleReferences: StyleReferenceEntry[] = new StyleReferenceStore(db)
    .listStyleReferences(novelId)
    .map(toStyleReferenceEntry);
  return novelDetailSchema.parse({
    pendingRuns: new WorkflowRunStore(db).listPending(novelId).map((run) => ({
      id: run.id, kind: run.kind, targetId: run.targetId, status: run.status,
      error: run.error, updatedAt: run.updatedAt,
    })),
    novel: {
      ...toListItem(novel),
      genre: novel.genre,
      audience: novel.audience,
      coreConflict: novel.coreConflict,
      chapterLengthMin: novel.chapterLengthMin,
      chapterLengthMax: novel.chapterLengthMax,
      stylePassScore: novel.stylePassScore,
    },
    worldview,
    characters,
    migrations,
    migrationVersions,
    outlineNodes,
    documents,
    foreshadows,
    locations,
    styleReferences,
  });
}

/** rename 载荷：更新名称（trim 非空校验），返回更新后列表项。
 *  正文按小说 ID 落盘（顶层文件夹即创作 ID，file_path 为绝对路径），改名零文件联动；
 *  历史相对路径行（小说名-ID 结构）也不再移动——绝对化迁移已按文件真实位置回填 */
export function renameNovel(
  db: ReturnType<typeof openDatabase>,
  novelId: string,
  name: string,
): NovelListItem {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error("小说名称不能为空");
  }
  const updated = new NovelStore(db).updateNovel(novelId, { name: trimmed });
  return toListItem(updated);
}

/** 写作偏好载荷：全量替换小说级覆盖（三项 null=清空，回落系统设置；篇幅成对校验在
 *  schema 与 store 内双层把关），返回更新后列表项 */
export function setWritingPrefs(
  db: ReturnType<typeof openDatabase>,
  novelId: string,
  prefsJson: string,
): NovelListItem {
  let raw: unknown;
  try {
    raw = JSON.parse(prefsJson);
  } catch (error) {
    throw new Error(
      `写作偏好 JSON 解析失败：${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const result = novelWritingPrefsSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(
      `写作偏好不合法（${issue?.path.join(".") || "根"}）：${issue?.message ?? "未知问题"}`,
    );
  }
  return toListItem(new NovelStore(db).updateWritingPrefs(novelId, result.data));
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

/** delete 载荷：级联删除关联数据 + best-effort 清理 output 产物（章节正文文件按
 *  documents 登记的 file_path 逐一删除——绝对路径直接定位，历史相对行按 output 根
 *  解析；大纲 JSON 为历史版本残留产物，顺手清理；缺失不报错） */
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
  return characterEntrySchema.parse({
    id: stored.id,
    version: stored.version,
    updatedAt: stored.updatedAt,
    ...stored.character,
  });
}

function toMigrationEntry(stored: StoredCharacterMigration): CharacterMigrationEntry {
  return characterMigrationEntrySchema.parse({
    id: stored.id,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
    ...stored.migration,
  });
}

/** 表单提交：保存与确认在同一事务内完成，失败零写入。 */
export function saveMigrationEntry(
  db: ReturnType<typeof openDatabase>,
  novelId: string,
  characterId: string,
  requestJson: string,
): CharacterMigrationEntry {
  const request = parseMigrationJson<SaveCharacterMigration>(requestJson, saveCharacterMigrationSchema);
  return toMigrationEntry(new CharacterMigrationStore(db).saveMigration(novelId, characterId, request));
}

/** 迁移 JSON → schema 校验（新增入参 / patch 入参共用；错误信息带首个 issue 定位） */
function parseMigrationJson<T>(
  json: string,
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } } },
): T {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    throw new Error(`迁移 JSON 解析失败：${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(
      `迁移数据不合法（${issue?.path.join(".") || "根"}）：${issue?.message ?? "未知问题"}`,
    );
  }
  return result.data;
}

/** add-migration 载荷：新建迁移草案（旧值由服务端派生），返回迁移条目 */
export function addMigrationEntry(
  db: ReturnType<typeof openDatabase>,
  novelId: string,
  characterId: string,
  migrationJson: string,
): CharacterMigrationEntry {
  const input = parseMigrationJson<NewCharacterMigration>(migrationJson, newCharacterMigrationSchema);
  return toMigrationEntry(
    new CharacterMigrationStore(db).addMigration(novelId, characterId, input),
  );
}

/** update-migration 载荷：patch 编辑迁移（undefined=不动、null=清空），返回更新后条目 */
export function updateMigrationEntry(
  db: ReturnType<typeof openDatabase>,
  novelId: string,
  migrationId: string,
  patchJson: string,
): CharacterMigrationEntry {
  const patch = parseMigrationJson<CharacterMigrationPatch>(patchJson, characterMigrationPatchSchema);
  return toMigrationEntry(new CharacterMigrationStore(db).updateMigration(novelId, migrationId, patch));
}

/** confirm-migration 载荷：确认迁移生效（必填项校验 + 旧值重解析 + 区间校验），返回确认后条目 */
export function confirmMigrationEntry(
  db: ReturnType<typeof openDatabase>,
  novelId: string,
  migrationId: string,
): CharacterMigrationEntry {
  return toMigrationEntry(new CharacterMigrationStore(db).confirmMigration(novelId, migrationId));
}

/** cancel-migration 载荷：取消迁移（已确认且有后续依赖时拒绝），返回取消后条目 */
export function cancelMigrationEntry(
  db: ReturnType<typeof openDatabase>,
  novelId: string,
  migrationId: string,
): CharacterMigrationEntry {
  return toMigrationEntry(new CharacterMigrationStore(db).cancelMigration(novelId, migrationId));
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

function parseForeshadowJson(json: string): Foreshadow {
  try {
    return foreshadowSchema.parse(JSON.parse(json));
  } catch (error) {
    throw new Error(`伏笔 JSON 不合法：${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
}

function toForeshadowEntry(stored: StoredForeshadow): ForeshadowEntry {
  return { id: stored.id, ...stored.foreshadow, actNodeId: stored.actNodeId, recoverActNodeId: stored.recoverActNodeId, recoverActNodeIds: stored.recoverActNodeIds };
}

/**
 * 表单完整卡 → patch：必填字段与回收状态直接覆盖；可选项有值传值、缺省传 null
 * （清空——patch 语义 undefined=不动）；characterIds 与 recoverChapterIds 空选传 null 清空
 * （回收章编辑面已开放——未勾选 = 清空全部回收章）。
 */
function toForeshadowPatch(foreshadow: Foreshadow): ForeshadowPatch {
  return {
    surfaceAction: foreshadow.surfaceAction,
    hiddenTruth: foreshadow.hiddenTruth,
    attentionLevel: foreshadow.attentionLevel,
    recoveryStatus: foreshadow.recoveryStatus,
    plantingMethod: foreshadow.plantingMethod ?? null,
    purpose: foreshadow.purpose ?? null,
    appearChapterId: foreshadow.appearChapterId ?? null,
    characterIds: foreshadow.characterIds ?? null,
    recoverChapterIds: foreshadow.recoverChapterIds ?? null,
  };
}

/** update-foreshadow 载荷：patch 更新伏笔（服务角色同小说校验在 store 内），返回更新后条目 */
export function updateForeshadowEntry(
  db: ReturnType<typeof openDatabase>,
  novelId: string,
  foreshadowId: string,
  foreshadowJson: string,
): ForeshadowEntry {
  const patch = toForeshadowPatch(parseForeshadowJson(foreshadowJson));
  return toForeshadowEntry(new ForeshadowStore(db).updateForeshadow(foreshadowId, patch));
}

/** 文风 JSON → schema 校验后的 StyleReference（add 用：enabled 缺省 true——新增即启用） */
function parseStyleReferenceJson(json: string, requireEnabled: boolean): StyleReference {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    throw new Error(
      `文风 JSON 解析失败：${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const input =
    !requireEnabled && typeof raw === "object" && raw !== null
      ? { enabled: true, ...(raw as Record<string, unknown>) }
      : raw;
  const result = styleReferenceSchema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(
      `文风数据不合法（${issue?.path.join(".") || "根"}）：${issue?.message ?? "未知问题"}`,
    );
  }
  return result.data;
}

function toStyleReferenceEntry(stored: {
  id: string;
  styleReference: StyleReference;
}): StyleReferenceEntry {
  return { id: stored.id, ...stored.styleReference };
}

/** add-style 载荷：入库新文风（enabled 缺省 true），返回文风条目 */
export function addStyleEntry(
  db: ReturnType<typeof openDatabase>,
  novelId: string,
  styleJson: string,
): StyleReferenceEntry {
  if (!new NovelStore(db).getNovel(novelId)) {
    throw new Error(`小说不存在，无法新增文风：${novelId}`);
  }
  const style = parseStyleReferenceJson(styleJson, false);
  const stored = new StyleReferenceStore(db).addStyleReference(novelId, style);
  return toStyleReferenceEntry(stored);
}

/** update-style 载荷：全量编辑文风（名字/内容/启用开关），返回更新后条目 */
export function updateStyleEntry(
  db: ReturnType<typeof openDatabase>,
  novelId: string,
  styleId: string,
  styleJson: string,
): StyleReferenceEntry {
  const style = parseStyleReferenceJson(styleJson, true);
  const stored = new StyleReferenceStore(db).updateStyleReference(styleId, style);
  return toStyleReferenceEntry(stored);
}

/** delete-style 载荷：删除文风（行不存在抛可读错误） */
export function deleteStyleEntry(db: ReturnType<typeof openDatabase>, styleId: string): { deleted: string } {
  new StyleReferenceStore(db).deleteStyleReference(styleId);
  return { deleted: styleId };
}

function main(argv: string[]): number {
  const [command, novelId, ...rest] = argv;
  const db = openDatabase();
  try {
    switch (command) {
      case "list":
        process.stdout.write(`${JSON.stringify(buildNovelList(db))}\n`);
        return 0;
      case "list-runs":
        process.stdout.write(`${JSON.stringify(new WorkflowRunStore(db).listPending(novelId))}\n`);
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
      case "set-writing-prefs":
        if (!novelId || rest.length !== 1 || !rest[0]) break;
        process.stdout.write(`${JSON.stringify(setWritingPrefs(db, novelId, rest[0]))}\n`);
        return 0;
      case "add-character":
        if (!novelId || rest.length !== 1 || !rest[0]) break;
        process.stdout.write(`${JSON.stringify(addCharacterEntry(db, novelId, rest[0]))}\n`);
        return 0;
      case "update-character":
        // 固定基准：既有角色卡不可直接编辑（人物变化经 character_migrations 迁移表达），
        // 命令保留为显式拒绝——旧客户端调用会得到可读错误而非静默改写基准
        process.stderr.write("角色基准卡不可直接编辑：请经角色迁移（add-migration / confirm-migration）表达变化\n");
        return 1;
      case "update-foreshadow":
        if (!novelId || rest.length !== 2 || !rest[0] || !rest[1]) break;
        process.stdout.write(`${JSON.stringify(updateForeshadowEntry(db, novelId, rest[0], rest[1]))}\n`);
        return 0;
      case "add-migration":
        if (!novelId || rest.length !== 2 || !rest[0] || !rest[1]) break;
        process.stdout.write(`${JSON.stringify(addMigrationEntry(db, novelId, rest[0], rest[1]))}\n`);
        return 0;
      case "save-migration":
        if (!novelId || rest.length !== 2 || !rest[0] || !rest[1]) break;
        process.stdout.write(`${JSON.stringify(saveMigrationEntry(db, novelId, rest[0], rest[1]))}\n`);
        return 0;
      case "update-migration":
        if (!novelId || rest.length !== 2 || !rest[0] || !rest[1]) break;
        process.stdout.write(`${JSON.stringify(updateMigrationEntry(db, novelId, rest[0], rest[1]))}\n`);
        return 0;
      case "confirm-migration":
        if (!novelId || rest.length !== 1 || !rest[0]) break;
        process.stdout.write(`${JSON.stringify(confirmMigrationEntry(db, novelId, rest[0]))}\n`);
        return 0;
      case "cancel-migration":
        if (!novelId || rest.length !== 1 || !rest[0]) break;
        process.stdout.write(`${JSON.stringify(cancelMigrationEntry(db, novelId, rest[0]))}\n`);
        return 0;
      case "add-style":
        if (!novelId || rest.length !== 1 || !rest[0]) break;
        process.stdout.write(`${JSON.stringify(addStyleEntry(db, novelId, rest[0]))}\n`);
        return 0;
      case "update-style":
        if (!novelId || rest.length !== 2 || !rest[0] || !rest[1]) break;
        process.stdout.write(`${JSON.stringify(updateStyleEntry(db, novelId, rest[0], rest[1]))}\n`);
        return 0;
      case "delete-style":
        // 文风 ID 落在第二个位置参数（novelId 变量处）——delete 无小说入参
        if (!novelId) break;
        process.stdout.write(`${JSON.stringify(deleteStyleEntry(db, novelId))}\n`);
        return 0;
      default:
        break;
    }
  } finally {
    db.close();
  }
  process.stderr.write(
    "用法：bun run apps/agent/src/query.ts <list | list-runs [novelId] | get <id> | rename <id> <name> | pin <id> | unpin <id> | favorite <id> | unfavorite <id> | delete <id> | set-writing-prefs <novelId> <偏好JSON> | add-character <novelId> <角色卡JSON> | update-foreshadow <novelId> <foreshadowId> <伏笔JSON> | save-migration <novelId> <characterId> <提交JSON> | add-migration <novelId> <characterId> <迁移JSON> | update-migration <novelId> <migrationId> <patchJSON> | confirm-migration <novelId> <migrationId> | cancel-migration <novelId> <migrationId> | add-style <novelId> <文风JSON> | update-style <novelId> <styleId> <文风JSON> | delete-style <styleId>>\n",
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

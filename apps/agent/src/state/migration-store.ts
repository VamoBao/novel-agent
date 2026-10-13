import type { Database } from "bun:sqlite";
import {
  buildChapterOrder,
  type ChapterOrderNode,
  characterMigrationPatchSchema,
  characterMigrationSchema,
  migrationValueError,
  newCharacterMigrationSchema,
  normalizeMigrationValue,
  readCharacterField,
  saveCharacterMigrationSchema,
  type Character,
  type CharacterFieldPath,
  type CharacterMigration,
  type CharacterMigrationPatch,
  type NewCharacterMigration,
  type SaveCharacterMigration,
} from "@novel/shared";
import { DEFAULT_DB_PATH, getDefaultDatabase, openDatabase } from "./db";
import { CharacterStore } from "./character-store";
import { OutlineStore } from "./outline-store";
import { generateUuidV7 } from "./id";

/** 库中的迁移记录：迁移本体 + 库表元信息（id 为 UUIDv7） */
export interface StoredCharacterMigration {
  id: string;
  createdAt: string;
  updatedAt: string;
  migration: CharacterMigration;
}

/** 迁移记录的修订快照（每次编辑或状态变更前的整行 JSON） */
export interface StoredMigrationVersion {
  id: string;
  migrationId: string;
  revision: number;
  migration: CharacterMigration;
  createdAt: string;
}

interface MigrationRow {
  id: string;
  novel_id: string;
  character_id: string;
  outline_version: number | null;
  migrate_field: string;
  old_value: string | null;
  new_value: string | null;
  start_chapter_id: string | null;
  end_chapter_id: string | null;
  trigger: string | null;
  transition_guidance: string | null;
  sequence: number;
  revision: number;
  status: string;
  group_id: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS = `
  id, novel_id, character_id, outline_version, migrate_field, old_value, new_value,
  start_chapter_id, end_chapter_id, trigger, transition_guidance, sequence, revision,
  status, group_id, created_at, updated_at
`;

const INSERT_SQL = `
  INSERT INTO character_migrations (
    id, novel_id, character_id, outline_version, migrate_field, old_value, new_value,
    start_chapter_id, end_chapter_id, trigger, transition_guidance, sequence, revision,
    status, group_id, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
`;

const UPDATE_SQL = `
  UPDATE character_migrations SET
    outline_version = ?, old_value = ?, new_value = ?, start_chapter_id = ?, end_chapter_id = ?,
    trigger = ?, transition_guidance = ?, revision = ?, status = ?, updated_at = ?
  WHERE id = ?;
`;

const SNAPSHOT_SQL = `
  INSERT INTO character_migration_versions (id, migration_id, novel_id, revision, migration, created_at)
  VALUES (?, ?, ?, ?, ?, ?);
`;

function rowToStored(row: MigrationRow): StoredCharacterMigration {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // 列值经 schema 还原，读侧同样过 zod 校验（库内数据完整性兜底）
    migration: characterMigrationSchema.parse({
      novelId: row.novel_id,
      characterId: row.character_id,
      outlineVersion: row.outline_version,
      migrateField: row.migrate_field,
      oldValue: row.old_value,
      newValue: row.new_value,
      startChapterId: row.start_chapter_id,
      endChapterId: row.end_chapter_id,
      trigger: row.trigger,
      transitionGuidance: row.transition_guidance,
      sequence: row.sequence,
      revision: row.revision,
      status: row.status,
      groupId: row.group_id,
    }),
  };
}

/** 章节点定位：所属大纲版本 + 该版本内的全书章序（1 起） */
interface ChapterPosition {
  version: number;
  order: number;
}

/** 区间解析结果：outlineVersion 为绑定的全书大纲版本（未绑起始章时可空） */
interface ResolvedRange {
  outlineVersion: number | null;
  startOrder: number | null;
  endOrder: number | null;
}

/**
 * 角色迁移持久化与链校验。
 *
 * 固定基准（characters 主行 = 第一版）之上的「人物变化」以此表表达，一行一个字段变化：
 * - **旧值由服务端派生**（起始章之前最近一条同字段已确认迁移的新值，无则取基准），
 *   不接受任意填写；草案未定起始章时为空，确认时按所属故事版本内已确认链重新解析
 * - 章节绑定校验：必须属于同一小说、**同一大纲树版本**、类型为章；start ≤ end，
 *   结束章缺省为开放区间
 * - 同角色同字段的**生效区间不能重叠**（不同字段并行）；前置开放区间未结束时不能确认
 *   同字段后续变化（由重叠校验覆盖）
 * - 后续已确认迁移依赖本记录时，改变目标新值或取消本记录被拒绝（避免静默改写其变化依据）；
 *   插入 / 移动 / 换版在提交前检查完整字段链，修改诱因与过渡描述不受影响
 * - 每次编辑或状态变更前把旧行整卡 JSON 归档 character_migration_versions 并递增 revision；
 *   sequence 在角色内原子分配且不复用
 * - 基准卡不可经本层覆盖（旧 update-character 路径已退役，见 CharacterStore）
 */
export class CharacterMigrationStore {
  private readonly characterStore: CharacterStore;
  private readonly outlineStore: OutlineStore;

  constructor(private readonly db: Database) {
    this.characterStore = new CharacterStore(db);
    this.outlineStore = new OutlineStore(db);
  }

  static open(path: string = DEFAULT_DB_PATH): CharacterMigrationStore {
    return new CharacterMigrationStore(openDatabase(path));
  }

  /** 取某本小说的迁移记录（可按角色过滤），按角色入库序 + sequence 升序 */
  listMigrations(novelId: string, characterId?: string): StoredCharacterMigration[] {
    const sql = characterId
      ? `SELECT ${COLUMNS} FROM character_migrations WHERE novel_id = ? AND character_id = ?
         ORDER BY created_at ASC, sequence ASC;`
      : `SELECT ${COLUMNS} FROM character_migrations WHERE novel_id = ?
         ORDER BY character_id ASC, sequence ASC;`;
    const rows = (characterId
      ? this.db.prepare(sql).all(novelId, characterId)
      : this.db.prepare(sql).all(novelId)) as MigrationRow[];
    return rows.map(rowToStored);
  }

  /** 取单条迁移；无记录返回 undefined */
  getMigration(id: string): StoredCharacterMigration | undefined {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM character_migrations WHERE id = ?;`).get(id) as
      | MigrationRow
      | null;
    return row ? rowToStored(row) : undefined;
  }

  /** 取某条迁移的修订历史（按 revision 升序） */
  listMigrationVersions(migrationId: string): StoredMigrationVersion[] {
    const rows = this.db
      .prepare(
        "SELECT id, migration_id, revision, migration, created_at FROM character_migration_versions WHERE migration_id = ? ORDER BY revision ASC, created_at ASC;",
      )
      .all(migrationId) as Array<{
      id: string;
      migration_id: string;
      revision: number;
      migration: string;
      created_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      migrationId: row.migration_id,
      revision: row.revision,
      migration: characterMigrationSchema.parse(JSON.parse(row.migration)),
      createdAt: row.created_at,
    }));
  }

  /** 表单保存与确认共用一个事务，任何校验失败都撤销主行、快照及序号分配。 */
  saveMigration(novelId: string, characterId: string, request: SaveCharacterMigration): StoredCharacterMigration {
    const validated = saveCharacterMigrationSchema.parse(request);
    return this.db.transaction(() => {
      this.requireCharacter(novelId, characterId);
      if (validated.action === "update") {
        const current = this.requireMigration(novelId, validated.migrationId);
        if (current.migration.characterId !== characterId) throw new Error("迁移记录不属于该角色");
      }
      const saved = validated.action === "create"
        ? this.addMigration(novelId, characterId, validated.input)
        : this.updateMigration(novelId, validated.migrationId, validated.patch);
      return validated.confirm && saved.migration.status === "draft"
        ? this.confirmMigration(novelId, saved.id)
        : saved;
    }).immediate();
  }

  /**
   * 新建迁移（草案）：服务端校验字段值与章节区间、派生旧值、原子分配 sequence。
   * 草案允许起始章 / 诱因 / 过渡描述留空（确认时补齐）。
   */
  addMigration(
    novelId: string,
    characterId: string,
    input: NewCharacterMigration,
  ): StoredCharacterMigration {
    const validated = newCharacterMigrationSchema.parse(input);
    const create = this.db.transaction((): StoredCharacterMigration => {
      const character = this.requireCharacter(novelId, characterId);
      const field = validated.migrateField;
      const newValue = normalizeMigrationValue(validated.newValue);
      this.assertFieldValue(field, newValue);

      const range = this.resolveRange(
        novelId,
        validated.startChapterId ?? null,
        validated.endChapterId ?? null,
        validated.outlineVersion ?? null,
      );
      const oldValue = this.deriveOldValue(
        novelId,
        character.character,
        characterId,
        field,
        range,
        null,
      );

      const id = generateUuidV7();
      const now = new Date().toISOString();
      this.db
        .prepare(INSERT_SQL)
        .run(
          id,
          novelId,
          characterId,
          range.outlineVersion,
          field,
          oldValue,
          newValue,
          range.startOrder === null ? null : (validated.startChapterId ?? null),
          range.endOrder === null ? null : (validated.endChapterId ?? null),
          normalizeMigrationValue(validated.trigger),
          normalizeMigrationValue(validated.transitionGuidance),
          this.nextSequence(characterId),
          1,
          "draft",
          validated.groupId ?? null,
          now,
          now,
        );
      return this.getMigrationOrThrow(id);
    });
    return create();
  }

  /**
   * 编辑迁移（patch 语义：undefined = 不动，null = 清空）：重校验字段值、章节顺序与重叠、
   * 后续依赖守卫；旧行归档快照、revision 递增。已取消的记录不可编辑。
   */
  updateMigration(
    novelId: string,
    id: string,
    patch: CharacterMigrationPatch,
  ): StoredCharacterMigration {
    const validated = characterMigrationPatchSchema.parse(patch);
    const apply = this.db.transaction((): StoredCharacterMigration => {
      const current = this.requireMigration(novelId, id);
      const m = current.migration;
      if (m.status === "cancelled") {
        throw new Error("已取消的迁移不能编辑");
      }

      const newValue =
        validated.newValue === undefined ? m.newValue : normalizeMigrationValue(validated.newValue);
      this.assertFieldValue(m.migrateField, newValue);
      const trigger =
        validated.trigger === undefined ? m.trigger : normalizeMigrationValue(validated.trigger);
      const transitionGuidance =
        validated.transitionGuidance === undefined
          ? m.transitionGuidance
          : normalizeMigrationValue(validated.transitionGuidance);
      const startChapterId =
        validated.startChapterId === undefined ? m.startChapterId : (validated.startChapterId ?? null);
      const endChapterId =
        validated.endChapterId === undefined ? m.endChapterId : (validated.endChapterId ?? null);
      const explicitVersion =
        validated.outlineVersion === undefined ? null : validated.outlineVersion;

      const range = this.resolveRange(novelId, startChapterId, endChapterId, explicitVersion);
      const character = this.requireCharacter(novelId, m.characterId);
      const oldValue = this.deriveOldValue(
        novelId,
        character.character,
        m.characterId,
        m.migrateField,
        range,
        id,
      );

      if (m.status === "confirmed") {
        this.assertConfirmationFields(startChapterId, trigger, transitionGuidance);
        // 后续已确认迁移依赖本记录时，改变目标新值被拒绝（其变化依据由本记录派生）
        if (newValue !== m.newValue) {
          const originalRange = this.resolveRange(novelId, m.startChapterId, m.endChapterId, m.outlineVersion);
          this.assertNoDependents(novelId, id, m.characterId, m.migrateField, originalRange);
        }
        this.assertNoOverlap(novelId, id, m.characterId, m.migrateField, range);
      }

      this.snapshot(current);
      this.db
        .prepare(UPDATE_SQL)
        .run(
          range.outlineVersion,
          oldValue,
          newValue,
          startChapterId,
          endChapterId,
          trigger,
          transitionGuidance,
          m.revision + 1,
          m.status,
          new Date().toISOString(),
          id,
        );
      if (m.status === "confirmed") {
        this.assertChainConsistency(novelId, m.characterId, m.migrateField, m.outlineVersion);
        if (range.outlineVersion !== m.outlineVersion) {
          this.assertChainConsistency(novelId, m.characterId, m.migrateField, range.outlineVersion);
        }
      }
      return this.getMigrationOrThrow(id);
    });
    return apply();
  }

  /**
   * 确认迁移生效：起始章 / 诱因 / 过渡描述必填，按所属故事版本内已确认迁移链**重新解析旧值**，
   * 校验同字段生效区间不重叠；旧行归档快照、revision 递增、status=confirmed。
   */
  confirmMigration(novelId: string, id: string): StoredCharacterMigration {
    const confirm = this.db.transaction((): StoredCharacterMigration => {
      const current = this.requireMigration(novelId, id);
      const m = current.migration;
      if (m.status === "confirmed") throw new Error("迁移已确认，无需重复确认");
      if (m.status === "cancelled") throw new Error("已取消的迁移不能确认");
      this.assertConfirmationFields(m.startChapterId, m.trigger, m.transitionGuidance);
      this.assertFieldValue(m.migrateField, m.newValue);

      const range = this.resolveRange(novelId, m.startChapterId, m.endChapterId, m.outlineVersion);
      if (range.outlineVersion === null || range.startOrder === null) {
        throw new Error("确认生效前必须绑定起始章");
      }
      const character = this.requireCharacter(novelId, m.characterId);
      const oldValue = this.deriveOldValue(
        novelId,
        character.character,
        m.characterId,
        m.migrateField,
        range,
        id,
      );
      this.assertNoOverlap(novelId, id, m.characterId, m.migrateField, range);

      this.snapshot(current);
      this.db
        .prepare(UPDATE_SQL)
        .run(
          range.outlineVersion,
          oldValue,
          m.newValue,
          m.startChapterId,
          m.endChapterId,
          m.trigger,
          m.transitionGuidance,
          m.revision + 1,
          "confirmed",
          new Date().toISOString(),
          id,
        );
      this.assertChainConsistency(novelId, m.characterId, m.migrateField, range.outlineVersion);
      return this.getMigrationOrThrow(id);
    });
    return confirm();
  }

  /**
   * 取消迁移：已确认的记录在存在后续依赖时被拒绝（先处理后续记录）；
   * 草案与已取消项不参与角色状态解析，取消后旧行归档、revision 递增。
   */
  cancelMigration(novelId: string, id: string): StoredCharacterMigration {
    const cancel = this.db.transaction((): StoredCharacterMigration => {
      const current = this.requireMigration(novelId, id);
      const m = current.migration;
      if (m.status === "cancelled") throw new Error("迁移已取消");
      if (m.status === "confirmed") {
        const range = this.resolveRange(novelId, m.startChapterId, m.endChapterId, m.outlineVersion);
        this.assertNoDependents(novelId, id, m.characterId, m.migrateField, range);
      }
      this.snapshot(current);
      this.db
        .prepare(UPDATE_SQL)
        .run(
          m.outlineVersion,
          m.oldValue,
          m.newValue,
          m.startChapterId,
          m.endChapterId,
          m.trigger,
          m.transitionGuidance,
          m.revision + 1,
          "cancelled",
          new Date().toISOString(),
          id,
        );
      return this.getMigrationOrThrow(id);
    });
    return cancel();
  }

  close(): void {
    this.db.close();
  }

  // ---- 内部：校验与派生 ----

  private requireCharacter(novelId: string, characterId: string) {
    const character = this.characterStore.getCharacter(characterId);
    if (!character) throw new Error(`角色不存在：${characterId}`);
    if (character.novelId !== novelId) throw new Error(`角色不属于该小说：${characterId}`);
    return character;
  }

  private requireMigration(novelId: string, id: string): StoredCharacterMigration {
    const current = this.getMigration(id);
    if (!current) throw new Error(`迁移记录不存在：${id}`);
    if (current.migration.novelId !== novelId) throw new Error(`迁移记录不属于该小说：${id}`);
    return current;
  }

  private getMigrationOrThrow(id: string): StoredCharacterMigration {
    const stored = this.getMigration(id);
    if (!stored) throw new Error(`迁移记录写入后读取失败：${id}`);
    return stored;
  }

  private assertFieldValue(field: CharacterFieldPath, value: string | null): void {
    const error = migrationValueError(field, value);
    if (error) throw new Error(error);
  }

  private assertConfirmationFields(
    startChapterId: string | null,
    trigger: string | null,
    transitionGuidance: string | null,
  ): void {
    if (startChapterId === null) throw new Error("确认生效前必须绑定起始章");
    if (trigger === null) throw new Error("确认生效前必须填写诱因（变化目的）");
    if (transitionGuidance === null) throw new Error("确认生效前必须填写过渡描述");
  }

  /** 写入后、提交前校验整个同字段链；插入/重排/换版不能静默改变已确认下游的依据。 */
  private assertChainConsistency(
    novelId: string,
    characterId: string,
    field: CharacterFieldPath,
    outlineVersion: number | null,
  ): void {
    if (outlineVersion === null) return;
    const positions = this.chapterPositions(novelId);
    const chain = this.sameChain(novelId, characterId, field, outlineVersion)
      .filter((stored) => stored.migration.status === "confirmed")
      .map((stored) => {
        const position = positions.get(stored.migration.startChapterId ?? "");
        if (!position) throw new Error(`迁移链的已确认迁移（序号 ${stored.migration.sequence}）缺少有效起始章`);
        return { stored, order: position.order };
      })
      .sort((a, b) => a.order - b.order);
    let expected = readCharacterField(this.requireCharacter(novelId, characterId).character, field);
    for (const { stored: { migration } } of chain) {
      if (migration.oldValue !== expected) {
        throw new Error(`迁移链发生变化：已确认迁移（序号 ${migration.sequence}）的旧值依据不一致，请先处理后续迁移`);
      }
      expected = migration.newValue;
    }
  }

  private nextSequence(characterId: string): number {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(sequence), 0) AS maxSequence FROM character_migrations WHERE character_id = ?;")
      .get(characterId) as { maxSequence: number };
    return row.maxSequence + 1;
  }

  /** 解析并校验章节区间（同小说 / 同大纲版本 / 章节点 / start ≤ end） */
  private resolveRange(
    novelId: string,
    startChapterId: string | null,
    endChapterId: string | null,
    explicitVersion: number | null,
  ): ResolvedRange {
    if (startChapterId === null) {
      if (endChapterId !== null) {
        throw new Error("结束章不能在没有起始章时绑定");
      }
      return { outlineVersion: explicitVersion, startOrder: null, endOrder: null };
    }
    const positions = this.chapterPositions(novelId);
    const start = positions.get(startChapterId);
    if (!start) {
      throw new Error(`起始章不存在、不属于该小说或不是章节点：${startChapterId}`);
    }
    if (endChapterId === null) {
      return { outlineVersion: start.version, startOrder: start.order, endOrder: null };
    }
    const end = positions.get(endChapterId);
    if (!end) {
      throw new Error(`结束章不存在、不属于该小说或不是章节点：${endChapterId}`);
    }
    if (end.version !== start.version) {
      throw new Error("起始章与结束章必须属于同一大纲树版本");
    }
    if (end.order < start.order) {
      throw new Error("起始章不能晚于结束章");
    }
    return { outlineVersion: start.version, startOrder: start.order, endOrder: end.order };
  }

  /**
   * 章节点定位索引：章 ID → { 所属**全书大纲版本**, 该版本内全书章序 }。
   * 版本取该章所在的根节点（部）的 version——不使用章节点自身 version（章节规划
   * 后建的章节点版本号不随所属树推进，树版本以根为准）。不过滤 is_current_version，
   * 归档旧版章照常可解析；父级链断裂（中间层缺失）的章不入索引。
   */
  private chapterPositions(novelId: string): Map<string, ChapterPosition> {
    const stored = this.outlineStore.listOutlineNodes(novelId);
    const byId = new Map(stored.map((node) => [node.id, node]));
    /** 沿 parentId 上溯到根（部）节点，返回其 version；链条断裂返回 undefined */
    const treeVersion = (startId: string): number | undefined => {
      let current = byId.get(startId);
      const seen = new Set<string>();
      while (current && current.node.parentId !== null && !seen.has(current.id)) {
        seen.add(current.id);
        current = byId.get(current.node.parentId);
      }
      return current && current.node.parentId === null ? current.node.version : undefined;
    };
    const byVersion = new Map<number, ChapterOrderNode[]>();
    const chapterVersions = new Map<string, number>();
    for (const node of stored) {
      const version = treeVersion(node.id);
      if (version === undefined) continue;
      const list = byVersion.get(version) ?? [];
      list.push({
        id: node.id,
        parentId: node.node.parentId,
        type: node.node.type,
        sort: node.node.sort,
      });
      byVersion.set(version, list);
      if (node.node.type === "chapter") chapterVersions.set(node.id, version);
    }
    const positions = new Map<string, ChapterPosition>();
    for (const [version, list] of byVersion) {
      const order = buildChapterOrder(list);
      for (const [chapterId, chapterVersion] of chapterVersions) {
        if (chapterVersion !== version) continue;
        const value = order.get(chapterId);
        if (value !== undefined) positions.set(chapterId, { version, order: value });
      }
    }
    return positions;
  }

  /** 同一故事版本内的迁移记录（含自身，供重叠与依赖判定） */
  private sameChain(
    novelId: string,
    characterId: string,
    field: CharacterFieldPath,
    outlineVersion: number,
  ): StoredCharacterMigration[] {
    return this.listMigrations(novelId, characterId).filter(
      (stored) =>
        stored.migration.migrateField === field &&
        stored.migration.outlineVersion === outlineVersion,
    );
  }

  /**
   * 派生旧值：起始章之前最近一条**同字段已确认**迁移（同故事版本）的新值；没有则取基准。
   * 未绑定起始章（无版本 / 无章序）时返回 null——草案旧值仅用于展示，确认时重新计算。
   */
  private deriveOldValue(
    novelId: string,
    baseline: Character,
    characterId: string,
    field: CharacterFieldPath,
    range: ResolvedRange,
    selfId: string | null,
  ): string | null {
    if (range.outlineVersion === null || range.startOrder === null) return null;
    const positions = this.chapterPositions(novelId);
    const candidates = this.sameChain(novelId, characterId, field, range.outlineVersion).filter(
      (stored) => {
        const m = stored.migration;
        if (m.status !== "confirmed" || stored.id === selfId) return false;
        if (m.startChapterId === null) return false;
        const order = positions.get(m.startChapterId)?.order;
        return order !== undefined && order < range.startOrder!;
      },
    );
    if (candidates.length === 0) {
      return readCharacterField(baseline, field);
    }
    // 起始章序最大者为「最近一条」（同字段生效区间不重叠，序不会并列）
    candidates.sort((a, b) => {
      const orderA = positions.get(a.migration.startChapterId ?? "")?.order ?? 0;
      const orderB = positions.get(b.migration.startChapterId ?? "")?.order ?? 0;
      return orderB - orderA;
    });
    return candidates[0]!.migration.newValue;
  }

  /** 重叠校验：同角色同字段同版本内，生效区间不得与本记录相交（不同字段并行） */
  private assertNoOverlap(
    novelId: string,
    selfId: string,
    characterId: string,
    field: CharacterFieldPath,
    range: ResolvedRange,
  ): void {
    if (range.outlineVersion === null || range.startOrder === null) return;
    const positions = this.chapterPositions(novelId);
    const start = range.startOrder;
    const end = range.endOrder ?? Number.POSITIVE_INFINITY;
    for (const stored of this.sameChain(novelId, characterId, field, range.outlineVersion)) {
      const m = stored.migration;
      if (stored.id === selfId || m.status !== "confirmed" || m.startChapterId === null) continue;
      const otherStart = positions.get(m.startChapterId)?.order;
      if (otherStart === undefined) continue;
      const otherEnd = m.endChapterId
        ? (positions.get(m.endChapterId)?.order ?? Number.POSITIVE_INFINITY)
        : Number.POSITIVE_INFINITY;
      if (start <= otherEnd && otherStart <= end) {
        throw new Error(
          `同字段「${m.migrateField}」的生效区间与已确认迁移（序号 ${m.sequence}）重叠：` +
            `已确认区间从第 ${otherStart} 章起${m.endChapterId === null ? "（未结束）" : `至第 ${otherEnd} 章`}，` +
            `本记录从第 ${start} 章起${range.endOrder === null ? "（未结束）" : `至第 ${end} 章`}`,
        );
      }
    }
  }

  /** 后续依赖守卫：存在起始章更晚的同字段已确认迁移时，本记录是其变化依据，不可改新值 / 取消 */
  private assertNoDependents(
    novelId: string,
    selfId: string,
    characterId: string,
    field: CharacterFieldPath,
    range: ResolvedRange,
  ): void {
    if (range.outlineVersion === null || range.startOrder === null) return;
    const positions = this.chapterPositions(novelId);
    for (const stored of this.sameChain(novelId, characterId, field, range.outlineVersion)) {
      const m = stored.migration;
      if (stored.id === selfId || m.status !== "confirmed" || m.startChapterId === null) continue;
      const otherStart = positions.get(m.startChapterId)?.order;
      if (otherStart !== undefined && otherStart > range.startOrder) {
        throw new Error(
          `后续已确认迁移（序号 ${m.sequence}，同字段「${m.migrateField}」）以本记录的新值为旧值依据，` +
            `请先处理该后续记录（改值或取消），再修改本记录`,
        );
      }
    }
  }

  /** 旧行整卡 JSON 归档（revision 为被替换的版本号） */
  private snapshot(current: StoredCharacterMigration): void {
    this.db
      .prepare(SNAPSHOT_SQL)
      .run(
        generateUuidV7(),
        current.id,
        current.migration.novelId,
        current.migration.revision,
        JSON.stringify(current.migration),
        new Date().toISOString(),
      );
  }
}

let defaultStore: CharacterMigrationStore | undefined;

/** 默认全局 store（懒加载，与其他 store 共享默认数据库连接） */
export function getDefaultCharacterMigrationStore(): CharacterMigrationStore {
  defaultStore ??= new CharacterMigrationStore(getDefaultDatabase());
  return defaultStore;
}

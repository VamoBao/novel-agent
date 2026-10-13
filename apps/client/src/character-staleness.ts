import { CHARACTER_FIELD_SPECS, type CharacterMigration, type NovelDetail, type OutlineNodeEntry } from "@novel/shared";
import { globalChapterOrder } from "./chapter-order";

/** 当前或修改前的确认方案影响本章，且该修改晚于正文生成。 */
export interface StaleCastMigration {
  /** 登场角色名 */
  name: string;
  /** 迁移字段中文标签 */
  fieldLabel: string;
  /** 迁移在角色内的序号 */
  sequence: number;
}

/**
 * 本章登场角色里「迁移计划已更新、正文可能落后」的那些。
 *
 * 固定基准之后人物变化经 character_migrations 表达，因此陈旧判定**按迁移的影响范围**而非
 * 角色卡更新时间：迁移最近修改时间晚于正文生成时，检查当前已确认范围和本章正文生成
 * 之后被修改的已确认快照范围（起始章序 ≤ 本章章序）。取消、后移或换版也保留旧范围
 * 的待复查提示；未确认草案不提示，正文在修改后重新生成则清除提示。归档版本章
 * 不可解析，不混入当前版本。
 *
 * 只提示待复查，不做任何自动重写——已生成正文是冻结产物。
 * 未生成正文（无 document）或未绑定登场角色（旧数据）返回空：无正文即无落后问题。
 * 时间戳为同格式 ISO 8601（UTC），字典序比较即时间先后。
 */
export function staleCastMigrations(
  node: OutlineNodeEntry,
  detail: NovelDetail,
): StaleCastMigration[] {
  if (node.type !== "chapter" || node.characterIds === null) return [];
  const document = detail.documents.find((entry) => entry.chapterId === node.id);
  if (!document) return [];
  const chapterOrder = globalChapterOrder(detail).get(node.id);
  if (chapterOrder === undefined) return [];

  const nameById = new Map(detail.characters.map((c) => [c.id, c.basicInfo.name]));
  const orderByChapter = globalChapterOrder(detail);
  const stale: StaleCastMigration[] = [];
  for (const id of node.characterIds) {
    const name = nameById.get(id);
    if (name === undefined) continue;
    for (const migration of detail.migrations) {
      if (migration.characterId !== id || migration.updatedAt <= document.updatedAt) continue;
      const states: CharacterMigration[] = migration.status === "confirmed" ? [migration] : [];
      // 快照的 createdAt 是「这次修改发生的时刻」，不是旧方案的确认时刻。
      // 取消、后移或改绑版本时，旧范围内的正文同样失去了原有写作依据。
      states.push(...detail.migrationVersions
        .filter((version) => version.migrationId === migration.id &&
          version.createdAt > document.updatedAt && version.migration.status === "confirmed")
        .map((version) => version.migration));
      const affected = states.some((state) => {
        const startOrder = state.startChapterId === null ? undefined : orderByChapter.get(state.startChapterId);
        return startOrder !== undefined && startOrder <= chapterOrder;
      });
      if (affected) {
        stale.push({
          name,
          fieldLabel: CHARACTER_FIELD_SPECS[migration.migrateField].label,
          sequence: migration.sequence,
        });
      }
    }
  }
  return stale;
}

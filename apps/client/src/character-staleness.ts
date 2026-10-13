import { CHARACTER_FIELD_SPECS, type NovelDetail, type OutlineNodeEntry } from "@novel/shared";
import { globalChapterOrder } from "./chapter-order";

/** 影响本章的已确认迁移（章卡陈旧提示用）：该迁移在本章起生效，且确认时间晚于本章正文生成 */
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
 * 角色卡更新时间：只在本章的登场角色存在**已确认迁移**、该迁移的生效区间**覆盖本章**
 * （起始章序 ≤ 本章章序），且其确认时间（updatedAt）晚于本章正文生成时间（document.updatedAt）
 * 时才提示。这样后续章节才生效的迁移不会让早期章节全部显示过时，绑定在归档旧版大纲上的
 * 迁移（本章序不可解析）也不混入新版。
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
      if (migration.characterId !== id || migration.status !== "confirmed") continue;
      const startOrder =
        migration.startChapterId === null ? undefined : orderByChapter.get(migration.startChapterId);
      // 本章序不可解析（绑定归档旧版大纲）或起始章晚于本章：本章不受该迁移影响
      if (startOrder === undefined || startOrder > chapterOrder) continue;
      if (migration.updatedAt > document.updatedAt) {
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

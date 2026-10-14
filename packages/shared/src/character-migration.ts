import { z } from "zod";
import type { Character } from "./character";

/**
 * 角色迁移：固定基准 + 迁移计划。
 *
 * 角色首次入库的第一版即**固定基准**，后续变化不再覆盖基准卡，而是以「一行一个字段变化」
 * 的迁移记录表达。同一字段的下一次迁移旧值取该字段上一次生效迁移的新值，没有前置迁移
 * 时取基准值——不同字段各自成链。诱因（trigger）与过渡描述（transitionGuidance）是
 * **创作计划**（自由文本），不建设独立的实际兑现状态表。
 */

/** 受控角色字段路径：覆盖 characterSchema 全部叶子字段（迁移只能作用于这些字段） */
export const characterFieldPathSchema = z.enum([
  "basicInfo.name",
  "basicInfo.gender",
  "basicInfo.appearance",
  "core.desire",
  "core.fear",
  "core.narrativeRole",
  "background",
  "personality",
  "characterGoal",
  "creationPurpose",
  "trajectory",
  "endingDirection",
  "relationships",
]);
export type CharacterFieldPath = z.infer<typeof characterFieldPathSchema>;

/** 字段路径全集（按 characterSchema 声明顺序，导入草案时保证确定性） */
export const CHARACTER_FIELD_PATHS = characterFieldPathSchema.options;

/** 姓名保持固定；历史记录仍使用完整字段枚举读取。 */
export const CHARACTER_MIGRATION_FIELD_PATHS = CHARACTER_FIELD_PATHS.filter((field) => field !== "basicInfo.name");

/** 字段元信息：中文标签 + 是否必填（必填字段的迁移目标值不可为空） */
export const CHARACTER_FIELD_SPECS: Record<
  CharacterFieldPath,
  { label: string; required: boolean }
> = {
  "basicInfo.name": { label: "姓名", required: true },
  "basicInfo.gender": { label: "性别", required: false },
  "basicInfo.appearance": { label: "外貌特征", required: false },
  "core.desire": { label: "渴望", required: true },
  "core.fear": { label: "恐惧", required: true },
  "core.narrativeRole": { label: "叙事定位", required: true },
  background: { label: "背景", required: true },
  personality: { label: "性格", required: false },
  characterGoal: { label: "角色目的", required: false },
  creationPurpose: { label: "创作目的", required: true },
  trajectory: { label: "轨迹", required: false },
  endingDirection: { label: "结局方向", required: true },
  relationships: { label: "关系", required: false },
};

/** 迁移状态：草案与取消项不参与角色状态解析 */
export const characterMigrationStatusSchema = z.enum(["draft", "confirmed", "cancelled"]);
export type CharacterMigrationStatus = z.infer<typeof characterMigrationStatusSchema>;

/**
 * 迁移记录：一行表示一个角色的一个字段变化。
 * - outlineVersion 为**明确绑定的全书大纲版本**（非章节点自身 version）；未绑定草案可空
 * - oldValue 由服务端派生（起始章之前最近一条同字段已确认迁移的新值，无则取基准），
 *   草案未定起始章时为 null；可选字段未设定为 null
 * - startChapterId 草案可空，**确认生效时必须绑定**；endChapterId 可空 = 开放区间
 * - trigger / transitionGuidance 正式确认时必填，草案可空
 * - sequence 为同一角色下的迁移记录序号，分配原子且不复用；故事衔接按章节顺序解析，
 *   不按编辑时间推断
 * - revision 为当前记录修订版本，每次编辑或状态变更递增
 */
export const characterMigrationSchema = z.object({
  novelId: z.string().min(1).describe("所属小说创作 ID"),
  characterId: z.string().min(1).describe("所属角色 ID"),
  outlineVersion: z
    .number()
    .int()
    .min(1)
    .nullable()
    .describe("绑定的全书大纲版本；未绑定草案为 null"),
  migrateField: characterFieldPathSchema.describe("受控字段路径"),
  oldValue: z.string().nullable().describe("字段旧值（服务端派生，只读）"),
  newValue: z.string().nullable().describe("字段目标新值"),
  startChapterId: z.string().min(1).nullable().describe("起始章节点 ID；草案可为 null"),
  endChapterId: z.string().min(1).nullable().describe("结束章节点 ID；null = 尚未确定（开放区间）"),
  trigger: z.string().min(1).nullable().describe("诱因 / 变化目的（创作计划）；确认时必填"),
  transitionGuidance: z
    .string()
    .min(1)
    .nullable()
    .describe("中间过程 / 保留的特征 / 结束时表现；确认时必填"),
  sequence: z.number().int().min(1).describe("同一角色下的序号，分配原子且不复用"),
  revision: z.number().int().min(1).describe("当前记录修订版本，每次编辑或状态变更递增"),
  status: characterMigrationStatusSchema.describe("草案 / 已确认 / 已取消"),
  groupId: z
    .string()
    .min(1)
    .nullable()
    .describe("可空；同一转折涉及多个字段时用于关联（历史同次编辑的差异共用）"),
});
export type CharacterMigration = z.infer<typeof characterMigrationSchema>;

/** 新增迁移（草案）入参：字段 + 目标值必填，其余可空（确认时补齐） */
export const newCharacterMigrationSchema = z.object({
  migrateField: characterFieldPathSchema.refine((field) => field !== "basicInfo.name", "姓名为固定项，不允许迁移修改"),
  newValue: z.string().nullable(),
  outlineVersion: z.number().int().min(1).nullable().optional(),
  startChapterId: z.string().min(1).nullable().optional(),
  endChapterId: z.string().min(1).nullable().optional(),
  trigger: z.string().min(1).nullable().optional(),
  transitionGuidance: z.string().min(1).nullable().optional(),
  groupId: z.string().min(1).nullable().optional(),
});
export type NewCharacterMigration = z.infer<typeof newCharacterMigrationSchema>;

/** 编辑迁移入参（patch 语义：undefined = 不动，null = 清空）；migrateField 不可改（换字段即换迁移） */
export const characterMigrationPatchSchema = z.object({
  newValue: z.string().nullable().optional(),
  outlineVersion: z.number().int().min(1).nullable().optional(),
  startChapterId: z.string().min(1).nullable().optional(),
  endChapterId: z.string().min(1).nullable().optional(),
  trigger: z.string().min(1).nullable().optional(),
  transitionGuidance: z.string().min(1).nullable().optional(),
});
export type CharacterMigrationPatch = z.infer<typeof characterMigrationPatchSchema>;

/** 表单提交作为一次事务：新建或编辑，可同时确认；已确认记录的编辑保持生效。 */
export const saveCharacterMigrationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), input: newCharacterMigrationSchema, confirm: z.boolean() }),
  z.object({ action: z.literal("update"), migrationId: z.string().min(1), patch: characterMigrationPatchSchema, confirm: z.boolean() }),
]);
export type SaveCharacterMigration = z.infer<typeof saveCharacterMigrationSchema>;

/** 被修订前的迁移状态与发生修订的时间，用于陈旧范围判定。 */
export const characterMigrationVersionEntrySchema = z.object({
  id: z.string().min(1),
  migrationId: z.string().min(1),
  revision: z.number().int().min(1),
  migration: characterMigrationSchema,
  createdAt: z.string(),
});
export type CharacterMigrationVersionEntry = z.infer<typeof characterMigrationVersionEntrySchema>;

/** 迁移条目：迁移记录 + 库表主键与时间戳（查询契约与客户端清单用） */
export const characterMigrationEntrySchema = characterMigrationSchema.extend({
  id: z.string().min(1).describe("character_migrations 表主键（UUIDv7）"),
  createdAt: z.string().describe("创建时间（ISO 8601）"),
  updatedAt: z.string().describe("最近更新时间（ISO 8601）"),
});
export type CharacterMigrationEntry = z.infer<typeof characterMigrationEntrySchema>;

/** 字段值归一：trim；空串归一为 null（可选字段即「未设定 / 清空」） */
export function normalizeMigrationValue(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** 目标值校验：必填字段不可为空；返回错误信息或 null（合法） */
export function migrationValueError(
  field: CharacterFieldPath,
  value: string | null | undefined,
): string | null {
  const spec = CHARACTER_FIELD_SPECS[field];
  if (normalizeMigrationValue(value) === null) {
    return spec.required
      ? `字段「${spec.label}」为必填，目标值不能为空`
      : null;
  }
  return null;
}

/** 从角色卡读某字段的当前值（可选字段缺省为 null） */
export function readCharacterField(character: Character, field: CharacterFieldPath): string | null {
  switch (field) {
    case "basicInfo.name":
      return character.basicInfo.name;
    case "basicInfo.gender":
      return character.basicInfo.gender ?? null;
    case "basicInfo.appearance":
      return character.basicInfo.appearance ?? null;
    case "core.desire":
      return character.core.desire;
    case "core.fear":
      return character.core.fear;
    case "core.narrativeRole":
      return character.core.narrativeRole;
    case "background":
      return character.background;
    case "personality":
      return character.personality ?? null;
    case "characterGoal":
      return character.characterGoal ?? null;
    case "creationPurpose":
      return character.creationPurpose;
    case "trajectory":
      return character.trajectory ?? null;
    case "endingDirection":
      return character.endingDirection;
    case "relationships":
      return character.relationships ?? null;
  }
}

/**
 * 把某字段替换为新值，返回新角色卡（不改原对象）。
 * 必填字段不允许清空（抛可读错误）；调用方应先用 migrationValueError 校验。
 */
export function applyCharacterField(
  character: Character,
  field: CharacterFieldPath,
  value: string | null,
): Character {
  const spec = CHARACTER_FIELD_SPECS[field];
  if (value === null && spec.required) {
    throw new Error(`字段「${spec.label}」为必填，不能清空`);
  }
  const text = value ?? undefined;
  switch (field) {
    case "basicInfo.name":
      return { ...character, basicInfo: { ...character.basicInfo, name: value ?? "" } };
    case "basicInfo.gender":
      return { ...character, basicInfo: { ...character.basicInfo, gender: text } };
    case "basicInfo.appearance":
      return { ...character, basicInfo: { ...character.basicInfo, appearance: text } };
    case "core.desire":
      return { ...character, core: { ...character.core, desire: value ?? "" } };
    case "core.fear":
      return { ...character, core: { ...character.core, fear: value ?? "" } };
    case "core.narrativeRole":
      return { ...character, core: { ...character.core, narrativeRole: value ?? "" } };
    case "background":
      return { ...character, background: value ?? "" };
    case "personality":
      return { ...character, personality: text };
    case "characterGoal":
      return { ...character, characterGoal: text };
    case "creationPurpose":
      return { ...character, creationPurpose: value ?? "" };
    case "trajectory":
      return { ...character, trajectory: text };
    case "endingDirection":
      return { ...character, endingDirection: value ?? "" };
    case "relationships":
      return { ...character, relationships: text };
  }
}

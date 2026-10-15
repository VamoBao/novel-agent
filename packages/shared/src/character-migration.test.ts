import { describe, expect, test } from "bun:test";
import { characterSchema, type Character } from "./character";
import {
  CHARACTER_FIELD_PATHS,
  CHARACTER_FIELD_SPECS,
  applyCharacterField,
  characterMigrationSchema,
  newCharacterMigrationSchema,
  migrationValueError,
  newMigrationValueError,
  normalizeMigrationValue,
  readCharacterField,
} from "./character-migration";

function fullCharacter(): Character {
  return characterSchema.parse({
    basicInfo: { name: "陈默", gender: "男", appearance: "短发精瘦" },
    core: { desire: "打破垄断", fear: "辜负同伴", narrativeRole: "主角" },
    background: "青云市集散修",
    personality: "坚韧寡言",
    characterGoal: "建立散修联盟",
    creationPurpose: "承载主线",
    trajectory: "杂役 → 联盟开创者",
    endingDirection: "打破宗门垄断",
    relationships: "与柳三是搭档",
  });
}

describe("character-migration schema", () => {
  test("姓名迁移只允许历史读取，新建请求拒绝", () => {
    expect(newCharacterMigrationSchema.safeParse({ migrateField: "basicInfo.name", newValue: "陆隐" }).success).toBe(false);
  });
  test("字段路径覆盖角色卡全部叶子字段，且与 spec 一一对应", () => {
    // 全部 13 个叶子字段：3（basicInfo）+ 3（core）+ 7（顶层）
    expect(CHARACTER_FIELD_PATHS).toHaveLength(13);
    expect(Object.keys(CHARACTER_FIELD_SPECS)).toHaveLength(13);
    for (const field of CHARACTER_FIELD_PATHS) {
      expect(CHARACTER_FIELD_SPECS[field].label.length).toBeGreaterThan(0);
    }
    // 必填字段与 characterSchema 的 min(1) 约束一致
    const required = CHARACTER_FIELD_PATHS.filter((f) => CHARACTER_FIELD_SPECS[f].required);
    expect(required).toEqual([
      "basicInfo.name",
      "core.desire",
      "core.fear",
      "core.narrativeRole",
      "background",
      "creationPurpose",
      "endingDirection",
    ]);
  });

  test("normalizeMigrationValue：trim 与空串归一为 null", () => {
    expect(normalizeMigrationValue("  谨慎  ")).toBe("谨慎");
    expect(normalizeMigrationValue("   ")).toBeNull();
    expect(normalizeMigrationValue("")).toBeNull();
    expect(normalizeMigrationValue(null)).toBeNull();
    expect(normalizeMigrationValue(undefined)).toBeNull();
  });

  test("migrationValueError：必填字段不可为空，可选字段可清空", () => {
    expect(migrationValueError("core.desire", "谨慎")).toBeNull();
    expect(migrationValueError("core.desire", null)).toContain("必填");
    expect(migrationValueError("core.desire", "   ")).toContain("必填");
    expect(migrationValueError("personality", null)).toBeNull();
    expect(migrationValueError("personality", "谨慎")).toBeNull();
  });

  test("newMigrationValueError：新增迁移目标值一律不可为空（不区分必填 / 可选字段）", () => {
    expect(newMigrationValueError("谨慎")).toBeNull();
    expect(newMigrationValueError("  谨慎  ")).toBeNull();
    expect(newMigrationValueError("   ")).toBe("目标值不能为空");
    expect(newMigrationValueError("")).toBe("目标值不能为空");
    expect(newMigrationValueError(null)).toBe("目标值不能为空");
    expect(newMigrationValueError(undefined)).toBe("目标值不能为空");
  });

  test("readCharacterField / applyCharacterField 往返：每个字段都可读可写", () => {
    const base = fullCharacter();
    for (const field of CHARACTER_FIELD_PATHS) {
      const before = readCharacterField(base, field);
      expect(typeof before === "string" || before === null).toBe(true);
      const next = applyCharacterField(base, field, `${CHARACTER_FIELD_SPECS[field].label}新值`);
      expect(readCharacterField(next, field)).toBe(`${CHARACTER_FIELD_SPECS[field].label}新值`);
      // 不改原对象；其余字段保持不变
      expect(readCharacterField(base, field)).toBe(before);
      const other = CHARACTER_FIELD_PATHS.find((f) => f !== field);
      expect(other === undefined || readCharacterField(next, other) === readCharacterField(base, other)).toBe(true);
      // 结果仍是合法角色卡
      expect(characterSchema.safeParse(next).success).toBe(true);
    }
  });

  test("applyCharacterField：可选字段可清空为 null，必填字段清空抛错", () => {
    const base = fullCharacter();
    expect(readCharacterField(applyCharacterField(base, "personality", null), "personality")).toBeNull();
    expect(() => applyCharacterField(base, "core.desire", null)).toThrow("不能清空");
  });

  test("characterMigrationSchema：合法记录通过，非法字段路径 / 序号被拒", () => {
    const record = {
      novelId: "n1",
      characterId: "c1",
      outlineVersion: null,
      migrateField: "personality" as const,
      oldValue: "坚韧寡言",
      newValue: "谨慎",
      startChapterId: null,
      endChapterId: null,
      trigger: null,
      transitionGuidance: null,
      sequence: 1,
      revision: 1,
      status: "draft" as const,
      groupId: null,
    };
    expect(characterMigrationSchema.safeParse(record).success).toBe(true);
    expect(characterMigrationSchema.safeParse({ ...record, migrateField: "unknown" }).success).toBe(false);
    expect(characterMigrationSchema.safeParse({ ...record, sequence: 0 }).success).toBe(false);
    expect(characterMigrationSchema.safeParse({ ...record, status: "pending" }).success).toBe(false);
  });
});

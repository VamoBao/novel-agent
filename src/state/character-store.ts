import type { Database } from "bun:sqlite";
import { characterSchema, type Character } from "../schemas";
import { DEFAULT_DB_PATH, getDefaultDatabase, openDatabase } from "./db";
import { generateUuidV7 } from "./id";

/** 数据库中的角色记录：角色卡 + 库表元信息（id 为 UUIDv7） */
export interface StoredCharacter {
  id: string;
  novelId: string;
  createdAt: string;
  character: Character;
}

/** characters 表行结构（列名与 characterSchema 平铺字段对应） */
interface CharacterRow {
  id: string;
  novel_id: string;
  name: string;
  gender: string | null;
  appearance: string | null;
  desire: string;
  fear: string;
  narrative_role: string;
  background: string;
  personality: string | null;
  character_goal: string | null;
  creation_purpose: string;
  trajectory: string | null;
  ending_direction: string;
  relationships: string | null;
  created_at: string;
}

const INSERT_SQL = `
  INSERT INTO characters (
    id, novel_id, name, gender, appearance, desire, fear, narrative_role,
    background, personality, character_goal, creation_purpose,
    trajectory, ending_direction, relationships, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
`;

const SELECT_SQL = `
  SELECT id, novel_id, name, gender, appearance, desire, fear, narrative_role,
         background, personality, character_goal, creation_purpose,
         trajectory, ending_direction, relationships, created_at
  FROM characters WHERE novel_id = ? ORDER BY created_at ASC, id ASC;
`;

function rowToCharacter(row: CharacterRow): Character {
  // 列值经 schema 还原为角色卡结构，读侧同样过 zod 校验（库内数据完整性兜底）
  return characterSchema.parse({
    basicInfo: {
      name: row.name,
      gender: row.gender ?? undefined,
      appearance: row.appearance ?? undefined,
    },
    core: {
      desire: row.desire,
      fear: row.fear,
      narrativeRole: row.narrative_role,
    },
    background: row.background,
    personality: row.personality ?? undefined,
    characterGoal: row.character_goal ?? undefined,
    creationPurpose: row.creation_purpose,
    trajectory: row.trajectory ?? undefined,
    endingDirection: row.ending_direction,
    relationships: row.relationships ?? undefined,
  });
}

/**
 * 角色持久化：按创作 ID 绑定存储角色卡。
 * 内核/背景/创作目的/结局方向为固定属性，角色确认后只增不改。
 */
export class CharacterStore {
  /** 共享数据库连接构造（与其他 store 同库不同表） */
  constructor(private readonly db: Database) {}

  static open(path: string = DEFAULT_DB_PATH): CharacterStore {
    return new CharacterStore(openDatabase(path));
  }

  /** 写入角色（先过 schema 校验），返回带库表元信息的记录 */
  addCharacter(novelId: string, character: Character): StoredCharacter {
    const validated = characterSchema.parse(character);
    const id = generateUuidV7();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(INSERT_SQL)
      .run(
        id,
        novelId,
        validated.basicInfo.name,
        validated.basicInfo.gender ?? null,
        validated.basicInfo.appearance ?? null,
        validated.core.desire,
        validated.core.fear,
        validated.core.narrativeRole,
        validated.background,
        validated.personality ?? null,
        validated.characterGoal ?? null,
        validated.creationPurpose,
        validated.trajectory ?? null,
        validated.endingDirection,
        validated.relationships ?? null,
        createdAt,
      );
    return {
      id,
      novelId,
      createdAt,
      character: validated,
    };
  }

  /** 取某本小说的全部角色（按入库顺序） */
  listCharacters(novelId: string): StoredCharacter[] {
    const rows = this.db.prepare(SELECT_SQL).all(novelId) as CharacterRow[];
    return rows.map((row) => ({
      id: row.id,
      novelId: row.novel_id,
      createdAt: row.created_at,
      character: rowToCharacter(row),
    }));
  }

  close(): void {
    this.db.close();
  }
}

let defaultStore: CharacterStore | undefined;

/** 默认全局 store（懒加载，与其他 store 共享默认数据库连接） */
export function getDefaultCharacterStore(): CharacterStore {
  defaultStore ??= new CharacterStore(getDefaultDatabase());
  return defaultStore;
}

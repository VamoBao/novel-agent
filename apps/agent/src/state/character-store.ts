import type { Database } from "bun:sqlite";
import { characterSchema, type Character } from "@novel/shared";
import { DEFAULT_DB_PATH, getDefaultDatabase, openDatabase } from "./db";
import { generateUuidV7 } from "./id";

/** 数据库中的角色记录：角色卡 + 库表元信息（id 为 UUIDv7；version 为当前版本号；
 *  updatedAt 为最近更新时间——编辑提交刷新，客户端据此判断已生成正文是否早于角色设定更新） */
export interface StoredCharacter {
  id: string;
  novelId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
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
  version: number;
  created_at: string;
  updated_at: string;
}

const CARD_COLUMNS = `
  id, novel_id, name, gender, appearance, desire, fear, narrative_role,
  background, personality, character_goal, creation_purpose,
  trajectory, ending_direction, relationships, version, created_at, updated_at
`;

const INSERT_SQL = `
  INSERT INTO characters (
    id, novel_id, name, gender, appearance, desire, fear, narrative_role,
    background, personality, character_goal, creation_purpose,
    trajectory, ending_direction, relationships, version, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?);
`;

const SELECT_SQL = `
  SELECT ${CARD_COLUMNS} FROM characters WHERE novel_id = ? ORDER BY created_at ASC, id ASC;
`;

const SELECT_BY_ID_SQL = `
  SELECT ${CARD_COLUMNS} FROM characters WHERE id = ?;
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
 * 角色首次入库的第一版即**固定基准**——基准卡只增不改（旧 update-character 版本化
 * 编辑路径已退役），人物后续变化一律经 `character_migrations` 迁移计划表达
 * （见 migration-store）。`character_versions` 保留历史编辑快照供 18→19 升级导入
 * 与追溯，运行期不再写入。
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
    const now = new Date().toISOString();
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
        now,
        now,
      );
    return {
      id,
      novelId,
      createdAt: now,
      updatedAt: now,
      version: 1,
      character: validated,
    };
  }

  /** 取单个角色（按主键）；不存在返回 null */
  getCharacter(characterId: string): StoredCharacter | null {
    const row = this.db.prepare(SELECT_BY_ID_SQL).get(characterId) as CharacterRow | null;
    return row
      ? {
          id: row.id,
          novelId: row.novel_id,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          version: row.version,
          character: rowToCharacter(row),
        }
      : null;
  }

  /** 取某本小说的全部角色（按入库顺序） */
  listCharacters(novelId: string): StoredCharacter[] {
    const rows = this.db.prepare(SELECT_SQL).all(novelId) as CharacterRow[];
    return rows.map((row) => ({
      id: row.id,
      novelId: row.novel_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
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

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CharacterStore } from "./character-store";
import { NovelStore } from "./novel-store";
import { characterSchema, type Character } from "@novel/shared";

let tempDir: string;

afterAll(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

const V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function makeCharacter(name: string): Character {
  return characterSchema.parse({
    basicInfo: { name, gender: "男", appearance: "短发精瘦" },
    core: { desire: `${name}的渴望`, fear: "辜负同伴", narrativeRole: "主角" },
    background: "青云市集的散修少年",
    personality: "坚韧寡言",
    characterGoal: "建立散修联盟",
    creationPurpose: "承载打破垄断的主线",
    trajectory: "杂役 → 联盟开创者",
    endingDirection: "打破宗门垄断",
    relationships: "与柳三是搭档",
  });
}

/** FK 依赖：characters.novel_id 关联 novels.id，须先建小说行 */
function setup(dbPath: string, novelId: string): CharacterStore {
  NovelStore.open(dbPath).createNovel({ id: novelId });
  return CharacterStore.open(dbPath);
}

describe("CharacterStore", () => {
  test("addCharacter 入库后 listCharacters 按顺序取回且通过 schema 校验", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "novel-char-db-"));
    const dbPath = join(tempDir, "test.db");
    const novelId = "11111111-2222-7333-8444-555566667777";
    const store = setup(dbPath, novelId);

    const a = store.addCharacter(novelId, makeCharacter("陈默"));
    store.addCharacter(novelId, makeCharacter("柳三"));
    expect(a.id).toMatch(V7_RE);

    const listed = store.listCharacters(novelId);
    expect(listed).toHaveLength(2);
    expect(listed.map((s) => s.character.basicInfo.name)).toEqual(["陈默", "柳三"]);
    expect(listed[0]?.novelId).toBe(novelId);
    expect(listed[0]?.character.core.narrativeRole).toBe("主角");
    expect(listed[0]?.character.relationships).toBe("与柳三是搭档");
    store.close();
  });

  test("novel_id 外键约束：不存在的小说 ID 插入被拒绝", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-char-db-fk-"));
    const dbPath = join(dir, "test.db");
    const store = setup(dbPath, "11111111-2222-7333-8444-555566667778");
    expect(() =>
      store.addCharacter("11111111-2222-7333-8444-ffffffffffff", makeCharacter("孤儿角色")),
    ).toThrow();
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("不同创作 ID 的角色相互隔离", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-char-db2-"));
    const dbPath = join(dir, "test.db");
    const idA = "aaaaaaaa-0000-7000-8000-000000000001";
    const idB = "aaaaaaaa-0000-7000-8000-000000000002";
    const store = setup(dbPath, idA);
    NovelStore.open(dbPath).createNovel({ id: idB });
    store.addCharacter(idA, makeCharacter("甲"));
    store.addCharacter(idA, makeCharacter("乙"));
    store.addCharacter(idB, makeCharacter("丙"));
    expect(store.listCharacters(idA)).toHaveLength(2);
    expect(store.listCharacters(idB).map((s) => s.character.basicInfo.name)).toEqual(["丙"]);
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("可选字段缺省时入库取回仍为 undefined（null/undefined 往返正确）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-char-db3-"));
    const dbPath = join(dir, "test.db");
    const novelId = "bbbbbbbb-0000-7000-8000-000000000001";
    const store = setup(dbPath, novelId);
    const minimal = characterSchema.parse({
      basicInfo: { name: "灰袍人" },
      core: { desire: "夺回神器", fear: "身份暴露", narrativeRole: "反派" },
      background: "前朝国师",
      creationPurpose: "逼迫主角觉醒",
      endingDirection: "被主角击败",
    });
    store.addCharacter(novelId, minimal);
    const got = store.listCharacters(novelId);
    expect(got[0]?.character.personality).toBeUndefined();
    expect(got[0]?.character.basicInfo.gender).toBeUndefined();
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("重开数据库后数据仍在（真实持久化）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-char-db4-"));
    const dbPath = join(dir, "persist.db");
    const novelId = "cccccccc-0000-7000-8000-000000000001";
    const s1 = setup(dbPath, novelId);
    s1.addCharacter(novelId, makeCharacter("陈默"));
    s1.close();

    const s2 = CharacterStore.open(dbPath);
    const listed = s2.listCharacters(novelId);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.character.basicInfo.name).toBe("陈默");
    expect(listed[0]?.character.creationPurpose).toBe("承载打破垄断的主线");
    s2.close();
    await rm(dir, { recursive: true, force: true });
  });
});

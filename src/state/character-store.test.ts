import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CharacterStore } from "./character-store";
import { characterSchema, type Character } from "../schemas";

let tempDir: string;

afterAll(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

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

describe("CharacterStore", () => {
  test("addCharacter 入库后 listCharacters 按顺序取回且通过 schema 校验", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "novel-char-db-"));
    const store = CharacterStore.open(join(tempDir, "test.db"));

    const novelId = "11111111-2222-4333-8444-555566667777";
    const a = store.addCharacter(novelId, makeCharacter("陈默"));
    store.addCharacter(novelId, makeCharacter("柳三"));
    expect(a.rowId).toBeGreaterThan(0);

    const listed = store.listCharacters(novelId);
    expect(listed).toHaveLength(2);
    expect(listed.map((s) => s.character.basicInfo.name)).toEqual(["陈默", "柳三"]);
    expect(listed[0]?.novelId).toBe(novelId);
    expect(listed[0]?.character.core.narrativeRole).toBe("主角");
    expect(listed[0]?.character.relationships).toBe("与柳三是搭档");
    store.close();
  });

  test("不同创作 ID 的角色相互隔离", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-char-db2-"));
    const store = CharacterStore.open(join(dir, "test.db"));
    const idA = "aaaaaaaa-0000-4000-8000-000000000001";
    const idB = "aaaaaaaa-0000-4000-8000-000000000002";
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
    const store = CharacterStore.open(join(dir, "test.db"));
    const minimal = characterSchema.parse({
      basicInfo: { name: "灰袍人" },
      core: { desire: "夺回神器", fear: "身份暴露", narrativeRole: "反派" },
      background: "前朝国师",
      creationPurpose: "逼迫主角觉醒",
      endingDirection: "被主角击败",
    });
    store.addCharacter("bbbbbbbb-0000-4000-8000-000000000001", minimal);
    const got = store.listCharacters("bbbbbbbb-0000-4000-8000-000000000001");
    expect(got[0]?.character.personality).toBeUndefined();
    expect(got[0]?.character.basicInfo.gender).toBeUndefined();
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("重开数据库后数据仍在（真实持久化）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-char-db4-"));
    const dbPath = join(dir, "persist.db");
    const novelId = "cccccccc-0000-4000-8000-000000000001";
    const s1 = CharacterStore.open(dbPath);
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

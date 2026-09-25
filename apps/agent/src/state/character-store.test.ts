import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
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

describe("CharacterStore 版本化编辑", () => {
  test("getCharacter 按主键取回 / 未命中返回 null", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-char-edit0-"));
    const dbPath = join(dir, "test.db");
    const novelId = "dddddddd-1000-7000-8000-000000000001";
    const store = setup(dbPath, novelId);
    const added = store.addCharacter(novelId, makeCharacter("陈默"));
    expect(added.version).toBe(1);

    const got = store.getCharacter(added.id);
    expect(got?.character.basicInfo.name).toBe("陈默");
    expect(got?.version).toBe(1);
    expect(got?.novelId).toBe(novelId);
    expect(store.getCharacter("ffffffff-0000-7000-8000-000000000001")).toBeNull();
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("updateCharacter 主行更新、version 递增、旧卡快照归档", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-char-edit1-"));
    const dbPath = join(dir, "test.db");
    const novelId = "dddddddd-2000-7000-8000-000000000001";
    const store = setup(dbPath, novelId);
    const added = store.addCharacter(novelId, makeCharacter("陈默"));

    const revised = characterSchema.parse({
      ...makeCharacter("陈默"),
      personality: "坚韧寡言，屡败屡战",
      background: "青云市集的散修少年，幼年失怙",
    });
    const updated = store.updateCharacter(novelId, added.id, revised);
    expect(updated.version).toBe(2);
    expect(updated.id).toBe(added.id);
    expect(updated.character.background).toBe("青云市集的散修少年，幼年失怙");

    // 再编辑一次：版本连续递增、快照两条（v1 与 v2）
    store.updateCharacter(novelId, added.id, makeCharacter("陈默"));
    expect(store.getCharacter(added.id)?.version).toBe(3);
    const raw = new Database(dbPath, { readonly: true });
    const snaps = raw
      .query("SELECT version, character FROM character_versions WHERE character_id = ? ORDER BY version ASC;")
      .all(added.id) as { version: number; character: string }[];
    expect(snaps.map((s) => s.version)).toEqual([1, 2]);
    expect((JSON.parse(snaps[0]!.character) as { background: string }).background).toBe(
      "青云市集的散修少年",
    );
    expect((JSON.parse(snaps[1]!.character) as { personality: string }).personality).toBe(
      "坚韧寡言，屡败屡战",
    );
    raw.close();

    // 列表读取反映主行最新值；id / novel_id / created_at 稳定
    const listed = store.listCharacters(novelId);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.version).toBe(3);
    expect(listed[0]?.createdAt).toBe(added.createdAt);
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("updateCharacter 角色不存在 / 异小说均报可读错误", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-char-edit2-"));
    const dbPath = join(dir, "test.db");
    const novelId = "dddddddd-3000-7000-8000-000000000001";
    const otherNovelId = "dddddddd-3000-7000-8000-000000000002";
    const store = setup(dbPath, novelId);
    NovelStore.open(dbPath).createNovel({ id: otherNovelId });
    const added = store.addCharacter(novelId, makeCharacter("陈默"));

    expect(() =>
      store.updateCharacter(novelId, "ffffffff-0000-7000-8000-000000000001", makeCharacter("影子")),
    ).toThrow("角色不存在，无法更新");
    expect(() =>
      store.updateCharacter(otherNovelId, added.id, makeCharacter("陈默")),
    ).toThrow("角色不属于该小说，无法更新");
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("updateCharacter 入参过不了 schema 时整体回滚（不留快照、主行不变）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-char-edit3-"));
    const dbPath = join(dir, "test.db");
    const novelId = "dddddddd-4000-7000-8000-000000000001";
    const store = setup(dbPath, novelId);
    const added = store.addCharacter(novelId, makeCharacter("陈默"));

    const invalid = { ...makeCharacter("陈默"), background: "" } as unknown as Character;
    expect(() => store.updateCharacter(novelId, added.id, invalid)).toThrow();

    expect(store.getCharacter(added.id)?.version).toBe(1);
    const raw = new Database(dbPath, { readonly: true });
    const count = raw.query("SELECT COUNT(*) AS c FROM character_versions").get() as { c: number };
    expect(count.c).toBe(0);
    raw.close();
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
});

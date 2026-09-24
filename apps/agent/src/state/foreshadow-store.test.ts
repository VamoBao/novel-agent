import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CharacterStore } from "./character-store";
import { ForeshadowStore } from "./foreshadow-store";
import { NovelStore } from "./novel-store";
import { characterSchema, foreshadowSchema, type Character, type Foreshadow } from "@novel/shared";

let tempDir: string;

afterAll(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

const V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const NOVEL_A = "11111111-2222-7333-8444-555566668001";
const NOVEL_B = "11111111-2222-7333-8444-555566668002";

let charA1: string;
let charA2: string;
let charB1: string;

/** FK 与角色校验依赖：伏笔挂 novel_id，服务角色校验查 characters 表 */
function setup(dbPath: string): ForeshadowStore {
  const novels = NovelStore.open(dbPath);
  novels.createNovel({ id: NOVEL_A });
  novels.createNovel({ id: NOVEL_B });
  novels.close();
  const characters = CharacterStore.open(dbPath);
  charA1 = characters.addCharacter(NOVEL_A, makeCharacter("陈默")).id;
  charA2 = characters.addCharacter(NOVEL_A, makeCharacter("老周")).id;
  charB1 = characters.addCharacter(NOVEL_B, makeCharacter("异界人")).id;
  characters.close();
  return ForeshadowStore.open(dbPath);
}

function makeCharacter(name: string): Character {
  return characterSchema.parse({
    basicInfo: { name },
    core: { desire: `${name}的渴望`, fear: "身份暴露", narrativeRole: "配角" },
    background: "北境边军旧部",
    creationPurpose: "承载伏笔的角色",
    endingDirection: "结局未定",
  });
}

function makeForeshadow(overrides: Partial<Foreshadow> = {}): Foreshadow {
  return foreshadowSchema.parse({
    surfaceAction: "老周把主角派去北境送信",
    hiddenTruth: "暗示老周已经投敌，借刀除掉主角",
    attentionLevel: 4,
    ...overrides,
  });
}

describe("ForeshadowStore", () => {
  test("add 入库后 list 按顺序取回：JSON 多值与全部字段无损往返", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "novel-fs-db-"));
    const dbPath = join(tempDir, "test.db");
    const store = setup(dbPath);

    const bare = store.addForeshadow(NOVEL_A, makeForeshadow());
    expect(bare.id).toMatch(V7_RE);
    expect(bare.foreshadow.recoveryStatus).toBe("unrecovered");

    const full = store.addForeshadow(
      NOVEL_A,
      makeForeshadow({
        surfaceAction: "客栈掌柜送出一枚旧铜牌",
        hiddenTruth: "铜牌是北境军的信物，暗示掌柜的旧军人身份",
        attentionLevel: 7,
        recoveryStatus: "partial",
        plantingMethod: "一个物件描述",
        purpose: "北境之战的引子",
        appearChapterId: "cccccccc-0000-7000-8000-0000000000c1",
        recoverChapterIds: [
          "cccccccc-0000-7000-8000-0000000000d1",
          "cccccccc-0000-7000-8000-0000000000d2",
        ],
        characterIds: [charA1, charA2],
      }),
    );

    const listed = store.listForeshadows(NOVEL_A);
    expect(listed.map((s) => s.foreshadow.surfaceAction)).toEqual([
      "老周把主角派去北境送信",
      "客栈掌柜送出一枚旧铜牌",
    ]);
    const second = listed[1];
    expect(second?.id).toBe(full.id);
    expect(second?.foreshadow.attentionLevel).toBe(7);
    expect(second?.foreshadow.recoveryStatus).toBe("partial");
    expect(second?.foreshadow.recoverChapterIds).toHaveLength(2);
    expect(second?.foreshadow.characterIds).toEqual([charA1, charA2]);
    expect(second?.foreshadow.appearChapterId).toBe("cccccccc-0000-7000-8000-0000000000c1");
    // 伏笔只属于本小说，另一本小说列表为空
    expect(store.listForeshadows(NOVEL_B)).toEqual([]);
    store.close();
  });

  test("patch 回收状态流转与字段修订：值覆盖、null 清空、updated_at 盖章", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-fs-db-patch-"));
    const store = setup(join(dir, "test.db"));

    const created = store.addForeshadow(
      NOVEL_A,
      makeForeshadow({
        plantingMethod: "对话",
        recoverChapterIds: ["cccccccc-0000-7000-8000-0000000000d1"],
      }),
    );
    // updated_at 为毫秒精度 ISO，隔 20ms 保证 patch 后严格大于创建时（对齐其余 store 用例惯例）
    await new Promise((r) => setTimeout(r, 20));

    // 未回收 → 部分回收：追加回收章节，修订注意度
    const partial = store.updateForeshadow(created.id, {
      recoveryStatus: "partial",
      recoverChapterIds: [
        "cccccccc-0000-7000-8000-0000000000d1",
        "cccccccc-0000-7000-8000-0000000000d2",
      ],
      attentionLevel: 6,
    });
    expect(partial.foreshadow.recoveryStatus).toBe("partial");
    expect(partial.foreshadow.recoverChapterIds).toHaveLength(2);
    expect(partial.foreshadow.attentionLevel).toBe(6);
    expect(partial.foreshadow.plantingMethod).toBe("对话"); // 未提及字段不动

    // 部分回收 → 已回收：null 清空埋线方式与回收章节
    const done = store.updateForeshadow(created.id, {
      recoveryStatus: "recovered",
      plantingMethod: null,
      recoverChapterIds: null,
    });
    expect(done.foreshadow.recoveryStatus).toBe("recovered");
    expect(done.foreshadow.plantingMethod).toBeUndefined();
    expect(done.foreshadow.recoverChapterIds).toBeUndefined();
    expect(done.updatedAt > created.createdAt).toBe(true);

    // patch 不存在的伏笔抛可读错误；schema 越界在 patch 层被拒绝
    expect(() => store.updateForeshadow("eeeeeeee-0000-7000-8000-00000000dead", {})).toThrow(
      "伏笔不存在",
    );
    expect(() => store.updateForeshadow(created.id, { attentionLevel: 11 })).toThrow();
    store.close();
  });

  test("服务角色校验：不存在或属于其他小说时给可读错误", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-fs-db-char-"));
    const store = setup(join(dir, "test.db"));

    expect(() =>
      store.addForeshadow(NOVEL_A, makeForeshadow({ characterIds: ["eeeeeeee-0000-7000-8000-00000000bad"] })),
    ).toThrow("服务的角色不存在");
    expect(() =>
      store.addForeshadow(NOVEL_A, makeForeshadow({ characterIds: [charB1] })),
    ).toThrow("服务的角色属于其他小说");
    // patch 换绑服务角色同样校验：换成异界角色拒绝，换成本小说角色通过
    const created = store.addForeshadow(NOVEL_A, makeForeshadow());
    expect(() => store.updateForeshadow(created.id, { characterIds: [charB1] })).toThrow(
      "服务的角色属于其他小说",
    );
    store.updateForeshadow(created.id, { characterIds: [charA2] });
    expect(store.getForeshadow(created.id)?.foreshadow.characterIds).toEqual([charA2]);
    store.close();
  });

  test("schema 拒绝透传：空表面行为与越界注意度不入库", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-fs-db-schema-"));
    const store = setup(join(dir, "test.db"));

    expect(() => store.addForeshadow(NOVEL_A, makeForeshadow({ surfaceAction: "" }))).toThrow();
    expect(() => store.addForeshadow(NOVEL_A, makeForeshadow({ attentionLevel: 11 }))).toThrow();
    expect(store.listForeshadows(NOVEL_A)).toHaveLength(0);
    store.close();
  });

  test("delete 删除单条伏笔，重复删除抛可读错误", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-fs-db-del-"));
    const store = setup(join(dir, "test.db"));

    const created = store.addForeshadow(NOVEL_A, makeForeshadow());
    store.deleteForeshadow(created.id);
    expect(store.listForeshadows(NOVEL_A)).toHaveLength(0);
    expect(() => store.deleteForeshadow(created.id)).toThrow("伏笔不存在");
    store.close();
  });
});

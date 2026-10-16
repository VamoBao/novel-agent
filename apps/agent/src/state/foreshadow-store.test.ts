import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CharacterStore } from "./character-store";
import { ForeshadowStore } from "./foreshadow-store";
import { NovelStore } from "./novel-store";
import { openDatabase } from "./db";
import { OutlineStore } from "./outline-store";
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

describe("act_node_id 与 listUnboundByAct", () => {
  test("addForeshadow 第三参写入 act_node_id，缺省为 null", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-fs-act-"));
    const store = setup(join(dir, "t.db"));
    const stored = store.addForeshadow(NOVEL_A, makeForeshadow(), "act-node-1");
    expect(stored.actNodeId).toBe("act-node-1");
    expect(store.addForeshadow(NOVEL_A, makeForeshadow({ surfaceAction: "另一处伏笔" })).actNodeId).toBeNull();
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("listUnboundByAct：命中本幕未绑章；排除他幕 / 已绑章 / 无 act", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-fs-unbound-"));
    const store = setup(join(dir, "t.db"));
    store.addForeshadow(NOVEL_A, makeForeshadow(), "act-1");                                     // 命中
    store.addForeshadow(NOVEL_A, makeForeshadow({ surfaceAction: "已绑章的伏笔", appearChapterId: "ch-1" }), "act-1"); // 已绑章排除
    store.addForeshadow(NOVEL_A, makeForeshadow({ surfaceAction: "他幕的伏笔" }), "act-2");       // 他幕排除
    store.addForeshadow(NOVEL_A, makeForeshadow({ surfaceAction: "无幕的伏笔" }));               // 无 act 排除
    const unbound = store.listUnboundByAct(NOVEL_A, "act-1");
    expect(unbound.map((f) => f.foreshadow.surfaceAction)).toEqual(["老周把主角派去北境送信"]);
    expect(unbound[0]?.actNodeId).toBe("act-1");
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("listUnrecoveredByAct：命中回收幕=本幕且回收章为空；排除他幕 / 已绑回收章 / 无回收幕 / 无回收幕且已绑", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-fs-unrecovered-"));
    const path = join(dir, "t.db");
    const store = setup(path);
    // 已绑定的章必须真实属于目标幕，不能把任意其他章都视作已细化。
    const db = openDatabase(path);
    const outlines = new OutlineStore(db);
    const act = outlines.addOutlineNode(NOVEL_A, { type: "act", name: "回收幕", sort: 1 });
    db.prepare("UPDATE outlines SET id = 'act-9' WHERE id = ?").run(act.id);
    const chapter = outlines.addOutlineNode(NOVEL_A, { type: "chapter", name: "回收章", parentId: "act-9", sort: 1 });
    db.prepare("UPDATE outlines SET id = 'ch-9' WHERE id = ?").run(chapter.id);
    db.close();
    store.addForeshadow(NOVEL_A, makeForeshadow(), "act-1", "act-9");                            // 命中
    store.addForeshadow(
      NOVEL_A,
      makeForeshadow({ surfaceAction: "已绑回收章的伏笔", recoverChapterIds: ["ch-9"] }),
      "act-1",
      "act-9",
    );                                                                                           // 已绑回收章排除
    store.addForeshadow(NOVEL_A, makeForeshadow({ surfaceAction: "他幕回收的伏笔" }), "act-1", "act-8"); // 回收幕他幕排除
    store.addForeshadow(NOVEL_A, makeForeshadow({ surfaceAction: "无回收幕的伏笔" }), "act-1");  // 无回收幕排除
    const unrecovered = store.listUnrecoveredByAct(NOVEL_A, "act-9");
    expect(unrecovered.map((f) => f.foreshadow.surfaceAction)).toEqual(["老周把主角派去北境送信"]);
    expect(unrecovered[0]?.recoverActNodeId).toBe("act-9");
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("addForeshadow 第四参写入 recover_act_node_id，缺省为 null，往返无损", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-fs-recoveract-"));
    const store = setup(join(dir, "t.db"));
    const stored = store.addForeshadow(NOVEL_A, makeForeshadow(), "act-1", "act-3");
    expect(stored.recoverActNodeId).toBe("act-3");
    const noRecover = store.addForeshadow(NOVEL_A, makeForeshadow({ surfaceAction: "无回收幕" }), "act-1");
    expect(noRecover.recoverActNodeId).toBeNull();
    // patch 走既有 UPDATE_SQL（列不含回收幕，patch 不改回收幕——编辑面只编辑回收章）
    const patched = store.updateForeshadow(stored.id, { plantingMethod: "对话" });
    expect(patched.recoverActNodeId).toBe("act-3");
    expect(patched.foreshadow.plantingMethod).toBe("对话");
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
});



describe("多幕回收存储", () => {
  test("数组回收计划重开往返、旧单幕参数兼容，编辑伏笔不改回收幕", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-fs-multiact-"));
    const path = join(dir, "test.db");
    const store = setup(path);
    const multiple = store.addForeshadow(NOVEL_A, makeForeshadow(), "plant", ["recover-1", "recover-2"]);
    const single = store.addForeshadow(NOVEL_A, makeForeshadow(), "plant", "recover-3");
    const none = store.addForeshadow(NOVEL_A, makeForeshadow());
    expect(multiple.recoverActNodeIds).toEqual(["recover-1", "recover-2"]);
    expect(multiple.recoverActNodeId).toBe("recover-1");
    expect(single.recoverActNodeIds).toEqual(["recover-3"]);
    expect(none.recoverActNodeIds).toEqual([]);
    store.close();
    const reopened = ForeshadowStore.open(path);
    try {
      expect(reopened.getForeshadow(multiple.id)?.recoverActNodeIds).toEqual(["recover-1", "recover-2"]);
      expect(reopened.updateForeshadow(multiple.id, { hiddenTruth: "修订真相" }).recoverActNodeIds).toEqual(["recover-1", "recover-2"]);
      expect(reopened.getForeshadow(single.id)?.recoverActNodeId).toBe("recover-3");
      expect(reopened.getForeshadow(none.id)?.recoverActNodeId).toBeNull();
    } finally { reopened.close(); await rm(dir, { recursive: true, force: true }); }
  });

  test("按幕分别判断待办，其他幕已绑定回收章不隐藏后续幕", () => {
    const db = openDatabase(":memory:");
    const novelId = new NovelStore(db).createNovel({}).id;
    const otherNovelId = new NovelStore(db).createNovel({}).id;
    const outlines = new OutlineStore(db);
    const act1 = outlines.addOutlineNode(novelId, { type: "act", name: "前幕", sort: 1 });
    const act2 = outlines.addOutlineNode(novelId, { type: "act", name: "后幕", sort: 2 });
    const chapter1 = outlines.addOutlineNode(novelId, { type: "chapter", name: "阶段回收", parentId: act1.id, sort: 1 });
    const chapter2 = outlines.addOutlineNode(novelId, { type: "chapter", name: "最终回收", parentId: act2.id, sort: 1 });
    const store = new ForeshadowStore(db);
    try {
      const fs = store.addForeshadow(novelId, makeForeshadow(), undefined, [act1.id, act2.id]);
      expect(store.listUnrecoveredByAct(novelId, act1.id).map((f) => f.id)).toEqual([fs.id]);
      expect(store.listUnrecoveredByAct(novelId, act2.id).map((f) => f.id)).toEqual([fs.id]);
      store.updateForeshadow(fs.id, { recoverChapterIds: [chapter1.id] });
      expect(store.listUnrecoveredByAct(novelId, act1.id)).toEqual([]);
      expect(store.listUnrecoveredByAct(novelId, act2.id).map((f) => f.id)).toEqual([fs.id]);
      expect(store.listUnrecoveredByAct(otherNovelId, act2.id)).toEqual([]);
      store.updateForeshadow(fs.id, { recoverChapterIds: [chapter1.id, chapter2.id] });
      expect(store.listUnrecoveredByAct(novelId, act2.id)).toEqual([]);
      store.updateForeshadow(fs.id, { recoverChapterIds: ["missing-chapter"] });
      expect(store.listUnrecoveredByAct(novelId, act2.id).map((f) => f.id)).toEqual([fs.id]);
    } finally { db.close(); }
  });

  test("损坏回收幕 JSON 给出定位错误，不静默回落旧单幕", () => {
    const db = openDatabase(":memory:");
    const novelId = new NovelStore(db).createNovel({}).id;
    const store = new ForeshadowStore(db);
    try {
      const fs = store.addForeshadow(novelId, makeForeshadow(), undefined, ["act-1", "act-2"]);
      for (const invalid of ["broken", "null", "{}", '[1]', '[""]']) {
        db.prepare("UPDATE foreshadows SET recover_act_node_ids = ? WHERE id = ?").run(invalid, fs.id);
        expect(() => store.getForeshadow(fs.id)).toThrow("recover_act_node_ids");
      }
    } finally { db.close(); }
  });
});


test("编辑修订号区分用户修改与工作流自动绑定，重开保持，失败不递增", async () => {
  const dir = await mkdtemp(join(tmpdir(), "novel-fs-edit-revision-"));
  const path = join(dir, "test.db");
  const db = openDatabase(path);
  const novelId = new NovelStore(db).createNovel({}).id;
  const store = new ForeshadowStore(db);
  try {
    const created = store.addForeshadow(novelId, makeForeshadow(), undefined, ["act-1", "act-2"]);
    expect(created.editRevision).toBe(0);
    db.prepare("UPDATE foreshadows SET updated_at = '2000-01-01' WHERE id = ?").run(created.id);
    const automatic = store.updateForeshadow(created.id, { recoverChapterIds: ["chapter-first"] }, { source: "workflow" });
    expect(automatic.editRevision).toBe(0);
    expect(automatic.updatedAt).not.toBe("2000-01-01");
    expect(automatic.foreshadow.recoverChapterIds).toEqual(["chapter-first"]);
    const manual = store.updateForeshadow(created.id, { hiddenTruth: "用户指定的真相" });
    expect(manual.editRevision).toBe(1);
    const nextAuto = store.updateForeshadow(created.id, { recoverChapterIds: ["chapter-first", "chapter-final"] }, { source: "workflow" });
    expect(nextAuto.editRevision).toBe(1);
    expect(nextAuto.foreshadow.hiddenTruth).toBe("用户指定的真相");
    // 默认普通更新即使内容未变化也代表一次编辑；失败则不留修订号副作用。
    expect(store.updateForeshadow(created.id, {}, {}).editRevision).toBe(2);
    expect(() => store.updateForeshadow(created.id, { attentionLevel: 11 })).toThrow();
    expect(store.getForeshadow(created.id)?.editRevision).toBe(2);
    const reopened = ForeshadowStore.open(path);
    try {
      expect(reopened.getForeshadow(created.id)?.editRevision).toBe(2);
      expect(reopened.listForeshadows(novelId)[0]?.editRevision).toBe(2);
      expect(reopened.listUnboundByAct(novelId, "missing")).toEqual([]);
    } finally { reopened.close(); }
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});

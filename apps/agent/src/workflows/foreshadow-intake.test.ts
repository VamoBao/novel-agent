import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../state/db";
import { NovelStore } from "../state/novel-store";
import { CharacterStore, type StoredCharacter } from "../state/character-store";
import { ForeshadowStore } from "../state/foreshadow-store";
import { FakeChannel } from "../ui/fake-channel";

const { plantOutlineForeshadows, plantChapterForeshadows, resolveCharacterIds, buildChapterOrder } = await import("./foreshadow-intake");

const NOVEL = "n-foreshadow-1";
let tempDir: string;
afterAll(async () => { if (tempDir) await rm(tempDir, { recursive: true, force: true }); });

const baseItem = {
  surfaceAction: "老周把主角派去北境送信",
  hiddenTruth: "暗示老周已经投敌，借刀除掉主角",
  attentionLevel: 4,
};

describe("resolveCharacterIds", () => {
  const characters = [
    { id: "c-1", name: "陈默" },
    { id: "c-2", name: "老周" },
  ];
  test("trim 全等解析；未解析名单返回；重复名幂等", () => {
    expect(resolveCharacterIds(["陈默", " 老周 ", "无名氏", "陈默"], characters)).toEqual({
      ids: ["c-1", "c-2"],
      unresolved: ["无名氏"],
    });
  });
});

describe("plantOutlineForeshadows", () => {
  test("正常入库绑幕与角色；幕未匹配跳过整条；服务角色全失败跳过、部分失败剔除并警告", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "novel-intake-outline-"));
    const db = openDatabase(join(tempDir, "t.db"));
    new NovelStore(db).createNovel({ id: NOVEL });
    const characterStore = new CharacterStore(db);
    const chen = characterStore.addCharacter(NOVEL, makeCharacter("陈默"));
    const zhou = characterStore.addCharacter(NOVEL, makeCharacter("老周"));
    const characters: StoredCharacter[] = [chen, zhou];
    const store = new ForeshadowStore(db);
    const channel = new FakeChannel([]);
    const actNodes = [
      { id: "act-1", name: "第1幕" },
      { id: "act-2", name: "第2幕" },
    ];

    const result = plantOutlineForeshadows({
      novelId: NOVEL,
      newForeshadows: [
        { ...baseItem, characterNames: ["陈默", "老周"], actName: "第1幕" },
        { ...baseItem, surfaceAction: "幕名漂移的伏笔", characterNames: ["陈默"], actName: "不存在的幕" },
        { ...baseItem, surfaceAction: "角色全失败的伏笔", characterNames: ["无名氏"], actName: "第2幕" },
        { ...baseItem, surfaceAction: "角色部分失败的伏笔", characterNames: ["老周", "路人们"], actName: "第2幕" },
      ],
      characters,
      actNodes,
      channel,
      foreshadowStore: store,
    });

    expect(result).toEqual({ created: 2, skipped: 2 });
    const all = store.listForeshadows(NOVEL);
    expect(all.map((f) => f.foreshadow.surfaceAction)).toEqual([baseItem.surfaceAction, "角色部分失败的伏笔"]);
    expect(all[0]?.actNodeId).toBe("act-1");
    expect(all[0]?.foreshadow.characterIds).toEqual([chen.id, zhou.id]);
    expect(all[0]?.foreshadow.recoveryStatus).toBe("unrecovered");
    expect(all[1]?.foreshadow.characterIds).toEqual([zhou.id]);
    expect(channel.notifies.some((n) => n.includes("幕「不存在的幕」未在大纲中找到"))).toBe(true);
    expect(channel.notifies.some((n) => n.includes("服务角色全部无法解析"))).toBe(true);
    expect(channel.notifies.some((n) => n.includes("未解析服务角色已剔除：路人们"))).toBe(true);
    expect(channel.notifies.some((n) => n.includes("伏笔已入库"))).toBe(true);
    db.close();
  });
});

describe("plantChapterForeshadows", () => {
  test("新伏笔带登场章与幕入库；绑定序号越界/章名未匹配跳过；服务角色全失败跳过、部分失败剔除；合法绑定 patch appearChapterId", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "novel-intake-chapter-"));
    const db = openDatabase(join(tempDir, "t.db"));
    new NovelStore(db).createNovel({ id: NOVEL });
    const characterStore = new CharacterStore(db);
    const chen = characterStore.addCharacter(NOVEL, makeCharacter("陈默"));
    const store = new ForeshadowStore(db);
    const channel = new FakeChannel([]);
    const unbound = [
      store.addForeshadow(NOVEL, { ...baseItem, recoveryStatus: "unrecovered" } as never, "act-1"),
      store.addForeshadow(NOVEL, { ...baseItem, surfaceAction: "第二条未绑伏笔", recoveryStatus: "unrecovered" } as never, "act-1"),
    ];
    const chapterNodes = [
      { id: "ch-1", name: "第一章·雨夜" },
      { id: "ch-2", name: "第二章·来客" },
    ];

    const result = plantChapterForeshadows({
      novelId: NOVEL,
      actNodeId: "act-1",
      newForeshadows: [
        { ...baseItem, surfaceAction: "章节新伏笔", characterNames: ["陈默"], chapterName: "第二章·来客" },
        { ...baseItem, surfaceAction: "章名漂移的新伏笔", characterNames: ["陈默"], chapterName: "不存在的章" },
        { ...baseItem, surfaceAction: "角色全失败的新伏笔", characterNames: ["无名氏"], chapterName: "第二章·来客" },
        { ...baseItem, surfaceAction: "角色部分失败的新伏笔", characterNames: ["陈默", "路人乙"], chapterName: "第一章·雨夜" },
      ],
      bindings: [
        { index: 1, chapterName: "第一章·雨夜" },
        { index: 9, chapterName: "第一章·雨夜" },
        { index: 2, chapterName: "不存在的章" },
      ],
      recoverBindings: [],
      recoverable: [],
      characters: [chen],
      chapterNodes,
      allChapterNodes: [
        { id: "act-1", parentId: "part-1", type: "act", sort: 1 },
        { id: "ch-1", parentId: "act-1", type: "chapter", sort: 1 },
        { id: "ch-2", parentId: "act-1", type: "chapter", sort: 2 },
      ],
      unbound,
      channel,
      foreshadowStore: store,
    });

    // 注：本场景共 4 处跳过（新伏笔章名未匹配 1 + 新伏笔服务角色全失败 1 + 绑定序号越界与章名未匹配 2）——
    // 按实现的「每条目必落一桶」计数语义计（含随分支覆盖新增的服务角色全失败 1 处）
    expect(result).toEqual({ created: 2, skipped: 4, bound: 1, recoverBound: 0 });
    const all = store.listForeshadows(NOVEL);
    // 名单顺序 = 入库顺序：两条未绑种子（前）→ 章节新伏笔 → 角色部分失败的新伏笔
    expect(all.map((f) => f.foreshadow.surfaceAction)).toEqual([
      baseItem.surfaceAction,
      "第二条未绑伏笔",
      "章节新伏笔",
      "角色部分失败的新伏笔",
    ]);
    const createdRow = all.find((f) => f.foreshadow.surfaceAction === "章节新伏笔");
    expect(createdRow?.actNodeId).toBe("act-1");
    expect(createdRow?.foreshadow.appearChapterId).toBe("ch-2");
    expect(createdRow?.foreshadow.characterIds).toEqual([chen.id]);
    // 服务角色部分失败：入库但 characterIds 只含可解析的陈默，路人乙被剔除并警告
    const partialRow = all.find((f) => f.foreshadow.surfaceAction === "角色部分失败的新伏笔");
    expect(partialRow?.foreshadow.appearChapterId).toBe("ch-1");
    expect(partialRow?.foreshadow.characterIds).toEqual([chen.id]);
    expect(store.getForeshadow(unbound[0]!.id)?.foreshadow.appearChapterId).toBe("ch-1");
    expect(store.getForeshadow(unbound[1]!.id)?.foreshadow.appearChapterId).toBeUndefined();
    expect(store.listUnboundByAct(NOVEL, "act-1").map((f) => f.foreshadow.surfaceAction)).toEqual(["第二条未绑伏笔"]);
    expect(channel.notifies.some((n) => n.includes("序号 9 越界"))).toBe(true);
    // 服务角色全失败：整条跳过并警告；部分失败：剔除未解析名单并警告
    expect(channel.notifies.some((n) => n.includes("服务角色全部无法解析"))).toBe(true);
    expect(channel.notifies.some((n) => n.includes("未解析服务角色已剔除：路人乙"))).toBe(true);
    db.close();
  });
});

function makeCharacter(name: string) {
  return {
    basicInfo: { name },
    core: { desire: `${name}的渴望`, fear: "身份暴露", narrativeRole: "配角" },
    background: "北境边军旧部",
    creationPurpose: "承载伏笔的角色",
    endingDirection: "结局未定",
  };
}

describe("buildChapterOrder", () => {
  test("部→幕→章深度优先展开，章 ID 得全局序（跨幕可比）", () => {
    const order = buildChapterOrder([
      { id: "p2", parentId: null, type: "part", sort: 2 },
      { id: "p1", parentId: null, type: "part", sort: 1 },
      { id: "a1-2", parentId: "p1", type: "act", sort: 2 },
      { id: "a1-1", parentId: "p1", type: "act", sort: 1 },
      { id: "a2-1", parentId: "p2", type: "act", sort: 1 },
      { id: "c1-1-2", parentId: "a1-1", type: "chapter", sort: 2 },
      { id: "c1-1-1", parentId: "a1-1", type: "chapter", sort: 1 },
      { id: "c1-2-1", parentId: "a1-2", type: "chapter", sort: 1 },
      { id: "c2-1-1", parentId: "a2-1", type: "chapter", sort: 1 },
    ]);
    expect(order.get("c1-1-1")).toBe(1);
    expect(order.get("c1-1-2")).toBe(2);
    expect(order.get("c1-2-1")).toBe(3);
    expect(order.get("c2-1-1")).toBe(4);
    expect(order.size).toBe(4);
  });
});

describe("伏笔回收链路", () => {
  test("plantOutlineForeshadows：recoverActName 匹配挂回收幕；幕名漂移伏笔照常入库、回收幕留空并警告", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-intake-recover-outline-"));
    tempDir = tempDir || dir;
    const db = openDatabase(join(dir, "t.db"));
    new NovelStore(db).createNovel({ id: NOVEL });
    const chen = new CharacterStore(db).addCharacter(NOVEL, makeCharacter("陈默"));
    const store = new ForeshadowStore(db);
    const channel = new FakeChannel([]);
    const actNodes = [
      { id: "act-1", name: "第1幕" },
      { id: "act-3", name: "第3幕" },
    ];

    plantOutlineForeshadows({
      novelId: NOVEL,
      newForeshadows: [
        { ...baseItem, characterNames: ["陈默"], actName: "第1幕", recoverActName: "第3幕" },
        { ...baseItem, surfaceAction: "回收幕漂移的伏笔", characterNames: ["陈默"], actName: "第1幕", recoverActName: "不存在的幕" },
      ],
      characters: [chen],
      actNodes,
      channel,
      foreshadowStore: store,
    });

    const rows = store.listForeshadows(NOVEL);
    expect(rows[0]?.recoverActNodeId).toBe("act-3");
    expect(rows[1]?.recoverActNodeId).toBeNull();
    expect(rows).toHaveLength(2);
    expect(channel.notifies.some((n) => n.includes("回收幕「不存在的幕」未在大纲中找到"))).toBe(true);
    db.close();
  });

  test("plantChapterForeshadows 回收绑定：成功（含同伏笔多章）；越界/章名漂移/登场未绑/回收早于登场逐条跳过；登场绑定对称校验", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-intake-recover-bind-"));
    tempDir = tempDir || dir;
    const db = openDatabase(join(dir, "t.db"));
    new NovelStore(db).createNovel({ id: NOVEL });
    const chen = new CharacterStore(db).addCharacter(NOVEL, makeCharacter("陈默"));
    const store = new ForeshadowStore(db);
    const channel = new FakeChannel([]);
    // 全书章序：前幕章 c0（序1）→ 本幕章 ch-1（序2）/ ch-2（序3）
    const allChapterNodes = [
      { id: "part-1", parentId: null, type: "part", sort: 1 },
      { id: "act-0", parentId: "part-1", type: "act", sort: 1 },
      { id: "c0", parentId: "act-0", type: "chapter", sort: 1 },
      { id: "act-1", parentId: "part-1", type: "act", sort: 2 },
      { id: "ch-1", parentId: "act-1", type: "chapter", sort: 1 },
      { id: "ch-2", parentId: "act-1", type: "chapter", sort: 2 },
    ];
    const chapterNodes = [
      { id: "ch-1", name: "第一章·雨夜" },
      { id: "ch-2", name: "第二章·来客" },
    ];
    // 待回收清单：1 登场 c0（序1）合法回收 ch-1/ch-2；2 登场未绑；3 登场 ch-2（序3）回收只能更晚
    const okFs = store.addForeshadow(NOVEL, { ...baseItem, appearChapterId: "c0", recoveryStatus: "unrecovered" } as never, "act-0", "act-1");
    const noAppear = store.addForeshadow(NOVEL, { ...baseItem, surfaceAction: "登场未绑的待回收伏笔", recoveryStatus: "unrecovered" } as never, "act-0", "act-1");
    const lateAppear = store.addForeshadow(NOVEL, { ...baseItem, surfaceAction: "登场已晚的待回收伏笔", appearChapterId: "ch-2", recoveryStatus: "unrecovered" } as never, "act-0", "act-1");
    // 登场绑定对称校验：已有回收章 ch-2（序3），登场绑 ch-1（序2）合法；绑 ch-2（序3）拦截
    const symmetricOk = store.addForeshadow(
      NOVEL,
      { ...baseItem, surfaceAction: "已绑回收章待登场A", recoverChapterIds: ["ch-2"], recoveryStatus: "unrecovered" } as never,
      "act-1",
    );
    const symmetricBad = store.addForeshadow(
      NOVEL,
      { ...baseItem, surfaceAction: "已绑回收章待登场B", recoverChapterIds: ["ch-1"], recoveryStatus: "unrecovered" } as never,
      "act-1",
    );
    const unbound = [symmetricOk, symmetricBad];

    const result = plantChapterForeshadows({
      novelId: NOVEL,
      actNodeId: "act-1",
      newForeshadows: [],
      bindings: [
        { index: 1, chapterName: "第一章·雨夜" },
        { index: 2, chapterName: "第二章·来客" },
      ],
      recoverBindings: [
        { index: 1, chapterName: "第一章·雨夜" },
        { index: 1, chapterName: "第二章·来客" },
        { index: 9, chapterName: "第一章·雨夜" },
        { index: 2, chapterName: "不存在的章" },
        { index: 2, chapterName: "第一章·雨夜" },
        { index: 3, chapterName: "第一章·雨夜" },
      ],
      recoverable: [okFs, noAppear, lateAppear],
      characters: [chen],
      chapterNodes,
      allChapterNodes,
      unbound,
      channel,
      foreshadowStore: store,
    });

    expect(result.recoverBound).toBe(2);
    expect(store.getForeshadow(okFs.id)?.foreshadow.recoverChapterIds).toEqual(["ch-1", "ch-2"]);
    expect(store.getForeshadow(noAppear.id)?.foreshadow.recoverChapterIds).toBeUndefined();
    // 登场绑定对称校验：A 登场 ch-1（序2 < 回收 ch-2 序3）合法；B 登场 ch-2（序3 ≥ 回收 ch-1 序2）拦截
    expect(store.getForeshadow(symmetricOk.id)?.foreshadow.appearChapterId).toBe("ch-1");
    expect(store.getForeshadow(symmetricBad.id)?.foreshadow.appearChapterId).toBeUndefined();
    expect(channel.notifies.some((n) => n.includes("♻ 伏笔已绑定回收章"))).toBe(true);
    expect(channel.notifies.some((n) => n.includes("序号 9 越界"))).toBe(true);
    expect(channel.notifies.some((n) => n.includes("登场章未绑定"))).toBe(true);
    expect(channel.notifies.some((n) => n.includes("回收章须晚于登场章"))).toBe(true);
    expect(channel.notifies.some((n) => n.includes("登场章须早于回收章"))).toBe(true);
    db.close();
  });
});

test("恢复绑定按原序号查最新记录：删除和已编辑项跳过，其余项照常处理", async () => {
  const dir = await mkdtemp(join(tmpdir(), "novel-intake-fresh-"));
  const db = openDatabase(join(dir, "t.db"));
  try {
    new NovelStore(db).createNovel({ id: NOVEL });
    const store = new ForeshadowStore(db);
    const deleted = store.addForeshadow(NOVEL, { ...baseItem, recoveryStatus: "unrecovered" });
    const untouched = store.addForeshadow(NOVEL, { ...baseItem, surfaceAction: "保留序号的线索", recoveryStatus: "unrecovered" });
    const editedRecovery = store.addForeshadow(NOVEL, {
      ...baseItem, surfaceAction: "改过登场章的回收线索", appearChapterId: "c0", recoveryStatus: "unrecovered",
    });
    store.deleteForeshadow(deleted.id);
    store.updateForeshadow(editedRecovery.id, { appearChapterId: "c2" });
    const channel = new FakeChannel([]);
    const result = plantChapterForeshadows({
      novelId: NOVEL, actNodeId: "a", newForeshadows: [], characters: [],
      unbound: [deleted, untouched], recoverable: [editedRecovery],
      bindings: [{ index: 1, chapterName: "第一章" }, { index: 2, chapterName: "第一章" }],
      recoverBindings: [{ index: 1, chapterName: "第一章" }],
      chapterNodes: [{ id: "c1", name: "第一章" }, { id: "c2", name: "第二章" }],
      allChapterNodes: [
        { id: "a", parentId: null, type: "act", sort: 1 },
        ...["c0", "c1", "c2"].map((id, index) => ({ id, parentId: "a", type: "chapter" as const, sort: index + 1 })),
      ],
      channel, foreshadowStore: store,
    });
    expect(result).toEqual({ created: 0, skipped: 2, bound: 1, recoverBound: 0 });
    expect(store.getForeshadow(untouched.id)?.foreshadow.appearChapterId).toBe("c1");
    expect(store.getForeshadow(editedRecovery.id)?.foreshadow).toMatchObject({ appearChapterId: "c2" });
    expect(store.getForeshadow(editedRecovery.id)?.foreshadow.recoverChapterIds).toBeUndefined();
    expect(channel.notifies.some((line) => line.includes("已被删除"))).toBe(true);
    expect(channel.notifies.some((line) => line.includes("已被编辑"))).toBe(true);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("同批先绑定登场再绑定回收：按本批最新登场章校验，合法回收不被误判为外部编辑", async () => {
  const dir = await mkdtemp(join(tmpdir(), "novel-intake-own-binding-"));
  const db = openDatabase(join(dir, "t.db"));
  try {
    new NovelStore(db).createNovel({ id: NOVEL });
    const store = new ForeshadowStore(db);
    const target = store.addForeshadow(NOVEL, { ...baseItem, recoveryStatus: "unrecovered" });
    const channel = new FakeChannel([]);
    const result = plantChapterForeshadows({
      novelId: NOVEL, actNodeId: "a", newForeshadows: [], characters: [],
      unbound: [target], recoverable: [target],
      bindings: [{ index: 1, chapterName: "第一章" }],
      recoverBindings: [{ index: 1, chapterName: "第一章" }, { index: 1, chapterName: "第二章" }],
      chapterNodes: [{ id: "c1", name: "第一章" }, { id: "c2", name: "第二章" }],
      allChapterNodes: [
        { id: "a", parentId: null, type: "act", sort: 1 },
        { id: "c1", parentId: "a", type: "chapter", sort: 1 },
        { id: "c2", parentId: "a", type: "chapter", sort: 2 },
      ], channel, foreshadowStore: store,
    });
    expect(result).toEqual({ created: 0, skipped: 1, bound: 1, recoverBound: 1 });
    expect(store.getForeshadow(target.id)?.foreshadow).toMatchObject({ appearChapterId: "c1", recoverChapterIds: ["c2"] });
    expect(channel.notifies.some((line) => line.includes("回收章须晚于登场章"))).toBe(true);
    expect(channel.notifies.some((line) => line.includes("已被编辑"))).toBe(false);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

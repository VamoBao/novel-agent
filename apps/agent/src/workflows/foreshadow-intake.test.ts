import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../state/db";
import { NovelStore } from "../state/novel-store";
import { CharacterStore, type StoredCharacter } from "../state/character-store";
import { ForeshadowStore } from "../state/foreshadow-store";
import { FakeChannel } from "../ui/fake-channel";

const { plantOutlineForeshadows, plantChapterForeshadows, resolveCharacterIds } = await import("./foreshadow-intake");

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
      characters: [chen],
      chapterNodes,
      unbound,
      channel,
      foreshadowStore: store,
    });

    // 注：本场景共 4 处跳过（新伏笔章名未匹配 1 + 新伏笔服务角色全失败 1 + 绑定序号越界与章名未匹配 2）——
    // 按实现的「每条目必落一桶」计数语义计（含随分支覆盖新增的服务角色全失败 1 处）
    expect(result).toEqual({ created: 2, skipped: 4, bound: 1 });
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

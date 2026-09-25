import { afterAll, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// store / channel 不依赖 'ai'，可静态导入；被测模块（间接引 ai）须在 mock 注册后动态导入
import { openDatabase } from "../state/db";
import { NovelStore } from "../state/novel-store";
import { WorldviewStore } from "../state/worldview-store";
import { CharacterStore } from "../state/character-store";
import { FakeChannel } from "../ui/fake-channel";
import type { Character, Worldview } from "@novel/shared";

/**
 * polishCharacter 集成测试：mock 掉 'ai' 模块（generateObject 按脚本返回润色结果），
 * 交互经 FakeChannel 记录；持久化落在临时目录 SQLite 上——
 * 前置校验路径（小说 / 角色存在与归属 / 世界观）不依赖 LLM。
 */

type GenerateObjectArgs = { model: unknown; schema: unknown; prompt: string };
let generateObjectCalls: GenerateObjectArgs[] = [];
let generateObjectResult: Character | undefined;

mock.module("ai", () => ({
  tool: (spec: unknown) => spec,
  generateText: async () => {
    throw new Error("润色工作流不应调用 generateText");
  },
  generateObject: async (args: GenerateObjectArgs) => {
    generateObjectCalls.push(args);
    return { object: generateObjectResult };
  },
}));

const { polishCharacter } = await import("./polish-character");

const NOVEL_ID = "eeeeeeee-4444-7444-8555-666677778888";
const OTHER_NOVEL_ID = "eeeeeeee-4444-7444-8555-666677778889";

const worldviewFixture: Worldview = {
  background: { geography: "九州大陆，灵脉断绝" },
  taboos: ["不可出现现代科技"],
};

const formFixture = {
  basicInfo: { name: "林恒" },
  core: { desire: "夺回灵脉", fear: "辜负同伴", narrativeRole: "主角" },
  background: "青云市集的散修少年",
  creationPurpose: "承载打破宗门垄断的主线",
  endingDirection: "打破垄断后归隐",
} satisfies Character;

const polishedFixture = {
  basicInfo: { name: "林恒", gender: "男", appearance: "身形清瘦，眉目坚毅" },
  core: { desire: "夺回灵脉", fear: "辜负同伴", narrativeRole: "主角" },
  background: "青云市集的散修少年，幼年目睹灵脉枯竭，立誓寻回失落的本源。",
  personality: "坚韧寡言，认定之事九死不悔。",
  characterGoal: "集齐灵脉碎片，重续九州地脉。",
  creationPurpose: "承载打破宗门垄断的主线",
  trajectory: "市集杂役 → 灵脉拾遗人 → 地脉重塑者",
  endingDirection: "打破垄断后归隐",
  relationships: "与药铺掌柜为忘年交",
} satisfies Character;

/** 建临时库：小说 + 世界观（+ 按需角色），返回各 store 与临时目录清理闭包 */
async function setupDb(options: {
  withWorldview?: boolean;
  withCharacter?: boolean;
  secondNovel?: boolean;
}) {
  const dir = await mkdtemp(join(tmpdir(), "novel-polish-"));
  const db = openDatabase(join(dir, "test.db"));
  const novelStore = new NovelStore(db);
  const worldviewStore = new WorldviewStore(db);
  const characterStore = new CharacterStore(db);
  novelStore.createNovel({ id: NOVEL_ID });
  if (options.withWorldview) {
    worldviewStore.saveWorldview(NOVEL_ID, worldviewFixture);
  }
  if (options.withCharacter) {
    characterStore.addCharacter(NOVEL_ID, formFixture);
  }
  if (options.secondNovel) {
    novelStore.createNovel({ id: OTHER_NOVEL_ID });
  }
  const seededCharacterId = options.withCharacter
    ? characterStore.listCharacters(NOVEL_ID)[0]!.id
    : undefined;
  return {
    novelStore,
    worldviewStore,
    characterStore,
    seededCharacterId,
    cleanup: async () => {
      db.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

describe("polishCharacter", () => {
  const cleanupAll: (() => Promise<void>)[] = [];
  afterAll(async () => {
    await Promise.all(cleanupAll.map((fn) => fn()));
  });

  test("编辑流：校验通过后单轮 generateObject 全字段润色（prompt 含表单与世界观），结果回传不入库", async () => {
    const ctx = await setupDb({ withWorldview: true, withCharacter: true });
    cleanupAll.push(ctx.cleanup);
    const channel = new FakeChannel([]);
    generateObjectCalls = [];
    generateObjectResult = polishedFixture;

    const result = await polishCharacter({
      channel,
      novelId: NOVEL_ID,
      characterId: ctx.seededCharacterId,
      form: formFixture,
      ...ctx,
    });

    // LLM 只调用一轮 generateObject；prompt 携带表单种子与世界观依据
    expect(generateObjectCalls).toHaveLength(1);
    const prompt = generateObjectCalls[0]!.prompt;
    expect(prompt).toContain("林恒");
    expect(prompt).toContain("青云市集的散修少年");
    expect(prompt).toContain("九州大陆，灵脉断绝");
    expect(prompt).toContain("全字段润色");

    // 返回值 = 润色后的角色卡；库中角色数不变（润色不自动入库）
    expect(result.novelId).toBe(NOVEL_ID);
    expect(result.character).toEqual(polishedFixture);
    expect(ctx.characterStore.listCharacters(NOVEL_ID)).toHaveLength(1);
    // 通知：启动与完成提示
    expect(channel.notifies.some((n) => n.includes("润色中"))).toBeTrue();
    expect(channel.notifies.some((n) => n.includes("尚未入库"))).toBeTrue();
  });

  test("新建流：不传 characterId 直接以表单为种子润色", async () => {
    const ctx = await setupDb({ withWorldview: true });
    cleanupAll.push(ctx.cleanup);
    const channel = new FakeChannel([]);
    generateObjectCalls = [];
    generateObjectResult = polishedFixture;

    const result = await polishCharacter({ channel, novelId: NOVEL_ID, form: formFixture, ...ctx });
    expect(result.character.basicInfo.name).toBe("林恒");
    expect(ctx.characterStore.listCharacters(NOVEL_ID)).toHaveLength(0);
  });

  test("前置校验：小说不存在 / 世界观未确认 / 角色不存在与异小说均报可读错误", async () => {
    const noWorldview = await setupDb({ withCharacter: true, secondNovel: true });
    cleanupAll.push(noWorldview.cleanup);

    // 小说不存在
    await expect(
      polishCharacter({
        channel: new FakeChannel([]),
        novelId: "ffffffff-0000-7000-8000-000000000001",
        form: formFixture,
        ...noWorldview,
      }),
    ).rejects.toThrow("小说不存在，无法润色角色");

    // 世界观未确认
    await expect(
      polishCharacter({ channel: new FakeChannel([]), novelId: NOVEL_ID, form: formFixture, ...noWorldview }),
    ).rejects.toThrow("世界观未确认");

    // 角色不存在（编辑流传入库中不存在的 ID）
    const withWorldview = await setupDb({ withWorldview: true });
    cleanupAll.push(withWorldview.cleanup);
    await expect(
      polishCharacter({
        channel: new FakeChannel([]),
        novelId: NOVEL_ID,
        characterId: "ffffffff-0000-7000-8000-000000000002",
        form: formFixture,
        ...withWorldview,
      }),
    ).rejects.toThrow("角色不存在，无法润色");

    // 异小说（novel → 角色归属 → 世界观的校验顺序：归属校验先于世界观检查抛出）
    const seed = noWorldview.characterStore.listCharacters(NOVEL_ID)[0]!.id;
    await expect(
      polishCharacter({
        channel: new FakeChannel([]),
        novelId: OTHER_NOVEL_ID,
        characterId: seed,
        form: formFixture,
        ...noWorldview,
      }),
    ).rejects.toThrow("角色不属于该小说，无法润色");
  });
});

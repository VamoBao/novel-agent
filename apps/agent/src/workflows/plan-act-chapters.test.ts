import { afterAll, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// store / channel 不依赖 'ai'，可静态导入；被测模块（间接引 ai）须在 mock 注册后动态导入
import { openDatabase } from "../state/db";
import { NovelStore } from "../state/novel-store";
import { OutlineStore } from "../state/outline-store";
import { WorldviewStore } from "../state/worldview-store";
import { CharacterStore } from "../state/character-store";
import { ForeshadowStore } from "../state/foreshadow-store";
import { LocationStore } from "../state/location-store";
import { FakeChannel } from "../ui/fake-channel";
import { UserAbortedError } from "../ui/aborted";

/**
 * planActChapters 单幕章节规划集成测试：mock 掉 'ai' 模块（章节 Agent 的
 * generateText 按脚本执行 save_chapters），交互经 FakeChannel 脚本化应答，
 * 持久化落在临时目录 SQLite 上——校验路径（小说/幕/内容/重复规划）不依赖 LLM。
 */

type ScriptedCall = { tool: string; args: unknown };
type ScriptedTurn = ScriptedCall[];
let textScript: ScriptedTurn[][] = [];
// runReactAgent 把 prompt 原文包在首条 user 消息（messages[0].content）传入，
// 逐次记录各 Agent 会话的 prompt 供断言（章节 Agent 为每个用例的首个调用）
let agentPrompts: string[] = [];

type MockTool = { execute: (input: never, options: unknown) => Promise<unknown> };

mock.module("ai", () => ({
  tool: (spec: unknown) => spec,
  generateText: async ({
    tools,
    messages,
  }: {
    tools: Record<string, MockTool>;
    messages: { content: string }[];
  }) => {
    agentPrompts.push(messages[0]?.content ?? "");
    const turns = textScript.shift() ?? [];
    let callIndex = 0;
    for (const turn of turns) {
      for (const call of turn) {
        const t = tools[call.tool];
        if (!t) throw new Error(`脚本调用了未注册的工具：${call.tool}`);
        await t.execute(call.args as never, { toolCallId: `call_${callIndex++}`, messages: [] });
      }
    }
    return { text: "", steps: turns.map(() => ({})), finishReason: "tool-calls", response: { messages: [] } };
  },
  generateObject: async () => ({ object: undefined }),
  hasToolCall: () => () => false,
  stepCountIs: () => () => false,
}));

const { planActChapters } = await import("./plan-act-chapters");

const NOVEL_ID = "11111111-2222-4333-8444-555566667777";

const partsFixture = [
  {
    name: "第一部·风起",
    summary: "少年失去依托，踏上夺脉之路",
    acts: [
      { name: "第1幕", summary: "第1幕梗概", keyPlotPoints: ["第1幕情节点"] },
      { name: "第2幕", summary: "第2幕梗概", keyPlotPoints: ["情节点A", "情节点B"] },
    ],
  },
];

/** 章节规划 fixture：每章登场清单含库内角色（林恒）与新角色（萧无咎——确认后派生自动建卡） */
const chapterPlanFixture = {
  chapters: [
    { name: "第一章·雨夜", summary: "雨夜夺脉的剧情概述", characters: [{ name: "林恒", role: "本章主视角" }] },
    {
      name: "第二章·来客",
      summary: "神秘来客的剧情概述",
      characters: [
        { name: "林恒", role: "遭伏击的组织者" },
        { name: "萧无咎", role: "血宗宗主·本章首次登场的主要反派" },
      ],
    },
    { name: "第三章·破晓", summary: "黎明反击的剧情概述", characters: [{ name: "林恒", role: "反击领袖" }] },
  ],
  newForeshadows: [],
  foreshadowBindings: [],
  foreshadowRecoverBindings: [],
  newLocations: [],
};

/** 登场清单仅含库内角色的变体：派生新角色为空 → 跳过自动创建（零 LLM 调用） */
const noNewCastFixture = {
  ...chapterPlanFixture,
  chapters: chapterPlanFixture.chapters.map((c) => ({
    ...c,
    characters: [{ name: "林恒", role: "本章主视角" }],
  })),
};

const worldviewFixture = {
  background: { geography: "九州大陆" },
  taboos: ["不可出现现代科技"],
};

const autoCard = {
  basicInfo: { name: "萧无咎", gender: "男" },
  core: { desire: "掌控九州灵脉", fear: "宗门基业毁于己手", narrativeRole: "反派" },
  background: "血宗宗主，靠垄断灵脉崛起",
  creationPurpose: "作为主要反派逼出主角的成长",
  endingDirection: "被主角击败，宗门垄断瓦解",
};

interface Seeded {
  novelStore: NovelStore;
  outlineStore: OutlineStore;
  worldviewStore: WorldviewStore;
  characterStore: CharacterStore;
  foreshadowStore: ForeshadowStore;
  locationStore: LocationStore;
  partNodeId: string;
  actNodes: { id: string; name: string }[];
}

/** 每个用例独立临时库：小说行 + 角色种子（林恒，伏笔外键校验用）+（可选）世界观 + 一部两幕的大纲树（返回 seed 后的 store 与节点 ID） */
let tempDir: string;
const originalCwd = process.cwd();
let closeDb: () => void = () => {};

async function seed(withWorldview = true): Promise<Seeded> {
  tempDir = await mkdtemp(join(tmpdir(), "novel-plan-act-"));
  process.chdir(tempDir);
  const db = openDatabase(join(tempDir, "test.db"));
  closeDb = () => db.close();
  const novelStore = new NovelStore(db);
  const outlineStore = new OutlineStore(db);
  const worldviewStore = new WorldviewStore(db);
  const characterStore = new CharacterStore(db);
  const foreshadowStore = new ForeshadowStore(db);
  const locationStore = new LocationStore(db);
  novelStore.createNovel({ id: NOVEL_ID, name: "灵脉遗孤", description: "散修少年夺回被宗门垄断的灵脉" });
  // 角色种子：满足伏笔服务角色外键校验（novels 行已建，外键顺序安全）
  characterStore.addCharacter(NOVEL_ID, {
    basicInfo: { name: "林恒" },
    core: { desire: "夺脉", fear: "失败", narrativeRole: "主角" },
    background: "散修",
    creationPurpose: "主线",
    endingDirection: "归隐",
  });
  if (withWorldview) {
    worldviewStore.saveWorldview(NOVEL_ID, worldviewFixture);
  }
  const tree = outlineStore.saveOutlineTree(NOVEL_ID, partsFixture);
  return {
    novelStore,
    outlineStore,
    worldviewStore,
    characterStore,
    foreshadowStore,
    locationStore,
    partNodeId: tree.find((n) => n.node.type === "part")!.id,
    actNodes: tree.filter((n) => n.node.type === "act").map((n) => ({ id: n.id, name: n.node.name })),
  };
}

afterAll(async () => {
  process.chdir(originalCwd);
  closeDb();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

describe("planActChapters（FakeChannel + mock LLM 集成）", () => {
  test("指定幕规划成功：上下文取自库，确认视图与通知齐备，章节挂幕入库", async () => {
    const world = await seed();
    // 叙事视角（创作条件）：随规划上下文进章节 Agent prompt
    world.novelStore.updateNovel(NOVEL_ID, { narrativePov: "第三人称限知" });
    const secondAct = world.actNodes[1]!;
    agentPrompts = [];
    // 第一幕预置章节：回收伏笔的登场章（全局章序在第二幕章之前）
    const firstAct = world.actNodes[0]!;
    const seededChapters = world.outlineStore.saveChapters(NOVEL_ID, firstAct.id, [
      { name: "序章·北境", summary: "北境序章" },
    ]);
    // 种一条挂第 2 幕的未绑伏笔：规划应经 foreshadowBindings 把它 patch 到登场章
    const seededFs = world.foreshadowStore.addForeshadow(
      NOVEL_ID,
      {
        surfaceAction: "宗主赐下断脉散",
        hiddenTruth: "药中掺了追踪灵脉的蛊种",
        attentionLevel: 6,
        recoveryStatus: "unrecovered",
      },
      secondAct.id,
    );
    // 种一条库内已有地点：清单中同名项应被兜底 diff 剔除
    world.locationStore.addLocation(NOVEL_ID, { name: "北境大陆", description: "既有地点" });
    // 种一条待回收伏笔（登场=序章·北境，回收幕=第 2 幕且回收章未绑）：规划应经 foreshadowRecoverBindings 绑到第三章
    const recoverFs = world.foreshadowStore.addForeshadow(
      NOVEL_ID,
      {
        surfaceAction: "断脉散中的蛊种",
        hiddenTruth: "蛊种成熟时宗主将借体夺舍",
        attentionLevel: 6,
        recoveryStatus: "unrecovered",
        appearChapterId: seededChapters[0]!.id,
      },
      firstAct.id,
      secondAct.id,
    );
    // 双轮脚本：轮 1 章节 Agent save_chapters（逐章登场清单含新角色 + 新伏笔 + 既有伏笔绑定指令 + 新增地点）
    // → 轮 2 自动创建 Agent save_character 入库（新角色由登场清单对角色库派生）
    textScript = [
      [[{
        tool: "save_chapters",
        args: {
          ...chapterPlanFixture,
          newForeshadows: [{ surfaceAction: "来客留下半块玉佩", hiddenTruth: "玉佩是主角身世信物", attentionLevel: 5, characterNames: ["林恒"], chapterName: "第二章·来客" }],
          foreshadowBindings: [{ index: 1, chapterName: "第一章·雨夜" }],
          foreshadowRecoverBindings: [{ index: 1, chapterName: "第三章·破晓" }],
          newLocations: [
            { name: "青云城", description: "第2章主战场·东部边境要塞" },
            { name: "北境大陆", description: "误标已有地点（应被兜底 diff 剔除）" },
          ],
        },
      }]],
      [[{ tool: "save_character", args: autoCard }]],
    ];
    const channel = new FakeChannel([true]);

    const result = await planActChapters({
      channel,
      novelId: NOVEL_ID,
      actNodeId: secondAct.id,
      novelStore: world.novelStore,
      outlineStore: world.outlineStore,
      worldviewStore: world.worldviewStore,
      characterStore: world.characterStore,
      foreshadowStore: world.foreshadowStore,
      locationStore: world.locationStore,
    });

    expect(result).toEqual({ novelId: NOVEL_ID, actNodeId: secondAct.id, actName: "第2幕", chapterCount: 3 });
    expect(channel.stages).toEqual(["chapter"]);
    expect(channel.notifies).toContain("📑 章节规划 Agent 启动（第2幕）…");
    expect(channel.notifies).toContain("📑 章节已入库：第2幕 规划 3 章");
    // 确认视图：逐章登场清单随规划展示，新角色由登场清单对角色库派生（确认门所见 = 入库所得）
    expect(channel.views.at(-1)).toMatchObject({
      kind: "chapter-plan",
      actName: "第2幕",
      newCharacters: [{ name: "萧无咎", role: "血宗宗主·本章首次登场的主要反派" }],
    });

    const chapters = world.outlineStore
      .listOutlineNodes(NOVEL_ID)
      .filter((n) => n.node.type === "chapter" && n.node.parentId === secondAct.id);
    expect(chapters.map((c) => [c.node.parentId, c.node.name, c.node.sort])).toEqual([
      [secondAct.id, "第一章·雨夜", 1],
      [secondAct.id, "第二章·来客", 2],
      [secondAct.id, "第三章·破晓", 3],
    ]);

    // 新增角色随规划确认自动入库：进度 / 逐卡 / 汇总三段通知 + 真实落库行（林恒为 seed 角色种子）
    expect(channel.notifies.some((n) => n.includes("本幕规划引入了 1 个新角色"))).toBe(true);
    expect(channel.notifies.some((n) => n.includes("新角色已自动入库：萧无咎"))).toBe(true);
    expect(channel.notifies.some((n) => n.includes("本次章节规划新增 1 个角色已自动入库"))).toBe(true);
    expect(
      world.characterStore.listCharacters(NOVEL_ID).map((c) => c.character.basicInfo.name),
    ).toEqual(["林恒", "萧无咎"]);

    // 各章登场角色绑定回填：库内（林恒）+ 本轮新入库（萧无咎）的名字→ID 落到章节点；
    // 自动创建 Agent 的 extraContext 章节行带登场名单
    expect(agentPrompts[1]).toContain("（登场：林恒、萧无咎）");
    const linHengId = world.characterStore
      .listCharacters(NOVEL_ID)
      .find((c) => c.character.basicInfo.name === "林恒")!.id;
    const xiaoId = world.characterStore
      .listCharacters(NOVEL_ID)
      .find((c) => c.character.basicInfo.name === "萧无咎")!.id;
    expect(
      chapters.map((c) => c.node.characterIds),
    ).toEqual([[linHengId], [linHengId, xiaoId], [linHengId]]);
    expect(channel.notifies.some((n) => n.includes("🎭 正在绑定各章登场角色（3 章）"))).toBe(true);
    expect(channel.notifies.some((n) => n.includes("✨ 各章登场角色已绑定：3 章共 4 人次"))).toBe(true);

    // 新增地点确定性入库：库内同名「北境大陆」被兜底 diff 剔除，仅「青云城」追加；先于角色自动创建
    const locRows = world.locationStore.listLocations(NOVEL_ID);
    expect(locRows.map((l) => l.location.name)).toEqual(["北境大陆", "青云城"]);
    expect(locRows[1]?.location.description).toBe("第2章主战场·东部边境要塞");
    expect(channel.notifies.some((n) => n.includes("✨ 地点已入库：青云城"))).toBe(true);
    expect(channel.notifies.some((n) => n.includes("本次规划新增 1 个地点已自动入库"))).toBe(true);
    expect(channel.notifies.findIndex((n) => n.includes("✨ 地点已入库：青云城"))).toBeLessThan(
      channel.notifies.findIndex((n) => n.includes("新角色已自动入库：萧无咎")),
    );

    // 未绑伏笔回传清单进 prompt：章节 Agent（首个 LLM 调用）的 prompt 含序号清单块
    expect(agentPrompts[0]).toContain("本幕未绑登场章的伏笔");
    expect(agentPrompts[0]).toContain("1. 宗主赐下断脉散——药中掺了追踪灵脉的蛊种");
    // 叙事视角行进 prompt（创作条件与规划一致）
    expect(agentPrompts[0]).toContain("叙事视角：第三人称限知");
    // 待回收伏笔清单进 prompt（带登场章信息）
    expect(agentPrompts[0]).toContain("本幕待回收伏笔");
    expect(agentPrompts[0]).toContain("1. 断脉散中的蛊种——蛊种成熟时宗主将借体夺舍");

    // 伏笔：新伏笔带登场章与幕入库；既有未绑伏笔绑定第一章
    const fs = world.foreshadowStore.listForeshadows(NOVEL_ID);
    const created = fs.find((f) => f.foreshadow.surfaceAction === "来客留下半块玉佩");
    const chapterIds = world.outlineStore.listOutlineNodes(NOVEL_ID).filter((n) => n.node.type === "chapter");
    expect(created?.foreshadow.appearChapterId).toBe(chapterIds.find((n) => n.node.name === "第二章·来客")?.id);
    expect(created?.actNodeId).toBe(secondAct.id);
    expect(created?.foreshadow.characterIds).toEqual([linHengId]);
    expect(world.foreshadowStore.getForeshadow(seededFs.id)?.foreshadow.appearChapterId).toBe(chapterIds.find((n) => n.node.name === "第一章·雨夜")?.id);
    expect(channel.notifies.some((n) => n.includes("本次规划伏笔入库 1 处、绑定 1 处、回收绑定 1 处"))).toBe(true);
    // 回收绑定：待回收伏笔绑到第三章（全局章序晚于序章·北境）
    const thirdChapter = world.outlineStore
      .listOutlineNodes(NOVEL_ID)
      .find((n) => n.node.type === "chapter" && n.node.name === "第三章·破晓");
    expect(thirdChapter).toBeDefined();
    expect(world.foreshadowStore.getForeshadow(recoverFs.id)?.foreshadow.recoverChapterIds).toEqual([thirdChapter!.id]);
    expect(channel.notifies.some((n) => n.includes("♻ 伏笔已绑定回收章：断脉散中的蛊种"))).toBe(true);
  });

  test("小说不存在：抛可读错误，不启动 Agent", async () => {
    const world = await seed();
    const channel = new FakeChannel([]);
    await expect(
      planActChapters({
        channel,
        novelId: "00000000-0000-4000-8000-000000000000",
        actNodeId: world.actNodes[0]!.id,
        novelStore: world.novelStore,
        outlineStore: world.outlineStore,
        worldviewStore: world.worldviewStore,
        characterStore: world.characterStore,
        foreshadowStore: world.foreshadowStore,
      }),
    ).rejects.toThrow("小说不存在");
    expect(channel.notifies).toHaveLength(0);
  });

  test("幕节点属于其他小说：抛可读错误", async () => {
    const world = await seed();
    // 另一本小说 + 各自大纲树，拿 novel2 的幕配 novel1 的 ID
    const OTHER_ID = "99999999-8888-4999-aaaa-bbbbccccdddd";
    world.novelStore.createNovel({ id: OTHER_ID });
    const otherTree = world.outlineStore.saveOutlineTree(OTHER_ID, partsFixture);
    const otherAct = otherTree.find((n) => n.node.type === "act")!;
    const channel = new FakeChannel([]);
    await expect(
      planActChapters({
        channel,
        novelId: NOVEL_ID,
        actNodeId: otherAct.id,
        novelStore: world.novelStore,
        outlineStore: world.outlineStore,
        worldviewStore: world.worldviewStore,
        characterStore: world.characterStore,
        foreshadowStore: world.foreshadowStore,
      }),
    ).rejects.toThrow("不属于该小说");
  });

  test("非幕节点（部）：抛可读错误并指出节点类型", async () => {
    const world = await seed();
    const channel = new FakeChannel([]);
    await expect(
      planActChapters({
        channel,
        novelId: NOVEL_ID,
        actNodeId: world.partNodeId,
        novelStore: world.novelStore,
        outlineStore: world.outlineStore,
        worldviewStore: world.worldviewStore,
        characterStore: world.characterStore,
        foreshadowStore: world.foreshadowStore,
      }),
    ).rejects.toThrow("不是幕（类型为 part）");
  });

  test("旧数据幕（梗概/情节点为 null）：抛可读错误", async () => {
    const world = await seed();
    // 直接补一个内容两列为 null 的旧式幕节点（6 版迁移前数据形态）
    const legacyAct = world.outlineStore.addOutlineNode(NOVEL_ID, {
      type: "act",
      name: "旧数据幕",
      sort: 99,
      parentId: world.partNodeId,
    });
    const channel = new FakeChannel([]);
    await expect(
      planActChapters({
        channel,
        novelId: NOVEL_ID,
        actNodeId: legacyAct.id,
        novelStore: world.novelStore,
        outlineStore: world.outlineStore,
        worldviewStore: world.worldviewStore,
        characterStore: world.characterStore,
        foreshadowStore: world.foreshadowStore,
      }),
    ).rejects.toThrow("旧数据");
  });

  test("幕已有章节规划：前置拒绝（修订流为后续需求），不再进入 Agent", async () => {
    const world = await seed();
    const target = world.actNodes[0]!;
    world.outlineStore.saveChapters(NOVEL_ID, target.id, chapterPlanFixture.chapters);
    textScript = [];
    const channel = new FakeChannel([]);
    await expect(
      planActChapters({
        channel,
        novelId: NOVEL_ID,
        actNodeId: target.id,
        novelStore: world.novelStore,
        outlineStore: world.outlineStore,
        worldviewStore: world.worldviewStore,
        characterStore: world.characterStore,
        foreshadowStore: world.foreshadowStore,
      }),
    ).rejects.toThrow("已有章节规划");
    expect(channel.notifies).toHaveLength(0);
  });

  test("世界观未确认：前置拒绝，不启动 Agent", async () => {
    const world = await seed(false);
    textScript = [];
    const channel = new FakeChannel([]);
    await expect(
      planActChapters({
        channel,
        novelId: NOVEL_ID,
        actNodeId: world.actNodes[0]!.id,
        novelStore: world.novelStore,
        outlineStore: world.outlineStore,
        worldviewStore: world.worldviewStore,
        characterStore: world.characterStore,
        foreshadowStore: world.foreshadowStore,
      }),
    ).rejects.toThrow("世界观未确认");
    expect(channel.notifies).toHaveLength(0);
  });

  test("规划未引入新角色：登场清单全为库内角色，派生为空跳过自动创建（零 LLM 调用）", async () => {
    const world = await seed();
    textScript = [[[{ tool: "save_chapters", args: noNewCastFixture }]]]; // 登场清单仅含库内角色（林恒）
    const channel = new FakeChannel([true]);
    await planActChapters({
      channel,
      novelId: NOVEL_ID,
      actNodeId: world.actNodes[0]!.id,
      novelStore: world.novelStore,
      outlineStore: world.outlineStore,
      worldviewStore: world.worldviewStore,
      characterStore: world.characterStore,
      foreshadowStore: world.foreshadowStore,
    });
    expect(textScript).toHaveLength(0);
    expect(channel.notifies.some((n) => n.includes("自动入库"))).toBe(false);
    // seed 的角色种子（林恒）仍在，但不追加新角色
    expect(
      world.characterStore.listCharacters(NOVEL_ID).map((c) => c.character.basicInfo.name),
    ).toEqual(["林恒"]);
    // 绑定照常回填（库内角色也需要绑定）
    const chapters = world.outlineStore
      .listOutlineNodes(NOVEL_ID)
      .filter((n) => n.node.type === "chapter");
    expect(chapters.every((c) => c.node.characterIds?.length === 1)).toBe(true);
  });

  test("本幕无伏笔且规划未引入：跳过伏笔处理（零额外调用）", async () => {
    const world = await seed();
    // fixture 的 newForeshadows / foreshadowBindings 均为 []，本幕（第 1 幕）无未绑伏笔，登场清单全为库内角色
    textScript = [[[{ tool: "save_chapters", args: noNewCastFixture }]]];
    agentPrompts = [];
    const channel = new FakeChannel([true]);
    await planActChapters({
      channel,
      novelId: NOVEL_ID,
      actNodeId: world.actNodes[0]!.id,
      novelStore: world.novelStore,
      outlineStore: world.outlineStore,
      worldviewStore: world.worldviewStore,
      characterStore: world.characterStore,
      foreshadowStore: world.foreshadowStore,
    });
    expect(textScript).toHaveLength(0);
    // 本幕无未绑伏笔时，章节 Agent 的 prompt 不含回传清单块
    expect(agentPrompts).toHaveLength(1);
    expect(agentPrompts[0]).not.toContain("未绑登场章的伏笔");
    expect(channel.notifies.some((n) => n.includes("伏笔"))).toBe(false);
    expect(world.foreshadowStore.listForeshadows(NOVEL_ID)).toHaveLength(0);
  });

  test("确认门通道关闭：UserAbortedError 中止规划", async () => {
    const world = await seed();
    textScript = [[[{ tool: "save_chapters", args: chapterPlanFixture }]]];
    const channel = new FakeChannel([null]);
    await expect(
      planActChapters({
        channel,
        novelId: NOVEL_ID,
        actNodeId: world.actNodes[0]!.id,
        novelStore: world.novelStore,
        outlineStore: world.outlineStore,
        worldviewStore: world.worldviewStore,
        characterStore: world.characterStore,
        foreshadowStore: world.foreshadowStore,
      }),
    ).rejects.toBeInstanceOf(UserAbortedError);
  });
});

import { afterAll, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// store / channel 不依赖 'ai'，可静态导入；被测模块（间接引 ai）须在 mock 注册后动态导入
import { openDatabase } from "../state/db";
import { NovelStore } from "../state/novel-store";
import { OutlineStore } from "../state/outline-store";
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

type MockTool = { execute: (input: never, options: unknown) => Promise<unknown> };

mock.module("ai", () => ({
  tool: (spec: unknown) => spec,
  generateText: async ({ tools }: { tools: Record<string, MockTool> }) => {
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

const chapterPlanFixture = {
  chapters: [
    { name: "第一章·雨夜", summary: "雨夜夺脉的剧情概述" },
    { name: "第二章·来客", summary: "神秘来客的剧情概述" },
    { name: "第三章·破晓", summary: "黎明反击的剧情概述" },
  ],
};

interface Seeded {
  novelStore: NovelStore;
  outlineStore: OutlineStore;
  partNodeId: string;
  actNodes: { id: string; name: string }[];
}

/** 每个用例独立临时库：小说行 + 一部两幕的大纲树（返回 seed 后的 store 与节点 ID） */
let tempDir: string;
const originalCwd = process.cwd();
let closeDb: () => void = () => {};

async function seed(): Promise<Seeded> {
  tempDir = await mkdtemp(join(tmpdir(), "novel-plan-act-"));
  process.chdir(tempDir);
  const db = openDatabase(join(tempDir, "test.db"));
  closeDb = () => db.close();
  const novelStore = new NovelStore(db);
  const outlineStore = new OutlineStore(db);
  novelStore.createNovel({ id: NOVEL_ID, name: "灵脉遗孤", description: "散修少年夺回被宗门垄断的灵脉" });
  const tree = outlineStore.saveOutlineTree(NOVEL_ID, partsFixture);
  return {
    novelStore,
    outlineStore,
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
    const secondAct = world.actNodes[1]!;
    textScript = [[[{ tool: "save_chapters", args: chapterPlanFixture }]]];
    const channel = new FakeChannel([true]);

    const result = await planActChapters({
      channel,
      novelId: NOVEL_ID,
      actNodeId: secondAct.id,
      novelStore: world.novelStore,
      outlineStore: world.outlineStore,
    });

    expect(result).toEqual({ novelId: NOVEL_ID, actNodeId: secondAct.id, actName: "第2幕", chapterCount: 3 });
    expect(channel.stages).toEqual(["chapter"]);
    expect(channel.notifies).toContain("📑 章节规划 Agent 启动（第2幕）…");
    expect(channel.notifies).toContain("📑 章节已入库：第2幕 规划 3 章");
    expect(channel.views.at(-1)).toMatchObject({ kind: "chapter-plan", actName: "第2幕" });

    const chapters = world.outlineStore
      .listOutlineNodes(NOVEL_ID)
      .filter((n) => n.node.type === "chapter");
    expect(chapters.map((c) => [c.node.parentId, c.node.name, c.node.sort])).toEqual([
      [secondAct.id, "第一章·雨夜", 1],
      [secondAct.id, "第二章·来客", 2],
      [secondAct.id, "第三章·破晓", 3],
    ]);
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
      }),
    ).rejects.toThrow("已有章节规划");
    expect(channel.notifies).toHaveLength(0);
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
      }),
    ).rejects.toBeInstanceOf(UserAbortedError);
  });
});

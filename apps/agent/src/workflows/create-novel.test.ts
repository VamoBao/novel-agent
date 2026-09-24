import { afterAll, describe, expect, mock, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * createNovel 全流程集成测试：mock 掉 'ai' 模块（generateObject 返回脚本 fixture、
 * generateText 按脚本逐轮执行工具 execute），交互经 FakeChannel 脚本化应答，
 * 持久化落在临时目录的 SQLite 上——完整创作流不依赖真实 LLM 即可验证。
 */

/** generateText 脚本：每次 Agent 调用消费一组「轮次」，每轮为该轮并发执行的工具调用 */
type ScriptedCall = { tool: string; args: unknown };
type ScriptedTurn = ScriptedCall[];
let textScript: ScriptedTurn[][] = [];
/** generateObject 脚本：按调用顺序返回 fixture（受众推断 → 核心冲突归一） */
let objectScript: unknown[] = [];

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
  generateObject: async () => ({ object: objectScript.shift() }),
  hasToolCall: () => () => false,
  stepCountIs: () => () => false,
}));

const { createNovel } = await import("./create-novel");
const { openDatabase } = await import("../state/db");
const { CharacterStore } = await import("../state/character-store");
const { WorldviewStore } = await import("../state/worldview-store");
const { NovelStore } = await import("../state/novel-store");
const { OutlineStore } = await import("../state/outline-store");
const { memoryNovelStateStore } = await import("../state/memory-store");
const { FakeChannel } = await import("../ui/fake-channel");

const worldviewFixture = {
  background: { geography: "九州大陆" },
  taboos: ["不可出现现代科技"],
};

const characterFields = [
  { field: "name", summary: "林恒" },
  { field: "desire", summary: "夺回被夺的灵眼并证道长生" },
  { field: "fear", summary: "辜负同行的同伴" },
  { field: "narrativeRole", summary: "主角" },
  { field: "background", summary: "青云市集的散修少年" },
  { field: "creationPurpose", summary: "承载打破宗门垄断的主线" },
  { field: "endingDirection", summary: "打破宗门垄断后归隐" },
];

const outlineFixture = {
  title: "灵脉遗孤",
  logline: "散修少年夺回被宗门垄断的灵脉",
  theme: "反抗垄断",
  parts: [
    {
      name: "第一部·风起",
      summary: "少年失去依托，踏上夺脉之路",
      acts: Array.from({ length: 5 }, (_, i) => ({
        name: `第${i + 1}幕`,
        summary: `第${i + 1}幕梗概`,
        keyPlotPoints: [`第${i + 1}幕情节点`],
      })),
    },
  ],
};

const chapterPlanFixture = {
  chapters: [
    { name: "第一章·雨夜", summary: "雨夜夺脉的剧情概述" },
    { name: "第二章·来客", summary: "神秘来客的剧情概述" },
  ],
};

let tempDir: string;
const originalCwd = process.cwd();
let closeDb: () => void = () => {};

afterAll(async () => {
  process.chdir(originalCwd);
  closeDb();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

describe("createNovel（FakeChannel + mock LLM 集成）", () => {
  test("完整创作流：命名跳过 → 类型/受众 → 世界观 → 角色 → 冲突 → 大纲，全链路落库落盘", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "novel-create-int-"));
    process.chdir(tempDir);
    const db = openDatabase(join(tempDir, "test.db"));
    closeDb = () => db.close();

    // LLM 脚本：worldview agent 一次提交；character agent 一轮 7 个 save_field + 一轮 submit；
    // outline agent 一次 save_outline；chapter agent 一次 save_chapters
    textScript = [
      [[{ tool: "submit_worldview", args: worldviewFixture }]],
      [characterFields.map((f) => ({ tool: "save_field", args: f })), [{ tool: "submit_character", args: {} }]],
      [[{ tool: "save_outline", args: outlineFixture }]],
      [[{ tool: "save_chapters", args: chapterPlanFixture }]],
    ];
    objectScript = [
      { options: [{ label: "都市青年读者", description: "节奏明快的成长与逆袭" }] },
      { origin: "宗门垄断灵脉", impact: "散修如草芥", idealResolution: "灵脉归于众生" },
    ];

    // 用户应答脚本（FIFO）：跳过命名 → 选仙侠 → 选受众 → 跳过补充 → 世界观描述 →
    // 首个角色描述 → 7 次字段确认 + 整卡确认 → 结束角色 → 冲突描述 → 幕数/部数 →
    // 大纲确认 → 章节规划确认
    const channel = new FakeChannel([
      "",
      "仙侠",
      ["都市青年读者——节奏明快的成长与逆袭"],
      "",
      "九州大陆，灵脉断绝的修仙世界",
      "林恒，十六岁散修少年，主角",
      ...characterFields.map(() => true),
      true,
      "",
      "宗门垄断灵脉，散修如草芥",
      5,
      1,
      true,
      true,
    ]);

    const state = await createNovel({
      channel,
      store: memoryNovelStateStore,
      characterStore: new CharacterStore(db),
      worldviewStore: new WorldviewStore(db),
      novelStore: new NovelStore(db),
      outlineStore: new OutlineStore(db),
    });

    // 最终状态与产物
    expect(state.status).toBe("outlined");
    expect(state.outline?.title).toBe("灵脉遗孤");
    expect(existsSync(join(tempDir, "output", `${state.id}.json`))).toBe(true);

    // 交互轨迹：视图按预期顺序（worldview 展示 → 7 字段摘要 + 整卡 → 冲突 → 大纲确认 + 全量 → 章节规划确认）
    const kinds: string[] = channel.views.map((v) => v.kind);
    expect(kinds).toEqual([
      "worldview",
      ...characterFields.map(() => "field-summary"),
      "character-card",
      "conflict",
      "outline",
      "outline",
      "chapter-plan",
    ]);
    const confirmView = channel.views.at(-3);
    expect(confirmView).toMatchObject({ kind: "outline", detail: "confirm" });
    expect(channel.views.at(-2)).toMatchObject({ kind: "outline", detail: "full" });
    expect(channel.views.at(-1)).toMatchObject({
      kind: "chapter-plan",
      actName: "第1幕",
      plan: { chapters: chapterPlanFixture.chapters },
    });

    // 通知：收尾提示、大纲入库统计与章节入库统计
    expect(channel.notifies).toContain("🗂 大纲树已入库（含梗概与关键情节点）：1 部 / 5 幕");
    expect(channel.notifies).toContain("📑 章节已入库：第1幕 规划 2 章");
    expect(channel.notifies.some((n) => n.includes("✅ 小说《灵脉遗孤》初始化完成！"))).toBe(true);

    // 持久化：novels 未命名回填大纲标题；世界观 upsert；角色入库
    const novelStore = new NovelStore(db);
    expect(novelStore.getNovel(state.id)?.name).toBe("灵脉遗孤");
    expect(novelStore.getNovel(state.id)?.description).toBe(outlineFixture.logline);
    const worldviewStore = new WorldviewStore(db);
    expect(worldviewStore.getWorldview(state.id)?.worldview.taboos).toEqual(worldviewFixture.taboos);
    const characterStore = new CharacterStore(db);
    expect(
      characterStore.listCharacters(state.id).map((c) => c.character.basicInfo.name),
    ).toEqual(["林恒"]);

    // 大纲与章节内容入库：部有梗概无情节点，幕梗概与情节点齐全，章挂在第一幕下概述随行
    const outlineNodes = new OutlineStore(db).listOutlineNodes(state.id);
    expect(outlineNodes).toHaveLength(8);
    const partNode = outlineNodes.find((n) => n.node.type === "part");
    expect(partNode?.node.summary).toBe("少年失去依托，踏上夺脉之路");
    expect(partNode?.node.keyPlotPoints).toBeNull();
    const firstAct = outlineNodes.find((n) => n.node.name === "第1幕");
    expect(firstAct?.node.summary).toBe("第1幕梗概");
    expect(firstAct?.node.keyPlotPoints).toEqual(["第1幕情节点"]);
    if (!firstAct) throw new Error("测试前置失败：库中无第一幕节点");
    const chapters = outlineNodes.filter((n) => n.node.type === "chapter");
    expect(chapters.map((c) => [c.node.parentId, c.node.name, c.node.summary, c.node.sort])).toEqual([
      [firstAct.id, "第一章·雨夜", "雨夜夺脉的剧情概述", 1],
      [firstAct.id, "第二章·来客", "神秘来客的剧情概述", 2],
    ]);
  });

  test("UserAbortedError：任一提问通道关闭即中止全流程", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "novel-abort-int-"));
    process.chdir(tempDir);
    const db = openDatabase(join(tempDir, "test.db"));
    closeDb = () => db.close();

    // 第一个提问（命名，可选）即关闭通道
    const channel = new FakeChannel([null]);
    await expect(
      createNovel({
        channel,
        store: memoryNovelStateStore,
        characterStore: new CharacterStore(db),
        worldviewStore: new WorldviewStore(db),
        novelStore: new NovelStore(db),
        outlineStore: new OutlineStore(db),
      }),
    ).rejects.toBeInstanceOf((await import("../ui/aborted")).UserAbortedError);
  });
});

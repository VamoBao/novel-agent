import { modelMessageSchema } from "ai";
import { afterAll, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type ScriptedCall = { tool: string; args: unknown };
type ScriptedTurn = ScriptedCall[];
let textScript: ScriptedTurn[][] = [];
let lastPrompt = "";
type MockTool = { execute: (input: never, options: unknown) => Promise<unknown> };

const sdkModelMessageSchema = modelMessageSchema;
mock.module("ai", () => ({
  modelMessageSchema: sdkModelMessageSchema,
  tool: (spec: unknown) => spec,
  // runReactAgent 将 prompt 原文包在 messages[0].content 传入，记录之供断言
  generateText: async ({
    tools,
    messages,
  }: {
    tools: Record<string, MockTool>;
    messages: { content: string }[];
  }) => {
    lastPrompt = messages[0]?.content ?? "";
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
  hasToolCall: () => () => false,
  stepCountIs: () => () => false,
}));

const { autoCreateCharacters, filterNewCharacters } = await import("./auto-character-agent");
const { openDatabase } = await import("../../state/db");
const { CharacterStore } = await import("../../state/character-store");
const { NovelStore } = await import("../../state/novel-store");
const { FakeChannel } = await import("../../ui/fake-channel");

const worldview = { background: { geography: "九州大陆" }, taboos: ["不可出现现代科技"] };
const outline = {
  title: "灵脉遗孤",
  logline: "散修少年夺回被宗门垄断的灵脉",
  parts: [{ name: "第一部", summary: "概述", acts: [{ name: "第一幕", summary: "梗概", keyPlotPoints: ["情节点"] }] }],
};
const existing = [
  {
    basicInfo: { name: "林恒", gender: "男" },
    core: { desire: "夺回灵脉", fear: "辜负同伴", narrativeRole: "主角" },
    background: "散修少年",
    creationPurpose: "承载主线",
    endingDirection: "打破垄断后归隐",
  },
];
const newCard = (name: string) => ({
  basicInfo: { name, gender: "男" },
  core: { desire: "掌控灵脉", fear: "失败", narrativeRole: "反派" },
  background: "血宗宗主",
  creationPurpose: "作为主要反派逼出主角成长",
  endingDirection: "被主角击败",
});

let tempDir: string;
afterAll(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

describe("filterNewCharacters", () => {
  test("剔除库内已有名（trim 全等）并按名字去重保留首个", () => {
    const filtered = filterNewCharacters(
      [
        { name: "萧无咎", role: "反派·血宗宗主" },
        { name: " 林恒 ", role: "误标已有角色" },
        { name: "萧无咎", role: "重复项" },
        { name: "  ", role: "空名" },
      ],
      existing as never,
    );
    expect(filtered).toEqual([{ name: "萧无咎", role: "反派·血宗宗主" }]);
  });

  test("空清单透传为空数组", () => {
    expect(filterNewCharacters([], existing as never)).toEqual([]);
  });
});

describe("autoCreateCharacters", () => {
  test("清单外名被拒后修正，清单角色全部自动入库", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "novel-auto-char-"));
    const db = openDatabase(join(tempDir, "test.db"));
    const characterStore = new CharacterStore(db);
    // characters.novel_id 外键关联 novels，须先落 novels 行
    new NovelStore(db).createNovel({ id: "novel-1" });
    characterStore.addCharacter("novel-1", existing[0] as never);
    const channel = new FakeChannel([]);

    textScript = [
      // 第一轮：越界名被拒 + 正确入库一张
      [
        [
          { tool: "save_character", args: newCard("路人甲") },
          { tool: "save_character", args: newCard("萧无咎") },
        ],
      ],
      // 第二轮：修正后入库剩余角色
      [[{ tool: "save_character", args: newCard("叶青璃") }]],
    ];

    const created = await autoCreateCharacters({
      novelId: "novel-1",
      worldview: worldview as never,
      outline: outline as never,
      newCharacters: [
        { name: "萧无咎", role: "反派·血宗宗主" },
        { name: "叶青璃", role: "女主·灵医传人" },
      ],
      existingCharacters: existing as never,
      channel,
      characterStore,
    });

    expect(created.map((c) => c.character.basicInfo.name)).toEqual(["萧无咎", "叶青璃"]);
    const names = characterStore.listCharacters("novel-1").map((r) => r.character.basicInfo.name);
    expect(names).toEqual(["林恒", "萧无咎", "叶青璃"]);
    expect(channel.notifies.some((n) => n.includes("萧无咎"))).toBe(true);
    db.close();
  });

  test("maxSteps 耗尽未完成全部清单时抛可读错误，已入库卡保留", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "novel-auto-char-2"));
    const db = openDatabase(join(tempDir, "test.db"));
    const characterStore = new CharacterStore(db);
    new NovelStore(db).createNovel({ id: "novel-2" });
    const channel = new FakeChannel([]);

    textScript = [[]]; // 一轮空转，无任何工具调用

    await expect(
      autoCreateCharacters({
        novelId: "novel-2",
        worldview: worldview as never,
        outline: outline as never,
        newCharacters: [{ name: "萧无咎", role: "反派·血宗宗主" }],
        existingCharacters: [],
        channel,
        characterStore,
      }),
    ).rejects.toThrow("角色自动创建 Agent 未能完成");
    expect(characterStore.listCharacters("novel-2")).toHaveLength(0);
    db.close();
  });

  test("库内同名守卫拒绝不可入库的清单角色，可入库者保留", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "novel-auto-char-3"));
    const db = openDatabase(join(tempDir, "test.db"));
    const characterStore = new CharacterStore(db);
    new NovelStore(db).createNovel({ id: "novel-3" });
    // 库内已有「林恒」：模拟复用方违反前置条件未过 filterNewCharacters 直传清单
    characterStore.addCharacter("novel-3", existing[0] as never);
    const channel = new FakeChannel([]);

    textScript = [
      // 第一轮：林恒过白名单（在清单内）但命中库内守卫被拒；萧无咎正常入库
      [
        [
          { tool: "save_character", args: newCard("林恒") },
          { tool: "save_character", args: newCard("萧无咎") },
        ],
      ],
      // 续跑轮：重试林恒仍被库内守卫拒绝——isDone 不可达，续跑额度耗尽后循环判定抛错
      [[{ tool: "save_character", args: newCard("林恒") }]],
    ];

    await expect(
      autoCreateCharacters({
        novelId: "novel-3",
        worldview: worldview as never,
        outline: outline as never,
        newCharacters: [
          { name: "林恒", role: "主角（库内已有，未过滤直传）" },
          { name: "萧无咎", role: "反派·血宗宗主" },
        ],
        existingCharacters: existing as never,
        channel,
        characterStore,
      }),
    ).rejects.toThrow("角色自动创建 Agent 未能完成");
    // rejects 后查库：库内原「林恒」未被重复创建，萧无咎已入库保留
    expect(
      characterStore.listCharacters("novel-3").map((r) => r.character.basicInfo.name),
    ).toEqual(["林恒", "萧无咎"]);
    db.close();
  });
});

describe("autoCreateCharacters extraContext", () => {
  test("传入 extraContext 时作为附加上下文块进入 prompt；不传时不出现", async () => {
    const tempDir2 = await mkdtemp(join(tmpdir(), "novel-auto-extra-"));
    const db = openDatabase(join(tempDir2, "test.db"));
    const characterStore = new CharacterStore(db);
    new (await import("../../state/novel-store")).NovelStore(db).createNovel({ id: "novel-extra" });
    const channel = new FakeChannel([]);

    const baseOptions = {
      novelId: "novel-extra",
      worldview: worldview as never,
      outline: outline as never,
      newCharacters: [{ name: "萧无咎", role: "第2章登场·血宗宗主" }],
      existingCharacters: [] as never[],
      channel,
      characterStore,
    };
    const extraText = "本次规划的章节列表：\n第1章 雨夜：雨夜夺脉，萧无咎现身";
    textScript = [[[{ tool: "save_character", args: newCard("萧无咎") }]]];

    await autoCreateCharacters({ ...baseOptions, extraContext: extraText });
    expect(lastPrompt).toContain(extraText);

    textScript = [[[{ tool: "save_character", args: newCard("叶青璃") }]]];
    await autoCreateCharacters({
      ...baseOptions,
      newCharacters: [{ name: "叶青璃", role: "第1章登场·灵医传人" }],
      extraContext: undefined,
    });
    expect(lastPrompt).not.toContain("本次规划的章节列表");
    db.close();
    await rm(tempDir2, { recursive: true, force: true });
  });
});

import { afterAll, describe, expect, mock, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// store / channel 不依赖 'ai'，可静态导入；被测模块（间接引 ai）须在 mock 注册后动态导入
import { openDatabase } from "../state/db";
import type { Database } from "bun:sqlite";
import { NovelStore } from "../state/novel-store";
import { WorldviewStore } from "../state/worldview-store";
import { CharacterStore } from "../state/character-store";
import { OutlineStore } from "../state/outline-store";
import { FakeChannel } from "../ui/fake-channel";
import type { Character, Worldview } from "@novel/shared";

/**
 * regenerateOutline 集成测试：mock 掉 'ai' 模块（大纲 Agent 的 generateText
 * 按脚本执行 save_outline 确认门），交互经 FakeChannel 脚本化应答，
 * 持久化落在临时目录 SQLite 上——校验路径（小说/世界观/角色）不依赖 LLM。
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

const { regenerateOutline } = await import("./regen-outline");

const NOVEL_ID = "dddddddd-3333-7444-8555-666677778888";

const worldviewFixture: Worldview = {
  background: { geography: "九州大陆，灵脉断绝" },
  taboos: ["不可出现现代科技"],
};

const characterFixture = {
  basicInfo: { name: "林恒" },
  core: { desire: "夺回灵脉", fear: "辜负同伴", narrativeRole: "主角" },
  background: "青云市集的散修少年",
  creationPurpose: "承载打破宗门垄断的主线",
  endingDirection: "打破垄断后归隐",
} satisfies Character;

const oldTree = [
  {
    name: "旧一部·风起",
    summary: "旧一部梗概",
    acts: [
      { name: "旧一幕", summary: "旧一幕梗概", keyPlotPoints: ["旧情节点"] },
      { name: "旧二幕", summary: "旧二幕梗概", keyPlotPoints: ["旧情节点"] },
    ],
  },
];

/** 新大纲 fixture：恰好 partCount 部、共 actCount 幕（save_outline 入参 schema 强校验） */
function newOutlineFixture(partCount: number, actCount: number, title = "灵脉遗孤·新版") {
  const perPart = Math.floor(actCount / partCount);
  const remainder = actCount - perPart * partCount;
  return {
    title,
    logline: "散修少年重夺灵脉的新版故事线",
    theme: "破而后立",
    parts: Array.from({ length: partCount }, (_, i) => ({
      name: `新${i + 1}部`,
      summary: `新${i + 1}部梗概`,
      acts: Array.from({ length: perPart + (i < remainder ? 1 : 0) }, (_, j) => ({
        name: `新${i + 1}部·第${j + 1}幕`,
        summary: "新幕梗概",
        keyPlotPoints: ["新情节点"],
      })),
    })),
  };
}

interface Seeded {
  db: Database;
  dir: string;
  novelStore: NovelStore;
  worldviewStore: WorldviewStore;
  characterStore: CharacterStore;
  outlineStore: OutlineStore;
}

let openDbs: Database[] = [];
let openDirs: string[] = [];
const originalCwd = process.cwd();

/** 每个用例独立临时库：小说行 + 世界观 + 角色 + 旧版大纲树（含旧章），共享单连接 */
async function seed(withWorldview = true, withCharacters = true): Promise<Seeded> {
  const dir = await mkdtemp(join(tmpdir(), "novel-regen-outline-"));
  process.chdir(dir);
  const db = openDatabase(join(dir, "test.db"));
  openDbs.push(db);
  openDirs.push(dir);
  const world: Seeded = {
    db,
    dir,
    novelStore: new NovelStore(db),
    worldviewStore: new WorldviewStore(db),
    characterStore: new CharacterStore(db),
    outlineStore: new OutlineStore(db),
  };
  world.novelStore.createNovel({ id: NOVEL_ID, name: "灵脉遗孤", description: "旧 logline" });
  if (withWorldview) world.worldviewStore.saveWorldview(NOVEL_ID, worldviewFixture);
  if (withCharacters) world.characterStore.addCharacter(NOVEL_ID, characterFixture);
  const tree = world.outlineStore.saveOutlineTree(NOVEL_ID, oldTree);
  const firstAct = tree.find((n) => n.node.type === "act")!;
  world.outlineStore.saveChapters(NOVEL_ID, firstAct.id, [{ name: "旧章", summary: "旧章概述" }]);
  return world;
}

afterAll(async () => {
  process.chdir(originalCwd);
  for (const db of openDbs) db.close();
  for (const dir of openDirs) await rm(dir, { recursive: true, force: true });
  openDbs = [];
  openDirs = [];
});

/** 以指定 world 构造调用参数（缺省补全四 store） */
function optionsFor(world: Seeded, channel: FakeChannel) {
  return {
    channel,
    novelId: NOVEL_ID,
    novelStore: world.novelStore,
    worldviewStore: world.worldviewStore,
    characterStore: world.characterStore,
    outlineStore: world.outlineStore,
  };
}

describe("regenerateOutline（FakeChannel + mock LLM 集成）", () => {
  test("确认后新版本入库：旧树旧章降级归档，产物覆盖，description 回填", async () => {
    const world = await seed();
    textScript = [[[{ tool: "save_outline", args: newOutlineFixture(1, 5) }]]];
    const channel = new FakeChannel([5, 1, true]);

    const result = await regenerateOutline(optionsFor(world, channel));

    expect(result).toMatchObject({ novelId: NOVEL_ID, version: 2, partCount: 1, actCount: 5 });
    expect(channel.stages).toEqual(["outline"]);
    // 表单顺序：幕数 → 部数 → 大纲确认
    expect(channel.calls.map((c) => c.method)).toEqual(["askInt", "askInt", "askConfirm"]);
    expect(channel.views.at(-1)).toMatchObject({ kind: "outline", detail: "confirm" });
    expect(channel.notifies.some((n) => n.includes("第 2 版：1 部 / 5 幕"))).toBe(true);
    expect(channel.notifies.some((n) => n.includes("归档为历史版本"))).toBe(true);

    // 库：当前版本 = 新树 6 行（1 部 5 幕）；旧行（旧树 3 + 旧章 1）全部降级保留
    const current = world.outlineStore.listOutlineNodes(NOVEL_ID, { currentOnly: true });
    expect(current).toHaveLength(6);
    expect(current.every((n) => n.node.version === 2)).toBe(true);
    const all = world.outlineStore.listOutlineNodes(NOVEL_ID);
    expect(all).toHaveLength(10);
    expect(all.filter((n) => n.node.version === 1).every((n) => !n.node.isCurrentVersion)).toBe(true);
    expect(all.some((n) => n.node.name === "旧章" && !n.node.isCurrentVersion)).toBe(true);

    // 产物覆盖与 description 回填
    expect(existsSync(join(world.dir, "output", `${NOVEL_ID}.json`))).toBe(true);
    expect(world.novelStore.getNovel(NOVEL_ID)?.description).toBe("散修少年重夺灵脉的新版故事线");
  });

  test("确认循环：用户拒绝并给反馈 → Agent 修订后再次提交才入库", async () => {
    const world = await seed();
    textScript = [
      [[{ tool: "save_outline", args: newOutlineFixture(1, 5, "灵脉遗孤·初稿") }]],
      [[{ tool: "save_outline", args: newOutlineFixture(1, 3, "灵脉遗孤·修订稿") }]],
    ];
    const channel = new FakeChannel([3, 1, false, "幕数太多，精简到 3 幕", true]);

    const result = await regenerateOutline(optionsFor(world, channel));

    // 第二次提交按表单约束（恰好 1 部 3 幕）入库
    expect(result).toMatchObject({ version: 2, partCount: 1, actCount: 3 });
    expect(channel.calls.map((c) => c.method)).toEqual([
      "askInt",
      "askInt",
      "askConfirm",
      "askText",
      "askConfirm",
    ]);
    expect(world.outlineStore.listOutlineNodes(NOVEL_ID, { currentOnly: true })).toHaveLength(4);
  });

  test("小说不存在 / 世界观未确认 / 无角色：抛可读错误，不进入 Agent", async () => {
    const full = await seed();
    const noWv = await seed(false);
    const noChar = await seed(true, false);

    await expect(
      regenerateOutline({ ...optionsFor(full, new FakeChannel([])), novelId: "00000000-0000-4000-8000-000000000000" }),
    ).rejects.toThrow("小说不存在");
    await expect(regenerateOutline(optionsFor(noWv, new FakeChannel([])))).rejects.toThrow("世界观未确认");
    await expect(regenerateOutline(optionsFor(noChar, new FakeChannel([])))).rejects.toThrow("没有已入库的角色");
  });
});

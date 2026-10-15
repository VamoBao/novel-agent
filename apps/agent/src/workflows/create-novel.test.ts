import { modelMessageSchema } from "ai";
import { afterAll, describe, expect, mock, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// store 不依赖 'ai'，可静态导入（被测模块仍须在 mock 注册后动态导入）
import { ForeshadowStore } from "../state/foreshadow-store";

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

const sdkModelMessageSchema = modelMessageSchema;

mock.module("ai", () => ({
  modelMessageSchema: sdkModelMessageSchema,
  tool: (spec: unknown) => spec,
  generateText: async ({ tools }: { tools: Record<string, MockTool> }) => {
    // 脚本耗尽即抛错：任何计划外的 LLM 调用都会炸测试（「零 LLM 调用」断言的硬证明）
    const turns = textScript.shift();
    if (turns === undefined) {
      throw new Error("textScript 脚本耗尽——出现了计划外的 LLM 调用");
    }
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
const { LocationStore } = await import("../state/location-store");
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

/** 自动创建 Agent 入库「萧无咎」用的完整角色卡（过 characterSchema） */
const autoCard = {
  basicInfo: { name: "萧无咎", gender: "男" },
  core: { desire: "掌控九州灵脉", fear: "宗门基业毁于己手", narrativeRole: "反派" },
  background: "血宗宗主，靠垄断灵脉崛起",
  creationPurpose: "作为主要反派逼出主角的成长",
  endingDirection: "被主角击败，宗门垄断瓦解",
};

const outlineFixture = {
  title: "灵脉遗孤",
  logline: "散修少年夺回被宗门垄断的灵脉",
  theme: "反抗垄断",
  newCharacters: [
    { name: "萧无咎", role: "反派·血宗宗主" },
    { name: "林恒", role: "误标已有角色（应被兜底 diff 剔除）" },
  ],
  newForeshadows: [
    { surfaceAction: "宗主赐下断脉散", hiddenTruth: "药中掺了追踪灵脉的蛊种", attentionLevel: 6, characterNames: ["林恒", "萧无咎"], actName: "第1幕" },
    { surfaceAction: "幕名漂移的伏笔", hiddenTruth: "不会入库", attentionLevel: 3, characterNames: ["林恒"], actName: "不存在的幕" },
  ],
  newLocations: [{ name: "青云城", description: "东部边境要塞·主角初战的战场" }],
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
    // outline agent 一次 save_outline；auto-character agent 一轮入库萧无咎（章节规划不随大纲自动进行）
    textScript = [
      [[{ tool: "submit_worldview", args: worldviewFixture }]],
      [characterFields.map((f) => ({ tool: "save_field", args: f })), [{ tool: "submit_character", args: {} }]],
      [[{ tool: "save_outline", args: outlineFixture }]],
      [[{ tool: "save_character", args: autoCard }]],
    ];
    objectScript = [
      { options: [{ label: "都市青年读者", description: "节奏明快的成长与逆袭" }] },
      { origin: "宗门垄断灵脉", impact: "散修如草芥", idealResolution: "灵脉归于众生" },
    ];

    // 用户应答脚本（FIFO）：跳过命名 → 选仙侠 → 选叙事视角 → 选受众 → 跳过补充 → 世界观描述 →
    // 首个角色描述 → 7 次字段确认 + 整卡确认 → 结束角色 → 冲突描述 → 幕数/部数 → 大纲确认
    const channel = new FakeChannel([
      "",
      "仙侠",
      "第三人称限知",
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
    ]);

    const state = await createNovel({
      channel,
      store: memoryNovelStateStore,
      characterStore: new CharacterStore(db),
      worldviewStore: new WorldviewStore(db),
      novelStore: new NovelStore(db),
      outlineStore: new OutlineStore(db),
      foreshadowStore: new ForeshadowStore(db),
      locationStore: new LocationStore(db),
    });

    // 最终状态与产物
    expect(state.status).toBe("outlined");
    expect(state.outline?.title).toBe("灵脉遗孤");
    expect(existsSync(join(tempDir, "output", `${state.id}.json`))).toBe(true);

    // 交互轨迹：视图按预期顺序（worldview 展示 → 7 字段摘要 + 整卡 → 冲突 → 大纲确认 + 全量），
    // 章节规划不再自动衔接（无 chapter-plan 视图）
    const kinds: string[] = channel.views.map((v) => v.kind);
    expect(kinds).toEqual([
      "worldview",
      ...characterFields.map(() => "field-summary"),
      "character-card",
      "conflict",
      "outline",
      "outline",
    ]);
    expect(channel.views.at(-2)).toMatchObject({ kind: "outline", detail: "confirm" });
    expect(channel.views.at(-1)).toMatchObject({ kind: "outline", detail: "full" });

    // 通知：收尾提示、大纲入库统计与手动发起章节规划指引
    expect(channel.notifies).toContain("🗂 大纲树已入库（含梗概与关键情节点）：1 部 / 5 幕");
    expect(
      channel.notifies.some((n) => n.includes("章节规划不自动进行")),
    ).toBe(true);
    expect(channel.notifies.some((n) => n.includes("✅ 小说《灵脉遗孤》初始化完成！"))).toBe(true);

    // 持久化：novels 未命名回填大纲标题；世界观 upsert；角色入库
    const novelStore = new NovelStore(db);
    expect(novelStore.getNovel(state.id)?.name).toBe("灵脉遗孤");
    expect(novelStore.getNovel(state.id)?.description).toBe(outlineFixture.logline);
    expect(novelStore.getNovel(state.id)).toMatchObject({
      genre: "仙侠",
      narrativePov: "第三人称限知",
      audience: ["都市青年读者"],
      coreConflict: { origin: "宗门垄断灵脉", impact: "散修如草芥", idealResolution: "灵脉归于众生" },
    });
    // 视角随完整参数进内存 state（大纲 Agent 上下文同源）
    expect(state.params).toMatchObject({ genre: "仙侠", narrativePov: "第三人称限知" });
    const worldviewStore = new WorldviewStore(db);
    expect(worldviewStore.getWorldview(state.id)?.worldview.taboos).toEqual(worldviewFixture.taboos);
    const characterStore = new CharacterStore(db);
    // 新增角色自动入库：清单内「林恒」为库内已有角色，被兜底 diff 剔除（零调用、不入库），
    // 「萧无咎」经自动创建 Agent 入库
    expect(
      characterStore.listCharacters(state.id).map((c) => c.character.basicInfo.name),
    ).toEqual(["林恒", "萧无咎"]);
    // 逐卡 notify 与汇总 notify
    expect(channel.notifies.some((n) => n.includes("新角色已自动入库：萧无咎"))).toBe(true);
    expect(channel.notifies.some((n) => n.includes("新增 1 个角色已自动入库"))).toBe(true);

    // 大纲新增地点确定性入库：先于角色自动创建（毫秒级同步代码先行）
    const locationStore = new LocationStore(db);
    const locRows = locationStore.listLocations(state.id);
    expect(locRows.map((l) => l.location.name)).toEqual(["青云城"]);
    expect(locRows[0]?.location.description).toBe("东部边境要塞·主角初战的战场");
    expect(channel.notifies.some((n) => n.includes("✨ 地点已入库：青云城"))).toBe(true);
    expect(channel.notifies.some((n) => n.includes("新增 1 个地点已自动入库"))).toBe(true);
    expect(channel.notifies.findIndex((n) => n.includes("✨ 地点已入库：青云城"))).toBeLessThan(
      channel.notifies.findIndex((n) => n.includes("新角色已自动入库：萧无咎")),
    );

    // 大纲内容入库：部有梗概无情节点，幕梗概与情节点齐全；无章节点（规划改由单幕会话手动发起）
    const outlineNodes = new OutlineStore(db).listOutlineNodes(state.id);
    expect(outlineNodes).toHaveLength(6);
    const partNode = outlineNodes.find((n) => n.node.type === "part");
    expect(partNode?.node.summary).toBe("少年失去依托，踏上夺脉之路");
    expect(partNode?.node.keyPlotPoints).toBeNull();
    const firstAct = outlineNodes.find((n) => n.node.name === "第1幕");
    expect(firstAct?.node.summary).toBe("第1幕梗概");
    expect(firstAct?.node.keyPlotPoints).toEqual(["第1幕情节点"]);
    expect(outlineNodes.some((n) => n.node.type === "chapter")).toBe(false);

    // 大纲伏笔入库：幕名匹配的入库（角色 ID 解析自林恒+自动入库的萧无咎），幕名漂移的跳过
    const foreshadowStore = new ForeshadowStore(db);
    const all = foreshadowStore.listForeshadows(state.id);
    expect(all.map((f) => f.foreshadow.surfaceAction)).toEqual(["宗主赐下断脉散"]);
    const fsRow = all[0]!;
    const ids = characterStore.listCharacters(state.id).map((c) => c.id);
    expect(fsRow.foreshadow.characterIds).toEqual(ids); // 林恒、萧无咎按入库顺序
    expect(fsRow.foreshadow.recoveryStatus).toBe("unrecovered");
    expect(fsRow.actNodeId).toBeDefined();
    const actNode = new OutlineStore(db).listOutlineNodes(state.id, { currentOnly: true }).find((n) => n.node.name === "第1幕");
    expect(actNode).toBeDefined();
    expect(fsRow.actNodeId).toBe(actNode!.id);
    expect(channel.notifies.some((n) => n.includes("大纲安排了 2 处伏笔"))).toBe(true);
    expect(channel.notifies.some((n) => n.includes("本次大纲伏笔已入库 1 处（1 处因幕名/角色名未匹配跳过）"))).toBe(true);
  });

  test("大纲未引入新角色时跳过自动创建（零 LLM 调用）", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "novel-create-nonew-"));
    process.chdir(tempDir);
    const db = openDatabase(join(tempDir, "test.db"));
    closeDb = () => db.close();

    // 复用主流程脚本：newCharacters 置空，textScript 不含 auto-character agent 轮次
    const outlineNoNew = { ...outlineFixture, newCharacters: [], newLocations: [] };
    textScript = [
      [[{ tool: "submit_worldview", args: worldviewFixture }]],
      [characterFields.map((f) => ({ tool: "save_field", args: f })), [{ tool: "submit_character", args: {} }]],
      [[{ tool: "save_outline", args: outlineNoNew }]],
    ];
    objectScript = [
      { options: [{ label: "都市青年读者", description: "节奏明快的成长与逆袭" }] },
      { origin: "宗门垄断灵脉", impact: "散修如草芥", idealResolution: "灵脉归于众生" },
    ];
    const channel = new FakeChannel([
      "",
      "仙侠",
      "第三人称限知",
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
    ]);

    const state = await createNovel({
      channel,
      store: memoryNovelStateStore,
      characterStore: new CharacterStore(db),
      worldviewStore: new WorldviewStore(db),
      novelStore: new NovelStore(db),
      outlineStore: new OutlineStore(db),
      foreshadowStore: new ForeshadowStore(db),
      locationStore: new LocationStore(db),
    });

    // 空清单跳过：无自动入库相关 notify，角色库仅保留流程内确认的角色
    expect(channel.notifies.some((n) => n.includes("自动入库"))).toBe(false);
    expect(channel.notifies.some((n) => n.includes("地点已入库"))).toBe(false);
    expect(new LocationStore(db).listLocations(state.id)).toEqual([]);
    const characterStore = new CharacterStore(db);
    expect(
      characterStore.listCharacters(state.id).map((c) => c.character.basicInfo.name),
    ).toEqual(["林恒"]);
    // 零 LLM 调用：脚本轮次恰好消耗完，自动创建 Agent 未被发起
    expect(textScript).toHaveLength(0);
    expect(state.status).toBe("outlined");
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

  const audienceChoice = "都市青年读者——节奏明快的成长与逆袭";
  const conflict = { origin: "宗门垄断灵脉", impact: "散修如草芥", idealResolution: "灵脉归于众生" };
  const cases = [
    { name: "视角前中止", answers: ["", "仙侠", null], expected: { genre: "仙侠", narrativePov: null, audience: null, coreConflict: null }, withCharacter: false },
    { name: "视角后中止", answers: ["", "仙侠", "第三人称限知", null], expected: { genre: "仙侠", narrativePov: "第三人称限知", audience: null, coreConflict: null }, withCharacter: false },
    { name: "受众后中止", answers: ["", "仙侠", "第三人称限知", [audienceChoice], "重视人物关系", null], expected: { genre: "仙侠", narrativePov: "第三人称限知", audience: ["都市青年读者", "重视人物关系"], coreConflict: null }, withCharacter: false },
    { name: "大纲前中止", answers: ["", "仙侠", "第三人称限知", [audienceChoice], "", "九州大陆", "林恒", ...characterFields.map(() => true), true, "", "宗门垄断灵脉", null], expected: { genre: "仙侠", narrativePov: "第三人称限知", audience: ["都市青年读者"], coreConflict: conflict }, withCharacter: true },
  ];
  for (const scenario of cases) {
    test(`${scenario.name}：已收集创作条件仍绑定小说并可重开读取`, async () => {
      const dir = await mkdtemp(join(tmpdir(), "novel-params-abort-"));
      process.chdir(dir);
      const path = join(dir, "test.db");
      const db = openDatabase(path);
      const id = `params-${scenario.name}`;
      objectScript = [{ options: [{ label: "都市青年读者", description: "节奏明快的成长与逆袭" }] }, conflict];
      textScript = scenario.withCharacter ? [
        [[{ tool: "submit_worldview", args: worldviewFixture }]],
        [characterFields.map((f) => ({ tool: "save_field", args: f })), [{ tool: "submit_character", args: {} }]],
      ] : [];
      try {
        await expect(createNovel({
          id,
          channel: new FakeChannel(scenario.answers),
          store: memoryNovelStateStore,
          novelStore: new NovelStore(db),
          characterStore: new CharacterStore(db),
          worldviewStore: new WorldviewStore(db),
          outlineStore: new OutlineStore(db),
          foreshadowStore: new ForeshadowStore(db),
          locationStore: new LocationStore(db),
        })).rejects.toBeInstanceOf((await import("../ui/aborted")).UserAbortedError);
        expect(new NovelStore(db).getNovel(id)).toMatchObject(scenario.expected);
      } finally {
        db.close();
        process.chdir(originalCwd);
      }
      const reopened = openDatabase(path);
      try { expect(new NovelStore(reopened).getNovel(id)).toMatchObject(scenario.expected); }
      finally {
        reopened.close();
        await rm(dir, { recursive: true, force: true });
      }
    });
  }
});


test("世界观确认后重开库恢复：已确认主输入与世界观不重问", async () => {
  const dir = await mkdtemp(join(tmpdir(), "novel-create-resume-"));
  process.chdir(dir);
  const path = join(dir, "test.db");
  let db = openDatabase(path);
  let runId = "";
  const { MemoryNovelStateStore } = await import("../state/memory-store");
  const options = () => ({
    store: new MemoryNovelStateStore(), novelStore: new NovelStore(db), characterStore: new CharacterStore(db),
    worldviewStore: new WorldviewStore(db), outlineStore: new OutlineStore(db),
    foreshadowStore: new ForeshadowStore(db), locationStore: new LocationStore(db),
    onRun: (run: { id: string }) => { runId = run.id; },
  });
  objectScript = [{ options: [{ label: "青年", description: "成长" }] }];
  textScript = [[[{ tool: "submit_worldview", args: worldviewFixture }]]];
  try {
    await expect(createNovel({ ...options(), id: "create-resume-worldview", channel: new FakeChannel([
      "", "仙侠", "第三人称限知", ["青年——成长"], "", "九州大陆", null,
    ]) })).rejects.toBeInstanceOf((await import("../ui/aborted")).UserAbortedError);
    db.close();
    db = openDatabase(path);
    objectScript = [{ origin: "垄断", impact: "压迫", idealResolution: "自由" }];
    textScript = [
      [characterFields.map((f) => ({ tool: "save_field", args: f })), [{ tool: "submit_character", args: {} }]],
      [[{ tool: "save_outline", args: { ...outlineFixture, newCharacters: [], newForeshadows: [] } }]],
    ];
    const channel = new FakeChannel(["林恒", ...characterFields.map(() => true), true, "", "垄断灵脉", 5, 1, true]);
    const state = await createNovel({ ...options(), resumeRunId: runId, channel });
    expect(state.id).toBe("create-resume-worldview");
    expect(state.status).toBe("outlined");
    expect(state.params?.worldview).toEqual(worldviewFixture);
    expect(channel.calls[0]?.prompt).toContain("首个角色");
    expect(new CharacterStore(db).listCharacters(state.id)).toHaveLength(1);
    expect(textScript).toHaveLength(0);
    expect(objectScript).toHaveLength(0);
  } finally {
    db.close();
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  }
});

test("大纲确认后建卡失败：outlined 内存态仍可补完，完成后按 ID 返回完整结果", async () => {
  const dir = await mkdtemp(join(tmpdir(), "novel-create-outline-resume-"));
  process.chdir(dir);
  const db = openDatabase(join(dir, "test.db"));
  const { MemoryNovelStateStore } = await import("../state/memory-store");
  const options = {
    id: "create-resume-outline", store: new MemoryNovelStateStore(), novelStore: new NovelStore(db),
    characterStore: new CharacterStore(db), worldviewStore: new WorldviewStore(db), outlineStore: new OutlineStore(db),
    foreshadowStore: new ForeshadowStore(db), locationStore: new LocationStore(db),
  };
  let runId = "";
  objectScript = [
    { options: [{ label: "青年", description: "成长" }] },
    { origin: "垄断", impact: "压迫", idealResolution: "自由" },
  ];
  textScript = [
    [[{ tool: "submit_worldview", args: worldviewFixture }]],
    [characterFields.map((f) => ({ tool: "save_field", args: f })), [{ tool: "submit_character", args: {} }]],
    [[{ tool: "save_outline", args: outlineFixture }]],
    [[{ tool: "模拟中断", args: {} }]],
  ];
  try {
    await expect(createNovel({ ...options, onRun: (run: { id: string }) => { runId = run.id; }, channel: new FakeChannel([
      "", "仙侠", "第三人称限知", ["青年——成长"], "", "九州大陆", "林恒",
      ...characterFields.map(() => true), true, "", "垄断灵脉", 5, 1, true,
    ]) })).rejects.toThrow("模拟中断");
    const nodeIds = options.outlineStore.listOutlineNodes(options.id).map((n) => n.id);
    textScript = [[[{ tool: "save_character", args: autoCard }]]];
    const channel = new FakeChannel([]);
    const state = await createNovel({ ...options, resumeRunId: runId, channel });
    expect(textScript).toHaveLength(0);
    expect(options.characterStore.listCharacters(options.id)).toHaveLength(2);
    expect(options.foreshadowStore.listForeshadows(options.id)).toHaveLength(1);
    expect(options.outlineStore.listOutlineNodes(options.id).map((n) => n.id)).toEqual(nodeIds);
    expect(channel.calls).toEqual([]);
    expect(await createNovel({ ...options, channel })).toEqual(state);
    expect(await createNovel({ ...options, store: new MemoryNovelStateStore(), channel })).toEqual(state);
    expect(await createNovel({ ...options, resumeRunId: runId, store: new MemoryNovelStateStore(), channel })).toEqual(state);
  } finally {
    db.close();
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  }
});

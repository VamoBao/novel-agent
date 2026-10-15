import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LanguageModelV4 } from "@ai-sdk/provider";
// store / channel 不依赖 'ai'，可静态导入；被测模块（间接引 ai）须在 mock 注册后动态导入
import { openDatabase } from "../state/db";
import { NovelStore } from "../state/novel-store";
import { OutlineStore } from "../state/outline-store";
import { WorldviewStore } from "../state/worldview-store";
import { CharacterStore } from "../state/character-store";
import { DocumentStore } from "../state/document-store";
import { StyleReferenceStore } from "../state/style-reference-store";
import { ForeshadowStore } from "../state/foreshadow-store";
import { CharacterMigrationStore } from "../state/migration-store";
import { FakeChannel } from "../ui/fake-channel";
import { writeDocumentArtifact } from "../output/document-writer";
import type { Character, Worldview } from "@novel/shared";
import type { WriteProgressEvent } from "./write-chapter";

/**
 * writeChapter 集成测试：mock 掉 'ai' 模块（generateText 按脚本返回正文；
 * generateObject 按 prompt 段落标识脚本化返回三段校验结果——默认全绿一次通过，
 * 用例可覆盖分段结果或注入多轮脚本），交互经 FakeChannel 记录；持久化落在
 * 临时目录 SQLite 与临时 output 目录上——正文按「小说名/部名/章名.md」层级
 * 落文件、库内只登记元数据；前置校验路径（小说 / 章节点 / 世界观 /
 * 写作模型未配置）不依赖 LLM；重新生成路径（覆盖替换）与新生成同套校验循环。
 */

type GenerateTextArgs = { model: unknown; prompt: string };
type GenerateObjectArgs = { model: unknown; prompt: string };
let generateTextCalls: GenerateTextArgs[] = [];
let generateTextResult = "";
/** 多轮正文脚本：非空时逐轮 shift，耗尽后回落 generateTextResult */
let generateTextQueue: string[] = [];
let generateObjectCalls: GenerateObjectArgs[] = [];
/** 校验三段脚本（键 = prompt 段落标识；值可为单结果或逐次 shift 的数组；缺省全绿一次通过） */
let reviewScript: {
  content?: unknown;
  style?: unknown;
  consistency?: unknown;
  error?: Error;
} = {};

/** 校验段落标识 → 脚本键（与 chapter-review.ts 的 prompt 开场文案对应） */
function reviewScriptKey(prompt: string): "content" | "style" | "consistency" {
  if (prompt.includes("设定审校编辑")) return "content";
  if (prompt.includes("文风比对评审")) return "style";
  return "consistency";
}

/** 脚本值解析：数组逐次 shift（多轮），单值恒定复用；缺省全绿 */
const DEFAULT_REVIEW: Record<string, unknown> = {
  content: { issues: [] },
  style: { score: 95, rationale: "贴合样本", suggestions: [] },
  consistency: { issues: [] },
};

function nextReviewObject(key: "content" | "style" | "consistency"): unknown {
  const scripted = reviewScript[key];
  if (Array.isArray(scripted)) {
    if (scripted.length > 1) return scripted.shift();
    return scripted[0];
  }
  if (scripted !== undefined) return scripted;
  return DEFAULT_REVIEW[key];
}

mock.module("ai", () => ({
  tool: (spec: unknown) => spec,
  generateObject: async (args: GenerateObjectArgs) => {
    if (reviewScript.error) throw reviewScript.error;
    generateObjectCalls.push(args);
    return { object: nextReviewObject(reviewScriptKey(args.prompt)) };
  },
  generateText: async (args: GenerateTextArgs) => {
    generateTextCalls.push(args);
    const text = generateTextQueue.length > 0 ? (generateTextQueue.shift() ?? "") : generateTextResult;
    return { text };
  },
}));

const { writeChapter } = await import("./write-chapter");
// 回落目标：Agent 会话模型实例（providers 静态导入，不受 mock 'ai' 影响）
const { model: agentModel } = await import("../providers/agent-model");

const DUMMY_MODEL = { modelId: "dummy-writing-model" } as unknown as LanguageModelV4;

const NOVEL_ID = "eeeeeeee-4444-7444-8555-666677778888";

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

const PROSE = "　　灵脉断绝的第九十九年，少年在市集的角落里睁开了眼。\n\n　　他掌心里那枚碎片微微发烫。";

/** 写作模型与系统级写作偏好环境变量备份（未配置路径用例需要清空） */
const WRITING_ENV_KEYS = [
  "WRITING_MODEL_NAME",
  "WRITING_MODEL_API_KEY",
  "WRITING_MODEL_BASE_URL",
  "NOVEL_CHAPTER_LENGTH_MIN",
  "NOVEL_CHAPTER_LENGTH_MAX",
  "NOVEL_STYLE_PASS_SCORE",
] as const;
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const key of WRITING_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  // 校验循环脚本状态复位（缺省 = 一次通过；用例内按需覆盖）
  generateTextQueue = [];
  generateObjectCalls = [];
  reviewScript = {};
});

afterEach(() => {
  for (const key of WRITING_ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

/** 建临时库：小说 + 世界观 + 角色 + 一部一幕两章，返回各 store 与节点 ID */
async function setupDb(options: { withWorldview?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "novel-write-"));
  const db = openDatabase(join(dir, "test.db"));
  const outputDir = join(dir, "output");
  const novelStore = new NovelStore(db);
  const outlineStore = new OutlineStore(db);
  const worldviewStore = new WorldviewStore(db);
  const characterStore = new CharacterStore(db);
  const documentStore = new DocumentStore(db);
  const foreshadowStore = new ForeshadowStore(db);
  const migrationStore = new CharacterMigrationStore(db);
  novelStore.createNovel({ id: NOVEL_ID, name: "灵脉拾遗" });
  if (options.withWorldview !== false) {
    worldviewStore.saveWorldview(NOVEL_ID, worldviewFixture);
  }
  characterStore.addCharacter(NOVEL_ID, characterFixture);
  const [, act] = outlineStore.saveOutlineTree(NOVEL_ID, [
    {
      name: "第一部",
      summary: "灵脉断绝，少年拾遗",
      acts: [{ name: "第一幕", summary: "市集风波", keyPlotPoints: ["拾得灵脉碎片", "宗门追查"] }],
    },
  ]);
  const chapters = outlineStore.saveChapters(NOVEL_ID, act!.id, [
    { name: "第一章", summary: "少年在市集拾得碎片" },
    { name: "第二章", summary: "宗门来人追查" },
    { name: "第三章", summary: "碎片来历初现" },
  ]);
  return {
    db,
    novelStore,
    outlineStore,
    worldviewStore,
    characterStore,
    documentStore,
    foreshadowStore,
    migrationStore,
    styleReferenceStore: new StyleReferenceStore(db),
    outputDir,
    actNodeId: act!.id,
    chapterNodeId: chapters[0]!.id,
    secondChapterNodeId: chapters[1]!.id,
    thirdChapterNodeId: chapters[2]!.id,
    cleanup: async () => {
      db.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

describe("writeChapter", () => {
  const cleanupAll: (() => Promise<void>)[] = [];
  afterAll(async () => {
    await Promise.all(cleanupAll.map((fn) => fn()));
  });

  test("校验通过后单轮 generateText 生成正文并入库绑定（prompt 含全部上下文）", async () => {
    const ctx = await setupDb();
    cleanupAll.push(ctx.cleanup);
    const channel = new FakeChannel([]);
    generateTextCalls = [];
    generateTextResult = PROSE;

    const result = await writeChapter({
      channel,
      novelId: NOVEL_ID,
      model: DUMMY_MODEL,
      ...ctx,
    });

    // 正文按「小说名/部名/章名.md」层级落文件，内容为生成文本
    const artifact = join(ctx.outputDir, "灵脉拾遗-eeeeeeee", "第一部", "第一章.md");
    expect(existsSync(artifact)).toBe(true);
    expect(readFileSync(artifact, "utf8")).toBe(PROSE.trim());

    // LLM 只调用一轮 generateText；prompt 携带章名/概述/世界观/前后章衔接信息
    expect(generateTextCalls).toHaveLength(1);
    const prompt = generateTextCalls[0]!.prompt;
    expect(prompt).toContain("第一章");
    expect(prompt).toContain("少年在市集拾得碎片");
    expect(prompt).toContain("九州大陆，灵脉断绝");
    expect(prompt).toContain("林恒");
    expect(prompt).toContain("市集风波");
    expect(prompt).toContain("下一章");
    expect(prompt).toContain("宗门来人追查");
    expect(prompt).toContain("2000~3000 字");
    // 未采集叙事视角（历史小说形态）：prompt 无该行（现状回归）
    expect(prompt).not.toContain("叙事视角");

    // 库内只登记元数据：file_path 相对路径 + 字数；章节点 documentId 回写 + 状态 completed
    const chapter = ctx.outlineStore.getOutlineNode(ctx.chapterNodeId)!;
    expect(chapter.node.documentId).toBe(result.documentId);
    expect(chapter.node.status).toBe("completed");
    expect(result.wordCount).toBe(38);
    const stored = ctx.documentStore.getDocumentByChapter(ctx.chapterNodeId)!;
    expect(stored.filePath).toBe(join("灵脉拾遗-eeeeeeee", "第一部", "第一章.md"));

    // 通知：启动与保存路径统计
    expect(channel.notifies.some((n) => n.includes("正文生成中"))).toBeTrue();
    expect(channel.notifies.some((n) => n.includes("正文已保存"))).toBeTrue();
  });

  test("登场角色按章绑定过滤：绑定章 prompt 只含绑定角色，未绑定章回退全库并通知", async () => {
    const ctx = await setupDb();
    cleanupAll.push(ctx.cleanup);
    // 追加第二角色并把第一章绑定到主角一人（模拟章节规划确认后的回填绑定）
    ctx.characterStore.addCharacter(NOVEL_ID, {
      ...characterFixture,
      basicInfo: { name: "萧无咎" },
      core: { desire: "垄断灵脉", fear: "基业倾覆", narrativeRole: "反派" },
    });
    const lin = ctx.characterStore.listCharacters(NOVEL_ID)[0]!;
    ctx.outlineStore.setChapterCharacters(NOVEL_ID, [
      { chapterId: ctx.chapterNodeId, characterIds: [lin.id] },
    ]);

    // 绑定章：只注入本章阵容（林恒），另一角色不进 prompt，无回退通知
    generateTextCalls = [];
    generateTextResult = PROSE;
    const boundChannel = new FakeChannel([]);
    await writeChapter({ channel: boundChannel, novelId: NOVEL_ID, model: DUMMY_MODEL, ...ctx });
    const boundPrompt = generateTextCalls[0]!.prompt;
    expect(boundPrompt).toContain("林恒");
    expect(boundPrompt).not.toContain("萧无咎");
    expect(boundChannel.notifies.some((n) => n.includes("🎭 本章未绑定登场角色"))).toBeFalse();

    // 未绑定的第二章（旧数据形态）：回退全库注入（含萧无咎）并 notify 兜底
    generateTextCalls = [];
    const legacyChannel = new FakeChannel([]);
    await writeChapter({
      channel: legacyChannel,
      novelId: NOVEL_ID,
      model: DUMMY_MODEL,
      ...ctx,
      chapterNodeId: ctx.secondChapterNodeId,
    });
    const legacyPrompt = generateTextCalls[0]!.prompt;
    expect(legacyPrompt).toContain("林恒");
    expect(legacyPrompt).toContain("萧无咎");
    expect(
      legacyChannel.notifies.some((n) => n.includes("🎭 本章未绑定登场角色（旧数据），已回退注入全库角色参考")),
    ).toBeTrue();
  });

  test("角色迁移计划注入 prompt 且与校验 ① 同源；通知统计角色变化计划", async () => {
    const ctx = await setupDb();
    cleanupAll.push(ctx.cleanup);
    const character = ctx.characterStore.listCharacters(NOVEL_ID)[0]!;
    const draft = ctx.migrationStore.addMigration(NOVEL_ID, character.id, {
      migrateField: "core.desire",
      newValue: "守护同伴",
      startChapterId: ctx.chapterNodeId,
      endChapterId: ctx.secondChapterNodeId,
      trigger: "经历背叛",
      transitionGuidance: "由复仇转向守护",
    });
    ctx.migrationStore.confirmMigration(NOVEL_ID, draft.id);

    const secondCharacter = ctx.characterStore.addCharacter(NOVEL_ID, {
      ...characterFixture, basicInfo: { name: "柳三" },
    });
    const secondMigration = ctx.migrationStore.addMigration(NOVEL_ID, secondCharacter.id, {
      migrateField: "core.desire", newValue: "独自复仇",
      startChapterId: ctx.chapterNodeId, endChapterId: ctx.secondChapterNodeId,
      trigger: "失去信任", transitionGuidance: "放弃合作",
    });
    ctx.migrationStore.confirmMigration(NOVEL_ID, secondMigration.id);
    ctx.outlineStore.setChapterCharacters(NOVEL_ID, [
      { chapterId: ctx.chapterNodeId, characterIds: [character.id, secondCharacter.id] },
    ]);

    const channel = new FakeChannel([]);
    generateTextCalls = [];
    generateObjectCalls = [];
    generateTextResult = PROSE;

    await writeChapter({ channel, novelId: NOVEL_ID, model: DUMMY_MODEL, ...ctx });

    const prompt = generateTextCalls[0]!.prompt;
    expect(prompt).toContain("【登场角色状态（角色基准卡 + 已结束迁移后的状态）】");
    expect(prompt).toContain("【本章角色变化计划（创作计划，不是已经发生的事实）】");
    expect(prompt).toContain("进行中");
    expect(prompt).toContain("旧值「夺回灵脉」→ 目标「守护同伴」");
    expect(prompt).toContain("诱因：经历背叛");
    // 写作要求附条件条（角色变化计划优先于伏笔/文风，编号从 6 起）
    expect(prompt).toContain("6. 本章角色变化按【本章角色变化计划】推进");
    // 校验 ① 收到同源角色行
    const contentPrompt = generateObjectCalls.find((call) => call.prompt.includes("设定审校编辑"))!.prompt;
    expect(contentPrompt).toContain("【本章角色状态与变化计划（正文应遵守）】");
    expect(contentPrompt).toContain("旧值「夺回灵脉」→ 目标「守护同伴」");
    expect(contentPrompt).toContain("4. character——角色变化是否符合");
    const plans = prompt.split("\n").filter((line) => line.includes("→ 目标"));
    expect(plans).toHaveLength(2);
    expect(plans.find((line) => line.includes("林恒"))).toContain("守护同伴");
    expect(plans.find((line) => line.includes("柳三"))).toContain("独自复仇");
    for (const plan of plans) expect(contentPrompt).toContain(plan);
    expect(channel.notifies.some((line) => line.includes("本章角色变化计划：2 条"))).toBe(true);
  });

  test("补全角色字段与已结束历史同时进入写作和内容审校", async () => {
    const ctx = await setupDb();
    cleanupAll.push(ctx.cleanup);
    const character = ctx.characterStore.listCharacters(NOVEL_ID)[0]!;
    ctx.migrationStore.saveMigration(NOVEL_ID, character.id, {
      action: "create", confirm: true, input: {
        migrateField: "core.desire", newValue: "守护同伴", startChapterId: ctx.chapterNodeId,
        endChapterId: ctx.chapterNodeId, trigger: "历史独有诱因", transitionGuidance: "历史独有过渡",
      },
    });
    generateTextCalls = [];
    generateObjectCalls = [];
    generateTextResult = PROSE;
    await writeChapter({ channel: new FakeChannel([]), novelId: NOVEL_ID, model: DUMMY_MODEL, ...ctx, chapterNodeId: ctx.secondChapterNodeId });
    const prompt = generateTextCalls[0]!.prompt;
    const review = generateObjectCalls.find(call => call.prompt.includes("设定审校编辑"))!.prompt;
    for (const expected of ["背景：青云市集的散修少年", "创作目的：承载打破宗门垄断的主线", "结局方向：打破垄断后归隐", "【已结束角色迁移历史", "林恒 · 渴望（计划区间已结束", "旧值「夺回灵脉」→ 目标「守护同伴」", "诱因：历史独有诱因", "过渡描述：历史独有过渡", "不代表正文已兑现"]) {
      expect(prompt).toContain(expected);
      expect(review).toContain(expected);
    }
  });

  test("无迁移时角色块只含基准卡与已结束状态（无计划块、无附加要求）", async () => {
    const ctx = await setupDb();
    cleanupAll.push(ctx.cleanup);
    const channel = new FakeChannel([]);
    generateTextCalls = [];
    generateTextResult = PROSE;

    await writeChapter({ channel, novelId: NOVEL_ID, model: DUMMY_MODEL, ...ctx });

    const prompt = generateTextCalls[0]!.prompt;
    expect(prompt).toContain("【登场角色状态（角色基准卡 + 已结束迁移后的状态）】");
    expect(prompt).not.toContain("【本章角色变化计划");
    expect(prompt).not.toContain("本章角色变化按【本章角色变化计划】推进");
    expect(channel.notifies.some((line) => line.includes("本章角色变化计划"))).toBe(false);
  });

  test("写作偏好小说级覆盖：篇幅进 prompt、合格线进校验与通过判定、通报覆盖生效", async () => {
    const ctx = await setupDb();
    cleanupAll.push(ctx.cleanup);
    // 小说级：篇幅 3000~4500 + 合格线 85；系统级（注入）：1500~2500 + 60
    ctx.novelStore.updateWritingPrefs(NOVEL_ID, {
      chapterLengthMin: 3000,
      chapterLengthMax: 4500,
      stylePassScore: 85,
    });
    ctx.styleReferenceStore.addStyleReference(NOVEL_ID, { name: "样本", content: "文风文本。" });
    generateTextCalls = [];
    generateObjectCalls = [];
    generateTextQueue = [PROSE, "　　按 85 分合格线修订后的第二版正文。"];
    // 文风首轮 82（高于系统 60、低于小说级 85 → 不通过），修订轮 90（达标）
    reviewScript = {
      style: [
        { score: 82, rationale: "句式偏短促", suggestions: ["增加环境描写"] },
        { score: 90, rationale: "贴合样本", suggestions: [] },
      ],
    };

    const channel = new FakeChannel([]);
    const events: WriteProgressEvent[] = [];
    await writeChapter({
      channel,
      novelId: NOVEL_ID,
      model: DUMMY_MODEL,
      onProgress: (event) => events.push(event),
      systemWritingPrefs: { chapterLengthMin: 1500, chapterLengthMax: 2500, stylePassScore: 60 },
      ...ctx,
    });

    // 篇幅：小说级胜出，系统级不出现
    const prompt = generateTextCalls[0]!.prompt;
    expect(prompt).toContain("篇幅约 3000~4500 字");
    expect(prompt).not.toContain("1500~2500");
    // 合格线：文风校验 prompt 使用小说级 85；82 分判不通过 → 进入第 2 轮修订
    const stylePrompt = generateObjectCalls.find((call) => call.prompt.includes("文风比对评审"))!.prompt;
    expect(stylePrompt).toContain("85 分及以上为合格");
    expect(generateTextCalls).toHaveLength(2);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.stylePassScore === 85)).toBeTrue();
    // 修订块的合格线同源（85）
    const revisionPrompt = generateTextCalls[1]!.prompt;
    expect(revisionPrompt).toContain("文风相似度 82 分（合格线 85）");
    // 覆盖生效通报（篇幅与合格线各一条）
    expect(channel.notifies.some((n) => n.includes("📏 本小说篇幅偏好：约 3000~4500 字（覆盖系统设置）"))).toBeTrue();
    expect(channel.notifies.some((n) => n.includes("📏 本小说文风合格线：85 分（覆盖系统设置）"))).toBeTrue();
    expect(channel.notifies.some((n) => n.includes("♻️ 第 2 轮：上一版未达标准（内容 0 处、文风 82 分、自洽 0 处）"))).toBeTrue();
  });

  test("写作偏好系统级回落：小说未设置时用系统值，无覆盖通报；小说级半设篇幅防御性忽略", async () => {
    const ctx = await setupDb();
    cleanupAll.push(ctx.cleanup);
    // 小说级只设了阈值（篇幅未设）→ 篇幅走系统级，阈值走小说级
    ctx.novelStore.updateWritingPrefs(NOVEL_ID, {
      chapterLengthMin: null,
      chapterLengthMax: null,
      stylePassScore: 90,
    });
    ctx.styleReferenceStore.addStyleReference(NOVEL_ID, { name: "样本", content: "文风文本。" });
    generateTextCalls = [];
    generateObjectCalls = [];
    generateTextResult = PROSE;

    const channel = new FakeChannel([]);
    await writeChapter({
      channel,
      novelId: NOVEL_ID,
      model: DUMMY_MODEL,
      systemWritingPrefs: { chapterLengthMin: 1200, chapterLengthMax: 1800, stylePassScore: 60 },
      ...ctx,
    });

    const prompt = generateTextCalls[0]!.prompt;
    expect(prompt).toContain("篇幅约 1200~1800 字");
    // 阈值 90 生效：默认脚本 95 分照常通过；文风 prompt 带 90
    const stylePrompt = generateObjectCalls.find((call) => call.prompt.includes("文风比对评审"))!.prompt;
    expect(stylePrompt).toContain("90 分及以上为合格");
    // 篇幅未设小说级 → 只有阈值覆盖通报，无篇幅通报
    expect(channel.notifies.some((n) => n.includes("本小说篇幅偏好"))).toBeFalse();
    expect(channel.notifies.some((n) => n.includes("📏 本小说文风合格线：90 分（覆盖系统设置）"))).toBeTrue();

    // 库内半设篇幅（绕过 store 校验的手改形态）：该级篇幅整体忽略，回落系统级
    ctx.db
      .prepare(`UPDATE novels SET chapter_length_min = 9999 WHERE id = ?`)
      .run(NOVEL_ID);
    generateTextCalls = [];
    await writeChapter({
      channel: new FakeChannel([]),
      novelId: NOVEL_ID,
      model: DUMMY_MODEL,
      systemWritingPrefs: { chapterLengthMin: 1200, chapterLengthMax: 1800, stylePassScore: 60 },
      ...ctx,
    });
    expect(generateTextCalls[0]!.prompt).toContain("篇幅约 1200~1800 字");
  });

  test("叙事视角注入：采集后随【小说】块进 prompt（全程保持），未采集零注入", async () => {
    const ctx = await setupDb();
    cleanupAll.push(ctx.cleanup);
    ctx.novelStore.updateNovel(NOVEL_ID, { narrativePov: "第三人称限知" });
    generateTextCalls = [];
    generateTextResult = PROSE;

    await writeChapter({ channel: new FakeChannel([]), novelId: NOVEL_ID, model: DUMMY_MODEL, ...ctx });

    const prompt = generateTextCalls[0]!.prompt;
    expect(prompt).toContain("叙事视角：第三人称限知");
    expect(prompt).toContain("正文叙述全程保持该视角");
    // 位于【小说】块内（书名 / 简介之后，世界观之前）
    const novelAt = prompt.indexOf("【小说】");
    const povAt = prompt.indexOf("叙事视角：");
    const worldviewAt = prompt.indexOf("【世界观】");
    expect(povAt).toBeGreaterThan(novelAt);
    expect(povAt).toBeLessThan(worldviewAt);
  });

  test("跨幕上一章衔接：前章正文可用时注入 prompt，超预算回退概述", async () => {
    const ctx = await setupDb();
    cleanupAll.push(ctx.cleanup);
    // 追加第二幕与第四章（跨幕衔接）
    const act1 = ctx.outlineStore
      .listOutlineNodes(NOVEL_ID, { currentOnly: true })
      .find((n) => n.node.type === "act")!;
    const extraAct = ctx.outlineStore.addOutlineNode(NOVEL_ID, {
      type: "act",
      name: "第二幕",
      summary: "幕二梗概",
      keyPlotPoints: ["点二"],
      sort: 2,
      parentId: act1.node.parentId,
    });
    const [fourth] = ctx.outlineStore.saveChapters(NOVEL_ID, extraAct.id, [
      { name: "第四章", summary: "第四章概述" },
    ]);
    const thirdChapter = ctx.outlineStore.getOutlineNode(ctx.thirdChapterNodeId)!;
    const prose = "第三章的结尾：碎片映出旧日影像。";
    const relative = "灵脉拾遗-eeeeeeee/第一部/第三章.md";
    writeDocumentArtifact(relative, prose, ctx.outputDir);
    ctx.documentStore.saveChapterDocument(NOVEL_ID, thirdChapter.id, relative, 16);

    const channel = new FakeChannel([]);
    generateTextCalls = [];
    generateTextResult = PROSE;
    await writeChapter({ channel, novelId: NOVEL_ID, model: DUMMY_MODEL, ...ctx, chapterNodeId: fourth!.id });
    let prompt = generateTextCalls[0]!.prompt;
    expect(prompt).toContain("【上一章（衔接其结尾，不要重复叙述）】");
    expect(prompt).toContain("第三章");
    expect(prompt).toContain(prose);

    // 超预算：整条降级为概述（不截断、不注入正文）
    const big = "字".repeat(8001);
    writeDocumentArtifact(relative, big, ctx.outputDir);
    generateTextCalls = [];
    await writeChapter({ channel, novelId: NOVEL_ID, model: DUMMY_MODEL, ...ctx, chapterNodeId: fourth!.id });
    prompt = generateTextCalls[0]!.prompt;
    expect(prompt).not.toContain(big);
    expect(prompt).toContain("第三章：碎片来历初现");
  });

  test("前置校验：小说不存在 / 章节不存在 / 非章节点 / 已有正文 / 世界观未确认均报可读错误", async () => {
    const ctx = await setupDb();
    cleanupAll.push(ctx.cleanup);
    const base = { channel: new FakeChannel([]), model: DUMMY_MODEL, ...ctx } as const;

    // 小说不存在
    await expect(
      writeChapter({ ...base, novelId: "ffffffff-0000-7000-8000-000000000001", chapterNodeId: ctx.chapterNodeId }),
    ).rejects.toThrow("小说不存在，无法生成正文");

    // 章节节点不存在
    await expect(
      writeChapter({ ...base, novelId: NOVEL_ID, chapterNodeId: "ffffffff-0000-7000-8000-000000000002" }),
    ).rejects.toThrow("章节节点不存在或不属于该小说");

    // 非章节点（幕）
    await expect(
      writeChapter({ ...base, novelId: NOVEL_ID, chapterNodeId: ctx.actNodeId }),
    ).rejects.toThrow("不是章");

    // 已有正文不再拒绝：走重新生成路径（覆盖替换，见下方重生成用例）

    // 世界观未确认（另一章，避开上一用例的正文占用）
    const noWorldview = await setupDb({ withWorldview: false });
    cleanupAll.push(noWorldview.cleanup);
    await expect(
      writeChapter({
        channel: new FakeChannel([]),
        novelId: NOVEL_ID,
        model: DUMMY_MODEL,
        ...noWorldview,
      }),
    ).rejects.toThrow("世界观未确认");
  });

  test("写作模型未配置：回落 Agent 会话模型（OpenAI 兼容）仍完成生成与入库", async () => {
    const ctx = await setupDb();
    cleanupAll.push(ctx.cleanup);
    generateTextCalls = [];
    generateTextResult = PROSE;

    const result = await writeChapter({
      channel: new FakeChannel([]),
      novelId: NOVEL_ID,
      ...ctx,
    });

    // 回落实例即 agent-model.ts 的 model；正文照常落文件入库
    expect(generateTextCalls).toHaveLength(1);
    expect(generateTextCalls[0]!.model).toBe(agentModel);
    expect(existsSync(join(ctx.outputDir, "灵脉拾遗-eeeeeeee", "第一部", "第一章.md"))).toBe(true);
    expect(result.documentId).toBeDefined();
  });

  test("同名正文文件已存在（大纲重生成复用章名）：自动加 -2 后缀不覆盖", async () => {
    const ctx = await setupDb();
    cleanupAll.push(ctx.cleanup);
    generateTextCalls = [];
    generateTextResult = PROSE;

    // 预置同名文件（模拟上一版大纲的同名章正文残留）
    const legacy = join(ctx.outputDir, "灵脉拾遗-eeeeeeee", "第一部", "第一章.md");
    await Bun.write(legacy, "旧版同名章的正文。");

    const result = await writeChapter({
      channel: new FakeChannel([]),
      novelId: NOVEL_ID,
      model: DUMMY_MODEL,
      ...ctx,
    });

    // 旧文件原样保留，新正文落到 -2 后缀文件
    expect(readFileSync(legacy, "utf8")).toBe("旧版同名章的正文。");
    const newPath = join(ctx.outputDir, "灵脉拾遗-eeeeeeee", "第一部", "第一章-2.md");
    expect(existsSync(newPath)).toBe(true);
    expect(readFileSync(newPath, "utf8")).toBe(PROSE.trim());
    expect(ctx.documentStore.getDocumentByChapter(ctx.chapterNodeId)!.filePath).toBe(
      join("灵脉拾遗-eeeeeeee", "第一部", "第一章-2.md"),
    );
    expect(result.documentId).toBeDefined();
  });

  test("库绑定失败：回滚删除已写文件，不留孤儿", async () => {
    const ctx = await setupDb();
    cleanupAll.push(ctx.cleanup);
    generateTextCalls = [];
    generateTextResult = PROSE;

    // store 替身：前置查重通过、登记时抛错（模拟库故障）
    const failingStore = {
      getDocumentByChapter: () => undefined,
      saveChapterDocument: () => {
        throw new Error("模拟库写入失败");
      },
    } as unknown as DocumentStore;

    await expect(
      writeChapter({
        channel: new FakeChannel([]),
        novelId: NOVEL_ID,
        model: DUMMY_MODEL,
        ...ctx,
        documentStore: failingStore,
      }),
    ).rejects.toThrow("模拟库写入失败");
    expect(existsSync(join(ctx.outputDir, "灵脉拾遗-eeeeeeee", "第一部", "第一章.md"))).toBe(false);
    expect(ctx.documentStore.listDocuments(NOVEL_ID)).toHaveLength(0);
  });

  test("生成结果为空：抛可读错误且库中无残留", async () => {
    const ctx = await setupDb();
    cleanupAll.push(ctx.cleanup);
    generateTextCalls = [];
    generateTextResult = "   ";

    await expect(
      writeChapter({
        channel: new FakeChannel([]),
        novelId: NOVEL_ID,
        model: DUMMY_MODEL,
        ...ctx,
      }),
    ).rejects.toThrow("空正文");
    expect(ctx.documentStore.listDocuments(NOVEL_ID)).toHaveLength(0);
    expect(ctx.outlineStore.getOutlineNode(ctx.chapterNodeId)!.node.documentId).toBeNull();
  });

  test("无启用文风：prompt 无【参考文风】段与模仿要求、零文风通知（现状回归）", async () => {
    const ctx = await setupDb();
    cleanupAll.push(ctx.cleanup);
    generateTextCalls = [];
    generateTextResult = PROSE;

    // 库里有文风但全部停用——同样视为无启用文风
    ctx.styleReferenceStore.addStyleReference(NOVEL_ID, {
      name: "停用样本",
      content: "被停用的文风。",
      enabled: false,
    });

    const channel = new FakeChannel([]);
    await writeChapter({ channel, novelId: NOVEL_ID, model: DUMMY_MODEL, ...ctx });

    const prompt = generateTextCalls[0]!.prompt;
    expect(prompt).not.toContain("【参考文风】");
    expect(prompt).not.toContain("模仿参考文风");
    expect(prompt).not.toContain("被停用的文风");
    expect(channel.notifies.some((n) => n.includes("参考文风"))).toBeFalse();
  });

  test("启用文风注入：【参考文风】段落位于下一章块之后写作要求之前，附模仿要求与生效清单通知", async () => {
    const ctx = await setupDb();
    cleanupAll.push(ctx.cleanup);
    generateTextCalls = [];
    generateTextResult = PROSE;

    ctx.styleReferenceStore.addStyleReference(NOVEL_ID, {
      name: "江南式打斗",
      content: "刀光一闪，血溅三步。",
    });
    ctx.styleReferenceStore.addStyleReference(NOVEL_ID, {
      name: "张爱玲腔",
      content: "生命是一袭华美的袍。",
    });

    const channel = new FakeChannel([]);
    await writeChapter({ channel, novelId: NOVEL_ID, model: DUMMY_MODEL, ...ctx });

    const prompt = generateTextCalls[0]!.prompt;
    // 两份样本全文与名字随段注入
    expect(prompt).toContain("【参考文风】");
    expect(prompt).toContain("（江南式打斗）");
    expect(prompt).toContain("刀光一闪，血溅三步。");
    expect(prompt).toContain("（张爱玲腔）");
    expect(prompt).toContain("生命是一袭华美的袍。");
    // 长样本放尾部：下一章衔接块之后、写作要求之前
    const styleAt = prompt.indexOf("【参考文风】");
    const nextAt = prompt.indexOf("【下一章");
    const reqAt = prompt.indexOf("写作要求：");
    expect(nextAt).toBeGreaterThan(-1);
    expect(styleAt).toBeGreaterThan(nextAt);
    expect(styleAt).toBeLessThan(reqAt);
    // 写作要求附模仿条（模仿风格但不抄袭情节与专有名词）
    expect(prompt).toContain("模仿参考文风");
    expect(prompt).toContain("不抄袭其具体情节与专有名词");
    // 生成前通报生效样本名单
    expect(channel.notifies.some((n) => n.includes("🖋️ 本次参考文风：江南式打斗、张爱玲腔"))).toBeTrue();
  });

  test("混合启用停用：只注入启用条目，通知名单不含停用样本", async () => {
    const ctx = await setupDb();
    cleanupAll.push(ctx.cleanup);
    generateTextCalls = [];
    generateTextResult = PROSE;

    ctx.styleReferenceStore.addStyleReference(NOVEL_ID, {
      name: "启用样本",
      content: "启用的文风文本。",
      enabled: true,
    });
    ctx.styleReferenceStore.addStyleReference(NOVEL_ID, {
      name: "停用样本",
      content: "停用的文风文本。",
      enabled: false,
    });

    const channel = new FakeChannel([]);
    await writeChapter({ channel, novelId: NOVEL_ID, model: DUMMY_MODEL, ...ctx });

    const prompt = generateTextCalls[0]!.prompt;
    expect(prompt).toContain("（启用样本）");
    expect(prompt).toContain("启用的文风文本。");
    expect(prompt).not.toContain("（停用样本）");
    expect(prompt).not.toContain("停用的文风文本。");
    expect(channel.notifies.some((n) => n.includes("🖋️ 本次参考文风：启用样本"))).toBeTrue();
  });

  test("无绑定伏笔：prompt 无【本章伏笔】段与伏笔要求、无伏笔通知（现状回归）", async () => {
    const ctx = await setupDb();
    cleanupAll.push(ctx.cleanup);
    generateTextCalls = [];
    generateTextResult = PROSE;

    const channel = new FakeChannel([]);
    await writeChapter({ channel, novelId: NOVEL_ID, model: DUMMY_MODEL, ...ctx });

    const prompt = generateTextCalls[0]!.prompt;
    expect(prompt).not.toContain("【本章伏笔】");
    expect(prompt).not.toContain("按注意度控制显隐程度");
    // 写作要求编号与既有形态一致（无附加条时「只输出正文文本」仍是第 6 条）
    expect(prompt).toContain("6. 只输出正文文本");
    expect(channel.notifies.some((n) => n.includes("本章伏笔"))).toBeFalse();
  });

  test("登场与同章种收注入：伏笔块位于下一章块之后参考文风之前，通知统计，要求附加条编号顺延", async () => {
    const ctx = await setupDb();
    cleanupAll.push(ctx.cleanup);
    generateTextCalls = [];
    generateTextResult = PROSE;

    const lin = ctx.characterStore.listCharacters(NOVEL_ID)[0]!;
    ctx.foreshadowStore.addForeshadow(NOVEL_ID, {
      surfaceAction: "碎片刻着细如发丝的痕",
      hiddenTruth: "碎片是宗门失窃的镇脉之物",
      attentionLevel: 7,
      recoveryStatus: "unrecovered",
      appearChapterId: ctx.chapterNodeId,
      characterIds: [lin.id],
    });
    ctx.foreshadowStore.addForeshadow(NOVEL_ID, {
      surfaceAction: "宗门告示的墨迹未干",
      hiddenTruth: "告示出自宗门内鬼",
      attentionLevel: 5,
      recoveryStatus: "unrecovered",
      appearChapterId: ctx.chapterNodeId,
      recoverChapterIds: [ctx.chapterNodeId],
    });
    ctx.styleReferenceStore.addStyleReference(NOVEL_ID, { name: "样本", content: "文风文本。" });

    const channel = new FakeChannel([]);
    await writeChapter({ channel, novelId: NOVEL_ID, model: DUMMY_MODEL, ...ctx });

    const prompt = generateTextCalls[0]!.prompt;
    expect(prompt).toContain("【本章伏笔】");
    expect(prompt).toContain("一、本章登场");
    expect(prompt).toContain("碎片刻着细如发丝的痕");
    expect(prompt).toContain("服务角色：林恒");
    expect(prompt).toContain("二、本章回收");
    expect(prompt).toContain("登场于本章：");
    // 块位置：下一章块之后、参考文风之前（核心叙事上下文区，长样本文风仍留尾部）
    const foreshadowAt = prompt.indexOf("【本章伏笔】");
    const nextAt = prompt.indexOf("【下一章");
    const styleAt = prompt.indexOf("【参考文风】");
    const reqAt = prompt.indexOf("写作要求：");
    expect(nextAt).toBeGreaterThan(-1);
    expect(foreshadowAt).toBeGreaterThan(nextAt);
    expect(foreshadowAt).toBeLessThan(styleAt);
    expect(styleAt).toBeLessThan(reqAt);
    // 条件附加要求编号顺延：6=伏笔、7=文风、8=只输出正文文本
    expect(prompt).toContain("6. 本章如有登场伏笔");
    expect(prompt).toContain("7. 模仿参考文风");
    expect(prompt).toContain("8. 只输出正文文本");
    expect(channel.notifies.some((n) => n.includes("🔮 本章伏笔：登场 1 条、回收 1 条"))).toBeTrue();
  });

  test("回收伏笔登场章上下文：正文优先注入、未生成章概述兜底，通知带降级计数", async () => {
    const ctx = await setupDb();
    cleanupAll.push(ctx.cleanup);
    generateTextCalls = [];
    generateTextResult = PROSE;

    // 登场章 = 第一章（写正文文件 + 登记元数据）；另一条伏笔登场章 = 第三章（未写正文）
    const prose = "　　少年把碎片藏进袖中，指腹擦过那道细如发丝的刻痕。\n\n　　宗门的告示贴在市集口，墨迹未干。";
    const rel = join("灵脉拾遗-eeeeeeee", "第一部", "第一章.md");
    writeDocumentArtifact(rel, prose, ctx.outputDir);
    ctx.documentStore.saveChapterDocument(NOVEL_ID, ctx.chapterNodeId, rel, 52);
    ctx.foreshadowStore.addForeshadow(NOVEL_ID, {
      surfaceAction: "碎片刻有宗门印记",
      hiddenTruth: "碎片是宗门失窃的镇脉之物",
      attentionLevel: 6,
      recoveryStatus: "unrecovered",
      appearChapterId: ctx.chapterNodeId,
      recoverChapterIds: [ctx.secondChapterNodeId],
    });
    ctx.foreshadowStore.addForeshadow(NOVEL_ID, {
      surfaceAction: "告示墨迹未干",
      hiddenTruth: "告示出自内鬼",
      attentionLevel: 5,
      recoveryStatus: "unrecovered",
      appearChapterId: ctx.thirdChapterNodeId,
      recoverChapterIds: [ctx.secondChapterNodeId],
    });

    const channel = new FakeChannel([]);
    await writeChapter({
      channel,
      novelId: NOVEL_ID,
      model: DUMMY_MODEL,
      ...ctx,
      chapterNodeId: ctx.secondChapterNodeId,
    });

    const prompt = generateTextCalls[0]!.prompt;
    expect(prompt).toContain("登场于《第一章》");
    expect(prompt).toContain("登场章正文（呼应其细节，不要照抄）：");
    expect(prompt).toContain(prose);
    expect(prompt).toContain("登场章正文未生成——该章剧情概述：碎片来历初现");
    expect(prompt).not.toContain("一、本章登场");
    expect(
      channel.notifies.some((n) =>
        n.includes("🔮 本章伏笔：登场 0 条、回收 2 条（1 条登场章正文缺失或超预算，以概述代替）"),
      ),
    ).toBeTrue();
  });

  test("阶段回收章：写作与 eval 同源约束保留核心真相，不按数组末项判定最终回收", async () => {
    const ctx = await setupDb();
    cleanupAll.push(ctx.cleanup);
    generateTextCalls = [];
    generateTextResult = "宗门追查碎片的刻痕，尚未说明它的全部用途。";
    ctx.foreshadowStore.addForeshadow(NOVEL_ID, {
      surfaceAction: "碎片刻痕", hiddenTruth: "碎片是密钥", attentionLevel: 6,
      recoveryStatus: "recovered", appearChapterId: ctx.chapterNodeId,
      recoverChapterIds: [ctx.thirdChapterNodeId, ctx.secondChapterNodeId],
    });
    await writeChapter({ channel: new FakeChannel([]), novelId: NOVEL_ID, model: DUMMY_MODEL,
      ...ctx, chapterNodeId: ctx.secondChapterNodeId });
    const writing = generateTextCalls[0]!.prompt;
    const review = generateObjectCalls.find(call => call.prompt.includes("设定审校编辑"))!.prompt;
    for (const prompt of [writing, review]) {
      expect(prompt).toContain("回收阶段：阶段回收");
      expect(prompt).toContain("最终回收章：《第三章》（全书第 3 章）");
      expect(prompt).toContain("不得提前完整揭露隐藏真相");
      expect(prompt).not.toContain("回收阶段：最终回收");
    }
    expect(review).toContain("阶段回收不得提前完整揭露真相");
  });

  test("最终回收未收尾：eval 拒绝后修订，最终约束保留且只保存通过的修订稿", async () => {
    const ctx = await setupDb();
    cleanupAll.push(ctx.cleanup);
    ctx.outlineStore.updateOutlineNode(ctx.thirdChapterNodeId, {
      summary: "只发现刻痕线索，真相留待后章",
    });
    generateTextCalls = [];
    const draft = "碎片再次发热，他决定日后再查明用途。";
    const revised = "他把刻痕对准锁孔。碎片原来是密钥，宗门印记标明了开锁方向，失窃之谜终于解开。";
    generateTextQueue = [draft, revised];
    reviewScript = { content: [
      { issues: [{ kind: "foreshadow", description: "最终章仍将密钥真相留待日后",
        suggestion: "本章揭露碎片是密钥并解释宗门印记，完成伏笔收尾" }] },
      { issues: [] },
    ] };
    ctx.foreshadowStore.addForeshadow(NOVEL_ID, {
      surfaceAction: "碎片刻有宗门印记", hiddenTruth: "碎片是密钥", attentionLevel: 6,
      recoveryStatus: "unrecovered", appearChapterId: ctx.chapterNodeId,
      recoverChapterIds: [ctx.thirdChapterNodeId, ctx.secondChapterNodeId],
    });
    const events: WriteProgressEvent[] = [];
    await writeChapter({ channel: new FakeChannel([]), novelId: NOVEL_ID, model: DUMMY_MODEL,
      ...ctx, chapterNodeId: ctx.thirdChapterNodeId, onProgress: event => events.push(event) });
    expect(generateTextCalls).toHaveLength(2);
    const reviews = generateObjectCalls.filter(call => call.prompt.includes("设定审校编辑"));
    expect(reviews).toHaveLength(2);
    for (const call of [...generateTextCalls, ...reviews]) {
      expect(call.prompt).toContain("回收阶段：最终回收");
      expect(call.prompt).toContain("最终回收章：《第三章》（全书第 3 章）");
      expect(call.prompt).toContain("本章必须完整揭露隐藏真相");
      expect(call.prompt).toContain("解释表面行为与真相的联系");
      expect(call.prompt).toContain("最终收尾要求优先于概述中推迟揭露或继续悬置的描述");
    }
    expect(generateTextCalls[0]!.prompt).toContain("最终回收必须在本章揭露完整真相并收尾");
    expect(generateTextCalls[1]!.prompt).toContain("（伏笔）：最终章仍将密钥真相留待日后");
    expect(reviews[0]!.prompt).toContain("未完整揭露真相");
    expect(reviews[0]!.prompt).toContain("不得仅因落实最终收尾而报告 summary 问题");
    expect(events.find(event => event.phase === "revising")?.report).toMatchObject({
      passed: false, content: { issues: [{ kind: "foreshadow" }] },
    });
    expect(events.find(event => event.phase === "saving")?.report).toMatchObject({ passed: true, round: 2 });
    const stored = ctx.documentStore.getDocumentByChapter(ctx.thirdChapterNodeId)!;
    const saved = readFileSync(join(ctx.outputDir, stored.filePath), "utf8");
    expect(saved).toContain(revised);
    expect(saved).not.toContain(draft);
  });

  test("校验一次通过：三段校验调用注入模型，进度事件按序触发，saving 事件携带通过报告", async () => {
    const ctx = await setupDb();
    cleanupAll.push(ctx.cleanup);
    generateTextCalls = [];
    generateTextResult = PROSE;
    ctx.styleReferenceStore.addStyleReference(NOVEL_ID, { name: "样本", content: "文风文本。" });

    const REVIEW_MODEL = { modelId: "dummy-review-model" } as unknown as LanguageModelV4;
    const events: WriteProgressEvent[] = [];
    const channel = new FakeChannel([]);
    await writeChapter({
      channel,
      novelId: NOVEL_ID,
      model: DUMMY_MODEL,
      reviewModel: REVIEW_MODEL,
      onProgress: (event) => events.push(event),
      ...ctx,
    });

    // 生成 1 次 + 校验 3 次（有启用文风），校验调用全部用注入的校验模型
    expect(generateTextCalls).toHaveLength(1);
    expect(generateObjectCalls).toHaveLength(3);
    expect(generateObjectCalls.every((call) => call.model === REVIEW_MODEL)).toBeTrue();

    // 进度事件序列：drafting → 三段校验 → saving；chapterNodeId / totalRounds 随行
    expect(events.map((event) => event.phase)).toEqual([
      "drafting",
      "review-content",
      "review-content",
      "review-style",
      "review-style",
      "review-consistency",
      "review-consistency",
      "saving",
    ]);
    expect(events.every((event) => event.chapterNodeId === ctx.chapterNodeId)).toBeTrue();
    expect(events.every((event) => event.totalRounds === 3)).toBeTrue();
    expect(events.every((event) => event.stylePassScore === 80)).toBeTrue();
    // 段开始事件不带报告，段结束带单项结果；saving 携带完整报告
    expect(events[1]!.report).toBeUndefined();
    expect(events[2]!.stageResult).toMatchObject({ phase: "review-content", result: { issues: [] } });
    expect(events[4]!.stageResult).toMatchObject({ phase: "review-style", result: { skipped: false } });
    expect(events[6]!.stageResult).toMatchObject({ phase: "review-consistency", result: { issues: [] } });
    expect(events[7]!.report).toMatchObject({ passed: true, round: 1 });

    // 通知：通过轮次与摘要
    expect(channel.notifies.some((n) => n.includes("✅ 校验通过（第 1 轮）"))).toBeTrue();
  });

  test("首轮不达标：第 2 轮修订 prompt 含上一版正文与整改报告，修订稿通过后入库", async () => {
    const ctx = await setupDb();
    cleanupAll.push(ctx.cleanup);
    generateTextCalls = [];
    generateTextResult = "";
    generateTextQueue = [PROSE, "　　修订后的正文，矛盾已统一为五个字。"];
    // 首轮内容校验报 1 处问题，修订轮转绿；文风未启用（跳过段）
    reviewScript = {
      content: [
        { issues: [{ kind: "consistency", description: "五个字写成四个字", suggestion: "统一为五个字" }] },
        { issues: [] },
      ],
    };

    const events: WriteProgressEvent[] = [];
    const channel = new FakeChannel([]);
    await writeChapter({
      channel,
      novelId: NOVEL_ID,
      model: DUMMY_MODEL,
      onProgress: (event) => events.push(event),
      ...ctx,
    });

    // 两轮生成；修订轮 prompt 携带上一版正文与整改报告（问题与建议逐条）
    expect(generateTextCalls).toHaveLength(2);
    expect(generateTextCalls[0]!.prompt).not.toContain("【上一版正文");
    const revisionPrompt = generateTextCalls[1]!.prompt;
    expect(revisionPrompt).toContain("【上一版正文（在其基础上修订）】");
    expect(revisionPrompt).toContain(PROSE.trim());
    expect(revisionPrompt).toContain("【整改报告（请逐条修订）】");
    expect(revisionPrompt).toContain("五个字写成四个字");
    expect(revisionPrompt).toContain("→ 建议：统一为五个字");
    expect(revisionPrompt).toContain("6. 按整改报告逐条修订上一版正文");

    // 修订轮进度事件携带首轮报告；saving 事件报告转绿且轮次 2
    const revising = events.find((event) => event.phase === "revising")!;
    expect(revising.round).toBe(2);
    expect(revising.report).toMatchObject({ passed: false, round: 1 });
    const saving = events.find((event) => event.phase === "saving")!;
    expect(saving.report).toMatchObject({ passed: true, round: 2 });

    // 入库的是修订稿；通知含修订轮次与通过轮次
    const artifact = join(ctx.outputDir, "灵脉拾遗-eeeeeeee", "第一部", "第一章.md");
    expect(readFileSync(artifact, "utf8")).toContain("矛盾已统一为五个字");
    expect(channel.notifies.some((n) => n.includes("♻️ 第 2 轮：上一版未达标准"))).toBeTrue();
    expect(channel.notifies.some((n) => n.includes("✅ 校验通过（第 2 轮）"))).toBeTrue();
  });

  test("3 轮仍未达标：保底保存最后一版并警告（含文风分与问题计数）", async () => {
    const ctx = await setupDb();
    cleanupAll.push(ctx.cleanup);
    generateTextCalls = [];
    generateTextResult = PROSE;
    ctx.styleReferenceStore.addStyleReference(NOVEL_ID, { name: "样本", content: "文风文本。" });
    // 三轮全部不达标（单值脚本恒定复用）
    reviewScript = {
      content: { issues: [{ kind: "summary", description: "偏离概述", suggestion: "回调情节" }] },
      style: { score: 82, rationale: "句式偏短促", suggestions: ["增加环境描写"] },
      consistency: { issues: [] },
    };

    const events: WriteProgressEvent[] = [];
    const channel = new FakeChannel([]);
    const result = await writeChapter({
      channel,
      novelId: NOVEL_ID,
      model: DUMMY_MODEL,
      onProgress: (event) => events.push(event),
      ...ctx,
    });

    // 3 生成 + 9 校验（每轮 3 段），轮次事件 3 轮齐全
    expect(generateTextCalls).toHaveLength(3);
    expect(generateObjectCalls).toHaveLength(9);
    expect(events.filter((event) => event.phase === "revising")).toHaveLength(2);

    // 照常落盘入库（最后一版）
    const artifact = join(ctx.outputDir, "灵脉拾遗-eeeeeeee", "第一部", "第一章.md");
    expect(existsSync(artifact)).toBe(true);
    expect(ctx.documentStore.getDocumentByChapter(ctx.chapterNodeId)!.id).toBe(result.documentId);

    // 警告通知含摘要（文风分 + 问题计数）；saving 事件报告 passed=false round=3
    expect(
      channel.notifies.some((n) =>
        n.includes("⚠️ 3 轮未全部达标，保存最后一版（内容 1 处、文风 82 分、自洽 0 处）"),
      ),
    ).toBeTrue();
    expect(events.find((event) => event.phase === "saving")!.report).toMatchObject({
      passed: false,
      round: 3,
    });
  });

  test("无启用文风：文风段 skipped 零调用，进度事件显示跳过", async () => {
    const ctx = await setupDb();
    cleanupAll.push(ctx.cleanup);
    generateTextCalls = [];
    generateTextResult = PROSE;

    const events: WriteProgressEvent[] = [];
    await writeChapter({
      channel: new FakeChannel([]),
      novelId: NOVEL_ID,
      model: DUMMY_MODEL,
      onProgress: (event) => events.push(event),
      ...ctx,
    });

    // 只调内容约束与自洽两段
    expect(generateObjectCalls).toHaveLength(2);
    expect(events.map((event) => event.phase)).toEqual([
      "drafting",
      "review-content",
      "review-content",
      "review-style",
      "review-consistency",
      "review-consistency",
      "saving",
    ]);
    expect(events.find((event) => event.phase === "review-style")!.stageResult).toEqual({
      phase: "review-style", result: { skipped: true },
    });
    expect(events.find((event) => event.phase === "saving")!.report).toMatchObject({
      passed: true,
      style: { skipped: true },
    });
  });

  test("校验调用抛错：会话终止零残留（无文件、库无记录）", async () => {
    const ctx = await setupDb();
    cleanupAll.push(ctx.cleanup);
    generateTextCalls = [];
    generateTextResult = PROSE;
    reviewScript = { error: new Error("校验模型超时") };

    await expect(
      writeChapter({
        channel: new FakeChannel([]),
        novelId: NOVEL_ID,
        model: DUMMY_MODEL,
        ...ctx,
      }),
    ).rejects.toThrow("校验模型超时");
    expect(existsSync(join(ctx.outputDir, "灵脉拾遗-eeeeeeee", "第一部", "第一章.md"))).toBe(false);
    expect(ctx.documentStore.listDocuments(NOVEL_ID)).toHaveLength(0);
    expect(ctx.outlineStore.getOutlineNode(ctx.chapterNodeId)!.node.documentId).toBeNull();
  });

  test("重新生成成功：覆盖替换库行、清理旧正文文件，流程与新生成一致", async () => {
    const ctx = await setupDb();
    cleanupAll.push(ctx.cleanup);
    // 预置旧正文（行 + 文件）
    const oldRel = join("灵脉拾遗-eeeeeeee", "第一部", "第一章.md");
    writeDocumentArtifact(oldRel, "旧版正文内容。", ctx.outputDir);
    const old = ctx.documentStore.saveChapterDocument(NOVEL_ID, ctx.chapterNodeId, oldRel, 7);
    generateTextCalls = [];
    generateTextResult = PROSE;

    const channel = new FakeChannel([]);
    const result = await writeChapter({
      channel,
      novelId: NOVEL_ID,
      model: DUMMY_MODEL,
      ...ctx,
    });

    // 库行覆盖替换：行数仍 1，主键换新、路径与字数为新值，章节点绑定新行
    expect(result.documentId).not.toBe(old.id);
    expect(ctx.documentStore.listDocuments(NOVEL_ID)).toHaveLength(1);
    expect(result.wordCount).toBe(38);
    const chapter = ctx.outlineStore.getOutlineNode(ctx.chapterNodeId)!;
    expect(chapter.node.documentId).toBe(result.documentId);
    expect(chapter.node.status).toBe("completed");

    // 旧文件清理、新文件落盘（旧名被旧文件占用 → 新文件 -2 后缀）
    expect(existsSync(join(ctx.outputDir, oldRel))).toBe(false);
    const newRel = join("灵脉拾遗-eeeeeeee", "第一部", "第一章-2.md");
    expect(readFileSync(join(ctx.outputDir, newRel), "utf8")).toBe(PROSE.trim());

    // 生成与校验流程与新生成一致（1 生成 + 2 校验，无文风），notify 区分重生成
    expect(generateTextCalls).toHaveLength(1);
    expect(generateObjectCalls).toHaveLength(2);
    expect(channel.notifies.some((n) => n.includes("🔄 重新生成中（将覆盖现有正文）"))).toBeTrue();
    expect(channel.notifies.some((n) => n.includes("✅ 校验通过（第 1 轮）"))).toBeTrue();
    expect(channel.notifies.some((n) => n.includes("正文已保存"))).toBeTrue();
  });

  test("重新生成库故障：回滚删新文件，旧正文行与文件零影响", async () => {
    const ctx = await setupDb();
    cleanupAll.push(ctx.cleanup);
    const oldRel = join("灵脉拾遗-eeeeeeee", "第一部", "第一章.md");
    writeDocumentArtifact(oldRel, "旧版正文内容。", ctx.outputDir);
    const old = ctx.documentStore.saveChapterDocument(NOVEL_ID, ctx.chapterNodeId, oldRel, 7);
    generateTextCalls = [];
    generateTextResult = PROSE;

    // store 替身：查重返回旧行、替换时抛错（模拟库故障）
    const failingStore = {
      getDocumentByChapter: () => old,
      replaceChapterDocument: () => {
        throw new Error("模拟库写入失败");
      },
    } as unknown as DocumentStore;

    await expect(
      writeChapter({
        channel: new FakeChannel([]),
        novelId: NOVEL_ID,
        model: DUMMY_MODEL,
        ...ctx,
        documentStore: failingStore,
      }),
    ).rejects.toThrow("模拟库写入失败");

    // 旧正文行与文件原样保留；新文件（-2）无残留
    expect(ctx.documentStore.getDocumentByChapter(ctx.chapterNodeId)!.id).toBe(old.id);
    expect(readFileSync(join(ctx.outputDir, oldRel), "utf8")).toBe("旧版正文内容。");
    expect(existsSync(join(ctx.outputDir, "灵脉拾遗-eeeeeeee", "第一部", "第一章-2.md"))).toBe(false);
  });

  test("重新生成校验抛错：终止会话，旧正文行与文件零影响", async () => {
    const ctx = await setupDb();
    cleanupAll.push(ctx.cleanup);
    const oldRel = join("灵脉拾遗-eeeeeeee", "第一部", "第一章.md");
    writeDocumentArtifact(oldRel, "旧版正文内容。", ctx.outputDir);
    const old = ctx.documentStore.saveChapterDocument(NOVEL_ID, ctx.chapterNodeId, oldRel, 7);
    generateTextCalls = [];
    generateTextResult = PROSE;
    reviewScript = { error: new Error("校验模型超时") };

    await expect(
      writeChapter({
        channel: new FakeChannel([]),
        novelId: NOVEL_ID,
        model: DUMMY_MODEL,
        ...ctx,
      }),
    ).rejects.toThrow("校验模型超时");

    // 旧正文原样保留（保存段未到达，新文件未写）
    expect(ctx.documentStore.getDocumentByChapter(ctx.chapterNodeId)!.id).toBe(old.id);
    expect(readFileSync(join(ctx.outputDir, oldRel), "utf8")).toBe("旧版正文内容。");
    expect(existsSync(join(ctx.outputDir, "灵脉拾遗-eeeeeeee", "第一部", "第一章-2.md"))).toBe(false);
  });
});

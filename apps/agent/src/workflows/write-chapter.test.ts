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
import { FakeChannel } from "../ui/fake-channel";
import type { Character, Worldview } from "@novel/shared";

/**
 * writeChapter 集成测试：mock 掉 'ai' 模块（generateText 按脚本返回正文），
 * 交互经 FakeChannel 记录；持久化落在临时目录 SQLite 与临时 output 目录上——
 * 正文按「小说名/部名/章名.md」层级落文件、库内只登记元数据；
 * 前置校验路径（小说 / 章节点 / 已有正文 / 世界观 / 写作模型未配置）不依赖 LLM。
 */

type GenerateTextArgs = { model: unknown; prompt: string };
let generateTextCalls: GenerateTextArgs[] = [];
let generateTextResult = "";

mock.module("ai", () => ({
  tool: (spec: unknown) => spec,
  generateObject: async () => {
    throw new Error("正文生成工作流不应调用 generateObject");
  },
  generateText: async (args: GenerateTextArgs) => {
    generateTextCalls.push(args);
    return { text: generateTextResult };
  },
}));

const { writeChapter } = await import("./write-chapter");

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

/** 写作模型环境变量备份（未配置路径用例需要清空） */
const WRITING_ENV_KEYS = ["WRITING_MODEL_NAME", "WRITING_MODEL_API_KEY", "WRITING_MODEL_BASE_URL"] as const;
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const key of WRITING_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
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
  ]);
  return {
    novelStore,
    outlineStore,
    worldviewStore,
    characterStore,
    documentStore,
    outputDir,
    actNodeId: act!.id,
    chapterNodeId: chapters[0]!.id,
    secondChapterNodeId: chapters[1]!.id,
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

    // 已有正文
    ctx.documentStore.saveChapterDocument(NOVEL_ID, ctx.chapterNodeId, "n/p/1.md", 8);
    await expect(
      writeChapter({ ...base, novelId: NOVEL_ID, chapterNodeId: ctx.chapterNodeId }),
    ).rejects.toThrow("已有正文");

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

  test("写作模型未配置（不注入 model 且无环境变量）抛可读错误", async () => {
    const ctx = await setupDb();
    cleanupAll.push(ctx.cleanup);
    await expect(
      writeChapter({
        channel: new FakeChannel([]),
        novelId: NOVEL_ID,
        ...ctx,
      }),
    ).rejects.toThrow("写作模型未配置");
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
});

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../state/db";
import { NovelStore } from "../state/novel-store";
import { CharacterStore, type StoredCharacter } from "../state/character-store";
import { OutlineStore } from "../state/outline-store";
import { FakeChannel } from "../ui/fake-channel";

const { bindChapterCasts } = await import("./chapter-cast-intake");

const NOVEL = "n-cast-1";
let tempDir: string;
afterAll(async () => { if (tempDir) await rm(tempDir, { recursive: true, force: true }); });

function makeCharacter(name: string) {
  return {
    basicInfo: { name },
    core: { desire: `${name}的渴望`, fear: "身份暴露", narrativeRole: "配角" },
    background: "北境边军旧部",
    creationPurpose: "登场角色绑定测试用角色",
    endingDirection: "结局未定",
  };
}

function cast(name: string, role = `${name}定位`) {
  return { name, role };
}

/** 建库 + 1 部 1 幕 + 指定章名的章节点（返回 store 与章节点列表） */
function setupWithChapters(dbPath: string, chapterNames: string[]) {
  const db = openDatabase(dbPath);
  new NovelStore(db).createNovel({ id: NOVEL });
  const outlineStore = new OutlineStore(db);
  const tree = outlineStore.saveOutlineTree(NOVEL, [
    { name: "第一部", summary: "部梗概", acts: [{ name: "第一幕", summary: "幕梗概", keyPlotPoints: ["情节点1"] }] },
  ]);
  const actNode = tree.find((n) => n.node.type === "act")!;
  const chapterNodes = outlineStore.saveChapters(
    NOVEL,
    actNode.id,
    chapterNames.map((name) => ({ name, summary: `${name}的概述` })),
  );
  return { db, outlineStore, chapterNodes };
}

describe("bindChapterCasts", () => {
  test("按序对齐解析名字→ID 单事务回填；跨章同名各自绑定；返回统计", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-intake-cast-"));
    tempDir = dir;
    const { db, outlineStore, chapterNodes } = setupWithChapters(join(dir, "t.db"), [
      "第一章·雨夜",
      "第二章·来客",
    ]);
    const characterStore = new CharacterStore(db);
    const chen = characterStore.addCharacter(NOVEL, makeCharacter("陈默"));
    const zhou = characterStore.addCharacter(NOVEL, makeCharacter("老周"));
    const characters: StoredCharacter[] = [chen, zhou];
    const channel = new FakeChannel([]);

    const result = bindChapterCasts({
      novelId: NOVEL,
      chapters: [
        { name: "第一章·雨夜", summary: "概述", characters: [cast("陈默", "本章主视角"), cast("老周")] },
        { name: "第二章·来客", summary: "概述", characters: [cast("陈默")] },
      ],
      chapterNodes,
      characters,
      channel,
      outlineStore,
    });
    expect(result).toEqual({ boundChapters: 2, totalBindings: 3, skipped: [] });
    expect(channel.notifies).toHaveLength(0);
    expect(outlineStore.getOutlineNode(chapterNodes[0]!.id)?.node.characterIds).toEqual([chen.id, zhou.id]);
    expect(outlineStore.getOutlineNode(chapterNodes[1]!.id)?.node.characterIds).toEqual([chen.id]);
    db.close();
  });

  test("未匹配名逐条剔除并警告；整章全未匹配保持 null 不绑；章内同名去重", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-intake-cast-skip-"));
    tempDir = tempDir || dir;
    const { db, outlineStore, chapterNodes } = setupWithChapters(join(dir, "t.db"), [
      "第一章·雨夜",
      "第二章·来客",
    ]);
    const characterStore = new CharacterStore(db);
    const chen = characterStore.addCharacter(NOVEL, makeCharacter("陈默"));
    const channel = new FakeChannel([]);

    const result = bindChapterCasts({
      novelId: NOVEL,
      chapters: [
        { name: "第一章·雨夜", summary: "概述", characters: [cast("陈默"), cast("陈默", "重复"), cast("路人们")] },
        { name: "第二章·来客", summary: "概述", characters: [cast("无名氏A"), cast("无名氏B")] },
      ],
      chapterNodes,
      characters: characterStore.listCharacters(NOVEL),
      channel,
      outlineStore,
    });
    expect(result.boundChapters).toBe(1);
    expect(result.totalBindings).toBe(1);
    expect(result.skipped).toEqual(["路人们", "无名氏A", "无名氏B"]);
    expect(outlineStore.getOutlineNode(chapterNodes[0]!.id)?.node.characterIds).toEqual([chen.id]);
    // 整章全未匹配：不传条目，保持未绑定（null），schema 空数组被拒的语义由此保证
    expect(outlineStore.getOutlineNode(chapterNodes[1]!.id)?.node.characterIds).toBeNull();
    expect(channel.notifies.some((n) => n.includes("「路人们」未在角色库中匹配"))).toBe(true);
    expect(channel.notifies.some((n) => n.includes("「无名氏A」未在角色库中匹配"))).toBe(true);
    db.close();
  });

  test("章节点数少于规划章数：警告并按最小长度对齐绑定", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-intake-cast-align-"));
    tempDir = tempDir || dir;
    const { db, outlineStore, chapterNodes } = setupWithChapters(join(dir, "t.db"), ["第一章·雨夜"]);
    const characterStore = new CharacterStore(db);
    const chen = characterStore.addCharacter(NOVEL, makeCharacter("陈默"));
    const channel = new FakeChannel([]);

    const result = bindChapterCasts({
      novelId: NOVEL,
      chapters: [
        { name: "第一章·雨夜", summary: "概述", characters: [cast("陈默")] },
        { name: "第二章·来客", summary: "概述", characters: [cast("陈默")] },
      ],
      // 只传 1 个章节点（防御性对齐场景）
      chapterNodes: [chapterNodes[0]!],
      characters: characterStore.listCharacters(NOVEL),
      channel,
      outlineStore,
    });
    expect(result.boundChapters).toBe(1);
    expect(channel.notifies.some((n) => n.includes("章节点数（1）少于规划章数（2）"))).toBe(true);
    expect(outlineStore.getOutlineNode(chapterNodes[0]!.id)?.node.characterIds).toEqual([chen.id]);
    db.close();
  });
});

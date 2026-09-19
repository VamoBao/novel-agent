import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorldviewStore } from "./worldview-store";
import { CharacterStore } from "./character-store";
import { NovelStore } from "./novel-store";
import { worldviewSchema, type Worldview } from "@novel/shared";

let tempDir: string;

afterAll(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

const V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function makeWorldview(geography: string): Worldview {
  return worldviewSchema.parse({
    background: {
      geography,
      fantasyAttributes: "灵气源于山川地脉，分炼气筑基金丹元婴四境",
      realWorldMapping: "门阀式大宗割据，类似中世纪封建领主模式",
    },
    taboos: ["不出现现代科技", "不出现穿越系统金手指", "不存在元婴以上境界或神祇"],
  });
}

/** FK 依赖：worldviews.novel_id 关联 novels.id，须先建小说行 */
function setup(dbPath: string, novelId: string): WorldviewStore {
  NovelStore.open(dbPath).createNovel({ id: novelId });
  return WorldviewStore.open(dbPath);
}

describe("WorldviewStore", () => {
  test("saveWorldview 后 getWorldview 取回且通过 schema 校验（含 taboos JSON 往返）", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "novel-wv-db-"));
    const dbPath = join(tempDir, "test.db");
    const novelId = "dddddddd-0000-7000-8000-000000000001";
    const store = setup(dbPath, novelId);

    const saved = store.saveWorldview(novelId, makeWorldview("九州大陆"));
    expect(saved.id).toMatch(V7_RE);
    const stored = store.getWorldview(novelId);
    expect(stored?.worldview.background.geography).toBe("九州大陆");
    expect(stored?.worldview.background.fantasyAttributes).toContain("四境");
    expect(stored?.worldview.taboos).toHaveLength(3);
    expect(stored?.novelId).toBe(novelId);
    store.close();
  });

  test("novel_id 外键约束：不存在的小说 ID 保存被拒绝", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-wv-db-fk-"));
    const dbPath = join(dir, "test.db");
    const store = setup(dbPath, "dddddddd-0000-7000-8000-000000000009");
    expect(() =>
      store.saveWorldview("dddddddd-0000-7000-8000-ffffffffffff", makeWorldview("无主世界")),
    ).toThrow();
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("可选字段缺省时往返仍为 undefined", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-wv-db2-"));
    const dbPath = join(dir, "test.db");
    const novelId = "dddddddd-0000-7000-8000-000000000002";
    const store = setup(dbPath, novelId);
    store.saveWorldview(novelId, {
      background: { geography: "当代上海" },
      taboos: ["不能出现超自然力量"],
    });
    const stored = store.getWorldview(novelId);
    expect(stored?.worldview.background.fantasyAttributes).toBeUndefined();
    expect(stored?.worldview.background.realWorldMapping).toBeUndefined();
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("重复保存为覆盖更新：单行、id 稳定、created_at 保留", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-wv-db3-"));
    const dbPath = join(dir, "test.db");
    const novelId = "dddddddd-0000-7000-8000-000000000003";
    const store = setup(dbPath, novelId);
    store.saveWorldview(novelId, makeWorldview("九州大陆"));
    const first = store.getWorldview(novelId);
    await new Promise((r) => setTimeout(r, 20));
    store.saveWorldview(novelId, makeWorldview("维斯特洛大陆"));
    const second = store.getWorldview(novelId);

    expect(second?.worldview.background.geography).toBe("维斯特洛大陆");
    expect(second?.id).toBe(first?.id);
    expect(second?.createdAt).toBe(first?.createdAt);
    expect(second && first && second.updatedAt > first.updatedAt).toBe(true);
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("未保存的 ID 返回 undefined；与 characters 同库不同表互不影响", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-wv-db4-"));
    const dbPath = join(dir, "shared.db");
    const novelId = "dddddddd-0000-7000-8000-000000000005";
    const wv = setup(dbPath, novelId);
    expect(wv.getWorldview("dddddddd-0000-7000-8000-0000000000ff")).toBeUndefined();
    wv.saveWorldview(novelId, makeWorldview("九州大陆"));
    wv.close();

    const chars = CharacterStore.open(dbPath);
    expect(chars.listCharacters(novelId)).toHaveLength(0); // 分表隔离
    chars.close();

    const wv2 = WorldviewStore.open(dbPath);
    expect(wv2.getWorldview(novelId)?.worldview.background.geography).toBe("九州大陆");
    wv2.close();
    await rm(dir, { recursive: true, force: true });
  });
});

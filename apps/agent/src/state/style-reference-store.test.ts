import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NovelStore } from "./novel-store";
import { StyleReferenceStore } from "./style-reference-store";

let tempDir: string;

afterAll(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

const V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const NOVEL_A = "11111111-2222-7333-8444-555566667777";

/** FK 依赖：style_references.novel_id 关联 novels.id，须先建小说行 */
function setup(dbPath: string): StyleReferenceStore {
  const novelStore = NovelStore.open(dbPath);
  novelStore.createNovel({ id: NOVEL_A });
  novelStore.close();
  return StyleReferenceStore.open(dbPath);
}

describe("StyleReferenceStore", () => {
  test("addStyleReference 入库（enabled 缺省 true / 显式 false）后 listStyleReferences 按入库顺序取回", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "novel-style-db-"));
    const dbPath = join(tempDir, "test.db");
    const store = setup(dbPath);

    const first = store.addStyleReference(NOVEL_A, {
      name: "江南式打斗",
      content: "刀光一闪，血溅三步。",
    });
    expect(first.id).toMatch(V7_RE);
    expect(first.styleReference.enabled).toBe(true);

    const second = store.addStyleReference(NOVEL_A, {
      name: "张爱玲腔",
      content: "生命是一袭华美的袍。",
      enabled: false,
    });
    expect(second.styleReference.enabled).toBe(false);

    const listed = store.listStyleReferences(NOVEL_A);
    expect(listed.map((s) => s.styleReference.name)).toEqual(["江南式打斗", "张爱玲腔"]);
    expect(listed[0]?.styleReference.content).toBe("刀光一闪，血溅三步。");
    expect(listed[1]?.styleReference.enabled).toBe(false);
    store.close();
  });

  test("getStyleReference 单条取用；不存在返回 undefined", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-style-db-get-"));
    tempDir = tempDir || dir;
    const store = setup(join(dir, "test.db"));

    const added = store.addStyleReference(NOVEL_A, { name: "文风", content: "样本" });
    expect(store.getStyleReference(added.id)?.styleReference.name).toBe("文风");
    expect(store.getStyleReference("00000000-0000-7000-8000-000000000000")).toBeUndefined();
    store.close();
  });

  test("updateStyleReference patch 语义：undefined 不动、显式值覆盖、updated_at 刷新", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-style-db-update-"));
    tempDir = tempDir || dir;
    const store = setup(join(dir, "test.db"));

    const added = store.addStyleReference(NOVEL_A, {
      name: "原名",
      content: "原内容",
      enabled: true,
    });
    await Bun.sleep(20); // ISO 毫秒时间戳，同毫秒写入与更新无法区分（对齐既有惯例）

    const updated = store.updateStyleReference(added.id, { enabled: false });
    expect(updated.styleReference.name).toBe("原名");
    expect(updated.styleReference.content).toBe("原内容");
    expect(updated.styleReference.enabled).toBe(false);
    expect(updated.updatedAt > added.updatedAt).toBe(true);

    const renamed = store.updateStyleReference(added.id, {
      name: "新名",
      content: "新内容",
    });
    expect(renamed.styleReference).toEqual({ name: "新名", content: "新内容", enabled: false });
    store.close();
  });

  test("updateStyleReference / deleteStyleReference 对不存在的行抛可读错误", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-style-db-miss-"));
    tempDir = tempDir || dir;
    const store = setup(join(dir, "test.db"));

    expect(() => store.updateStyleReference("00000000-0000-7000-8000-000000000000", { name: "x" })).toThrow(
      "参考文风不存在",
    );
    expect(() => store.deleteStyleReference("00000000-0000-7000-8000-000000000000")).toThrow(
      "参考文风不存在",
    );
    store.close();
  });

  test("deleteStyleReference 删除后清单减少；schema 拒绝透传（空名 / 空内容不入库）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-style-db-del-"));
    tempDir = tempDir || dir;
    const store = setup(join(dir, "test.db"));

    const a = store.addStyleReference(NOVEL_A, { name: "保留", content: "样本A" });
    const b = store.addStyleReference(NOVEL_A, { name: "删除", content: "样本B" });

    expect(() => store.addStyleReference(NOVEL_A, { name: "", content: "x" })).toThrow();
    expect(() => store.addStyleReference(NOVEL_A, { name: "文风", content: "" })).toThrow();
    expect(store.listStyleReferences(NOVEL_A)).toHaveLength(2);

    store.deleteStyleReference(b.id);
    expect(store.listStyleReferences(NOVEL_A).map((s) => s.id)).toEqual([a.id]);
    store.close();
  });

  test("listStyleReferences 对无文风的小说返回空数组", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-style-db-empty-"));
    tempDir = tempDir || dir;
    const store = setup(join(dir, "test.db"));
    expect(store.listStyleReferences(NOVEL_A)).toEqual([]);
    store.close();
  });
});

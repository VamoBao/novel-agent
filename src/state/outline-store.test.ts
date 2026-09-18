import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NovelStore } from "./novel-store";
import { OutlineStore, type OutlineNodeInput } from "./outline-store";
import type { OutlineNodeStatus, OutlineNodeType } from "../schemas";

let tempDir: string;

afterAll(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

const V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** FK 依赖：outlines.novel_id 关联 novels.id，须先建小说行 */
function setup(dbPath: string, novelId: string): OutlineStore {
  NovelStore.open(dbPath).createNovel({ id: novelId });
  return OutlineStore.open(dbPath);
}

function act(name: string, sort: number, extra: Partial<OutlineNodeInput> = {}): OutlineNodeInput {
  return { type: "act", name, sort, ...extra };
}

describe("OutlineStore", () => {
  test("addOutlineNode 默认 version=1/当前版本/planned，UUIDv7 主键，get 往返一致", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "novel-outline-db-"));
    const dbPath = join(tempDir, "test.db");
    const novelId = "11111111-2222-7333-8444-555566668888";
    const store = setup(dbPath, novelId);

    const added = store.addOutlineNode(novelId, act("第一幕·开端", 1));
    expect(added.id).toMatch(V7_RE);
    expect(added.novelId).toBe(novelId);
    expect(added.node.parentId).toBeNull();
    expect(added.node.version).toBe(1);
    expect(added.node.isCurrentVersion).toBe(true);
    expect(added.node.status).toBe("planned");
    expect(added.node.documentId).toBeNull();

    const got = store.getOutlineNode(added.id);
    expect(got?.node.name).toBe("第一幕·开端");
    expect(got?.node.type).toBe("act");
    store.close();
  });

  test("外键约束：不存在的小说与不存在的父节点均被拒绝，合法父节点入库取回 parentId", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-outline-db-fk-"));
    const dbPath = join(dir, "test.db");
    const novelId = "11111111-2222-7333-8444-555566669999";
    const store = setup(dbPath, novelId);

    expect(() =>
      store.addOutlineNode("11111111-2222-7333-8444-ffffffffffff", act("孤儿幕", 1)),
    ).toThrow();
    expect(() =>
      store.addOutlineNode(novelId, act("孤儿章", 1, { parentId: "eeeeeeee-0000-7000-8000-0000000000ff" })),
    ).toThrow();

    const parent = store.addOutlineNode(novelId, act("第一幕", 1));
    const child = store.addOutlineNode(novelId, {
      parentId: parent.id,
      type: "chapter",
      name: "第一章",
      sort: 1,
    });
    expect(child.node.parentId).toBe(parent.id);
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("当前版本同父级 sort 重复被唯一索引拒绝，不同父级同 sort 允许", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-outline-db-sort-"));
    const dbPath = join(dir, "test.db");
    const novelId = "22222222-0000-7000-8000-000000000001";
    const store = setup(dbPath, novelId);

    const act1 = store.addOutlineNode(novelId, act("第一幕", 1));
    const act2 = store.addOutlineNode(novelId, act("第二幕", 2));
    expect(() => store.addOutlineNode(novelId, act("冒名第一幕", 1))).toThrow("sort");

    // 不同父级（两幕各自之下）的章 sort=1 互不冲突
    store.addOutlineNode(novelId, { parentId: act1.id, type: "chapter", name: "幕一章一", sort: 1 });
    store.addOutlineNode(novelId, { parentId: act2.id, type: "chapter", name: "幕二章一", sort: 1 });
    expect(store.listOutlineNodes(novelId)).toHaveLength(4);
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("根节点同小说 sort 重复拒绝，跨小说各自 sort=1 共存", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-outline-db-root-"));
    const dbPath = join(dir, "test.db");
    const idA = "33333333-0000-7000-8000-000000000001";
    const idB = "33333333-0000-7000-8000-000000000002";
    const store = setup(dbPath, idA);
    NovelStore.open(dbPath).createNovel({ id: idB });

    store.addOutlineNode(idA, act("甲书第一幕", 1));
    store.addOutlineNode(idB, act("乙书第一幕", 1));
    expect(() => store.addOutlineNode(idA, act("甲书另一幕", 1))).toThrow("sort");
    expect(store.listOutlineNodes(idA)).toHaveLength(1);
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("同节点多版本共存与当前版本切换（唯一索引仅约束当前版本）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-outline-db-ver-"));
    const dbPath = join(dir, "test.db");
    const novelId = "44444444-0000-7000-8000-000000000001";
    const store = setup(dbPath, novelId);

    const v1 = store.addOutlineNode(novelId, act("第一幕", 1));
    const v2 = store.addOutlineNode(
      novelId,
      act("第一幕（修订）", 1, { version: 2, isCurrentVersion: false }),
    );
    expect(store.listOutlineNodes(novelId)).toHaveLength(2);

    // v1 仍是当前版本，直接提升 v2 触发唯一索引
    expect(() => store.updateOutlineNode(v2.id, { isCurrentVersion: true })).toThrow("sort");

    store.updateOutlineNode(v1.id, { isCurrentVersion: false, status: "deprecated" });
    store.updateOutlineNode(v2.id, { isCurrentVersion: true });

    const current = store.listOutlineNodes(novelId, { currentOnly: true });
    expect(current).toHaveLength(1);
    expect(current[0]?.node.version).toBe(2);
    expect(current[0]?.node.name).toBe("第一幕（修订）");
    expect(store.getOutlineNode(v1.id)?.node.status).toBe("deprecated");
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("listOutlineNodes 按（父级分组, sort）排序", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-outline-db-order-"));
    const dbPath = join(dir, "test.db");
    const novelId = "55555555-0000-7000-8000-000000000001";
    const store = setup(dbPath, novelId);

    const act1 = store.addOutlineNode(novelId, act("第一幕", 1));
    store.addOutlineNode(novelId, act("第二幕", 2));
    store.addOutlineNode(novelId, { parentId: act1.id, type: "chapter", name: "第二章", sort: 2 });
    store.addOutlineNode(novelId, { parentId: act1.id, type: "chapter", name: "第一章", sort: 1 });

    const names = store.listOutlineNodes(novelId).map((s) => s.node.name);
    expect(names).toEqual(["第一幕", "第二幕", "第一章", "第二章"]);
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("updateOutlineNode 部分更新盖章 updated_at，不存在的 id 报错", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-outline-db-upd-"));
    const dbPath = join(dir, "test.db");
    const novelId = "66666666-0000-7000-8000-000000000001";
    const store = setup(dbPath, novelId);

    const created = store.addOutlineNode(novelId, act("第一幕", 1));
    await new Promise((r) => setTimeout(r, 20));
    const updated = store.updateOutlineNode(created.id, {
      name: "第一幕·改",
      status: "writing",
      documentId: "doc-0001",
    });
    expect(updated.node.name).toBe("第一幕·改");
    expect(updated.node.status).toBe("writing");
    expect(updated.node.documentId).toBe("doc-0001");
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt > created.updatedAt).toBe(true);

    // documentId 传 null 清空
    expect(store.updateOutlineNode(created.id, { documentId: null }).node.documentId).toBeNull();
    expect(() =>
      store.updateOutlineNode("eeeeeeee-0000-7000-8000-ffffffffffff", {}),
    ).toThrow("不存在");
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("非法 type / status / sort / 空名称被 zod 拒绝（写入侧校验）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-outline-db-invalid-"));
    const dbPath = join(dir, "test.db");
    const novelId = "77777777-0000-7000-8000-000000000001";
    const store = setup(dbPath, novelId);

    expect(() =>
      store.addOutlineNode(novelId, { ...act("段落", 1), type: "paragraph" as OutlineNodeType }),
    ).toThrow();
    expect(() => store.addOutlineNode(novelId, act("坏状态", 1, { status: "paused" as OutlineNodeStatus }))).toThrow();
    expect(() => store.addOutlineNode(novelId, act("零排序", 0))).toThrow();
    expect(() => store.addOutlineNode(novelId, act("", 1))).toThrow();
    expect(() =>
      store.updateOutlineNode(store.addOutlineNode(novelId, act("第一幕", 1)).id, {
        status: "paused" as OutlineNodeStatus,
      }),
    ).toThrow();
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("重开数据库后数据仍在（真实持久化）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-outline-db-persist-"));
    const dbPath = join(dir, "persist.db");
    const novelId = "88888888-0000-7000-8000-000000000001";
    const s1 = setup(dbPath, novelId);
    const added = s1.addOutlineNode(novelId, act("第一幕", 1));
    s1.close();

    const s2 = OutlineStore.open(dbPath);
    const got = s2.getOutlineNode(added.id);
    expect(got?.node.name).toBe("第一幕");
    expect(got?.node.isCurrentVersion).toBe(true);
    s2.close();
    await rm(dir, { recursive: true, force: true });
  });
});

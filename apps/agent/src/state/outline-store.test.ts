import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./db";
import { NovelStore } from "./novel-store";
import { OutlineStore, type OutlineNodeInput } from "./outline-store";
import type { OutlineNodeStatus, OutlineNodeType } from "@novel/shared";

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

/** 带完整内容的部输入（与 outlineSchema.parts 结构一致） */
function treePart(name: string, actNames: string[]) {
  return {
    name,
    summary: `${name}的梗概`,
    acts: actNames.map((actName) => ({
      name: actName,
      summary: `${actName}梗概`,
      keyPlotPoints: [`${actName}情节点1`, `${actName}情节点2`],
    })),
  };
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
    expect(added.node.summary).toBeNull();
    expect(added.node.keyPlotPoints).toBeNull();

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

  test("saveOutlineTree 两级映射：部为根节点、幕为子节点，sort 按各自父级从 1 递增", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-outline-db-tree-"));
    const dbPath = join(dir, "test.db");
    const novelId = "aaaaaaaa-bbbb-7ccc-8ddd-000000000001";
    const store = setup(dbPath, novelId);

    const nodes = store.saveOutlineTree(novelId, [
      treePart("第一部·风起", ["第一幕", "第二幕"]),
      treePart("第二部·云涌", ["第三幕", "第四幕", "第五幕"]),
    ]);
    expect(nodes).toHaveLength(7);
    // 全部为 version=1 / 当前版本 / planned
    expect(
      nodes.every(
        (n) => n.node.version === 1 && n.node.isCurrentVersion && n.node.status === "planned",
      ),
    ).toBe(true);

    const roots = nodes.filter((n) => n.node.parentId === null);
    expect(roots.map((n) => [n.node.type, n.node.name, n.node.sort])).toEqual([
      ["part", "第一部·风起", 1],
      ["part", "第二部·云涌", 2],
    ]);

    const part1 = roots[0]?.id;
    const part2 = roots[1]?.id;
    const acts = nodes.filter((n) => n.node.type === "act");
    expect(acts.filter((a) => a.node.parentId === part1).map((a) => [a.node.name, a.node.sort]))
      .toEqual([["第一幕", 1], ["第二幕", 2]]);
    expect(acts.filter((a) => a.node.parentId === part2).map((a) => [a.node.name, a.node.sort]))
      .toEqual([["第三幕", 1], ["第四幕", 2], ["第五幕", 3]]);
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("saveOutlineTree 内容入库与往返：部有梗概无情节点，幕梗概与情节点齐全且持久化", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-outline-db-tree-content-"));
    const dbPath = join(dir, "test.db");
    const novelId = "aaaaaaaa-bbbb-7ccc-8ddd-000000000005";
    const store = setup(dbPath, novelId);

    store.saveOutlineTree(novelId, [treePart("第一部·风起", ["第一幕", "第二幕"])]);

    const listed = store.listOutlineNodes(novelId);
    const part = listed.find((n) => n.node.type === "part");
    expect(part?.node.summary).toBe("第一部·风起的梗概");
    expect(part?.node.keyPlotPoints).toBeNull();
    const act1 = listed.find((n) => n.node.name === "第一幕");
    expect(act1?.node.summary).toBe("第一幕梗概");
    expect(act1?.node.keyPlotPoints).toEqual(["第一幕情节点1", "第一幕情节点2"]);
    store.close();

    // 重开库后内容仍在（真实持久化）
    const s2 = OutlineStore.open(dbPath);
    const reread = s2.listOutlineNodes(novelId);
    expect(reread.find((n) => n.node.type === "part")?.node.summary).toBe("第一部·风起的梗概");
    expect(reread.find((n) => n.node.name === "第二幕")?.node.keyPlotPoints).toEqual([
      "第二幕情节点1",
      "第二幕情节点2",
    ]);
    s2.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("saveOutlineTree 空树与空幕部被拒绝", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-outline-db-tree-empty-"));
    const dbPath = join(dir, "test.db");
    const novelId = "aaaaaaaa-bbbb-7ccc-8ddd-000000000002";
    const store = setup(dbPath, novelId);

    expect(() => store.saveOutlineTree(novelId, [])).toThrow("空");
    expect(() =>
      store.saveOutlineTree(novelId, [{ name: "孤部", summary: "孤部梗概", acts: [] }]),
    ).toThrow("至少一幕");
    expect(store.listOutlineNodes(novelId)).toHaveLength(0);
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("saveOutlineTree 中途失败整树回滚（事务原子性）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-outline-db-tree-tx-"));
    const dbPath = join(dir, "test.db");
    const novelId = "aaaaaaaa-bbbb-7ccc-8ddd-000000000003";
    const store = setup(dbPath, novelId);

    // 第二部名称为空触发 zod 拒绝；第一部已插入的行必须整体回滚
    expect(() =>
      store.saveOutlineTree(novelId, [
        treePart("第一部", ["第一幕"]),
        { ...treePart("", ["第二幕"]), name: "" },
      ]),
    ).toThrow();
    expect(store.listOutlineNodes(novelId)).toHaveLength(0);
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("saveOutlineTree 重复保存被唯一索引拒绝且原树保持完整", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-outline-db-tree-dup-"));
    const dbPath = join(dir, "test.db");
    const novelId = "aaaaaaaa-bbbb-7ccc-8ddd-000000000004";
    const store = setup(dbPath, novelId);

    store.saveOutlineTree(novelId, [treePart("第一部", ["第一幕"])]);
    expect(() =>
      store.saveOutlineTree(novelId, [treePart("另一部", ["另一幕"])]),
    ).toThrow("sort");
    const remaining = store.listOutlineNodes(novelId);
    expect(remaining).toHaveLength(2);
    expect(remaining.map((n) => n.node.name)).toEqual(["第一部", "第一幕"]);
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("部/章节点携带关键情节点被 schema refine 拒绝（写入侧校验）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-outline-db-kpp-"));
    const dbPath = join(dir, "test.db");
    const novelId = "aaaaaaaa-bbbb-7ccc-8ddd-000000000006";
    const store = setup(dbPath, novelId);

    expect(() =>
      store.addOutlineNode(novelId, {
        type: "part",
        name: "第一部",
        sort: 1,
        keyPlotPoints: ["不该有的情节点"],
      }),
    ).toThrow("关键情节点仅幕节点可携带");
    expect(() =>
      store.addOutlineNode(novelId, {
        type: "chapter",
        name: "第一章",
        sort: 1,
        keyPlotPoints: ["不该有的情节点"],
      }),
    ).toThrow("关键情节点仅幕节点可携带");
    // 幕节点携带合法
    expect(
      store.addOutlineNode(novelId, act("第一幕", 1, { keyPlotPoints: ["情节点"] })).node
        .keyPlotPoints,
    ).toEqual(["情节点"]);
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("updateOutlineNode 更新与清空内容（summary/keyPlotPoints），盖章 updated_at", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-outline-db-content-upd-"));
    const dbPath = join(dir, "test.db");
    const novelId = "aaaaaaaa-bbbb-7ccc-8ddd-000000000007";
    const store = setup(dbPath, novelId);

    const created = store.addOutlineNode(
      novelId,
      act("第一幕", 1, { summary: "原梗概", keyPlotPoints: ["原情节点"] }),
    );
    await new Promise((r) => setTimeout(r, 20));
    const updated = store.updateOutlineNode(created.id, {
      summary: "修订梗概",
      keyPlotPoints: ["新情节点1", "新情节点2"],
    });
    expect(updated.node.summary).toBe("修订梗概");
    expect(updated.node.keyPlotPoints).toEqual(["新情节点1", "新情节点2"]);
    expect(updated.updatedAt > created.updatedAt).toBe(true);

    // keyPlotPoints 传 null 清空；summary 传 null 清空
    const cleared = store.updateOutlineNode(created.id, { keyPlotPoints: null, summary: null });
    expect(cleared.node.keyPlotPoints).toBeNull();
    expect(cleared.node.summary).toBeNull();

    // 未传字段不动其余内容
    const kept = store.updateOutlineNode(created.id, { name: "第一幕·改" });
    expect(kept.node.summary).toBeNull();
    expect(kept.node.name).toBe("第一幕·改");
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("迁移前旧行（内容列 NULL）读取正常，损坏 key_plot_points 抛可读错误", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-outline-db-legacy-row-"));
    const dbPath = join(dir, "test.db");
    const novelId = "aaaaaaaa-bbbb-7ccc-8ddd-000000000008";
    NovelStore.open(dbPath).createNovel({ id: novelId });
    const db = openDatabase(dbPath);
    const store = new OutlineStore(db);

    // SQL 直插 5→6 迁移前的旧行形态：无 summary / key_plot_points（NULL）
    db.prepare(`
      INSERT INTO outlines (id, novel_id, parent_id, type, name, sort, version,
        is_current_version, status, created_at, updated_at)
      VALUES ('legacy-row-1', ?, NULL, 'part', '旧部', 1, 1, 1, 'planned', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    `).run(novelId);
    const legacy = store.getOutlineNode("legacy-row-1");
    expect(legacy?.node.name).toBe("旧部");
    expect(legacy?.node.summary).toBeNull();
    expect(legacy?.node.keyPlotPoints).toBeNull();

    // 损坏的情节点 JSON 文本：读侧抛带节点 ID 的可读错误
    db.prepare(`
      INSERT INTO outlines (id, novel_id, parent_id, type, name, key_plot_points, sort, version,
        is_current_version, status, created_at, updated_at)
      VALUES ('legacy-row-2', ?, NULL, 'act', '坏幕', '{oops', 2, 1, 1, 'planned', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    `).run(novelId);
    expect(() => store.getOutlineNode("legacy-row-2")).toThrow("关键情节点列损坏");
    db.close();
    await rm(dir, { recursive: true, force: true });
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { Window as DomWindow, type HTMLButtonElement as DomButton, type HTMLSelectElement as DomSelect } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { openDatabase } from "../../../agent/src/state/db";
import { NovelStore } from "../../../agent/src/state/novel-store";
import { CharacterStore } from "../../../agent/src/state/character-store";
import { CharacterMigrationStore } from "../../../agent/src/state/migration-store";
import { OutlineStore } from "../../../agent/src/state/outline-store";
import * as query from "../../../agent/src/query";
import { CharacterMigrationPanel } from "./CharacterMigrationPanel";

// IPC 是进程边界；这里接到真实 query/store，React hooks、DOM 事件与 SQLite 写入均不替换。
const novelId = "migration-ui";
let root: Root | undefined;
let dom: DomWindow | undefined;
let db: ReturnType<typeof openDatabase> | undefined;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const originalAct = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");

afterEach(async () => {
  if (root) await act(() => root!.unmount());
  root = undefined;
  await dom?.happyDOM.close();
  dom = undefined;
  db?.close();
  db = undefined;
  for (const [name, descriptor] of [
    ["window", originalWindow], ["document", originalDocument], ["IS_REACT_ACT_ENVIRONMENT", originalAct],
  ] as const) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

async function fixture(status: "draft" | "confirmed" | "cancelled" = "confirmed") {
  db = openDatabase(":memory:");
  const database = db;
  new NovelStore(database).createNovel({ id: novelId });
  const character = new CharacterStore(database).addCharacter(novelId, {
    basicInfo: { name: "陈默" },
    core: { desire: "守护同伴", fear: "背叛", narrativeRole: "主角" },
    background: "散修", personality: "热情", creationPurpose: "主线", endingDirection: "归隐",
  });
  const outlines = new OutlineStore(database);
  outlines.saveOutlineTree(novelId, [{ name: "部", summary: "梗概", acts: [{ name: "幕", summary: "梗概", keyPlotPoints: ["点"] }] }]);
  const actNode = outlines.listOutlineNodes(novelId).find((node) => node.node.type === "act")!;
  const chapters = outlines.saveChapters(novelId, actNode.id, [
    { name: "第一章", summary: "开场" }, { name: "第二章", summary: "转折" },
  ]);
  const store = new CharacterMigrationStore(database);
  let source = store.addMigration(novelId, character.id, {
    migrateField: "personality", newValue: "谨慎", startChapterId: chapters[0]!.id,
    endChapterId: chapters[1]!.id, trigger: "受到背叛", transitionGuidance: "保留热情但收敛",
  });
  if (status !== "draft") source = store.confirmMigration(novelId, source.id);
  if (status === "cancelled") source = store.cancelMigration(novelId, source.id);

  dom = new DomWindow({ url: "http://localhost" });
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom, writable: true });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document, writable: true });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true, writable: true });
  Object.assign(dom, { agent: {
    addMigration: async (id: string, characterId: string, input: unknown) => query.addMigrationEntry(database, id, characterId, JSON.stringify(input)),
    updateMigration: async (id: string, migrationId: string, patch: unknown) => query.updateMigrationEntry(database, id, migrationId, JSON.stringify(patch)),
    confirmMigration: async (id: string, migrationId: string) => query.confirmMigrationEntry(database, id, migrationId),
    cancelMigration: async (id: string, migrationId: string) => query.cancelMigrationEntry(database, id, migrationId),
    saveMigration: async (id: string, characterId: string, request: unknown) => query.saveMigrationEntry(database, id, characterId, JSON.stringify(request)),
  } });
  const container = dom.document.createElement("div");
  dom.document.body.append(container);
  root = createRoot(container as unknown as HTMLElement);
  let refreshes = 0;
  const render = () => {
    const detail = query.buildNovelDetail(database, novelId);
    root!.render(<CharacterMigrationPanel novelId={novelId} character={detail.characters[0]!} detail={detail}
      onChanged={() => { refreshes++; render(); }} />);
  };
  await act(render);
  return { store, source, character, chapters, container, refreshes: () => refreshes };
}

async function click(label: string) {
  const button = [...dom!.document.querySelectorAll("button")].find((node) => node.textContent.includes(label));
  expect(button).toBeDefined();
  await act(async () => { button!.click(); });
}

async function submitPrimary() {
  const button = dom!.document.querySelector<DomButton>(".migration-form button.primary");
  expect(button).not.toBeNull();
  await act(async () => { button!.click(); });
}

describe("角色迁移表单交互与真实数据库副作用", () => {
  test.each(["confirmed", "cancelled"] as const)("复制 %s 为草案：生成新 ID，源行和源快照保持不变", async (status) => {
    const f = await fixture(status);
    const historyBefore = f.store.listMigrationVersions(f.source.id);
    await click("复制为新草案");
    await click("保存");
    const rows = f.store.listMigrations(novelId);
    expect(rows).toHaveLength(2);
    expect(f.store.getMigration(f.source.id)).toEqual(f.source);
    expect(f.store.listMigrationVersions(f.source.id)).toEqual(historyBefore);
    const copied = rows.find((row) => row.id !== f.source.id)!;
    expect(copied.migration).toMatchObject({ status: "draft", startChapterId: null, endChapterId: null, sequence: f.source.migration.sequence + 1, newValue: "谨慎" });
    expect(f.refreshes()).toBe(1);
    expect(dom!.document.querySelector(".form-error")).toBeNull();
  });

  test("编辑已确认迁移：主按钮保存成功，不重复确认且仅新增一版快照", async () => {
    const f = await fixture();
    await click("编辑");
    const endSelect = dom!.document.querySelectorAll<DomSelect>(".migration-form select")[1]!;
    await act(() => {
      endSelect.value = "";
      endSelect.dispatchEvent(new dom!.Event("change", { bubbles: true }));
    });
    await submitPrimary();
    expect(dom!.document.querySelector(".form-error")).toBeNull();
    expect(f.store.getMigration(f.source.id)?.migration).toMatchObject({ status: "confirmed", revision: 3, endChapterId: null });
    expect(f.store.listMigrationVersions(f.source.id)).toHaveLength(2);
    expect(f.refreshes()).toBe(1);
  });

  test("新建确认失败与重复提交：不留下草案，取消表单也没有写入", async () => {
    const f = await fixture();
    await click("＋");
    await submitPrimary();
    expect(dom!.document.querySelector(".form-error")?.textContent).toContain("起始章");
    expect(f.store.listMigrations(novelId)).toHaveLength(1);
    await submitPrimary();
    expect(f.store.listMigrations(novelId)).toHaveLength(1);
    await click("取消");
    expect(f.store.getMigration(f.source.id)).toEqual(f.source);
    expect(f.refreshes()).toBe(0);
  });

  test("草案保存后确认：同一条记录生效，详情刷新", async () => {
    const f = await fixture("draft");
    await click("编辑");
    await submitPrimary();
    expect(f.store.listMigrations(novelId)).toHaveLength(1);
    expect(f.store.getMigration(f.source.id)?.migration.status).toBe("confirmed");
    expect(f.refreshes()).toBe(1);
    expect(dom!.document.querySelector(".form-error")).toBeNull();
  });
});

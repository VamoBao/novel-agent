import { expect, test } from "bun:test";
import { openDatabase } from "../state/db";
import { NovelStore } from "../state/novel-store";
import { CharacterStore } from "../state/character-store";
import { OutlineStore } from "../state/outline-store";
import { ForeshadowStore } from "../state/foreshadow-store";
import { FakeChannel } from "../ui/fake-channel";
import { plantChapterForeshadows, plantOutlineForeshadows } from "./foreshadow-intake";

const item = { surfaceAction: "铜铃无风自响", hiddenTruth: "失踪者藏在铃内", attentionLevel: 9, characterNames: ["林恒"] };
function setup() {
  const db = openDatabase(":memory:");
  new NovelStore(db).createNovel({ id: "novel" });
  const character = new CharacterStore(db).addCharacter("novel", {
    basicInfo: { name: "林恒" }, core: { desire: "寻人", fear: "失去家人", narrativeRole: "主角" },
    background: "寻亲者", creationPurpose: "查出真相", endingDirection: "救出亲人",
  });
  const outlineStore = new OutlineStore(db);
  const tree = outlineStore.saveOutlineTree("novel", [{ name: "上部", summary: "寻人", acts: [
    { name: "初遇", summary: "拾铃", keyPlotPoints: ["拾铃"] },
    { name: "追查", summary: "查铃", keyPlotPoints: ["查铃"] },
    { name: "归来", summary: "救人", keyPlotPoints: ["救人"] },
  ] }]);
  const acts = tree.filter(n => n.node.type === "act");
  const first = outlineStore.saveChapters("novel", acts[0]!.id, [
    { name: "拾铃", summary: "拾到铜铃" }, { name: "夜响", summary: "铜铃作响" },
  ]);
  const second = outlineStore.saveChapters("novel", acts[1]!.id, [{ name: "铃中人", summary: "追查线索" }]);
  const store = new ForeshadowStore(db);
  const channel = new FakeChannel([]);
  const nodes = outlineStore.listOutlineNodes("novel");
  const chapterNodes = first.map(n => ({ id: n.id, name: n.node.name }));
  const options = {
    novelId: "novel", actNodeId: acts[0]!.id, characters: [character],
    chapterNodes, allChapterNodes: nodes.map(n => ({ id: n.id, ...n.node })), allOutlineNodes: nodes,
    unbound: [], recoverable: [], bindings: [], recoverBindings: [], channel, foreshadowStore: store,
  };
  return { db, acts, first, second, store, channel, options, character };
}

// 抓住只存第一个回收幕、或章节新增伏笔根本丢弃回收计划的破坏。
test("大纲伏笔保存同幕及后续多个回收幕", () => {
  const w = setup();
  try {
    plantOutlineForeshadows({ novelId: "novel", newForeshadows: [{ ...item, actName: "初遇", recoverActNames: ["初遇", "追查", "归来"] }],
      characters: [w.character], actNodes: w.acts.map(n => ({ id: n.id, name: n.node.name })), channel: w.channel, foreshadowStore: w.store });
    expect(w.store.listForeshadows("novel")[0]).toMatchObject({ recoverActNodeIds: w.acts.map(n => n.id) });
  } finally { w.db.close(); }
});

test("章节新伏笔保存本幕回收章、已有后幕回收章及尚未规划的末幕", () => {
  const w = setup();
  try {
    plantChapterForeshadows({ ...w.options, newForeshadows: [{ ...item, chapterName: "拾铃", recoveryPlan: [
      { actName: "初遇", chapterNames: ["夜响"] }, { actName: "追查", chapterNames: ["铃中人"] }, { actName: "归来", chapterNames: [] },
    ] }] });
    const row = w.store.listForeshadows("novel")[0]!;
    expect(row).toMatchObject({ recoverActNodeIds: w.acts.map(n => n.id) });
    expect(row.foreshadow.recoverChapterIds).toEqual([w.first[1]!.id, w.second[0]!.id]);
  } finally { w.db.close(); }
});

test("后幕绑定追加已有回收章，且登场幕未规划具体章时仍可按幕序先绑回收", () => {
  const w = setup();
  try {
    const target = w.store.addForeshadow("novel", { ...item, recoveryStatus: "unrecovered", recoverChapterIds: [w.first[1]!.id] }, w.acts[0]!.id, w.acts[1]!.id);
    plantChapterForeshadows({ ...w.options, actNodeId: w.acts[1]!.id, newForeshadows: [],
      chapterNodes: w.second.map(n => ({ id: n.id, name: n.node.name })), recoverable: [target],
      recoverBindings: [{ index: 1, chapterName: "铃中人" }],
    });
    expect(w.store.getForeshadow(target.id)?.foreshadow.recoverChapterIds).toEqual([w.first[1]!.id, w.second[0]!.id]);
  } finally { w.db.close(); }
});

test("旧确认缓存的单幕字段与无数组快照仍可继续绑定", () => {
  const w = setup();
  try {
    const legacy = { ...item, actName: "初遇", recoverActName: "追查" };
    plantOutlineForeshadows({ novelId: "novel", newForeshadows: [legacy] as never,
      characters: [w.character], actNodes: w.acts.map(n => ({ id: n.id, name: n.node.name })), channel: w.channel, foreshadowStore: w.store });
    const target = w.store.listForeshadows("novel")[0]!;
    const snapshot = JSON.parse(JSON.stringify(target));
    delete snapshot.recoverActNodeIds;
    delete snapshot.editRevision;
    plantChapterForeshadows({ ...w.options, newForeshadows: [], unbound: [snapshot], bindings: [{ index: 1, chapterName: "拾铃" }] });
    expect(w.store.getForeshadow(target.id)?.foreshadow.appearChapterId).toBe(w.first[0]!.id);
    expect(w.channel.notifies.some(line => line.includes("已被编辑"))).toBe(false);
  } finally { w.db.close(); }
});

test("同幕未确定登场章时不能先绑回收；非法新回收计划不产生无计划伏笔", () => {
  const w = setup();
  try {
    const target = w.store.addForeshadow("novel", { ...item, recoveryStatus: "unrecovered" }, w.acts[0]!.id, w.acts[0]!.id);
    const result = plantChapterForeshadows({ ...w.options, recoverable: [target],
      recoverBindings: [{ index: 1, chapterName: "夜响" }], newForeshadows: [{ ...item, chapterName: "拾铃", recoveryPlan: [
        { actName: "初遇", chapterNames: ["拾铃"] },
      ] }],
    });
    expect(result).toMatchObject({ created: 0, recoverBound: 0, skipped: 2 });
    expect(w.store.listForeshadows("novel")).toHaveLength(1);
    expect(w.store.getForeshadow(target.id)?.foreshadow.recoverChapterIds).toBeUndefined();
  } finally { w.db.close(); }
});

// 抓住把另一幕正常追加误判用户编辑，从而永久丢弃恢复中本幕绑定的破坏。
test("另一幕先追加回收章后恢复旧快照：合并两幕绑定，同时保留用户显式编辑", () => {
  const w = setup();
  try {
    const outlineStore = new OutlineStore(w.db);
    const [last] = outlineStore.saveChapters("novel", w.acts[2]!.id, [{ name: "归人", summary: "完整揭露" }]);
    const allOutlineNodes = outlineStore.listOutlineNodes("novel");
    const options = { ...w.options, allOutlineNodes, allChapterNodes: allOutlineNodes.map(n => ({ id: n.id, ...n.node })), newForeshadows: [] };
    const target = w.store.addForeshadow("novel", { ...item, appearChapterId: w.first[0]!.id, recoveryStatus: "unrecovered" }, w.acts[0]!.id, [w.acts[1]!.id, w.acts[2]!.id]);
    const step = plantChapterForeshadows({ ...options, actNodeId: w.acts[1]!.id,
      chapterNodes: w.second.map(n => ({ id: n.id, name: n.node.name })), recoverable: [target], recoverBindings: [{ index: 1, chapterName: "铃中人" }],
    });
    expect(step.recoverBound).toBe(1);
    const restored = plantChapterForeshadows({ ...options, actNodeId: w.acts[2]!.id,
      chapterNodes: [{ id: last!.id, name: "归人" }], recoverable: [target], recoverBindings: [{ index: 1, chapterName: "归人" }],
    });
    expect(restored.recoverBound).toBe(1);
    expect(w.store.getForeshadow(target.id)?.foreshadow.recoverChapterIds).toEqual([w.second[0]!.id, last!.id]);
    const snapshot = w.store.getForeshadow(target.id)!;
    // 用户明确清空章绑定，恢复不得把它当作其他幕的正常追加而补回。
    w.store.updateForeshadow(target.id, { recoverChapterIds: null });
    const afterEdit = plantChapterForeshadows({ ...options, actNodeId: w.acts[2]!.id,
      chapterNodes: [{ id: last!.id, name: "归人" }], recoverable: [snapshot], recoverBindings: [{ index: 1, chapterName: "归人" }],
    });
    expect(afterEdit.recoverBound).toBe(0);
    expect(w.store.getForeshadow(target.id)?.foreshadow.recoverChapterIds).toBeUndefined();
  } finally { w.db.close(); }
});

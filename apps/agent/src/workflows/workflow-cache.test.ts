import { expect, test } from "bun:test";
import { openDatabase } from "../state/db";
import { NovelStore } from "../state/novel-store";
import { WorkflowRunStore } from "../state/workflow-run-store";
import { FakeChannel } from "../ui/fake-channel";
import { runCachedWorkflow } from "./workflow-cache";

test("主流程失败重试复用确认产物和已完成步骤，完成后再次恢复不执行副作用", async () => {
  const db = openDatabase(":memory:");
  const novelStore = new NovelStore(db);
  const runStore = new WorkflowRunStore(db);
  const novel = novelStore.createNovel({ name: "恢复测试" });
  const channel = new FakeChannel([]);
  let confirms = 0;
  let fail = true;
  let runId = "";
  const execute = () => runCachedWorkflow({
    kind: "create", novelId: novel.id, novelStore, runStore, channel,
    onRun: (run) => { runId = run.id; },
  }, async (cache) => {
    const payload = await cache.asyncStep("confirmed", async () => { confirms++; return { name: "确认产物" }; });
    cache.step("novel-update", () => novelStore.updateNovel(novel.id, { description: payload.name }));
    if (fail) throw new Error("建卡超时");
    return { novelId: novel.id };
  });
  await expect(execute()).rejects.toThrow("建卡超时");
  expect(runStore.get(runId)?.status).toBe("failed");
  fail = false;
  expect(await execute()).toEqual({ novelId: novel.id });
  expect(confirms).toBe(1);
  expect(runStore.get(runId)?.status).toBe("completed");
  expect(await runCachedWorkflow<{ novelId: string }>({ kind: "create", novelId: novel.id, novelStore, runStore,
    channel, resumeRunId: runId }, async () => { throw new Error("不应重新执行"); }))
    .toEqual({ novelId: novel.id });
  db.close();
});

test("恢复ID必须匹配小说和会话类型", async () => {
  const db = openDatabase(":memory:");
  const novelStore = new NovelStore(db);
  const runStore = new WorkflowRunStore(db);
  const novel = novelStore.createNovel({});
  const run = runStore.create({ kind: "create", novelId: novel.id });
  await expect(runCachedWorkflow({ kind: "regen-outline", novelId: novel.id, novelStore, runStore,
    channel: new FakeChannel([]), resumeRunId: run.id }, async () => null)).rejects.toThrow("不匹配");
  db.close();
});

test("恢复通知失败也释放运行锁，后续可以重试", async () => {
  const db = openDatabase(":memory:");
  const novelStore = new NovelStore(db);
  const runStore = new WorkflowRunStore(db);
  const novel = novelStore.createNovel({});
  const run = runStore.create({ kind: "create", novelId: novel.id });
  const channel = new FakeChannel([]);
  channel.notify = () => { throw new Error("通道已关闭"); };
  await expect(runCachedWorkflow({ kind: "create", novelId: novel.id, novelStore, runStore,
    channel, resumeRunId: run.id }, async () => null)).rejects.toThrow("通道已关闭");
  expect(runStore.get(run.id)?.ownerPid).toBeNull();
  expect(await runCachedWorkflow({ kind: "create", novelId: novel.id, novelStore, runStore,
    channel: new FakeChannel([]), resumeRunId: run.id }, async () => "已恢复")).toBe("已恢复");
  db.close();
});

test("同一小说与目标只允许一个未完成运行", () => {
  const db = openDatabase(":memory:");
  const novelStore = new NovelStore(db);
  const runStore = new WorkflowRunStore(db);
  const novel = novelStore.createNovel({});
  runStore.create({ kind: "regen-outline", novelId: novel.id });
  expect(() => runStore.create({ kind: "regen-outline", novelId: novel.id })).toThrow();
  expect(runStore.listPending(novel.id)).toHaveLength(1);
  db.close();
});

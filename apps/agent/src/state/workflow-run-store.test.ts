import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelMessage } from "ai";
import { openDatabase } from "./db";
import { NovelStore } from "./novel-store";
import { WorkflowRunStore } from "./workflow-run-store";

const dirs: string[] = [];
const connections: Database[] = [];
afterEach(() => {
  for (const db of connections.splice(0)) db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture(): { db: Database; path: string; novelId: string; store: WorkflowRunStore } {
  const dir = mkdtempSync(join(tmpdir(), "workflow-cache-"));
  dirs.push(dir);
  const path = join(dir, "test.db");
  const db = openDatabase(path);
  connections.push(db);
  const novels = new NovelStore(db);
  const novelId = novels.createNovel({ name: "缓存小说" }).id;
  return { db, path, novelId, store: new WorkflowRunStore(novels.database) };
}
const messages: ModelMessage[] = [
  { role: "user", content: "开始" },
  { role: "assistant", content: [
    { type: "reasoning", text: "需要查询", providerOptions: { test: { signature: "signed" } } },
    { type: "tool-call", toolCallId: "call-1", toolName: "list_characters", input: { all: true }, providerOptions: { test: { id: "metadata" } } },
  ] },
  { role: "tool", content: [{ type: "tool-result", toolCallId: "call-1", toolName: "list_characters", output: { type: "json", value: [{ name: "甲" }] } }] },
];

describe("WorkflowRunStore", () => {
  test("未完成运行按小说/目标查找，完成后不再待恢复", () => {
    const { store, novelId } = fixture();
    const run = store.create({ kind: "plan-chapters", novelId, targetId: "act-1" });
    expect(run).toMatchObject({ kind: "plan-chapters", novelId, targetId: "act-1", status: "running", error: null, ownerPid: null });
    expect(store.get(run.id)).toEqual(run);
    expect(store.findPending("plan-chapters", novelId, "act-1")?.id).toBe(run.id);
    expect(store.findPending("plan-chapters", novelId, "act-2")).toBeUndefined();
    expect(store.listPending("other-novel")).toEqual([]);
    store.acquire(run.id);
    store.finish(run.id, "failed", "连接断开");
    expect(store.listPending(novelId)[0]).toMatchObject({ status: "failed", error: "连接断开", ownerPid: null });
    store.acquire(run.id);
    expect(store.get(run.id)).toMatchObject({ status: "running", error: null, ownerPid: process.pid });
    store.finish(run.id, "completed");
    expect(store.listPending()).toEqual([]);
    expect(() => store.acquire(run.id)).toThrow();
  });

  test("重开库后重复步骤复用结果，undefined 完成值仍可辨别", () => {
    const { store, novelId, db, path } = fixture();
    const run = store.create({ kind: "create", novelId });
    store.step(run.id, "rename", () => {
      db.prepare("UPDATE novels SET name = '完成命名' WHERE id = ?").run(novelId);
      return { name: "完成命名", nodes: ["a", "b"] };
    });
    store.record(run.id, "empty", undefined);
    const reopened = openDatabase(path);
    connections.push(reopened);
    const restored = new WorkflowRunStore(reopened);
    expect(restored.step<{ name: string; nodes: string[] }>(run.id, "rename", () => { throw new Error("不应重放"); })).toEqual({ name: "完成命名", nodes: ["a", "b"] });
    expect(restored.getStep(run.id, "empty")).toEqual({ value: undefined });
    expect(restored.getStep(run.id, "missing")).toBeUndefined();
  });

  test("异常、无法编码结果及 Promise 同时回滚业务副作用和完成标记", () => {
    const { store, novelId, db } = fixture();
    const run = store.create({ kind: "create", novelId });
    for (const result of [() => { throw new Error("断开"); }, () => BigInt(1), () => Promise.resolve("异步")]) {
      expect(() => store.step(run.id, "bad", () => {
        db.prepare("UPDATE novels SET name = '不可提交' WHERE id = ?").run(novelId);
        return result();
      })).toThrow();
      expect(new NovelStore(db).getNovel(novelId)?.name).toBe("缓存小说");
      expect(store.getStep(run.id, "bad")).toBeUndefined();
    }
    expect(store.record(run.id, "bad", "重试成功")).toBe("重试成功");
  });

  test("拒绝 JSON 会静默丢失或改变的值", () => {
    const { store, novelId } = fixture();
    const run = store.create({ kind: "create", novelId });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    for (const value of [circular, { fn: () => 1 }, [undefined], NaN, Infinity, new Date(), new Map(), Symbol("bad"), Object.assign([1], { extra: "lost" })]) {
      expect(() => store.record(run.id, "bad", value)).toThrow();
    }
    expect(store.getStep(run.id, "bad")).toBeUndefined();
    expect(store.record<{ x?: undefined; name: string }>(run.id, "optional", { x: undefined, name: "ok" })).toEqual({ name: "ok" });
  });

  test("活进程互斥（含同进程），死进程锁可恢复", () => {
    const { store, novelId, db, path } = fixture();
    const run = store.create({ kind: "create", novelId });
    const secondDb = openDatabase(path);
    connections.push(secondDb);
    const second = new WorkflowRunStore(secondDb);
    store.acquire(run.id);
    expect(() => second.acquire(run.id)).toThrow();
    expect(() => store.acquire(run.id)).toThrow();
    db.prepare("UPDATE workflow_runs SET owner_pid = ? WHERE id = ?").run(2147483647, run.id);
    second.acquire(run.id);
    expect(second.get(run.id)?.ownerPid).toBe(process.pid);
    expect(() => store.acquire("missing")).toThrow();
    expect(() => store.finish("missing", "failed")).toThrow();
  });

  test("SDK 工具调用、结果、reasoning 与 provider metadata 重开库原样往返", () => {
    const { store, novelId, path } = fixture();
    const run = store.create({ kind: "create", novelId });
    const traceId = store.beginTrace(run.id, "outline", "系统提示", messages.slice(0, 1));
    store.saveTrace(traceId, messages, "failed", "断线");
    const reopened = openDatabase(path);
    connections.push(reopened);
    expect(new WorkflowRunStore(reopened).listTraces(run.id)).toEqual([
      { id: traceId, agentName: "outline", system: "系统提示", messages, status: "failed", error: "断线" },
    ]);
    store.saveTrace(traceId, messages, "completed");
    expect(store.listTraces(run.id)[0]).toMatchObject({ status: "completed", error: null });
  });

  test("写入和读取拒绝损坏 SDK 消息及损坏步骤载荷", () => {
    const { store, novelId, db } = fixture();
    const run = store.create({ kind: "create", novelId });
    expect(() => store.beginTrace(run.id, "bad", "system", [{ role: "invalid", content: "bad" }] as unknown as ModelMessage[])).toThrow();
    const traceId = store.beginTrace(run.id, "valid", "system", messages);
    expect(() => store.saveTrace(traceId, [{ role: "tool", content: [{ type: "tool-result" }] }] as unknown as ModelMessage[], "completed")).toThrow();
    expect(store.listTraces(run.id)[0]?.messages).toEqual(messages);
    db.prepare("UPDATE agent_message_traces SET messages = ? WHERE id = ?").run('[{"role":"invalid"}]', traceId);
    expect(() => store.listTraces(run.id)).toThrow();
    store.record(run.id, "step", 1);
    db.prepare("UPDATE workflow_steps SET result = ? WHERE run_id = ?").run("broken json", run.id);
    expect(() => store.getStep(run.id, "step")).toThrow();
  });

  test("外键拒绝孤儿运行，删除小说级联清理运行、步骤与日志", () => {
    const { store, novelId, db } = fixture();
    expect(() => store.create({ kind: "create", novelId: "missing" })).toThrow();
    const run = store.create({ kind: "create", novelId });
    store.record(run.id, "step", "ok");
    store.beginTrace(run.id, "agent", "system", messages);
    new NovelStore(db).deleteNovel(novelId);
    expect(store.get(run.id)).toBeUndefined();
    expect(store.getStep(run.id, "step")).toBeUndefined();
    expect(store.listTraces(run.id)).toEqual([]);
  });
});

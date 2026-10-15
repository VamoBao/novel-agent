import type { Database } from "bun:sqlite";
import { modelMessageSchema, type ModelMessage } from "ai";
import { z } from "zod";
import { generateUuidV7 } from "./id";

export type WorkflowKind = "create" | "plan-chapters" | "regen-outline";
export type WorkflowStatus = "running" | "failed" | "completed";
export interface WorkflowRun {
  id: string;
  kind: WorkflowKind;
  novelId: string;
  targetId: string | null;
  status: WorkflowStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  ownerPid: number | null;
}
export interface AgentMessageTrace {
  id: string;
  agentName: string;
  system: string;
  messages: ModelMessage[];
  status: WorkflowStatus;
  error: string | null;
}
interface RunRow {
  id: string;
  kind: WorkflowKind;
  novel_id: string;
  target_id: string | null;
  status: WorkflowStatus;
  error: string | null;
  created_at: string;
  updated_at: string;
  owner_pid: number | null;
}
function toRun(row: RunRow): WorkflowRun {
  return {
    id: row.id, kind: row.kind, novelId: row.novel_id, targetId: row.target_id,
    status: row.status, error: row.error, createdAt: row.created_at,
    updatedAt: row.updated_at, ownerPid: row.owner_pid,
  };
}

/** JSON.stringify 会静默改变非 JSON 数据；仅允许普通 JSON 与对象可选属性。 */
function encodeJson(value: unknown): string {
  const ancestors = new Set<object>();
  const validate = (current: unknown): void => {
    if (current === null || typeof current === "string" || typeof current === "boolean") return;
    if (typeof current === "number" && Number.isFinite(current)) return;
    if (typeof current !== "object") throw new Error("缓存值必须可 JSON 序列化");
    if (ancestors.has(current)) throw new Error("缓存值不能包含循环引用");
    ancestors.add(current);
    if (Array.isArray(current)) {
      if (Reflect.ownKeys(current).length !== current.length + 1) throw new Error("缓存数组不能含空洞或额外属性");
      for (let index = 0; index < current.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
        if (!descriptor || !("value" in descriptor)) throw new Error("缓存数组不能含空洞或访问器");
        validate(descriptor.value);
      }
    } else {
      const prototype: unknown = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) throw new Error("缓存值必须是普通 JSON 对象");
      for (const key of Reflect.ownKeys(current)) {
        if (typeof key !== "string") throw new Error("缓存值不能包含 Symbol 键");
        const descriptor = Object.getOwnPropertyDescriptor(current, key)!;
        if (!descriptor.enumerable || !("value" in descriptor)) throw new Error("缓存值不能包含隐藏属性或访问器");
        const entry: unknown = descriptor.value;
        if (entry !== undefined) validate(entry);
      }
    }
    ancestors.delete(current);
  };
  validate(value);
  return JSON.stringify(value);
}

function encodeMessages(messages: ModelMessage[]): string {
  const json = encodeJson(messages);
  // 只校验，不使用 parse 返回值：SDK schema 可能剔除 provider 扩展元信息。
  z.array(modelMessageSchema).parse(JSON.parse(json));
  return json;
}
function decodeMessages(json: string): ModelMessage[] {
  const value: unknown = JSON.parse(json);
  z.array(modelMessageSchema).parse(value);
  return value as ModelMessage[];
}
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    // EPERM 等错误无法证明进程死亡，保守保留锁。
    return true;
  }
}

/** 完成标记是幂等依据，工具消息日志仅供追溯，不替代业务完成记录。 */
export class WorkflowRunStore {
  constructor(private readonly db: Database) {}

  create(input: { kind: WorkflowKind; novelId: string; targetId?: string | null }): WorkflowRun {
    const id = generateUuidV7();
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO workflow_runs
      (id, kind, novel_id, target_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'running', ?, ?)`)
      .run(id, input.kind, input.novelId, input.targetId ?? null, now, now);
    return this.get(id)!;
  }

  get(id: string): WorkflowRun | undefined {
    const row = this.db.prepare("SELECT * FROM workflow_runs WHERE id = ?").get(id) as RunRow | null;
    return row ? toRun(row) : undefined;
  }

  listPending(novelId?: string): WorkflowRun[] {
    const rows = (novelId === undefined
      ? this.db.prepare("SELECT * FROM workflow_runs WHERE status != 'completed' ORDER BY created_at, id").all()
      : this.db.prepare("SELECT * FROM workflow_runs WHERE status != 'completed' AND novel_id = ? ORDER BY created_at, id").all(novelId)) as RunRow[];
    return rows.map(toRun);
  }

  findPending(kind: WorkflowKind, novelId: string, targetId?: string | null): WorkflowRun | undefined {
    return this.listPending(novelId).find((run) => run.kind === kind && run.targetId === (targetId ?? null));
  }

  findLatest(kind: WorkflowKind, novelId: string, targetId?: string | null): WorkflowRun | undefined {
    const row = this.db.prepare(`SELECT * FROM workflow_runs
      WHERE kind = ? AND novel_id = ? AND target_id IS ? ORDER BY created_at DESC, id DESC LIMIT 1`)
      .get(kind, novelId, targetId ?? null) as RunRow | null;
    return row ? toRun(row) : undefined;
  }

  acquire(id: string): void {
    this.db.transaction(() => {
      const run = this.requireRun(id);
      if (run.status === "completed") throw new Error("工作流已完成，不能再次执行");
      if (run.ownerPid !== null && isAlive(run.ownerPid)) throw new Error("工作流仍被活进程占用");
      this.db.prepare("UPDATE workflow_runs SET owner_pid = ?, status = 'running', error = NULL, updated_at = ? WHERE id = ?")
        .run(process.pid, new Date().toISOString(), id);
    }).immediate();
  }

  finish(id: string, status: "failed" | "completed", error?: string): void {
    const result = this.db.prepare("UPDATE workflow_runs SET status = ?, error = ?, owner_pid = NULL, updated_at = ? WHERE id = ?")
      .run(status, error ?? null, new Date().toISOString(), id);
    if (result.changes === 0) throw new Error(`工作流不存在：${id}`);
  }

  getStep<T>(runId: string, key: string): { value: T } | undefined {
    const row = this.db.prepare("SELECT result FROM workflow_steps WHERE run_id = ? AND key = ?").get(runId, key) as { result: string } | null;
    if (!row) return undefined;
    const envelope: unknown = JSON.parse(row.result);
    if (envelope === null || typeof envelope !== "object" || Array.isArray(envelope)
      || Object.keys(envelope).some((entry) => entry !== "value")) throw new Error("工作流步骤缓存损坏");
    return { value: (envelope as { value: T }).value };
  }

  step<T>(runId: string, key: string, action: () => T): T {
    return this.db.transaction(() => {
      const cached = this.getStep<T>(runId, key);
      if (cached) return cached.value;
      this.requireRun(runId);
      const value = action();
      if (value !== null && (typeof value === "object" || typeof value === "function") && "then" in value) {
        throw new Error("同步步骤不能返回 Promise；异步副作用无法保证事务原子性");
      }
      const json = encodeJson({ value });
      this.db.prepare("INSERT INTO workflow_steps (run_id, key, result, created_at) VALUES (?, ?, ?, ?)")
        .run(runId, key, json, new Date().toISOString());
      return (JSON.parse(json) as { value: T }).value;
    }).immediate();
  }

  record<T>(runId: string, key: string, value: T): T {
    return this.step(runId, key, () => value);
  }

  beginTrace(runId: string, agentName: string, system: string, messages: ModelMessage[]): string {
    const json = encodeMessages(messages);
    const id = generateUuidV7();
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO agent_message_traces
      (id, run_id, agent_name, system, messages, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'running', ?, ?)`)
      .run(id, runId, agentName, system, json, now, now);
    return id;
  }

  saveTrace(traceId: string, messages: ModelMessage[], status: WorkflowStatus, error?: string): void {
    const json = encodeMessages(messages);
    const result = this.db.prepare("UPDATE agent_message_traces SET messages = ?, status = ?, error = ?, updated_at = ? WHERE id = ?")
      .run(json, status, error ?? null, new Date().toISOString(), traceId);
    if (result.changes === 0) throw new Error(`Agent 消息日志不存在：${traceId}`);
  }

  listTraces(runId: string): AgentMessageTrace[] {
    const rows = this.db.prepare("SELECT * FROM agent_message_traces WHERE run_id = ? ORDER BY created_at, id").all(runId) as Array<{
      id: string; agent_name: string; system: string; messages: string; status: WorkflowStatus; error: string | null;
    }>;
    return rows.map((row) => ({ id: row.id, agentName: row.agent_name, system: row.system,
      messages: decodeMessages(row.messages), status: row.status, error: row.error }));
  }

  private requireRun(id: string): WorkflowRun {
    const run = this.get(id);
    if (!run) throw new Error(`工作流不存在：${id}`);
    return run;
  }
}

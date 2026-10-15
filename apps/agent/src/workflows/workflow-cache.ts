import { withAgentMessageCache } from "../agents/session-context";
import type { NovelStore } from "../state/novel-store";
import { WorkflowRunStore, type WorkflowKind, type WorkflowRun } from "../state/workflow-run-store";
import type { UiChannel } from "../ui/channel";

export interface WorkflowCacheOptions {
  resumeRunId?: string;
  runStore?: WorkflowRunStore;
  onRun?: (run: WorkflowRun) => void;
}

export class WorkflowCache {
  constructor(readonly run: WorkflowRun, private readonly store: WorkflowRunStore) {}

  step<T>(key: string, action: () => T): T {
    return this.store.step(this.run.id, key, action);
  }

  async asyncStep<T>(key: string, action: () => Promise<T>): Promise<T> {
    const saved = this.store.getStep<T>(this.run.id, key);
    if (saved) return saved.value;
    const value = await withAgentMessageCache({ runId: this.run.id, agentName: key, store: this.store }, action);
    return this.store.record(this.run.id, key, value);
  }
}

export async function runCachedWorkflow<T>(options: WorkflowCacheOptions & {
  kind: WorkflowKind;
  novelId: string;
  targetId?: string;
  novelStore: NovelStore;
  channel: UiChannel;
}, action: (cache: WorkflowCache) => Promise<T>): Promise<T> {
  const store = options.runStore ?? new WorkflowRunStore(options.novelStore.database);
  let resumed = false;
  // 查找/创建/领取同事务，避免两个进程同时发现“没有未完成运行”后分别启动。
  const run = options.novelStore.database.transaction(() => {
    const existing = options.resumeRunId
      ? store.get(options.resumeRunId)
      : store.findPending(options.kind, options.novelId, options.targetId);
    if (options.resumeRunId && !existing) throw new Error("需要恢复的工作流不存在");
    if (existing && (existing.kind !== options.kind || existing.novelId !== options.novelId
      || existing.targetId !== (options.targetId ?? null))) throw new Error("恢复记录与小说或会话目标不匹配");
    resumed = existing !== undefined;
    const selected = existing ?? store.create({ kind: options.kind, novelId: options.novelId, targetId: options.targetId });
    if (selected.status !== "completed") store.acquire(selected.id);
    return selected;
  }).immediate();
  if (run.status === "completed") {
    options.onRun?.(run);
    const result = store.getStep<T>(run.id, "workflow-result");
    if (!result) throw new Error("已完成工作流缺少结果，无法安全恢复");
    return result.value;
  }
  try {
    options.onRun?.(run);
    if (resumed) options.channel.notify("♻️ 正在继续未完成的流程，已确认结果与完成步骤将直接复用");
    const format = store.step(run.id, "cache-format", () => ({ version: 1 }));
    if (format.version !== 1) throw new Error("工作流缓存格式不兼容，无法安全恢复");
    const result = await action(new WorkflowCache(run, store));
    store.step(run.id, "workflow-result", () => {
      store.finish(run.id, "completed");
      return result;
    });
    return result;
  } catch (error) {
    store.finish(run.id, "failed", error instanceof Error ? error.message : String(error));
    throw error;
  }
}

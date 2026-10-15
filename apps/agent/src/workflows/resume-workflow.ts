import { getDefaultNovelStore } from "../state/novel-store";
import { WorkflowRunStore, type WorkflowRun } from "../state/workflow-run-store";
import type { UiChannel } from "../ui/channel";
import { createNovel } from "./create-novel";
import { planActChapters } from "./plan-act-chapters";
import { regenerateOutline } from "./regen-outline";

/** 按持久化运行选择原流程与目标；入口不允许重新指定小说或幕。 */
export async function resumeWorkflow(runId: string, options: {
  channel: UiChannel;
  onRun?: (run: WorkflowRun) => void;
}): Promise<string> {
  const novelStore = getDefaultNovelStore();
  const runStore = new WorkflowRunStore(novelStore.database);
  const run = runStore.get(runId);
  if (!run) throw new Error("需要恢复的工作流不存在");
  const common = { ...options, novelStore, runStore, resumeRunId: run.id };
  switch (run.kind) {
    case "create": return (await createNovel({ ...common, id: run.novelId })).id;
    case "plan-chapters":
      if (!run.targetId) throw new Error("章节规划恢复记录缺少目标幕");
      return (await planActChapters({ ...common, novelId: run.novelId, actNodeId: run.targetId })).novelId;
    case "regen-outline": return (await regenerateOutline({ ...common, novelId: run.novelId })).novelId;
  }
}

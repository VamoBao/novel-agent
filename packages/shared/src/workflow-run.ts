import { z } from "zod";

/** 仅暴露恢复入口所需摘要；SDK 消息与主步骤结果保留在 agent 内部。 */
export const workflowRunSummarySchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["create", "plan-chapters", "regen-outline"]),
  targetId: z.string().nullable(),
  status: z.enum(["running", "failed"]),
  error: z.string().nullable(),
  updatedAt: z.string(),
});
export type WorkflowRunSummary = z.infer<typeof workflowRunSummarySchema>;

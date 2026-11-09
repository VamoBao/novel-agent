import { z } from "zod";

/** 执行活动快照；同一 id 的后续快照更新原卡片，不追加重复记录。 */
export const activitySchema = z.object({
  id: z.string().min(1).max(128),
  parentId: z.string().min(1).max(128).optional(),
  kind: z.enum(["agent", "tool"]),
  name: z.string().min(1).max(128),
  status: z.enum(["running", "completed", "failed", "interrupted"]),
  startedAt: z.number().int().nonnegative(),
  endedAt: z.number().int().nonnegative().optional(),
  input: z.string().max(12000).optional(),
  output: z.string().max(12000).optional(),
});
export type Activity = z.infer<typeof activitySchema>;

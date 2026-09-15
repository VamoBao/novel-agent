import { z } from "zod";

/**
 * 核心冲突：整个故事主要冲突的由来、对角色的影响与理想的解决结果。
 */
export const coreConflictSchema = z.object({
  origin: z.string().min(1).describe("冲突的由来"),
  impact: z.string().min(1).describe("冲突对角色的影响"),
  idealResolution: z.string().min(1).describe("冲突理想的解决结果"),
});

export type CoreConflict = z.infer<typeof coreConflictSchema>;

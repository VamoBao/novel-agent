import { z } from "zod";
import { coreConflictSchema } from "./conflict";

/** 小说的创作条件：未采集/历史数据为 null；空受众数组表示已采集但没有标签。 */
export const novelCreationParamsSchema = z.object({
  genre: z.string().min(1).nullable().describe("小说类型，未采集为 null"),
  narrativePov: z
    .string()
    .min(1)
    .nullable()
    .describe("叙事视角（如第一人称 / 第三人称限知 / 第三人称全知 / 多视角轮换），未采集为 null"),
  audience: z.array(z.string().min(1)).nullable().describe("受众标签与补充说明，未采集为 null"),
  coreConflict: coreConflictSchema.nullable().describe("核心冲突，未采集为 null"),
});

export type NovelCreationParams = z.infer<typeof novelCreationParamsSchema>;

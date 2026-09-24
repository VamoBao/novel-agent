import { z } from "zod";

/**
 * 章节规划：把一幕（act）拆解为若干章（chapter）的写作期计划。
 * 章节数量由模型按幕梗概与关键情节点的密度推荐（上限 12 防漂移），
 * 每章有章名与剧情概述，经用户确认后作为 chapter 节点挂到幕下。
 */
export const chapterPlanSchema = z.object({
  chapters: z
    .array(
      z.object({
        name: z.string().min(1).describe("章名，如：第一章·雨夜来客"),
        summary: z.string().min(1).describe("本章剧情概述"),
      }),
    )
    .min(1)
    .max(12)
    .describe("章节规划：数量由模型按幕内容推荐（通常 3~8 章）"),
});

export type ChapterPlan = z.infer<typeof chapterPlanSchema>;

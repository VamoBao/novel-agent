import { z } from "zod";

/**
 * 小说大纲：分幕结构 + 关键情节点。
 */
export const outlineSchema = z.object({
  title: z.string().min(1).describe("小说标题"),
  logline: z.string().min(1).describe("一句话故事梗概"),
  theme: z.string().optional().describe("主题"),
  acts: z
    .array(
      z.object({
        name: z.string().min(1).describe("幕名，如：第一幕·开端"),
        summary: z.string().min(1).describe("本幕梗概"),
        keyPlotPoints: z.array(z.string().min(1)).min(1).describe("关键情节点"),
      }),
    )
    .min(3)
    .describe("分幕结构"),
});

export type Outline = z.infer<typeof outlineSchema>;

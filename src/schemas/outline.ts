import { z } from "zod";

/**
 * 小说大纲：部 → 幕两级结构 + 关键情节点，与 outlines 表树形模型对应。
 */
export const outlineSchema = z.object({
  title: z.string().min(1).describe("小说标题"),
  logline: z.string().min(1).describe("一句话故事梗概"),
  theme: z.string().optional().describe("主题"),
  parts: z
    .array(
      z.object({
        name: z.string().min(1).describe("部名，如：第一部·风起"),
        summary: z.string().min(1).describe("本部梗概（该宏观段落的故事作用）"),
        acts: z
          .array(
            z.object({
              name: z.string().min(1).describe("幕名，如：第一幕·开端"),
              summary: z.string().min(1).describe("本幕梗概"),
              keyPlotPoints: z.array(z.string().min(1)).min(1).describe("关键情节点"),
            }),
          )
          .min(1)
          .describe("本部的幕结构，每部至少 1 幕"),
      }),
    )
    .min(1)
    .describe("分部结构"),
});

export type Outline = z.infer<typeof outlineSchema>;

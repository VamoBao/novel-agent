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

/**
 * 大纲结构化输出的「新增角色清单」项：大纲中登场、但角色库中没有的角色。
 * name 照抄角色名；role 为该角色在大纲中的一句话定位（如「反派·血宗宗主」），
 * 供确认门展示与角色自动创建 Agent 作种子。
 */
export const newCharacterSchema = z.object({
  name: z.string().min(1).describe("角色名"),
  role: z.string().min(1).describe("该角色在大纲中的一句话定位，如：反派·血宗宗主"),
});

export type NewCharacterOutline = z.infer<typeof newCharacterSchema>;

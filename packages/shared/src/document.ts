import { z } from "zod";

/**
 * 章节正文（document）：一章一份正文，挂 outlines 表 chapter 节点。
 * 正文由写作模型（providers/writing-model，OpenAI 接口兼容端点）按章节剧情概述生成，
 * 入库同时回填章节点 document_id 并将状态置 completed（与大纲内容列职责分离——
 * 梗概/情节点在 outlines 行内，长文本正文独立成表）。
 */
export const documentSchema = z.object({
  id: z.string().min(1).describe("documents 表主键（UUIDv7）"),
  novelId: z.string().min(1).describe("所属小说创作 ID"),
  chapterId: z
    .string()
    .min(1)
    .describe("所属章（outlines 表 chapter 节点）ID，唯一——一章一份正文"),
  content: z.string().min(1).describe("正文全文（写作模型生成）"),
  wordCount: z.number().int().min(0).describe("正文字数（不含空白字符）"),
  createdAt: z.string().describe("生成时间（ISO 8601）"),
  updatedAt: z.string().describe("最近更新时间（ISO 8601）"),
});
export type Document = z.infer<typeof documentSchema>;

import { z } from "zod";

/** 大纲节点类型：卷（volume）/ 部（part）/ 幕（act）/ 章（chapter），树形层级 */
export const outlineNodeTypeSchema = z.enum(["volume", "part", "act", "chapter"]);
export type OutlineNodeType = z.infer<typeof outlineNodeTypeSchema>;

/** 大纲节点状态：计划中 → 写作中 → 写作完成；已废弃用于留存历史版本 */
export const outlineNodeStatusSchema = z.enum([
  "planned",
  "writing",
  "completed",
  "deprecated",
]);
export type OutlineNodeStatus = z.infer<typeof outlineNodeStatusSchema>;

/** 大纲树节点：同一节点可有多个版本行并存，isCurrentVersion 标记生效版本 */
export const outlineNodeSchema = z.object({
  parentId: z.string().nullable().describe("父级大纲节点 ID，根节点为 null"),
  type: outlineNodeTypeSchema.describe("节点类型"),
  name: z.string().min(1).describe("节点名称"),
  sort: z.number().int().min(1).describe("同一父级下当前版本内的排序，从 1 起"),
  version: z.number().int().min(1).describe("版本号，从 1 起"),
  isCurrentVersion: z.boolean().describe("是否当前使用版本（同父级下各当前版本 sort 唯一）"),
  status: outlineNodeStatusSchema.describe("节点状态"),
  documentId: z.string().nullable().describe("后续写作正文的 ID，未开写为 null"),
});
export type OutlineNode = z.infer<typeof outlineNodeSchema>;

/** 可更新字段：改名 / 排序 / 版本切换 / 写作状态与正文回填；type、parentId、version 为结构属性不可改 */
export const outlineNodePatchSchema = outlineNodeSchema
  .pick({ name: true, sort: true, isCurrentVersion: true, status: true, documentId: true })
  .partial();
export type OutlineNodePatch = z.infer<typeof outlineNodePatchSchema>;

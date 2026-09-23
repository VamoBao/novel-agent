import { z } from "zod";

/** 大纲节点类型：部（part）/ 幕（act）/ 章（chapter），树形层级；章为写作期节点，大纲阶段不创建 */
export const outlineNodeTypeSchema = z.enum(["part", "act", "chapter"]);
export type OutlineNodeType = z.infer<typeof outlineNodeTypeSchema>;

/** 大纲节点状态：计划中 → 写作中 → 写作完成；已废弃用于留存历史版本 */
export const outlineNodeStatusSchema = z.enum([
  "planned",
  "writing",
  "completed",
  "deprecated",
]);
export type OutlineNodeStatus = z.infer<typeof outlineNodeStatusSchema>;

/** 字段层 schema：patch 由它 pick 派生（zod 4 不允许在带 refine 的 schema 上 pick） */
const outlineNodeObjectSchema = z.object({
  parentId: z.string().nullable().describe("父级大纲节点 ID，根节点为 null"),
  type: outlineNodeTypeSchema.describe("节点类型"),
  name: z.string().min(1).describe("节点名称"),
  summary: z.string().nullable().describe("节点梗概（部/幕均入库）；历史行与未填为 null"),
  keyPlotPoints: z
    .array(z.string().min(1))
    .min(1)
    .nullable()
    .describe("关键情节点（至少 1 条），仅幕节点携带；部/章节点与历史行为 null"),
  sort: z.number().int().min(1).describe("同一父级下当前版本内的排序，从 1 起"),
  version: z.number().int().min(1).describe("版本号，从 1 起"),
  isCurrentVersion: z.boolean().describe("是否当前使用版本（同父级下各当前版本 sort 唯一）"),
  status: outlineNodeStatusSchema.describe("节点状态"),
  documentId: z.string().nullable().describe("后续写作正文的 ID，未开写为 null"),
});

/**
 * 大纲树节点：同一节点可有多个版本行并存，isCurrentVersion 标记生效版本。
 * 内容列随节点入库：summary 为部/幕梗概，keyPlotPoints 仅幕节点携带
 * （历史行迁移前入库，两列均可能为 null）。
 */
export const outlineNodeSchema = outlineNodeObjectSchema.refine(
  (node) => node.keyPlotPoints === null || node.type === "act",
  {
    path: ["keyPlotPoints"],
    message: "关键情节点仅幕节点可携带，部/章节点必须为 null",
  },
);
export type OutlineNode = z.infer<typeof outlineNodeSchema>;

/** 可更新字段：改名 / 内容（梗概与关键情节点）/ 排序 / 版本切换 / 写作状态与正文回填；
 * type、parentId、version 为结构属性不可改 */
export const outlineNodePatchSchema = outlineNodeObjectSchema
  .pick({
    name: true,
    summary: true,
    keyPlotPoints: true,
    sort: true,
    isCurrentVersion: true,
    status: true,
    documentId: true,
  })
  .partial();
export type OutlineNodePatch = z.infer<typeof outlineNodePatchSchema>;

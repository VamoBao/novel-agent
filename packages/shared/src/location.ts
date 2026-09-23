import { z } from "zod";

/**
 * 位置 schema：小说世界里的地理位置（数据层先行，创作流采集与客户端浏览后续接入）。
 *
 * 字段一览：
 * - name 名称：如 xx大陆、xx城
 * - x / y 坐标：小说世界平面坐标（横 / 纵），浮点数
 * - layer 图层：纵向位置（如天上、地面、地底），自由文本——架空世界可能有
 *   「深渊层」「星界」等，不做枚举约束
 * - population 人口：该地点主要物种的数量（不一定是人）；无人 / 未设定缺省
 * - parentId 父级：父级位置 ID（如某城市的父级是某片大陆）；顶级位置缺省
 */
export const locationSchema = z.object({
  name: z.string().min(1).describe("位置名称，如 xx大陆、xx城"),
  x: z.number().describe("横坐标（小说世界平面坐标）"),
  y: z.number().describe("纵坐标（小说世界平面坐标）"),
  layer: z.string().min(1).describe("图层：纵向位置，如天上、地面、地底"),
  population: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("主要物种数量；无人 / 未设定缺省"),
  parentId: z.string().min(1).optional().describe("父级位置 ID；顶级位置（如大陆）缺省"),
});

export type Location = z.infer<typeof locationSchema>;

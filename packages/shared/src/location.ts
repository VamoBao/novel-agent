import { z } from "zod";

/**
 * 位置 schema：小说世界里的地理位置。
 *
 * 字段一览：
 * - name 名称：如 xx大陆、xx城
 * - description 定位：一句话定位（如「东部边境要塞·主角初战的战场」）；
 *   大纲 / 章节规划自动入库时携带，未设定缺省
 * - x / y 坐标：小说世界平面坐标（横 / 纵），浮点数——地图向字段，未设定缺省
 *   （自动入库不产生坐标，留给未来地图功能编辑）
 * - layer 图层：纵向位置（如天上、地面、地底），自由文本——架空世界可能有
 *   「深渊层」「星界」等，不做枚举约束；未设定缺省
 * - population 人口：该地点主要物种的数量（不一定是人）；无人 / 未设定缺省
 * - parentId 父级：父级位置 ID（如某城市的父级是某片大陆）；顶级位置缺省
 */
export const locationSchema = z.object({
  name: z.string().min(1).describe("位置名称，如 xx大陆、xx城"),
  description: z.string().min(1).optional().describe("一句话定位；大纲/章节规划自动入库携带，未设定缺省"),
  x: z.number().optional().describe("横坐标（小说世界平面坐标）；未设定缺省"),
  y: z.number().optional().describe("纵坐标（小说世界平面坐标）；未设定缺省"),
  layer: z.string().min(1).optional().describe("图层：纵向位置，如天上、地面、地底；未设定缺省"),
  population: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("主要物种数量；无人 / 未设定缺省"),
  parentId: z.string().min(1).optional().describe("父级位置 ID；顶级位置（如大陆）缺省"),
});

export type Location = z.infer<typeof locationSchema>;

/** 大纲 / 章节规划回传的「新增地点」清单项：名字 + 一句话定位（对齐 newCharacterSchema 的 name+role 形态） */
export const newLocationSchema = z.object({
  name: z.string().min(1).describe("地点名称，如 北境大陆、青云城"),
  description: z
    .string()
    .min(1)
    .describe("该地点在大纲/规划中的一句话定位，如「东部边境要塞·主角初战的战场」"),
});

export type NewLocation = z.infer<typeof newLocationSchema>;

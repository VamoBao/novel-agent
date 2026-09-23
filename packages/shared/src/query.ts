import { z } from "zod";
import { characterSchema } from "./character";
import { outlineNodeTypeSchema } from "./outline-node";
import { worldviewSchema } from "./worldview";

/**
 * 库查询结果契约：agent 一次性查询 CLI（apps/agent/src/query.ts）的序列化输出
 * 与 Electron 主进程 zod 复验共用同一份 schema，杜绝两侧结构漂移。
 * 与 protocol.ts 的长驻 stdio 协议相区分：查询走 spawn + stdout 单次往返。
 */

/** 小说列表项：name 在大纲确认后才回填 novels 表，未命名 / 中途退出的小说为 null */
export const novelListItemSchema = z.object({
  id: z.string().min(1).describe("小说创作 ID（UUIDv7）"),
  name: z.string().nullable().describe("小说名称，未命名为 null"),
  pinned: z.boolean().describe("置顶（列表排序优先，组内按创建时间倒序）"),
  favorite: z.boolean().describe("收藏（星标，不影响排序）"),
  createdAt: z.string().describe("创建时间（ISO 8601）"),
  updatedAt: z.string().describe("最近更新时间（ISO 8601）"),
});
export type NovelListItem = z.infer<typeof novelListItemSchema>;

/** 角色条目：角色卡 + 库表主键（客户端结构树节点 key 用） */
export const characterEntrySchema = characterSchema.extend({
  id: z.string().min(1).describe("characters 表主键（UUIDv7）"),
});
export type CharacterEntry = z.infer<typeof characterEntrySchema>;

/** 大纲节点条目：outlines 表当前版本节点（客户端结构树与按节点内容预览用） */
export const outlineNodeEntrySchema = z.object({
  id: z.string().min(1).describe("outlines 表主键（UUIDv7）"),
  parentId: z.string().nullable().describe("父级节点 ID，根节点（部）为 null"),
  type: outlineNodeTypeSchema.describe("节点类型：part（部）/ act（幕）/ chapter（章，写作期）"),
  name: z.string().min(1).describe("节点名称"),
  sort: z.number().int().min(1).describe("同级排序，从 1 起"),
  summary: z.string().nullable().describe("节点梗概；历史数据（6 版迁移前入库）为 null，展示空内容"),
  keyPlotPoints: z
    .array(z.string().min(1))
    .min(1)
    .nullable()
    .describe("关键情节点，仅幕节点携带；历史数据为 null"),
});
export type OutlineNodeEntry = z.infer<typeof outlineNodeEntrySchema>;

/** 单本小说全量资料：三类结构数据均可缺失（对应创作中途尚未落库的部分） */
export const novelDetailSchema = z.object({
  novel: novelListItemSchema,
  worldview: worldviewSchema.nullable().describe("世界观，未确认为 null"),
  characters: z.array(characterEntrySchema).describe("全部角色（按入库顺序）"),
  outlineNodes: z
    .array(outlineNodeEntrySchema)
    .describe("大纲节点（读 outlines 表当前版本，按父级分组 + sort 排序）；未生成为空数组"),
});
export type NovelDetail = z.infer<typeof novelDetailSchema>;

/** delete 命令的结果：被删除的小说创作 ID */
export const novelDeletedResultSchema = z.object({
  deleted: z.string().min(1).describe("被删除的小说创作 ID"),
});
export type NovelDeletedResult = z.infer<typeof novelDeletedResultSchema>;

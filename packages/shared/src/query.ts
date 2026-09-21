import { z } from "zod";
import { characterSchema } from "./character";
import { outlineSchema } from "./outline";
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
  createdAt: z.string().describe("创建时间（ISO 8601）"),
  updatedAt: z.string().describe("最近更新时间（ISO 8601）"),
});
export type NovelListItem = z.infer<typeof novelListItemSchema>;

/** 角色条目：角色卡 + 库表主键（客户端结构树节点 key 用） */
export const characterEntrySchema = characterSchema.extend({
  id: z.string().min(1).describe("characters 表主键（UUIDv7）"),
});
export type CharacterEntry = z.infer<typeof characterEntrySchema>;

/** 单本小说全量资料：三类结构数据均可缺失（对应创作中途尚未落库的部分） */
export const novelDetailSchema = z.object({
  novel: novelListItemSchema,
  worldview: worldviewSchema.nullable().describe("世界观，未确认为 null"),
  characters: z.array(characterEntrySchema).describe("全部角色（按入库顺序）"),
  outline: outlineSchema
    .nullable()
    .describe("大纲（读 output/<id>.json 产物），未生成或产物缺失为 null"),
});
export type NovelDetail = z.infer<typeof novelDetailSchema>;

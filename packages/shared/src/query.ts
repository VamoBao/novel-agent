import { z } from "zod";
import { characterSchema } from "./character";
import { foreshadowSchema } from "./foreshadow";
import { locationSchema } from "./location";
import { outlineNodeTypeSchema } from "./outline-node";
import { styleReferenceSchema } from "./style-reference";
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

/** 角色条目：角色卡 + 库表主键（客户端结构树节点 key 用）+ 版本号（编辑提交易主行递增，历史快照在 character_versions 表） */
export const characterEntrySchema = characterSchema.extend({
  id: z.string().min(1).describe("characters 表主键（UUIDv7）"),
  version: z.number().int().min(1).describe("角色当前版本号，从 1 起；编辑提交后递增"),
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

/** 章节正文条目：章节点预览用（novelId 冗余于详情载荷，不重复携带）；
 *  content 为查询时从文件读取的全文，文件缺失 / 被移动时为 null（客户端占位提示） */
export const documentEntrySchema = z.object({
  id: z.string().min(1).describe("documents 表主键（UUIDv7）"),
  chapterId: z.string().min(1).describe("所属章（outlines 表 chapter 节点）ID"),
  filePath: z.string().min(1).describe("正文文件相对路径（相对 output 根）"),
  wordCount: z.number().int().min(0).describe("正文字数（不含空白字符）"),
  updatedAt: z.string().describe("生成时间（ISO 8601）"),
  content: z
    .string()
    .nullable()
    .describe("正文全文（查询时读文件）；文件缺失或被移动为 null"),
});
export type DocumentEntry = z.infer<typeof documentEntrySchema>;

/** 伏笔条目：foreshadows 表当前行（章卡按 appearChapterId / recoverChapterIds 取用）；
 *  服务角色为 ID，客户端经详情 characters 解析名字 */
export const foreshadowEntrySchema = foreshadowSchema.extend({
  id: z.string().min(1).describe("foreshadows 表主键（UUIDv7）"),
  actNodeId: z
    .string()
    .min(1)
    .nullable()
    .describe("埋设幕节点 ID（outlines 表 act 节点）；未绑幕 / 旧数据为 null"),
  recoverActNodeId: z
    .string()
    .min(1)
    .nullable()
    .describe("回收幕节点 ID（大纲规划的真相揭晓幕）；未规划 / 旧数据为 null"),
});
export type ForeshadowEntry = z.infer<typeof foreshadowEntrySchema>;

/** 地点条目：locations 表当前行（按入库顺序）；description 与坐标等可选字段未设定时缺省不携带 */
export const locationEntrySchema = locationSchema.extend({
  id: z.string().min(1).describe("locations 表主键（UUIDv7）"),
});
export type LocationEntry = z.infer<typeof locationEntrySchema>;

/** 参考文风条目：style_references 表当前行（按入库顺序）；生成正文按 enabled 注入 */
export const styleReferenceEntrySchema = styleReferenceSchema.extend({
  id: z.string().min(1).describe("style_references 表主键（UUIDv7）"),
});
export type StyleReferenceEntry = z.infer<typeof styleReferenceEntrySchema>;

/** 单本小说全量资料：结构数据（世界观 / 角色 / 大纲节点 / 正文 / 伏笔）均可缺失（对应创作中途尚未落库的部分） */
export const novelDetailSchema = z.object({
  novel: novelListItemSchema,
  worldview: worldviewSchema.nullable().describe("世界观，未确认为 null"),
  characters: z.array(characterEntrySchema).describe("全部角色（按入库顺序）"),
  outlineNodes: z
    .array(outlineNodeEntrySchema)
    .describe("大纲节点（读 outlines 表当前版本，按父级分组 + sort 排序）；未生成为空数组"),
  documents: z
    .array(documentEntrySchema)
    .describe("章节正文（一章一份，未生成为空数组；章节点预览按 chapterId 取用）"),
  foreshadows: z
    .array(foreshadowEntrySchema)
    .describe("全部伏笔（按入库顺序，未生成为空数组；章节点预览按 appearChapterId / recoverChapterIds 取用）"),
  locations: z
    .array(locationEntrySchema)
    .describe("全部地点（按入库顺序，未生成为空数组；结构树地点组取用）"),
  styleReferences: z
    .array(styleReferenceEntrySchema)
    .describe(
      "全部参考文风（按入库顺序，未添加为空数组；结构树文风组与正文生成注入取用）",
    ),
});
export type NovelDetail = z.infer<typeof novelDetailSchema>;

/** delete 命令的结果：被删除的小说创作 ID */
export const novelDeletedResultSchema = z.object({
  deleted: z.string().min(1).describe("被删除的小说创作 ID"),
});
export type NovelDeletedResult = z.infer<typeof novelDeletedResultSchema>;

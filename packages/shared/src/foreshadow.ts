import { z } from "zod";

/**
 * 伏笔 schema：小说创作中的伏笔管理（数据层先行，创作流采集与客户端浏览后续接入）。
 *
 * 字段一览：
 * - surfaceAction 表面行为（必填）：伏笔的表面表现，如「某角色被派去执行危险任务」
 * - hiddenTruth 隐藏的真相（必填）：伏笔真正要反映的剧情体现，如「暗示某角色的死亡」
 * - attentionLevel 读者注意度（必填，1-10）：1 最容易被读者发现，10 最难发现
 * - recoveryStatus 回收状态：未回收（缺省）/ 部分回收 / 已回收
 * - plantingMethod 埋线方式：如对话、一个物件描述、托梦，自由文本
 * - purpose 创作目的：如「某一重大事件的引子」
 * - appearChapterId 出现的章节 ID：暂定大纲章节 ID，可空裸列——chapter 节点
 *   写作期落地后再补约束（先例：outlines.document_id）
 * - recoverChapterIds 回收的章节 ID（多值，JSON 列）：多个即跨多章的多步回收
 * - characterIds 服务的角色 ID（多值，JSON 列）：如某伏笔暗示某两个角色的结局
 */
export const foreshadowRecoveryStatusSchema = z.enum([
  "unrecovered",
  "partial",
  "recovered",
]);

export const foreshadowSchema = z.object({
  surfaceAction: z
    .string()
    .min(1)
    .describe("表面行为：伏笔的表面表现，如某角色被派去执行危险任务"),
  hiddenTruth: z
    .string()
    .min(1)
    .describe("隐藏的真相：伏笔真正要反映的剧情体现，如暗示某角色的死亡"),
  attentionLevel: z
    .number()
    .int()
    .min(1)
    .max(10)
    .describe("读者注意度：1 最容易被读者发现，10 最难发现"),
  recoveryStatus: foreshadowRecoveryStatusSchema
    .default("unrecovered")
    .describe("回收状态：未回收（缺省）/ 部分回收 / 已回收"),
  plantingMethod: z
    .string()
    .min(1)
    .optional()
    .describe("埋线方式：如对话、一个物件描述、托梦"),
  purpose: z.string().min(1).optional().describe("创作目的：如某一重大事件的引子"),
  appearChapterId: z
    .string()
    .min(1)
    .optional()
    .describe("出现的章节 ID（暂定大纲章节，写作期落地后补约束）"),
  recoverChapterIds: z
    .array(z.string().min(1))
    .min(1)
    .optional()
    .describe("回收的章节 ID，多个即多步回收"),
  characterIds: z
    .array(z.string().min(1))
    .min(1)
    .optional()
    .describe("服务的角色 ID，如暗示某两个角色的结局"),
});

export type Foreshadow = z.infer<typeof foreshadowSchema>;

/** patch 语义对齐 outline-node 先例：undefined=不动 / null=清空 / 值=覆盖；
 * 必填三字段（表面行为/隐藏真相/注意度）与回收状态仅可覆盖不可清空 */
export const foreshadowPatchSchema = z.object({
  surfaceAction: z.string().min(1).optional(),
  hiddenTruth: z.string().min(1).optional(),
  attentionLevel: z.number().int().min(1).max(10).optional(),
  recoveryStatus: foreshadowRecoveryStatusSchema.optional(),
  plantingMethod: z.string().min(1).nullable().optional(),
  purpose: z.string().min(1).nullable().optional(),
  appearChapterId: z.string().min(1).nullable().optional(),
  recoverChapterIds: z.array(z.string().min(1)).min(1).nullable().optional(),
  characterIds: z.array(z.string().min(1)).min(1).nullable().optional(),
});

export type ForeshadowPatch = z.infer<typeof foreshadowPatchSchema>;

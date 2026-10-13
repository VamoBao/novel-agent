import { z } from "zod";
import { characterSchema } from "./character";
import { chapterPlanSchema } from "./chapter";
import { coreConflictSchema } from "./conflict";
import {
  chapterNewForeshadowSchema,
  foreshadowBindingSchema,
  outlineNewForeshadowSchema,
} from "./foreshadow";
import { newCharacterSchema, outlineSchema } from "./outline";
import { newLocationSchema } from "./location";
import { worldviewSchema } from "./worldview";

/**
 * 结构化展示/确认视图：agent 侧组装、UI 侧渲染共用同一份 schema，
 * 杜绝两侧结构漂移。
 * - field-summary / character-card / outline(confirm) / chapter-plan：确认门视图，与提问原子绑定
 * - worldview / conflict / outline(full)：阶段性成果的独立展示
 */
export const fieldSummaryViewSchema = z.object({
  kind: z.literal("field-summary"),
  label: z.string().describe("字段标签（如「姓名」）"),
  summary: z.string().describe("该字段的概括总结"),
});

export const characterCardViewSchema = z.object({
  kind: z.literal("character-card"),
  character: characterSchema,
});

export const outlineViewSchema = z.object({
  kind: z.literal("outline"),
  /** confirm = 确认门简览（部/幕名称与概述）；full = 含关键情节点的全量展示 */
  detail: z.enum(["confirm", "full"]),
  outline: outlineSchema,
  /** 确认门携带的「新增角色清单」（名字+一句话定位）；full 展示与旧消息不带 */
  newCharacters: z.array(newCharacterSchema).optional(),
  /** 确认门携带的伏笔清单；旧消息不带 */
  newForeshadows: z.array(outlineNewForeshadowSchema).optional(),
  /** 确认门携带的新增地点清单（名字+一句话定位）；旧消息不带 */
  newLocations: z.array(newLocationSchema).optional(),
});

export const worldviewViewSchema = z.object({
  kind: z.literal("worldview"),
  worldview: worldviewSchema,
});

/** 章节规划确认门：自包含（幕信息 + 规划全文），UI 渲染不依赖外部上下文 */
export const chapterPlanViewSchema = z.object({
  kind: z.literal("chapter-plan"),
  actName: z.string().describe("幕名（规划的拆解对象）"),
  actSummary: z.string().describe("幕梗概"),
  keyPlotPoints: z.array(z.string()).describe("幕关键情节点"),
  plan: chapterPlanSchema.describe("推荐的本幕章节规划（含逐章登场角色清单）"),
  /** 确认门携带的「新增角色清单」（名字+一句话定位）——由逐章登场清单对角色库派生（未在库中的名字）；旧消息不带 */
  newCharacters: z.array(newCharacterSchema).optional(),
  /** 确认门携带的伏笔清单；旧消息不带 */
  newForeshadows: z.array(chapterNewForeshadowSchema).optional(),
  /** 确认门携带的伏笔绑定指令（既有伏笔→登场章）；旧消息不带 */
  foreshadowBindings: z.array(foreshadowBindingSchema).optional(),
  /** 确认门携带的伏笔回收绑定指令（既有伏笔→回收章，同 index 多条 = 多步回收）；旧消息不带 */
  foreshadowRecoverBindings: z.array(foreshadowBindingSchema).optional(),
  /** 确认门携带的新增地点清单（名字+一句话定位）；旧消息不带 */
  newLocations: z.array(newLocationSchema).optional(),
});

export const conflictViewSchema = z.object({
  kind: z.literal("conflict"),
  conflict: coreConflictSchema,
});

export const viewSchema = z.discriminatedUnion("kind", [
  fieldSummaryViewSchema,
  characterCardViewSchema,
  outlineViewSchema,
  worldviewViewSchema,
  chapterPlanViewSchema,
  conflictViewSchema,
]);

export type FieldSummaryView = z.infer<typeof fieldSummaryViewSchema>;
export type CharacterCardView = z.infer<typeof characterCardViewSchema>;
export type OutlineView = z.infer<typeof outlineViewSchema>;
export type WorldviewView = z.infer<typeof worldviewViewSchema>;
export type ChapterPlanView = z.infer<typeof chapterPlanViewSchema>;
export type ConflictView = z.infer<typeof conflictViewSchema>;
export type View = z.infer<typeof viewSchema>;

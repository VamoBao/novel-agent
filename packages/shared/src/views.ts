import { z } from "zod";
import { characterSchema } from "./character";
import { coreConflictSchema } from "./conflict";
import { outlineSchema } from "./outline";
import { worldviewSchema } from "./worldview";

/**
 * 结构化展示/确认视图：agent 侧组装、UI 侧渲染共用同一份 schema，
 * 杜绝两侧结构漂移。
 * - field-summary / character-card / outline(confirm)：确认门视图，与提问原子绑定
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
});

export const worldviewViewSchema = z.object({
  kind: z.literal("worldview"),
  worldview: worldviewSchema,
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
  conflictViewSchema,
]);

export type FieldSummaryView = z.infer<typeof fieldSummaryViewSchema>;
export type CharacterCardView = z.infer<typeof characterCardViewSchema>;
export type OutlineView = z.infer<typeof outlineViewSchema>;
export type WorldviewView = z.infer<typeof worldviewViewSchema>;
export type ConflictView = z.infer<typeof conflictViewSchema>;
export type View = z.infer<typeof viewSchema>;

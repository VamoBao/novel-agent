import { z } from "zod";

/**
 * 章节正文校验报告 schema：write-chapter 校验-修订闭环（chapter-review.ts 三段校验）
 * 的结构化产出，随 write-progress 协议消息透传客户端展示（仅会话内传递，不入库落盘）。
 *
 * 三段校验各自独立单轮 LLM 调用（上下文互不继承），结果合并为一份报告：
 * - content 内容约束：正文与世界观 / 章节概述 / 本章伏笔的符合性（issue 列表）
 * - style 文风对比：正文与启用参考文风的相似度评分（0-100，≥90 合格；无启用文风 skipped）
 * - consistency 前后自洽：正文内部的描述矛盾（issue 列表）
 */

/**
 * 问题类别：worldview 违背世界观 / foreshadow 伏笔未体现或误点破 / summary 偏离章节概述 /
 * character 角色变化未按迁移计划（过早改变、缺少过渡、未保留应保留特征）/ consistency 前后矛盾
 */
export const reviewIssueKindSchema = z.enum([
  "worldview",
  "foreshadow",
  "summary",
  "character",
  "consistency",
]);
export type ReviewIssueKind = z.infer<typeof reviewIssueKindSchema>;

/** 单条问题：描述（引用正文依据）+ 改进建议 */
export const reviewIssueSchema = z.object({
  kind: reviewIssueKindSchema,
  description: z.string().min(1).describe("问题描述，引用正文依据"),
  suggestion: z.string().min(1).describe("改进建议"),
});
export type ReviewIssue = z.infer<typeof reviewIssueSchema>;

/**
 * 文风段结果：无启用文风时整段跳过（skipped: true，不发 LLM 调用，与生成侧
 * 「零注入」对称）；有文风时输出相似度评分（0-100 整数，≥90 合格）+ 评分依据
 * + 改进建议（达标可为空数组）。
 */
export const styleReviewSchema = z.discriminatedUnion("skipped", [
  z.object({ skipped: z.literal(true) }),
  z.object({
    skipped: z.literal(false),
    score: z.number().int().min(0).max(100).describe("与参考文风的相似度评分（0-100）"),
    rationale: z.string().describe("评分依据"),
    suggestions: z.array(z.string()).describe("未达标时的具体改进建议，达标可为空"),
  }),
]);
export type StyleReview = z.infer<typeof styleReviewSchema>;

/** 整改报告：round 为产生该报告的生成轮次（1 起始）；passed 由编排层按判定规则回填（LLM 不自评） */
export const reviewReportSchema = z.object({
  round: z.number().int().min(1),
  passed: z.boolean(),
  content: z.object({ issues: z.array(reviewIssueSchema) }),
  style: styleReviewSchema,
  consistency: z.object({ issues: z.array(reviewIssueSchema) }),
});
export type ReviewReport = z.infer<typeof reviewReportSchema>;

/** 单项校验结束即回传的结果；完整报告仍在修订 / 保存阶段回传。 */
export const reviewStageResultSchema = z.discriminatedUnion("phase", [
  z.object({ phase: z.literal("review-content"), result: reviewReportSchema.shape.content }),
  z.object({ phase: z.literal("review-style"), result: styleReviewSchema }),
  z.object({ phase: z.literal("review-consistency"), result: reviewReportSchema.shape.consistency }),
]);
export type ReviewStageResult = z.infer<typeof reviewStageResultSchema>;

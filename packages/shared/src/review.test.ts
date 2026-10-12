import { describe, expect, test } from "bun:test";
import {
  reviewIssueKindSchema,
  reviewIssueSchema,
  styleReviewSchema,
  reviewReportSchema,
} from "./review";

/** 合法报告样例（content 2 issue / style 评分 / consistency 1 issue） */
const fullReport = {
  round: 2,
  passed: false,
  content: {
    issues: [
      {
        kind: "worldview",
        description: "正文出现修士乘高铁情节，违背低魔古代世界观",
        suggestion: "改为御剑或马车赶路",
      },
      { kind: "summary", description: "概述中林恒未与长老冲突，正文凭空增加", suggestion: "删除该冲突场景" },
    ],
  },
  style: { skipped: false, score: 82, rationale: "句式偏短促，样本为绵长抒情", suggestions: ["增加环境描写比例"] },
  consistency: {
    issues: [{ kind: "consistency", description: "前文说「五个字」，后文说「四个字」", suggestion: "统一为五个字" }],
  },
};

describe("review schemas", () => {
  test("完整报告 parse 通过", () => {
    const parsed = reviewReportSchema.parse(fullReport);
    expect(parsed.round).toBe(2);
    expect(parsed.content.issues).toHaveLength(2);
    expect(parsed.style).toMatchObject({ score: 82 });
    expect(parsed.consistency.issues).toHaveLength(1);
  });

  test("style skipped 形态 parse 通过（无 score 等字段）", () => {
    const report = { ...fullReport, style: { skipped: true } };
    expect(reviewReportSchema.parse(report).style).toEqual({ skipped: true });
  });

  test("通过形态（全绿 + skipped）parse 通过", () => {
    const report = {
      round: 1,
      passed: true,
      content: { issues: [] },
      style: { skipped: true },
      consistency: { issues: [] },
    };
    expect(reviewReportSchema.parse(report).passed).toBe(true);
  });

  test("issue description / suggestion 空串拒绝", () => {
    const bad = {
      ...fullReport,
      content: { issues: [{ kind: "summary", description: "", suggestion: "改" }] },
    };
    expect(reviewReportSchema.safeParse(bad).success).toBe(false);
    const badSuggestion = {
      ...fullReport,
      consistency: { issues: [{ kind: "consistency", description: "矛盾", suggestion: "" }] },
    };
    expect(reviewReportSchema.safeParse(badSuggestion).success).toBe(false);
  });

  test("style score 越界与非整数拒绝", () => {
    expect(styleReviewSchema.safeParse({ skipped: false, score: -1, rationale: "x", suggestions: [] }).success).toBe(false);
    expect(styleReviewSchema.safeParse({ skipped: false, score: 101, rationale: "x", suggestions: [] }).success).toBe(false);
    expect(styleReviewSchema.safeParse({ skipped: false, score: 8.5, rationale: "x", suggestions: [] }).success).toBe(false);
    expect(styleReviewSchema.safeParse({ skipped: false, score: 90, rationale: "x", suggestions: [] }).success).toBe(true);
    // skipped=false 时 score 必填
    expect(styleReviewSchema.safeParse({ skipped: false, rationale: "x", suggestions: [] }).success).toBe(false);
  });

  test("issue kind 非法枚举拒绝", () => {
    expect(reviewIssueKindSchema.safeParse("style").success).toBe(false);
    expect(reviewIssueKindSchema.parse("foreshadow")).toBe("foreshadow");
    const bad = {
      ...fullReport,
      content: { issues: [{ kind: "style", description: "x", suggestion: "y" }] },
    };
    expect(reviewReportSchema.safeParse(bad).success).toBe(false);
  });

  test("必填字段缺失拒绝（round / passed / 三段）", () => {
    expect(reviewReportSchema.safeParse({ ...fullReport, round: 0 }).success).toBe(false);
    expect(reviewReportSchema.safeParse({ ...fullReport, passed: undefined }).success).toBe(false);
    expect(reviewReportSchema.safeParse({ ...fullReport, content: undefined }).success).toBe(false);
    expect(reviewReportSchema.safeParse({ ...fullReport, style: undefined }).success).toBe(false);
    expect(reviewReportSchema.safeParse({ ...fullReport, consistency: undefined }).success).toBe(false);
    expect(reviewIssueSchema.safeParse({ kind: "summary", description: "x" }).success).toBe(false);
  });
});

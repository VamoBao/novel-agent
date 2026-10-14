import { describe, expect, test } from "bun:test";
import {
  CHAPTER_LENGTH_BOUND_MAX,
  CHAPTER_LENGTH_BOUND_MIN,
  DEFAULT_CHAPTER_LENGTH_MAX,
  DEFAULT_CHAPTER_LENGTH_MIN,
  DEFAULT_STYLE_PASS_SCORE,
  novelWritingPrefsSchema,
  resolveChapterLength,
  resolveStylePassScore,
  type WritingPrefsOverride,
} from "./writing-prefs";

describe("novelWritingPrefsSchema", () => {
  test("全空（清空覆盖）与完整设置均合法", () => {
    expect(novelWritingPrefsSchema.parse({ chapterLengthMin: null, chapterLengthMax: null, stylePassScore: null })).toEqual({
      chapterLengthMin: null,
      chapterLengthMax: null,
      stylePassScore: null,
    });
    expect(
      novelWritingPrefsSchema.parse({ chapterLengthMin: 3000, chapterLengthMax: 4500, stylePassScore: 85 }),
    ).toEqual({ chapterLengthMin: 3000, chapterLengthMax: 4500, stylePassScore: 85 });
  });

  test("篇幅只设一半拒绝；min > max 拒绝；阈值与篇幅互相独立", () => {
    expect(() =>
      novelWritingPrefsSchema.parse({ chapterLengthMin: 3000, chapterLengthMax: null, stylePassScore: null }),
    ).toThrow("同时");
    expect(() =>
      novelWritingPrefsSchema.parse({ chapterLengthMin: 5000, chapterLengthMax: 4000, stylePassScore: null }),
    ).toThrow("不能大于");
    // 只设阈值（篇幅整体留空）合法
    expect(
      novelWritingPrefsSchema.parse({ chapterLengthMin: null, chapterLengthMax: null, stylePassScore: 95 }),
    ).toMatchObject({ stylePassScore: 95 });
  });

  test("边界值与越界值校验", () => {
    expect(() =>
      novelWritingPrefsSchema.parse({
        chapterLengthMin: CHAPTER_LENGTH_BOUND_MIN - 1,
        chapterLengthMax: 3000,
        stylePassScore: null,
      }),
    ).toThrow();
    expect(() =>
      novelWritingPrefsSchema.parse({
        chapterLengthMin: 2000,
        chapterLengthMax: CHAPTER_LENGTH_BOUND_MAX + 1,
        stylePassScore: null,
      }),
    ).toThrow();
    expect(() =>
      novelWritingPrefsSchema.parse({ chapterLengthMin: null, chapterLengthMax: null, stylePassScore: 101 }),
    ).toThrow();
    expect(
      novelWritingPrefsSchema.parse({ chapterLengthMin: null, chapterLengthMax: null, stylePassScore: 0 }),
    ).toMatchObject({ stylePassScore: 0 });
  });
});

describe("resolveChapterLength", () => {
  const level = (min: number | null, max: number | null): WritingPrefsOverride => ({
    chapterLengthMin: min,
    chapterLengthMax: max,
    stylePassScore: null,
  });

  test("小说级优先于系统级，系统级优先于内置默认", () => {
    expect(resolveChapterLength(level(3000, 4500), level(1500, 2500))).toEqual({ min: 3000, max: 4500 });
    expect(resolveChapterLength(null, level(1500, 2500))).toEqual({ min: 1500, max: 2500 });
    expect(resolveChapterLength(null, null)).toEqual({
      min: DEFAULT_CHAPTER_LENGTH_MIN,
      max: DEFAULT_CHAPTER_LENGTH_MAX,
    });
    expect(resolveChapterLength()).toEqual({ min: DEFAULT_CHAPTER_LENGTH_MIN, max: DEFAULT_CHAPTER_LENGTH_MAX });
  });

  test("半设或乱序的层防御性跳过，整体回落下一级（不拼接两层的端点）", () => {
    expect(resolveChapterLength(level(3000, null), level(1500, 2500))).toEqual({ min: 1500, max: 2500 });
    expect(resolveChapterLength(level(5000, 4000), level(1500, 2500))).toEqual({ min: 1500, max: 2500 });
    // 系统级也半设 → 内置默认
    expect(resolveChapterLength(level(3000, null), level(1500, null))).toEqual({
      min: DEFAULT_CHAPTER_LENGTH_MIN,
      max: DEFAULT_CHAPTER_LENGTH_MAX,
    });
  });
});

describe("resolveStylePassScore", () => {
  const level = (score: number | null): WritingPrefsOverride => ({
    chapterLengthMin: null,
    chapterLengthMax: null,
    stylePassScore: score,
  });

  test("逐层取第一个非空，兜底内置默认 80", () => {
    expect(resolveStylePassScore(level(95), level(70))).toBe(95);
    expect(resolveStylePassScore(null, level(70))).toBe(70);
    expect(resolveStylePassScore(null, null)).toBe(DEFAULT_STYLE_PASS_SCORE);
    expect(resolveStylePassScore()).toBe(DEFAULT_STYLE_PASS_SCORE);
  });

  test("越界值防御性跳过（手改库形态），不中断解析", () => {
    expect(resolveStylePassScore(level(150), level(70))).toBe(70);
    expect(resolveStylePassScore(level(-1), null)).toBe(DEFAULT_STYLE_PASS_SCORE);
  });
});

import { describe, expect, test } from "bun:test";
import {
  CHAPTER_LENGTH_MAX_ENV,
  CHAPTER_LENGTH_MIN_ENV,
  STYLE_PASS_SCORE_ENV,
  resolveSystemWritingPrefs,
} from "./writing-prefs";

/** 系统级写作偏好环境变量读取：合法解析、缺省 null、非法值静默回落（不中断） */
describe("resolveSystemWritingPrefs", () => {
  test("三个变量合法时全部解析", () => {
    const prefs = resolveSystemWritingPrefs({
      [CHAPTER_LENGTH_MIN_ENV]: " 3000 ",
      [CHAPTER_LENGTH_MAX_ENV]: "4500",
      [STYLE_PASS_SCORE_ENV]: "85",
    });
    expect(prefs).toEqual({ chapterLengthMin: 3000, chapterLengthMax: 4500, stylePassScore: 85 });
  });

  test("缺省 / 空白 → null（该级未覆盖）", () => {
    expect(resolveSystemWritingPrefs({})).toEqual({
      chapterLengthMin: null,
      chapterLengthMax: null,
      stylePassScore: null,
    });
    expect(resolveSystemWritingPrefs({ [CHAPTER_LENGTH_MIN_ENV]: "  " })).toMatchObject({
      chapterLengthMin: null,
    });
  });

  test("非整数 / 越界 / 小数 → null（手改环境容错，不抛错）", () => {
    const env = {
      [CHAPTER_LENGTH_MIN_ENV]: "abc",
      [CHAPTER_LENGTH_MAX_ENV]: "100001",
      [STYLE_PASS_SCORE_ENV]: "3.5",
    };
    expect(resolveSystemWritingPrefs(env)).toEqual({
      chapterLengthMin: null,
      chapterLengthMax: null,
      stylePassScore: null,
    });
    expect(
      resolveSystemWritingPrefs({ [STYLE_PASS_SCORE_ENV]: "101" }).stylePassScore,
    ).toBeNull();
  });
});

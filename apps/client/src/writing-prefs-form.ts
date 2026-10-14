import {
  CHAPTER_LENGTH_BOUND_MAX,
  CHAPTER_LENGTH_BOUND_MIN,
  type NovelWritingPrefs,
} from "@novel/shared";

/** 写作偏好三字段表单（设置弹窗系统级默认与书库「写作偏好」小说级覆盖共用） */
export interface WritingPrefsFormValues {
  chapterLengthMin: string;
  chapterLengthMax: string;
  stylePassScore: string;
}

export const EMPTY_WRITING_PREFS_FORM: WritingPrefsFormValues = {
  chapterLengthMin: "",
  chapterLengthMax: "",
  stylePassScore: "",
};

/** 单字段：空串 = null（未设置）；非空但非整数或越界 = 非法 */
function parsePrefValue(value: string, min: number, max: number): number | null | "invalid" {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (!/^\d+$/.test(trimmed)) return "invalid";
  const parsed = Number.parseInt(trimmed, 10);
  if (parsed < min || parsed > max) return "invalid";
  return parsed;
}

/**
 * 表单字符串 → 提交载荷：整数边界（篇幅 100~100000 字、合格线 0-100）、篇幅
 * 成对填写且下限 ≤ 上限。返回 { ok: false } 时不可提交（error 文案可直接展示）。
 */
export function parseWritingPrefsForm(
  values: WritingPrefsFormValues,
): { ok: true; prefs: NovelWritingPrefs } | { ok: false; error: string } {
  const chapterLengthMin = parsePrefValue(values.chapterLengthMin, CHAPTER_LENGTH_BOUND_MIN, CHAPTER_LENGTH_BOUND_MAX);
  const chapterLengthMax = parsePrefValue(values.chapterLengthMax, CHAPTER_LENGTH_BOUND_MIN, CHAPTER_LENGTH_BOUND_MAX);
  const stylePassScore = parsePrefValue(values.stylePassScore, 0, 100);
  if (chapterLengthMin === "invalid" || chapterLengthMax === "invalid" || stylePassScore === "invalid") {
    return {
      ok: false,
      error: `写作偏好须为整数：篇幅 ${CHAPTER_LENGTH_BOUND_MIN}~${CHAPTER_LENGTH_BOUND_MAX} 字，文风合格线 0~100 分`,
    };
  }
  if (chapterLengthMin !== null && chapterLengthMax !== null && chapterLengthMin > chapterLengthMax) {
    return { ok: false, error: "篇幅下限不能大于上限" };
  }
  if ((chapterLengthMin === null) !== (chapterLengthMax === null)) {
    return { ok: false, error: "篇幅下限与上限须同时填写或同时留空" };
  }
  return { ok: true, prefs: { chapterLengthMin, chapterLengthMax, stylePassScore } };
}

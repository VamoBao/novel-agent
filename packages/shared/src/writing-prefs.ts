import { z } from "zod";

/**
 * 写作偏好（章节篇幅范围 + 文风相似度合格线）的两级配置契约：
 * 小说级（novels 表三可空列）> 系统级（客户端 settings.json，经
 * NOVEL_CHAPTER_LENGTH_MIN / NOVEL_CHAPTER_LENGTH_MAX / NOVEL_STYLE_PASS_SCORE
 * 环境变量注入 agent 子进程）> 内置默认（2000~3000 字 / 80 分）。
 *
 * 篇幅 min/max 视为**一个整体**覆盖：某级只有一半（手改库 / 手改配置）或
 * min > max 时该级视为未设置，整体回落下一级——不把两级的端点拼成一个
 * 混合范围；文风合格线独立覆盖，互不牵连。
 */

/** 篇幅单边界值允许范围（字）：过小无意义，过大超出单章常识 */
export const CHAPTER_LENGTH_BOUND_MIN = 100;
export const CHAPTER_LENGTH_BOUND_MAX = 100000;

/** 内置默认：两级配置均未设置时的兜底（篇幅默认沿用历史值；合格线按需求定为 80，替代历史硬编码 90） */
export const DEFAULT_CHAPTER_LENGTH_MIN = 2000;
export const DEFAULT_CHAPTER_LENGTH_MAX = 3000;
export const DEFAULT_STYLE_PASS_SCORE = 80;

export const chapterLengthBoundSchema = z
  .number()
  .int()
  .min(CHAPTER_LENGTH_BOUND_MIN)
  .max(CHAPTER_LENGTH_BOUND_MAX)
  .describe(`章节篇幅边界值（字，${CHAPTER_LENGTH_BOUND_MIN}~${CHAPTER_LENGTH_BOUND_MAX} 的整数）`);
export type ChapterLengthBound = z.infer<typeof chapterLengthBoundSchema>;

export const stylePassScoreSchema = z
  .number()
  .int()
  .min(0)
  .max(100)
  .describe("文风相似度合格线（0-100 整数）");
export type StylePassScore = z.infer<typeof stylePassScoreSchema>;

/** 一级配置的形态（系统设置 / 小说行 / 环境变量解析结果共用）：null = 该项未设置 */
export interface WritingPrefsOverride {
  chapterLengthMin: number | null;
  chapterLengthMax: number | null;
  stylePassScore: number | null;
}

/**
 * 小说写作偏好的全量提交契约（客户端表单 → query CLI set-writing-prefs）：
 * 三项均可空（null = 清空该小说级覆盖，回落系统设置）；篇幅 min/max 须
 * 同时设置或同时留空，且 min ≤ max（表单与服务端同一条规则，双保险）。
 */
export const novelWritingPrefsSchema = z
  .object({
    chapterLengthMin: chapterLengthBoundSchema.nullable(),
    chapterLengthMax: chapterLengthBoundSchema.nullable(),
    stylePassScore: stylePassScoreSchema.nullable(),
  })
  .refine(
    (prefs) => (prefs.chapterLengthMin === null) === (prefs.chapterLengthMax === null),
    { message: "篇幅下限与上限须同时设置或同时留空" },
  )
  .refine(
    (prefs) =>
      prefs.chapterLengthMin === null ||
      (prefs.chapterLengthMax !== null && prefs.chapterLengthMin <= prefs.chapterLengthMax),
    { message: "篇幅下限不能大于上限" },
  );
export type NovelWritingPrefs = z.infer<typeof novelWritingPrefsSchema>;

/** 生效篇幅 */
export interface ChapterLength {
  min: number;
  max: number;
}

function providesLength(override: WritingPrefsOverride): boolean {
  return (
    override.chapterLengthMin !== null &&
    override.chapterLengthMax !== null &&
    override.chapterLengthMin <= override.chapterLengthMax
  );
}

/**
 * 解析生效篇幅：按参数顺序（优先级高 → 低）取第一组「同设且 min ≤ max」的
 * 覆盖；全部未提供（含半设 / 乱序的防御性跳过）回落内置默认 2000~3000。
 */
export function resolveChapterLength(
  ...levels: Array<WritingPrefsOverride | null | undefined>
): ChapterLength {
  for (const level of levels) {
    if (level && providesLength(level)) {
      return { min: level.chapterLengthMin!, max: level.chapterLengthMax! };
    }
  }
  return { min: DEFAULT_CHAPTER_LENGTH_MIN, max: DEFAULT_CHAPTER_LENGTH_MAX };
}

/**
 * 解析生效文风合格线：按参数顺序取第一个非 null 且合法（0-100 整数）的
 * 覆盖；全部未提供或非法回落内置默认 80。与篇幅互相独立。
 */
export function resolveStylePassScore(
  ...levels: Array<WritingPrefsOverride | null | undefined>
): number {
  for (const level of levels) {
    if (level && level.stylePassScore !== null && stylePassScoreSchema.safeParse(level.stylePassScore).success) {
      return level.stylePassScore;
    }
  }
  return DEFAULT_STYLE_PASS_SCORE;
}

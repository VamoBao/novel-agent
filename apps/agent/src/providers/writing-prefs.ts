import {
  chapterLengthBoundSchema,
  stylePassScoreSchema,
  type WritingPrefsOverride,
} from "@novel/shared";

/**
 * 系统级写作偏好（章节篇幅范围 + 文风合格线）的环境变量读取：
 * 客户端设置弹窗维护 userData/settings.json 的 writing 组，main 侧 childEnv 经
 * 三级优先级（设置 > .env > 继承环境变量）注入以下变量；协议宿主 / CLI 也可
 * 直接设置。未设置或值非法（非整数 / 越界）的项视为 null——该级未覆盖，
 * 与小说级（novels 表三列）共同交给 shared 的 resolveChapterLength /
 * resolveStylePassScore 按「小说级 > 系统级 > 内置默认」解析，非法值静默
 * 回落（与 settings.json normalize 的容错语义一致，不中断会话）。
 */

export const CHAPTER_LENGTH_MIN_ENV = "NOVEL_CHAPTER_LENGTH_MIN";
export const CHAPTER_LENGTH_MAX_ENV = "NOVEL_CHAPTER_LENGTH_MAX";
export const STYLE_PASS_SCORE_ENV = "NOVEL_STYLE_PASS_SCORE";

/** 单值读取：trim 后解析整数并过边界 schema，非法归 null */
function readInt(
  env: Readonly<Record<string, string | undefined>>,
  key: string,
  bounds: typeof chapterLengthBoundSchema | typeof stylePassScoreSchema,
): number | null {
  const raw = env[key]?.trim();
  if (!raw) return null;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || String(value) !== raw) return null;
  return bounds.safeParse(value).success ? value : null;
}

/** 读取系统级写作偏好（缺省 process.env；测试注入替身环境） */
export function resolveSystemWritingPrefs(
  env: Readonly<Record<string, string | undefined>> = process.env,
): WritingPrefsOverride {
  return {
    chapterLengthMin: readInt(env, CHAPTER_LENGTH_MIN_ENV, chapterLengthBoundSchema),
    chapterLengthMax: readInt(env, CHAPTER_LENGTH_MAX_ENV, chapterLengthBoundSchema),
    stylePassScore: readInt(env, STYLE_PASS_SCORE_ENV, stylePassScoreSchema),
  };
}

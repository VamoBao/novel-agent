import { readFileSync } from "node:fs";
import { outlineSchema, type Outline } from "@novel/shared";

/** 大纲输出目录（默认项目根相对路径；协议模式下由宿主进程经 NOVEL_OUTPUT_DIR 传绝对路径） */
export const OUTPUT_DIR = process.env.NOVEL_OUTPUT_DIR ?? "output";

/** id 仅允许作为文件名的安全字符（本项目生成的 UUID 天然满足） */
const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

export function outlineFilePath(id: string, dir: string = OUTPUT_DIR): string {
  if (!SAFE_ID.test(id)) {
    throw new Error(`非法的小说创作 ID，无法用作文件名：${id}`);
  }
  return `${dir}/${id}.json`;
}

/**
 * 将大纲以创作 ID 为文件名保存到输出目录（JSON，便于后续重新加载进 state）。
 * 返回写入的文件路径。
 */
export async function saveOutline(
  id: string,
  outline: Outline,
  dir: string = OUTPUT_DIR,
): Promise<string> {
  const path = outlineFilePath(id, dir);
  await Bun.write(path, `${JSON.stringify(outline, null, 2)}\n`);
  return path;
}

/**
 * 尽力读取大纲产物中的主题（theme）：供单幕章节规划补充上下文。
 * 产物缺失 / 损坏 / 不合 schema 一律返回 undefined，不阻断调用方——
 * theme 本就是规划输入的可选项。
 */
export function readOutlineTheme(id: string, dir: string = OUTPUT_DIR): string | undefined {
  try {
    const parsed = outlineSchema.safeParse(JSON.parse(readFileSync(outlineFilePath(id, dir), "utf8")));
    return parsed.success ? parsed.data.theme : undefined;
  } catch {
    return undefined;
  }
}

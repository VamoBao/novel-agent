import type { Outline } from "@novel/shared";

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

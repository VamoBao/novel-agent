/** 大纲输出目录与残留产物清理。大纲 JSON 产物（output/<id>.json）已随大纲入库退役，
 *  不再写入；outlineFilePath 仅供删除小说时清理历史版本的残留 JSON。 */
export const OUTPUT_DIR = process.env.NOVEL_OUTPUT_DIR ?? "output";

/** id 仅允许作为文件名的安全字符（本项目生成的 UUID 天然满足） */
const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

/** 历史大纲 JSON 产物的路径（output/<id>.json）；残留清理用 */
export function outlineFilePath(id: string, dir: string = OUTPUT_DIR): string {
  if (!SAFE_ID.test(id)) {
    throw new Error(`非法的小说创作 ID，无法用作文件名：${id}`);
  }
  return `${dir}/${id}.json`;
}

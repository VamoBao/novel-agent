import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { OUTPUT_DIR } from "./outline-writer";

/**
 * 章节正文产物落盘：内容存文件系统（SQLite 只留 file_path 元数据与章节点
 * document_id 绑定），按「小说ID/部名/章名.md」层级组织——顶层文件夹用小说
 * 创作 ID（与改名无关），人类可直接在文件管理器中阅读编辑；输出根由
 * NOVEL_OUTPUT_DIR 指定（协议模式下宿主进程传绝对路径）。
 * file_path 库内语义为绝对路径（换输出目录后旧正文仍指向真实位置）；
 * 历史/未迁移的相对行由 resolveArtifactPath 兼容解析。
 */

/** 路径段清理：文件系统非法字符归一为空格、压缩空白、去尾部点/空格（Windows）、
 *  超长截断 80 字符、空名回退 fallback（名称缺失的兜底） */
export function sanitizePathSegment(name: string, fallback: string): string {
  const cleaned = name
    // 文件名安全清理须覆盖控制字符，豁免 no-control-regex 检查
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.\s]+$/, "");
  return cleaned.length > 0 ? cleaned.slice(0, 80) : fallback;
}

/** 层级路径输入：小说创作 ID（顶层文件夹名，UUID 天然文件名安全）/ 所属部名 / 章名（部与章名来自 outlines 树） */
export interface ChapterDocumentPathInput {
  novelId: string;
  partName: string;
  chapterName: string;
}

/**
 * 构造本章正文的相对路径（含冲突规避）：`<创作ID>/<部名>/<章名>.md`。
 * 顶层文件夹即小说 ID——同名小说天然分属不同文件夹、改名零文件联动；
 * 目标文件已存在（同名章的历史正文——大纲重生成后新树复用章名、或残留孤儿
 * 文件）时追加 `-2`、`-3` … 后缀，绝不覆盖既有文件。
 */
export function buildChapterDocumentPath(
  input: ChapterDocumentPathInput,
  dir: string = OUTPUT_DIR,
): string {
  const part = sanitizePathSegment(input.partName, "未分部");
  const chapter = sanitizePathSegment(input.chapterName, "未命名章节");
  const relative = (name: string): string => join(input.novelId, part, `${name}.md`);
  if (!existsSync(join(dir, relative(chapter)))) {
    return relative(chapter);
  }
  for (let n = 2; n < 100; n++) {
    const candidate = relative(`${chapter}-${n}`);
    if (!existsSync(join(dir, candidate))) return candidate;
  }
  // 现实中不可达的兜底：时间戳保证唯一
  return relative(`${chapter}-${Date.now()}`);
}

/** file_path 库内值 → 实际文件路径：绝对路径原样（现行写入语义），相对路径
 *  （历史行 / 未迁移库）以 output 根解析——两类数据共存期间读取零丢失 */
export function resolveArtifactPath(filePath: string, dir: string = OUTPUT_DIR): string {
  return isAbsolute(filePath) ? filePath : join(dir, filePath);
}

/** 写入正文文件（自动建目录）；返回写入的相对路径 */
export function writeDocumentArtifact(
  relativePath: string,
  content: string,
  dir: string = OUTPUT_DIR,
): string {
  const target = join(dir, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  return relativePath;
}

/** 读取正文文件；缺失 / 被移动返回 null（查询层转占位提示，不抛错） */
export function readDocumentArtifact(filePath: string, dir: string = OUTPUT_DIR): string | null {
  try {
    return readFileSync(resolveArtifactPath(filePath, dir), "utf8");
  } catch {
    return null;
  }
}

/** 删除正文文件（整本删除联动）；不存在时静默（幂等） */
export function removeDocumentArtifact(filePath: string, dir: string = OUTPUT_DIR): void {
  rmSync(resolveArtifactPath(filePath, dir), { force: true });
}

/** 正文字数：不含任何空白字符（中文正文以汉字计的近似口径） */
export function countWords(content: string): number {
  return content.replace(/\s+/g, "").length;
}

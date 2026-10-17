import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildChapterDocumentPath,
  countWords,
  readDocumentArtifact,
  removeDocumentArtifact,
  resolveArtifactPath,
  sanitizePathSegment,
  writeDocumentArtifact,
} from "./document-writer";

/**
 * document-writer 单元测试：路径段清理、层级路径构造（顶层即小说 ID、
 * 冲突 -N 后缀）、file_path 绝对/相对兼容解析与写读往返。
 */

describe("sanitizePathSegment", () => {
  test("文件系统非法字符归一为空格、压缩空白、去尾部点与空格", () => {
    expect(sanitizePathSegment('第一/部:风*起?"<>|', "回退")).toBe("第一 部 风 起");
    expect(sanitizePathSegment("  多  个 空白  ", "回退")).toBe("多 个 空白");
    expect(sanitizePathSegment("尾部点与空格.  ", "回退")).toBe("尾部点与空格");
  });

  test("空名 / 纯非法字符回退 fallback；超长截断 80 字符", () => {
    expect(sanitizePathSegment("", "回退名")).toBe("回退名");
    expect(sanitizePathSegment("///???", "回退名")).toBe("回退名");
    expect(sanitizePathSegment("很".repeat(100), "回退名")).toHaveLength(80);
  });
});

describe("buildChapterDocumentPath", () => {
  const tempDirs: string[] = [];
  afterAll(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  test("层级为 <小说ID>/部名/章名.md——顶层文件夹即创作 ID，同名小说天然分属不同文件夹", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-docwriter-"));
    tempDirs.push(dir);
    const base = { partName: "第一部", chapterName: "第一章" };
    const a = buildChapterDocumentPath(
      { ...base, novelId: "aaaaaaaa-0000-7000-8000-000000000001" },
      dir,
    );
    const b = buildChapterDocumentPath(
      { ...base, novelId: "eeeeeeee-4444-7444-8555-666677778888" },
      dir,
    );
    expect(a).toBe(join("aaaaaaaa-0000-7000-8000-000000000001", "第一部", "第一章.md"));
    expect(b).toBe(join("eeeeeeee-4444-7444-8555-666677778888", "第一部", "第一章.md"));
  });

  test("部/章名仍走段清理，空名回退占位名", () => {
    const path = buildChapterDocumentPath(
      { novelId: "aaaaaaaa-0000-7000-8000-000000000003", partName: "  ", chapterName: "///" },
      "/nonexistent-doc-root",
    );
    expect(path).toBe(join("aaaaaaaa-0000-7000-8000-000000000003", "未分部", "未命名章节.md"));
  });

  test("目标文件已存在时追加 -N 后缀，绝不覆盖既有文件", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-docwriter-"));
    tempDirs.push(dir);
    const novelId = "aaaaaaaa-0000-7000-8000-000000000002";
    const input = { novelId, partName: "部", chapterName: "章" };
    writeDocumentArtifact(buildChapterDocumentPath(input, dir), "旧正文", dir);
    writeDocumentArtifact(buildChapterDocumentPath(input, dir), "次新正文", dir);
    const third = buildChapterDocumentPath(input, dir);
    expect(third).toBe(join(novelId, "部", "章-3.md"));
    writeDocumentArtifact(third, "第三份正文", dir);
    expect(readFileSync(join(dir, novelId, "部", "章.md"), "utf8")).toBe("旧正文");
    expect(readFileSync(join(dir, novelId, "部", "章-2.md"), "utf8")).toBe("次新正文");
    expect(readDocumentArtifact(third, dir)).toBe("第三份正文");
    expect(existsSync(join(dir, novelId, "部", "章-3.md"))).toBe(true);
  });

  test("countWords 不计空白字符", () => {
    expect(countWords("灵脉断绝。\n\n  少年睁眼。")).toBe(10);
    expect(countWords("")).toBe(0);
  });
});

describe("resolveArtifactPath（file_path 绝对/相对兼容）", () => {
  const tempDirs: string[] = [];
  afterAll(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  test("绝对路径原样返回（现行写入语义）、相对路径以 output 根解析（历史行）", () => {
    const dir = "/abs-output-root";
    expect(resolveArtifactPath(join(dir, "novel-x", "章.md"), dir)).toBe(
      join(dir, "novel-x", "章.md"),
    );
    expect(resolveArtifactPath(join("novel-x", "章.md"), dir)).toBe(
      join(dir, "novel-x", "章.md"),
    );
  });

  test("读取与删除对两类 file_path 均生效——绝对行不依赖 output 根参数", async () => {
    const dirA = await mkdtemp(join(tmpdir(), "novel-doc-resolve-a-"));
    const dirB = await mkdtemp(join(tmpdir(), "novel-doc-resolve-b-"));
    tempDirs.push(dirA, dirB);
    const relative = writeDocumentArtifact(
      join("novel-id", "部", "章.md"),
      "相对路径历史行",
      dirA,
    );
    const absolute = join(dirA, relative);
    // 历史行：相对 file_path 以 output 根解析（传对根可读）
    expect(readDocumentArtifact(relative, dirA)).toBe("相对路径历史行");
    // 现行行：绝对 file_path 换 output 根后仍可读、可删（换目录零损坏的关键）
    expect(readDocumentArtifact(absolute, dirB)).toBe("相对路径历史行");
    removeDocumentArtifact(absolute, dirB);
    expect(existsSync(absolute)).toBe(false);
  });
});

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildChapterDocumentPath,
  countWords,
  readDocumentArtifact,
  sanitizePathSegment,
  writeDocumentArtifact,
} from "./document-writer";

/**
 * document-writer 单元测试：路径段清理、层级路径构造（小说名-ID 去重、
 * 冲突 -N 后缀）与写读往返。
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

  test("层级为 小说名-<id前8位>/部名/章名.md——同名小说不同 ID 分属不同文件夹", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-docwriter-"));
    tempDirs.push(dir);
    const base = { novelName: "同名小说", partName: "第一部", chapterName: "第一章" };
    const a = buildChapterDocumentPath(
      { ...base, novelId: "aaaaaaaa-0000-7000-8000-000000000001" },
      dir,
    );
    const b = buildChapterDocumentPath(
      { ...base, novelId: "eeeeeeee-4444-7444-8555-666677778888" },
      dir,
    );
    expect(a).toBe(join("同名小说-aaaaaaaa", "第一部", "第一章.md"));
    expect(b).toBe(join("同名小说-eeeeeeee", "第一部", "第一章.md"));
  });

  test("目标文件已存在时追加 -N 后缀，绝不覆盖既有文件", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novel-docwriter-"));
    tempDirs.push(dir);
    const input = {
      novelName: "书",
      novelId: "aaaaaaaa-0000-7000-8000-000000000002",
      partName: "部",
      chapterName: "章",
    };
    writeDocumentArtifact(buildChapterDocumentPath(input, dir), "旧正文", dir);
    writeDocumentArtifact(buildChapterDocumentPath(input, dir), "次新正文", dir);
    const third = buildChapterDocumentPath(input, dir);
    expect(third).toBe(join("书-aaaaaaaa", "部", "章-3.md"));
    writeDocumentArtifact(third, "第三份正文", dir);
    expect(readFileSync(join(dir, "书-aaaaaaaa", "部", "章.md"), "utf8")).toBe("旧正文");
    expect(readFileSync(join(dir, "书-aaaaaaaa", "部", "章-2.md"), "utf8")).toBe("次新正文");
    expect(readDocumentArtifact(third, dir)).toBe("第三份正文");
    expect(existsSync(join(dir, "书-aaaaaaaa", "部", "章-3.md"))).toBe(true);
  });

  test("countWords 不计空白字符", () => {
    expect(countWords("灵脉断绝。\n\n  少年睁眼。")).toBe(10);
    expect(countWords("")).toBe(0);
  });
});

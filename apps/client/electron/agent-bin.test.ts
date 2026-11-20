import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { AGENT_BIN_TARGETS, agentBinFileName } from "@novel/shared";
import { resolveAgentSpawnCommand, type AgentBinContext } from "./agent-bin";

/** 测试用目标断言（noUncheckedIndexedAccess 下索引访问可能 undefined） */
function targetOf(platform: NodeJS.Platform, arch: string): string {
  const target = AGENT_BIN_TARGETS[`${platform}-${arch}`];
  if (target === undefined) throw new Error(`测试平台未映射：${platform}-${arch}`);
  return target;
}

/** 建一个含指定平台两枚二进制（空文件——解析器只验存在性）的临时 resources 目录 */
function fixtureResources(platform: NodeJS.Platform, arch: string): string {
  const resources = mkdtempSync(join(tmpdir(), "novel-agent-bin-fixture-"));
  const target = targetOf(platform, arch);
  const dir = join(resources, "bin", target);
  mkdirSync(dir, { recursive: true });
  for (const entry of ["headless", "query"] as const) {
    writeFileSync(join(dir, agentBinFileName(entry, target)), "");
  }
  return resources;
}

function contextOf(
  packaged: boolean,
  platform: NodeJS.Platform,
  arch: string,
  resourcesPath: string,
): AgentBinContext {
  return { packaged, platform, arch, resourcesPath, repoRoot: "/repo" };
}

describe("resolveAgentSpawnCommand：dev 态（与历史行为一致）", () => {
  test("headless：bun run + 仓库相对入口 + cwd 仓库根", () => {
    expect(resolveAgentSpawnCommand("headless", contextOf(false, "linux", "x64", "/res"))).toEqual({
      command: "bun",
      baseArgs: ["run", "apps/agent/src/headless.ts"],
      cwd: "/repo",
    });
  });

  test("query：同形态、入口不同", () => {
    expect(resolveAgentSpawnCommand("query", contextOf(false, "win32", "x64", "/res"))).toEqual({
      command: "bun",
      baseArgs: ["run", "apps/agent/src/query.ts"],
      cwd: "/repo",
    });
  });

  test("dev 态不触碰 resourcesPath（其中无二进制也照常解析）", () => {
    const resolved = resolveAgentSpawnCommand("headless", contextOf(false, "darwin", "arm64", "/不存在"));
    expect(resolved.command).toBe("bun");
  });
});

describe("resolveAgentSpawnCommand：打包态（extraResources 二进制）", () => {
  const cases: ReadonlyArray<{ platform: NodeJS.Platform; arch: string; exe: boolean }> = [
    { platform: "linux", arch: "x64", exe: false },
    { platform: "win32", arch: "x64", exe: true },
    { platform: "darwin", arch: "x64", exe: false },
    { platform: "darwin", arch: "arm64", exe: false },
  ];

  for (const { platform, arch, exe } of cases) {
    test(`${platform}-${arch}：目标目录正确，Windows 带 .exe，cwd 为二进制目录`, () => {
      const resources = fixtureResources(platform, arch);
      try {
        const target = targetOf(platform, arch);
        for (const entry of ["headless", "query"] as const) {
          const name = agentBinFileName(entry, target);
          if (exe) expect(name.endsWith(".exe")).toBe(true);
          const resolved = resolveAgentSpawnCommand(entry, contextOf(true, platform, arch, resources));
          expect(resolved).toEqual({
            command: join(resources, "bin", target, name),
            baseArgs: [],
            cwd: dirname(join(resources, "bin", target, name)),
          });
        }
      } finally {
        rmSync(resources, { recursive: true, force: true });
      }
    });
  }

  test("未映射平台组合（win32-arm64）：抛可读错误并列出已编译目标", () => {
    const resources = fixtureResources("win32", "x64");
    try {
      expect(() => resolveAgentSpawnCommand("headless", contextOf(true, "win32", "arm64", resources))).toThrow(
        /不支持的运行平台：win32-arm64/,
      );
    } finally {
      rmSync(resources, { recursive: true, force: true });
    }
  });

  test("二进制缺失：抛可读错误并带完整路径与补救提示", () => {
    const resources = mkdtempSync(join(tmpdir(), "novel-agent-bin-empty-"));
    try {
      const target = targetOf("linux", "x64");
      const missing = join(resources, "bin", target, "novel-headless");
      expect(() => resolveAgentSpawnCommand("headless", contextOf(true, "linux", "x64", resources))).toThrow(
        new RegExp(`agent 二进制缺失.*${missing.replaceAll("/", "\\/")}`),
      );
    } finally {
      rmSync(resources, { recursive: true, force: true });
    }
  });
});

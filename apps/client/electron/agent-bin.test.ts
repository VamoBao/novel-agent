import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentBinFileName } from "@novel/shared";
import { resolveAgentSpawnCommand, type AgentBinContext } from "./agent-bin";

/** 建一个含指定平台两枚二进制（空文件——解析器只验存在性）的临时 resources 目录；
 *  打包后 extraResources 扁平落 resources/bin/（win32 带 .exe） */
function fixtureResources(platform: NodeJS.Platform): string {
  const resources = mkdtempSync(join(tmpdir(), "novel-agent-bin-fixture-"));
  const dir = join(resources, "bin");
  mkdirSync(dir, { recursive: true });
  for (const entry of ["headless", "query"] as const) {
    writeFileSync(join(dir, agentBinFileName(entry, platform)), "");
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

describe("resolveAgentSpawnCommand：打包态（extraResources 扁平 bin/）", () => {
  const cases: ReadonlyArray<{ platform: NodeJS.Platform; arch: string }> = [
    { platform: "linux", arch: "x64" },
    { platform: "win32", arch: "x64" },
    { platform: "darwin", arch: "x64" },
    { platform: "darwin", arch: "arm64" },
  ];

  for (const { platform, arch } of cases) {
    test(`${platform}-${arch}：resources/bin/ 直取，cwd 为 bin 目录`, () => {
      const resources = fixtureResources(platform);
      try {
        for (const entry of ["headless", "query"] as const) {
          const name = agentBinFileName(entry, platform);
          if (platform === "win32") expect(name.endsWith(".exe")).toBe(true);
          const resolved = resolveAgentSpawnCommand(entry, contextOf(true, platform, arch, resources));
          expect(resolved).toEqual({
            command: join(resources, "bin", name),
            baseArgs: [],
            cwd: join(resources, "bin"),
          });
        }
      } finally {
        rmSync(resources, { recursive: true, force: true });
      }
    });
  }

  test("未映射平台组合（win32-arm64）：抛可读错误并列出已编译目标", () => {
    const resources = fixtureResources("win32");
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
      const missing = join(resources, "bin", "novel-headless");
      expect(() => resolveAgentSpawnCommand("headless", contextOf(true, "linux", "x64", resources))).toThrow(
        new RegExp(`agent 二进制缺失.*${missing.replaceAll("/", "\\/")}`),
      );
    } finally {
      rmSync(resources, { recursive: true, force: true });
    }
  });
});

import { describe, expect, test } from "bun:test";
import { AGENT_BIN_TARGETS, agentBinFileName, agentBinOsDir } from "./agent-bin";

describe("AGENT_BIN_TARGETS", () => {
  test("覆盖三类桌面平台（win/darwin 双架构/linux）", () => {
    expect(Object.keys(AGENT_BIN_TARGETS).sort()).toEqual([
      "darwin-arm64",
      "darwin-x64",
      "linux-x64",
      "win32-x64",
    ]);
  });

  test("key 为 platform-arch，value 为 bun --target 标识", () => {
    expect(AGENT_BIN_TARGETS["win32-x64"]).toBe("bun-windows-x64");
    expect(AGENT_BIN_TARGETS["darwin-arm64"]).toBe("bun-darwin-arm64");
    expect(AGENT_BIN_TARGETS["darwin-x64"]).toBe("bun-darwin-x64");
    expect(AGENT_BIN_TARGETS["linux-x64"]).toBe("bun-linux-x64");
  });
});

describe("agentBinOsDir（electron-builder 宏命名）", () => {
  test("win32 → win、darwin → mac、其余原样", () => {
    expect(agentBinOsDir("win32", "x64")).toBe("win-x64");
    expect(agentBinOsDir("darwin", "arm64")).toBe("mac-arm64");
    expect(agentBinOsDir("darwin", "x64")).toBe("mac-x64");
    expect(agentBinOsDir("linux", "x64")).toBe("linux-x64");
  });
});

describe("agentBinFileName（打包后扁平落 resources/bin/）", () => {
  test("非 win32 平台无后缀", () => {
    expect(agentBinFileName("headless", "linux")).toBe("novel-headless");
    expect(agentBinFileName("query", "darwin")).toBe("novel-query");
  });

  test("win32 平台带 .exe 后缀", () => {
    expect(agentBinFileName("headless", "win32")).toBe("novel-headless.exe");
    expect(agentBinFileName("query", "win32")).toBe("novel-query.exe");
  });
});

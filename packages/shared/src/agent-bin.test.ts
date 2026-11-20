import { describe, expect, test } from "bun:test";
import { AGENT_BIN_TARGETS, agentBinFileName } from "./agent-bin";

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

describe("agentBinFileName", () => {
  test("非 Windows 目标无后缀", () => {
    expect(agentBinFileName("headless", "bun-linux-x64")).toBe("novel-headless");
    expect(agentBinFileName("query", "bun-darwin-arm64")).toBe("novel-query");
  });

  test("Windows 目标带 .exe 后缀", () => {
    expect(agentBinFileName("headless", "bun-windows-x64")).toBe("novel-headless.exe");
    expect(agentBinFileName("query", "bun-windows-x64")).toBe("novel-query.exe");
  });
});

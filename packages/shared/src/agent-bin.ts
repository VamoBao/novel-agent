/**
 * agent 独立二进制的编译目标约定：根 `scripts/build-agent.ts`（bun build --compile 编译）
 * 与客户端 `apps/client/electron/agent-bin.ts`（spawn 路径解析）共用，避免两处映射漂移。
 * key = `process.platform-process.arch`，value = bun build 的 `--target`（同时是产物目录名，
 * 产物落 `apps/client/resources/bin/<target>/`，Electron 打包经 extraResources 带入——
 * asar 内无法 exec 可执行文件，必须置于 asar 外的 resources 目录）。
 */
export const AGENT_BIN_TARGETS: Readonly<Record<string, string>> = {
  "linux-x64": "bun-linux-x64",
  "win32-x64": "bun-windows-x64",
  "darwin-x64": "bun-darwin-x64",
  "darwin-arm64": "bun-darwin-arm64",
};

/** agent 的两个 CLI 入口（headless = 协议会话，query = 一次性库查询/管理） */
export type AgentBinEntry = "headless" | "query";

/** 二进制文件名：Windows 目标带 `.exe` 后缀（bun build --compile 自动追加，此处与之一致） */
export function agentBinFileName(entry: AgentBinEntry, target: string): string {
  const base = entry === "headless" ? "novel-headless" : "novel-query";
  return target.includes("windows") ? `${base}.exe` : base;
}

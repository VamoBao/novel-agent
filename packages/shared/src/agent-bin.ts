/**
 * agent 独立二进制的编译目标约定：根 `scripts/build-agent.ts`（bun build --compile 编译）
 * 与客户端 `apps/client/electron/agent-bin.ts`（spawn 路径解析）共用，避免两处映射漂移。
 * key = `process.platform-process.arch`，value = bun build 的 `--target`。
 *
 * 编译产物**暂存**于 `apps/client/resources/bin/<os>-<arch>/`（目录名用 electron-builder
 * 的宏命名——win/mac 而非 win32/darwin，见 agentBinOsDir），Electron 打包时 extraResources
 * 以 `from: resources/bin/${os}-${arch}` / `to: bin` 按当前构建平台自动选目录并**扁平**
 * 落到安装包 `resources/bin/`（asar 内无法 exec 可执行文件，必须置于 asar 外）。
 */
export const AGENT_BIN_TARGETS: Readonly<Record<string, string>> = {
  "linux-x64": "bun-linux-x64",
  "win32-x64": "bun-windows-x64",
  "darwin-x64": "bun-darwin-x64",
  "darwin-arm64": "bun-darwin-arm64",
};

/** agent 的两个 CLI 入口（headless = 协议会话，query = 一次性库查询/管理） */
export type AgentBinEntry = "headless" | "query";

/** electron-builder 宏命名的暂存目录名：platform-arch → `<os>-<arch>`（win32→win、darwin→mac） */
export function agentBinOsDir(platform: string, arch: string): string {
  const os = platform === "win32" ? "win" : platform === "darwin" ? "mac" : platform;
  return `${os}-${arch}`;
}

/** 二进制文件名：打包后扁平落 resources/bin/；win32 平台带 `.exe` 后缀
 *  （bun build --compile 对 windows 目标自动追加，此处与之一致） */
export function agentBinFileName(entry: AgentBinEntry, platform: string): string {
  const base = entry === "headless" ? "novel-headless" : "novel-query";
  return platform === "win32" ? `${base}.exe` : base;
}

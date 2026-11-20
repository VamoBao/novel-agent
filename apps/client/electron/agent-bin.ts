import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { AGENT_BIN_TARGETS, agentBinFileName, type AgentBinEntry } from "@novel/shared";

/**
 * agent 子进程 spawn 命令的双态解析（dev / 打包）：
 *
 * - dev：`bun run <仓库相对入口路径>` + cwd=仓库根——与历史行为完全一致（需本机安装 Bun）。
 * - 打包：直接执行 extraResources 内的编译二进制（bun build --compile 产物，Bun runtime
 *   与 bun:sqlite 内嵌）——asar 内无法 exec 可执行文件，故二进制经 electron-builder
 *   extraResources 落 resources/bin/<bun-target>/（由 scripts/build-agent.ts 产出，
 *   目标映射与文件名共用 @novel/shared agent-bin）。
 *
 * 数据路径不依赖 cwd：客户端 childEnv() 注入绝对 NOVEL_DB_PATH / NOVEL_OUTPUT_DIR；
 * 打包态 cwd 取二进制所在目录仅为确定性（不继承安装器/快捷方式带来的任意工作目录）。
 */

/** dev 态源码入口（仓库相对路径，随 spawn cwd=repoRoot 解析）；编译产物同名对应 */
const ENTRY_TS: Record<AgentBinEntry, string> = {
  headless: "apps/agent/src/headless.ts",
  query: "apps/agent/src/query.ts",
};

export interface AgentSpawnCommand {
  /** 可执行文件：dev = "bun"；打包态 = 二进制绝对路径 */
  command: string;
  /** 固定前缀参数（会话 argv / 查询子命令由调用方追加） */
  baseArgs: string[];
  /** spawn cwd：dev = 仓库根；打包态 = 二进制所在目录 */
  cwd: string;
}

/** 解析上下文全部由调用方注入（app.isPackaged / process.platform 等），保持纯函数可测 */
export interface AgentBinContext {
  packaged: boolean;
  platform: NodeJS.Platform;
  arch: string;
  /** electron process.resourcesPath（仅打包态使用） */
  resourcesPath: string;
  /** 仓库根（仅 dev 态使用） */
  repoRoot: string;
}

export function resolveAgentSpawnCommand(
  entry: AgentBinEntry,
  context: AgentBinContext,
): AgentSpawnCommand {
  if (!context.packaged) {
    return { command: "bun", baseArgs: ["run", ENTRY_TS[entry]], cwd: context.repoRoot };
  }
  const target = AGENT_BIN_TARGETS[`${context.platform}-${context.arch}`];
  if (target === undefined) {
    throw new Error(
      `不支持的运行平台：${context.platform}-${context.arch}（已编译目标：${Object.keys(AGENT_BIN_TARGETS).join("、")}；新增平台需扩展 @novel/shared agent-bin 后经 bun run build:agent 重编译并重新打包）`,
    );
  }
  const binPath = join(context.resourcesPath, "bin", target, agentBinFileName(entry, target));
  if (!existsSync(binPath)) {
    throw new Error(
      `agent 二进制缺失：${binPath}（安装包 resources/bin 应随 extraResources 携带编译产物；请重新执行 bun run build:agent 并重新打包）`,
    );
  }
  return { command: binPath, baseArgs: [], cwd: dirname(binPath) };
}

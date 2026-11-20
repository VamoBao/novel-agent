/**
 * agent 二进制构建脚本：把 apps/agent 的两个 CLI 入口（headless 协议会话 / query 库查询）
 * 经 `bun build --compile` 编译为独立可执行文件——Bun runtime 与 bun:sqlite 内嵌，
 * 目标机器无需安装 Bun。产物暂存于 apps/client/resources/bin/<os>-<arch>/
 * （目录名为 electron-builder 宏命名，gitignore 不入库），Electron 打包时 extraResources
 * 以 `${os}-${arch}` 宏自动按平台选目录并**扁平**落安装包 resources/bin/——asar 内无法
 * exec 可执行文件。目标映射与命名约定见 @novel/shared agent-bin.ts，客户端 spawn 侧
 * （apps/client/electron/agent-bin.ts）按「打包后扁平 resources/bin/」解析。
 *
 * 用法：bun run build:agent（根 package.json）。编译全部目标（当前平台 + 交叉编译，
 * 共约 15s）；当前平台产物构建后自动冒烟——headless 收到 hello 握手、query 可读
 * 同一临时库（headless 会话在 EOF 中止前已建 novels 行，list 应非空），失败退出非零。
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_BIN_TARGETS,
  agentBinFileName,
  agentBinOsDir,
  type AgentBinEntry,
} from "../packages/shared/src/agent-bin";
import { PROTOCOL_VERSION } from "../packages/shared/src/protocol";

const REPO_ROOT = join(import.meta.dir, "..");
/** 产物根：apps/client/resources/bin（electron-builder extraResources 消费） */
const OUT_ROOT = join(REPO_ROOT, "apps", "client", "resources", "bin");

/** 两个 CLI 入口（仓库相对路径——dev 态客户端 spawn 用同一路径） */
const ENTRIES: ReadonlyArray<{ entry: AgentBinEntry; ts: string }> = [
  { entry: "headless", ts: "apps/agent/src/headless.ts" },
  { entry: "query", ts: "apps/agent/src/query.ts" },
];

function fail(message: string): never {
  console.error(`[build-agent] ✗ ${message}`);
  process.exit(1);
}

/** 编译全部目标 × 入口；开始前清空产物目录（避免残留旧版本二进制）。
 *  暂存目录用 electron-builder 宏命名（agentBinOsDir），打包时 extraResources
 *  以 `${os}-${arch}` 自动按平台选目录并扁平落安装包 resources/bin/ */
function buildAll(): void {
  rmSync(OUT_ROOT, { recursive: true, force: true });
  for (const [platformKey, target] of Object.entries(AGENT_BIN_TARGETS)) {
    const [platform, arch] = platformKey.split("-");
    if (platform === undefined || arch === undefined) {
      fail(`AGENT_BIN_TARGETS 的 key 非法（应为 platform-arch）：${platformKey}`);
    }
    const osDir = agentBinOsDir(platform, arch);
    for (const { entry, ts } of ENTRIES) {
      const fileName = agentBinFileName(entry, platform);
      const outfile = join(OUT_ROOT, osDir, fileName);
      mkdirSync(join(OUT_ROOT, osDir), { recursive: true });
      const result = spawnSync(
        process.execPath,
        ["build", join(REPO_ROOT, ts), "--compile", `--target=${target}`, "--outfile", outfile],
        { encoding: "utf8", timeout: 120_000 },
      );
      if (result.status !== 0) {
        fail(`编译失败：${osDir}/${fileName}\n${result.stderr ?? result.stdout ?? ""}`);
      }
      const mb = statSync(outfile).size / 1024 / 1024;
      console.log(`[build-agent] ✓ ${osDir}/${fileName}（${target}，${mb.toFixed(1)} MB）`);
    }
  }
}

/** 当前平台产物冒烟：headless 拿 hello 握手（stdin 立即 EOF → 会话中止退出 0，
 *  中止前已建 novels 行）→ query list 读同一临时库应返回非空数组——覆盖 argv、
 *  bun:sqlite 建库写库、跨二进制读库全链路；不调用任何真实模型 */
function smokeCurrentPlatform(): void {
  const platformKey = `${process.platform}-${process.arch}`;
  const target = AGENT_BIN_TARGETS[platformKey];
  if (target === undefined) {
    console.log(`[build-agent] ⚠ 当前平台 ${platformKey} 不在编译目标内，跳过冒烟（仅验证编译产物存在）`);
    return;
  }
  const headlessBin = join(OUT_ROOT, agentBinOsDir(process.platform, process.arch), agentBinFileName("headless", process.platform));
  const queryBin = join(OUT_ROOT, agentBinOsDir(process.platform, process.arch), agentBinFileName("query", process.platform));
  const dir = mkdtempSync(join(tmpdir(), "novel-agent-bin-"));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NOVEL_DB_PATH: join(dir, "smoke.db"),
    NOVEL_OUTPUT_DIR: join(dir, "output"),
    // headless 启动检查要求 Agent 模型 Key（冒烟不发起真实模型调用，占位即可）
    AGENT_MODEL_API_KEY: process.env.AGENT_MODEL_API_KEY ?? "build-smoke-placeholder",
  };
  try {
    const headless = spawnSync(headlessBin, [], { env, input: "", encoding: "utf8", timeout: 20_000 });
    if (headless.status !== 0) {
      fail(
        `headless 冒烟失败（exit ${headless.status}）：${(headless.stderr || headless.stdout || "").slice(0, 500)}`,
      );
    }
    const firstLine = headless.stdout.split("\n", 1)[0] ?? "";
    let hello: unknown;
    try {
      hello = JSON.parse(firstLine);
    } catch {
      fail(`headless 冒烟失败：stdout 首行不是 JSON：${firstLine.slice(0, 200)}`);
    }
    const protoVersion = (hello as { type?: string; protoVersion?: number }).protoVersion;
    if ((hello as { type?: string }).type !== "hello" || protoVersion !== PROTOCOL_VERSION) {
      fail(`headless 冒烟失败：hello 握手异常（期望 protoVersion=${PROTOCOL_VERSION}，实收 ${String(firstLine.slice(0, 200))}）`);
    }
    const query = spawnSync(queryBin, ["list"], { env, encoding: "utf8", timeout: 20_000 });
    if (query.status !== 0) {
      fail(`query 冒烟失败（exit ${query.status}）：${(query.stderr || query.stdout || "").slice(0, 500)}`);
    }
    let list: unknown;
    try {
      list = JSON.parse(query.stdout);
    } catch {
      fail(`query 冒烟失败：stdout 不是 JSON：${query.stdout.slice(0, 200)}`);
    }
    if (!Array.isArray(list) || list.length < 1) {
      fail(`query 冒烟失败：list 应含 headless 会话已建的 novels 行，实收 ${query.stdout.slice(0, 200)}`);
    }
    console.log(`[build-agent] ✓ 冒烟通过（${target}：hello protoVersion=${PROTOCOL_VERSION}，query list ${list.length} 行）`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

buildAll();
smokeCurrentPlatform();

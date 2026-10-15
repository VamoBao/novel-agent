import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { terminateAgent } from "./terminate-agent";

test("停止返回时旧 Agent 确实退出，允许稍后清理后退出", async () => {
  const child = spawn(process.execPath, ["--eval", `
    process.on('SIGTERM', () => setTimeout(() => process.exit(0), 30));
    setInterval(() => {}, 1000);
    process.stdout.write('ready');
  `], { stdio: ["ignore", "pipe", "pipe"] });
  await once(child.stdout!, "data");
  try {
    await terminateAgent(child);
    expect(child.exitCode).toBe(0);
    // 重复停止已退出的子进程必须立即结束。
    await terminateAgent(child);
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }
});

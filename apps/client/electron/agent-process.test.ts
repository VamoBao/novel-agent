import { expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import type { AgentMessage, AgentStartOptions } from "@novel/shared";
import { AgentProcess } from "./agent-process";

function child(script: string): ChildProcess {
  return spawn(process.execPath, ["--eval", script], { stdio: ["pipe", "pipe", "pipe"] });
}

const waitForStopScript = `
  process.on('SIGTERM', () => setTimeout(() => process.exit(0), 40));
  setInterval(() => {}, 1000);
  process.stdout.write(JSON.stringify({type:'notify', text:'ready'}) + '\\n');
`;

test("停止途中启动新会话会等待旧进程退出，不吞掉启动也不终止活跃任务", async () => {
  const children: ChildProcess[] = [];
  const modes: string[] = [];
  const messages: AgentMessage[] = [];
  const host = new AgentProcess({
    spawn: (options: AgentStartOptions) => {
      modes.push(options.mode);
      const process = child(waitForStopScript);
      children.push(process);
      return process;
    },
    onMessage: (message) => messages.push(message), onExit: () => {},
  });
  await host.start();
  await once(children[0]!.stdout!, "data");
  try {
    await host.start({ mode: "resume", runId: "active" });
    expect(modes).toEqual(["create"]);
    expect(children[0]!.killed).toBe(false);
    const stopping = host.kill();
    const restarting = host.start({ mode: "resume", runId: "saved" });
    expect(modes).toEqual(["create"]);
    await Promise.all([stopping, restarting]);
    expect(children[0]!.exitCode).toBe(0);
    expect(modes).toEqual(["create", "resume"]);
    await once(children[1]!.stdout!, "data");
    const received = [...messages];
    // 已退出旧 child 的迟到事件不得清除或污染新会话。
    children[0]!.stdout!.emit("data", `${JSON.stringify({ type: "notify", text: "stale" })}\n`);
    children[0]!.emit("error", new Error("late old child event"));
    await host.start({ mode: "create" });
    expect(messages).toEqual(received);
    expect(modes).toEqual(["create", "resume"]);
    expect(children[1]!.exitCode).toBeNull();
  } finally {
    await host.kill();
  }
});

test("自然退出须 drain stdout 后才回传 exit，保留末尾 run_finished", async () => {
  const events: string[] = [];
  let process: ChildProcess | undefined;
  const host = new AgentProcess({
    spawn: () => {
      process = child(`process.stdout.write(JSON.stringify({type:'run_finished', novelId:'novel', outputPath:''}) + '\\n'); process.exit(0);`);
      return process;
    },
    onMessage: (message: AgentMessage) => events.push(message.type),
    onExit: () => events.push("exit"),
  });
  await host.start();
  process!.stdout!.pause();
  let beforeDrain: string[] = [];
  process!.once("exit", () => {
    beforeDrain = [...events];
    process!.stdout!.resume();
  });
  await once(process!, "close");
  expect(beforeDrain).toEqual([]);
  expect(events).toEqual(["run_finished", "exit"]);
});

test("自然进程已 exit 但仍在 drain 时新启动等待 close", async () => {
  const children: ChildProcess[] = [];
  const events: string[] = [];
  const host = new AgentProcess({
    spawn: () => {
      events.push("spawn");
      const process = child(children.length === 0
        ? `process.stdout.write(JSON.stringify({type:'run_finished', novelId:'novel', outputPath:''}) + '\\n'); process.exit(0);`
        : waitForStopScript);
      children.push(process);
      return process;
    },
    onMessage: (message) => events.push(message.type),
    onExit: () => events.push("exit"),
  });
  await host.start();
  const first = children[0]!;
  first.stdout!.pause();
  let starting: Promise<void> | undefined;
  first.once("exit", () => {
    starting = host.start({ mode: "resume", runId: "saved" });
    first.stdout!.resume();
  });
  await once(first, "close");
  await starting;
  try {
    expect(events).toEqual(["spawn", "run_finished", "exit", "spawn"]);
    await once(children[1]!.stdout!, "data");
  } finally {
    await host.kill();
  }
});

test("收到 run_finished 后立即启动下一会话会等待旧进程自然关闭", async () => {
  const children: ChildProcess[] = [];
  let markFinished: (() => void) | undefined;
  const finished = new Promise<void>((resolve) => { markFinished = resolve; });
  const host = new AgentProcess({
    spawn: () => {
      const process = child(children.length === 0
        ? `process.stdout.write(JSON.stringify({type:'run_finished', novelId:'novel', outputPath:''}) + '\\n'); setTimeout(() => process.exit(0), 40);`
        : waitForStopScript);
      children.push(process);
      return process;
    },
    onMessage: (message) => { if (message.type === "run_finished") markFinished!(); },
    onExit: () => {},
  });
  await host.start();
  await finished;
  expect(children[0]!.exitCode).toBeNull();
  const starting = host.start({ mode: "resume", runId: "next" });
  expect(children).toHaveLength(1);
  try {
    await starting;
    expect(children).toHaveLength(2);
    expect(children[0]!.exitCode).toBe(0);
    expect(children[0]!.killed).toBe(false);
    await once(children[1]!.stdout!, "data");
  } finally {
    await host.kill();
  }
});

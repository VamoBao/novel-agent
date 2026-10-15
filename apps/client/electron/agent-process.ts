import type { ChildProcess } from "node:child_process";
import { agentMessageSchema, PROTOCOL_VERSION, type AgentMessage, type AgentStartOptions } from "@novel/shared";
import { terminateAgent } from "./terminate-agent";

interface AgentProcessOptions {
  spawn: (options: AgentStartOptions) => ChildProcess;
  onMessage: (message: AgentMessage) => void;
  onExit: (code: number) => void;
}

/** 子进程协议与生命周期宿主；Electron 窗口和环境配置由入口注入。 */
export class AgentProcess {
  private child: ChildProcess | null = null;
  private closing: Promise<void> | null = null;
  private stopping: Promise<void> | null = null;
  private completed = false;

  constructor(private readonly options: AgentProcessOptions) {}

  async start(options: AgentStartOptions = { mode: "create" }): Promise<void> {
    if (this.stopping) await this.stopping;
    // 自然退出后仍须等 stdout drain，末尾完成消息先于退出通知。
    if (this.child && (this.completed || this.child.exitCode !== null || this.child.signalCode !== null)) {
      await this.closing;
    }
    if (this.child) return;
    const child = this.options.spawn(options);
    this.child = child;
    this.completed = false;
    let stdoutBuffer = "";
    let failed = false;
    this.closing = new Promise<void>((resolve) => {
      child.once("close", (code) => {
        if (this.child === child) {
          this.child = null;
          this.closing = null;
          this.options.onExit(failed ? -1 : code ?? -1);
        }
        resolve();
      });
    });
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (this.child !== child) return;
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) this.dispatchAgentLine(line);
    });
    child.on("error", (error) => {
      if (this.child !== child) return;
      failed = true;
      console.error("[agent] 子进程错误：", error);
    });
  }

  private dispatchAgentLine(line: string): void {
    if (line.trim().length === 0) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      console.warn("[agent] 非 JSON 行：", line.slice(0, 200));
      return;
    }
    const message = agentMessageSchema.safeParse(parsed);
    if (!message.success) {
      console.warn("[agent] 消息不合协议 schema，已忽略：", line.slice(0, 200));
      return;
    }
    if (message.data.type === "hello" && message.data.protoVersion !== PROTOCOL_VERSION) {
      this.options.onMessage({
        type: "error",
        message: `协议版本不匹配：agent=${message.data.protoVersion}，client=${PROTOCOL_VERSION}`,
        fatal: true,
      });
      void this.kill();
      return;
    }
    if (message.data.type === "run_finished") this.completed = true;
    this.options.onMessage(message.data);
  }

  respond(id: number, answer: string | string[] | boolean | number): void {
    this.child?.stdin?.write(`${JSON.stringify({ type: "response", id, answer })}\n`);
  }

  async kill(): Promise<void> {
    if (this.stopping) return this.stopping;
    const child = this.child;
    if (!child) return;
    const closing = this.closing;
    const stopping = (async () => {
      await terminateAgent(child);
      await closing;
    })();
    this.stopping = stopping;
    try {
      await stopping;
    } finally {
      if (this.stopping === stopping) this.stopping = null;
    }
  }
}

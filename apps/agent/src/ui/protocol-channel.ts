import { clientMessageSchema, type AgentMessage, type Ask, type Stage, type View } from "@novel/shared";
import { UserAbortedError } from "./aborted";
import type { UiChannel } from "./channel";

type PendingKind = "line" | "text" | "select" | "multi" | "confirm" | "int";

interface PendingEntry {
  kind: PendingKind;
  /** 收到对应 id 的应答：有效则结算 Promise，无效则重新提问（对齐 CLI 校验重问循环） */
  handleAnswer: (answer: unknown) => void;
  /** 通道关闭时的收尾：line 结算 null（告知模型停止），其余 reject UserAbortedError */
  onAbort: () => void;
}

/**
 * stdio JSON 协议交互通道：每个提问发出 request 消息（自增 id）并挂起，
 * 收到同 id 的 response 后结算；无效应答（类型不符 / 越界 / 空 Required）
 * 会以新 id 重新提问。request 可并发到达，client 按到达顺序排队呈现。
 *
 * 消息格式见 @novel/shared 的 protocol.ts；任一侧收到不合 schema 的消息
 * 由 headless 入口 fail-fast 处理。
 */
export class ProtocolChannel implements UiChannel {
  private nextId = 1;
  private readonly pending = new Map<number, PendingEntry>();
  private closed = false;

  constructor(private readonly send: (message: AgentMessage) => void) {}

  /** headless 收到一行 client 消息时调用；JSON 非法或 id 未知时抛错（fail-fast） */
  handleLine(line: string): void {
    if (this.closed || line.trim().length === 0) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`协议消息不是合法 JSON：${line.slice(0, 200)}`);
    }
    const message = clientMessageSchema.safeParse(parsed);
    if (!message.success) {
      throw new Error(`协议消息不合法：${line.slice(0, 200)}`);
    }
    if (message.data.type !== "response") return;
    const entry = this.pending.get(message.data.id);
    if (!entry) {
      throw new Error(`收到未知 request id 的应答：${message.data.id}`);
    }
    entry.handleAnswer(message.data.answer);
  }

  /** 通道关闭（stdin EOF / SIGTERM）：挂起中的 line 结算 null，其余中止；此后提问按 CLI 同款语义处理 */
  abort(): void {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.pending.values()) entry.onAbort();
    this.pending.clear();
  }

  private request<T>(
    kind: PendingKind,
    buildAsk: () => Ask,
    validate: (answer: unknown) => T | undefined,
  ): Promise<T> {
    if (this.closed) {
      // 对齐 CLI 的 EOF 后语义：原始行提问得 null（模型可优雅收尾），其余提问中止
      if (kind === "line") return Promise.resolve(null as T);
      return Promise.reject(new UserAbortedError());
    }
    return new Promise<T>((resolve, reject) => {
      const attempt = (): void => {
        const id = this.nextId++;
        this.pending.set(id, {
          kind,
          handleAnswer: (answer) => {
            const value = validate(answer);
            if (value === undefined) {
              this.pending.delete(id);
              attempt();
            } else {
              this.pending.delete(id);
              resolve(value);
            }
          },
          onAbort:
            kind === "line"
              ? () => resolve(null as T)
              : () => reject(new UserAbortedError()),
        });
        this.send({ type: "request", id, ask: buildAsk() });
      };
      attempt();
    });
  }

  async askLine(prompt: string): Promise<string | null> {
    return this.request("line", () => ({ type: "line", prompt }), answerToString);
  }

  async askText(prompt: string, opts?: { optional?: boolean }): Promise<string> {
    const optional = opts?.optional ?? false;
    return this.request(
      "text",
      () => ({ type: "text", prompt, optional }),
      (answer) => {
        if (typeof answer !== "string") return undefined;
        if (answer.length === 0 && !optional) return undefined;
        return answer;
      },
    );
  }

  async askSelect(
    prompt: string,
    options: readonly string[],
    opts?: { allowCustom?: boolean },
  ): Promise<string> {
    const allowCustom = opts?.allowCustom ?? false;
    return this.request(
      "select",
      () => ({ type: "select", prompt, options: [...options], allowCustom }),
      (answer) => {
        if (typeof answer !== "string" || answer.length === 0) return undefined;
        return options.includes(answer) || allowCustom ? answer : undefined;
      },
    );
  }

  async askMultiSelect(prompt: string, options: readonly string[]): Promise<string[]> {
    return this.request(
      "multi",
      () => ({ type: "multi", prompt, options: [...options] }),
      (answer) => {
        if (!Array.isArray(answer) || answer.length === 0) return undefined;
        if (!answer.every((item): item is string => typeof item === "string")) return undefined;
        if (!answer.every((item) => options.includes(item))) return undefined;
        return [...new Set(answer)];
      },
    );
  }

  async askConfirm(prompt: string, opts?: { default?: boolean; view?: View }): Promise<boolean> {
    const view = opts?.view;
    return this.request(
      "confirm",
      () => ({
        type: "confirm",
        prompt,
        default: opts?.default ?? true,
        ...(view ? { view } : {}),
      }),
      (answer) => (typeof answer === "boolean" ? answer : undefined),
    );
  }

  async askInt(prompt: string, opts: { min: number; max: number; default: number }): Promise<number> {
    return this.request(
      "int",
      () => ({ type: "int", prompt, min: opts.min, max: opts.max, default: opts.default }),
      (answer) =>
        typeof answer === "number" && Number.isInteger(answer) && answer >= opts.min && answer <= opts.max
          ? answer
          : undefined,
    );
  }

  notify(text: string): void {
    this.send({ type: "notify", text });
  }

  stage(stage: Stage): void {
    this.send({ type: "stage", stage });
  }

  present(view: View): void {
    this.send({ type: "view", view });
  }

  close(): void {
    this.abort();
  }
}

function answerToString(answer: unknown): string | undefined {
  // 空串是合法应答（对齐 CLI：ask_user 会返回「用户留空未作答」），仅类型不符才重问
  return typeof answer === "string" ? answer : undefined;
}

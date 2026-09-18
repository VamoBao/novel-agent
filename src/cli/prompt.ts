import * as readline from "node:readline";

/** 用户在输入流关闭（EOF / Ctrl+D）时抛出，用于优雅终止整个工作流 */
export class UserAbortedError extends Error {
  constructor() {
    super("用户终止了输入");
    this.name = "UserAbortedError";
  }
}

interface LineSource {
  /** 读一行（打印提示语）；流已结束时返回 null */
  readLine(prompt: string): Promise<string | null>;
  close(): void;
}

interface QueueItem {
  prompt: string;
  resolve: (line: string | null) => void;
}

/**
 * 串行行读取基类：并发读取（如 ReAct Agent 一步内并行调用多个工具、
 * 每个工具都等用户确认）时按 FIFO 排队，且提示语在轮到自己时才写入，
 * 保证用户在终端「依次确认」，同时只存在一个未完成的提问。
 */
abstract class SerialLineSource {
  private readonly queue: QueueItem[] = [];
  private active = false;

  readLine(prompt: string): Promise<string | null> {
    return new Promise((resolve) => {
      this.queue.push({ prompt, resolve });
      this.pump();
    });
  }

  protected pump(): void {
    if (this.active) return;
    const next = this.queue.shift();
    if (!next) return;
    this.active = true;
    this.readOne(next.prompt)
      .catch(() => null)
      .then((line) => {
        this.active = false;
        next.resolve(line);
        this.pump();
      });
  }

  /** 读取一行；提示语必须在此方法内写入（而非 readLine 入队时） */
  protected abstract readOne(prompt: string): Promise<string | null>;

  /** 流关闭时把队列中等待的读取全部以 null 收尾（resolve 幂等，安全） */
  protected abortAll(): void {
    while (this.queue.length > 0) {
      this.queue.shift()?.resolve(null);
    }
  }
}

/**
 * TTY 交互模式：node:readline 提供行编辑、回显与 Ctrl+D 支持。
 * readline 的 question 同时只允许一个未完成回调（后调覆盖前调），
 * 串行化后天然规避该限制。
 */
class TtyLineSource extends SerialLineSource implements LineSource {
  private readonly rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  private closed = false;
  private pending: ((line: string | null) => void) | null = null;

  constructor() {
    super();
    this.rl.on("close", () => {
      this.closed = true;
      this.pending?.(null);
      this.pending = null;
      this.abortAll();
    });
  }

  protected readOne(prompt: string): Promise<string | null> {
    return new Promise((resolve) => {
      if (this.closed) {
        resolve(null);
        return;
      }
      this.pending = resolve;
      this.rl.question(prompt, (answer) => {
        this.pending = null;
        resolve(answer.trim());
      });
    });
  }

  close(): void {
    this.rl.close();
  }
}

/**
 * 管道/文件输入模式（脚本喂入、自动化验证）。
 * Bun 的 node:readline 在管道下会在两次 question 之间丢弃缓冲并关闭，
 * 因此这里自行按行缓冲 stdin。
 */
class PipedLineSource extends SerialLineSource implements LineSource {
  private readonly lines: string[] = [];
  private partial = "";
  private eof = false;
  private notify: (() => void) | null = null;

  constructor(private readonly stream: NodeJS.ReadableStream) {
    super();
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => this.onData(chunk));
    stream.on("end", () => this.onEof());
    stream.on("error", () => this.onEof());
  }

  private onData(chunk: string): void {
    this.partial += chunk;
    const parts = this.partial.split("\n");
    this.partial = parts.pop() ?? "";
    for (const part of parts) this.lines.push(part.replace(/\r$/, ""));
    this.wake();
  }

  private onEof(): void {
    if (this.eof) return;
    this.eof = true;
    if (this.partial.length > 0) {
      this.lines.push(this.partial.replace(/\r$/, ""));
      this.partial = "";
    }
    this.wake();
  }

  private wake(): void {
    const n = this.notify;
    this.notify = null;
    n?.();
  }

  protected async readOne(prompt: string): Promise<string | null> {
    process.stdout.write(prompt);
    for (;;) {
      if (this.lines.length > 0) {
        return this.lines.shift() ?? null;
      }
      if (this.eof) {
        return null;
      }
      await new Promise<void>((resolve) => {
        this.notify = resolve;
      });
    }
  }

  close(): void {
    this.onEof();
    // 必须销毁流：打开的 stdin 数据监听会挂住事件循环，导致工作流完成后进程无法退出
    //（NodeJS.ReadableStream 类型上无 destroy，运行时存在）
    (this.stream as { destroy?: () => void }).destroy?.();
    this.abortAll();
  }
}

const source: LineSource =
  process.stdin.isTTY === true
    ? new TtyLineSource()
    : new PipedLineSource(process.stdin);

export function closePrompt(): void {
  source.close();
}

/** 读一行输入；输入流已关闭时返回 null */
export function askLine(prompt: string): Promise<string | null> {
  return source.readLine(prompt).then((line) => line?.trim() ?? null);
}

/** 读一行非空输入；EOF 抛 UserAbortedError，空输入则重新询问 */
export async function askRequired(prompt: string): Promise<string> {
  for (;;) {
    const line = await askLine(prompt);
    if (line === null) throw new UserAbortedError();
    if (line.length > 0) return line;
  }
}

/** 读一行可为空的输入（直接回车 = 空串）；EOF 抛 UserAbortedError */
export async function askOptional(prompt: string): Promise<string> {
  const line = await askLine(prompt);
  if (line === null) throw new UserAbortedError();
  return line;
}

/** 单选：展示编号选项；allowCustom 时 0 表示自定义输入 */
export async function askSelect(
  prompt: string,
  options: readonly string[],
  opts: { allowCustom?: boolean } = {},
): Promise<string> {
  console.log(`\n${prompt}`);
  options.forEach((option, i) => console.log(`  ${i + 1}. ${option}`));
  if (opts.allowCustom) console.log("  0. 自定义输入");
  for (;;) {
    const raw = await askRequired("请选择编号> ");
    if (opts.allowCustom && raw === "0") {
      return askRequired("请输入自定义内容> ");
    }
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= options.length) {
      const picked = options[n - 1];
      if (picked !== undefined) return picked;
    }
    console.log("无效选择，请重新输入。");
  }
}

/** 多选：输入编号（逗号或空格分隔），返回选中的选项文本（按输入顺序去重） */
export async function askMultiSelect(
  prompt: string,
  options: readonly string[],
): Promise<string[]> {
  console.log(`\n${prompt}`);
  options.forEach((option, i) => console.log(`  ${i + 1}. ${option}`));
  const picked = new Set<string>();
  for (;;) {
    const raw = await askRequired("请选择编号（多选，逗号或空格分隔）> ");
    const tokens = raw.split(/[,，\s]+/).filter((t) => t.length > 0);
    const indexes = tokens.map((t) => Number(t));
    if (
      tokens.length > 0 &&
      indexes.every((n) => Number.isInteger(n) && n >= 1 && n <= options.length)
    ) {
      for (const n of indexes) {
        const option = options[n - 1];
        if (option !== undefined) picked.add(option);
      }
      if (picked.size > 0) return [...picked];
    }
    console.log("无效选择，请重新输入。");
  }
}

/** 是/否确认；直接回车取默认值。展示类内容请直接拼进 prompt，确保与提问原子出现 */
export async function askConfirm(prompt: string, defaultValue = true): Promise<boolean> {
  const hint = defaultValue ? "Y/n" : "y/N";
  for (;;) {
    const raw = await askRequired(`${prompt}（${hint}）> `);
    if (raw.length === 0) return defaultValue;
    if (/^(y|yes)$/i.test(raw)) return true;
    if (/^(n|no)$/i.test(raw)) return false;
    console.log("请输入 y 或 n。");
  }
}

/** 整数输入：范围校验；直接回车取默认值；EOF 抛 UserAbortedError */
export async function askInt(
  prompt: string,
  opts: { min: number; max: number; default: number },
): Promise<number> {
  const hint = `${opts.min}-${opts.max}，直接回车默认 ${opts.default}`;
  for (;;) {
    const raw = await askLine(`${prompt}（${hint}）> `);
    if (raw === null) throw new UserAbortedError();
    if (raw.length === 0) return opts.default;
    const n = Number(raw);
    if (Number.isInteger(n) && n >= opts.min && n <= opts.max) return n;
    console.log(`无效数字，请输入 ${opts.min}-${opts.max} 之间的整数。`);
  }
}

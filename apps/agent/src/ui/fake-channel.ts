import type { Stage, View } from "@novel/shared";
import { UserAbortedError } from "./aborted";
import type { UiChannel } from "./channel";

/** 脚本化应答：任意 ask* 按 FIFO 顺序消费；null 模拟通道关闭（askLine 得 null，其余抛 UserAbortedError） */
export type ScriptedAnswer = string | string[] | boolean | number | null;

export interface FakeChannelCall {
  method: "askLine" | "askText" | "askSelect" | "askMultiSelect" | "askConfirm" | "askInt";
  prompt: string;
}

/**
 * 测试用交互通道：应答按序消耗，记录全部提问、通知与视图供断言。
 * 脚本耗尽视为测试脚本编写错误（抛错而非静默挂起）。
 */
export class FakeChannel implements UiChannel {
  private readonly answers: ScriptedAnswer[];
  readonly calls: FakeChannelCall[] = [];
  readonly notifies: string[] = [];
  readonly stages: Stage[] = [];
  /** 全部出现的视图（present 与确认门携带的 view 均记录） */
  readonly views: View[] = [];

  constructor(answers: ScriptedAnswer[]) {
    this.answers = [...answers];
  }

  private take(): ScriptedAnswer {
    const answer = this.answers.shift();
    if (answer === undefined) throw new Error("FakeChannel 应答脚本耗尽");
    return answer;
  }

  private takeAs<T extends Exclude<ScriptedAnswer, null>>(
    method: FakeChannelCall["method"],
    prompt: string,
    expected: "string" | "string[]" | "boolean" | "number",
  ): T {
    this.calls.push({ method, prompt });
    const answer = this.take();
    if (answer === null) throw new UserAbortedError();
    const actual = Array.isArray(answer) ? "string[]" : typeof answer;
    if (actual !== expected) {
      throw new Error(`FakeChannel：${method} 期望 ${expected} 应答，得到 ${actual}（prompt：${prompt}）`);
    }
    return answer as T;
  }

  async askLine(prompt: string): Promise<string | null> {
    this.calls.push({ method: "askLine", prompt });
    const answer = this.take();
    return typeof answer === "string" ? answer : null;
  }

  async askText(prompt: string, opts?: { optional?: boolean }): Promise<string> {
    const answer = this.takeAs<string>("askText", prompt, "string");
    if (answer.length === 0 && !opts?.optional) {
      throw new Error(`FakeChannel：askText 非可选提问收到空应答（prompt：${prompt}）`);
    }
    return answer;
  }

  async askSelect(
    prompt: string,
    options: readonly string[],
    opts?: { allowCustom?: boolean },
  ): Promise<string> {
    const answer = this.takeAs<string>("askSelect", prompt, "string");
    if (!options.includes(answer) && !opts?.allowCustom) {
      throw new Error(`FakeChannel：askSelect 应答不在选项内（prompt：${prompt}）`);
    }
    return answer;
  }

  async askMultiSelect(prompt: string, options: readonly string[]): Promise<string[]> {
    const answer = this.takeAs<string[]>("askMultiSelect", prompt, "string[]");
    for (const item of answer) {
      if (!options.includes(item)) {
        throw new Error(`FakeChannel：askMultiSelect 应答不在选项内（prompt：${prompt}）`);
      }
    }
    return answer;
  }

  async askConfirm(prompt: string, opts?: { default?: boolean; view?: View }): Promise<boolean> {
    if (opts?.view) this.views.push(opts.view);
    return this.takeAs<boolean>("askConfirm", prompt, "boolean");
  }

  async askInt(prompt: string, opts: { min: number; max: number; default: number }): Promise<number> {
    const answer = this.takeAs<number>("askInt", prompt, "number");
    if (!Number.isInteger(answer) || answer < opts.min || answer > opts.max) {
      throw new Error(
        `FakeChannel：askInt 应答超出范围 ${opts.min}-${opts.max}（prompt：${prompt}）`,
      );
    }
    return answer;
  }

  notify(text: string): void {
    this.notifies.push(text);
  }

  stage(stage: Stage): void {
    this.stages.push(stage);
  }

  present(view: View): void {
    this.views.push(view);
  }

  close(): void {}
}

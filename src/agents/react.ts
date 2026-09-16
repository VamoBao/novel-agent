import {
  generateText,
  hasToolCall,
  stepCountIs,
  type ModelMessage,
  type ToolSet,
} from "ai";
import { model } from "../providers/deepseek";

export interface ReactAgentOptions {
  system: string;
  prompt: string;
  tools: ToolSet;
  /** 触发循环终止的「终态工具」名（如 submit_worldview / save_outline） */
  stopTool?: string;
  /** 最大步数上限（每次调用独立计算），防止死循环 */
  maxSteps?: number;
  /**
   * 终态判定（通常闭包检查终态工具是否已执行）。
   * 循环自然结束但判定未完成时（模型只输出文本未调用工具的偶发情况），
   * 自动注入提醒消息续跑，最多 continuationMax 次。
   */
  isDone?: () => boolean;
  /** 续跑次数上限，默认 1 */
  continuationMax?: number;
  /** 续跑时注入的提醒文本（默认按 stopTool 生成） */
  continuationHint?: string;
}

export interface ReactAgentResult {
  /** Agent 最终输出的文本（终态工具触发停止时可能为空） */
  text: string;
  stepCount: number;
  finishReason: string;
  /** 实际发生的续跑次数 */
  continuations: number;
}

/**
 * 通用 ReAct Agent 运行器：单次 generateText 内自动完成「推理 → 工具调用 → 观察」循环。
 *
 * 终态工具模式：调用方定义一个携带 zod schema 的「提交/保存」工具并在 execute 中
 * 闭包记录结果，通过 stopTool 指定其名字，循环在该工具被调用后停止。
 * 这样结果天然经过 schema 校验，也无需解析 toolResults 结构。
 *
 * 续跑：弱模型偶发「宣告要调用工具却只输出文本」即结束轮次；传入 isDone 后，
 * 循环自然结束但终态未达成时会自动追加提醒并带着完整对话历史续跑。
 */
export async function runReactAgent(options: ReactAgentOptions): Promise<ReactAgentResult> {
  const { system, tools, stopTool, maxSteps = 12, isDone, continuationHint } = options;
  const continuationMax = options.continuationMax ?? 1;
  const hint =
    continuationHint ??
    (stopTool !== undefined
      ? `请立即调用 ${stopTool} 工具完成任务，不要只输出文本。`
      : "请继续执行任务并调用相应工具，不要只输出文本。");

  let messages: ModelMessage[] = [{ role: "user", content: options.prompt }];
  let text: string | undefined;
  let stepCount = 0;
  let finishReason: string | undefined;
  let continuations = 0;

  for (;;) {
    const result = await generateText({
      model,
      system,
      messages,
      tools,
      stopWhen: [...(stopTool ? [hasToolCall(stopTool)] : []), stepCountIs(maxSteps)],
    });

    text = result.text;
    stepCount += result.steps.length;
    finishReason = result.finishReason;

    if (isDone?.() ?? true) break;
    if (continuations >= continuationMax) break;
    continuations += 1;
    messages = [...messages, ...result.response.messages, { role: "user", content: hint }];
  }

  return {
    text: text ?? "",
    stepCount,
    finishReason: finishReason ?? "",
    continuations,
  };
}

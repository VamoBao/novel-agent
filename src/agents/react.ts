import { generateText, hasToolCall, stepCountIs, type ToolSet } from "ai";
import { model } from "../providers/deepseek";

export interface ReactAgentOptions {
  system: string;
  prompt: string;
  tools: ToolSet;
  /** 触发循环终止的「终态工具」名（如 submit_worldview / save_outline） */
  stopTool?: string;
  /** 最大步数上限，防止死循环 */
  maxSteps?: number;
}

export interface ReactAgentResult {
  /** Agent 最终输出的文本（终态工具触发停止时可能为空） */
  text: string;
  stepCount: number;
  finishReason: string;
}

/**
 * 通用 ReAct Agent 运行器：单次 generateText 内自动完成「推理 → 工具调用 → 观察」循环。
 *
 * 终态工具模式：调用方定义一个携带 zod schema 的「提交/保存」工具并在 execute 中
 * 闭包记录结果，通过 stopTool 指定其名字，循环在该工具被调用后停止。
 * 这样结果天然经过 schema 校验，也无需解析 toolResults 结构。
 */
export async function runReactAgent(options: ReactAgentOptions): Promise<ReactAgentResult> {
  const { system, prompt, tools, stopTool, maxSteps = 12 } = options;

  const result = await generateText({
    model,
    system,
    prompt,
    tools,
    stopWhen: [
      ...(stopTool ? [hasToolCall(stopTool)] : []),
      stepCountIs(maxSteps),
    ],
  });

  return {
    text: result.text,
    stepCount: result.steps.length,
    finishReason: result.finishReason,
  };
}

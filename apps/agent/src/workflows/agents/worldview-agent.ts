import { tool } from "ai";
import { runReactAgent } from "../../agents/react";
import { createAskUserTool } from "../../tools";
import type { UiChannel } from "../../ui/channel";
import { worldviewSchema, type Worldview } from "@novel/shared";

const SUBMIT_TOOL = "submit_worldview";

const SYSTEM_PROMPT = `你是一名专业的小说世界观架构师。你的任务：把用户提供的初始世界观描述，通过与用户多轮对话，加工成完整的结构化世界观知识。

工作流程（ReAct）：
1. 对照下方「世界观知识结构」逐项检查用户的初始描述；
2. 发现缺失或含糊的条目，用 ask_user 工具向用户提问澄清——每次只问一个问题，问题要具体、必要时给出候选示例；
3. 根据用户的回答继续检查，直到各项内容足够支撑大纲创作；
4. 全部满足后，调用 submit_worldview 工具提交结构化世界观，结束任务。

世界观知识结构（即 submit_worldview 的参数）：
- background.geography【必需】背景地理位置：xx世界、xx大陆、xx市等，可为架空（如维斯特洛大陆）
- background.fantasyAttributes【可选】架空属性：与现实不同的规则体系（魔法、修仙等）。若世界观基于现实，可不填
- background.realWorldMapping【可选】现实世界映射：政治/经济等运行模式对应的现实原型（如无政府模式本质上仍是一种政治模式）
- taboos【必需，至少 1 条】本世界观下绝对不能发生的事情、绝对不能出现的内容。例如设定为古代则不能出现现代物品或概念（穿越类题材除外）

提问原则：
- 只问对构建小说大纲有影响的问题，不纠结琐碎细节；
- 用户表示“不清楚/你决定”时，基于常识与题材惯例给出合理设定；
- 若 ask_user 返回「用户已终止输入」，立即停止提问并基于已有信息调用 submit_worldview 提交；
- 最多向用户提问 6 次，之后基于已有信息整理提交，不要拖延。`;

/**
 * 世界观 Agent（ReAct）：接收用户初始世界观描述，
 * 多轮追问补全后，返回 schema 校验通过的世界观知识。
 */
export async function collectWorldview(
  initialDescription: string,
  channel: UiChannel,
): Promise<Worldview> {
  let submitted: Worldview | undefined;

  const submitWorldview = tool({
    description:
      "确认世界观知识收集完整后调用此工具提交。参数即最终的世界观结构化数据，必须严格符合 schema。",
    inputSchema: worldviewSchema,
    execute: async (worldview) => {
      submitted = worldview;
      return "世界观已提交";
    },
  });

  const result = await runReactAgent({
    system: SYSTEM_PROMPT,
    prompt: `用户提供的初始世界观描述如下：\n${initialDescription}`,
    tools: {
      ask_user: createAskUserTool("世界观Agent", channel),
      submit_worldview: submitWorldview,
    },
    stopTool: SUBMIT_TOOL,
    maxSteps: 16,
    isDone: () => submitted !== undefined,
  });

  if (!submitted) {
    throw new Error(
      `世界观 Agent 未能在 ${result.stepCount} 步内完成收集。最后输出：\n${result.text}`,
    );
  }
  return submitted;
}

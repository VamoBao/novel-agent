import { tool } from "ai";
import { z } from "zod";
import { askLine } from "../cli/prompt";

/**
 * 向用户提问并等待回答：ReAct Agent 与用户多轮对话的桥。
 * 供世界观 Agent 等需要澄清交互的 subAgent 使用。
 */
export const askUserTool = tool({
  description:
    "向用户提出一个需要澄清的问题并等待其回答。每次只问一个问题，问题要具体。",
  inputSchema: z.object({
    question: z.string().min(1).describe("要问用户的问题，一次只问一个"),
  }),
  execute: async ({ question }) => {
    const answer = await askLine(`\n🌍 [世界观Agent] ${question}\n> `);
    if (answer === null) {
      return { ok: false, answer: null, note: "用户已终止输入（EOF）" };
    }
    if (answer.length === 0) {
      return { ok: false, answer: "", note: "用户留空未作答" };
    }
    return { ok: true, answer };
  },
});

import { tool } from "ai";
import { z } from "zod";
import type { UiChannel } from "../ui/channel";

/**
 * 向用户提问并等待回答：ReAct Agent 与用户多轮对话的桥。
 * 供世界观 / 角色等需要澄清交互的 subAgent 使用；speaker 为提问时展示的 Agent 标签。
 * 经注入的 UiChannel 提问（CLI 为终端输入，协议模式为客户端问答）。
 */
export function createAskUserTool(speaker: string, channel: UiChannel) {
  return tool({
    description:
      "向用户提出一个需要澄清的问题并等待其回答。每次只问一个问题，问题要具体。",
    inputSchema: z.object({
      question: z.string().min(1).describe("要问用户的问题，一次只问一个"),
    }),
    execute: async ({ question }) => {
      const answer = await channel.askLine(`\n🤖 [${speaker}] ${question}\n> `);
      if (answer === null) {
        return {
          ok: false as const,
          answer: null,
          note: "用户已终止输入（EOF），请立即停止提问并结束任务",
        };
      }
      if (answer.length === 0) {
        return { ok: false as const, answer: "", note: "用户留空未作答" };
      }
      return { ok: true as const, answer };
    },
  });
}

import { tool } from "ai";
import { runReactAgent } from "../../agents/react";
import type { UiChannel } from "../../ui/channel";
import { chapterPlanSchema, type ChapterPlan } from "@novel/shared";

const SYSTEM_PROMPT = `你是一名资深小说编辑。你的任务：把给定的一幕（act）拆解为若干章（chapter）的章节规划，供后续逐章写作。

章节规划要求：
1. 章节数量由你根据本幕梗概与关键情节点的密度推荐（通常 3~8 章，最少 1 章、最多 12 章）——情节点多、转折密集就多分几章，节奏平缓就少分；
2. 每章有章名与本章剧情概述（两三句话讲清本章发生的事件、出场角色与本章在幕中的作用）；
3. 章节按时间与因果关系顺序推进，本幕的关键情节点必须全部覆盖、合理分配到具体章节，不留遗漏；
4. 章章有推进：每章至少推进一个情节点或完成一次人物状态变化，不写原地踏步的章节；
5. 章名贴合小说调性，概括本章核心事件或意象。

完成后调用 save_chapters 工具保存章节规划（参数即完整规划，必须严格符合 schema）。save_chapters 会把本幕梗概、关键情节点与推荐的章节列表展示给用户确认：用户确认后保存完成；用户提出修改意见时，根据反馈调整规划后重新调用 save_chapters，直到用户确认为止。`;

/** 章节规划的输入上下文：大纲全局信息 + 所属部 + 目标幕（模型按幕内容推荐章节数量） */
export interface PlanChaptersInput {
  novelTitle: string;
  logline: string;
  theme?: string;
  partName: string;
  partSummary: string;
  actName: string;
  actSummary: string;
  keyPlotPoints: ReadonlyArray<string>;
}

/**
 * 章节 Agent（ReAct）：基于一幕的梗概与关键情节点推荐「章名 + 剧情概述」的章节规划，
 * 经用户「确认 / 修改意见 → 调整 → 再确认」循环后才完成。
 */
export async function planChapters(input: PlanChaptersInput, channel: UiChannel): Promise<ChapterPlan> {
  let saved: ChapterPlan | undefined;

  const saveChapters = tool({
    description:
      "章节规划完成后调用此工具保存。会把本幕梗概、关键情节点与推荐的章节列表展示给用户做最终确认：用户确认后保存完成；用户提出修改意见时，需根据反馈调整规划后重新调用。",
    inputSchema: chapterPlanSchema,
    execute: async (plan) => {
      const confirmed = await channel.askConfirm("以上章节规划是否确认？", {
        default: true,
        view: {
          kind: "chapter-plan",
          actName: input.actName,
          actSummary: input.actSummary,
          keyPlotPoints: [...input.keyPlotPoints],
          plan,
        },
      });
      if (confirmed) {
        saved = plan;
        return { ok: true as const };
      }
      const feedback = await channel.askText("请说明章节规划需要调整的地方> ");
      return {
        ok: false as const,
        feedback,
        note: "用户要求调整，请根据反馈修改章节规划后重新调用 save_chapters",
      };
    },
  });

  const result = await runReactAgent({
    system: SYSTEM_PROMPT,
    prompt: [
      `小说：《${input.novelTitle}》——${input.logline}`,
      ...(input.theme ? [`主题：${input.theme}`] : []),
      `所属部：${input.partName}（${input.partSummary}）`,
      `目标幕：${input.actName}`,
      `本幕梗概：${input.actSummary}`,
      `本幕关键情节点：\n${input.keyPlotPoints.map((p, i) => `${i + 1}. ${p}`).join("\n")}`,
      "请基于以上内容推荐本幕的章节规划并调用 save_chapters 保存。",
    ].join("\n\n"),
    tools: { save_chapters: saveChapters },
    // 不设 stopTool：save_chapters 可能被用户否决（需继续修订），
    // hasToolCall 会在工具被调用时无条件停止，无法表达「提交被拒需继续」
    maxSteps: 12,
    isDone: () => saved !== undefined,
    continuationHint: "请立即调用 save_chapters 工具保存章节规划（参数为完整规划），不要只输出文本。",
  });

  if (!saved) {
    throw new Error(
      `章节 Agent 未能在 ${result.stepCount} 步内完成规划。最后输出：\n${result.text}`,
    );
  }
  return saved;
}

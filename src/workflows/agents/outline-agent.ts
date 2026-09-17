import { tool } from "ai";
import { runReactAgent } from "../../agents/react";
import { outlineSchema, type Outline } from "../../schemas";
import type { NovelParams } from "../../state/types";
import { askConfirm, askRequired } from "../../cli/prompt";

const SYSTEM_PROMPT = `你是一名资深小说编辑与故事结构师。你的任务：基于给定的创作参数（类型、受众、世界观、角色、核心冲突）创作一本小说的大纲。

要求：
1. 大纲必须围绕核心冲突组织：冲突的「由来」对应开端与铺垫，「对角色的影响」推动中段发展，「理想的解决结果」指向结局；
2. 严格遵守世界观设定，尤其不得违背 taboos（禁忌）中的任何条目；
3. 每个角色严格遵循其角色卡：叙事定位决定戏份权重，行为贴合其内核（渴望/恐惧）、性格与背景；尊重每个角色的创作目的与结局方向，主角需有清晰的成长弧光；
4. 结构至少三幕（可更多），每一幕给出梗概与关键情节点；
5. 标题要契合类型与调性，logline 用一句话讲清「谁+想要什么+障碍+代价」。

完成后调用 save_outline 工具保存大纲（参数即完整大纲，必须严格符合 schema）。save_outline 会把大纲的剧情梗概、主题、每一幕的名称与概述展示给用户确认：用户确认后保存完成；用户提出修改意见时，根据反馈调整大纲后重新调用 save_outline，直到用户确认为止。`;

/** 确认视图：剧情梗概、主题、每幕名称与概述（拼入确认提示原子出现；详细情节点在保存后完整展示） */
function formatOutlineForConfirm(o: Outline): string {
  const lines = [`📖 大纲草稿：《${o.title}》`, `  剧情梗概：${o.logline}`];
  if (o.theme) lines.push(`  主题：${o.theme}`);
  for (const act of o.acts) {
    lines.push(`  ▶ ${act.name}：${act.summary}`);
  }
  return lines.join("\n");
}

/**
 * 大纲 Agent（ReAct）：基于初始化收集的创作参数生成小说大纲，
 * 经用户「确认 / 修改意见 → 调整 → 再确认」循环后才完成。
 * novelTitle 为用户已命名的书名时，大纲标题必须沿用该书名。
 */
export async function createOutline(
  params: NovelParams,
  novelTitle?: string,
): Promise<Outline> {
  let saved: Outline | undefined;

  const saveOutline = tool({
    description:
      "大纲完成后调用此工具保存。会把大纲的剧情梗概、主题、每幕名称与概述展示给用户做最终确认：用户确认后保存完成；用户提出修改意见时，需根据反馈调整大纲后重新调用。",
    inputSchema: outlineSchema,
    execute: async (outline) => {
      if (await askConfirm(`\n${formatOutlineForConfirm(outline)}\n以上大纲是否确认？`, true)) {
        saved = outline;
        return { ok: true as const };
      }
      const feedback = await askRequired("请说明大纲需要调整的地方> ");
      return {
        ok: false as const,
        feedback,
        note: "用户要求调整，请根据反馈修改大纲后重新调用 save_outline",
      };
    },
  });

  const result = await runReactAgent({
    system: SYSTEM_PROMPT,
    prompt: [
      `创作参数如下（JSON）：\n${JSON.stringify(params, null, 2)}`,
      ...(novelTitle
        ? [`小说已由用户命名为《${novelTitle}》，大纲的 title 字段必须使用该名称。`]
        : []),
    ].join("\n\n"),
    tools: { save_outline: saveOutline },
    // 不设 stopTool：save_outline 可能被用户否决（需继续修订），
    // hasToolCall 会在工具被调用时无条件停止，无法表达「提交被拒需继续」
    maxSteps: 12,
    isDone: () => saved !== undefined,
    continuationHint: "请立即调用 save_outline 工具保存大纲（参数为完整大纲），不要只输出文本。",
  });

  if (!saved) {
    throw new Error(
      `大纲 Agent 未能在 ${result.stepCount} 步内完成创作。最后输出：\n${result.text}`,
    );
  }
  return saved;
}

import { tool } from "ai";
import { runReactAgent } from "../../agents/react";
import type { UiChannel } from "../../ui/channel";
import { outlineSchema, type Outline } from "@novel/shared";
import type { NovelParams } from "../../state/types";

const SYSTEM_PROMPT = `你是一名资深小说编辑与故事结构师。你的任务：基于给定的创作参数（类型、受众、世界观、角色、核心冲突）创作一本小说的大纲。

大纲为两级结构：
- 全书分为若干部（part），每部是故事的一个宏观段落：有部名与本部梗概（概括该部在整体故事中的位置与作用）；
- 每部包含若干幕（act），每幕有幕名、梗概与关键情节点；
- 部数与总幕数必须与结构要求完全一致，每部至少 1 幕；各部包含几幕由你按剧情节奏与冲突推进决定。

要求：
1. 大纲必须围绕核心冲突组织：冲突的「由来」对应开端与铺垫，「对角色的影响」推动中段发展，「理想的解决结果」指向结局；
2. 严格遵守世界观设定，尤其不得违背 taboos（禁忌）中的任何条目；
3. 每个角色严格遵循其角色卡：叙事定位决定戏份权重，行为贴合其内核（渴望/恐惧）、性格与背景；尊重每个角色的创作目的与结局方向，主角需有清晰的成长弧光；
4. 每一幕给出梗概与关键情节点；
5. 标题要契合类型与调性，logline 用一句话讲清「谁+想要什么+障碍+代价」。

完成后调用 save_outline 工具保存大纲（参数即完整大纲，必须严格符合 schema，且部数与总幕数必须与要求完全一致）。save_outline 会把大纲的剧情梗概、主题、每部概述与每幕名称概述展示给用户确认：用户确认后保存完成；用户提出修改意见时，根据反馈调整大纲后重新调用 save_outline，直到用户确认为止。`;

/** 结构强校验 schema：save_outline 入参必须恰好为 partCount 部、共 actCount 幕（SDK 先校验再执行，模型给错即拒绝重试） */
export function outlineSchemaFor(actCount: number, partCount: number) {
  return outlineSchema.refine(
    (o) =>
      o.parts.length === partCount &&
      o.parts.reduce((sum, p) => sum + p.acts.length, 0) === actCount,
    `大纲必须恰好为 ${partCount} 部、共 ${actCount} 幕`,
  );
}

export interface CreateOutlineOptions {
  /** 用户已命名的书名；指定时大纲 title 必须沿用 */
  novelTitle?: string;
  /** 大纲总幕数（用户指定，默认 5） */
  actCount: number;
  /** 部数（用户指定，默认 1） */
  partCount: number;
}

/** 确认视图格式化：已迁至 ui/cli-channel（renderView 的 outline/confirm 分支） */

/**
 * 大纲 Agent（ReAct）：基于初始化收集的创作参数生成「部 → 幕」两级大纲，
 * 经用户「确认 / 修改意见 → 调整 → 再确认」循环后才完成。
 */
export async function createOutline(
  params: NovelParams,
  options: CreateOutlineOptions,
  channel: UiChannel,
): Promise<Outline> {
  const { novelTitle, actCount, partCount } = options;
  let saved: Outline | undefined;

  const saveOutline = tool({
    description:
      "大纲完成后调用此工具保存。会把大纲的剧情梗概、主题、每部概述与每幕名称概述展示给用户做最终确认：用户确认后保存完成；用户提出修改意见时，需根据反馈调整大纲后重新调用。",
    inputSchema: outlineSchemaFor(actCount, partCount),
    execute: async (outline) => {
      const confirmed = await channel.askConfirm("以上大纲是否确认？", {
        default: true,
        view: { kind: "outline", detail: "confirm", outline },
      });
      if (confirmed) {
        saved = outline;
        return { ok: true as const };
      }
      const feedback = await channel.askText("请说明大纲需要调整的地方> ");
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
      `大纲结构要求：恰好 ${partCount} 部、共 ${actCount} 幕（每部至少 1 幕），各部幕数按剧情节奏分配。`,
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

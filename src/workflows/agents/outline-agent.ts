import { tool } from "ai";
import { runReactAgent } from "../../agents/react";
import { outlineSchema, type Outline } from "../../schemas";
import type { NovelParams } from "../../state/types";

const SAVE_TOOL = "save_outline";

const SYSTEM_PROMPT = `你是一名资深小说编辑与故事结构师。你的任务：基于给定的创作参数（类型、受众、世界观、角色、核心冲突）创作一本小说的大纲。

要求：
1. 大纲必须围绕核心冲突组织：冲突的「由来」对应开端与铺垫，「对角色的影响」推动中段发展，「理想的解决结果」指向结局；
2. 严格遵守世界观设定，尤其不得违背 taboos（禁忌）中的任何条目；
3. 每个角色严格遵循其角色卡：叙事定位决定戏份权重，行为贴合其内核（渴望/恐惧）、性格与背景；尊重每个角色的创作目的与结局方向，主角需有清晰的成长弧光；
4. 结构至少三幕（可更多），每一幕给出梗概与关键情节点；
5. 标题要契合类型与调性，logline 用一句话讲清「谁+想要什么+障碍+代价」。

完成后调用 save_outline 工具保存大纲（参数即最终大纲，必须严格符合 schema）。`;

/**
 * 大纲 Agent（ReAct）：基于初始化收集的创作参数生成小说大纲。
 */
export async function createOutline(params: NovelParams): Promise<Outline> {
  let saved: Outline | undefined;

  const saveOutline = tool({
    description: "大纲完成后调用此工具保存。参数即最终大纲，必须严格符合 schema。",
    inputSchema: outlineSchema,
    execute: async (outline) => {
      saved = outline;
      return "大纲已保存";
    },
  });

  const result = await runReactAgent({
    system: SYSTEM_PROMPT,
    prompt: `创作参数如下（JSON）：\n${JSON.stringify(params, null, 2)}`,
    tools: { save_outline: saveOutline },
    stopTool: SAVE_TOOL,
    maxSteps: 8,
    isDone: () => saved !== undefined,
  });

  if (!saved) {
    throw new Error(
      `大纲 Agent 未能在 ${result.stepCount} 步内完成创作。最后输出：\n${result.text}`,
    );
  }
  return saved;
}

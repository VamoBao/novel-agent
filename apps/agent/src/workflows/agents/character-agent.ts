import { tool } from "ai";
import { z } from "zod";
import { runReactAgent } from "../../agents/react";
import { createAskUserTool } from "../../tools";
import type { UiChannel } from "../../ui/channel";
import { characterSchema, type Character } from "@novel/shared";

/**
 * 字段协议：角色 Agent 可保存的字段（与 characterSchema 一一对应）。
 * required 集合 = 姓名 + 内核三维 + 背景 + 创作目的 + 结局方向，
 * 其中内核/背景/创作目的/结局方向为角色生成后固定不变的属性。
 */
export const FIELD_NAMES = [
  "name",
  "gender",
  "appearance",
  "desire",
  "fear",
  "narrativeRole",
  "background",
  "personality",
  "characterGoal",
  "creationPurpose",
  "trajectory",
  "endingDirection",
  "relationships",
] as const;

export type CharacterField = (typeof FIELD_NAMES)[number];

export const FIELD_SPECS: Record<CharacterField, { label: string; required: boolean; desc: string }> = {
  name: { label: "姓名", required: true, desc: "角色姓名" },
  gender: { label: "性别", required: false, desc: "性别" },
  appearance: { label: "外貌特征", required: false, desc: "外貌特点" },
  desire: { label: "核心渴望", required: true, desc: "内核：这个角色想要什么" },
  fear: { label: "核心恐惧", required: true, desc: "内核：这个角色害怕什么" },
  narrativeRole: { label: "叙事定位", required: true, desc: "内核：功能角色（主角/配角/反派等）" },
  background: { label: "背景", required: true, desc: "门派/师承/身世等背景信息" },
  personality: { label: "性格", required: false, desc: "决定做事方式与说话风格" },
  characterGoal: { label: "角色目的", required: false, desc: "故事线中的最终目的（如成为海贼王）" },
  creationPurpose: { label: "创作目的", required: true, desc: "创作者创建该角色所服务的东西" },
  trajectory: { label: "轨迹", required: false, desc: "概括性的人生轨迹" },
  endingDirection: { label: "结局方向", required: true, desc: "最终结局走向（如为主角牺牲）" },
  relationships: { label: "关系", required: false, desc: "与其他角色的概括性关系" },
};

/** 尚未确认保存的必填字段标签（供工具反馈与提示词构建） */
export function missingRequiredFields(
  record: Partial<Record<CharacterField, string>>,
): string[] {
  return FIELD_NAMES.filter(
    (f) => FIELD_SPECS[f].required && !(record[f] ?? "").trim(),
  ).map((f) => FIELD_SPECS[f].label);
}

/** 把逐字段确认后的记录组装并经 schema 校验为 Character（纯函数，可单测） */
export function assembleCharacter(
  record: Partial<Record<CharacterField, string>>,
): Character {
  return characterSchema.parse({
    basicInfo: {
      name: record.name ?? "",
      gender: record.gender,
      appearance: record.appearance,
    },
    core: {
      desire: record.desire ?? "",
      fear: record.fear ?? "",
      narrativeRole: record.narrativeRole ?? "",
    },
    background: record.background ?? "",
    personality: record.personality,
    characterGoal: record.characterGoal,
    creationPurpose: record.creationPurpose ?? "",
    trajectory: record.trajectory,
    endingDirection: record.endingDirection ?? "",
    relationships: record.relationships,
  });
}

/** 格式化完整角色卡：已迁至 ui/cli-channel（renderView 的 character-card 分支） */

const SYSTEM_PROMPT = `你是一名专业的小说角色策划。你的任务：通过与用户多轮对话，为一名新角色完成结构化角色卡。

角色卡字段（field 名 → 说明，标★为必填）：
- name ★姓名
- gender 性别
- appearance 外貌特征
- desire ★核心渴望（内核：这个角色想要什么）
- fear ★核心恐惧（内核：这个角色害怕什么）
- narrativeRole ★叙事定位（内核：主角/配角/反派等功能角色）
- background ★背景（门派/师承/身世等）
- personality 性格（决定做事方式与说话风格）
- characterGoal 角色目的（故事线中的最终目的，如「成为海贼王」）
- creationPurpose ★创作目的（创作者创建该角色所服务的东西，如「作为强敌逼出主角的成长」）
- trajectory 轨迹（概括性的人生轨迹）
- endingDirection ★结局方向（如「为主角牺牲」「被主角击败」）
- relationships 关系（与其他角色的概括性关系）

工作流程（ReAct）：
1. 阅读用户的初始角色描述，判断哪些字段已有可用信息；
2. 已有信息的字段：用一两句话概括总结（严禁改写姓名/身份等用户明确给出的信息，不得虚构）后调用 save_field 保存；
3. 缺失的必填字段：用 ask_user 向用户征集文本，一次只问一个字段，问题要具体；
4. save_field 会把总结展示给用户确认：用户给出调整意见时，按反馈修正后重新保存该字段；用户放弃则跳过（仅可选字段可跳过）；
5. 所有必填字段均确认保存后，调用 submit_character 提交——工具会把完整角色卡展示给用户做最终确认：用户确认后角色创建结束；用户提出补充或调整意见时，用 ask_user / save_field 处理该反馈后再次调用 submit_character；
6. 可选字段：用户提及即可保存；用户未提及且非关键时可留空，不要反复纠缠。

原则：
- 保存「创作目的」时从创作者视角描述（该角色服务于故事的什么功能），而非角色自身的主观愿望；
- 已有角色会随对话提供，「关系」字段可引用他们；
- 若 ask_user 返回「用户已终止输入」，立即停止提问并结束任务；`;

/**
 * 角色 Agent（ReAct）：接收用户初始角色描述，
 * 逐字段「用户输入 → 概括总结 → 用户确认 → 保存」，必填字段齐全后组装返回角色卡。
 */
export async function createCharacter(
  initialDescription: string,
  existingCharacters: readonly Character[] = [],
  channel: UiChannel,
): Promise<Character> {
  const record: Partial<Record<CharacterField, string>> = {};
  let submitted: Character | undefined;

  const existingLine =
    existingCharacters.length > 0
      ? `已有角色：${existingCharacters
          .map((c) => `${c.basicInfo.name}（${c.core.narrativeRole}）`)
          .join("、")}\n\n`
      : "";

  const saveField = tool({
    description:
      "把对某个字段的概括总结保存到角色卡。调用后会展示总结请用户确认；用户要求调整时需按反馈修正后重新保存该字段。",
    inputSchema: z.object({
      field: z.enum(FIELD_NAMES).describe("要保存的字段名"),
      summary: z
        .string()
        .min(1)
        .describe("基于用户输入概括总结的内容，将原样保存到该字段"),
    }),
    execute: async ({ field, summary }) => {
      const label = FIELD_SPECS[field].label;
      // 摘要作为确认视图与提问原子绑定：并发调用 save_field 时提示语按队列顺序逐个出现，
      // 用户始终知道自己在确认哪个字段
      const confirmed = await channel.askConfirm("确认保存该字段？", {
        default: true,
        view: { kind: "field-summary", label, summary },
      });
      if (confirmed) {
        record[field] = summary;
        return {
          ok: true as const,
          field,
          missingRequired: missingRequiredFields(record),
        };
      }
      const feedback = await channel.askText(
        `请说明【${label}】需要调整的地方（直接回车表示放弃本次保存）> `,
        { optional: true },
      );
      if (feedback.length === 0) {
        return { ok: false as const, field, note: "用户放弃本次保存" };
      }
      return { ok: false as const, field, feedback };
    },
  });

  const submitCharacter = tool({
    description:
      "所有必填字段（姓名、核心渴望、核心恐惧、叙事定位、背景、创作目的、结局方向）均确认保存后调用。会把完整角色卡展示给用户做最终确认：用户确认完成后角色创建结束；用户提出补充或调整意见时，需用 ask_user / save_field 处理后再次调用。",
    inputSchema: z.object({}),
    execute: async () => {
      const missing = missingRequiredFields(record);
      if (missing.length > 0) {
        return { ok: false as const, missing, note: "请继续用 ask_user 补全上述字段" };
      }
      const assembled = assembleCharacter(record);
      const confirmed = await channel.askConfirm("以上角色卡是否确认完成？", {
        default: true,
        view: { kind: "character-card", character: assembled },
      });
      if (confirmed) {
        submitted = assembled;
        return { ok: true as const };
      }
      const feedback = await channel.askText("请说明需要补充或调整的内容> ");
      return {
        ok: false as const,
        feedback,
        note: "用户要求调整，请处理该反馈后重新提交",
      };
    },
  });

  const result = await runReactAgent({
    system: SYSTEM_PROMPT,
    prompt: `${existingLine}用户对新角色的初始描述：\n${initialDescription}`,
    tools: {
      ask_user: createAskUserTool("角色Agent", channel),
      save_field: saveField,
      submit_character: submitCharacter,
    },
    // 不设 stopTool：submit_character 校验失败时（缺必填字段）循环必须继续，
    // 而 hasToolCall 会在工具被调用时无条件停止，故仅用 maxSteps 兜底
    maxSteps: 30,
    isDone: () => submitted !== undefined,
    continuationHint:
      "若所有必填字段均已确认保存，请立即调用 submit_character 工具提交角色卡；否则继续用 ask_user / save_field 补全，不要只输出文本。",
  });

  if (!submitted) {
    throw new Error(
      `角色 Agent 未能在 ${result.stepCount} 步内完成角色卡（缺失：${missingRequiredFields(record).join("、") || "未知"}）。最后输出：\n${result.text}`,
    );
  }
  return submitted;
}

import { tool } from "ai";
import { z } from "zod";
import { runReactAgent } from "../../agents/react";
import type { UiChannel } from "../../ui/channel";
import { getDefaultCharacterStore, type CharacterStore } from "../../state/character-store";
import type { StoredForeshadow } from "../../state/foreshadow-store";
import {
  chapterPlanSchema,
  newCharacterSchema,
  chapterNewForeshadowSchema,
  foreshadowBindingSchema,
  type ChapterPlan,
  type NewCharacterOutline,
  type ChapterNewForeshadow,
  type ForeshadowBinding,
} from "@novel/shared";

const SYSTEM_PROMPT = `你是一名资深小说编辑。你的任务：把给定的一幕（act）拆解为若干章（chapter）的章节规划，供后续逐章写作。

章节规划要求：
1. 章节数量由你根据本幕梗概与关键情节点的密度推荐（通常 3~8 章，最少 1 章、最多 12 章）——情节点多、转折密集就多分几章，节奏平缓就少分；
2. 每章有章名与本章剧情概述（两三句话讲清本章发生的事件、出场角色与本章在幕中的作用）；
3. 章节按时间与因果关系顺序推进，本幕的关键情节点必须全部覆盖、合理分配到具体章节，不留遗漏；
4. 章章有推进：每章至少推进一个情节点或完成一次人物状态变化，不写原地踏步的章节；
5. 章名贴合小说调性，概括本章核心事件或意象。

角色梳理要求：
1. 章节概述尽量点名本章出场角色——角色库已有角色使用其真实名字，新角色使用其清单中的名字，让后续写作能直接按概述确定出场阵容；
2. 登场角色不在角色库中时，必须将其列入 save_chapters 的 newCharacters：name 为角色名，role 为一句话定位并注明登场章（如「第3章登场·血宗打手」）；清单内名字不得重复，角色库已有角色不得列入；
3. 可用 list_characters 工具查询角色库现状。newCharacters 会在确认时随规划一并展示给用户：确认后这些角色将自动填充角色卡并入库。

伏笔梳理要求：
1. 若「本幕未绑登场章的伏笔」清单中的伏笔会在你规划的章节中出现，必须在 foreshadowBindings 中输出绑定（index = 清单序号，chapterName = 登场章名——必须是本次规划中的真实章名）；不在本幕出现的伏笔不要绑定；
2. 规划中发现新的伏笔时列入 newForeshadows（surfaceAction / hiddenTruth / attentionLevel 1-10 / characterNames 服务角色名 / chapterName 登场章名）；
3. 章节概述尽量体现伏笔的表面行为，让正文写作有据可依；
4. 两组清单内 surfaceAction / 序号均不得重复；确认后新伏笔自动入库、绑定自动生效。

完成后调用 save_chapters 工具保存章节规划（参数 = 完整规划 + newCharacters 新增角色清单，必须严格符合 schema）。save_chapters 会把本幕梗概、关键情节点与推荐的章节列表展示给用户确认：用户确认后保存完成；用户提出修改意见时，根据反馈调整规划后重新调用 save_chapters，直到用户确认为止。`;

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

/** 章节 Agent 的注入项：角色库查询按 novelId 进行，store 可替换（测试） */
export interface PlanChaptersAgentOptions {
  /** 目标小说创作 ID（list_characters 工具按此查询角色库） */
  novelId: string;
  /** 角色库 store；缺省默认 SQLite store（测试可替换） */
  characterStore?: CharacterStore;
  /** 本幕「未绑登场章」的伏笔（编排层查好传入；有则带序号回传给 LLM 供绑定登场章） */
  unboundForeshadows?: readonly StoredForeshadow[];
}

/** save_chapters 的结构化入参：章节规划 + 新增角色清单（项内名字不得重复）+ 新伏笔清单（项内表面行为不得重复）与伏笔绑定指令（序号不得重复） */
export const saveChaptersInputSchema = chapterPlanSchema.extend({
  newCharacters: z
    .array(newCharacterSchema)
    .refine((list) => new Set(list.map((c) => c.name)).size === list.length, "新增角色清单内名字不得重复"),
  newForeshadows: z
    .array(chapterNewForeshadowSchema)
    .refine((list) => new Set(list.map((f) => f.surfaceAction)).size === list.length, "伏笔清单内表面行为不得重复"),
  foreshadowBindings: z
    .array(foreshadowBindingSchema)
    .refine((list) => new Set(list.map((b) => b.index)).size === list.length, "伏笔绑定指令内序号不得重复"),
});

/** 章节 Agent 的最终产物：确认通过的规划本体 + 随规划连带确认的新增角色清单与新伏笔清单、既有伏笔绑定指令 */
export interface ChapterPlanSubmission {
  plan: ChapterPlan;
  newCharacters: NewCharacterOutline[];
  newForeshadows: ChapterNewForeshadow[];
  foreshadowBindings: ForeshadowBinding[];
}

/**
 * 章节 Agent（ReAct）：基于一幕的梗概与关键情节点推荐「章名 + 剧情概述」的章节规划，
 * 经用户「确认 / 修改意见 → 调整 → 再确认」循环后才完成。
 */
export async function planChapters(
  input: PlanChaptersInput,
  channel: UiChannel,
  options: PlanChaptersAgentOptions,
): Promise<ChapterPlanSubmission> {
  const { novelId } = options;
  const characterStore = options.characterStore ?? getDefaultCharacterStore();
  let saved: ChapterPlanSubmission | undefined;

  /** 角色库查询工具：返回库内全部角色名与叙事定位，供模型点名概述与梳理「新增角色」 */
  const listCharacters = tool({
    description:
      "查询角色库中已有的全部角色（名字与叙事定位）。梳理 newCharacters 时必须先调用此工具：清单中只能列角色库中没有的角色，库内已有角色不得列入。",
    inputSchema: z.object({}),
    execute: async () => {
      const rows = characterStore.listCharacters(novelId);
      return {
        characters: rows.map((r) => ({ name: r.character.basicInfo.name, narrativeRole: r.character.core.narrativeRole })),
      };
    },
  });

  const saveChapters = tool({
    description:
      "章节规划完成后调用此工具保存（参数 = 完整规划 + newCharacters 新增角色清单 + newForeshadows 新伏笔与 foreshadowBindings 绑定）。会把本幕梗概、关键情节点、推荐的章节列表与新增角色清单展示给用户做最终确认：用户确认后保存完成；用户提出修改意见时，需根据反馈调整规划后重新调用。",
    inputSchema: saveChaptersInputSchema,
    execute: async (inputPlan) => {
      const { newCharacters, newForeshadows, foreshadowBindings, ...plan } = inputPlan;
      const confirmed = await channel.askConfirm("以上章节规划是否确认？", {
        default: true,
        view: {
          kind: "chapter-plan",
          actName: input.actName,
          actSummary: input.actSummary,
          keyPlotPoints: [...input.keyPlotPoints],
          plan,
          newCharacters,
          newForeshadows,
          foreshadowBindings,
        },
      });
      if (confirmed) {
        saved = { plan, newCharacters, newForeshadows, foreshadowBindings };
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

  const libraryRows = characterStore.listCharacters(novelId);

  const result = await runReactAgent({
    system: SYSTEM_PROMPT,
    prompt: [
      `小说：《${input.novelTitle}》——${input.logline}`,
      ...(input.theme ? [`主题：${input.theme}`] : []),
      `所属部：${input.partName}（${input.partSummary}）`,
      `目标幕：${input.actName}`,
      `本幕梗概：${input.actSummary}`,
      `本幕关键情节点：\n${input.keyPlotPoints.map((p, i) => `${i + 1}. ${p}`).join("\n")}`,
      libraryRows.length > 0
        ? `角色库已有角色：${libraryRows.map((r) => `${r.character.basicInfo.name}（${r.character.core.narrativeRole}）`).join("、")}`
        : "角色库暂无角色",
      ...(options.unboundForeshadows && options.unboundForeshadows.length > 0
        ? [
            `本幕未绑登场章的伏笔（序号. 表面行为——隐藏真相）：\n${options.unboundForeshadows
              .map((f, i) => `${i + 1}. ${f.foreshadow.surfaceAction}——${f.foreshadow.hiddenTruth}`)
              .join("\n")}`,
          ]
        : []),
      "请基于以上内容推荐本幕的章节规划并调用 save_chapters 保存。",
    ].join("\n\n"),
    tools: { save_chapters: saveChapters, list_characters: listCharacters },
    // 不设 stopTool：save_chapters 可能被用户否决（需继续修订）
    maxSteps: 12,
    isDone: () => saved !== undefined,
    continuationHint:
      "请立即调用 save_chapters 工具保存章节规划（参数为完整规划与 newCharacters / newForeshadows / foreshadowBindings 清单），不要只输出文本。",
  });

  if (!saved) {
    throw new Error(
      `章节 Agent 未能在 ${result.stepCount} 步内完成规划。最后输出：\n${result.text}`,
    );
  }
  return saved;
}

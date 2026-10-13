import { tool } from "ai";
import { z } from "zod";
import { runReactAgent } from "../../agents/react";
import type { UiChannel } from "../../ui/channel";
import { getDefaultCharacterStore, type CharacterStore } from "../../state/character-store";
import { getDefaultLocationStore, type LocationStore } from "../../state/location-store";
import type { StoredForeshadow } from "../../state/foreshadow-store";
import { collectChapterCharacters, filterNewCharacters } from "./auto-character-agent";
import {
  chapterPlanSchema,
  newLocationSchema,
  chapterNewForeshadowSchema,
  foreshadowBindingSchema,
  type ChapterPlan,
  type NewCharacterOutline,
  type NewLocation,
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
1. 每章在 characters 中列出本章全部登场角色——角色库已有角色与新角色都要列：确认后各章登场角色的 ID 会绑定到章节点，正文生成时按绑定注入角色资料，遗漏即该角色资料缺席本章写作；
2. name 为角色名（库内已有角色必须用其真实名字），role 为该角色在本章的定位/作用一句话；不在角色库中的新角色，role 须给设定级一句话定位（如「血宗宗主·本章首次登场的主要反派」）——确认后将以此定位为依据自动创建角色卡；
3. 同一章的登场角色名字不得重复，每章至少 1 名登场角色；
4. 可用 list_characters 工具查询角色库现状，库内已有角色不得当新角色。确认时不在角色库中的登场角色会汇总展示为「本次规划新增角色」：确认后自动填充角色卡并入库；
5. 章节概述尽量点名出场角色，与 characters 清单保持一致。

伏笔梳理要求：
1. 若「本幕未绑登场章的伏笔」清单中的伏笔会在你规划的章节中出现，必须在 foreshadowBindings 中输出绑定（index = 清单序号，chapterName = 登场章名——必须是本次规划中的真实章名）；不在本幕出现的伏笔不要绑定；
2. 若「本幕待回收伏笔」清单中的伏笔（真相揭晓幕 = 本幕）会在你规划的章节中揭晓或回收，必须在 foreshadowRecoverBindings 中输出回收绑定（index = 清单序号，chapterName = 回收章名——必须是本次规划中的真实章名，且在该伏笔登场章之后）；一个伏笔跨多章多步回收时输出多条（同 index 不同章）；不在本幕揭晓的伏笔不要绑定；
3. 规划中发现新的伏笔时列入 newForeshadows（surfaceAction / hiddenTruth / attentionLevel 1-10 / characterNames 服务角色名 / chapterName 登场章名）；
4. 章节概述尽量体现伏笔的表面行为，让正文写作有据可依；章节概述也尽量体现回收伏笔的真相揭晓；
5. 各清单内 surfaceAction / 登场绑定序号不得重复，回收绑定内同序号同章的组合不得重复；确认后新伏笔自动入库、登场与回收绑定自动生效。

地点梳理要求：
1. 本章概述中作为剧情发生地的真实地理场所（城市、山脉、宗门驻地、秘境等），不在地点库中的列入 save_chapters 的 newLocations：name 为地点名，description 为一句话定位（如「第2章主战场·东部边境要塞」）；清单内名字不得重复，地点库已有地点不得列入（可用 list_locations 工具查询地点库现状）；
2. 抽象场所（如梦中、回忆里）与一次性路过、无设定价值的地点不列入，保持清单信噪比；
3. newLocations 会在确认时随规划一并展示给用户：用户确认后自动入库。

完成后调用 save_chapters 工具保存章节规划（参数 = 完整规划——含每章登场角色清单，必须严格符合 schema）。save_chapters 会把本幕梗概、关键情节点与推荐的章节列表（含登场角色）展示给用户确认：用户确认后保存完成；用户提出修改意见时，根据反馈调整规划后重新调用 save_chapters，直到用户确认为止。`;

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

/** 章节 Agent 的注入项：角色与地点库查询按 novelId 进行，store 可替换（测试） */
export interface PlanChaptersAgentOptions {
  /** 目标小说创作 ID（list_characters / list_locations 工具按此查询角色与地点库） */
  novelId: string;
  /** 角色库 store；缺省默认 SQLite store（测试可替换） */
  characterStore?: CharacterStore;
  /** 地点库 store；缺省默认 SQLite store（测试可替换） */
  locationStore?: LocationStore;
  /** 本幕「待回收」的伏笔（回收幕=本幕且回收章为空；有则带序号回传给 LLM 供绑定回收章） */
  recoverableForeshadows: readonly StoredForeshadow[];
  /** 本幕「未绑登场章」的伏笔（编排层查好传入；有则带序号回传给 LLM 供绑定登场章） */
  unboundForeshadows?: readonly StoredForeshadow[];
}

/** save_chapters 的结构化入参：章节规划（含逐章登场角色清单——新增角色与逐章绑定由编排层据此派生）+ 新伏笔清单（项内表面行为不得重复）与伏笔绑定指令（序号不得重复）+ 新增地点清单（项内名字不得重复） */
export const saveChaptersInputSchema = chapterPlanSchema.extend({
  newForeshadows: z
    .array(chapterNewForeshadowSchema)
    .refine((list) => new Set(list.map((f) => f.surfaceAction)).size === list.length, "伏笔清单内表面行为不得重复"),
  foreshadowBindings: z
    .array(foreshadowBindingSchema)
    .refine((list) => new Set(list.map((b) => b.index)).size === list.length, "伏笔绑定指令内序号不得重复"),
  foreshadowRecoverBindings: z
    .array(foreshadowBindingSchema)
    .refine(
      (list) => new Set(list.map((b) => `${b.index}:${b.chapterName}`)).size === list.length,
      "伏笔回收绑定指令内序号与章名组合不得重复",
    ),
  newLocations: z
    .array(newLocationSchema)
    .refine((list) => new Set(list.map((l) => l.name)).size === list.length, "新增地点清单内名字不得重复"),
});

/** 章节 Agent 的最终产物：确认通过的规划本体（含逐章登场角色清单）与随规划连带确认的新伏笔清单、既有伏笔登场/回收绑定指令与新增地点清单。
 *  新增角色清单不再由模型单独输出——由编排层经 collectChapterCharacters + filterNewCharacters 从逐章清单对角色库派生（单一事实源）。 */
export interface ChapterPlanSubmission {
  plan: ChapterPlan;
  newForeshadows: ChapterNewForeshadow[];
  foreshadowBindings: ForeshadowBinding[];
  foreshadowRecoverBindings: ForeshadowBinding[];
  newLocations: NewLocation[];
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
  const locationStore = options.locationStore ?? getDefaultLocationStore();
  let saved: ChapterPlanSubmission | undefined;

  /** 角色库查询工具：返回库内全部角色名与叙事定位，供模型点名登场清单与区分新增角色 */
  const listCharacters = tool({
    description:
      "查询角色库中已有的全部角色（名字与叙事定位）。梳理各章登场角色清单时必须先调用此工具：库内已有角色用真实名字列入各章 characters，不得当新角色对待。",
    inputSchema: z.object({}),
    execute: async () => {
      const rows = characterStore.listCharacters(novelId);
      return {
        characters: rows.map((r) => ({ name: r.character.basicInfo.name, narrativeRole: r.character.core.narrativeRole })),
      };
    },
  });

  /** 地点库查询工具：返回库内全部地点名与定位，供模型比对出「新增地点」 */
  const listLocations = tool({
    description:
      "查询地点库中已有的全部地点（名字与定位）。梳理 newLocations 时必须先调用此工具：清单中只能列地点库中没有的地点，库内已有地点不得列入。",
    inputSchema: z.object({}),
    execute: async () => {
      const rows = locationStore.listLocations(novelId);
      return {
        locations: rows.map((r) => ({ name: r.location.name, description: r.location.description })),
      };
    },
  });

  const saveChapters = tool({
    description:
      "章节规划完成后调用此工具保存（参数 = 完整规划——含每章登场角色清单 + newForeshadows 新伏笔与 foreshadowBindings / foreshadowRecoverBindings 登场与回收绑定 + newLocations 新增地点清单）。会把本幕梗概、关键情节点、推荐的章节列表（含登场角色）与各清单展示给用户做最终确认：用户确认后保存完成；用户提出修改意见时，需根据反馈调整规划后重新调用。",
    inputSchema: saveChaptersInputSchema,
    execute: async (inputPlan) => {
      const { newForeshadows, foreshadowBindings, foreshadowRecoverBindings, newLocations, ...plan } = inputPlan;
      // 「本次规划新增角色」由逐章登场清单对角色库派生（单一事实源）——确认门所见 = 入库所得
      const newCharacters: NewCharacterOutline[] = filterNewCharacters(
        collectChapterCharacters(plan),
        characterStore.listCharacters(novelId).map((r) => r.character),
      );
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
          foreshadowRecoverBindings,
          newLocations,
        },
      });
      if (confirmed) {
        saved = { plan, newForeshadows, foreshadowBindings, foreshadowRecoverBindings, newLocations };
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
      ...(options.recoverableForeshadows && options.recoverableForeshadows.length > 0
        ? [
            `本幕待回收伏笔（真相揭晓幕=本幕且回收章未绑；序号. 表面行为——隐藏真相，登场章为空表示尚未绑定登场章）：\n${options.recoverableForeshadows
              .map(
                (f, i) =>
                  `${i + 1}. ${f.foreshadow.surfaceAction}——${f.foreshadow.hiddenTruth}（登场：${f.foreshadow.appearChapterId ?? "未绑定"}）`,
              )
              .join("\n")}`,
          ]
        : []),
      "请基于以上内容推荐本幕的章节规划并调用 save_chapters 保存。",
    ].join("\n\n"),
    tools: { save_chapters: saveChapters, list_characters: listCharacters, list_locations: listLocations },
    // 不设 stopTool：save_chapters 可能被用户否决（需继续修订）
    maxSteps: 12,
    isDone: () => saved !== undefined,
    continuationHint:
      "请立即调用 save_chapters 工具保存章节规划（参数为完整规划——含每章登场角色清单——与 newForeshadows / foreshadowBindings / foreshadowRecoverBindings / newLocations 清单），不要只输出文本。",
  });

  if (!saved) {
    throw new Error(
      `章节 Agent 未能在 ${result.stepCount} 步内完成规划。最后输出：\n${result.text}`,
    );
  }
  return saved;
}

import { tool } from "ai";
import { z } from "zod";
import { runReactAgent } from "../../agents/react";
import type { UiChannel } from "../../ui/channel";
import { getDefaultCharacterStore, type CharacterStore } from "../../state/character-store";
import { getDefaultLocationStore, type LocationStore } from "../../state/location-store";
import {
  outlineSchema,
  newCharacterSchema,
  newLocationSchema,
  outlineNewForeshadowSchema,
  type NewCharacterOutline,
  type NewLocation,
  type OutlineNewForeshadow,
  type Outline,
} from "@novel/shared";
import type { NovelParams } from "../../state/types";

const SYSTEM_PROMPT = `你是一名资深小说编辑与故事结构师。你的任务：基于给定的创作参数（类型、受众、世界观、角色、核心冲突，可能部分缺失）创作一本小说的大纲。

大纲为两级结构：
- 全书分为若干部（part），每部是故事的一个宏观段落：有部名与本部梗概（概括该部在整体故事中的位置与作用）；
- 每部包含若干幕（act），每幕有幕名、梗概与关键情节点；
- 部数与总幕数必须与结构要求完全一致，每部至少 1 幕；各部包含几幕由你按剧情节奏与冲突推进决定。
- 本次大纲的所有幕名必须全书唯一，跨部也不得重名；伏笔按幕名绑定，不能仅靠部名或排序号区分同名幕。提交前检查并改写重复的幕名，伏笔 actName / recoverActName 必须与最终幕名完全一致。

要求：
1. 大纲必须围绕核心冲突组织（若已提供）：冲突的「由来」对应开端与铺垫，「对角色的影响」推动中段发展，「理想的解决结果」指向结局；
2. 若已提供叙事视角：情节组织与幕结构必须与该视角匹配——限知视角注意信息遮蔽与揭示的节奏（读者所知不超过视角内角色所知），多视角轮换在幕梗概中体现视角切换安排，视角贯穿全书不得中途漂移；未提供时自行选择一种视角并全书保持一致；
3. 严格遵守世界观设定，尤其不得违背 taboos（禁忌）中的任何条目；
4. 每个角色严格遵循其角色卡：叙事定位决定戏份权重，行为贴合其内核（渴望/恐惧）、性格与背景；尊重每个角色的创作目的与结局方向，主角需有清晰的成长弧光；
5. 每一幕给出梗概与关键情节点；
6. 标题要契合类型与调性，logline 用一句话讲清「谁+想要什么+障碍+代价」；
7. 类型/受众/核心冲突未提供时，依据世界观、角色与小说名自行把握调性与主线，不得虚构与世界观冲突的设定。

角色梳理要求：
1. 大纲中的角色应尽量沿用角色库已有角色（可用 list_characters 工具查询角色库现状）；
2. 登场角色不在角色库中时，必须将其列入 save_outline 的 newCharacters：name 为角色名，role 为该角色在大纲中的一句话定位（如「反派·血宗宗主」）；清单内名字不得重复，角色库已有角色不得列入；
3. newCharacters 会在确认时随大纲一并展示给用户：用户确认后这些角色将自动填充角色卡并入库。

伏笔梳理要求：
1. 某幕的剧情安排中若有伏笔（表面事件背后隐藏着指向后续剧情的真相），将其列入 save_outline 的 newForeshadows：
   - surfaceAction 表面行为（读者可见的表现）、hiddenTruth 隐藏的真相（真正指向的剧情）、attentionLevel 读者注意度 1-10（1 最易发现，10 最难发现）；
   - characterNames 服务角色名（可引用角色库或 newCharacters 清单中的名字，必须真实存在）；
   - actName 埋设幕名（必须是本大纲中真实的幕名）；
2. 伏笔挂幕不挂章（章节尚不存在，登场章在后续章节规划时绑定）；真相在后续某幕揭晓的伏笔附 recoverActName（回收幕名）：必须是大纲中真实的幕名且在埋设幕之后，大纲期看不到回收点的伏笔省略该字段——回收幕随伏笔入库，该幕章节规划时自动绑定回收章；
3. 清单内 surfaceAction 不得重复；newForeshadows 会在确认时随大纲一并展示，确认后自动入库。

地点梳理要求：
1. 大纲中作为剧情发生地的真实地理场所（大陆、城市、山脉、宗门驻地、秘境等），不在地点库中的列入 save_outline 的 newLocations：name 为地点名，description 为一句话定位（如「东部边境要塞·主角初战的战场」）；清单内名字不得重复，地点库已有地点不得列入（可用 list_locations 工具查询地点库现状）；
2. 抽象场所（如梦中、回忆里）与一次性路过、无设定价值的地点不列入，保持清单信噪比；
3. newLocations 会在确认时随大纲一并展示给用户：用户确认后自动入库。

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

/** 幕名 → 大纲全局序（部序展开后幕的流水号）：伏笔回收幕必须在埋设幕之后的校验依据 */
function actOrderIndex(o: Outline, actName: string): number | undefined {
  let index = 0;
  for (const part of o.parts) {
    for (const act of part.acts) {
      index += 1;
      if (act.name === actName) return index;
    }
  }
  return undefined;
}

/** save_outline 的结构化入参：大纲本体 + 新增角色清单（项内名字不得重复）+ 伏笔清单（项内表面行为不得重复，回收幕须为真实幕名且晚于埋设幕）+ 新增地点清单（项内名字不得重复），叠加部/幕强校验 */
export function saveOutlineInputSchemaFor(actCount: number, partCount: number) {
  return outlineSchema
    .extend({
      newCharacters: z
        .array(newCharacterSchema)
        .refine((list) => new Set(list.map((c) => c.name)).size === list.length, "新增角色清单内名字不得重复"),
      newForeshadows: z
        .array(outlineNewForeshadowSchema)
        .refine((list) => new Set(list.map((f) => f.surfaceAction)).size === list.length, "伏笔清单内表面行为不得重复"),
      newLocations: z
        .array(newLocationSchema)
        .refine((list) => new Set(list.map((l) => l.name)).size === list.length, "新增地点清单内名字不得重复"),
    })
    .refine(
      (o) =>
        o.newForeshadows.every((f) => {
          if (!f.recoverActName) return true;
          const plant = actOrderIndex(o, f.actName);
          const recover = actOrderIndex(o, f.recoverActName);
          return plant !== undefined && recover !== undefined && recover > plant;
        }),
      "伏笔回收幕必须是大纲中真实的幕名且在埋设幕之后",
    )
    .refine(
      (o) =>
        o.parts.length === partCount &&
        o.parts.reduce((sum, p) => sum + p.acts.length, 0) === actCount,
      `大纲必须恰好为 ${partCount} 部、共 ${actCount} 幕`,
    );
}

/** 大纲 Agent 的最终产物：确认通过的大纲本体 + 随大纲连带确认的新增角色清单、伏笔清单与新增地点清单 */
export interface OutlineSubmission {
  outline: Outline;
  newCharacters: NewCharacterOutline[];
  newForeshadows: OutlineNewForeshadow[];
  newLocations: NewLocation[];
}

export interface CreateOutlineOptions {
  /** 用户已命名的书名；指定时大纲 title 必须沿用 */
  novelTitle?: string;
  /** 大纲总幕数（用户指定，默认 5） */
  actCount: number;
  /** 部数（用户指定，默认 1） */
  partCount: number;
  /** 目标小说创作 ID（list_characters / list_locations 工具按此查询角色与地点库） */
  novelId: string;
  /** 角色库 store；缺省默认 SQLite store（测试可替换） */
  characterStore?: CharacterStore;
  /** 地点库 store；缺省默认 SQLite store（测试可替换） */
  locationStore?: LocationStore;
}

/**
 * 大纲生成的创作上下文：世界观与角色必带；类型/叙事视角/受众/核心冲突可选——
 * 重新生成会话从小说记录读取这几项，历史小说未采集的字段可缺失；
 * 缺失时 Agent 依据世界观、角色与书名自行把握。
 */
export type OutlineContext = Pick<NovelParams, "worldview" | "characters"> &
  Partial<Pick<NovelParams, "genre" | "narrativePov" | "audience" | "coreConflict">>;

/** 确认视图格式化：已迁至 ui/cli-channel（renderView 的 outline/confirm 分支） */

/**
 * 大纲 Agent（ReAct)：基于创作上下文生成「部 → 幕」两级大纲，
 * 经用户「确认 / 修改意见 → 调整 → 再确认」循环后才完成。
 * createNovel 传完整 NovelParams；重新生成会话传库内数据（部分参数）。
 */
export async function createOutline(
  params: OutlineContext,
  options: CreateOutlineOptions,
  channel: UiChannel,
): Promise<OutlineSubmission> {
  const { novelTitle, actCount, partCount, novelId } = options;
  const characterStore = options.characterStore ?? getDefaultCharacterStore();
  const locationStore = options.locationStore ?? getDefaultLocationStore();
  let saved: OutlineSubmission | undefined;

  /** 角色库查询工具：返回库内全部角色名与叙事定位，供模型比对出「新增角色」 */
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

  const saveOutline = tool({
    description:
      "大纲完成后调用此工具保存（参数 = 完整大纲 + newCharacters 新增角色清单 + newForeshadows 伏笔清单 + newLocations 新增地点清单）。会把剧情梗概、主题、每部概述、每幕名称概述与三组清单展示给用户做最终确认：用户确认后保存完成；用户提出修改意见时，需根据反馈调整后重新调用。",
    inputSchema: saveOutlineInputSchemaFor(actCount, partCount),
    execute: async (input) => {
      const { newCharacters, newForeshadows, newLocations, ...outline } = input;
      const confirmed = await channel.askConfirm("以上大纲是否确认？", {
        default: true,
        view: { kind: "outline", detail: "confirm", outline, newCharacters, newForeshadows, newLocations },
      });
      if (confirmed) {
        saved = { outline, newCharacters, newForeshadows, newLocations };
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
      ...(params.genre !== undefined &&
      params.narrativePov !== undefined &&
      params.audience !== undefined &&
      params.coreConflict !== undefined
        ? []
        : [
            "（注：类型/叙事视角/受众/核心冲突未提供，请基于世界观、角色与小说名自行把握调性与主线，不得虚构与世界观冲突的设定）",
          ]),
      `大纲结构要求：恰好 ${partCount} 部、共 ${actCount} 幕（每部至少 1 幕），各部幕数按剧情节奏分配。`,
      ...(novelTitle
        ? [`小说已由用户命名为《${novelTitle}》，大纲的 title 字段必须使用该名称。`]
        : []),
    ].join("\n\n"),
    tools: { save_outline: saveOutline, list_characters: listCharacters, list_locations: listLocations },
    // 不设 stopTool：save_outline 可能被用户否决（需继续修订），
    // hasToolCall 会在工具被调用时无条件停止，无法表达「提交被拒需继续」
    maxSteps: 12,
    isDone: () => saved !== undefined,
    continuationHint: "请立即调用 save_outline 工具保存大纲（参数为完整大纲与 newCharacters / newForeshadows / newLocations 清单），不要只输出文本。",
  });

  if (!saved) {
    throw new Error(
      `大纲 Agent 未能在 ${result.stepCount} 步内完成创作。最后输出：\n${result.text}`,
    );
  }
  return saved;
}

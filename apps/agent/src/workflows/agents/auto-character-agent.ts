import { tool } from "ai";
import { runReactAgent } from "../../agents/react";
import type { UiChannel } from "../../ui/channel";
import {
  characterSchema,
  type ChapterPlan,
  type Character,
  type NewCharacterOutline,
  type Outline,
  type Worldview,
} from "@novel/shared";
import { getDefaultCharacterStore, type CharacterStore, type StoredCharacter } from "../../state/character-store";

const SYSTEM_PROMPT = `你是一名专业的小说角色策划。你的任务：依据世界观与大纲，为「新增角色清单」中的每个角色自动填写完整角色卡并调用 save_character 入库。

填写要求：
1. name 必须原样使用清单中的角色名，不得增删改（改名漂移会被拒绝）；
2. 必填字段（姓名 / 核心渴望 / 核心恐惧 / 叙事定位 / 背景 / 创作目的 / 结局方向）必须填充：
   - 从大纲中该角色的登场情节与清单中的一句话定位推断叙事定位（主角/配角/反派等功能角色）与剧情功能；
   - 创作目的从创作者视角描述（该角色服务于故事的什么功能，如「作为强敌逼出主角的成长」）；
   - 结局方向与大纲走向一致，不得与大纲结局矛盾；
3. 可选字段（性别 / 外貌 / 性格 / 角色目的 / 轨迹 / 关系）在大纲与世界观有依据时一并填充，无依据留空；关系引用其他角色时使用其真实名字；
4. 遵守世界观设定与 taboos（禁忌），不得虚构与之冲突的设定。

按清单逐个处理：每张卡填完即调用 save_character（入参 = 完整角色卡），全部入库后任务结束。save_character 返回的 remaining 列出尚未入库的角色，请继续处理直到清单清空。`;

export interface AutoCreateCharactersOptions {
  /** 目标小说创作 ID（characters.novel_id 外键） */
  novelId: string;
  /** 世界观（角色卡设定的依据之一） */
  worldview: Worldview;
  /** 已确认的大纲本体（角色登场情节与定位的依据） */
  outline: Outline;
  /** 附加上下文（如章节规划的「章名+概述」全文），存在时追加进 prompt 供填卡参考 */
  extraContext?: string;
  /** 待自动创建的新增角色清单（须先经 filterNewCharacters 过滤） */
  newCharacters: NewCharacterOutline[];
  /** 角色库已有角色（供关系字段引用与重名守卫） */
  existingCharacters: Character[];
  /** 交互通道（自动创建无确认门，仅经 notify 通报进度） */
  channel: UiChannel;
  /** 角色持久化 store；缺省默认 SQLite store（测试可替换） */
  characterStore?: CharacterStore;
}

/**
 * 编排层兜底 diff（纯函数，可单测）：不信任模型给出的「新增」判定——
 * 按库内角色名剔除清单中已有项（trim 后全等比对），清单内同名去重保留首个，
 * 名字 trim 后为空的项剔除。
 */
export function filterNewCharacters(
  newCharacters: NewCharacterOutline[],
  existingCharacters: Character[],
): NewCharacterOutline[] {
  const libraryNames = new Set(existingCharacters.map((c) => c.basicInfo.name.trim()));
  const seen = new Set<string>();
  const result: NewCharacterOutline[] = [];
  for (const item of newCharacters) {
    const name = item.name.trim();
    if (name.length === 0 || libraryNames.has(name) || seen.has(name)) continue;
    seen.add(name);
    result.push({ name, role: item.role });
  }
  return result;
}

/**
 * 章节规划逐章登场清单 → 幕级角色并集（纯函数，可单测）：按章序收集各章登场角色，
 * 同名跨章去重保留首个 role（登场章的一句话定位最完整），名字 trim 后为空的项剔除。
 * 产出的并集经 filterNewCharacters 对角色库 diff 即得「本次规划新增角色」——
 * 确认视图派生与编排层建卡共用本函数（确认门所见 = 入库所得，单一事实源）。
 */
export function collectChapterCharacters(plan: ChapterPlan): NewCharacterOutline[] {
  const byName = new Map<string, string>();
  for (const chapter of plan.chapters) {
    for (const cast of chapter.characters) {
      const name = cast.name.trim();
      if (name.length === 0 || byName.has(name)) continue;
      byName.set(name, cast.role);
    }
  }
  return [...byName].map(([name, role]) => ({ name, role }));
}

/**
 * 角色自动创建 Agent（ReAct 循环，无确认门）：依据世界观与大纲为清单中的
 * 每个新增角色自动填充角色卡并逐卡入库；清单全部入库（isDone 按数量判定）
 * 或 maxSteps 耗尽（抛可读错误，已入库卡保留）后结束。
 * 独立导出：后续章节规划 / 正文生成等写作期工作流可直接复用。
 */
export async function autoCreateCharacters(
  options: AutoCreateCharactersOptions,
): Promise<StoredCharacter[]> {
  const { novelId, worldview, outline, extraContext, newCharacters, existingCharacters, channel } = options;
  const characterStore = options.characterStore ?? getDefaultCharacterStore();
  if (newCharacters.length === 0) return [];

  const pendingNames = new Set(newCharacters.map((c) => c.name.trim()));
  const libraryNames = new Set(existingCharacters.map((c) => c.basicInfo.name.trim()));
  const created: StoredCharacter[] = [];
  const savedNames = new Set<string>();

  const saveCharacter = tool({
    description:
      "保存一个清单内新增角色的完整角色卡并入库。入参必须严格符合角色卡 schema；name 必须原样使用清单中的角色名。每个角色只保存一次。",
    inputSchema: characterSchema,
    execute: async (character) => {
      const name = character.basicInfo.name.trim();
      if (!pendingNames.has(name)) {
        return { ok: false as const, note: `「${character.basicInfo.name}」不在待创建清单内，只能为清单角色创建角色卡：${newCharacters.map((c) => c.name).join("、")}` };
      }
      if (savedNames.has(name)) {
        return { ok: false as const, note: `「${name}」已入库，请勿重复保存` };
      }
      if (libraryNames.has(name)) {
        return { ok: false as const, note: `「${name}」已在角色库中，不得重复创建` };
      }
      const stored = characterStore.addCharacter(novelId, characterSchema.parse(character));
      savedNames.add(name);
      created.push(stored);
      channel.notify(`✨ 新角色已自动入库：${stored.character.basicInfo.name}（${stored.character.core.narrativeRole}）`);
      const remaining = newCharacters.filter((c) => !savedNames.has(c.name.trim())).map((c) => c.name);
      return { ok: true as const, saved: name, remaining };
    },
  });

  const result = await runReactAgent({
    system: SYSTEM_PROMPT,
    prompt: [
      `世界观（JSON）：\n${JSON.stringify(worldview, null, 2)}`,
      `大纲（JSON）：\n${JSON.stringify(outline, null, 2)}`,
      ...(extraContext ? [extraContext] : []),
      existingCharacters.length > 0
        ? `角色库已有角色：${existingCharacters.map((c) => `${c.basicInfo.name}（${c.core.narrativeRole}）`).join("、")}`
        : "角色库暂无角色",
      `新增角色清单（共 ${newCharacters.length} 个，逐个创建）：\n${newCharacters.map((c) => `- ${c.name}——${c.role}`).join("\n")}`,
    ].join("\n\n"),
    tools: { save_character: saveCharacter },
    maxSteps: 4 + newCharacters.length * 2,
    // 完成基准用 pendingNames.size（savedNames ⊆ pendingNames）：复用方违反前置条件传入
    // 未过滤清单（同名共现）时，以 newCharacters.length 为基准会永不可达、必然耗尽抛错
    isDone: () => savedNames.size >= pendingNames.size,
    continuationHint: "还有清单角色未入库，请继续为它们填写角色卡并调用 save_character，不要只输出文本。",
  });

  if (savedNames.size < pendingNames.size) {
    throw new Error(
      `角色自动创建 Agent 未能完成全部 ${pendingNames.size} 个新增角色的入库（已完成：${[...savedNames].join("、") || "无"}）。最后输出：\n${result.text}`,
    );
  }
  return created;
}

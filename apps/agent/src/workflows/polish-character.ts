import { generateObject } from "ai";
import { model } from "../providers/deepseek";
import type { UiChannel } from "../ui/channel";
import { characterSchema, type Character } from "@novel/shared";
import { getDefaultNovelStore, type NovelStore } from "../state/novel-store";
import { getDefaultWorldviewStore, type WorldviewStore } from "../state/worldview-store";
import { getDefaultCharacterStore, type CharacterStore } from "../state/character-store";

export interface PolishCharacterOptions {
  /** 交互通道（终端 / 协议 / 测试替身），业务交互的唯一出口 */
  channel: UiChannel;
  /** 目标小说创作 ID */
  novelId: string;
  /** 编辑流传角色主键（校验存在与归属）；新建流（角色尚未入库）不传 */
  characterId?: string;
  /** 表单当前值：用户填写的角色卡，润色的种子内容（可只填部分字段） */
  form: Character;
  novelStore?: NovelStore;
  worldviewStore?: WorldviewStore;
  characterStore?: CharacterStore;
}

export interface PolishCharacterResult {
  novelId: string;
  /** 润色后的完整角色卡——只回填客户端表单，不自动入库 */
  character: Character;
}

/**
 * 角色 AI 润色工作流（客户端角色编辑/新建表单的「AI 润色」按钮）：
 * 以用户表单当前值为种子、结合库内世界观，单轮 LLM 结构化输出全字段润色后的角色卡。
 * 无确认门——确认在客户端表单层（用户审阅润色结果自行提交或再次润色）。
 * 前置校验：小说存在、世界观已确认（润色依据）；编辑流另校验角色存在且同小说。
 * 校验失败抛可读错误，由调用方（协议入口）转为 fatal error 消息。
 */
export async function polishCharacter(options: PolishCharacterOptions): Promise<PolishCharacterResult> {
  const { channel, novelId, characterId, form } = options;
  const novelStore = options.novelStore ?? getDefaultNovelStore();
  const worldviewStore = options.worldviewStore ?? getDefaultWorldviewStore();
  const characterStore = options.characterStore ?? getDefaultCharacterStore();

  const novel = novelStore.getNovel(novelId);
  if (!novel) {
    throw new Error(`小说不存在，无法润色角色：${novelId}`);
  }
  if (characterId !== undefined) {
    const stored = characterStore.getCharacter(characterId);
    if (!stored) {
      throw new Error(`角色不存在，无法润色：${characterId}`);
    }
    if (stored.novelId !== novelId) {
      throw new Error(`角色不属于该小说，无法润色：${characterId}`);
    }
  }
  const storedWorldview = worldviewStore.getWorldview(novelId);
  if (!storedWorldview) {
    throw new Error("该小说世界观未确认（库中无记录），无法润色角色");
  }

  channel.notify(
    `🪄 角色 AI 润色中（《${novel.name ?? "未命名小说"}》· ${form.basicInfo.name || "未命名角色"}）…`,
  );
  const { object: polished } = await generateObject({
    model,
    schema: characterSchema,
    prompt: [
      "你是一名专业的小说角色设定编辑。请结合下面的小说世界观，对用户填写的角色卡做全字段润色。",
      "",
      "【小说世界观】",
      JSON.stringify(storedWorldview.worldview, null, 2),
      "",
      "【用户填写的角色卡（润色种子，可能只填了部分字段）】",
      JSON.stringify(form, null, 2),
      "",
      "润色要求：",
      "1. 忠实原意：用户已填字段中的事实设定（姓名、身份、关系、渴望、恐惧、结局方向等）不得改变或删除，不得新增与原意冲突的设定；",
      "2. 描述性内容（外貌/背景/性格/角色目的/轨迹/关系）在原意基础上扩写丰富，补充贴合世界观的细节，各 2~4 句，表达凝练生动；",
      "3. basicInfo.name 保持不变；core（渴望/恐惧/叙事定位）、background、creationPurpose、endingDirection 语义不变，仅优化表达；",
      "4. 用户留空的可选字段（性别/外貌/性格/角色目的/轨迹/关系）结合世界观与角色卡其余内容合理补全，不得留空；",
      "5. 只输出润色后的角色卡，严格符合 schema。",
    ].join("\n"),
  });
  channel.notify("🪄 润色完成，已回填表单（尚未入库，确认后请提交）");
  return { novelId, character: polished };
}

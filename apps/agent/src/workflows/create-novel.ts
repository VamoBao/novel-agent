import { generateObject } from "ai";
import { model } from "../providers/deepseek";
import type { UiChannel } from "../ui/channel";
import { audienceSuggestionSchema, coreConflictSchema, type Character } from "@novel/shared";
import type { NovelParams, NovelState, NovelStateStore } from "../state/types";
import { generateNovelId } from "../state/id";
import { memoryNovelStateStore } from "../state/memory-store";
import { getDefaultCharacterStore, type CharacterStore } from "../state/character-store";
import { getDefaultWorldviewStore, type WorldviewStore } from "../state/worldview-store";
import { getDefaultNovelStore, type NovelStore } from "../state/novel-store";
import { getDefaultOutlineStore, type OutlineStore } from "../state/outline-store";
import { saveOutline } from "../output/outline-writer";
import { collectWorldview } from "./agents/worldview-agent";
import { createCharacter } from "./agents/character-agent";
import { createOutline } from "./agents/outline-agent";

/** 常见热门类型（用户也可自定义输入） */
const GENRES = [
  "科幻",
  "悬疑推理",
  "爱情",
  "都市",
  "玄幻",
  "仙侠",
  "武侠",
  "历史",
  "奇幻",
  "恐怖惊悚",
  "青春校园",
  "无限流",
] as const;

export interface CreateNovelOptions {
  /** 交互通道（终端 / 协议 / 测试替身），业务交互的唯一出口 */
  channel: UiChannel;
  /** 已有的创作 ID（用于未来续作/恢复场景）；缺省时生成新 ID */
  id?: string;
  store?: NovelStateStore;
  /** 角色持久化 store；缺省用默认 SQLite store（data/novel.db） */
  characterStore?: CharacterStore;
  /** 世界观持久化 store；缺省用默认 SQLite store（data/novel.db） */
  worldviewStore?: WorldviewStore;
  /** 小说信息持久化 store；缺省用默认 SQLite store（data/novel.db） */
  novelStore?: NovelStore;
  /** 大纲树持久化 store；缺省用默认 SQLite store（data/novel.db） */
  outlineStore?: OutlineStore;
}

/**
 * 小说创作主工作流：生成 ID → 初始化 state → 逐步收集创作参数 → 生成大纲。
 *
 * ID 在调用任何 Agent 之前生成，作为 state 存入数据库时的唯一标识；
 * 若 id 无对应 state 存储，视为新创作的小说并执行初始化。
 * 全部交互（提问/确认/展示）经注入的 UiChannel 进行。
 */
export async function createNovel(options: CreateNovelOptions): Promise<NovelState> {
  const channel = options.channel;
  const store = options.store ?? memoryNovelStateStore;
  const characterStore = options.characterStore ?? getDefaultCharacterStore();
  const worldviewStore = options.worldviewStore ?? getDefaultWorldviewStore();
  const novelStore = options.novelStore ?? getDefaultNovelStore();
  const outlineStore = options.outlineStore ?? getDefaultOutlineStore();
  const id = options.id ?? generateNovelId();

  channel.notify("📖 novel-agent —— 小说创作向导");
  channel.notify(`本次创作 ID：${id}`);
  channel.notify("（该 ID 是后续 state 存档的唯一标识，请妥善保存）\n");

  const existing = await store.get(id);
  if (existing) {
    channel.notify(`检测到 ID 已有 state（status: ${existing.status}），跳过初始化直接返回。`);
    return existing;
  }

  const createdAt = new Date().toISOString();
  await store.create({ id, status: "initializing", createdAt, updatedAt: createdAt });

  // 小说命名（可选）：未想好可跳过，后续以大纲标题命名
  channel.notify("\n📝 小说命名（可选）");
  const novelNameInput = await channel.askText(
    "请输入小说名称（未想好直接回车跳过，后续将以大纲标题命名）> ",
    { optional: true },
  );
  const novelName = novelNameInput.length > 0 ? novelNameInput : undefined;

  // novels 行必须先于角色/世界观入库（二者 novel_id 外键关联本表）；
  // description 在大纲确认后回填
  if (!novelStore.getNovel(id)) {
    novelStore.createNovel({ id, name: novelName });
  }
  channel.notify(
    "✅ 新小说已初始化（state 尚为内存态，novels 已入库，数据库接入后 state 整体持久化）\n",
  );

  // 1. 类型
  channel.stage("type");
  const genre = await channel.askSelect("【1/5】选择小说类型", GENRES, { allowCustom: true });

  // 2. 受众（LLM 根据类型推断候选，用户多选 + 可补充）
  channel.stage("audience");
  channel.notify("\n【2/5】目标受众");
  channel.notify("正在根据类型推断典型受众群体…");
  const { object: suggestion } = await generateObject({
    model,
    schema: audienceSuggestionSchema,
    prompt: `小说类型：${genre}。请列出该类型小说常见且典型的目标受众群体（5-8 个），每个附一句话阅读偏好说明。`,
  });
  const audienceOptions = suggestion.options.map((o) => `${o.label}——${o.description}`);
  const chosen = await channel.askMultiSelect("请选择目标受众（可多选）", audienceOptions);
  const supplement = await channel.askText("补充说明（可直接回车跳过）> ", { optional: true });
  const audienceLabels = chosen.map(
    (display) => suggestion.options[audienceOptions.indexOf(display)]?.label ?? display,
  );
  const audience = [...audienceLabels, ...(supplement.length > 0 ? [supplement] : [])];

  // 3. 世界观（独立 ReAct Agent 多轮收集）
  channel.stage("worldview");
  channel.notify("\n【3/5】世界观设定");
  const initialWorldview = await channel.askText(
    "请描述你的世界观构想（一段文字即可，不清楚的地方 AI 会追问）> ",
  );
  channel.notify("\n🌍 世界观 Agent 启动，将与你多轮确认世界观…");
  const worldview = await collectWorldview(initialWorldview, channel);
  channel.present({ kind: "worldview", worldview });
  // 世界观确认后按创作 ID 入库（upsert）
  worldviewStore.saveWorldview(id, worldview);
  channel.notify("🌍 世界观已入库");

  // 4. 角色设定（ReAct Agent 逐字段确认，至少一名主角）
  channel.stage("character");
  channel.notify("\n【4/5】角色设定");
  const characters: Character[] = [];
  for (;;) {
    const hasProtagonist = characters.some((c) => c.core.narrativeRole.includes("主角"));
    let description: string;
    if (characters.length === 0) {
      description = await channel.askText(
        "请描述首个角色（建议从主角开始，自由文本；缺少的必填属性 AI 会逐项追问确认）> ",
      );
    } else if (!hasProtagonist) {
      channel.notify("⚠️ 尚无叙事定位为「主角」的角色，须继续添加。");
      description = await channel.askText("请描述下一个角色（自由文本）> ");
    } else {
      const line = await channel.askText(
        "请描述下一个角色（主角/配角/反派均可，直接回车结束角色创建）> ",
        { optional: true },
      );
      if (line.length === 0) break;
      description = line;
    }
    channel.notify("\n🧙 角色 Agent 启动（逐字段确认角色卡）…");
    const character = await createCharacter(description, characters, channel);
    characters.push(character);
    // 角色确认后立即按创作 ID 入库（增量持久化）
    characterStore.addCharacter(id, character);
    channel.notify(
      `\n✅ 角色已确认并入库：${character.basicInfo.name}（${character.core.narrativeRole}）`,
    );
  }

  // 5. 核心冲突（自由文本 → schema 归一化）
  channel.stage("conflict");
  channel.notify("\n【5/5】核心冲突");
  const conflictDescription = await channel.askText(
    "请描述核心冲突（由来 / 对角色的影响 / 理想的解决结果，写个大概即可）> ",
  );
  channel.notify("正在整理核心冲突…");
  const { object: conflict } = await generateObject({
    model,
    schema: coreConflictSchema,
    prompt: `小说类型：${genre}。用户对核心冲突的描述：\n${conflictDescription}\n\n请整理为结构化核心冲突，三项均需基于用户描述提炼，可合理细化但不得虚构冲突主轴。`,
  });
  channel.present({ kind: "conflict", conflict });

  // 参数收集完毕，落 state
  const params: NovelParams = { genre, audience, worldview, characters, coreConflict: conflict };
  await store.update(id, { status: "gathering", params });

  // 大纲结构：幕数（默认 5）→ 部数（默认 1，上限为幕数）
  channel.stage("outline");
  const actCount = await channel.askInt("请输入整本剧情拆分的幕数", {
    min: 3,
    max: 20,
    default: 5,
  });
  const partCount = await channel.askInt(`这 ${actCount} 幕拆分为几部`, {
    min: 1,
    max: actCount,
    default: 1,
  });

  // 大纲（ReAct Agent，部 → 幕两级结构）
  channel.notify("\n🛠 大纲 Agent 启动…");
  const outline = await createOutline(params, { novelTitle: novelName, actCount, partCount }, channel);
  channel.present({ kind: "outline", detail: "full", outline });

  // 确认后入库（outlines 表两级树，梗概与关键情节点随节点入列）并落盘 output/<id>.json
  const treeNodes = outlineStore.saveOutlineTree(id, outline.parts);
  const partTotal = treeNodes.filter((n) => n.node.type === "part").length;
  const actTotal = treeNodes.filter((n) => n.node.type === "act").length;
  channel.notify(`🗂 大纲树已入库（含梗概与关键情节点）：${partTotal} 部 / ${actTotal} 幕`);
  const savedPath = await saveOutline(id, outline);
  channel.notify(`🗂 大纲已落盘：${savedPath}`);

  const finalState = await store.update(id, { status: "outlined", outline });
  // 大纲确认后回填：description = 剧情梗概；name 仅在用户未命名时以大纲标题回填
  novelStore.updateNovel(id, {
    ...(novelName ? {} : { name: outline.title }),
    description: outline.logline,
  });
  const finalName = novelName ?? outline.title;
  channel.notify(`\n✅ 小说《${finalName}》初始化完成！创作 ID：${id}`);
  return finalState;
}

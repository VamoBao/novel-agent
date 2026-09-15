import { generateObject } from "ai";
import { z } from "zod";
import { model } from "../providers/deepseek";
import {
  askConfirm,
  askMultiSelect,
  askOptional,
  askRequired,
  askSelect,
} from "../cli/prompt";
import {
  audienceSuggestionSchema,
  characterSchema,
  coreConflictSchema,
  type Character,
  type CoreConflict,
  type Worldview,
} from "../schemas";
import type { NovelParams, NovelState, NovelStateStore } from "../state/types";
import { generateNovelId } from "../state/id";
import { memoryNovelStateStore } from "../state/memory-store";
import { collectWorldview } from "./agents/worldview-agent";
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
  /** 已有的创作 ID（用于未来续作/恢复场景）；缺省时生成新 ID */
  id?: string;
  store?: NovelStateStore;
}

/**
 * 小说创作主工作流：生成 ID → 初始化 state → 逐步收集创作参数 → 生成大纲。
 *
 * ID 在调用任何 Agent 之前生成，作为 state 存入数据库时的唯一标识；
 * 若 id 无对应 state 存储，视为新创作的小说并执行初始化。
 */
export async function createNovel(options: CreateNovelOptions = {}): Promise<NovelState> {
  const store = options.store ?? memoryNovelStateStore;
  const id = options.id ?? generateNovelId();

  console.log("📖 novel-agent —— 小说创作向导");
  console.log(`本次创作 ID：${id}`);
  console.log("（该 ID 是后续 state 存档的唯一标识，请妥善保存）\n");

  const existing = await store.get(id);
  if (existing) {
    console.log(`检测到 ID 已有 state（status: ${existing.status}），跳过初始化直接返回。`);
    return existing;
  }

  const createdAt = new Date().toISOString();
  await store.create({ id, status: "initializing", createdAt, updatedAt: createdAt });
  console.log("✅ 新小说已初始化（state 尚为内存态，数据库接入后持久化）\n");

  // 1. 类型
  const genre = await askSelect("【1/5】选择小说类型", GENRES, { allowCustom: true });

  // 2. 受众（LLM 根据类型推断候选，用户多选 + 可补充）
  console.log("\n【2/5】目标受众");
  console.log("正在根据类型推断典型受众群体…");
  const { object: suggestion } = await generateObject({
    model,
    schema: audienceSuggestionSchema,
    prompt: `小说类型：${genre}。请列出该类型小说常见且典型的目标受众群体（5-8 个），每个附一句话阅读偏好说明。`,
  });
  const audienceOptions = suggestion.options.map((o) => `${o.label}——${o.description}`);
  const chosen = await askMultiSelect("请选择目标受众（可多选）", audienceOptions);
  const supplement = await askOptional("补充说明（可直接回车跳过）> ");
  const audienceLabels = chosen.map(
    (display) => suggestion.options[audienceOptions.indexOf(display)]?.label ?? display,
  );
  const audience = [...audienceLabels, ...(supplement.length > 0 ? [supplement] : [])];

  // 3. 世界观（独立 ReAct Agent 多轮收集）
  console.log("\n【3/5】世界观设定");
  const initialWorldview = await askRequired(
    "请描述你的世界观构想（一段文字即可，不清楚的地方 AI 会追问）> ",
  );
  console.log("\n🌍 世界观 Agent 启动，将与你多轮确认世界观…");
  const worldview = await collectWorldview(initialWorldview);
  printWorldview(worldview);

  // 4. 主角设定（自由文本 → schema 归一化 → 用户确认，至少一名）
  console.log("\n【4/5】主角设定");
  const protagonists: Character[] = [];
  for (;;) {
    const hint =
      protagonists.length === 0
        ? "请描述主角（自由文本，越具体越好；也可一次描述多名主角）> "
        : "请描述下一位主角（自由文本）> ";
    const description = await askRequired(hint);
    console.log("正在整理为角色卡…");
    const { object } = await generateObject({
      model,
      schema: z.object({ characters: z.array(characterSchema).min(1) }),
      prompt: `任务：把用户对小说主角的描述整理为结构化角色卡。
规则：
1. 用户描述中明确给出的信息（姓名、性别、年龄、身份、人际关系等）必须逐字保留，严禁改写、替换或另起名字；
2. 角色数量以描述为准：描述了几个人就输出几张角色卡，不得自行增加或删减；
3. 用户未提及的字段方可基于小说类型（${genre}）惯例合理补全，补全不得与描述冲突。

用户对主角的描述：
${description}`,
    });
    object.characters.forEach((c) => printCharacter(c));
    if (!(await askConfirm("\n以上角色卡是否符合你的设想？", true))) {
      console.log("已丢弃，请重新描述。");
      continue;
    }
    protagonists.push(...object.characters);
    if (!(await askConfirm("是否继续添加其他主角？", false))) break;
  }

  // 5. 核心冲突（自由文本 → schema 归一化）
  console.log("\n【5/5】核心冲突");
  const conflictDescription = await askRequired(
    "请描述核心冲突（由来 / 对角色的影响 / 理想的解决结果，写个大概即可）> ",
  );
  console.log("正在整理核心冲突…");
  const { object: conflict } = await generateObject({
    model,
    schema: coreConflictSchema,
    prompt: `小说类型：${genre}。用户对核心冲突的描述：\n${conflictDescription}\n\n请整理为结构化核心冲突，三项均需基于用户描述提炼，可合理细化但不得虚构冲突主轴。`,
  });
  printConflict(conflict);

  // 参数收集完毕，落 state
  const params: NovelParams = { genre, audience, worldview, protagonists, coreConflict: conflict };
  await store.update(id, { status: "gathering", params });

  // 大纲（ReAct Agent）
  console.log("\n🛠 大纲 Agent 启动…");
  const outline = await createOutline(params);
  printOutline(outline);

  const finalState = await store.update(id, { status: "outlined", outline });
  console.log(`\n✅ 小说《${outline.title}》初始化完成！创作 ID：${id}`);
  return finalState;
}

function printWorldview(wv: Worldview): void {
  console.log("\n✅ 世界观已确认：");
  console.log(`  地理位置：${wv.background.geography}`);
  if (wv.background.fantasyAttributes) {
    console.log(`  架空属性：${wv.background.fantasyAttributes}`);
  }
  if (wv.background.realWorldMapping) {
    console.log(`  现实映射：${wv.background.realWorldMapping}`);
  }
  console.log(`  禁忌：${wv.taboos.join("；")}`);
}

function printCharacter(c: Character): void {
  console.log(`\n  👤 ${c.name}（${c.identity}${c.age ? `，${c.age}` : ""}）`);
  console.log(`     性格：${c.personality}`);
  console.log(`     动机：${c.motivation}`);
  if (c.abilities.length > 0) console.log(`     能力：${c.abilities.join("、")}`);
}

function printConflict(c: CoreConflict): void {
  console.log("\n✅ 核心冲突已确认：");
  console.log(`  由来：${c.origin}`);
  console.log(`  影响：${c.impact}`);
  console.log(`  理想解决：${c.idealResolution}`);
}

function printOutline(o: { title: string; logline: string; theme?: string; acts: Array<{ name: string; summary: string; keyPlotPoints: string[] }> }): void {
  console.log("\n✅ 大纲已生成：");
  console.log(`  《${o.title}》——${o.logline}`);
  if (o.theme) console.log(`  主题：${o.theme}`);
  for (const act of o.acts) {
    console.log(`  ▶ ${act.name}：${act.summary}`);
    act.keyPlotPoints.forEach((p, i) => console.log(`    ${i + 1}) ${p}`));
  }
}

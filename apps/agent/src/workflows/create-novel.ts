import { runCachedWorkflow, type WorkflowCacheOptions } from "./workflow-cache";
import { WorkflowRunStore } from "../state/workflow-run-store";
import { generateObject } from "ai";
import { model } from "../providers/agent-model";
import type { UiChannel } from "../ui/channel";
import { audienceSuggestionSchema, coreConflictSchema, type Character } from "@novel/shared";
import type { NovelParams, NovelState, NovelStateStore } from "../state/types";
import { generateNovelId } from "../state/id";
import { memoryNovelStateStore } from "../state/memory-store";
import { getDefaultCharacterStore, type CharacterStore } from "../state/character-store";
import { getDefaultWorldviewStore, type WorldviewStore } from "../state/worldview-store";
import { getDefaultNovelStore, type NovelStore } from "../state/novel-store";
import { getDefaultOutlineStore, type OutlineStore } from "../state/outline-store";
import { getDefaultForeshadowStore, type ForeshadowStore } from "../state/foreshadow-store";
import { getDefaultLocationStore, type LocationStore } from "../state/location-store";
import { saveOutline } from "../output/outline-writer";
import { collectWorldview } from "./agents/worldview-agent";
import { createCharacter } from "./agents/character-agent";
import { createOutline } from "./agents/outline-agent";
import { autoCreateCharacters, filterNewCharacters } from "./agents/auto-character-agent";
import { plantOutlineForeshadows } from "./foreshadow-intake";
import { filterNewLocations, plantNewLocations } from "./location-intake";

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

/** 常见叙事视角（用户也可自定义输入）：大纲结构、章节规划与正文叙述全程遵循 */
const NARRATIVE_POVS = [
  "第一人称",
  "第三人称限知",
  "第三人称全知",
  "多视角轮换",
] as const;

export interface CreateNovelOptions extends WorkflowCacheOptions {
  /** 交互通道（终端 / 协议 / 测试替身），业务交互的唯一出口 */
  channel: UiChannel;
  /** 已有创作 ID：继续未完成主流程，完成时返回缓存结果；缺省时生成新 ID */
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
  /** 伏笔持久化 store；缺省用默认 SQLite store（data/novel.db） */
  foreshadowStore?: ForeshadowStore;
  /** 地点持久化 store；缺省用默认 SQLite store（data/novel.db） */
  locationStore?: LocationStore;
}

/**
 * 小说创作主工作流：生成 ID → 初始化 state → 逐步收集创作参数 → 生成大纲。
 *
 * ID 在调用任何 Agent 之前生成，作为 state 存入数据库时的唯一标识；
 * 主步骤持久化到 SQLite，恢复时重建内存 state 并复用已确认产物。
 * 大纲确认后新增角色自动入库，newForeshadows 伏笔清单随之按幕名/服务角色名
 * 确定性解析入库（未匹配跳过，置于角色入库之后）。
 * 全部交互（提问/确认/展示）经注入的 UiChannel 进行。
 */
export async function createNovel(options: CreateNovelOptions): Promise<NovelState> {
  const channel = options.channel;
  const store = options.store ?? memoryNovelStateStore;
  const characterStore = options.characterStore ?? getDefaultCharacterStore();
  const worldviewStore = options.worldviewStore ?? getDefaultWorldviewStore();
  const novelStore = options.novelStore ?? getDefaultNovelStore();
  const outlineStore = options.outlineStore ?? getDefaultOutlineStore();
  const foreshadowStore = options.foreshadowStore ?? getDefaultForeshadowStore();
  const locationStore = options.locationStore ?? getDefaultLocationStore();
  const runStore = options.runStore ?? new WorkflowRunStore(novelStore.database);
  const resumeRun = options.resumeRunId ? runStore.get(options.resumeRunId)
    : options.id ? runStore.findLatest("create", options.id) : undefined;
  if (options.resumeRunId && !resumeRun) throw new Error("需要恢复的工作流不存在");
  if (resumeRun && options.id && resumeRun.novelId !== options.id) throw new Error("恢复记录与小说不匹配");
  const id = resumeRun?.novelId ?? options.id ?? generateNovelId();

  channel.notify("📖 novel-agent —— 小说创作向导");
  channel.notify(`本次创作 ID：${id}`);
  channel.notify("（该 ID 是后续 state 存档的唯一标识，请妥善保存）\n");

  const existing = await store.get(id);
  if (existing?.status === "outlined" && !options.resumeRunId && !runStore.findPending("create", id)) {
    return existing;
  }
  // workflow_runs 引用 novels，运行记录必须在第一条用户提问之前建立。
  if (!novelStore.getNovel(id)) novelStore.createNovel({ id });
  return runCachedWorkflow({ ...options, resumeRunId: resumeRun?.id, kind: "create", novelId: id, novelStore, runStore }, async (cache) => {
    const initialState = cache.step("initial-state", () => {
      const createdAt = existing?.createdAt ?? new Date().toISOString();
      return { id, status: "initializing" as const, createdAt, updatedAt: createdAt };
    });
    if (!await store.get(id)) await store.create(initialState);
    // 小说命名（可选）：未想好可跳过，后续以大纲标题命名
    channel.notify("\n📝 小说命名（可选）");
    const novelNameInput = await cache.asyncStep("novel-name", () => channel.askText(
      "请输入小说名称（未想好直接回车跳过，后续将以大纲标题命名）> ",
      { optional: true },
    ));
    const novelName = novelNameInput.length > 0 ? novelNameInput : undefined;

    // novels 行必须先于角色/世界观入库（二者 novel_id 外键关联本表）；
    // description 在大纲确认后回填
    cache.step("save-name", () => {
      if (novelName) novelStore.updateNovel(id, { name: novelName });
    });
    channel.notify(
      "✅ 新小说已初始化（state 尚为内存态，novels 已入库，数据库接入后 state 整体持久化）\n",
    );

    // 1. 类型
    channel.stage("type");
    const genre = await cache.asyncStep("genre", () => channel.askSelect("【1/6】选择小说类型", GENRES, { allowCustom: true }));
    cache.step("save-genre", () => novelStore.updateNovel(id, { genre }));

    // 2. 叙事视角（静态菜单 + 自定义，选完即存；大纲 / 章节规划 / 正文全程遵循）
    channel.stage("pov");
    const narrativePov = await cache.asyncStep("narrative-pov", () => channel.askSelect(
      "【2/6】选择叙事视角（正文的叙述人称与信息范围）",
      NARRATIVE_POVS,
      { allowCustom: true },
    ));
    cache.step("save-narrative-pov", () => novelStore.updateNovel(id, { narrativePov }));

    // 3. 受众（LLM 根据类型推断候选，用户多选 + 可补充）
    channel.stage("audience");
    channel.notify("\n【3/6】目标受众");
    channel.notify("正在根据类型推断典型受众群体…");
    const suggestion = await cache.asyncStep("audience-suggestion", async () => (await generateObject({
      model,
      schema: audienceSuggestionSchema,
      prompt: `小说类型：${genre}。请列出该类型小说常见且典型的目标受众群体（5-8 个），每个附一句话阅读偏好说明。`,
    })).object);
    const audienceOptions = suggestion.options.map((o) => `${o.label}——${o.description}`);
    const chosen = await cache.asyncStep("audience-selection", () => channel.askMultiSelect("请选择目标受众（可多选）", audienceOptions));
    const supplement = await cache.asyncStep("audience-supplement", () => channel.askText("补充说明（可直接回车跳过）> ", { optional: true }));
    const audienceLabels = chosen.map(
      (display) => suggestion.options[audienceOptions.indexOf(display)]?.label ?? display,
    );
    const audience = [...audienceLabels, ...(supplement.length > 0 ? [supplement] : [])];
    cache.step("save-audience", () => novelStore.updateNovel(id, { audience }));

    // 4. 世界观（独立 ReAct Agent 多轮收集）
    channel.stage("worldview");
    channel.notify("\n【4/6】世界观设定");
    const initialWorldview = await cache.asyncStep("worldview-input", () => channel.askText(
      "请描述你的世界观构想（一段文字即可，不清楚的地方 AI 会追问）> ",
    ));
    channel.notify("\n🌍 世界观 Agent 启动，将与你多轮确认世界观…");
    const worldview = await cache.asyncStep("confirmed-worldview", () => collectWorldview(initialWorldview, channel));
    channel.present({ kind: "worldview", worldview });
    // 世界观确认后按创作 ID 入库（upsert）
    cache.step("save-worldview", () => worldviewStore.saveWorldview(id, worldview));
    channel.notify("🌍 世界观已入库");

    // 5. 角色设定（ReAct Agent 逐字段确认，至少一名主角）
    channel.stage("character");
    channel.notify("\n【5/6】角色设定");
    const characters: Character[] = [];
    for (;;) {
      const hasProtagonist = characters.some((c) => c.core.narrativeRole.includes("主角"));
      const description = await cache.asyncStep(`character-${characters.length}-input`, async () => {
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
          if (line.length === 0) return null;
          description = line;
        }
        return description;
      });
      if (description === null) break;
      channel.notify("\n🧙 角色 Agent 启动（逐字段确认角色卡）…");
      const index = characters.length;
      const character = await cache.asyncStep(`character-${index}-confirmed`, () => createCharacter(description, characters, channel));
      characters.push(character);
      // 角色确认后立即按创作 ID 入库（增量持久化）
      cache.step(`character-${index}-saved`, () => characterStore.addCharacter(id, character));
      channel.notify(
        `\n✅ 角色已确认并入库：${character.basicInfo.name}（${character.core.narrativeRole}）`,
      );
    }

    // 6. 核心冲突（自由文本 → schema 归一化）
    channel.stage("conflict");
    channel.notify("\n【6/6】核心冲突");
    const conflictDescription = await cache.asyncStep("conflict-input", () => channel.askText(
      "请描述核心冲突（由来 / 对角色的影响 / 理想的解决结果，写个大概即可）> ",
    ));
    channel.notify("正在整理核心冲突…");
    const conflict = await cache.asyncStep("confirmed-conflict", async () => (await generateObject({
      model,
      schema: coreConflictSchema,
      prompt: `小说类型：${genre}。用户对核心冲突的描述：\n${conflictDescription}\n\n请整理为结构化核心冲突，三项均需基于用户描述提炼，可合理细化但不得虚构冲突主轴。`,
    })).object);
    channel.present({ kind: "conflict", conflict });
    cache.step("save-conflict", () => novelStore.updateNovel(id, { coreConflict: conflict }));

    // 参数收集完毕，落 state
    const params: NovelParams = { genre, narrativePov, audience, worldview, characters, coreConflict: conflict };
    await store.update(id, { status: "gathering", params });

    // 大纲结构：幕数（默认 5）→ 部数（默认 1，上限为幕数）
    channel.stage("outline");
    const actCount = await cache.asyncStep("act-count", () => channel.askInt("请输入整本剧情拆分的幕数", {
      min: 3,
      max: 20,
      default: 5,
    }));
    const partCount = await cache.asyncStep("part-count", () => channel.askInt(`这 ${actCount} 幕拆分为几部`, {
      min: 1,
      max: actCount,
      default: 1,
    }));

    // 大纲（ReAct Agent，部 → 幕两级结构）
    channel.notify("\n🛠 大纲 Agent 启动…");
    const submission = await cache.asyncStep("confirmed-outline", () => createOutline(
      params,
      { novelTitle: novelName, actCount, partCount, novelId: id, characterStore, locationStore },
      channel,
    ));
    const outline = submission.outline;
    channel.present({ kind: "outline", detail: "full", outline });

    // 确认后入库（outlines 表两级树，梗概与关键情节点随节点入列）并落盘 output/<id>.json
    const treeNodes = cache.step("save-outline-tree", () => {
      if (outlineStore.listOutlineNodes(id, { currentOnly: true }).length > 0) {
        throw new Error("大纲版本已变更，无法将新建任务写入已有大纲");
      }
      return outlineStore.saveOutlineTree(id, outline.parts);
    });
    const assertCurrentTree = () => {
      if (treeNodes.some((n) => !outlineStore.getOutlineNode(n.id)?.node.isCurrentVersion)) {
        throw new Error("大纲版本已变更，无法继续旧版本的新建任务");
      }
    };
    assertCurrentTree();
    const partTotal = treeNodes.filter((n) => n.node.type === "part").length;
    const actTotal = treeNodes.filter((n) => n.node.type === "act").length;
    channel.notify(`🗂 大纲树已入库（含梗概与关键情节点）：${partTotal} 部 / ${actTotal} 幕`);
    const savedPath = await saveOutline(id, outline);
    channel.notify(`🗂 大纲已落盘：${savedPath}`);

    // 章节规划不随大纲自动进行：会话至此收尾（run_finished），
    // 各幕章节由用户在客户端幕节点「规划本幕章节」入口经单幕规划会话逐幕手动发起
    const finalState = await store.update(id, { status: "outlined", outline });
    // 大纲确认后回填：description = 剧情梗概；name 仅在用户未命名时以大纲标题回填
    cache.step("update-novel", () => novelStore.updateNovel(id, {
      ...(novelName ? {} : { name: outline.title }),
      description: outline.logline,
    }));

    // 大纲新增地点确定性入库：置于角色自动入库之前——毫秒级同步代码先行完成即
    // 「与角色同批次」，不并行（两路 notify 交错无收益）；空清单（过滤后）整块跳过。
    cache.step("save-locations", () => {
      const existingLocations = locationStore.listLocations(id).map((l) => l.location);
      const pendingLocations = filterNewLocations(submission.newLocations, existingLocations);
      if (pendingLocations.length > 0) {
        channel.notify(`\n✨ 大纲引入了 ${pendingLocations.length} 个新地点，正在入库…`);
        plantNewLocations({ novelId: id, newLocations: pendingLocations, channel, locationStore });
        channel.notify(
          `✨ 本次大纲新增 ${pendingLocations.length} 个地点已自动入库：${pendingLocations.map((l) => l.name).join("、")}`,
        );
      }
    });

    // 大纲新增角色自动入库：代码级兜底 diff（剔除库内已有名 + 去重），空清单跳过（零 LLM 调用）。
    // 置于 state 收尾与 name/description 回填之后：auto 块抛错（maxSteps 耗尽/中止）时
    // 小说本身已是自洽的终态（outlined + 回填完成），不会停留在「半成品」。
    await cache.asyncStep("auto-characters", async () => {
      const existingCharacters = characterStore.listCharacters(id).map((c) => c.character);
      const pendingNew = filterNewCharacters(submission.newCharacters, existingCharacters);
      if (pendingNew.length > 0) {
        channel.notify(`\n✨ 大纲引入了 ${pendingNew.length} 个新角色，正在自动填充角色卡并入库…`);
        await autoCreateCharacters({
          novelId: id,
          worldview,
          outline,
          newCharacters: pendingNew,
          existingCharacters,
          channel,
          characterStore,
        });
        channel.notify(
          `✨ 本次大纲新增 ${pendingNew.length} 个角色已自动入库：${pendingNew.map((c) => c.name).join("、")}`,
        );
      }
    });
    assertCurrentTree();

    // 大纲伏笔入库：确定性代码创建（角色已入库，服务角色名可解析）；幕名/角色名未匹配逐条跳过并警告。
    // 置于角色自动入库块之后：伏笔清单可能引用本轮自动入库的新角色（服务角色 ID 需角色先入库）。
    cache.step("save-foreshadows", () => {
      if (submission.newForeshadows.length > 0) {
        channel.notify(`\n✨ 大纲安排了 ${submission.newForeshadows.length} 处伏笔，正在入库…`);
        const actNodes = treeNodes
          .filter((n) => n.node.type === "act")
          .map((n) => ({ id: n.id, name: n.node.name }));
        const { created, skipped } = plantOutlineForeshadows({
          novelId: id,
          newForeshadows: submission.newForeshadows,
          characters: characterStore.listCharacters(id),
          actNodes,
          channel,
          foreshadowStore,
        });
        channel.notify(
          `✨ 本次大纲伏笔已入库 ${created} 处${skipped > 0 ? `（${skipped} 处因幕名/角色名未匹配跳过）` : ""}`,
        );
      }
    });

    const finalName = novelName ?? outline.title;
    channel.notify(`\n✅ 小说《${finalName}》初始化完成！创作 ID：${id}`);
    channel.notify("📑 章节规划不自动进行——请在书库中打开小说，从幕节点「规划本幕章节」逐幕发起");
    return finalState;
  });
}

import {
  askConfirm as confirmLine,
  askInt as intLine,
  askLine,
  askMultiSelect as multiSelectLine,
  askOptional,
  askRequired,
  askSelect as selectLine,
  closePrompt,
} from "../cli/prompt";
import type {
  ChapterPlanView,
  Character,
  CoreConflict,
  Outline,
  Stage,
  View,
  Worldview,
} from "@novel/shared";
import type { UiChannel } from "./channel";

/**
 * 终端交互通道：包装 cli/prompt 原语，视图渲染为文本。
 * 确认门视图与提问拼成同一条提示原子出现（并发确认时摘要与提问不会错位）。
 */
export class CliChannel implements UiChannel {
  async askLine(prompt: string): Promise<string | null> {
    return askLine(prompt);
  }

  async askText(prompt: string, opts?: { optional?: boolean }): Promise<string> {
    return opts?.optional ? askOptional(prompt) : askRequired(prompt);
  }

  async askSelect(
    prompt: string,
    options: readonly string[],
    opts?: { allowCustom?: boolean },
  ): Promise<string> {
    return selectLine(prompt, options, opts);
  }

  async askMultiSelect(prompt: string, options: readonly string[]): Promise<string[]> {
    return multiSelectLine(prompt, options);
  }

  async askConfirm(prompt: string, opts?: { default?: boolean; view?: View }): Promise<boolean> {
    const viewText = opts?.view ? `\n${renderView(opts.view)}\n` : "";
    return confirmLine(`${viewText}${prompt}`, opts?.default ?? true);
  }

  async askInt(prompt: string, opts: { min: number; max: number; default: number }): Promise<number> {
    return intLine(prompt, opts);
  }

  notify(text: string): void {
    console.log(text);
  }

  stage(_stage: Stage): void {
    // CLI 的阶段标记已由 notify 文本承载（【1/5】…），无需重复输出
  }

  present(view: View): void {
    console.log(`\n${renderView(view)}`);
  }

  close(): void {
    closePrompt();
  }
}

/** 视图 → 终端文本（确认门拼入提问、present 独立展示共用；导出供单测） */
export function renderView(view: View): string {
  switch (view.kind) {
    case "field-summary":
      return `📋 【${view.label}】${view.summary}`;
    case "character-card":
      return formatCharacterCard(view.character);
    case "outline":
      return view.detail === "confirm"
        ? formatOutlineForConfirm(view.outline)
        : formatOutlineFull(view.outline);
    case "chapter-plan":
      return formatChapterPlan(view);
    case "worldview":
      return formatWorldview(view.worldview);
    case "conflict":
      return formatConflict(view.conflict);
  }
}

/** 格式化完整角色卡（拼入 submit 最终确认提示，随提问原子出现） */
function formatCharacterCard(c: Character): string {
  const lines = [
    `📝 角色卡汇总：`,
    `  👤 ${c.basicInfo.name}（${c.core.narrativeRole}${c.basicInfo.gender ? `，${c.basicInfo.gender}` : ""}）`,
  ];
  if (c.basicInfo.appearance) lines.push(`     外貌：${c.basicInfo.appearance}`);
  lines.push(`     渴望：${c.core.desire}`);
  lines.push(`     恐惧：${c.core.fear}`);
  lines.push(`     背景：${c.background}`);
  if (c.personality) lines.push(`     性格：${c.personality}`);
  if (c.characterGoal) lines.push(`     角色目的：${c.characterGoal}`);
  lines.push(`     创作目的：${c.creationPurpose}`);
  if (c.trajectory) lines.push(`     轨迹：${c.trajectory}`);
  lines.push(`     结局方向：${c.endingDirection}`);
  if (c.relationships) lines.push(`     关系：${c.relationships}`);
  return lines.join("\n");
}

/** 确认视图：剧情梗概、主题、两级部/幕名称与概述（详细情节点在保存后完整展示） */
function formatOutlineForConfirm(o: Outline): string {
  const lines = [`📖 大纲草稿：《${o.title}》`, `  剧情梗概：${o.logline}`];
  if (o.theme) lines.push(`  主题：${o.theme}`);
  for (const part of o.parts) {
    lines.push(`  ▶ ${part.name}：${part.summary}`);
    for (const act of part.acts) {
      lines.push(`    ▶ ${act.name}：${act.summary}`);
    }
  }
  return lines.join("\n");
}

/** 全量大纲：含每幕关键情节点 */
function formatOutlineFull(o: Outline): string {
  const lines = [`✅ 大纲已生成：`, `  《${o.title}》——${o.logline}`];
  if (o.theme) lines.push(`  主题：${o.theme}`);
  o.parts.forEach((part) => {
    lines.push(`  ▶ ${part.name}：${part.summary}`);
    part.acts.forEach((act) => {
      lines.push(`    ▶ ${act.name}：${act.summary}`);
      act.keyPlotPoints.forEach((p, i) => lines.push(`      ${i + 1}) ${p}`));
    });
  });
  return lines.join("\n");
}

/** 章节规划确认视图：本幕梗概、关键情节点与推荐章节列表（拼入 save_chapters 最终确认提示） */
function formatChapterPlan(view: ChapterPlanView): string {
  const lines = [
    `📑 章节规划草稿（${view.actName}）`,
    `  本幕梗概：${view.actSummary}`,
    `  关键情节点：`,
    ...view.keyPlotPoints.map((p, i) => `    ${i + 1}) ${p}`),
    `  拟分 ${view.plan.chapters.length} 章：`,
    ...view.plan.chapters.map((c, i) => `    第${i + 1}章 ${c.name}：${c.summary}`),
  ];
  return lines.join("\n");
}

function formatWorldview(wv: Worldview): string {
  const lines = [
    `✅ 世界观已确认：`,
    `  地理位置：${wv.background.geography}`,
  ];
  if (wv.background.fantasyAttributes) {
    lines.push(`  架空属性：${wv.background.fantasyAttributes}`);
  }
  if (wv.background.realWorldMapping) {
    lines.push(`  现实映射：${wv.background.realWorldMapping}`);
  }
  lines.push(`  禁忌：${wv.taboos.join("；")}`);
  return lines.join("\n");
}

function formatConflict(c: CoreConflict): string {
  return [
    `✅ 核心冲突已确认：`,
    `  由来：${c.origin}`,
    `  影响：${c.impact}`,
    `  理想解决：${c.idealResolution}`,
  ].join("\n");
}

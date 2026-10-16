import { tool } from "ai";
import { z } from "zod";
import type { ChapterNewForeshadow } from "@novel/shared";
import { runReactAgent } from "../agents/react";
import type { UiChannel } from "../ui/channel";
import { validateChapterForeshadowPlan, type ChapterPlanSubmission, type PlanChaptersInput } from "./agents/chapter-agent";

type FullOutline = NonNullable<PlanChaptersInput["fullOutline"]>;

/** 固定序号沿用原确认产物，只补原本留空、如今已有章的回收幕。 */
export function pendingForeshadowRecoveries(foreshadows: readonly ChapterNewForeshadow[], outline: FullOutline) {
  return foreshadows.flatMap((foreshadow, index) => (foreshadow.recoveryPlan ?? []).flatMap((recovery) => {
    if (recovery.chapterNames.length > 0) return [];
    const matches = outline.filter((act) => act.name === recovery.actName.trim());
    if (matches.length !== 1) throw new Error(`已确认的回收幕「${recovery.actName}」不存在或不唯一，无法安全细化`);
    const act = matches[0]!;
    return act.chapters.length > 0 ? [{ foreshadowIndex: index + 1, actName: recovery.actName, chapters: act.chapters }] : [];
  }));
}

const recoveriesSchema = z.object({
  recoveries: z.array(z.object({
    foreshadowIndex: z.number().int().min(1),
    actName: z.string().min(1),
    chapterNames: z.array(z.string().min(1)).min(1)
      .refine((names) => new Set(names).size === names.length, "回收章不得重复"),
  }).strict()).min(1),
}).strict();

/** 已确认规划暂停期间，后续幕新建了章节；模型仅选择真实回收章，再次确认后才执行入库。 */
export async function refineForeshadowRecoveries(
  input: PlanChaptersInput & { fullOutline: FullOutline },
  submission: ChapterPlanSubmission,
  channel: UiChannel,
): Promise<ChapterNewForeshadow[]> {
  const targets = pendingForeshadowRecoveries(submission.newForeshadows, input.fullOutline);
  if (targets.length === 0) return submission.newForeshadows;
  let saved: ChapterNewForeshadow[] | undefined;
  const key = (index: number, actName: string) => JSON.stringify([index, actName]);
  const expected = new Set(targets.map((target) => key(target.foreshadowIndex, target.actName)));
  const saveRecoveries = tool({
    description: "仅为指定伏笔序号及回收幕选择已存在的真实回收章。必须完整覆盖固定清单，不得修改章规划、伏笔内容、其他回收幕或已有回收章。选择后交用户再次确认。",
    inputSchema: recoveriesSchema,
    execute: async (value) => {
      const parsed = recoveriesSchema.safeParse(value);
      if (!parsed.success) return { ok: false as const, error: parsed.error.message };
      const selected = new Map(parsed.data.recoveries.map((entry) => [key(entry.foreshadowIndex, entry.actName), entry]));
      if (selected.size !== parsed.data.recoveries.length || selected.size !== expected.size
        || [...selected.keys()].some((entry) => !expected.has(entry))) {
        return { ok: false as const, error: "必须完整且恰好覆盖待细化的伏笔序号和回收幕，每项只能提交一次" };
      }
      const refined = submission.newForeshadows.map((foreshadow, index) => {
        if (!targets.some((target) => target.foreshadowIndex === index + 1)) return foreshadow;
        return { ...foreshadow, recoveryPlan: foreshadow.recoveryPlan.map((recovery) => ({
          ...recovery, chapterNames: selected.get(key(index + 1, recovery.actName))?.chapterNames ?? recovery.chapterNames,
        })) };
      });
      const errors = validateChapterForeshadowPlan({
        ...submission.plan, newForeshadows: refined, newLocations: submission.newLocations,
        foreshadowBindings: [], foreshadowRecoverBindings: [],
      }, input, { unboundForeshadows: [], recoverableForeshadows: [] });
      if (errors.length > 0) return { ok: false as const, error: errors.join("；") };
      const confirmed = await channel.askConfirm("后续幕已有章节，以上伏笔回收细化是否确认？", {
        default: true,
        view: { kind: "chapter-plan", actName: input.actName, actSummary: input.actSummary,
          keyPlotPoints: [...input.keyPlotPoints], plan: submission.plan, newForeshadows: refined,
          newLocations: submission.newLocations, foreshadowBindings: submission.foreshadowBindings,
          foreshadowRecoverBindings: submission.foreshadowRecoverBindings },
      });
      if (!confirmed) return { ok: false as const, feedback: await channel.askText("请说明回收章选择需要调整的地方> ") };
      saved = refined;
      return { ok: true as const };
    },
  });
  channel.notify("🔗 原计划留空的后续回收幕已有章节，正在补充真实回收章选择…");
  const result = await runReactAgent({
    system: "你只负责细化已确认伏笔的回收章。章规划及伏笔其他字段已经确认，禁止重新规划、改写或虚构章节；仅为固定伏笔序号和回收幕从已有真实章节中选择回收章，严格晚于登场章。参考既有剧情判断，完整覆盖指定清单后调用 save_foreshadow_recoveries，并根据用户反馈修订选择。",
    prompt: [`小说：${input.novelTitle}；原规划幕：${input.actName}`,
      `已确认的原章节规划及伏笔（只读）：\n${JSON.stringify(submission, null, 2)}`,
      `当前全书大纲与已有真实章节：\n${JSON.stringify(input.fullOutline, null, 2)}`,
      `唯一允许细化的清单：\n${JSON.stringify(targets, null, 2)}`].join("\n\n"),
    tools: { save_foreshadow_recoveries: saveRecoveries }, maxSteps: 8,
    isDone: () => saved !== undefined,
    continuationHint: "请调用 save_foreshadow_recoveries 完整提交固定清单的真实回收章选择，不得重写原规划。",
  });
  if (!saved) throw new Error(`伏笔回收细化未能完成，保留原确认产物等待恢复。最后输出：${result.text}`);
  return saved;
}

import { z } from "zod";

/**
 * 章节规划：把一幕（act）拆解为若干章（chapter）的写作期计划。
 * 章节数量由模型按幕梗概与关键情节点的密度推荐（上限 12 防漂移），
 * 每章有章名、剧情概述与登场角色清单（库内 + 新角色全列——确认入库后
 * 编排层据此派生新角色建卡，并把全部登场角色 ID 绑定回章节点）。
 */
export const chapterPlanSchema = z
  .object({
    chapters: z
      .array(
        z.object({
          name: z.string().min(1).describe("章名，如：第一章·雨夜来客"),
          summary: z.string().min(1).describe("本章剧情概述"),
          characters: z
            .array(
              z.object({
                name: z.string().min(1).describe("登场角色名（角色库已有角色用真实名字）"),
                role: z
                  .string()
                  .min(1)
                  .describe(
                    "该角色在本章的定位/作用一句话；不在角色库中的新角色须给设定级一句话定位（自动建卡依据），如「血宗宗主·本章首次登场的主要反派」",
                  ),
              }),
            )
            .min(1)
            .max(12)
            .describe("本章登场角色清单（库内已有与新角色均须列出）"),
        }),
      )
      .min(1)
      .max(12)
      .describe("章节规划：数量由模型按幕内容推荐（通常 3~8 章）"),
  })
  .refine((plan) => plan.chapters.every((c) => new Set(c.characters.map((x) => x.name)).size === c.characters.length), {
    path: ["chapters"],
    message: "同一章的登场角色清单内名字不得重复",
  });

export type ChapterPlan = z.infer<typeof chapterPlanSchema>;

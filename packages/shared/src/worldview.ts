import { z } from "zod";

/**
 * 世界观知识（由世界观 ReAct Agent 与用户多轮对话后产出）。
 */
export const worldviewSchema = z.object({
  background: z.object({
    /** 背景地理位置：xx世界、xx大陆、xx市，可为架空（如维斯特洛大陆） */
    geography: z.string().min(1).describe("背景地理位置"),
    /** 架空属性（可选）：与现实不同的规则体系，如魔法世界、仙侠修炼体系 */
    fantasyAttributes: z.string().min(1).optional().describe("架空属性"),
    /** 现实世界映射（可选）：政治/经济等模式对应的现实原型 */
    realWorldMapping: z.string().min(1).optional().describe("现实世界映射"),
  }).describe("世界背景设定"),
  /** 本世界观下绝对不能发生/出现的内容（如古代背景不得出现现代物品，穿越类除外） */
  taboos: z.array(z.string().min(1)).min(1).describe("世界观禁忌"),
});

export type Worldview = z.infer<typeof worldviewSchema>;

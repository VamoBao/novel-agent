import { z } from "zod";

/**
 * 角色卡 schema：主角设定按此结构定义（至少一名主角）。
 */
export const characterSchema = z.object({
  name: z.string().min(1).describe("姓名"),
  identity: z.string().min(1).describe("身份/职业/种族"),
  age: z.string().optional().describe("年龄（可为“不详”“千年”等描述）"),
  appearance: z.string().optional().describe("外貌特征"),
  personality: z.string().min(1).describe("性格特质"),
  background: z.string().min(1).describe("背景经历"),
  motivation: z.string().min(1).describe("行动动机与目标"),
  abilities: z.array(z.string()).default([]).describe("能力（含架空体系下的能力）"),
  relationships: z
    .array(
      z.object({
        target: z.string().describe("关系对象"),
        relation: z.string().describe("关系描述"),
      }),
    )
    .default([])
    .describe("与其他角色的关系"),
});

export type Character = z.infer<typeof characterSchema>;

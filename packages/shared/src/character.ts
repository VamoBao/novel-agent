import { z } from "zod";

/**
 * 角色卡 schema：由角色 ReAct Agent 与用户逐字段确认后组装。
 *
 * 属性一览：
 * - basicInfo 基本信息：姓名 / 性别 / 外貌特征
 * - core 内核（必填，固定不变）：想要什么、害怕什么、叙事定位（主角/配角/反派等功能角色）
 * - background 背景（必填，固定不变）：门派、师承、身世等
 * - personality 性格：决定创作时做事的方式与说话的风格
 * - characterGoal 角色目的：故事线中的最终目的（如「成为海贼王」）
 * - creationPurpose 创作目的（必填，固定不变）：创作者创建该角色所服务的东西（如「逼出主角的成长」）
 * - trajectory 轨迹：概括性的人生轨迹
 * - endingDirection 结局方向（必填，固定不变）：如「为主角牺牲」「被主角击败」
 * - relationships 关系：与其他角色的概括性关系（如 A 与 B 是师徒，B 与 C 敌对）
 */
export const characterSchema = z.object({
  basicInfo: z
    .object({
      name: z.string().min(1).describe("姓名"),
      gender: z.string().optional().describe("性别"),
      appearance: z.string().optional().describe("外貌特征"),
    })
    .describe("基本信息"),
  core: z
    .object({
      desire: z.string().min(1).describe("这个角色想要什么"),
      fear: z.string().min(1).describe("这个角色害怕什么"),
      narrativeRole: z.string().min(1).describe("叙事定位：主角/配角/反派等功能角色"),
    })
    .describe("内核（固定不变）"),
  background: z.string().min(1).describe("背景：门派/师承/身世等（固定不变）"),
  personality: z.string().optional().describe("性格：决定做事方式与说话风格"),
  characterGoal: z.string().optional().describe("角色目的：故事线中的最终目的"),
  creationPurpose: z
    .string()
    .min(1)
    .describe("创作目的：创作者创建该角色所服务的东西（固定不变）"),
  trajectory: z.string().optional().describe("轨迹：概括性的人生轨迹"),
  endingDirection: z.string().min(1).describe("结局方向（固定不变）"),
  relationships: z.string().optional().describe("与其他角色的概括性关系"),
});

export type Character = z.infer<typeof characterSchema>;

import type { Stage } from "@novel/shared";

export const CREATION_STEPS: { stage: Stage | null; label: string; description: string }[] = [
  { stage: null, label: "故事起点", description: "先给故事一个名字，灵感也可以稍后再来。" },
  { stage: "type", label: "小说类型", description: "选择故事的类型，确定它的基调与想象空间。" },
  { stage: "pov", label: "叙事视角", description: "决定读者将透过谁的眼睛，走进这个故事。" },
  { stage: "audience", label: "目标读者", description: "想一想，你希望这个故事打动怎样的读者。" },
  { stage: "worldview", label: "世界观", description: "搭建故事发生的世界，让想象有迹可循。" },
  { stage: "character", label: "角色设定", description: "从主角开始，赋予每个人物欲望、困境与方向。" },
  { stage: "conflict", label: "核心冲突", description: "找到推动人物行动、让故事持续向前的力量。" },
  { stage: "outline", label: "故事大纲", description: "把世界、人物与冲突，编织成完整的故事脉络。" },
];

export function creationStep(stage: Stage | null) {
  return CREATION_STEPS.find((step) => step.stage === stage)
    ?? { stage, label: "章节规划", description: "细化本幕的章节、人物登场与伏笔安排。" };
}

export function questionTitle(prompt: string): string {
  return prompt.replace(/^【\d+\/\d+】\s*/, "").replace(/\s*>\s*$/, "").trim();
}

/** 终端横幅与内部元数据由工作台的标题/状态承接，不进入产品内容。 */
export function creationNotice(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || /^(?:📖 novel-agent|本次创作 ID：|（该 ID|【\d+\/\d+】)/u.test(trimmed)) return null;
  if (trimmed.includes("state 尚为内存态")) return "创作空间已准备就绪，接下来一起建立故事设定。";
  return trimmed.replace(/^[\s\p{Extended_Pictographic}\uFE0F✅⚠♻]+/u, "");
}

export const TOOL_LABELS: Record<string, string> = {
  ask_user: "向你提问", save_field: "整理角色字段", submit_character: "确认角色卡",
  submit_worldview: "整理世界观", save_outline: "提交故事大纲", list_characters: "查询角色库",
  list_locations: "查询地点库", save_character: "保存新增角色", save_chapters: "提交章节规划",
  save_foreshadow_recoveries: "细化伏笔回收",
};

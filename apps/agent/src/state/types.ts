import type { Character, CoreConflict, Outline, Worldview } from "@novel/shared";

export type NovelStatus = "initializing" | "gathering" | "outlined";

/** 构建大纲所需的基本参数（由初始化流程逐步收集） */
export interface NovelParams {
  genre: string;
  audience: string[];
  worldview: Worldview;
  /** 角色卡列表（内核/背景/创作目的/结局方向为固定属性；至少一名主角） */
  characters: Character[];
  coreConflict: CoreConflict;
}

/** 一本小说的完整创作状态（后续将以 id 为主键存入数据库） */
export interface NovelState {
  id: string;
  status: NovelStatus;
  createdAt: string;
  updatedAt: string;
  params?: NovelParams;
  outline?: Outline;
}

/** update 允许覆盖的字段；updatedAt 由 store 自动盖章 */
export type NovelStatePatch = Partial<Pick<NovelState, "status" | "params" | "outline">>;

/**
 * 小说创作状态的存取接口。
 * 当前只有内存实现；接入数据库时提供新的实现类替换即可，工作流代码不变。
 */
export interface NovelStateStore {
  get(id: string): Promise<NovelState | undefined>;
  create(state: NovelState): Promise<void>;
  update(id: string, patch: NovelStatePatch): Promise<NovelState>;
}

import type { NovelState, NovelStatePatch, NovelStateStore } from "./types";

/**
 * 内存实现的状态存储：进程生命周期内有效，重启即失。
 * 数据库接入前的过渡方案，接口见 NovelStateStore。
 */
export class MemoryNovelStateStore implements NovelStateStore {
  private readonly states = new Map<string, NovelState>();

  async get(id: string): Promise<NovelState | undefined> {
    return this.states.get(id);
  }

  async create(state: NovelState): Promise<void> {
    if (this.states.has(state.id)) {
      throw new Error(`小说状态已存在：${state.id}`);
    }
    this.states.set(state.id, state);
  }

  async update(id: string, patch: NovelStatePatch): Promise<NovelState> {
    const current = this.states.get(id);
    if (!current) {
      throw new Error(`小说状态不存在，无法更新：${id}`);
    }
    const next: NovelState = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.states.set(id, next);
    return next;
  }
}

/** 默认全局内存 store（单进程 CLI 场景足够） */
export const memoryNovelStateStore = new MemoryNovelStateStore();

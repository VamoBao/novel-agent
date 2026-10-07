import type { UiChannel } from "../ui/channel";
import type { StoredCharacter } from "../state/character-store";
import {
  getDefaultForeshadowStore,
  type ForeshadowStore,
  type StoredForeshadow,
} from "../state/foreshadow-store";
import type {
  ChapterNewForeshadow,
  ForeshadowBinding,
  OutlineNewForeshadow,
} from "@novel/shared";

export interface PlantOutlineResult {
  created: number;
  skipped: number;
}

export interface PlantChapterResult {
  created: number;
  skipped: number;
  bound: number;
}

/** 服务角色名 → ID（trim 全等；重复名幂等；未解析名单返回供警告） */
export function resolveCharacterIds(
  names: readonly string[],
  characters: readonly { id: string; name: string }[],
): { ids: string[]; unresolved: string[] } {
  const byName = new Map(characters.map((c) => [c.name.trim(), c.id]));
  const ids: string[] = [];
  const unresolved: string[] = [];
  for (const name of names) {
    const id = byName.get(name.trim());
    if (id === undefined) {
      unresolved.push(name);
    } else if (!ids.includes(id)) {
      ids.push(id);
    }
  }
  return { ids, unresolved };
}

/**
 * 大纲阶段伏笔入库（确定性代码，无 LLM）：幕名→幕节点、服务角色名→ID 逐条解析，
 * 未匹配按策略跳过并经 notify 警告——不阻塞其余条目；回收状态恒为未回收。
 */
export function plantOutlineForeshadows(options: {
  novelId: string;
  newForeshadows: OutlineNewForeshadow[];
  characters: readonly StoredCharacter[];
  actNodes: readonly { id: string; name: string }[];
  channel: UiChannel;
  foreshadowStore?: ForeshadowStore;
}): PlantOutlineResult {
  const store = options.foreshadowStore ?? getDefaultForeshadowStore();
  const characters = options.characters.map((c) => ({ id: c.id, name: c.character.basicInfo.name }));
  let created = 0;
  let skipped = 0;
  for (const item of options.newForeshadows) {
    const act = options.actNodes.find((a) => a.name === item.actName.trim());
    if (!act) {
      options.channel.notify(`⚠️ 伏笔跳过（埋设幕「${item.actName}」未在大纲中找到）：${item.surfaceAction}`);
      skipped += 1;
      continue;
    }
    const { ids, unresolved } = resolveCharacterIds(item.characterNames, characters);
    if (ids.length === 0) {
      options.channel.notify(`⚠️ 伏笔跳过（服务角色全部无法解析：${unresolved.join("、")}）：${item.surfaceAction}`);
      skipped += 1;
      continue;
    }
    if (unresolved.length > 0) {
      options.channel.notify(`⚠️ 伏笔「${item.surfaceAction}」的未解析服务角色已剔除：${unresolved.join("、")}`);
    }
    store.addForeshadow(
      options.novelId,
      {
        surfaceAction: item.surfaceAction,
        hiddenTruth: item.hiddenTruth,
        attentionLevel: item.attentionLevel,
        recoveryStatus: "unrecovered",
        characterIds: ids,
      },
      act.id,
    );
    options.channel.notify(`✨ 伏笔已入库：${item.surfaceAction}（埋设：${act.name}）`);
    created += 1;
  }
  return { created, skipped };
}

/**
 * 章节规划阶段伏笔处理（章节入库后调用）：新伏笔带登场章与幕归属入库；
 * 绑定指令把回传清单中的未绑伏笔 patch 到登场章——序号越界 / 章名未匹配跳过并警告。
 */
export function plantChapterForeshadows(options: {
  novelId: string;
  actNodeId: string;
  newForeshadows: ChapterNewForeshadow[];
  bindings: ForeshadowBinding[];
  characters: readonly StoredCharacter[];
  chapterNodes: readonly { id: string; name: string }[];
  unbound: readonly StoredForeshadow[];
  channel: UiChannel;
  foreshadowStore?: ForeshadowStore;
}): PlantChapterResult {
  const store = options.foreshadowStore ?? getDefaultForeshadowStore();
  const characters = options.characters.map((c) => ({ id: c.id, name: c.character.basicInfo.name }));
  let created = 0;
  let skipped = 0;
  let bound = 0;
  for (const item of options.newForeshadows) {
    const chapter = options.chapterNodes.find((c) => c.name === item.chapterName.trim());
    if (!chapter) {
      options.channel.notify(`⚠️ 新伏笔跳过（登场章「${item.chapterName}」未在本次规划中找到）：${item.surfaceAction}`);
      skipped += 1;
      continue;
    }
    const { ids, unresolved } = resolveCharacterIds(item.characterNames, characters);
    if (ids.length === 0) {
      options.channel.notify(`⚠️ 新伏笔跳过（服务角色全部无法解析：${unresolved.join("、")}）：${item.surfaceAction}`);
      skipped += 1;
      continue;
    }
    if (unresolved.length > 0) {
      options.channel.notify(`⚠️ 伏笔「${item.surfaceAction}」的未解析服务角色已剔除：${unresolved.join("、")}`);
    }
    store.addForeshadow(
      options.novelId,
      {
        surfaceAction: item.surfaceAction,
        hiddenTruth: item.hiddenTruth,
        attentionLevel: item.attentionLevel,
        recoveryStatus: "unrecovered",
        appearChapterId: chapter.id,
        characterIds: ids,
      },
      options.actNodeId,
    );
    options.channel.notify(`✨ 伏笔已入库：${item.surfaceAction}（登场：${chapter.name}）`);
    created += 1;
  }
  for (const binding of options.bindings) {
    const target = options.unbound[binding.index - 1];
    if (!target) {
      options.channel.notify(`⚠️ 伏笔绑定跳过（序号 ${binding.index} 越界，清单共 ${options.unbound.length} 条）`);
      skipped += 1;
      continue;
    }
    const chapter = options.chapterNodes.find((c) => c.name === binding.chapterName.trim());
    if (!chapter) {
      options.channel.notify(`⚠️ 伏笔绑定跳过（登场章「${binding.chapterName}」未在本次规划中找到）：${target.foreshadow.surfaceAction}`);
      skipped += 1;
      continue;
    }
    store.updateForeshadow(target.id, { appearChapterId: chapter.id });
    options.channel.notify(`🔗 伏笔已绑定登场章：${target.foreshadow.surfaceAction}（${chapter.name}）`);
    bound += 1;
  }
  return { created, skipped, bound };
}

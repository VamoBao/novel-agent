import type { UiChannel } from "../ui/channel";
import type { StoredCharacter } from "../state/character-store";
import {
  getDefaultForeshadowStore,
  type ForeshadowStore,
  type StoredForeshadow,
} from "../state/foreshadow-store";
import {
  buildChapterOrder,
  type ChapterOrderNode,
  type ChapterNewForeshadow,
  type ForeshadowBinding,
  type OutlineNewForeshadow,
} from "@novel/shared";

/** 全书章节全局序（实现移至 @novel/shared，供 state / client 共用）；此处转出保持既有导入路径 */
export { buildChapterOrder, type ChapterOrderNode };

export interface PlantOutlineResult {
  created: number;
  skipped: number;
}

export interface PlantChapterResult {
  created: number;
  skipped: number;
  bound: number;
  recoverBound: number;
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
    // 回收幕解析：幕名漂移不阻塞伏笔入库——回收幕留空并警告（登场幕匹配是硬条件、回收幕只是规划信息）
    const recoverActName = item.recoverActName;
    let recoverActNodeId: string | undefined;
    if (recoverActName) {
      const recoverAct = options.actNodes.find((a) => a.name === recoverActName.trim());
      if (recoverAct) {
        recoverActNodeId = recoverAct.id;
      } else {
        options.channel.notify(
          `⚠️ 伏笔「${item.surfaceAction}」的回收幕「${recoverActName}」未在大纲中找到，回收幕留空（可在章节规划或编辑时补绑）`,
        );
      }
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
      recoverActNodeId,
    );
    options.channel.notify(
      `✨ 伏笔已入库：${item.surfaceAction}（埋设：${act.name}${recoverActNodeId && item.recoverActName ? `，回收幕：${item.recoverActName}` : ""}）`,
    );
    created += 1;
  }
  return { created, skipped };
}

/**
 * 章节规划阶段伏笔处理（章节入库后调用）：新伏笔带登场章与幕归属入库；
 * 登场绑定指令把回传清单中的未绑伏笔 patch 到登场章（已有回收章时新登场章须早于最早回收章）；
 * 回收绑定指令把「本幕待回收」清单中的伏笔 patch 到回收章（可多条 = 多步回收）——
 * 序号越界 / 章名未匹配 / 登场未绑 / 回收章不晚于登场章逐条跳过并警告。
 * allChapterNodes 供全书章节全局序（部→幕→章）的顺序校验（含本次规划的章）。
 */
export function plantChapterForeshadows(options: {
  novelId: string;
  actNodeId: string;
  newForeshadows: ChapterNewForeshadow[];
  bindings: ForeshadowBinding[];
  recoverBindings: ForeshadowBinding[];
  /** 本幕「待回收」回传清单（回收幕=本幕且回收章为空，与 recoverBindings 序号对应） */
  recoverable: readonly StoredForeshadow[];
  characters: readonly StoredCharacter[];
  chapterNodes: readonly { id: string; name: string }[];
  allChapterNodes: readonly ChapterOrderNode[];
  unbound: readonly StoredForeshadow[];
  channel: UiChannel;
  foreshadowStore?: ForeshadowStore;
}): PlantChapterResult {
  const store = options.foreshadowStore ?? getDefaultForeshadowStore();
  const characters = options.characters.map((c) => ({ id: c.id, name: c.character.basicInfo.name }));
  const chapterOrder = buildChapterOrder(options.allChapterNodes);
  // 清单序号固定指向确认时的 ID，不能重新查询未绑清单后按下标匹配。
  // 业务数据则取执行时的最新记录；恢复前用户的编辑/删除应优先保留。
  const initialTargets = new Map(
    [...options.unbound, ...options.recoverable].map((target) => [target.id, store.getForeshadow(target.id)]),
  );
  const currentTargets = new Map(initialTargets);
  const resolveTarget = (snapshot: StoredForeshadow, action: string): StoredForeshadow | undefined => {
    const initial = initialTargets.get(snapshot.id);
    if (!initial) {
      options.channel.notify(`⚠️ 伏笔${action}跳过（已被删除）：${snapshot.foreshadow.surfaceAction}`);
      return undefined;
    }
    // 同时比较数据和时间戳：同毫秒内的编辑不能漏检，值未变的显式编辑也不覆盖。
    if (initial.novelId !== options.novelId || JSON.stringify(initial) !== JSON.stringify(snapshot)) {
      options.channel.notify(`⚠️ 伏笔${action}跳过（已被编辑，保留最新设定）：${initial.foreshadow.surfaceAction}`);
      return undefined;
    }
    return currentTargets.get(snapshot.id);
  };
  let created = 0;
  let skipped = 0;
  let bound = 0;
  let recoverBound = 0;
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
    const snapshot = options.unbound[binding.index - 1];
    if (!snapshot) {
      options.channel.notify(`⚠️ 伏笔绑定跳过（序号 ${binding.index} 越界，清单共 ${options.unbound.length} 条）`);
      skipped += 1;
      continue;
    }
    const target = resolveTarget(snapshot, "绑定");
    if (!target) {
      skipped += 1;
      continue;
    }
    const chapter = options.chapterNodes.find((c) => c.name === binding.chapterName.trim());
    if (!chapter) {
      options.channel.notify(`⚠️ 伏笔绑定跳过（登场章「${binding.chapterName}」未在本次规划中找到）：${target.foreshadow.surfaceAction}`);
      skipped += 1;
      continue;
    }
    // 对称顺序校验：伏笔已绑回收章时，新登场章必须早于最早回收章（回收晚于登场的不变量）
    if (target.foreshadow.recoverChapterIds && target.foreshadow.recoverChapterIds.length > 0) {
      const appearOrder = chapterOrder.get(chapter.id);
      const minRecoverOrder = Math.min(
        ...target.foreshadow.recoverChapterIds.map((cid) => chapterOrder.get(cid) ?? Number.POSITIVE_INFINITY),
      );
      if (appearOrder !== undefined && appearOrder >= minRecoverOrder) {
        options.channel.notify(
          `⚠️ 伏笔绑定跳过（登场章须早于回收章）：${target.foreshadow.surfaceAction}（${chapter.name}）`,
        );
        skipped += 1;
        continue;
      }
    }
    currentTargets.set(target.id, store.updateForeshadow(target.id, { appearChapterId: chapter.id }));
    options.channel.notify(`🔗 伏笔已绑定登场章：${target.foreshadow.surfaceAction}（${chapter.name}）`);
    bound += 1;
  }

  // 回收绑定：同伏笔多条指令合并为一组回收章后一次 patch（多步回收）
  const recoverTargets = new Map<string, string[]>();
  for (const binding of options.recoverBindings) {
    const snapshot = options.recoverable[binding.index - 1];
    if (!snapshot) {
      options.channel.notify(`⚠️ 伏笔回收绑定跳过（序号 ${binding.index} 越界，清单共 ${options.recoverable.length} 条）`);
      skipped += 1;
      continue;
    }
    const target = resolveTarget(snapshot, "回收绑定");
    if (!target) {
      skipped += 1;
      continue;
    }
    const chapter = options.chapterNodes.find((c) => c.name === binding.chapterName.trim());
    if (!chapter) {
      options.channel.notify(`⚠️ 伏笔回收绑定跳过（回收章「${binding.chapterName}」未在本次规划中找到）：${target.foreshadow.surfaceAction}`);
      skipped += 1;
      continue;
    }
    if (!target.foreshadow.appearChapterId) {
      options.channel.notify(`⚠️ 伏笔回收绑定跳过（登场章未绑定，暂缓绑定回收）：${target.foreshadow.surfaceAction}`);
      skipped += 1;
      continue;
    }
    const appearOrder = chapterOrder.get(target.foreshadow.appearChapterId);
    const recoverOrder = chapterOrder.get(chapter.id);
    if (appearOrder === undefined || recoverOrder === undefined || recoverOrder <= appearOrder) {
      options.channel.notify(
        `⚠️ 伏笔回收绑定跳过（回收章须晚于登场章）：${target.foreshadow.surfaceAction}（${chapter.name}）`,
      );
      skipped += 1;
      continue;
    }
    const list = recoverTargets.get(target.id) ?? [];
    if (!list.includes(chapter.id)) list.push(chapter.id);
    recoverTargets.set(target.id, list);
  }
  for (const [foreshadowId, chapterIds] of recoverTargets) {
    const target = currentTargets.get(foreshadowId);
    if (!target) continue;
    const names = chapterIds
      .map((cid) => options.chapterNodes.find((c) => c.id === cid)?.name ?? cid)
      .join("、");
    currentTargets.set(foreshadowId, store.updateForeshadow(foreshadowId, { recoverChapterIds: chapterIds }));
    options.channel.notify(`♻ 伏笔已绑定回收章：${target.foreshadow.surfaceAction}（${names}）`);
    recoverBound += chapterIds.length;
  }
  return { created, skipped, bound, recoverBound };
}

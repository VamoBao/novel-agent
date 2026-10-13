import type { UiChannel } from "../ui/channel";
import type { ChapterPlan } from "@novel/shared";
import type { OutlineStore, StoredOutlineNode } from "../state/outline-store";
import type { StoredCharacter } from "../state/character-store";
import { resolveCharacterIds } from "./foreshadow-intake";

/** bindChapterCasts 结果：绑定统计与被剔除名单（notify 汇总用） */
export interface BindChapterCastsResult {
  /** 成功绑定登场角色的章数（解析后为空的章不计——保持 null 未绑定语义） */
  boundChapters: number;
  /** 各章实际绑定的角色人次（章内去重后累计，跨章同名各计一次） */
  totalBindings: number;
  /** 未匹配被剔除的角色名（已逐条 notify 过，供汇总警告） */
  skipped: string[];
}

/**
 * 章节登场角色绑定回填（确定性代码，无 LLM）：章节规划确认入库、新增角色自动建卡
 * **之后**调用——各章登场名单（plan.chapters 与 saveChapters 返回的章节点按序一一
 * 对齐）经 resolveCharacterIds 解析为角色 ID，单事务批量回填到章节点 character_ids。
 * 调用时点保证名单中的角色（库内既有 + 本轮自动建卡的新角色）均已入库、ID 必然
 * 存在；未匹配名逐章剔除并 notify 警告（防御层——正常链路下不会出现），解析后为
 * 空的章不传条目、保持 null 未绑定语义（schema 拒绝空数组）。
 */
export function bindChapterCasts(options: {
  novelId: string;
  /** 规划的章节列表（plan.chapters，与 chapterNodes 按序一一对应） */
  chapters: ReadonlyArray<ChapterPlan["chapters"][number]>;
  /** saveChapters 返回的章节点（与 chapters 按序一一对应） */
  chapterNodes: readonly StoredOutlineNode[];
  /** 回填前最新取用的角色库（须含本轮自动入库的新角色） */
  characters: readonly StoredCharacter[];
  channel: UiChannel;
  outlineStore: OutlineStore;
}): BindChapterCastsResult {
  const align = Math.min(options.chapters.length, options.chapterNodes.length);
  if (align < options.chapters.length) {
    options.channel.notify(
      `⚠️ 登场角色绑定：章节点数（${options.chapterNodes.length}）少于规划章数（${options.chapters.length}），多出的章跳过绑定`,
    );
  }
  const characters = options.characters.map((c) => ({ id: c.id, name: c.character.basicInfo.name }));
  const entries: Array<{ chapterId: string; characterIds: string[] }> = [];
  const skipped: string[] = [];
  let totalBindings = 0;
  for (let i = 0; i < align; i++) {
    const planChapter = options.chapters[i];
    const node = options.chapterNodes[i];
    if (!planChapter || !node) continue;
    const { ids, unresolved } = resolveCharacterIds(
      planChapter.characters.map((cast) => cast.name),
      characters,
    );
    for (const name of unresolved) {
      skipped.push(name);
      options.channel.notify(`⚠️ 章「${node.node.name}」登场角色「${name}」未在角色库中匹配，已从绑定剔除`);
    }
    if (ids.length === 0) continue;
    entries.push({ chapterId: node.id, characterIds: ids });
    totalBindings += ids.length;
  }
  if (entries.length > 0) {
    options.outlineStore.setChapterCharacters(options.novelId, entries);
  }
  return { boundChapters: entries.length, totalBindings, skipped };
}

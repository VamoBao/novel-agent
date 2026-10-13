import type { NovelDetail, OutlineNodeEntry } from "@novel/shared";

/** 正文生成后被编辑过的登场角色（章卡陈旧提示用） */
export interface StaleCastCharacter {
  name: string;
  /** 角色当前版本号（提示文案「现 vN」用） */
  version: number;
}

/**
 * 章节的登场角色里在正文生成之后被编辑过的那些。
 * 依据：角色 updatedAt（编辑提交刷新）晚于本章正文的 updatedAt（生成 / 覆盖时刻）——
 * 角色编辑对未写章节滚动生效，已生成正文则是冻结产物，故只在此给出「可能需要重新生成」的提示，
 * 不做任何自动重写。
 * 未生成正文（无 document）或未绑定登场角色（17 版前旧数据）返回空——无正文即无陈旧问题。
 * 时间戳为同格式 ISO 8601（UTC），字典序比较即时间先后。
 */
export function staleCastCharacters(
  node: OutlineNodeEntry,
  detail: NovelDetail,
): StaleCastCharacter[] {
  if (node.type !== "chapter" || node.characterIds === null) return [];
  const document = detail.documents.find((d) => d.chapterId === node.id);
  if (!document) return [];
  const byId = new Map(detail.characters.map((character) => [character.id, character]));
  const stale: StaleCastCharacter[] = [];
  for (const id of node.characterIds) {
    const character = byId.get(id);
    if (character && character.updatedAt > document.updatedAt) {
      stale.push({ name: character.basicInfo.name, version: character.version });
    }
  }
  return stale;
}

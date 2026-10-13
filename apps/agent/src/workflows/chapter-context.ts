import {
  CHARACTER_FIELD_SPECS,
  applyCharacterField,
  buildChapterOrder,
  type ChapterOrderNode,
  type Character,
  type CharacterFieldPath,
  type CharacterMigration,
} from "@novel/shared";
import type { CharacterStore, StoredCharacter } from "../state/character-store";
import type { CharacterMigrationStore } from "../state/migration-store";
import type { DocumentStore } from "../state/document-store";
import type { OutlineStore, StoredOutlineNode } from "../state/outline-store";
import { readDocumentArtifact } from "../output/document-writer";

/**
 * 章节上下文组装（纯函数、零 LLM）：为「生成本章正文」提供两件此前缺失的东西——
 *
 * ① **角色状态与迁移阶段**：角色卡是固定基准，人物变化由 character_migrations 计划表达。
 *    阶段是**相对于目标章节的计算结果**，不是随生成顺序更新的全局状态：
 *    - 早于起始章 → 未开始，沿用此前状态（不把后续诱因与目标变化当作已经发生）
 *    - 起始章 ≤ 本章 < 结束章（或结束章为空）→ 进行中，旧值 + 目标新值 + 诱因 + 过渡描述
 *    - 本章 = 结束章 → 本章计划完成变化（单章迁移也在本章呈现诱因与转变）
 *    - 本章 > 结束章 → 计划已结束，沿用新值（该标签不宣称正文已通过独立兑现验证）
 *    基准卡与**已结束**迁移组成该章角色参考；进行中 / 结束章的变化作为**独立计划块**传入，
 *    不让目标新值提前覆盖全部既有特征。诱因与过渡描述是**创作计划**，不得当作已发生的事实。
 *    作者规划类字段（创作目的 / 结局方向）明确标为创作指导，不能当作角色已知的信息。
 *    倒序生成或重生成旧章时按同一公式解析，天然不使用未来迁移的状态。
 *
 * ② **前后章衔接**：按**全书章序**（部 → 幕 → 章）解析，覆盖跨幕衔接；上一章正文可用时
 *    纳入受预算约束的结尾上下文（超预算 / 文件缺失回退概述），下一章只取概述。
 */

/** 上一章正文纳入 prompt 的字符预算（小上下文写作模型护栏）：超出整条降级为概述，不截断 */
export const PREVIOUS_CHAPTER_PROSE_BUDGET = 8000;

/** 迁移相对本章的阶段 */
export type MigrationPhase = "not-started" | "in-progress" | "ending" | "completed";

/**
 * 判定迁移相对目标章阶段的纯函数（不依赖存储）。
 * startOrder / endOrder 为全书章序（1 起）；endOrder 为 null 表示开放区间（未结束）。
 */
export function migrationPhaseAt(
  startOrder: number,
  endOrder: number | null,
  chapterOrder: number,
): MigrationPhase {
  if (chapterOrder < startOrder) return "not-started";
  if (endOrder === null) return "in-progress";
  if (chapterOrder < endOrder) return "in-progress";
  if (chapterOrder === endOrder) return "ending";
  return "completed";
}

/**
 * 按**全书大纲树**（根节点版本）给节点分组。
 * 不使用章节点自身 version——章节规划后建的章节点版本号不随所属树推进，树版本以根（部）为准；
 * 父级链断裂（中间层缺失）的节点不入任何组。
 */
function groupByTreeVersion(stored: readonly StoredOutlineNode[]): Map<number, ChapterOrderNode[]> {
  const byId = new Map(stored.map((node) => [node.id, node]));
  const rootVersion = (startId: string): number | undefined => {
    let current = byId.get(startId);
    const seen = new Set<string>();
    while (current && current.node.parentId !== null && !seen.has(current.id)) {
      seen.add(current.id);
      current = byId.get(current.node.parentId);
    }
    return current && current.node.parentId === null ? current.node.version : undefined;
  };
  const groups = new Map<number, ChapterOrderNode[]>();
  for (const node of stored) {
    const version = rootVersion(node.id);
    if (version === undefined) continue;
    const list = groups.get(version) ?? [];
    list.push({
      id: node.id,
      parentId: node.node.parentId,
      type: node.node.type,
      sort: node.node.sort,
    });
    groups.set(version, list);
  }
  return groups;
}

/** 全书大纲版本（章所在树的根节点 version）与本章在其内的章序 */
interface TreePosition {
  version: number;
  order: number;
}

/** 解析目标章所属全书大纲版本与章序；不可解析（父级链断裂 / 非章节点）返回 undefined */
function treePosition(
  outlineStore: OutlineStore,
  novelId: string,
  chapterNodeId: string,
): TreePosition | undefined {
  const groups = groupByTreeVersion(outlineStore.listOutlineNodes(novelId));
  for (const [version, nodes] of groups) {
    const order = buildChapterOrder(nodes).get(chapterNodeId);
    if (order !== undefined) return { version, order };
  }
  return undefined;
}

/** 角色卡摘要行（注入基准 / 已结束状态用；控制 prompt 体积） */
function characterDigestLine(character: Character): string {
  const parts = [
    `定位：${character.core.narrativeRole}`,
    character.basicInfo.appearance ? `外貌：${character.basicInfo.appearance}` : null,
    character.personality ? `性格：${character.personality}` : null,
    `渴望：${character.core.desire}`,
    `恐惧：${character.core.fear}`,
  ].filter((part): part is string => part !== null);
  return `${character.basicInfo.name}（${parts.join("；")}）`;
}

/** 创作指导字段：迁移作用于这些字段时须标明「作者规划，不是角色已知信息」 */
const AUTHORING_FIELDS: ReadonlySet<CharacterFieldPath> = new Set([
  "creationPurpose",
  "endingDirection",
]);

export interface CharacterStateContextOptions {
  novelId: string;
  chapterNodeId: string;
  characterStore: CharacterStore;
  migrationStore: CharacterMigrationStore;
  outlineStore: OutlineStore;
  /** 本章绑定的登场角色 ID（章节点 character_ids）；null = 未绑定旧章，回退全库角色 */
  castIds: readonly string[] | null;
}

export interface CharacterStateContext {
  /** 【登场角色状态】与【本章角色变化计划】两块的 prompt 行；无角色时为空数组 */
  lines: string[];
  /** 实际注入的角色数 */
  characterCount: number;
  /** 进行中 / 本章完成的迁移计划条数 */
  planCount: number;
  /** 已结束迁移（基准之上已生效的新值）条数 */
  completedCount: number;
  /** 未绑定登场角色而回退全库注入 */
  fallbackToLibrary: boolean;
}

/**
 * 组装【登场角色状态】与【本章角色变化计划】两块 prompt 行。
 * 登场角色按章节点 character_ids 收窄；未绑定（null）时回退全库注入并置 fallbackToLibrary。
 */
export function buildCharacterStateContext(
  options: CharacterStateContextOptions,
): CharacterStateContext {
  const { novelId, chapterNodeId, characterStore, migrationStore, outlineStore } = options;
  const library = characterStore.listCharacters(novelId);
  const castIdsInput = options.castIds;
  const bound =
    castIdsInput === null ? [] : library.filter((stored) => castIdsInput.includes(stored.id));
  const cast = bound.length > 0 ? bound : library;
  const fallbackToLibrary = bound.length === 0 && library.length > 0;
  if (cast.length === 0) {
    return { lines: [], characterCount: 0, planCount: 0, completedCount: 0, fallbackToLibrary: false };
  }

  const position = treePosition(outlineStore, novelId, chapterNodeId);
  const orderByChapter = new Map<string, number>();
  if (position) {
    const groups = groupByTreeVersion(outlineStore.listOutlineNodes(novelId));
    const nodes = groups.get(position.version) ?? [];
    for (const [id, order] of buildChapterOrder(nodes)) orderByChapter.set(id, order);
  }

  const castIdSet = new Set(cast.map((stored) => stored.id));
  // 只取**同全书大纲版本**的已确认迁移（换版后旧迁移保留在旧版本、不混入新版）
  const migrations = migrationStore
    .listMigrations(novelId)
    .map((stored) => stored.migration)
    .filter(
      (migration) =>
        migration.status === "confirmed" &&
        castIdSet.has(migration.characterId) &&
        migration.startChapterId !== null &&
        orderByChapter.has(migration.startChapterId) &&
        (position === undefined || migration.outlineVersion === position.version),
    );

  const lines: string[] = ["【登场角色状态（角色基准卡 + 已结束迁移后的状态）】"];
  const planLines: string[] = [];
  let planCount = 0;
  let completedCount = 0;

  for (const stored of cast) {
    let effective = stored.character;
    const notes: string[] = [];
    const plans: string[] = [];

    if (position) {
      for (const field of Object.keys(CHARACTER_FIELD_SPECS) as CharacterFieldPath[]) {
        const chain = migrations
          .filter((m) => m.characterId === stored.id && m.migrateField === field)
          .sort(
            (a, b) =>
              (orderByChapter.get(a.startChapterId ?? "") ?? 0) -
              (orderByChapter.get(b.startChapterId ?? "") ?? 0),
          );
        if (chain.length === 0) continue;

        const entries = chain
          .map((migration) => ({
            migration,
            start: orderByChapter.get(migration.startChapterId ?? "") ?? 0,
            end:
              migration.endChapterId === null
                ? null
                : (orderByChapter.get(migration.endChapterId) ?? null),
          }))
          .sort((a, b) => a.start - b.start);

        // 覆盖 / 起始于本章（进行中或本章完成）→ 参考沿用旧值，变化进计划块
        const current = entries.find(
          (entry) => entry.start <= position.order && (entry.end === null || entry.end >= position.order),
        );
        if (current) {
          effective = applyCharacterField(effective, field, current.migration.oldValue);
          plans.push(
            describePlan(
              stored.character.basicInfo.name,
              current.migration,
              migrationPhaseAt(current.start, current.end, position.order),
              current.start,
              current.end,
              field,
            ),
          );
          planCount += 1;
          continue;
        }

        // 完全结束于本章之前 → 参考沿用链上最后一条的新值（该标签不宣称已通过独立兑现验证）
        const completed = entries.filter((entry) => entry.end !== null && entry.end < position.order);
        const last = completed[completed.length - 1];
        if (last) {
          effective = applyCharacterField(effective, field, last.migration.newValue);
          const label = CHARACTER_FIELD_SPECS[field].label;
          notes.push(
            `${label}${last.migration.newValue === null ? "已清空" : `「${last.migration.newValue}」`}为已结束迁移（第 ${last.start} 章起至第 ${last.end} 章）后的状态`,
          );
          completedCount += 1;
        }
      }
    }

    lines.push(characterDigestLine(effective));
    for (const note of notes) lines.push(`  说明：${note}`);
    for (const plan of plans) planLines.push(plan);
  }

  if (planLines.length > 0) {
    lines.push(
      "",
      "【本章角色变化计划（创作计划，不是已经发生的事实）】",
      "进行中的变化须呈现渐变过程（不用百分比机械插值，也不得提前呈现目标状态的全部特征）；标「本章完成」的在本章内完成该变化并呈现诱因与转变。",
      "诱因与过渡描述是作者的写作依据，不得让角色凭空声称此前发生过未提供的事件，本章呈现须与现有概述相容。",
      ...planLines,
    );
  }

  return { lines, characterCount: cast.length, planCount, completedCount, fallbackToLibrary };
}

/** 单条迁移计划块（含阶段、区间、诱因与过渡描述；创作指导字段附声明） */
function describePlan(
  characterName: string,
  migration: CharacterMigration,
  phase: MigrationPhase,
  startOrder: number,
  endOrder: number | null,
  field: CharacterFieldPath,
): string {
  const spec = CHARACTER_FIELD_SPECS[field];
  const range =
    endOrder === null
      ? `第 ${startOrder} 章起（结束章未定）`
      : phase === "ending"
        ? `第 ${startOrder} 章起至第 ${endOrder} 章（本章完成）`
        : `第 ${startOrder} 章起至第 ${endOrder} 章`;
  const phaseLabel = phase === "ending" ? "本章完成变化" : "进行中";
  const head = `- ${characterName} · ${spec.label}（${phaseLabel}，${range}）：旧值「${migration.oldValue ?? "（未设定）"}」→ 目标「${migration.newValue ?? "（未设定）"}」`;
  const body = [
    migration.trigger ? `  诱因：${migration.trigger}` : null,
    migration.transitionGuidance ? `  过渡描述：${migration.transitionGuidance}` : null,
    AUTHORING_FIELDS.has(field)
      ? "  注意：该字段是作者的创作指导，不是角色本人已知的信息，不得让角色直接说出或意识到。"
      : null,
  ].filter((line): line is string => line !== null);
  return [head, ...body].join("\n");
}

export interface NeighborChapter {
  id: string;
  name: string;
  summary: string | null;
}

export interface NeighborChapterContext {
  /** 全书章序紧邻的上一章（可跨幕）；无前章为 null */
  previous: NeighborChapter | null;
  /** 上一章正文（预算内）；未生成 / 文件缺失 / 超预算为 null（回退概述） */
  previousProse: string | null;
  /** 全书章序紧邻的下一章（可跨幕，只取概述）；无后章为 null */
  next: NeighborChapter | null;
}

export interface NeighborChapterContextOptions {
  novelId: string;
  chapterNodeId: string;
  outlineStore: OutlineStore;
  documentStore: DocumentStore;
  outputDir: string;
}

/**
 * 按全书章序解析前后章（覆盖跨幕衔接）：上一章正文可用且不超预算时纳入，
 * 否则回退其概述；下一章只取概述（不注入正文，避免抢写其情节）。
 */
export function buildNeighborChapterContext(
  options: NeighborChapterContextOptions,
): NeighborChapterContext {
  const { novelId, chapterNodeId, outlineStore, documentStore, outputDir } = options;
  const position = treePosition(outlineStore, novelId, chapterNodeId);
  if (!position) return { previous: null, previousProse: null, next: null };

  const currentNodes = outlineStore.listOutlineNodes(novelId, { currentOnly: true });
  // 全局章序须按完整树（部 → 幕 → 章）下探：只喂章节点会让父级幕缺失、章不可达
  const order = buildChapterOrder(
    currentNodes.map((node) => ({
      id: node.id,
      parentId: node.node.parentId,
      type: node.node.type,
      sort: node.node.sort,
    })),
  );
  const ordered = currentNodes
    .filter((node) => node.node.type === "chapter")
    .map((node) => ({ node, order: order.get(node.id) }))
    .filter(
      (entry): entry is { node: StoredOutlineNode; order: number } => entry.order !== undefined,
    )
    .sort((a, b) => a.order - b.order);

  const previousNode = ordered.find((entry) => entry.order === position.order - 1)?.node;
  const nextNode = ordered.find((entry) => entry.order === position.order + 1)?.node;

  let previousProse: string | null = null;
  if (previousNode) {
    const document = documentStore.getDocumentByChapter(previousNode.id);
    const prose = document ? readDocumentArtifact(document.filePath, outputDir) : null;
    if (prose !== null && prose.length <= PREVIOUS_CHAPTER_PROSE_BUDGET) {
      previousProse = prose;
    }
  }

  return {
    previous: previousNode
      ? { id: previousNode.id, name: previousNode.node.name, summary: previousNode.node.summary }
      : null,
    previousProse,
    next: nextNode
      ? { id: nextNode.id, name: nextNode.node.name, summary: nextNode.node.summary }
      : null,
  };
}

/** 供调用方复用：角色卡字段读取（类型再导出，避免调用方直接依赖 shared 内部） */
export type { StoredCharacter };

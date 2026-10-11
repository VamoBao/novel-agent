import { readDocumentArtifact } from "../output/document-writer";
import type { CharacterStore } from "../state/character-store";
import type { DocumentStore } from "../state/document-store";
import type { ForeshadowStore } from "../state/foreshadow-store";
import type { OutlineStore } from "../state/outline-store";
import { buildChapterOrder } from "./foreshadow-intake";

/** 回收伏笔登场章正文的字符预算（小上下文写作模型护栏）：超出整条降级概述，不截断 */
export const FORESHADOW_PROSE_BUDGET = 8000;

export interface ChapterForeshadowContextOptions {
  novelId: string;
  chapterNodeId: string;
  foreshadowStore: ForeshadowStore;
  outlineStore: OutlineStore;
  documentStore: DocumentStore;
  characterStore: CharacterStore;
  /** 正文产物根目录（读登场章正文文件，与落盘同源） */
  outputDir: string;
}

export interface ChapterForeshadowContext {
  /** 【本章伏笔】块全部行（含标题与分组标题行）；空数组 = 无绑定伏笔，调用方零注入 */
  lines: string[];
  appearCount: number;
  recoverCount: number;
  /** 登场章正文未生成 / 文件不可读 / 超预算降级为概述的回收条数（notify 通报用） */
  degradedCount: number;
}

/** 服务角色 ID → 名字（未匹配兜底原 ID，对齐客户端解析惯例） */
function resolveCharacterName(id: string, names: ReadonlyMap<string, string>): string {
  return names.get(id) ?? id;
}

/**
 * 组装「本章伏笔」prompt 块（纯函数、零 LLM）：绑定到本章的伏笔分登场/回收两组——
 * 登场注入卡片（表面行为自然带出、不点破真相）；回收注入卡片 + 登场章上下文
 * （正文优先——读者实际读到的具体呈现，未生成/文件缺失/超预算降级概述）+
 * 多步回收的既往回收章概述（防重复揭底）。同章种收归回收组标「登场于本章」。
 * 无绑定伏笔返回空 lines，调用方零注入零通知（对齐参考文风先例）。
 */
export function buildChapterForeshadowContext(
  options: ChapterForeshadowContextOptions,
): ChapterForeshadowContext {
  const {
    novelId,
    chapterNodeId,
    foreshadowStore,
    outlineStore,
    documentStore,
    characterStore,
    outputDir,
  } = options;

  const stored = foreshadowStore.listForeshadows(novelId);
  // 同章种收（登场=回收=本章）只归回收组（标「登场于本章」），不重复进登场组
  const appearGroup = stored.filter(
    (s) =>
      s.foreshadow.appearChapterId === chapterNodeId &&
      !s.foreshadow.recoverChapterIds?.includes(chapterNodeId),
  );
  const recoverGroup = stored.filter((s) => s.foreshadow.recoverChapterIds?.includes(chapterNodeId));
  if (appearGroup.length === 0 && recoverGroup.length === 0) {
    return { lines: [], appearCount: 0, recoverCount: 0, degradedCount: 0 };
  }

  const order = buildChapterOrder(
    outlineStore
      .listOutlineNodes(novelId, { currentOnly: true })
      .map((n) => ({ id: n.id, parentId: n.node.parentId, type: n.node.type, sort: n.node.sort })),
  );
  const characterNames = new Map(
    characterStore.listCharacters(novelId).map((c) => [c.id, c.character.basicInfo.name]),
  );
  const currentOrder = order.get(chapterNodeId) ?? Number.MAX_SAFE_INTEGER;

  // 回收组按登场章全局章序升序（更早埋设的优先保正文预算；Array.sort 稳定，同序保持入库顺序）；
  // 登场章不在当前版本树（归档/不可解析）无章序，排最后
  const recoverSorted = [...recoverGroup].sort(
    (a, b) =>
      (order.get(a.foreshadow.appearChapterId ?? "") ?? Number.MAX_SAFE_INTEGER) -
      (order.get(b.foreshadow.appearChapterId ?? "") ?? Number.MAX_SAFE_INTEGER),
  );

  const lines: string[] = ["【本章伏笔】"];
  let degradedCount = 0;

  if (appearGroup.length > 0) {
    lines.push(
      "一、本章登场（按「表面行为」自然融入剧情，严禁点破隐藏真相；注意度 1=读者容易察觉 → 10=极难察觉）：",
    );
    appearGroup.forEach((s, index) => {
      const card = s.foreshadow;
      const service = card.characterIds?.length
        ? `服务角色：${card.characterIds.map((id) => resolveCharacterName(id, characterNames)).join("、")}`
        : null;
      lines.push(
        `${index + 1}. 表面行为：${card.surfaceAction}`,
        `   隐藏真相（仅供把握分寸，本章不得点破）：${card.hiddenTruth}`,
        `   注意度：${card.attentionLevel}/10`,
        ...(card.plantingMethod ? [`   埋线方式：${card.plantingMethod}`] : []),
        ...(card.purpose ? [`   创作目的：${card.purpose}`] : []),
        ...(service ? [`   ${service}`] : []),
      );
    });
  }

  if (recoverSorted.length > 0) {
    lines.push("二、本章回收（揭晓「隐藏真相」，须与登场时的具体呈现呼应，不复述原文）：");
    let proseBudgetUsed = 0;
    recoverSorted.forEach((s, index) => {
      const card = s.foreshadow;
      const service = card.characterIds?.length
        ? `，服务：${card.characterIds.map((id) => resolveCharacterName(id, characterNames)).join("、")}`
        : "";
      const headline = `表面行为：${card.surfaceAction} / 隐藏真相：${card.hiddenTruth}（注意度 ${card.attentionLevel}/10${service}）`;

      // 同章种收：登场即回收，不注入任何章内容
      if (card.appearChapterId === chapterNodeId) {
        lines.push(`${index + 1}. 登场于本章：${headline}`);
        return;
      }
      // 登场章按 ID 直查、不过滤版本（归档旧版章照常解析名与正文）；不可解析只注入卡片
      const appearNode = card.appearChapterId
        ? outlineStore.getOutlineNode(card.appearChapterId)
        : undefined;
      if (!appearNode || appearNode.novelId !== novelId) {
        lines.push(`${index + 1}. （登场章信息不可用）${headline}`);
        return;
      }
      lines.push(`${index + 1}. 登场于《${appearNode.node.name}》：${headline}`);

      // 多步回收：全局章序在当前章之前的既往回收章概述（去重；节点缺失跳过）
      for (const stepId of new Set(card.recoverChapterIds ?? [])) {
        if (stepId === chapterNodeId) continue;
        const stepOrder = order.get(stepId);
        if (stepOrder === undefined || stepOrder >= currentOrder) continue;
        const stepNode = outlineStore.getOutlineNode(stepId);
        if (!stepNode || stepNode.novelId !== novelId) continue;
        lines.push(`   既往回收：《${stepNode.node.name}》——${stepNode.node.summary ?? "（该章无概述）"}`);
      }

      // 登场章上下文：正文优先（预算内整条注入、不截断），未生成/文件缺失/超预算降级概述
      const doc = documentStore.getDocumentByChapter(appearNode.id);
      const prose = doc ? readDocumentArtifact(doc.filePath, outputDir) : null;
      if (prose !== null && proseBudgetUsed + prose.length <= FORESHADOW_PROSE_BUDGET) {
        proseBudgetUsed += prose.length;
        lines.push("   登场章正文（呼应其细节，不要照抄）：", prose);
      } else {
        degradedCount += 1;
        lines.push(
          `   登场章正文未生成——该章剧情概述：${appearNode.node.summary ?? "（该章无概述）"}`,
        );
      }
    });
  }

  return {
    lines,
    appearCount: appearGroup.length,
    recoverCount: recoverGroup.length,
    degradedCount,
  };
}

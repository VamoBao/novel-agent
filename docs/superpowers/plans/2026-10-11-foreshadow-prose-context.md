# 章节正文生成伏笔上下文注入 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** write-chapter 生成正文时把绑定到本章的伏笔注入写作上下文——登场伏笔注入卡片、回收伏笔注入卡片 + 登场章上下文（正文优先、概述兜底、8000 字符预算护栏），使伏笔设定对未写章节滚动生效、回收章能呼应登场章的实际呈现。

**架构：** 新建纯函数模块 `workflows/foreshadow-context.ts`（分组 → 登场章上下文解析兜底链 → prompt 行组装，零 LLM、零 schema 迁移），write-chapter 在既有上下文组装点调用它并把产出的【本章伏笔】块插入【下一章】块与【参考文风】段之间；notify 与写作要求按既有文风注入模式条件附加。

**技术栈：** Bun + TypeScript（strict）、bun:sqlite（store 直开临时库）、bun:test（模块单测 + mock `ai` 的 writeChapter 集成测试）、设计规格 `docs/superpowers/specs/2026-10-11-foreshadow-prose-context-design.md`。

**执行约定（项目级，优先于技能模板）：** 复杂需求任务清单落盘 `PROGRESS.md`「进行中」后 WIP=1 逐任务执行；**拆分任务不单独提交**，全部完成、全量校验通过、文档同步后统一一次原子提交（`docs/git-commit-guide.md`）。

---

## 文件结构

- 创建：`apps/agent/src/workflows/foreshadow-context.ts`——伏笔上下文构建纯函数模块（分组、章序排序、登场章正文/概述兜底链、预算扣减、prompt 行组装），依赖 state stores + output/document-writer + ./foreshadow-intake（buildChapterOrder），零 LLM；
- 创建：`apps/agent/src/workflows/foreshadow-context.test.ts`——模块单测（临时库 + 临时 output 目录，11 组用例）；
- 修改：`apps/agent/src/workflows/write-chapter.ts`——Options 增 foreshadowStore 注入、组装点调用模块、prompt 插块、写作要求条件附加与编号顺延、生成前 notify；
- 修改：`apps/agent/src/workflows/write-chapter.test.ts`——setupDb 增 foreshadowStore 与第三章、新增 3 个集成用例（现状回归 / 注入与编号 / 兜底与通知）。

---

### 任务 1：伏笔上下文构建模块（foreshadow-context.ts）

**文件：**
- 创建：`apps/agent/src/workflows/foreshadow-context.ts`
- 测试：`apps/agent/src/workflows/foreshadow-context.test.ts`

- [ ] **步骤 1：编写失败的测试**

创建 `apps/agent/src/workflows/foreshadow-context.test.ts`：

```ts
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../state/db";
import { NovelStore } from "../state/novel-store";
import { OutlineStore } from "../state/outline-store";
import { CharacterStore } from "../state/character-store";
import { DocumentStore } from "../state/document-store";
import { ForeshadowStore } from "../state/foreshadow-store";
import { writeDocumentArtifact } from "../output/document-writer";
import type { Character, Foreshadow } from "@novel/shared";
import { FORESHADOW_PROSE_BUDGET, buildChapterForeshadowContext } from "./foreshadow-context";

/**
 * foreshadow-context 模块单测：临时库建小说/角色/一部一幕四章/伏笔/正文行，
 * 直接调 buildChapterForeshadowContext 断言 prompt 行与计数——零 LLM、零 channel。
 */

const NOVEL_ID = "eeeeeeee-4444-7444-8555-666677778888";

const characterFixture = {
  basicInfo: { name: "林恒" },
  core: { desire: "夺回灵脉", fear: "辜负同伴", narrativeRole: "主角" },
  background: "青云市集的散修少年",
  creationPurpose: "承载打破宗门垄断的主线",
  endingDirection: "打破垄断后归隐",
} satisfies Character;

const PROSE_C1 = "　　少年把碎片藏进袖中，指腹擦过那道细如发丝的刻痕。\n\n　　宗门的告示贴在市集口，墨迹未干。";

function foreshadowFixture(overrides: Partial<Foreshadow> = {}): Foreshadow {
  return {
    surfaceAction: "少年拾得的碎片刻有宗门印记",
    hiddenTruth: "碎片是宗门失窃的镇脉之物",
    attentionLevel: 7,
    ...overrides,
  };
}

interface TestCtx {
  outlineStore: OutlineStore;
  characterStore: CharacterStore;
  documentStore: DocumentStore;
  foreshadowStore: ForeshadowStore;
  outputDir: string;
  linId: string;
  chenId: string;
  c1: string;
  c2: string;
  c3: string;
  c4: string;
  build: (chapterNodeId: string) => ReturnType<typeof buildChapterForeshadowContext>;
  cleanup: () => Promise<void>;
}

async function setupDb(): Promise<TestCtx> {
  const dir = await mkdtemp(join(tmpdir(), "novel-fctx-"));
  const db = openDatabase(join(dir, "test.db"));
  const outputDir = join(dir, "output");
  const novelStore = new NovelStore(db);
  const outlineStore = new OutlineStore(db);
  const characterStore = new CharacterStore(db);
  const documentStore = new DocumentStore(db);
  const foreshadowStore = new ForeshadowStore(db);
  novelStore.createNovel({ id: NOVEL_ID, name: "灵脉拾遗" });
  const lin = characterStore.addCharacter(NOVEL_ID, characterFixture);
  const chen = characterStore.addCharacter(NOVEL_ID, {
    ...characterFixture,
    basicInfo: { name: "陈默" },
  });
  const [, act] = outlineStore.saveOutlineTree(NOVEL_ID, [
    {
      name: "第一部",
      summary: "灵脉断绝，少年拾遗",
      acts: [{ name: "第一幕", summary: "市集风波", keyPlotPoints: ["拾得灵脉碎片"] }],
    },
  ]);
  const chapters = outlineStore.saveChapters(NOVEL_ID, act!.id, [
    { name: "第一章", summary: "少年在市集拾得碎片" },
    { name: "第二章", summary: "宗门来人追查" },
    { name: "第三章", summary: "碎片来历初现" },
    { name: "第四章", summary: "印记之谜揭晓" },
  ]);
  return {
    outlineStore,
    characterStore,
    documentStore,
    foreshadowStore,
    outputDir,
    linId: lin.id,
    chenId: chen.id,
    c1: chapters[0]!.id,
    c2: chapters[1]!.id,
    c3: chapters[2]!.id,
    c4: chapters[3]!.id,
    build: (chapterNodeId: string) =>
      buildChapterForeshadowContext({
        novelId: NOVEL_ID,
        chapterNodeId,
        foreshadowStore,
        outlineStore,
        documentStore,
        characterStore,
        outputDir,
      }),
    cleanup: async () => {
      db.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

describe("buildChapterForeshadowContext", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterAll(async () => {
    await Promise.all(cleanups.map((fn) => fn()));
  });

  test("无绑定伏笔：lines 为空、计数全 0（零注入信号）", async () => {
    const ctx = await setupDb();
    cleanups.push(ctx.cleanup);
    const result = ctx.build(ctx.c2);
    expect(result.lines).toEqual([]);
    expect(result.appearCount).toBe(0);
    expect(result.recoverCount).toBe(0);
    expect(result.degradedCount).toBe(0);
  });

  test("登场伏笔：卡片全字段注入（可选字段与服务角色名解析、未匹配兜底原 ID）", async () => {
    const ctx = await setupDb();
    cleanups.push(ctx.cleanup);
    ctx.foreshadowStore.addForeshadow(NOVEL_ID, {
      ...foreshadowFixture({
        plantingMethod: "借市集喧闹一笔带过",
        purpose: "为第四幕宗门追查埋线",
        appearChapterId: ctx.c2,
        characterIds: [ctx.linId, ctx.chenId, "bogus-character-id"],
      }),
    });
    const result = ctx.build(ctx.c2);
    const text = result.lines.join("\n");
    expect(result.lines[0]).toBe("【本章伏笔】");
    expect(text).toContain("一、本章登场");
    expect(text).toContain("表面行为：少年拾得的碎片刻有宗门印记");
    expect(text).toContain("隐藏真相（仅供把握分寸，本章不得点破）：碎片是宗门失窃的镇脉之物");
    expect(text).toContain("注意度：7/10");
    expect(text).toContain("埋线方式：借市集喧闹一笔带过");
    expect(text).toContain("创作目的：为第四幕宗门追查埋线");
    expect(text).toContain(`服务角色：林恒、陈默、bogus-character-id`);
    expect(text).not.toContain("二、本章回收");
    expect(result.appearCount).toBe(1);
    expect(result.recoverCount).toBe(0);
    expect(result.degradedCount).toBe(0);
  });

  test("登场伏笔可选字段缺省：对应行不渲染", async () => {
    const ctx = await setupDb();
    cleanups.push(ctx.cleanup);
    ctx.foreshadowStore.addForeshadow(NOVEL_ID, foreshadowFixture({ appearChapterId: ctx.c1 }));
    const text = ctx.build(ctx.c1).lines.join("\n");
    expect(text).not.toContain("埋线方式：");
    expect(text).not.toContain("创作目的：");
    expect(text).not.toContain("服务角色：");
  });

  test("回收伏笔登场章有正文：正文优先全文注入", async () => {
    const ctx = await setupDb();
    cleanups.push(ctx.cleanup);
    const rel = join("灵脉拾遗-eeeeeeee", "第一部", "第一章.md");
    writeDocumentArtifact(rel, PROSE_C1, ctx.outputDir);
    ctx.documentStore.saveChapterDocument(NOVEL_ID, ctx.c1, rel, 52);
    ctx.foreshadowStore.addForeshadow(
      NOVEL_ID,
      foreshadowFixture({ appearChapterId: ctx.c1, recoverChapterIds: [ctx.c2] }),
    );
    const result = ctx.build(ctx.c2);
    const text = result.lines.join("\n");
    expect(text).toContain("二、本章回收");
    expect(text).toContain("登场于《第一章》");
    expect(text).toContain("登场章正文（呼应其细节，不要照抄）：");
    expect(text).toContain(PROSE_C1);
    expect(text).not.toContain("剧情概述");
    expect(result.recoverCount).toBe(1);
    expect(result.degradedCount).toBe(0);
  });

  test("回收伏笔登场章未写：概述兜底并计数降级", async () => {
    const ctx = await setupDb();
    cleanups.push(ctx.cleanup);
    ctx.foreshadowStore.addForeshadow(
      NOVEL_ID,
      foreshadowFixture({ appearChapterId: ctx.c1, recoverChapterIds: [ctx.c2] }),
    );
    const result = ctx.build(ctx.c2);
    const text = result.lines.join("\n");
    expect(text).toContain("登场章正文未生成——该章剧情概述：少年在市集拾得碎片");
    expect(text).not.toContain("登场章正文（呼应其细节，不要照抄）：");
    expect(result.degradedCount).toBe(1);
  });

  test("回收伏笔登场章文件缺失（有元数据行无文件）：概述兜底并计数降级", async () => {
    const ctx = await setupDb();
    cleanups.push(ctx.cleanup);
    ctx.documentStore.saveChapterDocument(
      NOVEL_ID,
      ctx.c1,
      join("灵脉拾遗-eeeeeeee", "第一部", "第一章.md"),
      52,
    );
    ctx.foreshadowStore.addForeshadow(
      NOVEL_ID,
      foreshadowFixture({ appearChapterId: ctx.c1, recoverChapterIds: [ctx.c2] }),
    );
    const result = ctx.build(ctx.c2);
    expect(result.lines.join("\n")).toContain("登场章正文未生成——该章剧情概述：少年在市集拾得碎片");
    expect(result.degradedCount).toBe(1);
  });

  test("多步回收：只注入全局章序在当前章之前的既往回收章概述", async () => {
    const ctx = await setupDb();
    cleanups.push(ctx.cleanup);
    const f = ctx.foreshadowStore.addForeshadow(
      NOVEL_ID,
      foreshadowFixture({ appearChapterId: ctx.c1, recoverChapterIds: [ctx.c2, ctx.c3, ctx.c4] }),
    );
    // 当前章 = 第四章：既往回收 = 第二章、第三章（各一行，按 recoverChapterIds 去重后的章序）
    const late = ctx.build(ctx.c4).lines.join("\n");
    expect(late).toContain("既往回收：《第二章》——宗门来人追查");
    expect(late).toContain("既往回收：《第三章》——碎片来历初现");
    expect(late).not.toContain("既往回收：《第四章》");
    // 当前章 = 第三章：既往回收只剩第二章；第四章在其后，不得出现
    const mid = ctx.build(ctx.c3).lines.join("\n");
    expect(mid).toContain("既往回收：《第二章》——宗门来人追查");
    expect(mid).not.toContain("既往回收：《第三章》");
    expect(mid).not.toContain("既往回收：《第四章》");
    expect(f.id).toBeDefined();
  });

  test("预算护栏：按登场章序升序逐条扣减，超出整条降级概述、不截断已注入正文", async () => {
    const ctx = await setupDb();
    cleanups.push(ctx.cleanup);
    const rel1 = join("灵脉拾遗-eeeeeeee", "第一部", "第一章.md");
    const rel2 = join("灵脉拾遗-eeeeeeee", "第一部", "第二章.md");
    writeDocumentArtifact(rel1, "甲".repeat(FORESHADOW_PROSE_BUDGET - 500), ctx.outputDir);
    writeDocumentArtifact(rel2, "乙".repeat(600), ctx.outputDir);
    ctx.documentStore.saveChapterDocument(NOVEL_ID, ctx.c1, rel1, FORESHADOW_PROSE_BUDGET - 500);
    ctx.documentStore.saveChapterDocument(NOVEL_ID, ctx.c2, rel2, 600);
    ctx.foreshadowStore.addForeshadow(
      NOVEL_ID,
      foreshadowFixture({ surfaceAction: "先登场伏笔", appearChapterId: ctx.c1, recoverChapterIds: [ctx.c4] }),
    );
    ctx.foreshadowStore.addForeshadow(
      NOVEL_ID,
      foreshadowFixture({ surfaceAction: "后登场伏笔", appearChapterId: ctx.c2, recoverChapterIds: [ctx.c4] }),
    );
    const result = ctx.build(ctx.c4);
    const text = result.lines.join("\n");
    // 先登场（第一章）保住整条正文（预算内），后登场（第二章）超预算降级概述
    expect(text).toContain("甲".repeat(FORESHADOW_PROSE_BUDGET - 500));
    expect(text).not.toContain("乙".repeat(600));
    expect(text).toContain("登场章正文未生成——该章剧情概述：宗门来人追查");
    expect(result.degradedCount).toBe(1);
  });

  test("回收组排序：登场章全局章序升序（与入库顺序无关）", async () => {
    const ctx = await setupDb();
    cleanups.push(ctx.cleanup);
    // 先入库的伏笔登场章更晚（第二章），后入库的更早（第一章）——输出须按章序：先第一章
    ctx.foreshadowStore.addForeshadow(
      NOVEL_ID,
      foreshadowFixture({ surfaceAction: "晚登场条目", appearChapterId: ctx.c2, recoverChapterIds: [ctx.c4] }),
    );
    ctx.foreshadowStore.addForeshadow(
      NOVEL_ID,
      foreshadowFixture({ surfaceAction: "早登场条目", appearChapterId: ctx.c1, recoverChapterIds: [ctx.c4] }),
    );
    const text = ctx.build(ctx.c4).lines.join("\n");
    expect(text.indexOf("早登场条目")).toBeGreaterThan(-1);
    expect(text.indexOf("早登场条目")).toBeLessThan(text.indexOf("晚登场条目"));
  });

  test("同章种收：归回收组标「登场于本章」，不注入任何章内容", async () => {
    const ctx = await setupDb();
    cleanups.push(ctx.cleanup);
    ctx.foreshadowStore.addForeshadow(
      NOVEL_ID,
      foreshadowFixture({ appearChapterId: ctx.c2, recoverChapterIds: [ctx.c2] }),
    );
    const result = ctx.build(ctx.c2);
    const text = result.lines.join("\n");
    expect(text).toContain("登场于本章：");
    expect(text).not.toContain("登场于《");
    expect(text).not.toContain("登场章正文");
    expect(result.appearCount).toBe(1);
    expect(result.recoverCount).toBe(1);
  });

  test("登场章节点不可解析（数据异常）：卡片照注入并标注，不计降级、不阻塞", async () => {
    const ctx = await setupDb();
    cleanups.push(ctx.cleanup);
    ctx.foreshadowStore.addForeshadow(
      NOVEL_ID,
      foreshadowFixture({
        appearChapterId: "ffffffff-0000-7000-8000-00000000dead",
        recoverChapterIds: [ctx.c2],
      }),
    );
    const result = ctx.build(ctx.c2);
    const text = result.lines.join("\n");
    expect(text).toContain("（登场章信息不可用）");
    expect(text).toContain("表面行为：少年拾得的碎片刻有宗门印记");
    expect(text).not.toContain("登场章正文");
    expect(result.degradedCount).toBe(0);
  });

  test("归档登场章（大纲换版后）：章名与正文照常解析（getOutlineNode 按 ID 直查不过滤版本）", async () => {
    const ctx = await setupDb();
    cleanups.push(ctx.cleanup);
    const rel = join("灵脉拾遗-eeeeeeee", "第一部", "第一章.md");
    writeDocumentArtifact(rel, PROSE_C1, ctx.outputDir);
    ctx.documentStore.saveChapterDocument(NOVEL_ID, ctx.c1, rel, 52);
    const f = ctx.foreshadowStore.addForeshadow(
      NOVEL_ID,
      foreshadowFixture({ appearChapterId: ctx.c1, recoverChapterIds: [ctx.c2] }),
    );
    // 大纲换版：旧树（含 c1/c2）整体归档，新树新幕下建新章
    const [, newAct] = ctx.outlineStore.saveOutlineTreeNewVersion(NOVEL_ID, [
      {
        name: "第一部（新版）",
        summary: "重整旗鼓",
        acts: [{ name: "第一幕（新版）", summary: "再起风波", keyPlotPoints: ["追查重启"] }],
      },
    ]);
    const newChapters = ctx.outlineStore.saveChapters(NOVEL_ID, newAct!.id, [
      { name: "新第一章", summary: "宗门重启追查" },
    ]);
    // 用户把回收章重绑到新版章（登场章保留指向归档旧章）
    ctx.foreshadowStore.updateForeshadow(f.id, { recoverChapterIds: [newChapters[0]!.id] });
    const result = ctx.build(newChapters[0]!.id);
    const text = result.lines.join("\n");
    expect(text).toContain("登场于《第一章》");
    expect(text).toContain(PROSE_C1);
    expect(result.degradedCount).toBe(0);
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`cd apps/agent && bun test src/workflows/foreshadow-context.test.ts`（或仓库根 `bun test apps/agent/src/workflows/foreshadow-context.test.ts`）
预期：FAIL——`Cannot find module './foreshadow-context'`（模块尚未创建）。

- [ ] **步骤 3：编写实现**

创建 `apps/agent/src/workflows/foreshadow-context.ts`：

```ts
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
  const appearGroup = stored.filter((s) => s.foreshadow.appearChapterId === chapterNodeId);
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
```

- [ ] **步骤 4：运行测试验证通过**

运行：`bun test apps/agent/src/workflows/foreshadow-context.test.ts`
预期：PASS，12 个用例全绿。

- [ ] **步骤 5：静态检查**

运行：`bun run typecheck && bun run lint`
预期：通过（新增文件无类型/规范问题）。

---

### 任务 2：write-chapter 集成注入

**文件：**
- 修改：`apps/agent/src/workflows/write-chapter.ts`（Options :20-38、store 解析 :79-86、上下文组装区 :123-135、notify :137-142、prompt 数组 :144-204）
- 修改：`apps/agent/src/workflows/write-chapter.test.ts`（imports、setupDb、新增 3 用例）

- [ ] **步骤 1：编写失败的测试**

修改 `apps/agent/src/workflows/write-chapter.test.ts`：

1. import 区新增：

```ts
import { ForeshadowStore } from "../state/foreshadow-store";
import { writeDocumentArtifact } from "../output/document-writer";
```

2. `setupDb` 两处扩展（既有用例不受影响——第一章的「下一章」仍是第二章，无任何断言排斥第三章）：

```ts
// store 构造区新增（DocumentStore 之后）：
  const foreshadowStore = new ForeshadowStore(db);
// saveChapters 章节清单增第三章：
  const chapters = outlineStore.saveChapters(NOVEL_ID, act!.id, [
    { name: "第一章", summary: "少年在市集拾得碎片" },
    { name: "第二章", summary: "宗门来人追查" },
    { name: "第三章", summary: "碎片来历初现" },
  ]);
// 返回对象新增两项：
    foreshadowStore,
    thirdChapterNodeId: chapters[2]!.id,
```

3. describe 块末尾（"混合启用停用"用例之后）新增三个用例：

```ts
  test("无绑定伏笔：prompt 无【本章伏笔】段与伏笔要求、无伏笔通知（现状回归）", async () => {
    const ctx = await setupDb();
    cleanupAll.push(ctx.cleanup);
    generateTextCalls = [];
    generateTextResult = PROSE;

    const channel = new FakeChannel([]);
    await writeChapter({ channel, novelId: NOVEL_ID, model: DUMMY_MODEL, ...ctx });

    const prompt = generateTextCalls[0]!.prompt;
    expect(prompt).not.toContain("【本章伏笔】");
    expect(prompt).not.toContain("按注意度控制显隐程度");
    // 写作要求编号与既有形态一致（无附加条时「只输出正文文本」仍是第 6 条）
    expect(prompt).toContain("6. 只输出正文文本");
    expect(channel.notifies.some((n) => n.includes("本章伏笔"))).toBeFalse();
  });

  test("登场与同章种收注入：伏笔块位于下一章块之后参考文风之前，通知统计，要求附加条编号顺延", async () => {
    const ctx = await setupDb();
    cleanupAll.push(ctx.cleanup);
    generateTextCalls = [];
    generateTextResult = PROSE;

    const lin = ctx.characterStore.listCharacters(NOVEL_ID)[0]!;
    ctx.foreshadowStore.addForeshadow(NOVEL_ID, {
      surfaceAction: "碎片刻着细如发丝的痕",
      hiddenTruth: "碎片是宗门失窃的镇脉之物",
      attentionLevel: 7,
      appearChapterId: ctx.chapterNodeId,
      characterIds: [lin.id],
    });
    ctx.foreshadowStore.addForeshadow(NOVEL_ID, {
      surfaceAction: "宗门告示的墨迹未干",
      hiddenTruth: "告示出自宗门内鬼",
      attentionLevel: 5,
      appearChapterId: ctx.chapterNodeId,
      recoverChapterIds: [ctx.chapterNodeId],
    });
    ctx.styleReferenceStore.addStyleReference(NOVEL_ID, { name: "样本", content: "文风文本。" });

    const channel = new FakeChannel([]);
    await writeChapter({ channel, novelId: NOVEL_ID, model: DUMMY_MODEL, ...ctx });

    const prompt = generateTextCalls[0]!.prompt;
    expect(prompt).toContain("【本章伏笔】");
    expect(prompt).toContain("一、本章登场");
    expect(prompt).toContain("碎片刻着细如发丝的痕");
    expect(prompt).toContain("服务角色：林恒");
    expect(prompt).toContain("二、本章回收");
    expect(prompt).toContain("登场于本章：");
    // 块位置：下一章块之后、参考文风之前（核心叙事上下文区，长样本文风仍留尾部）
    const foreshadowAt = prompt.indexOf("【本章伏笔】");
    const nextAt = prompt.indexOf("【下一章");
    const styleAt = prompt.indexOf("【参考文风】");
    const reqAt = prompt.indexOf("写作要求：");
    expect(nextAt).toBeGreaterThan(-1);
    expect(foreshadowAt).toBeGreaterThan(nextAt);
    expect(foreshadowAt).toBeLessThan(styleAt);
    expect(styleAt).toBeLessThan(reqAt);
    // 条件附加要求编号顺延：6=伏笔、7=文风、8=只输出正文文本
    expect(prompt).toContain("6. 本章如有登场伏笔");
    expect(prompt).toContain("7. 模仿参考文风");
    expect(prompt).toContain("8. 只输出正文文本");
    expect(channel.notifies.some((n) => n.includes("🔮 本章伏笔：登场 1 条、回收 1 条"))).toBeTrue();
  });

  test("回收伏笔登场章上下文：正文优先注入、未生成章概述兜底，通知带降级计数", async () => {
    const ctx = await setupDb();
    cleanupAll.push(ctx.cleanup);
    generateTextCalls = [];
    generateTextResult = PROSE;

    // 登场章 = 第一章（写正文文件 + 登记元数据）；另一条伏笔登场章 = 第三章（未写正文）
    const prose = "　　少年把碎片藏进袖中，指腹擦过那道细如发丝的刻痕。\n\n　　宗门的告示贴在市集口，墨迹未干。";
    const rel = join("灵脉拾遗-eeeeeeee", "第一部", "第一章.md");
    writeDocumentArtifact(rel, prose, ctx.outputDir);
    ctx.documentStore.saveChapterDocument(NOVEL_ID, ctx.chapterNodeId, rel, 52);
    ctx.foreshadowStore.addForeshadow(NOVEL_ID, {
      surfaceAction: "碎片刻有宗门印记",
      hiddenTruth: "碎片是宗门失窃的镇脉之物",
      attentionLevel: 6,
      appearChapterId: ctx.chapterNodeId,
      recoverChapterIds: [ctx.secondChapterNodeId],
    });
    ctx.foreshadowStore.addForeshadow(NOVEL_ID, {
      surfaceAction: "告示墨迹未干",
      hiddenTruth: "告示出自内鬼",
      attentionLevel: 5,
      appearChapterId: ctx.thirdChapterNodeId,
      recoverChapterIds: [ctx.secondChapterNodeId],
    });

    const channel = new FakeChannel([]);
    await writeChapter({
      channel,
      novelId: NOVEL_ID,
      model: DUMMY_MODEL,
      ...ctx,
      chapterNodeId: ctx.secondChapterNodeId,
    });

    const prompt = generateTextCalls[0]!.prompt;
    expect(prompt).toContain("登场于《第一章》");
    expect(prompt).toContain("登场章正文（呼应其细节，不要照抄）：");
    expect(prompt).toContain(prose);
    expect(prompt).toContain("登场章正文未生成——该章剧情概述：碎片来历初现");
    expect(prompt).not.toContain("一、本章登场");
    expect(
      channel.notifies.some((n) =>
        n.includes("🔮 本章伏笔：登场 0 条、回收 2 条（1 条登场章正文缺失或超预算，以概述代替）"),
      ),
    ).toBeTrue();
  });
```

- [ ] **步骤 2：运行测试验证失败**

运行：`bun test apps/agent/src/workflows/write-chapter.test.ts`
预期：FAIL——新增 3 用例断言失败（prompt 无【本章伏笔】段 / Options 不识别 ctx 展开的 foreshadowStore 不报错但无注入；TypeScript 不报错因为多余属性经展开传入）。注意「无绑定伏笔」现状回归用例应直接 PASS（它断言的就是现状），以另两个用例的失败为红灯。

- [ ] **步骤 3：编写实现**

修改 `apps/agent/src/workflows/write-chapter.ts`：

1. import 区新增（document-writer import 旁）：

```ts
import { getDefaultForeshadowStore, type ForeshadowStore } from "../state/foreshadow-store";
import { buildChapterForeshadowContext } from "./foreshadow-context";
```

2. `WriteChapterOptions` 增字段（styleReferenceStore 之后）：

```ts
  /** 伏笔库；缺省 getDefaultForeshadowStore()，测试注入替身 */
  foreshadowStore?: ForeshadowStore;
```

3. store 解析区（styleReferenceStore 行之后）：

```ts
  const foreshadowStore = options.foreshadowStore ?? getDefaultForeshadowStore();
```

4. enabledStyles 块之后、「✍️ 正文生成中」notify 之前插入：

```ts
  // 本章伏笔（可选增强，不阻塞生成）：绑定到本章的伏笔——登场注入卡片、回收注入卡片
  // + 登场章上下文（正文优先、概述兜底、预算护栏，详见 foreshadow-context.ts）
  const foreshadowContext = buildChapterForeshadowContext({
    novelId,
    chapterNodeId,
    foreshadowStore,
    outlineStore,
    documentStore,
    characterStore,
    outputDir,
  });
  const hasForeshadows = foreshadowContext.lines.length > 0;
```

5. 「✍️ 正文生成中」notify 之后、「🖋️ 本次参考文风」之前插入：

```ts
  if (hasForeshadows) {
    channel.notify(
      `🔮 本章伏笔：登场 ${foreshadowContext.appearCount} 条、回收 ${foreshadowContext.recoverCount} 条` +
        (foreshadowContext.degradedCount > 0
          ? `（${foreshadowContext.degradedCount} 条登场章正文缺失或超预算，以概述代替）`
          : ""),
    );
  }
```

6. prompt 数组：`next ? ... : null,` 之后、参考文风展开之前插入：

```ts
      // 本章伏笔插在下一章块之后、参考文风之前：核心叙事上下文区，长样本文风仍留尾部
      ...(hasForeshadows ? ["", ...foreshadowContext.lines] : []),
```

7. 写作要求改造——把「6. 模仿参考文风…」三元与「7./6. 只输出正文文本」三元两段替换为编号顺延机制。`generateText` 调用之前定义：

```ts
  // 条件附加要求（伏笔/文风）编号顺延，末条固定「只输出正文文本」——无附加条时与既有形态一致
  const extraRequirements: string[] = [];
  if (hasForeshadows) {
    extraRequirements.push(
      "本章如有登场伏笔，按注意度控制显隐程度、自然带出不刻意；如有回收伏笔，呼应登场章的具体细节、不复述登场原文；",
    );
  }
  if (enabledStyles.length > 0) {
    extraRequirements.push(
      "模仿参考文风样本的叙事语言、句式节奏与描写风格，但不抄袭其具体情节与专有名词；",
    );
  }
```

prompt 数组尾部两段替换为：

```ts
      ...extraRequirements.map((text, i) => `${6 + i}. ${text}`),
      `${6 + extraRequirements.length}. 只输出正文文本：不要章节标题、不要任何说明或元信息。`,
```

8. 函数头文档注释的上下文清单句更新：`……本章概述、同幕前后章概述` 之后补 `、本章绑定伏笔（登场卡片 / 回收卡片+登场章上下文）`。

- [ ] **步骤 4：运行测试验证通过**

运行：`bun test apps/agent/src/workflows/write-chapter.test.ts`
预期：PASS——既有 8 个用例（含文风三用例）全绿 + 新增 3 用例全绿。

- [ ] **步骤 5：全量测试**

运行：`bun run test`
预期：全绿（319 既有 + 净增 15：模块 12 + 集成 3）。

---

### 任务 3：全量校验、文档同步与统一提交

**文件：**
- 修改：`apps/agent/src/workflows/ARCHITECTURE.md`、`apps/agent/src/workflows/PROGRESS.md`（模块级）
- 修改：根 `ARCHITECTURE.md`、根 `PROGRESS.md`、根 `DECISIONS.md`、`AGENTS.md`（项目级）

- [ ] **步骤 1：全量静态与运行时校验**

运行：`bun run typecheck && bun run lint && bun run test`
预期：三项全过。任何失败修复后重跑，禁止带错进入下一步。

- [ ] **步骤 2：文档同步（两层）**

模块级 `apps/agent/src/workflows/ARCHITECTURE.md`：
- 文件清单新增 `foreshadow-context.ts`（职责一句话：本章伏笔 prompt 块构建纯函数——分组/登场章上下文兜底链/预算护栏）；
- write-chapter 编排描述的上下文组装清单补「本章绑定伏笔（登场卡片、回收卡片+登场章正文优先概述兜底+多步回收既往章概述，8000 字符预算护栏）」。

项目级根 `ARCHITECTURE.md`：
- `write-chapter.ts` 条目的上下文描述同步补伏笔注入（对齐模块级措辞）；
- workflows/ 目录树清单补 `foreshadow-context.ts` 一行。

`AGENTS.md`：首段 write-chapter 描述（「章节正文经章节点……按章节概述单轮生成」处）与「目录结构与模块划分」workflows 清单补伏笔上下文注入一句。

根 `PROGRESS.md`：
- 「进行中」任务清单（编码前落盘的）整体删除，归一一条完成总结入「已完成」：时间 2026-10-11、[feat] 章节正文生成伏笔上下文注入、设计规格与实现计划路径、两项决策（登场仅卡片；回收正文优先+概述兜底+预算）、AC 结果（typecheck/lint/test 数字）；
- 若「已完成」超 5 条，最旧一条并入「历史归档」滚动摘要。

根 `DECISIONS.md`：顶部追加当日条目「章节正文生成伏笔上下文注入：登场仅卡片、回收登场章正文优先+概述兜底+预算护栏」——背景（伏笔不进正文 prompt 的一致性传播问题）、备选（仅概述 / 全文无预算 / LLM 预提取，均否决理由）、结论（FORESHADOW_PROSE_BUDGET=8000、归档章 ID 直查、零 schema 迁移、伏笔编辑从此对未写章滚动生效——剩余不一致收敛为已写正文，衔接后续一致性机制讨论）。

- [ ] **步骤 3：统一原子提交**

```bash
git add apps/agent/src/workflows/foreshadow-context.ts \
        apps/agent/src/workflows/foreshadow-context.test.ts \
        apps/agent/src/workflows/write-chapter.ts \
        apps/agent/src/workflows/write-chapter.test.ts \
        apps/agent/src/workflows/ARCHITECTURE.md \
        apps/agent/src/workflows/PROGRESS.md \
        ARCHITECTURE.md PROGRESS.md DECISIONS.md AGENTS.md
git commit -m "feat(workflows): 章节正文生成伏笔上下文注入——登场卡片+回收正文优先概述兜底

- 新增 foreshadow-context.ts 纯函数模块：本章绑定伏笔分登场/回收两组，
  回收组按登场章全局章序升序；登场章上下文正文优先（FORESHADOW_PROSE_BUDGET=8000
  整条扣减不截断）、未生成/文件缺失/超预算降级概述；多步回收注入既往回收章概述；
  同章种收标「登场于本章」；归档登场章按 ID 直查照常解析
- write-chapter：【本章伏笔】块插【下一章】后【参考文风】前，写作要求条件附加
  编号顺延，生成前 notify 登场/回收统计与降级计数；无伏笔零注入零通知（现状回归）
- 零 schema 迁移；伏笔编辑从此对未写章节滚动生效（一致性机制为后续需求）"
```

提交前确认 `git status` 无计划外文件；`bun run typecheck && bun run lint && bun run test` 已在步骤 1 全过。

---

## 自检记录

- **规格覆盖度**：规格 3.1（读取分组）→ 任务 1；3.2（兜底链/多步/预算/归档/同章种收）→ 任务 1（各有独立用例）；3.3（块位置/格式/写作要求/notify/零注入）→ 任务 1 产出行 + 任务 2 集成；4 数据流 → 任务 2；5 错误处理（节点不存在/文件缺失/JSON 损坏既有行为）→ 任务 1 守卫与用例；6 测试计划 10 项 → 模块 12 用例 + 集成 3 用例逐项对应；7 不做范围未越界。无遗漏。
- **占位符扫描**：无「待定/TODO/类似任务 N」；全部代码步骤含完整代码。
- **类型一致性**：`buildChapterForeshadowContext(options): ChapterForeshadowContext`、`FORESHADOW_PROSE_BUDGET` 在任务 1 定义、任务 2 测试引用一致；write-chapter Options 字段名 `foreshadowStore` 与 setupDb 返回键一致（ctx 展开自动注入）。

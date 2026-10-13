import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  CharacterEntry,
  CharacterMigrationEntry,
  NovelDetail,
  OutlineNodeEntry,
} from "@novel/shared";
import { CharacterMigrationPanel } from "./CharacterMigrationPanel";

const NOVEL_ID = "eeeeeeee-4444-7444-8555-666677778888";

const part: OutlineNodeEntry = {
  id: "part-1", parentId: null, type: "part", name: "第一部", sort: 1,
  summary: "部梗概", keyPlotPoints: null, characterIds: null,
};
const act: OutlineNodeEntry = {
  id: "act-1", parentId: "part-1", type: "act", name: "第一幕", sort: 1,
  summary: "幕梗概", keyPlotPoints: ["点一"], characterIds: null,
};
const chapter: OutlineNodeEntry = {
  id: "chapter-2", parentId: "act-1", type: "chapter", name: "第二章", sort: 1,
  summary: "第二章概述", keyPlotPoints: null, characterIds: ["c-1"],
};

const character: CharacterEntry = {
  id: "c-1",
  version: 1,
  updatedAt: "2026-09-01T00:00:00.000Z",
  basicInfo: { name: "林恒" },
  core: { desire: "夺回灵脉", fear: "辜负同伴", narrativeRole: "主角" },
  background: "青云市集的散修少年",
  creationPurpose: "承载打破宗门垄断的主线",
  endingDirection: "打破垄断后归隐",
};

function migration(over: Partial<CharacterMigrationEntry> = {}): CharacterMigrationEntry {
  return {
    id: "m-1",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-05T00:00:00.000Z",
    novelId: NOVEL_ID,
    characterId: "c-1",
    outlineVersion: 1,
    migrateField: "personality",
    oldValue: "热情",
    newValue: "谨慎",
    startChapterId: "chapter-2",
    endChapterId: null,
    trigger: "经历背叛",
    transitionGuidance: "逐渐收敛外放",
    sequence: 1,
    revision: 1,
    status: "draft",
    groupId: null,
    ...over,
  };
}

const detail: NovelDetail = {
  novel: {
    id: NOVEL_ID, name: "灵脉拾遗", pinned: false, favorite: false,
    createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
    genre: null, audience: null, coreConflict: null,
  },
  worldview: null,
  characters: [character],
  migrations: [],
  outlineNodes: [part, act, chapter],
  documents: [],
  foreshadows: [],
  locations: [],
  styleReferences: [],
};

function render(migrations: CharacterMigrationEntry[]): string {
  return renderToStaticMarkup(
    <CharacterMigrationPanel
      novelId={NOVEL_ID}
      character={character}
      detail={{ ...detail, migrations }}
      onChanged={() => {}}
    />,
  );
}

describe("CharacterMigrationPanel 迁移清单", () => {
  test("空清单：给出占位提示与新增入口", () => {
    const html = render([]);
    expect(html).toContain("🧬 角色迁移（0）");
    expect(html).toContain("暂无迁移");
    expect(html).toContain("新增迁移");
  });

  test("草案行：展示序号/状态/修订版/字段/原值→目标值/区间/诱因/过渡，附编辑·确认生效·取消", () => {
    const html = render([migration()]);
    expect(html).toContain("#1 · 性格（草案 · 修订 v1）");
    expect(html).toContain("热情 → 谨慎");
    expect(html).toContain("第一部/第一幕/第二章 ~ （开放）");
    expect(html).toContain("大纲 v1");
    expect(html).toContain("诱因：经历背叛");
    expect(html).toContain("过渡：逐渐收敛外放");
    expect(html).toContain("✏️ 编辑");
    expect(html).toContain("✅ 确认生效");
    expect(html).toContain("🗑 取消");
    expect(html).not.toContain("复制为新草案");
  });

  test("已确认行：无确认入口，附编辑·取消·复制为新草案", () => {
    const html = render([migration({ status: "confirmed", revision: 2 })]);
    expect(html).toContain("（已确认 · 修订 v2）");
    expect(html).not.toContain("✅ 确认生效");
    expect(html).toContain("⧉ 复制为新草案");
  });

  test("已取消行：只提供复制为新草案（归档方案重新绑定入口）", () => {
    const html = render([migration({ status: "cancelled", outlineVersion: 1, startChapterId: null })]);
    expect(html).toContain("（已取消 · 修订 v1）");
    expect(html).not.toContain("🗑 取消");
    expect(html).not.toContain("✅ 确认生效");
    expect(html).toContain("⧉ 复制为新草案");
    expect(html).toContain("章节：— ~ （开放）");
  });

  test("按序号排序渲染", () => {
    const html = render([
      migration({ id: "m-2", sequence: 2, migrateField: "core.fear", newValue: "失去同伴" }),
      migration({ id: "m-1", sequence: 1 }),
    ]);
    expect(html.indexOf("#1 ·")).toBeLessThan(html.indexOf("#2 ·"));
  });
});

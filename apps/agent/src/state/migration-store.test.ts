import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { characterSchema, type Character } from "@novel/shared";
import { openDatabase } from "./db";
import { CharacterStore } from "./character-store";
import { NovelStore } from "./novel-store";
import { OutlineStore } from "./outline-store";
import { CharacterMigrationStore } from "./migration-store";

const NOVEL_ID = "aaaaaaaa-1111-7000-8000-000000000001";
const OTHER_NOVEL_ID = "aaaaaaaa-1111-7000-8000-000000000002";

const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

function makeCharacter(name: string): Character {
  return characterSchema.parse({
    basicInfo: { name, gender: "男", appearance: "短发精瘦" },
    core: { desire: `${name}的渴望`, fear: "辜负同伴", narrativeRole: "主角" },
    background: "青云市集的散修少年",
    personality: "热情",
    characterGoal: "建立散修联盟",
    creationPurpose: "承载打破垄断的主线",
    trajectory: "杂役 → 联盟开创者",
    endingDirection: "打破宗门垄断",
    relationships: "与柳三是搭档",
  });
}

async function setup(options: { chapterCount?: number } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "novel-migration-"));
  tempDirs.push(dir);
  const dbPath = join(dir, "test.db");
  const db = openDatabase(dbPath);
  new NovelStore(db).createNovel({ id: NOVEL_ID });
  new NovelStore(db).createNovel({ id: OTHER_NOVEL_ID });
  const outlineStore = new OutlineStore(db);
  outlineStore.saveOutlineTree(NOVEL_ID, [
    {
      name: "第一部",
      summary: "部梗概",
      acts: [{ name: "第一幕", summary: "幕梗概", keyPlotPoints: ["情节点一"] }],
    },
  ]);
  const act = outlineStore
    .listOutlineNodes(NOVEL_ID, { currentOnly: true })
    .find((node) => node.node.type === "act")!;
  const count = options.chapterCount ?? 8;
  const chapters = outlineStore.saveChapters(
    NOVEL_ID,
    act.id,
    Array.from({ length: count }, (_, index) => ({
      name: `第${index + 1}章`,
      summary: `第${index + 1}章概述`,
    })),
  );
  const characterStore = new CharacterStore(db);
  const character = characterStore.addCharacter(NOVEL_ID, makeCharacter("陈默"));
  const store = new CharacterMigrationStore(db);
  return { dir, db, dbPath, outlineStore, characterStore, store, chapters, character, act };
}

describe("CharacterMigrationStore 草案创建", () => {
  test("新建姓名迁移拒绝且不分配序号", async () => {
    const { store, character } = await setup();
    // 模拟绕过 TypeScript 的旧客户端 / 外部 JSON 请求，运行期仍必须拒绝。
    const legacyInput = { migrateField: "basicInfo.name", newValue: "陆隐" } as unknown as Parameters<CharacterMigrationStore["addMigration"]>[2];
    expect(() => store.addMigration(NOVEL_ID, character.id, legacyInput)).toThrow("姓名");
    expect(store.listMigrations(NOVEL_ID)).toEqual([]);
  });

  test("历史姓名迁移可读可取消，编辑与确认拒绝且零副作用", async () => {
    const { store, character, chapters, db } = await setup();
    const draft = store.addMigration(NOVEL_ID, character.id, {
      migrateField: "personality", newValue: "陆隐", startChapterId: chapters[0]!.id,
      endChapterId: chapters[1]!.id, trigger: "化名", transitionGuidance: "换名",
    });
    db.prepare("UPDATE character_migrations SET migrate_field = 'basicInfo.name', old_value = ? WHERE id = ?").run("陈默", draft.id);
    const before = store.getMigration(draft.id);
    expect(() => store.confirmMigration(NOVEL_ID, draft.id)).toThrow("姓名");
    expect(store.getMigration(draft.id)).toEqual(before);
    expect(() => store.updateMigration(NOVEL_ID, draft.id, { newValue: "新名" })).toThrow("姓名");
    expect(store.getMigration(draft.id)).toEqual(before);
    expect(store.listMigrationVersions(draft.id)).toEqual([]);
    expect(store.cancelMigration(NOVEL_ID, draft.id).migration.status).toBe("cancelled");
  });
  test("草案未绑起始章：旧值留空、sequence=1、status=draft", async () => {
    const { store, character } = await setup();
    const created = store.addMigration(NOVEL_ID, character.id, {
      migrateField: "personality",
      newValue: "  谨慎  ",
    });
    expect(created.migration.status).toBe("draft");
    expect(created.migration.newValue).toBe("谨慎");
    expect(created.migration.oldValue).toBeNull();
    expect(created.migration.sequence).toBe(1);
    expect(created.migration.revision).toBe(1);
    expect(created.migration.outlineVersion).toBeNull();
    expect(created.migration.startChapterId).toBeNull();
    expect(created.migration.groupId).toBeNull();
  });

  test("草案绑起始章：旧值由服务端派生为基准值，outlineVersion 取章所属版本", async () => {
    const { store, character, chapters } = await setup();
    const created = store.addMigration(NOVEL_ID, character.id, {
      migrateField: "personality",
      newValue: "谨慎",
      startChapterId: chapters[3]!.id,
      trigger: "经历背叛",
      transitionGuidance: "逐渐收敛外放，遇事先观察",
    });
    expect(created.migration.oldValue).toBe("热情");
    expect(created.migration.outlineVersion).toBe(1);
    expect(created.migration.startChapterId).toBe(chapters[3]!.id);
  });

  test("必填字段目标值不可为空；可选字段可清空", async () => {
    const { store, character } = await setup();
    expect(() =>
      store.addMigration(NOVEL_ID, character.id, { migrateField: "core.desire", newValue: "  " }),
    ).toThrow("必填");
    const cleared = store.addMigration(NOVEL_ID, character.id, {
      migrateField: "personality",
      newValue: null,
    });
    expect(cleared.migration.newValue).toBeNull();
  });

  test("角色不存在 / 异小说角色被拒", async () => {
    const { store, character } = await setup();
    expect(() =>
      store.addMigration(NOVEL_ID, "ffffffff-0000-7000-8000-000000000001", {
        migrateField: "personality",
        newValue: "谨慎",
      }),
    ).toThrow("角色不存在");
    expect(() =>
      store.addMigration(OTHER_NOVEL_ID, character.id, {
        migrateField: "personality",
        newValue: "谨慎",
      }),
    ).toThrow("角色不属于该小说");
  });

  test("sequence 在角色内原子递增且不复用", async () => {
    const { store, character } = await setup();
    expect(store.addMigration(NOVEL_ID, character.id, { migrateField: "personality", newValue: "a" }).migration.sequence).toBe(1);
    expect(store.addMigration(NOVEL_ID, character.id, { migrateField: "core.fear", newValue: "b" }).migration.sequence).toBe(2);
    expect(store.addMigration(NOVEL_ID, character.id, { migrateField: "personality", newValue: "c" }).migration.sequence).toBe(3);
  });
});

describe("CharacterMigrationStore 章节校验", () => {
  test("起始章须为同小说章节点（幕节点 / 异小说章 / 不存在均被拒）", async () => {
    const { store, character, act, db } = await setup();
    expect(() =>
      store.addMigration(NOVEL_ID, character.id, {
        migrateField: "personality",
        newValue: "谨慎",
        startChapterId: act.id,
      }),
    ).toThrow("不是章节点");
    expect(() =>
      store.addMigration(NOVEL_ID, character.id, {
        migrateField: "personality",
        newValue: "谨慎",
        startChapterId: "ffffffff-0000-7000-8000-000000000002",
      }),
    ).toThrow("不是章节点");
    // 异小说章：另一本小说下的章节点不在本小说的定位索引中
    const otherOutline = new OutlineStore(db);
    otherOutline.saveOutlineTree(OTHER_NOVEL_ID, [
      { name: "外书部", summary: "梗概", acts: [{ name: "外书幕", summary: "梗概", keyPlotPoints: ["点"] }] },
    ]);
    const otherAct = otherOutline
      .listOutlineNodes(OTHER_NOVEL_ID, { currentOnly: true })
      .find((node) => node.node.type === "act")!;
    const [otherChapter] = otherOutline.saveChapters(OTHER_NOVEL_ID, otherAct.id, [
      { name: "外书章", summary: "概述" },
    ]);
    expect(() =>
      store.addMigration(NOVEL_ID, character.id, {
        migrateField: "personality",
        newValue: "谨慎",
        startChapterId: otherChapter!.id,
      }),
    ).toThrow("起始章不存在、不属于该小说或不是章节点");
  });

  test("start ≤ end；结束章不能脱离起始章单独绑定", async () => {
    const { store, character, chapters } = await setup();
    expect(() =>
      store.addMigration(NOVEL_ID, character.id, {
        migrateField: "personality",
        newValue: "谨慎",
        startChapterId: chapters[4]!.id,
        endChapterId: chapters[2]!.id,
      }),
    ).toThrow("起始章不能晚于结束章");
    expect(() =>
      store.addMigration(NOVEL_ID, character.id, {
        migrateField: "personality",
        newValue: "谨慎",
        endChapterId: chapters[2]!.id,
      }),
    ).toThrow("结束章不能在没有起始章时绑定");
  });

  test("起始章与结束章必须属于同一大纲树版本", async () => {
    const { store, character, chapters, outlineStore } = await setup();
    outlineStore.saveOutlineTreeNewVersion(NOVEL_ID, [
      {
        name: "第一部",
        summary: "新部梗概",
        acts: [{ name: "第一幕", summary: "新幕梗概", keyPlotPoints: ["新点"] }],
      },
    ]);
    const newAct = outlineStore
      .listOutlineNodes(NOVEL_ID, { currentOnly: true })
      .find((node) => node.node.type === "act")!;
    const [newChapter] = outlineStore.saveChapters(NOVEL_ID, newAct.id, [
      { name: "新版第一章", summary: "新版概述" },
    ]);
    expect(() =>
      store.addMigration(NOVEL_ID, character.id, {
        migrateField: "personality",
        newValue: "谨慎",
        startChapterId: chapters[0]!.id,
        endChapterId: newChapter!.id,
      }),
    ).toThrow("必须属于同一大纲树版本");
  });
});

describe("CharacterMigrationStore 确认与旧值链", () => {
  test("确认必填校验：起始章 / 诱因 / 过渡描述缺一不可", async () => {
    const { store, character, chapters } = await setup();
    const noStart = store.addMigration(NOVEL_ID, character.id, {
      migrateField: "personality",
      newValue: "谨慎",
    });
    expect(() => store.confirmMigration(NOVEL_ID, noStart.id)).toThrow("必须绑定起始章");

    const noTrigger = store.addMigration(NOVEL_ID, character.id, {
      migrateField: "personality",
      newValue: "谨慎",
      startChapterId: chapters[3]!.id,
    });
    expect(() => store.confirmMigration(NOVEL_ID, noTrigger.id)).toThrow("必须填写诱因");

    const noTransition = store.addMigration(NOVEL_ID, character.id, {
      migrateField: "personality",
      newValue: "谨慎",
      startChapterId: chapters[3]!.id,
      trigger: "经历背叛",
    });
    expect(() => store.confirmMigration(NOVEL_ID, noTransition.id)).toThrow("必须填写过渡描述");
  });

  test("确认：旧值派生为基准、revision 递增、旧行快照归档、status=confirmed", async () => {
    const { store, character, chapters, db } = await setup();
    const draft = store.addMigration(NOVEL_ID, character.id, {
      migrateField: "personality",
      newValue: "谨慎",
      startChapterId: chapters[3]!.id,
      endChapterId: chapters[6]!.id,
      trigger: "经历背叛",
      transitionGuidance: "逐渐收敛外放",
    });
    const confirmed = store.confirmMigration(NOVEL_ID, draft.id);
    expect(confirmed.migration.status).toBe("confirmed");
    expect(confirmed.migration.oldValue).toBe("热情");
    expect(confirmed.migration.revision).toBe(2);
    expect(confirmed.id).toBe(draft.id);
    expect(confirmed.migration.sequence).toBe(draft.migration.sequence);

    const versions = store.listMigrationVersions(draft.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]!.revision).toBe(1);
    expect(versions[0]!.migration.status).toBe("draft");
    // 基准卡未被覆盖
    expect(new CharacterStore(db).getCharacter(character.id)?.character.personality).toBe("热情");
  });

  test("第二次同字段迁移旧值派生自第一次新值；期间插入的异字段迁移不影响该链", async () => {
    const { store, character, chapters } = await setup();
    const first = store.addMigration(NOVEL_ID, character.id, {
      migrateField: "personality",
      newValue: "谨慎",
      startChapterId: chapters[3]!.id,
      endChapterId: chapters[6]!.id,
      trigger: "经历背叛",
      transitionGuidance: "逐渐收敛",
    });
    store.confirmMigration(NOVEL_ID, first.id);

    // 异字段迁移（恐惧）并行，不参与性格链
    const fear = store.addMigration(NOVEL_ID, character.id, {
      migrateField: "core.fear",
      newValue: "失去同伴",
      startChapterId: chapters[1]!.id,
      trigger: "目睹牺牲",
      transitionGuidance: "恐惧转向守护",
    });
    store.confirmMigration(NOVEL_ID, fear.id);

    const second = store.addMigration(NOVEL_ID, character.id, {
      migrateField: "personality",
      newValue: "沉稳",
      startChapterId: chapters[7]!.id,
      trigger: "承担责任",
      transitionGuidance: "由谨慎转向沉稳",
    });
    expect(second.migration.oldValue).toBe("谨慎");
    const confirmedSecond = store.confirmMigration(NOVEL_ID, second.id);
    expect(confirmedSecond.migration.oldValue).toBe("谨慎");
  });
});

describe("CharacterMigrationStore 重叠与依赖守卫", () => {
  test.each([
    { startChapterId: null, endChapterId: null },
    { trigger: null },
    { transitionGuidance: "   " },
  ])("已确认迁移清空确认条件时整行与修订历史不变：%j", async (patch) => {
    const { store, character, chapters, db } = await setup();
    try {
      const draft = store.addMigration(NOVEL_ID, character.id, {
        migrateField: "personality", newValue: "谨慎",
        startChapterId: chapters[1]!.id, endChapterId: chapters[2]!.id,
        trigger: "背叛", transitionGuidance: "逐渐收敛",
      });
      const before = store.confirmMigration(NOVEL_ID, draft.id);
      expect(() => store.updateMigration(NOVEL_ID, draft.id, patch)).toThrow();
      expect(store.getMigration(draft.id)).toEqual(before);
      expect(store.listMigrationVersions(draft.id)).toHaveLength(1);
    } finally { db.close(); }
  });

  test("补入较早迁移不能改坏已确认下游的旧值，失败保持草案与快照不变", async () => {
    const { store, character, chapters, db } = await setup();
    try {
      const later = store.addMigration(NOVEL_ID, character.id, {
        migrateField: "personality", newValue: "冷漠",
        startChapterId: chapters[6]!.id, endChapterId: chapters[7]!.id,
        trigger: "失望", transitionGuidance: "失去信任",
      });
      const confirmed = store.confirmMigration(NOVEL_ID, later.id);
      const earlier = store.addMigration(NOVEL_ID, character.id, {
        migrateField: "personality", newValue: "谨慎",
        startChapterId: chapters[1]!.id, endChapterId: chapters[2]!.id,
        trigger: "背叛", transitionGuidance: "收敛",
      });
      expect(() => store.confirmMigration(NOVEL_ID, earlier.id)).toThrow("迁移链");
      expect(store.getMigration(earlier.id)).toEqual(earlier);
      expect(store.getMigration(later.id)).toEqual(confirmed);
      expect(store.listMigrationVersions(earlier.id)).toHaveLength(0);
    } finally { db.close(); }
  });

  test.each([false, true])("移动前置迁移跨越下游不能绕过链守卫（同时改目标：%s）", async (changeValue) => {
    const { store, character, chapters, db } = await setup({ chapterCount: 10 });
    try {
      const first = store.addMigration(NOVEL_ID, character.id, {
        migrateField: "personality", newValue: "谨慎",
        startChapterId: chapters[1]!.id, endChapterId: chapters[2]!.id,
        trigger: "背叛", transitionGuidance: "收敛",
      });
      const before = store.confirmMigration(NOVEL_ID, first.id);
      const later = store.addMigration(NOVEL_ID, character.id, {
        migrateField: "personality", newValue: "冷漠",
        startChapterId: chapters[6]!.id, endChapterId: chapters[7]!.id,
        trigger: "失望", transitionGuidance: "失去信任",
      });
      store.confirmMigration(NOVEL_ID, later.id);
      expect(() => store.updateMigration(NOVEL_ID, first.id, {
        startChapterId: chapters[8]!.id, endChapterId: chapters[9]!.id,
        ...(changeValue ? { newValue: "勇敢" } : {}),
      })).toThrow();
      expect(store.getMigration(first.id)).toEqual(before);
      expect(store.getMigration(later.id)?.migration.oldValue).toBe("谨慎");
      expect(store.listMigrationVersions(first.id)).toHaveLength(1);
    } finally { db.close(); }
  });

  test("不改变前后顺序的区间修改与不同字段并行仍允许", async () => {
    const { store, character, chapters, db } = await setup();
    try {
      const first = store.addMigration(NOVEL_ID, character.id, {
        migrateField: "personality", newValue: "谨慎",
        startChapterId: chapters[1]!.id, endChapterId: chapters[2]!.id,
        trigger: "背叛", transitionGuidance: "收敛",
      });
      store.confirmMigration(NOVEL_ID, first.id);
      const later = store.addMigration(NOVEL_ID, character.id, {
        migrateField: "personality", newValue: "冷漠",
        startChapterId: chapters[6]!.id, trigger: "失望", transitionGuidance: "失去信任",
      });
      store.confirmMigration(NOVEL_ID, later.id);
      const updated = store.updateMigration(NOVEL_ID, first.id, { endChapterId: chapters[3]!.id });
      expect(updated.migration.endChapterId).toBe(chapters[3]!.id);
      expect(store.getMigration(later.id)?.migration.oldValue).toBe("谨慎");
    } finally { db.close(); }
  });

  test("把前置迁移移到新版大纲不得移除旧版下游的依据", async () => {
    const { store, character, chapters, outlineStore, db } = await setup();
    try {
      const first = store.addMigration(NOVEL_ID, character.id, {
        migrateField: "personality", newValue: "谨慎",
        startChapterId: chapters[0]!.id, endChapterId: chapters[1]!.id,
        trigger: "背叛", transitionGuidance: "收敛",
      });
      const before = store.confirmMigration(NOVEL_ID, first.id);
      const later = store.addMigration(NOVEL_ID, character.id, {
        migrateField: "personality", newValue: "冷漠",
        startChapterId: chapters[4]!.id, trigger: "失望", transitionGuidance: "失去信任",
      });
      store.confirmMigration(NOVEL_ID, later.id);
      outlineStore.saveOutlineTreeNewVersion(NOVEL_ID, [
        { name: "新版部", summary: "梗概", acts: [{ name: "新版幕", summary: "梗概", keyPlotPoints: ["点"] }] },
      ]);
      const newAct = outlineStore.listOutlineNodes(NOVEL_ID, { currentOnly: true }).find((node) => node.node.type === "act")!;
      const [newChapter] = outlineStore.saveChapters(NOVEL_ID, newAct.id, [{ name: "新版章", summary: "概述" }]);
      expect(() => store.updateMigration(NOVEL_ID, first.id, { startChapterId: newChapter!.id, endChapterId: newChapter!.id })).toThrow("迁移链");
      expect(store.getMigration(first.id)).toEqual(before);
      expect(store.getMigration(later.id)?.migration.oldValue).toBe("谨慎");
      expect(store.listMigrationVersions(first.id)).toHaveLength(1);
    } finally { db.close(); }
  });

  test("同字段生效区间重叠被拒；不同字段并行允许", async () => {
    const { store, character, chapters } = await setup();
    const first = store.addMigration(NOVEL_ID, character.id, {
      migrateField: "personality",
      newValue: "谨慎",
      startChapterId: chapters[3]!.id,
      endChapterId: chapters[6]!.id,
      trigger: "经历背叛",
      transitionGuidance: "逐渐收敛",
    });
    store.confirmMigration(NOVEL_ID, first.id);

    const overlapping = store.addMigration(NOVEL_ID, character.id, {
      migrateField: "personality",
      newValue: "沉稳",
      startChapterId: chapters[5]!.id,
      trigger: "承担责任",
      transitionGuidance: "转向沉稳",
    });
    expect(() => store.confirmMigration(NOVEL_ID, overlapping.id)).toThrow("重叠");

    // 不同字段并行允许
    const parallel = store.addMigration(NOVEL_ID, character.id, {
      migrateField: "core.desire",
      newValue: "守护同伴",
      startChapterId: chapters[5]!.id,
      trigger: "信念转变",
      transitionGuidance: "由复仇转向守护",
    });
    expect(store.confirmMigration(NOVEL_ID, parallel.id).migration.status).toBe("confirmed");
  });

  test("前置开放区间未结束时不能确认同字段后续变化", async () => {
    const { store, character, chapters } = await setup();
    const open = store.addMigration(NOVEL_ID, character.id, {
      migrateField: "personality",
      newValue: "谨慎",
      startChapterId: chapters[3]!.id,
      trigger: "经历背叛",
      transitionGuidance: "逐渐收敛",
    });
    store.confirmMigration(NOVEL_ID, open.id);

    const later = store.addMigration(NOVEL_ID, character.id, {
      migrateField: "personality",
      newValue: "沉稳",
      startChapterId: chapters[5]!.id,
      trigger: "承担责任",
      transitionGuidance: "转向沉稳",
    });
    expect(() => store.confirmMigration(NOVEL_ID, later.id)).toThrow("未结束");
  });

  test("后续已确认迁移依赖本记录：改新值 / 取消被拒，改诱因与过渡允许", async () => {
    const { store, character, chapters } = await setup();
    const first = store.addMigration(NOVEL_ID, character.id, {
      migrateField: "personality",
      newValue: "谨慎",
      startChapterId: chapters[3]!.id,
      endChapterId: chapters[4]!.id,
      trigger: "经历背叛",
      transitionGuidance: "逐渐收敛",
    });
    store.confirmMigration(NOVEL_ID, first.id);
    const second = store.addMigration(NOVEL_ID, character.id, {
      migrateField: "personality",
      newValue: "沉稳",
      startChapterId: chapters[5]!.id,
      trigger: "承担责任",
      transitionGuidance: "转向沉稳",
    });
    store.confirmMigration(NOVEL_ID, second.id);

    expect(() => store.updateMigration(NOVEL_ID, first.id, { newValue: "多疑" })).toThrow("后续已确认迁移");
    expect(() => store.cancelMigration(NOVEL_ID, first.id)).toThrow("后续已确认迁移");

    const edited = store.updateMigration(NOVEL_ID, first.id, {
      trigger: "经历背叛与孤立",
      transitionGuidance: "收敛外放但保留赤诚",
    });
    expect(edited.migration.revision).toBe(3);
    expect(edited.migration.newValue).toBe("谨慎");
    expect(store.listMigrationVersions(first.id)).toHaveLength(2);
  });

  test("取消：草案可取消且不参与解析；已取消不可编辑 / 确认", async () => {
    const { store, character, chapters } = await setup();
    const draft = store.addMigration(NOVEL_ID, character.id, {
      migrateField: "personality",
      newValue: "谨慎",
      startChapterId: chapters[3]!.id,
      trigger: "经历背叛",
      transitionGuidance: "逐渐收敛",
    });
    const cancelled = store.cancelMigration(NOVEL_ID, draft.id);
    expect(cancelled.migration.status).toBe("cancelled");
    expect(cancelled.migration.revision).toBe(2);
    expect(() => store.updateMigration(NOVEL_ID, draft.id, { newValue: "多疑" })).toThrow("已取消");
    expect(() => store.confirmMigration(NOVEL_ID, draft.id)).toThrow("已取消");
  });
});

describe("CharacterMigrationStore 大纲换版与持久化", () => {
  test("换版后旧迁移绑定旧版本保留，新版独立成链（跨版本不重叠）", async () => {
    const { store, character, chapters, outlineStore } = await setup();
    const oldVersion = store.addMigration(NOVEL_ID, character.id, {
      migrateField: "personality",
      newValue: "谨慎",
      startChapterId: chapters[3]!.id,
      trigger: "经历背叛",
      transitionGuidance: "逐渐收敛",
    });
    store.confirmMigration(NOVEL_ID, oldVersion.id);

    outlineStore.saveOutlineTreeNewVersion(NOVEL_ID, [
      { name: "第一部", summary: "新部", acts: [{ name: "第一幕", summary: "新幕", keyPlotPoints: ["点"] }] },
    ]);
    const newAct = outlineStore
      .listOutlineNodes(NOVEL_ID, { currentOnly: true })
      .find((node) => node.node.type === "act")!;
    const newChapters = outlineStore.saveChapters(NOVEL_ID, newAct.id, [
      { name: "新版第一章", summary: "概述" },
      { name: "新版第二章", summary: "概述" },
    ]);

    // 新版草案：旧值取基准（不继承旧版方案），且不与旧版区间判重叠
    const draft = store.addMigration(NOVEL_ID, character.id, {
      migrateField: "personality",
      newValue: "温和",
      startChapterId: newChapters[0]!.id,
      trigger: "新的开始",
      transitionGuidance: "重新学会信任",
    });
    expect(draft.migration.oldValue).toBe("热情");
    expect(draft.migration.outlineVersion).toBe(2);
    expect(store.confirmMigration(NOVEL_ID, draft.id).migration.status).toBe("confirmed");

    // 旧记录仍在库（绑定旧版本）
    const listed = store.listMigrations(NOVEL_ID, character.id);
    expect(listed).toHaveLength(2);
    expect(listed.map((m) => m.migration.outlineVersion).sort()).toEqual([1, 2]);
  });

  test("重开数据库后迁移与修订历史仍在（真实持久化）", async () => {
    const { store, character, chapters, dbPath } = await setup();
    const draft = store.addMigration(NOVEL_ID, character.id, {
      migrateField: "personality",
      newValue: "谨慎",
      startChapterId: chapters[3]!.id,
      trigger: "经历背叛",
      transitionGuidance: "逐渐收敛",
    });
    store.confirmMigration(NOVEL_ID, draft.id);

    const reopened = new Database(dbPath, { readonly: true });
    const row = reopened
      .query("SELECT migrate_field, old_value, new_value, sequence, revision, status FROM character_migrations WHERE id = ?")
      .get(draft.id) as Record<string, unknown>;
    expect(row).toEqual({
      migrate_field: "personality",
      old_value: "热情",
      new_value: "谨慎",
      sequence: 1,
      revision: 2,
      status: "confirmed",
    });
    const snaps = reopened
      .query("SELECT COUNT(*) AS c FROM character_migration_versions WHERE migration_id = ?")
      .get(draft.id) as { c: number };
    expect(snaps.c).toBe(1);
    reopened.close();
  });
});

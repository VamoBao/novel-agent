import { describe, expect, test } from "bun:test";
import {
  characterEntrySchema,
  foreshadowEntrySchema,
  locationEntrySchema,
  novelDeletedResultSchema,
  novelDetailSchema,
  novelListItemSchema,
  outlineNodeEntrySchema,
  styleReferenceEntrySchema,
} from "./query";

const validListItem = {
  id: "0199c0de-0000-7000-8000-000000000001",
  name: "灵脉破晓",
  pinned: false,
  favorite: false,
  createdAt: "2026-09-20T10:00:00.000Z",
  updatedAt: "2026-09-20T12:00:00.000Z",
};

describe("小说详情的创作条件契约", () => {
  const emptyDetail = { novel: validListItem, worldview: null, characters: [], migrations: [], outlineNodes: [], documents: [], foreshadows: [], locations: [], styleReferences: [] };

  test("旧详情载荷缺少创作条件时补 null", () => {
    expect(novelDetailSchema.parse(emptyDetail).novel).toMatchObject({ genre: null, audience: null, coreConflict: null });
  });

  test("写作偏好三字段：旧载荷缺省补 null（未设置覆盖），携带时透传，非法值拒绝", () => {
    expect(novelDetailSchema.parse(emptyDetail).novel).toMatchObject({
      chapterLengthMin: null,
      chapterLengthMax: null,
      stylePassScore: null,
    });
    const prefs = { chapterLengthMin: 3000, chapterLengthMax: 4500, stylePassScore: 85 };
    expect(novelDetailSchema.parse({ ...emptyDetail, novel: { ...validListItem, ...prefs } }).novel).toMatchObject(prefs);
    expect(() =>
      novelDetailSchema.parse({ ...emptyDetail, novel: { ...validListItem, stylePassScore: 101 } }),
    ).toThrow();
  });

  test("详情保留结构化创作条件并允许空受众，非法形态拒绝", () => {
    const params = { genre: "科幻", audience: [], coreConflict: { origin: "资源枯竭", impact: "居民流离失所", idealResolution: "找到新的家园" } };
    expect(novelDetailSchema.parse({ ...emptyDetail, novel: { ...validListItem, ...params } }).novel).toMatchObject(params);
    expect(() => novelDetailSchema.parse({ ...emptyDetail, novel: { ...validListItem, audience: "错误" } })).toThrow();
    expect(() => novelDetailSchema.parse({ ...emptyDetail, novel: { ...validListItem, coreConflict: { origin: "不完整" } } })).toThrow();
  });
});

const validCharacter = {
  basicInfo: { name: "林澜" },
  core: { desire: "找到妹妹", fear: "失去同伴", narrativeRole: "主角" },
  background: "殖民城市长大的孤儿领航员",
  creationPurpose: "驱动主线冲突的核心视角",
  endingDirection: "公开真相并拯救城市",
};

const validOutlineNodes = [
  {
    id: "0199c0de-0000-7000-8000-0000000000a1",
    parentId: null,
    type: "part",
    name: "第一部·风起",
    sort: 1,
    summary: "少年觉醒",
    keyPlotPoints: null,
    characterIds: null,
  },
  {
    id: "0199c0de-0000-7000-8000-0000000000a2",
    parentId: "0199c0de-0000-7000-8000-0000000000a1",
    type: "act",
    name: "第一幕·开端",
    sort: 1,
    summary: "灵脉初现",
    keyPlotPoints: ["遭遇袭击", "觉醒"],
    characterIds: null,
  },
  {
    id: "0199c0de-0000-7000-8000-0000000000a3",
    parentId: "0199c0de-0000-7000-8000-0000000000a2",
    type: "chapter",
    name: "第一章·雨夜来客",
    sort: 1,
    summary: "雨夜遭遇袭击",
    keyPlotPoints: null,
    characterIds: ["0199c0de-0000-7000-8000-000000000002"],
  },
];

describe("novelListItemSchema", () => {
  test("完整列表项通过校验", () => {
    const item = novelListItemSchema.parse(validListItem);
    expect(item.name).toBe("灵脉破晓");
  });

  test("未命名小说 name 为 null 仍通过", () => {
    const item = novelListItemSchema.parse({ ...validListItem, name: null });
    expect(item.name).toBeNull();
  });

  test("置顶 / 收藏标记布尔解析", () => {
    const item = novelListItemSchema.parse({ ...validListItem, pinned: true, favorite: true });
    expect(item.pinned).toBeTrue();
    expect(item.favorite).toBeTrue();
  });

  test("缺少 pinned / favorite 被拒绝", () => {
    const { pinned: _p, favorite: _f, ...rest } = validListItem;
    expect(() => novelListItemSchema.parse(rest)).toThrow();
  });

  test("缺少 id 被拒绝", () => {
    const { id: _id, ...rest } = validListItem;
    expect(() => novelListItemSchema.parse(rest)).toThrow();
  });
});

describe("novelDeletedResultSchema", () => {
  test("deleted 结果通过校验", () => {
    const result = novelDeletedResultSchema.parse({
      deleted: "0199c0de-0000-7000-8000-000000000009",
    });
    expect(result.deleted).toBe("0199c0de-0000-7000-8000-000000000009");
  });

  test("空 deleted 被拒绝", () => {
    expect(() => novelDeletedResultSchema.parse({ deleted: "" })).toThrow();
  });
});

describe("characterEntrySchema", () => {
  test("角色卡平铺 id / version / updatedAt 后通过校验", () => {
    const entry = characterEntrySchema.parse({
      ...validCharacter,
      id: "0199c0de-0000-7000-8000-000000000002",
      version: 1,
      updatedAt: "2026-10-13T00:00:00.000Z",
    });
    expect(entry.basicInfo.name).toBe("林澜");
    expect(entry.version).toBe(1);
    expect(entry.updatedAt).toBe("2026-10-13T00:00:00.000Z");
  });

  test("缺少 id 的裸角色卡被拒绝", () => {
    expect(() => characterEntrySchema.parse(validCharacter)).toThrow();
  });

  test("缺少 version / version 为 0 被拒绝", () => {
    expect(() =>
      characterEntrySchema.parse({
        ...validCharacter,
        id: "0199c0de-0000-7000-8000-000000000002",
        updatedAt: "2026-10-13T00:00:00.000Z",
      }),
    ).toThrow();
    expect(() =>
      characterEntrySchema.parse({
        ...validCharacter,
        id: "0199c0de-0000-7000-8000-000000000002",
        version: 0,
        updatedAt: "2026-10-13T00:00:00.000Z",
      }),
    ).toThrow();
  });

  test("缺少 updatedAt 被拒绝（章卡陈旧提示依赖该字段）", () => {
    expect(() =>
      characterEntrySchema.parse({
        ...validCharacter,
        id: "0199c0de-0000-7000-8000-000000000002",
        version: 1,
      }),
    ).toThrow();
  });
});

describe("outlineNodeEntrySchema", () => {
  test("部节点（keyPlotPoints 为 null）与幕节点（含情节点）均通过", () => {
    const part = outlineNodeEntrySchema.parse(validOutlineNodes[0]);
    expect(part.type).toBe("part");
    expect(part.keyPlotPoints).toBeNull();
    const act = outlineNodeEntrySchema.parse(validOutlineNodes[1]);
    expect(act.keyPlotPoints).toHaveLength(2);
  });

  test("历史数据内容两列为 null 仍通过（空占位来源）", () => {
    const legacy = outlineNodeEntrySchema.parse({
      ...validOutlineNodes[1],
      summary: null,
      keyPlotPoints: null,
    });
    expect(legacy.summary).toBeNull();
    expect(legacy.keyPlotPoints).toBeNull();
  });

  test("缺 id / 空 name / 空情节点数组均被拒绝", () => {
    const { id: _id, ...withoutId } = validOutlineNodes[1] as Record<string, unknown>;
    expect(() => outlineNodeEntrySchema.parse(withoutId)).toThrow();
    expect(() =>
      outlineNodeEntrySchema.parse({ ...validOutlineNodes[1], name: "" }),
    ).toThrow();
    expect(() =>
      outlineNodeEntrySchema.parse({ ...validOutlineNodes[1], keyPlotPoints: [] }),
    ).toThrow();
  });
});

describe("novelDetailSchema", () => {
  const validDocuments = [
    {
      id: "0199c0de-0000-7000-8000-00000000000a",
      chapterId: "0199c0de-0000-7000-8000-00000000000b",
      filePath: "灵脉拾遗/第一部/第一章.md",
      wordCount: 22,
      updatedAt: "2026-09-28T00:00:00Z",
      content: "灵脉断绝的第九十九年，少年在市集的角落里睁开眼。",
    },
  ];

  test("三类结构数据与章节正文齐全的完整 detail 通过校验", () => {
    const detail = novelDetailSchema.parse({
      novel: validListItem,
      worldview: {
        background: { geography: "维斯特洛大陆" },
        taboos: ["不能出现现代科技物品"],
      },
      characters: [
        {
          ...validCharacter,
          id: "0199c0de-0000-7000-8000-000000000002",
          version: 3,
          updatedAt: "2026-10-13T00:00:00.000Z",
        },
      ],
      migrations: [],
      outlineNodes: validOutlineNodes,
      documents: validDocuments,
      foreshadows: [],
      locations: [],
      styleReferences: [],
    });
    expect(detail.characters).toHaveLength(1);
    expect(detail.outlineNodes).toHaveLength(3);
    expect(detail.outlineNodes[1]?.keyPlotPoints).toHaveLength(2);
    expect(detail.outlineNodes[2]?.characterIds).toEqual(["0199c0de-0000-7000-8000-000000000002"]);
    expect(detail.documents).toHaveLength(1);
    expect(detail.documents[0]?.chapterId).toBe("0199c0de-0000-7000-8000-00000000000b");
    expect(detail.documents[0]?.filePath).toBe("灵脉拾遗/第一部/第一章.md");
  });

  test("创作中途的小说：worldview 为 null、角色/大纲节点/正文为空数组仍通过", () => {
    const detail = novelDetailSchema.parse({
      novel: { ...validListItem, name: null },
      worldview: null,
      characters: [],
      migrations: [],
      outlineNodes: [],
      documents: [],
      foreshadows: [],
      locations: [],
      styleReferences: [],
    });
    expect(detail.worldview).toBeNull();
    expect(detail.outlineNodes).toHaveLength(0);
    expect(detail.documents).toHaveLength(0);
  });

  test("正文文件缺失：content 为 null 仍通过（客户端占位提示）", () => {
    const detail = novelDetailSchema.parse({
      novel: validListItem,
      worldview: null,
      characters: [],
      migrations: [],
      outlineNodes: [],
      documents: [{ ...validDocuments[0], content: null }],
      foreshadows: [],
      locations: [],
      styleReferences: [],
    });
    expect(detail.documents[0]?.content).toBeNull();
    expect(detail.documents[0]?.wordCount).toBe(22);
  });

  test("大纲节点条目非法（sort 为 0）被拒绝", () => {
    expect(() =>
      novelDetailSchema.parse({
        novel: validListItem,
        worldview: null,
        characters: [],
      migrations: [],
        outlineNodes: [{ ...validOutlineNodes[0], sort: 0 }],
        documents: [],
      }),
    ).toThrow();
  });

  test("正文条目非法（空 filePath / 负字数）被拒绝", () => {
    expect(() =>
      novelDetailSchema.parse({
        novel: validListItem,
        worldview: null,
        characters: [],
      migrations: [],
        outlineNodes: [],
        documents: [{ ...validDocuments[0], filePath: "" }],
      }),
    ).toThrow();
    expect(() =>
      novelDetailSchema.parse({
        novel: validListItem,
        worldview: null,
        characters: [],
      migrations: [],
        outlineNodes: [],
        documents: [{ ...validDocuments[0], wordCount: -1 }],
      }),
    ).toThrow();
  });
});

describe("foreshadowEntrySchema 与 novelDetail.foreshadows", () => {
  const entry = {
    id: "cccccccc-0000-7000-8000-000000000001",
    actNodeId: "act-1",
    recoverActNodeId: null,
    surfaceAction: "老周把主角派去北境送信",
    hiddenTruth: "暗示老周已经投敌",
    attentionLevel: 4,
    appearChapterId: "ch-1",
    recoverChapterIds: ["ch-9"],
    characterIds: ["char-1", "char-2"],
  };

  test("完整伏笔条目通过；recoveryStatus 缺省补 unrecovered", () => {
    const parsed = foreshadowEntrySchema.parse(entry);
    expect(parsed.recoveryStatus).toBe("unrecovered");
    expect(parsed.appearChapterId).toBe("ch-1");
  });

  test("actNodeId 值与 null 两态均合法（树分组依据）", () => {
    expect(foreshadowEntrySchema.parse({ ...entry, actNodeId: "act-1" }).actNodeId).toBe("act-1");
    expect(foreshadowEntrySchema.parse({ ...entry, actNodeId: null }).actNodeId).toBeNull();
  });

  test("recoverActNodeId 值与 null 两态均合法（回收规划依据；旧数据 null）", () => {
    expect(foreshadowEntrySchema.parse({ ...entry, recoverActNodeId: "act-9" }).recoverActNodeId).toBe("act-9");
    expect(foreshadowEntrySchema.parse({ ...entry, recoverActNodeId: null }).recoverActNodeId).toBeNull();
  });

  test("novelDetail 携带 foreshadows 数组通过契约校验", () => {
    const detail = novelDetailSchema.parse({
      novel: {
        id: "aaaaaaaa-0000-7000-8000-000000000001",
        name: "灵脉破晓",
        pinned: false,
        favorite: false,
        createdAt: "2026-10-07T00:00:00Z",
        updatedAt: "2026-10-07T00:00:00Z",
      },
      worldview: null,
      characters: [],
      migrations: [],
      outlineNodes: [],
      documents: [],
      foreshadows: [{ ...entry, recoveryStatus: "unrecovered" }],
      locations: [],
      styleReferences: [],
    });
    expect(detail.foreshadows).toHaveLength(1);
    expect(detail.foreshadows[0]?.characterIds).toEqual(["char-1", "char-2"]);
  });
});

describe("locationEntrySchema 与 novelDetail.locations", () => {
  test("自动入库形态（id + 名字 + 定位）通过；可选字段缺省不携带", () => {
    const parsed = locationEntrySchema.parse({
      id: "dddddddd-0000-7000-8000-000000000001",
      name: "青云城",
      description: "东部边境要塞·主角初战的战场",
    });
    expect(parsed.id).toBe("dddddddd-0000-7000-8000-000000000001");
    expect("x" in parsed).toBe(false);
  });

  test("全字段形态（旧地图数据）通过", () => {
    const parsed = locationEntrySchema.parse({
      id: "dddddddd-0000-7000-8000-000000000002",
      name: "北境大陆",
      x: 1.5,
      y: 2.5,
      layer: "地面",
      population: 3000,
    });
    expect(parsed.layer).toBe("地面");
  });

  test("缺 id / 空 name 被拒绝", () => {
    expect(() => locationEntrySchema.parse({ name: "青云城" })).toThrow();
    expect(() =>
      locationEntrySchema.parse({ id: "dddddddd-0000-7000-8000-000000000003", name: "" }),
    ).toThrow();
  });

  test("novelDetail 携带 locations 数组通过契约校验（结构树地点组取用）", () => {
    const detail = novelDetailSchema.parse({
      novel: {
        id: "aaaaaaaa-0000-7000-8000-000000000001",
        name: "灵脉破晓",
        pinned: false,
        favorite: false,
        createdAt: "2026-10-09T00:00:00Z",
        updatedAt: "2026-10-09T00:00:00Z",
      },
      worldview: null,
      characters: [],
      migrations: [],
      outlineNodes: [],
      documents: [],
      foreshadows: [],
      locations: [
        { id: "dddddddd-0000-7000-8000-000000000004", name: "青云城", description: "东部边境要塞" },
      ],
      styleReferences: [],
    });
    expect(detail.locations).toHaveLength(1);
    expect(detail.locations[0]?.name).toBe("青云城");
  });
});

describe("styleReferenceEntrySchema 与 novelDetail.styleReferences", () => {
  test("条目（id + 名字 + 内容 + 启用开关）通过校验；缺 id 或空内容被拒绝", () => {
    const entry = {
      id: "eeeeeeee-0000-7000-8000-000000000001",
      name: "江南式打斗",
      content: "刀光一闪，血溅三步。",
      enabled: true,
    };
    expect(styleReferenceEntrySchema.parse(entry).name).toBe("江南式打斗");
    expect(() => styleReferenceEntrySchema.parse({ ...entry, id: "" })).toThrow();
    expect(() => styleReferenceEntrySchema.parse({ ...entry, content: "" })).toThrow();
  });

  test("novelDetail 携带 styleReferences 数组通过契约校验（结构树文风组与正文注入取用）", () => {
    const detail = novelDetailSchema.parse({
      novel: {
        id: "aaaaaaaa-0000-7000-8000-000000000001",
        name: "灵脉破晓",
        pinned: false,
        favorite: false,
        createdAt: "2026-10-10T00:00:00Z",
        updatedAt: "2026-10-10T00:00:00Z",
      },
      worldview: null,
      characters: [],
      migrations: [],
      outlineNodes: [],
      documents: [],
      foreshadows: [],
      locations: [],
      styleReferences: [
        {
          id: "eeeeeeee-0000-7000-8000-000000000002",
          name: "张爱玲腔",
          content: "生命是一袭华美的袍。",
          enabled: false,
        },
      ],
    });
    expect(detail.styleReferences).toHaveLength(1);
    expect(detail.styleReferences[0]?.enabled).toBe(false);
  });
});

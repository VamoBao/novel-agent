import { describe, expect, test } from "bun:test";
import {
  characterEntrySchema,
  novelDeletedResultSchema,
  novelDetailSchema,
  novelListItemSchema,
  outlineNodeEntrySchema,
} from "./query";

const validListItem = {
  id: "0199c0de-0000-7000-8000-000000000001",
  name: "灵脉破晓",
  pinned: false,
  favorite: false,
  createdAt: "2026-09-20T10:00:00.000Z",
  updatedAt: "2026-09-20T12:00:00.000Z",
};

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
  },
  {
    id: "0199c0de-0000-7000-8000-0000000000a2",
    parentId: "0199c0de-0000-7000-8000-0000000000a1",
    type: "act",
    name: "第一幕·开端",
    sort: 1,
    summary: "灵脉初现",
    keyPlotPoints: ["遭遇袭击", "觉醒"],
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
  test("角色卡平铺 id 后通过校验", () => {
    const entry = characterEntrySchema.parse({
      ...validCharacter,
      id: "0199c0de-0000-7000-8000-000000000002",
    });
    expect(entry.basicInfo.name).toBe("林澜");
  });

  test("缺少 id 的裸角色卡被拒绝", () => {
    expect(() => characterEntrySchema.parse(validCharacter)).toThrow();
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
  test("三类数据齐全的完整 detail 通过校验", () => {
    const detail = novelDetailSchema.parse({
      novel: validListItem,
      worldview: {
        background: { geography: "维斯特洛大陆" },
        taboos: ["不能出现现代科技物品"],
      },
      characters: [{ ...validCharacter, id: "0199c0de-0000-7000-8000-000000000002" }],
      outlineNodes: validOutlineNodes,
    });
    expect(detail.characters).toHaveLength(1);
    expect(detail.outlineNodes).toHaveLength(2);
    expect(detail.outlineNodes[1]?.keyPlotPoints).toHaveLength(2);
  });

  test("创作中途的小说：worldview 为 null、角色与大纲节点为空数组仍通过", () => {
    const detail = novelDetailSchema.parse({
      novel: { ...validListItem, name: null },
      worldview: null,
      characters: [],
      outlineNodes: [],
    });
    expect(detail.worldview).toBeNull();
    expect(detail.outlineNodes).toHaveLength(0);
  });

  test("大纲节点条目非法（sort 为 0）被拒绝", () => {
    expect(() =>
      novelDetailSchema.parse({
        novel: validListItem,
        worldview: null,
        characters: [],
        outlineNodes: [{ ...validOutlineNodes[0], sort: 0 }],
      }),
    ).toThrow();
  });
});

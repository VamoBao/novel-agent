import { describe, expect, test } from "bun:test";
import { characterEntrySchema, novelDetailSchema, novelListItemSchema } from "./query";

const validListItem = {
  id: "0199c0de-0000-7000-8000-000000000001",
  name: "灵脉破晓",
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

const validOutline = {
  title: "灵脉破晓",
  logline: "废土少年觉醒灵脉重塑世界秩序",
  parts: [
    {
      name: "第一部·风起",
      summary: "少年觉醒",
      acts: [{ name: "第一幕·开端", summary: "灵脉初现", keyPlotPoints: ["遭遇袭击", "觉醒"] }],
    },
  ],
};

describe("novelListItemSchema", () => {
  test("完整列表项通过校验", () => {
    const item = novelListItemSchema.parse(validListItem);
    expect(item.name).toBe("灵脉破晓");
  });

  test("未命名小说 name 为 null 仍通过", () => {
    const item = novelListItemSchema.parse({ ...validListItem, name: null });
    expect(item.name).toBeNull();
  });

  test("缺少 id 被拒绝", () => {
    const { id: _id, ...rest } = validListItem;
    expect(() => novelListItemSchema.parse(rest)).toThrow();
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

describe("novelDetailSchema", () => {
  test("三类数据齐全的完整 detail 通过校验", () => {
    const detail = novelDetailSchema.parse({
      novel: validListItem,
      worldview: {
        background: { geography: "维斯特洛大陆" },
        taboos: ["不能出现现代科技物品"],
      },
      characters: [{ ...validCharacter, id: "0199c0de-0000-7000-8000-000000000002" }],
      outline: validOutline,
    });
    expect(detail.characters).toHaveLength(1);
    expect(detail.outline?.parts[0]?.acts[0]?.keyPlotPoints).toHaveLength(2);
  });

  test("创作中途的小说：worldview / outline 为 null、角色为空数组仍通过", () => {
    const detail = novelDetailSchema.parse({
      novel: { ...validListItem, name: null },
      worldview: null,
      characters: [],
      outline: null,
    });
    expect(detail.worldview).toBeNull();
    expect(detail.outline).toBeNull();
  });

  test("outline 结构不完整（缺 acts）被拒绝", () => {
    expect(() =>
      novelDetailSchema.parse({
        novel: validListItem,
        worldview: null,
        characters: [],
        outline: { ...validOutline, parts: [{ name: "第一部", summary: "少年觉醒" }] },
      }),
    ).toThrow();
  });
});

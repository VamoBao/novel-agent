import { describe, expect, test } from "bun:test";
import {
  assembleCharacter,
  FIELD_NAMES,
  FIELD_SPECS,
  missingRequiredFields,
} from "./character-agent";

const completeRecord = {
  name: "陈默",
  gender: "男",
  appearance: "粗布短打，掌心厚茧",
  desire: "让散修不再仰人鼻息",
  fear: "辜负同门期待",
  narrativeRole: "主角",
  background: "青云市集捡拾妖兽材料的散修少年",
  personality: "坚韧寡言",
  characterGoal: "建立散修联盟",
  creationPurpose: "承载打破资源垄断的主线",
  trajectory: "散修 → 卷轴持有者 → 联盟开创者",
  endingDirection: "联合各方打破宗门垄断",
  relationships: "与柳三是搭档；与玄岳宗执事敌对",
};

describe("FIELD_SPECS", () => {
  test("每个字段都有规格定义，必填集与 schema 必填一致", () => {
    expect(FIELD_NAMES.every((f) => FIELD_SPECS[f].label.length > 0)).toBe(true);
    expect(missingRequiredFields({})).toEqual([
      "姓名",
      "核心渴望",
      "核心恐惧",
      "叙事定位",
      "背景",
      "创作目的",
      "结局方向",
    ]);
  });
});

describe("missingRequiredFields", () => {
  test("已填必填项不再出现在缺失列表", () => {
    const partial = { name: "甲", desire: "变强", fear: "失败", narrativeRole: "配角" };
    expect(missingRequiredFields(partial)).toEqual(["背景", "创作目的", "结局方向"]);
  });
});

describe("assembleCharacter", () => {
  test("完整记录组装为角色卡且通过 schema 校验", () => {
    const c = assembleCharacter(completeRecord);
    expect(c.basicInfo.name).toBe("陈默");
    expect(c.core.narrativeRole).toBe("主角");
    expect(c.endingDirection).toContain("垄断");
  });

  test("缺必填记录组装被 schema 拒绝", () => {
    expect(() => assembleCharacter({ name: "无名" })).toThrow();
  });

  test("可选字段缺省时组装仍通过", () => {
    const c = assembleCharacter({
      name: "灰袍人",
      desire: "夺回神器",
      fear: "身份暴露",
      narrativeRole: "反派",
      background: "前朝国师",
      creationPurpose: "逼迫主角觉醒",
      endingDirection: "被主角击败",
    });
    expect(c.personality).toBeUndefined();
    expect(c.basicInfo.gender).toBeUndefined();
  });
});

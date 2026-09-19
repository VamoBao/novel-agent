import { describe, expect, test } from "bun:test";
import { FakeChannel } from "./fake-channel";
import { UserAbortedError } from "./aborted";

describe("FakeChannel", () => {
  test("应答按 FIFO 顺序消耗并记录调用", async () => {
    const channel = new FakeChannel(["张三", true, 3]);
    expect(await channel.askText("姓名？")).toBe("张三");
    expect(await channel.askConfirm("确认？")).toBe(true);
    expect(await channel.askInt("数量？", { min: 1, max: 5, default: 1 })).toBe(3);
    expect(channel.calls.map((c) => c.method)).toEqual(["askText", "askConfirm", "askInt"]);
  });

  test("null 应答：askLine 得 null，其余抛 UserAbortedError", async () => {
    const line = new FakeChannel([null]);
    expect(await line.askLine("问？")).toBeNull();
    const text = new FakeChannel([null]);
    await expect(text.askText("问？")).rejects.toBeInstanceOf(UserAbortedError);
  });

  test("脚本耗尽抛错而非静默挂起", async () => {
    const channel = new FakeChannel([]);
    await expect(channel.askText("问？")).rejects.toThrow("应答脚本耗尽");
  });

  test("类型不匹配抛错", async () => {
    const channel = new FakeChannel([true]);
    await expect(channel.askText("问？")).rejects.toThrow("期望 string");
  });

  test("askInt 范围校验", async () => {
    const channel = new FakeChannel([99]);
    await expect(channel.askInt("数量？", { min: 1, max: 5, default: 1 })).rejects.toThrow(
      "超出范围",
    );
  });

  test("askSelect / askMultiSelect 校验选项归属", async () => {
    const channel = new FakeChannel(["乙", ["甲", "乙"]]);
    expect(await channel.askSelect("单选", ["甲", "乙"])).toBe("乙");
    expect(await channel.askMultiSelect("多选", ["甲", "乙"])).toEqual(["甲", "乙"]);
    const bad = new FakeChannel(["丙"]);
    await expect(bad.askSelect("单选", ["甲", "乙"])).rejects.toThrow("不在选项内");
  });

  test("notify / present / 确认视图均被记录", async () => {
    const channel = new FakeChannel([true]);
    channel.notify("进度");
    channel.present({
      kind: "worldview",
      worldview: { background: { geography: "九州" }, taboos: ["不可出现现代科技"] },
    });
    await channel.askConfirm("确认？", {
      view: { kind: "field-summary", label: "姓名", summary: "张三" },
    });
    expect(channel.notifies).toEqual(["进度"]);
    expect(channel.views.map((v) => v.kind)).toEqual(["worldview", "field-summary"]);
  });
});

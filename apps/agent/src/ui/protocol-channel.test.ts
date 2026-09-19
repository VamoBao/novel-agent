import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@novel/shared";
import { UserAbortedError } from "./aborted";
import { ProtocolChannel } from "./protocol-channel";

/** 出站消息收集器 + 按应答 id 回注 */
function harness() {
  const messages: AgentMessage[] = [];
  const channel = new ProtocolChannel((message) => messages.push(message));
  const respond = (id: number, answer: unknown): void => {
    channel.handleLine(JSON.stringify({ type: "response", id, answer }));
  };
  const requests = () => messages.filter((m): m is Extract<AgentMessage, { type: "request" }> => m.type === "request");
  return { messages, channel, respond, requests };
}

describe("ProtocolChannel", () => {
  test("askText：空应答（非 optional）重问，新 request 用新 id", async () => {
    const { channel, respond, requests } = harness();
    const promise = channel.askText("问");
    expect(requests()).toHaveLength(1);
    expect(requests()[0]).toMatchObject({ id: 1, ask: { type: "text", optional: false } });
    respond(1, "");
    respond(2, "答");
    await expect(promise).resolves.toBe("答");
    expect(requests()).toHaveLength(2);
    expect(requests()[1]).toMatchObject({ id: 2 });
  });

  test("askText optional：空串直接结算", async () => {
    const { channel, respond } = harness();
    const promise = channel.askText("问", { optional: true });
    respond(1, "");
    await expect(promise).resolves.toBe("");
  });

  test("askLine：字符串与空串均合法，类型不符重问", async () => {
    const a = harness();
    const pa = a.channel.askLine("问");
    a.respond(1, "答");
    await expect(pa).resolves.toBe("答");

    const b = harness();
    const pb = b.channel.askLine("问");
    b.respond(1, 42);
    b.respond(2, "");
    await expect(pb).resolves.toBe("");
    expect(b.requests()).toHaveLength(2);
  });

  test("askConfirm：view 随请求携带，boolean 应答结算", async () => {
    const { channel, respond, requests } = harness();
    const promise = channel.askConfirm("确认？", {
      default: true,
      view: { kind: "field-summary", label: "姓名", summary: "张三" },
    });
    expect(requests()[0]).toMatchObject({
      ask: {
        type: "confirm",
        default: true,
        view: { kind: "field-summary", label: "姓名" },
      },
    });
    respond(1, true);
    await expect(promise).resolves.toBe(true);
  });

  test("askInt / askSelect / askMultiSelect：越界与不属选项均重问", async () => {
    const a = harness();
    const pa = a.channel.askInt("数", { min: 3, max: 20, default: 5 });
    a.respond(1, 99);
    a.respond(2, 5);
    await expect(pa).resolves.toBe(5);

    const b = harness();
    const pb = b.channel.askSelect("选", ["甲", "乙"]);
    b.respond(1, "丙");
    b.respond(2, "乙");
    await expect(pb).resolves.toBe("乙");

    const c = harness();
    const pc = c.channel.askMultiSelect("多选", ["甲", "乙", "丙"]);
    c.respond(1, ["甲", "丁"]);
    c.respond(2, ["丙", "甲", "丙"]);
    await expect(pc).resolves.toEqual(["丙", "甲"]);
  });

  test("并发提问：id 隔离，乱序应答正确结算", async () => {
    const { channel, respond, requests } = harness();
    const p1 = channel.askText("问题一");
    const p2 = channel.askConfirm("问题二");
    expect(requests().map((r) => r.id)).toEqual([1, 2]);
    respond(2, true);
    respond(1, "答一");
    await expect(p1).resolves.toBe("答一");
    await expect(p2).resolves.toBe(true);
  });

  test("abort：挂起的 line 结算 null、其余抛 UserAbortedError；此后新提问同语义", async () => {
    const { channel } = harness();
    const line = channel.askLine("行");
    const text = channel.askText("文");
    // 用 then/catch 同步挂处理器：reject 发生在 abort() 内，
    // 依赖 Bun expect 匹配器的挂载时机会误判未处理拒绝
    const lineSettled = line.then((value) => value);
    const textError = text.catch((error: unknown) => error);
    channel.abort();
    expect(await lineSettled).toBeNull();
    expect(await textError).toBeInstanceOf(UserAbortedError);
    await expect(channel.askLine("行2")).resolves.toBeNull();
    await expect(channel.askText("文2")).rejects.toBeInstanceOf(UserAbortedError);
  });

  test("notify / stage / present 出站消息", () => {
    const { channel, messages } = harness();
    channel.notify("进度");
    channel.stage("worldview");
    channel.present({
      kind: "conflict",
      conflict: { origin: "a", impact: "b", idealResolution: "c" },
    });
    expect(messages).toEqual([
      { type: "notify", text: "进度" },
      { type: "stage", stage: "worldview" },
      {
        type: "view",
        view: { kind: "conflict", conflict: { origin: "a", impact: "b", idealResolution: "c" } },
      },
    ]);
  });

  test("协议 fail-fast：非法 JSON / 不合 schema / 未知 id 均抛错", () => {
    const { channel, respond } = harness();
    expect(() => channel.handleLine("not-json")).toThrow("合法 JSON");
    expect(() => channel.handleLine(JSON.stringify({ type: "response", id: 1, answer: {} }))).toThrow(
      "不合法",
    );
    void channel.askText("问");
    expect(() => respond(99, "答")).toThrow("未知 request id");
  });
});

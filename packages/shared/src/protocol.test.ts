import { describe, expect, test } from "bun:test";
import {
  agentMessageSchema,
  clientMessageSchema,
  askSchema,
  stageSchema,
} from "./protocol";

describe("protocol schemas", () => {
  test("stage 枚举", () => {
    expect(stageSchema.parse("type")).toBe("type");
    expect(stageSchema.safeParse("unknown").success).toBe(false);
  });

  test("ask 六类提问载荷解析", () => {
    expect(askSchema.parse({ type: "line", prompt: "问" })).toMatchObject({ type: "line" });
    expect(askSchema.parse({ type: "text", prompt: "问", optional: true })).toMatchObject({
      optional: true,
    });
    expect(
      askSchema.parse({ type: "select", prompt: "问", options: ["甲", "乙"], allowCustom: false }),
    ).toMatchObject({ options: ["甲", "乙"] });
    expect(askSchema.parse({ type: "multi", prompt: "问", options: ["甲"] })).toMatchObject({
      type: "multi",
    });
    expect(
      askSchema.parse({
        type: "confirm",
        prompt: "问",
        default: true,
        view: { kind: "field-summary", label: "姓名", summary: "张三" },
      }),
    ).toMatchObject({ view: { kind: "field-summary" } });
    expect(
      askSchema.parse({ type: "int", prompt: "问", min: 3, max: 20, default: 5 }),
    ).toMatchObject({ default: 5 });
    expect(askSchema.safeParse({ type: "text", prompt: "问" }).success).toBe(false);
  });

  test("agent 消息：hello / stage / notify / view / request / run_finished / error", () => {
    expect(
      agentMessageSchema.parse({
        type: "hello",
        protoVersion: 1,
        dbPath: "/abs/novel.db",
        outputDir: "/abs/output",
      }),
    ).toMatchObject({ protoVersion: 1 });
    expect(agentMessageSchema.parse({ type: "stage", stage: "outline" })).toMatchObject({
      stage: "outline",
    });
    expect(agentMessageSchema.parse({ type: "notify", text: "进度" })).toMatchObject({
      text: "进度",
    });
    expect(
      agentMessageSchema.parse({
        type: "view",
        view: { kind: "worldview", worldview: { background: { geography: "九州" }, taboos: ["x"] } },
      }),
    ).toMatchObject({ view: { kind: "worldview" } });
    expect(
      agentMessageSchema.parse({ type: "request", id: 3, ask: { type: "confirm", prompt: "p", default: true } }),
    ).toMatchObject({ id: 3 });
    expect(
      agentMessageSchema.parse({ type: "run_finished", novelId: "n1", outputPath: "/abs/out.json" }),
    ).toMatchObject({ novelId: "n1" });
    expect(agentMessageSchema.parse({ type: "error", message: "x", fatal: true })).toMatchObject({
      fatal: true,
    });
    expect(agentMessageSchema.safeParse({ type: "hello", protoVersion: 1 }).success).toBe(false);
  });

  test("client 消息：response 四种 answer 类型", () => {
    for (const answer of ["文本", ["甲", "乙"], true, 5]) {
      expect(clientMessageSchema.parse({ type: "response", id: 1, answer })).toMatchObject({
        id: 1,
      });
    }
    expect(clientMessageSchema.safeParse({ type: "response", id: 1, answer: { x: 1 } }).success).toBe(
      false,
    );
    expect(clientMessageSchema.safeParse({ type: "cancel" }).success).toBe(false);
  });
});

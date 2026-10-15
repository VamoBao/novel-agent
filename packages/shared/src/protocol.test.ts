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
    expect(stageSchema.parse("pov")).toBe("pov");
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
    expect(
      agentMessageSchema.parse({
        type: "polish-result",
        character: {
          basicInfo: { name: "林澜", gender: "女" },
          core: { desire: "找到妹妹", fear: "失去同伴", narrativeRole: "主角" },
          background: "殖民城市长大的孤儿领航员",
          creationPurpose: "驱动主线冲突的核心视角",
          endingDirection: "公开真相并拯救城市",
          personality: "外冷内热",
        },
      }),
    ).toMatchObject({ type: "polish-result" });
    // 角色卡缺必填字段（core）的润色结果被拒绝
    expect(
      agentMessageSchema.safeParse({
        type: "polish-result",
        character: { basicInfo: { name: "林澜" } },
      }).success,
    ).toBe(false);
    expect(agentMessageSchema.parse({ type: "error", message: "x", fatal: true })).toMatchObject({
      fatal: true,
    });
    expect(agentMessageSchema.safeParse({ type: "hello", protoVersion: 1 }).success).toBe(false);
  });

  test("agent 消息：write-progress 正文生成流程进度（report 可选）", () => {
    const base = { type: "write-progress", chapterNodeId: "ch1", round: 1, totalRounds: 3 };
    for (const phase of [
      "drafting",
      "revising",
      "review-content",
      "review-style",
      "review-consistency",
      "saving",
    ]) {
      expect(agentMessageSchema.parse({ ...base, phase })).toMatchObject({ phase });
    }
    expect(agentMessageSchema.safeParse({ ...base, phase: "unknown" }).success).toBe(false);
    // 无 report（阶段事件）合法
    expect(
      agentMessageSchema.parse({ ...base, phase: "drafting" }),
    ).toMatchObject({ round: 1 });
    // 携带报告合法（三段校验完成）
    const withReport = {
      ...base,
      phase: "review-consistency",
      report: {
        round: 1,
        passed: false,
        content: { issues: [] },
        style: { skipped: false, score: 82, rationale: "偏短促", suggestions: ["增加环境描写"] },
        consistency: {
          issues: [{ kind: "consistency", description: "前后矛盾", suggestion: "统一" }],
        },
      },
    };
    expect(agentMessageSchema.parse(withReport)).toMatchObject({ report: { round: 1 } });
    expect(agentMessageSchema.parse({
      ...base,
      phase: "review-content",
      stageResult: { phase: "review-content", result: { issues: [] } },
    })).toMatchObject({ stageResult: { phase: "review-content" } });
    expect(agentMessageSchema.safeParse({
      ...base,
      phase: "review-style",
      stageResult: { phase: "review-style", result: { skipped: false, score: 101 } },
    }).success).toBe(false);
    // report 缺必填段（style）拒绝
    expect(
      agentMessageSchema.safeParse({
        ...withReport,
        report: { round: 1, passed: false, content: { issues: [] }, consistency: { issues: [] } },
      }).success,
    ).toBe(false);
    // chapterNodeId / round 缺失拒绝
    expect(agentMessageSchema.safeParse({ type: "write-progress", round: 1, totalRounds: 3, phase: "drafting" }).success).toBe(false);
    expect(agentMessageSchema.safeParse({ type: "write-progress", chapterNodeId: "ch1", round: 0, totalRounds: 3, phase: "drafting" }).success).toBe(false);
  });

  test("write-progress 保留生效文风阈值，兼容旧消息并拒绝非法阈值", () => {
    const base = { type: "write-progress", chapterNodeId: "ch1", round: 1, totalRounds: 3, phase: "review-style" };
    for (const stylePassScore of [0, 80, 95, 100]) {
      expect(agentMessageSchema.parse({ ...base, stylePassScore })).toMatchObject({ stylePassScore });
    }
    expect(agentMessageSchema.safeParse(base).success).toBe(true);
    for (const stylePassScore of [-1, 101, 80.5]) {
      expect(agentMessageSchema.safeParse({ ...base, stylePassScore }).success).toBe(false);
    }
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

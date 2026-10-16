import { describe, expect, mock, test } from "bun:test";
import { modelMessageSchema } from "ai";
import type { ChapterPlanSubmission, PlanChaptersInput } from "./agents/chapter-agent";
import { FakeChannel } from "../ui/fake-channel";
import { UserAbortedError } from "../ui/aborted";

const sdkModelMessageSchema = modelMessageSchema;
let calls: unknown[][] = [];
let results: unknown[] = [];
type MockTool = { execute: (input: never, options: unknown) => Promise<unknown> };
mock.module("ai", () => ({
  modelMessageSchema: sdkModelMessageSchema,
  tool: (value: unknown) => value,
  hasToolCall: () => () => false,
  stepCountIs: () => () => false,
  generateText: async ({ tools }: { tools: Record<string, MockTool> }) => {
    const script = calls.shift();
    if (!script) throw new Error("不应调用额外模型");
    for (const args of script) results.push(await tools.save_foreshadow_recoveries!.execute(args as never, {}));
    return { text: "", steps: [{}], finishReason: "tool-calls", response: { messages: [] } };
  },
}));
const { refineForeshadowRecoveries } = await import("./foreshadow-refinement");

const input: PlanChaptersInput & { fullOutline: NonNullable<PlanChaptersInput["fullOutline"]> } = {
  novelTitle: "细化测试", logline: "确认之后补回收章", partName: "上部", partSummary: "起因",
  actName: "A幕", actSummary: "埋设线索", keyPlotPoints: ["留下信物"],
  fullOutline: [
    { id: "A", partName: "上部", name: "A幕", summary: "埋设线索", keyPlotPoints: [],
      chapters: [{ id: "a1", name: "埋设", summary: "种下伏笔" }] },
    { id: "B", partName: "下部", name: "B幕", summary: "逐步揭晓", keyPlotPoints: [],
      chapters: [{ id: "b1", name: "解读", summary: "开始解读" }, { id: "b2", name: "揭晓", summary: "核心真相" }] },
    { id: "C", partName: "下部", name: "C幕", summary: "更后面的未规划幕", keyPlotPoints: [], chapters: [] },
  ],
};
const submission: ChapterPlanSubmission = {
  plan: { chapters: [{ name: "埋设", summary: "留下信物", characters: [{ name: "林恒", role: "主角" }] }] },
  newForeshadows: [
    { surfaceAction: "信物", hiddenTruth: "王族血亲", attentionLevel: 8, characterNames: ["林恒"], chapterName: "埋设",
      recoveryPlan: [{ actName: "B幕", chapterNames: [] }] },
    { surfaceAction: "遗书", hiddenTruth: "失踪者尚在人间", attentionLevel: 6, characterNames: ["林恒"], chapterName: "埋设",
      recoveryPlan: [{ actName: "B幕", chapterNames: [] }, { actName: "C幕", chapterNames: [] }] },
  ],
  newLocations: [], foreshadowBindings: [], foreshadowRecoverBindings: [],
};
const valid = { recoveries: [
  { foreshadowIndex: 1, actName: "B幕", chapterNames: ["解读"] },
  { foreshadowIndex: 2, actName: "B幕", chapterNames: ["揭晓"] },
] };

describe("已确认伏笔回收细化", () => {
  test("无规划漂移时直接复用，零模型与零确认", async () => {
    calls = [];
    const unchanged = { ...input, fullOutline: input.fullOutline.map((act) => act.id === "B" ? { ...act, chapters: [] } : act) };
    const channel = new FakeChannel([]);
    expect(await refineForeshadowRecoveries(unchanged, submission, channel)).toBe(submission.newForeshadows);
    expect(channel.calls).toEqual([]);
  });

  test("只能完整选择固定清单的已有真实章，非法和越权输出不进确认门，拒绝后只修订选择", async () => {
    const before = structuredClone(submission);
    const invalid = [
      { recoveries: valid.recoveries.slice(0, 1) },
      { recoveries: [...valid.recoveries, valid.recoveries[0]] },
      { recoveries: [{ ...valid.recoveries[0], foreshadowIndex: 9 }, valid.recoveries[1]] },
      { recoveries: [{ ...valid.recoveries[0], chapterNames: ["虚构章"] }, valid.recoveries[1]] },
      { recoveries: [{ ...valid.recoveries[0], actName: "A幕", chapterNames: ["埋设"] }, valid.recoveries[1]] },
      { recoveries: [{ ...valid.recoveries[0], chapterNames: ["解读", "解读"] }, valid.recoveries[1]] },
      { ...valid, newForeshadows: [] },
      { recoveries: [{ ...valid.recoveries[0], hiddenTruth: "越权改写" }, valid.recoveries[1]] },
    ];
    calls = [[...invalid, valid, { recoveries: valid.recoveries.map((entry) => ({ ...entry, chapterNames: ["揭晓"] })) }]];
    results = [];
    const channel = new FakeChannel([false, "都改到揭晓", true]);
    const refined = await refineForeshadowRecoveries(input, submission, channel);
    expect(results.slice(0, invalid.length).every((value) => (value as { ok: boolean }).ok === false)).toBe(true);
    expect(channel.calls.map((call) => call.method)).toEqual(["askConfirm", "askText", "askConfirm"]);
    expect(submission).toEqual(before);
    expect(refined).toEqual(before.newForeshadows.map((item) => ({ ...item,
      recoveryPlan: item.recoveryPlan.map((point) => point.actName === "B幕" ? { ...point, chapterNames: ["揭晓"] } : point),
    })));
  });

  test("细化确认通道中止，保留原确认产物并抛中止异常", async () => {
    calls = [[valid]];
    const before = structuredClone(submission);
    await expect(refineForeshadowRecoveries(input, submission, new FakeChannel([null]))).rejects.toBeInstanceOf(UserAbortedError);
    expect(submission).toEqual(before);
  });
});

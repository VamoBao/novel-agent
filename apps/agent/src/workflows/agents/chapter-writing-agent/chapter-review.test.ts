import { modelMessageSchema, type ModelMessage } from "ai";
import { describe, expect, mock, test } from "bun:test";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { DEFAULT_STYLE_PASS_SCORE, type ReviewIssue } from "@novel/shared";

type ReviewCall = {
  model: unknown;
  system?: string;
  prompt?: string;
  messages?: ModelMessage[];
  schema: { parse: (value: unknown) => unknown };
};
let calls: ReviewCall[] = [];
let scriptedResults: unknown[] = [];
const sdkModelMessageSchema = modelMessageSchema;
mock.module("ai", () => ({
  modelMessageSchema: sdkModelMessageSchema,
  tool: (spec: unknown) => spec,
  generateText: async () => { throw new Error("校验模块不应调用 generateText"); },
  generateObject: async (args: ReviewCall) => {
    calls.push(args);
    const value = scriptedResults.shift();
    if (value instanceof Error) throw value;
    return { object: args.schema.parse(value) };
  },
}));
const { reviewChapter, isReportPassing, formatRevisionBlock } = await import("./chapter-review");
const DUMMY_MODEL = { modelId: "dummy-review-model" } as unknown as LanguageModelV4;
const CONTENT_ISSUES: { issues: ReviewIssue[] } = {
  issues: [{ kind: "worldview", description: "正文出现高铁", suggestion: "改为马车" }],
};
const CONSISTENCY_ISSUES: { issues: ReviewIssue[] } = {
  issues: [{ kind: "consistency", description: "前文五个字后文四个字", suggestion: "统一为五个字" }],
};
function result(issues: unknown[] = [], styleRating: number | null = null, rationale = "检查完成") {
  return { styleRating, issues, rationale };
}
function baseInput(overrides: Partial<Parameters<typeof reviewChapter>[0]> = {}) {
  return {
    novelId: "n1", chapterName: "第一章", summary: "少年拾得碎片",
    worldview: { background: { geography: "九州大陆，灵脉断绝" }, taboos: ["不可出现现代科技"] },
    foreshadowLines: ["隐藏真相：碎片是密钥", "回收阶段：最终回收"],
    characterLines: ["林恒：主角；性格迁移：热情→谨慎（进行中）"],
    styleSamples: [{ name: "江南式打斗", content: "刀光一闪。" }],
    stylePassScore: DEFAULT_STYLE_PASS_SCORE, content: "　　正文全文。", round: 1,
    ...overrides,
  };
}
function reset(results: unknown[] = [result(), result([], 92), result()]) {
  calls = []; scriptedResults = [...results];
}
function payload(call: ReviewCall) { return JSON.stringify(call.messages ?? call.prompt); }
function task(call: ReviewCall) {
  const content = call.messages?.at(-1)?.content;
  if (typeof content !== "string") throw new Error("缺少独立审校任务消息");
  return content;
}

describe("reviewChapter 共享前缀", () => {
  test("三次独立请求共用完整资料前缀、固定 schema 和 Claude 资料断点，仅任务尾部不同", async () => {
    reset([result(CONTENT_ISSUES.issues), result([], 82, "句式偏短促"), result(CONSISTENCY_ISSUES.issues)]);
    const report = await reviewChapter(baseInput(), { reviewModel: DUMMY_MODEL });
    expect(calls).toHaveLength(3);
    const [content, style, consistency] = calls as [ReviewCall, ReviewCall, ReviewCall];
    expect(content.system).toBeTruthy();
    for (const call of calls) {
      expect(call.model).toBe(DUMMY_MODEL);
      expect(call.prompt).toBeUndefined();
      expect(call.system).toBe(content.system);
      expect(call.schema).toBe(content.schema);
      expect(call.messages).toHaveLength(2);
      expect(call.messages![0]).toEqual(content.messages![0]!);
      expect(payload(call)).toContain("九州大陆，灵脉断绝");
      expect(payload(call)).toContain("第一章：少年拾得碎片");
      expect(payload(call)).toContain("碎片是密钥");
      expect(payload(call)).toContain("热情→谨慎");
      expect(payload(call)).toContain("刀光一闪。");
      expect(payload(call)).toContain("　　正文全文。");
      expect(payload(call).split("　　正文全文。")).toHaveLength(2);
      expect(payload(call)).not.toContain("正文出现高铁");
    }
    expect(content.messages![0]).toMatchObject({ role: "user", content: [{ type: "text",
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } }] });
    expect(task(content)).toContain("设定审校编辑");
    expect(task(style)).toContain("文风比对评审");
    expect(task(consistency)).toContain("内部自洽审校");
    expect(task(consistency)).toContain("不需要对照任何外部资料");
    expect(report.content).toEqual(CONTENT_ISSUES);
    expect(report.style).toEqual({ skipped: false, score: 82, rationale: "句式偏短促", suggestions: [] });
    expect(report.consistency).toEqual(CONSISTENCY_ISSUES);
    expect(report.passed).toBeFalse();
  });

  test("最终回收与角色迁移的专项约束继续传给内容审校", async () => {
    reset();
    await reviewChapter(baseInput(), { reviewModel: DUMMY_MODEL });
    const contentTask = task(calls[0]!);
    expect(contentTask).toContain("未完整揭露真相");
    expect(contentTask).toContain("未解释表面行为与真相的联系");
    expect(contentTask).toContain("阶段回收不得提前完整揭露真相");
    expect(contentTask).toContain("最终收尾要求优先于概述中推迟揭露或继续悬置的描述");
    expect(contentTask).toContain("不得仅因落实最终收尾而报告 summary 问题");
    expect(contentTask).toContain("4. character——角色变化是否符合");
  });

  test("不同文风阈值只改变末尾任务，schema 与共享前缀均保持稳定", async () => {
    reset();
    await reviewChapter(baseInput(), { reviewModel: DUMMY_MODEL });
    const first = calls[1]!;
    reset();
    const report = await reviewChapter(baseInput({ stylePassScore: 95 }), { reviewModel: DUMMY_MODEL });
    expect(calls[1]!.schema).toBe(first.schema);
    expect(calls[1]!.messages![0]).toEqual(first.messages![0]!);
    expect(task(calls[1]!)).toContain("95 分及以上为合格");
    expect(report.passed).toBeFalse();
  });

  test("无文风样本跳过调用，保留 skipped 与进度事件", async () => {
    reset([result(), result()]);
    const events: unknown[] = [];
    const report = await reviewChapter(baseInput({ styleSamples: [] }), {
      reviewModel: DUMMY_MODEL, onProgress: (phase, stage) => events.push(stage ?? phase),
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.messages![0]).toEqual(calls[1]!.messages![0]!);
    expect(report.style).toEqual({ skipped: true });
    expect(report.passed).toBeTrue();
    expect(events).toContainEqual({ phase: "review-style", result: { skipped: true } });
  });

  test("文风问题转换为现有修订建议，三段报告即时回传", async () => {
    reset([result(), result([{ kind: "style", description: "句式过长", suggestion: "缩短动作句" }], 70, "节奏不符"), result()]);
    const phases: string[] = [];
    const stages: unknown[] = [];
    const report = await reviewChapter(baseInput(), { reviewModel: DUMMY_MODEL,
      onProgress: (phase, stage) => { phases.push(phase); if (stage) stages.push(stage); },
    });
    expect(phases).toEqual(["review-content", "review-content", "review-style", "review-style", "review-consistency", "review-consistency"]);
    expect(stages).toHaveLength(3);
    expect(report.style).toEqual({ skipped: false, score: 70, rationale: "节奏不符", suggestions: ["句式过长：缩短动作句"] });
    expect(formatRevisionBlock(report)).toContain("缩短动作句");
    expect(report.passed).toBeFalse();
  });

  test.each([
    ["文风评分缺失", [result(), result()]],
    ["文风评分越界", [result(), result([], 101)]],
    ["文风评分非整数", [result(), result([], 80.5)]],
    ["内容问题类别漂移", [result([{ kind: "consistency", description: "矛盾", suggestion: "统一" }])]],
    ["自洽问题类别漂移", [result(), result([], 92), result(CONTENT_ISSUES.issues)]],
    ["报告缺少问题清单", [{ styleRating: null, rationale: "完成" }]],
  ])("%s 不得被静默当作通过", async (_name, results) => {
    reset(results as unknown[]);
    await expect(reviewChapter(baseInput(), { reviewModel: DUMMY_MODEL })).rejects.toThrow();
  });

  test("新稿重新建立公共正文前缀，不携带旧稿或上轮报告", async () => {
    reset();
    await reviewChapter(baseInput(), { reviewModel: DUMMY_MODEL });
    const first = calls[0]!;
    reset();
    await reviewChapter(baseInput({ content: "修订后的正文。", round: 2 }), { reviewModel: DUMMY_MODEL });
    expect(calls[0]!.schema).toBe(first.schema);
    expect(calls[0]!.system).toBe(first.system);
    expect(payload(calls[0]!)).toContain("修订后的正文。");
    expect(payload(calls[0]!)).not.toContain("　　正文全文。");
  });

  test("校验异常直接透传", async () => {
    reset([new Error("模型请求失败")]);
    await expect(reviewChapter(baseInput(), { reviewModel: DUMMY_MODEL })).rejects.toThrow("模型请求失败");
  });
});

describe("isReportPassing", () => {
  const pass = (style: Parameters<typeof isReportPassing>[0]["style"], threshold?: number) =>
    isReportPassing(
      {
        round: 1,
        passed: false,
        content: { issues: [] },
        style,
        consistency: { issues: [] },
      },
      threshold,
    );

  test("①③ 有 issue 不通过；文风低于合格线不通过（缺省合格线 = 内置默认 80）", () => {
    expect(
      isReportPassing({
        round: 1,
        passed: false,
        content: { issues: [CONTENT_ISSUES.issues[0] as never] },
        style: { skipped: true },
        consistency: { issues: [] },
      }),
    ).toBeFalse();
    expect(
      isReportPassing({
        round: 1,
        passed: false,
        content: { issues: [] },
        style: { skipped: true },
        consistency: { issues: [CONSISTENCY_ISSUES.issues[0] as never] },
      }),
    ).toBeFalse();
    expect(pass({ skipped: false, score: DEFAULT_STYLE_PASS_SCORE - 1, rationale: "x", suggestions: [] })).toBeFalse();
  });

  test("文风恰达合格线通过；skipped 视为通过；阈值可注入抬高或放低", () => {
    expect(pass({ skipped: false, score: DEFAULT_STYLE_PASS_SCORE, rationale: "x", suggestions: [] })).toBeTrue();
    expect(pass({ skipped: true })).toBeTrue();
    // 阈值 90（历史硬编码值经入参注入）：85 不通过、90 恰达通过
    expect(pass({ skipped: false, score: 85, rationale: "x", suggestions: [] }, 90)).toBeFalse();
    expect(pass({ skipped: false, score: 90, rationale: "x", suggestions: [] }, 90)).toBeTrue();
    // 阈值 60：85 也通过
    expect(pass({ skipped: false, score: 85, rationale: "x", suggestions: [] }, 60)).toBeTrue();
  });
});

describe("formatRevisionBlock", () => {
  test("问题逐条带类别与建议，文风段含分数与合格线（缺省内置默认，可注入覆盖）", () => {
    const report = {
      round: 2,
      passed: false,
      content: {
        issues: [
          { kind: "worldview", description: "正文出现高铁", suggestion: "改为马车" },
          { kind: "summary", description: "缺失拾取情节", suggestion: "补写拾取场景" },
        ],
      },
      style: { skipped: false, score: 82, rationale: "句式偏短促", suggestions: ["增加环境描写"] },
      consistency: {
        issues: [{ kind: "consistency", description: "五个字vs四个字", suggestion: "统一" }],
      },
    } as Parameters<typeof formatRevisionBlock>[0];
    const block = formatRevisionBlock(report);
    expect(block).toContain("问题 1（世界观）：正文出现高铁");
    expect(block).toContain("问题 2（剧情概述）：缺失拾取情节");
    expect(block).toContain("→ 建议：改为马车");
    expect(block).toContain("问题 3（前后矛盾）：五个字vs四个字");
    expect(block).toContain(`文风相似度 82 分（合格线 ${DEFAULT_STYLE_PASS_SCORE}）`);
    expect(block).toContain("→ 建议：增加环境描写");
    // 注入阈值（如小说级覆盖 90）时合格线随行
    expect(formatRevisionBlock(report, 90)).toContain("文风相似度 82 分（合格线 90）");
    // 空问题段不渲染占位行
    const clean = formatRevisionBlock({
      round: 1,
      passed: true,
      content: { issues: [] },
      style: { skipped: true },
      consistency: { issues: [] },
    });
    expect(clean).not.toContain("问题");
    expect(clean).toContain("文风：本次无参考文风要求");
  });
});

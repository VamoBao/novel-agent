import { afterAll, describe, expect, mock, test } from "bun:test";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import type { Worldview } from "@novel/shared";

/**
 * chapter-review 模块单测：mock 掉 'ai' 模块（generateObject 按 prompt 段落标识
 * 脚本化返回三段校验结果），断言三段独立调用顺序与载荷、skipped 语义、
 * 通过判定与修订块格式——零 channel、零库。
 */

type GenerateObjectArgs = { model: unknown; prompt: string; schema: unknown };
let generateObjectCalls: GenerateObjectArgs[] = [];
/** 按 prompt 段落标识脚本化返回（键为段落开场标识） */
let scriptedResults: Record<string, unknown> = {};

mock.module("ai", () => ({
  tool: (spec: unknown) => spec,
  generateText: async () => {
    throw new Error("校验模块不应调用 generateText");
  },
  generateObject: async (args: GenerateObjectArgs) => {
    generateObjectCalls.push(args);
    const prompt = args.prompt;
    const key = prompt.includes("设定审校编辑")
      ? "content"
      : prompt.includes("文风比对评审")
        ? "style"
        : prompt.includes("内部自洽审校")
          ? "consistency"
          : null;
    if (key === null || !(key in scriptedResults)) {
      throw new Error(`未脚本化的 generateObject 调用（prompt 开头：${prompt.slice(0, 40)}）`);
    }
    return { object: scriptedResults[key] };
  },
}));

const { reviewChapter, isReportPassing, formatRevisionBlock, STYLE_PASS_SCORE } =
  await import("./chapter-review");

const DUMMY_MODEL = { modelId: "dummy-review-model" } as unknown as LanguageModelV4;

const worldviewFixture: Worldview = {
  background: { geography: "九州大陆，灵脉断绝" },
  taboos: ["不可出现现代科技"],
};

const CONTENT_ISSUES = {
  issues: [{ kind: "worldview", description: "正文出现高铁", suggestion: "改为马车" }],
};
const STYLE_SCORED = { score: 82, rationale: "句式偏短促", suggestions: ["增加环境描写"] };
const CONSISTENCY_ISSUES = {
  issues: [{ description: "前文五个字后文四个字", suggestion: "统一为五个字" }],
};

/** 无绑定伏笔基线输入（多数用例复用） */
function baseInput(overrides: Partial<Parameters<typeof reviewChapter>[0]> = {}) {
  return {
    novelId: "n1",
    chapterName: "第一章",
    summary: "少年拾得碎片",
    worldview: worldviewFixture,
    foreshadowLines: [],
    styleSamples: [{ name: "江南式打斗", content: "刀光一闪。" }],
    content: "　　正文全文。",
    round: 1,
    ...overrides,
  };
}

function baseDeps(onProgress?: (phase: string, report?: unknown) => void) {
  return { reviewModel: DUMMY_MODEL, ...(onProgress ? { onProgress } : {}) };
}

const cleanupFns: (() => void)[] = [];
afterAll(() => {
  cleanupFns.forEach((fn) => fn());
});

describe("reviewChapter", () => {
  test("三段按序独立调用：①载世界观/概述/伏笔行 ②载文风样本 ③仅正文全文", async () => {
    generateObjectCalls = [];
    scriptedResults = { content: CONTENT_ISSUES, style: STYLE_SCORED, consistency: CONSISTENCY_ISSUES };

    const report = await reviewChapter(
      baseInput({
        foreshadowLines: ["【本章伏笔】", "1. 表面行为：碎片刻痕"],
        styleSamples: [
          { name: "江南式打斗", content: "刀光一闪。" },
          { name: "张爱玲腔", content: "生命是一袭华美的袍。" },
        ],
      }),
      baseDeps(),
    );

    // 三段各自一次调用，顺序 ①→②→③
    expect(generateObjectCalls).toHaveLength(3);
    const [content, style, consistency] = generateObjectCalls;
    expect(content!.prompt).toContain("设定审校编辑");
    expect(content!.prompt).toContain("九州大陆，灵脉断绝");
    expect(content!.prompt).toContain("第一章：少年拾得碎片");
    expect(content!.prompt).toContain("1. 表面行为：碎片刻痕");
    expect(content!.prompt).toContain("　　正文全文。");
    expect(style!.prompt).toContain("文风比对评审");
    expect(style!.prompt).toContain("（江南式打斗）");
    expect(style!.prompt).toContain("刀光一闪。");
    expect(style!.prompt).toContain("（张爱玲腔）");
    expect(consistency!.prompt).toContain("内部自洽审校");
    expect(consistency!.prompt).toContain("　　正文全文。");
    // ③ 是章内自洽检查：不携带世界观与概述（避免无关上下文稀释注意力）
    expect(consistency!.prompt).not.toContain("九州大陆");
    expect(consistency!.prompt).not.toContain("少年拾得碎片");

    // 报告组装：三段结果并入、kind 由 ③ 代码补全、passed 按判定填充
    expect(report.round).toBe(1);
    expect(report.content.issues).toHaveLength(1);
    expect(report.style).toMatchObject({ skipped: false, score: 82 });
    expect(report.consistency.issues).toEqual([
      { kind: "consistency", description: "前文五个字后文四个字", suggestion: "统一为五个字" },
    ]);
    expect(report.passed).toBeFalse();
  });

  test("无文风样本：② 跳过零调用，报告 style.skipped=true 且计为通过", async () => {
    generateObjectCalls = [];
    scriptedResults = { content: { issues: [] }, consistency: { issues: [] } };

    const report = await reviewChapter(baseInput({ styleSamples: [] }), baseDeps());

    expect(generateObjectCalls).toHaveLength(2);
    expect(report.style).toEqual({ skipped: true });
    expect(report.passed).toBeTrue();
  });

  test("onProgress 逐段开始及结束回调：每段结束立即带该段结果", async () => {
    generateObjectCalls = [];
    scriptedResults = { content: CONTENT_ISSUES, style: STYLE_SCORED, consistency: CONSISTENCY_ISSUES };
    const events: { phase: string; result?: unknown }[] = [];

    await reviewChapter(baseInput(), baseDeps((phase, stageResult) => {
      events.push({ phase, result: stageResult });
    }));

    expect(events.map((event) => event.phase)).toEqual([
      "review-content", "review-content", "review-style", "review-style",
      "review-consistency", "review-consistency",
    ]);
    expect(events[0]!.result).toBeUndefined();
    expect(events[1]!.result).toMatchObject({ phase: "review-content", result: CONTENT_ISSUES });
    expect(events[3]!.result).toMatchObject({ phase: "review-style", result: { score: 82 } });
    expect(events[5]!.result).toMatchObject({ phase: "review-consistency", result: { issues: [{ kind: "consistency" }] } });
  });

  test("全部通过路径：报告 passed=true", async () => {
    generateObjectCalls = [];
    scriptedResults = {
      content: { issues: [] },
      style: { score: 92, rationale: "贴合", suggestions: [] },
      consistency: { issues: [] },
    };
    const report = await reviewChapter(baseInput(), baseDeps());
    expect(report.passed).toBeTrue();
  });

  test("校验调用抛错：直接透传不吞错", async () => {
    generateObjectCalls = [];
    scriptedResults = {};
    await expect(reviewChapter(baseInput(), baseDeps())).rejects.toThrow("未脚本化的 generateObject 调用");
  });
});

describe("isReportPassing", () => {
  const pass = (style: Parameters<typeof isReportPassing>[0]["style"]) =>
    isReportPassing({
      round: 1,
      passed: false,
      content: { issues: [] },
      style,
      consistency: { issues: [] },
    });

  test("①③ 有 issue 不通过；文风低于合格线不通过", () => {
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
    expect(pass({ skipped: false, score: STYLE_PASS_SCORE - 1, rationale: "x", suggestions: [] })).toBeFalse();
  });

  test("文风恰达合格线通过；skipped 视为通过；全绿通过", () => {
    expect(pass({ skipped: false, score: STYLE_PASS_SCORE, rationale: "x", suggestions: [] })).toBeTrue();
    expect(pass({ skipped: true })).toBeTrue();
  });
});

describe("formatRevisionBlock", () => {
  test("问题逐条带类别与建议，文风段含分数与合格线", () => {
    const block = formatRevisionBlock({
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
    });
    expect(block).toContain("问题 1（世界观）：正文出现高铁");
    expect(block).toContain("问题 2（剧情概述）：缺失拾取情节");
    expect(block).toContain("→ 建议：改为马车");
    expect(block).toContain("问题 3（前后矛盾）：五个字vs四个字");
    expect(block).toContain("文风相似度 82 分（合格线 90）");
    expect(block).toContain("→ 建议：增加环境描写");
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

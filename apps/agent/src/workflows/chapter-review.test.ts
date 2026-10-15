import { modelMessageSchema } from "ai";
import { afterAll, describe, expect, mock, test } from "bun:test";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { DEFAULT_STYLE_PASS_SCORE } from "@novel/shared";
import type { ReviewIssue, Worldview } from "@novel/shared";

/**
 * chapter-review 模块单测：mock 掉 'ai' 模块（generateObject 按 prompt 段落标识
 * 脚本化返回三段校验结果），断言三段独立调用顺序与载荷、skipped 语义、
 * 通过判定与修订块格式——零 channel、零库。
 */

type GenerateObjectArgs = { model: unknown; prompt: string; schema: unknown };
let generateObjectCalls: GenerateObjectArgs[] = [];
/** 按 prompt 段落标识脚本化返回（键为段落开场标识） */
let scriptedResults: Record<string, unknown> = {};

const sdkModelMessageSchema = modelMessageSchema;
mock.module("ai", () => ({
  modelMessageSchema: sdkModelMessageSchema,
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

const { reviewChapter, isReportPassing, formatRevisionBlock } =
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
    characterLines: [],
    styleSamples: [{ name: "江南式打斗", content: "刀光一闪。" }],
    stylePassScore: DEFAULT_STYLE_PASS_SCORE,
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

  test("① 最终回收未揭露真相或未收尾时报告伏笔问题，并区分阶段回收", async () => {
    generateObjectCalls = [];
    const issue = {
      kind: "foreshadow", description: "终章只写碎片发热，未解释密钥真相",
      suggestion: "揭露碎片是密钥并解释刻痕与开锁的联系，在本章收尾",
    } satisfies ReviewIssue;
    scriptedResults = { content: { issues: [issue] }, consistency: { issues: [] } };
    const report = await reviewChapter(baseInput({
      foreshadowLines: ["【本章伏笔】", "隐藏真相：碎片是密钥", "回收阶段：最终回收"],
      summary: "只发现刻痕线索，真相留待后章", styleSamples: [],
      content: "他只看见碎片发热，决定下一章再追查。",
    }), baseDeps());
    const contentPrompt = generateObjectCalls[0]!.prompt;
    const dimensions = contentPrompt.split("审查维度（逐条检查）：")[1]!;
    expect(dimensions).toContain("最终回收");
    expect(dimensions).toContain("未完整揭露真相");
    expect(dimensions).toContain("未解释表面行为与真相的联系");
    expect(dimensions).toContain("阶段回收不得提前完整揭露真相");
    expect(dimensions).toContain("foreshadow 问题");
    expect(dimensions).toContain("最终收尾要求优先于概述中推迟揭露或继续悬置的描述");
    expect(dimensions).toContain("不得仅因落实最终收尾而报告 summary 问题");
    expect(report.content.issues).toEqual([issue]);
    expect(report.passed).toBeFalse();
    expect(formatRevisionBlock(report)).toContain("（伏笔）");
  });

  test("① 载入本章角色状态与变化计划，并给出 character 审查维度", async () => {
    generateObjectCalls = [];
    scriptedResults = { content: { issues: [] }, style: STYLE_SCORED, consistency: { issues: [] } };

    await reviewChapter(
      baseInput({
        characterLines: [
          "【登场角色状态（角色基准卡 + 已结束迁移后的状态）】",
          "林恒（定位：主角；性格：热情）",
          "【本章角色变化计划（创作计划，不是已经发生的事实）】",
          "- 性格（进行中，第 2 章起至第 5 章）：旧值「热情」→ 目标「谨慎」",
        ],
      }),
      baseDeps(),
    );

    const content = generateObjectCalls.find((call) => call.prompt.includes("设定审校编辑"))!;
    expect(content.prompt).toContain("【本章角色状态与变化计划（正文应遵守）】");
    expect(content.prompt).toContain("旧值「热情」→ 目标「谨慎」");
    expect(content.prompt).toContain("4. character——角色变化是否符合");
    // 无角色行时不注入该段（现状回归）
    generateObjectCalls = [];
    await reviewChapter(baseInput(), baseDeps());
    const bare = generateObjectCalls.find((call) => call.prompt.includes("设定审校编辑"))!;
    expect(bare.prompt).not.toContain("【本章角色状态与变化计划（正文应遵守）】");
  });

  test("② 文风段合格线随入参走：prompt 与 schema 描述使用注入阈值", async () => {
    generateObjectCalls = [];
    scriptedResults = { content: { issues: [] }, style: STYLE_SCORED, consistency: { issues: [] } };

    await reviewChapter(baseInput({ stylePassScore: 85 }), baseDeps());

    expect(generateObjectCalls).toHaveLength(3);
    const style = generateObjectCalls[1]!;
    expect(style.prompt).toContain("85 分及以上为合格");
    expect(style.prompt).toContain("未达 85 分必须给出具体可操作的修改建议");
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

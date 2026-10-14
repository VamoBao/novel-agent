import { generateObject } from "ai";
import { z } from "zod";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import {
  reviewIssueSchema,
  type ReviewIssue,
  type ReviewReport,
  type ReviewStageResult,
  type StyleReview,
  type WriteProgressPhase,
} from "@novel/shared";

/**
 * 章节正文校验模块（校验 subAgent，无 ReAct、无确认门）：对生成的正文做三段
 * 独立校验——① 内容约束（世界观 / 章节概述 / 本章伏笔 / **本章角色状态与迁移计划**）、
 * ② 文风相似度评分、③ 前后自洽。三段各自单轮 generateObject、上下文互不继承（也不继承生成轮
 * 对话），结果并入一份 ReviewReport 供 write-chapter 循环判定与修订。
 * 校验模型独立注入（缺省由调用方传 Agent 会话模型——配置了独立写作
 * 模型时天然「他评」）；调用异常直接抛错，由编排层终止会话，零残留。
 */

/** 文风相似度合格线（用户指定 90 分制） */
export const STYLE_PASS_SCORE = 90;
/** 生成-校验-修订循环轮数上限（初稿 + 最多 2 轮修订；仍未达标由编排层保底保存） */
export const MAX_REVIEW_ROUNDS = 3;

export interface StyleSample {
  name: string;
  content: string;
}

export interface ChapterReviewInput {
  novelId: string;
  chapterName: string;
  summary: string;
  /** 世界观对象（JSON 序列化后进 ① prompt） */
  worldview: unknown;
  /** 本章伏笔上下文行（buildChapterForeshadowContext().lines，与写作者同源；空数组 = 无绑定伏笔） */
  foreshadowLines: string[];
  /** 本章角色状态与变化计划行（buildCharacterStateContext().lines，与写作者同源；空数组 = 无角色） */
  characterLines: string[];
  /** 启用的参考文风样本；空数组 = 无启用文风，② 整段跳过零调用 */
  styleSamples: StyleSample[];
  /** 待审正文全文 */
  content: string;
  /** 产生本报告的生成轮次（1 起始），随报告透传 */
  round: number;
}

export interface ChapterReviewDeps {
  /** 校验模型（结构化分析任务，独立于写作模型注入） */
  reviewModel: LanguageModelV4;
  /** 每段开始与结束回调；结束时附该段结果。 */
  onProgress?: (phase: WriteProgressPhase, stageResult?: ReviewStageResult) => void;
}

/** 问题类别 → 中文标签（修订块与报告展示共用） */
const ISSUE_KIND_LABELS: Record<ReviewIssue["kind"], string> = {
  worldview: "世界观",
  foreshadow: "伏笔",
  summary: "剧情概述",
  character: "角色变化",
  consistency: "前后矛盾",
};

export { ISSUE_KIND_LABELS };

/**
 * 执行三段校验并组装报告：①→②（无启用文风 skipped）→③ 顺序独立调用；
 * ③ 的问题 kind 由代码补全为 consistency（模型只产出描述与建议，杜绝类别漂移）；
 * passed 按通过判定回填（LLM 不自评）。
 */
export async function reviewChapter(
  input: ChapterReviewInput,
  deps: ChapterReviewDeps,
): Promise<ReviewReport> {
  const { reviewModel, onProgress } = deps;

  // ① 内容约束：世界观 + 章节概述 + 本章伏笔 + 本章角色状态与迁移计划 + 正文
  onProgress?.("review-content");
  const contentPrompt = [
    "你是一位严格的小说设定审校编辑。请对照资料审查章节正文，只报告确实存在的问题，不要为凑数而编造问题。",
    "",
    "【世界观】",
    JSON.stringify(input.worldview),
    "",
    "【章节】",
    `${input.chapterName}：${input.summary}`,
    ...(input.foreshadowLines.length > 0
      ? [
          "",
          "【本章伏笔（正文应体现）】",
          ...input.foreshadowLines,
        ]
      : []),
    ...(input.characterLines.length > 0
      ? [
          "",
          "【本章角色状态与变化计划（正文应遵守）】",
          ...input.characterLines,
        ]
      : []),
    "",
    "【待审正文】",
    input.content,
    "",
    "审查维度（逐条检查）：",
    "1. worldview——正文是否存在与世界观相违背的内容（世界设定、禁忌 taboos、地理势力、力量体系等）；",
    "2. foreshadow——按每条伏笔标注的回收阶段检查：登场伏笔的表面行为是否自然带出、有无点破「不得点破」的隐藏真相；阶段回收应推进线索或局部揭示并呼应登场细节，阶段回收不得提前完整揭露真相或宣称已最终收尾；最终回收必须在本章完整揭露隐藏真相、解释表面行为与真相的联系并完成收尾，未完整揭露真相、未解释表面行为与真相的联系、继续悬置或留待后章均须报告 foreshadow 问题并给出本章收尾的修订建议（章节概述未提及揭露也不能豁免）；回收阶段无法确定时按概述与已知伏笔资料检查，不得猜测其是最终回收章；",
    "3. summary——正文是否与章节剧情概述的情节走向匹配（可合理补充细节，但不得偏离走向、不得缺失关键情节）；对明确标为最终回收的伏笔，最终收尾要求优先于概述中推迟揭露或继续悬置的描述，不得仅因落实最终收尾而报告 summary 问题，其余情节仍按概述检查；",
    "4. character——角色变化是否符合【本章角色状态与变化计划】：是否过早改变（把「进行中」的目标状态当作已经完成）、缺少过渡（未呈现诱因与渐变过程）、未保留应保留的特征（把目标新值提前覆盖全部既有特征），或让角色凭空声称此前未发生的事；创作指导类字段不得被角色当作已知信息。",
    "",
    "每条问题给出 kind（worldview / foreshadow / summary / character 四选一）、description（引用正文依据）、suggestion（具体改进建议）；没有问题输出空 issues 数组。",
  ].join("\n");
  const { object: contentResult } = await generateObject({
    model: reviewModel,
    schema: z.object({ issues: z.array(reviewIssueSchema) }),
    prompt: contentPrompt,
  });
  onProgress?.("review-content", { phase: "review-content", result: contentResult });

  // ② 文风对比：无启用文风不调模型，但回传 skipped 供客户端显示；
  // 模型只产评分三字段，skipped 包装由代码完成（避免模型自行声明跳过）
  let style: StyleReview;
  if (input.styleSamples.length === 0) {
    style = { skipped: true };
    onProgress?.("review-style", { phase: "review-style", result: style });
  } else {
    onProgress?.("review-style");
    const styleScoreSchema = z.object({
      score: z.number().int().min(0).max(100).describe("与参考文风的相似度评分（0-100 整数）"),
      rationale: z.string().describe("评分依据"),
      suggestions: z.array(z.string()).describe("未达标（<90 分）时的具体改进建议，达标可为空数组"),
    });
    const { object: styleResult } = await generateObject({
      model: reviewModel,
      schema: styleScoreSchema,
      prompt: [
        "你是一位文风比对评审。请评估待审正文与参考文风样本的文风相似度（0-100 整数评分，90 分及以上为合格）。",
        "",
        "【参考文风样本】",
        input.styleSamples
          .map((sample) => `（${sample.name}）\n${sample.content}`)
          .join("\n\n"),
        "",
        "【待审正文】",
        input.content,
        "",
        "从叙事语言、句式节奏、描写风格等维度综合评分，给出评分依据 rationale；未达 90 分必须给出具体可操作的修改建议 suggestions，达标可为空数组。",
      ].join("\n"),
    });
    style = { skipped: false, ...styleResult };
    onProgress?.("review-style", { phase: "review-style", result: style });
  }

  // ③ 前后自洽：仅正文全文（章内属性，不携带世界观/概述等外部上下文）
  onProgress?.("review-consistency");
  const issueBodySchema = z.object({
    description: z.string().min(1).describe("矛盾描述，引用两处原文依据"),
    suggestion: z.string().min(1).describe("改进建议"),
  });
  const { object: consistencyResult } = await generateObject({
    model: reviewModel,
    schema: z.object({ issues: z.array(issueBodySchema) }),
    prompt: [
      "你是一位细致的小说内部自洽审校。请通读以下章节正文，只检查其内部的前后自洽性（不需要对照任何外部资料）。",
      "",
      "【待审正文】",
      input.content,
      "",
      "检查维度（举例非穷尽）：",
      "- 基础描述前后矛盾：数量、时间、方位、称谓、外貌等前后不一致（如前文说角色「说了五个字」后文说「四个字」）；",
      "- 无中生有：正文后段提及或使用前段从未铺垫过的人物、物件、设定；",
      "- 人物言行矛盾：角色说出与自身立场矛盾、或从未发生过的对话内容；",
      "- 事件逻辑冲突：前后行为、因果关系被推翻。",
      "",
      "注意：刻意的文学留白与悬念铺垫不是矛盾，不要报告。每条问题给出 description（引用两处原文依据）与 suggestion；没有矛盾输出空 issues 数组。",
    ].join("\n"),
  });
  const consistencyIssues: ReviewIssue[] = consistencyResult.issues.map((issue) => ({
    kind: "consistency",
    description: issue.description,
    suggestion: issue.suggestion,
  }));
  onProgress?.("review-consistency", {
    phase: "review-consistency",
    result: { issues: consistencyIssues },
  });

  const report: ReviewReport = {
    round: input.round,
    passed: isReportPassing({
      round: input.round,
      passed: false,
      content: contentResult,
      style,
      consistency: { issues: consistencyIssues },
    }),
    content: contentResult,
    style,
    consistency: { issues: consistencyIssues },
  };
  return report;
}

/** 通过判定：①③ 无问题，且文风段 skipped 或评分达到合格线 */
export function isReportPassing(report: ReviewReport): boolean {
  return (
    report.content.issues.length === 0 &&
    report.consistency.issues.length === 0 &&
    (report.style.skipped || (report.style.score ?? 0) >= STYLE_PASS_SCORE)
  );
}

/** 报告 → 修订 prompt 块（write-chapter 修订轮注入【整改报告】用；问题逐条带类别与建议） */
export function formatRevisionBlock(report: ReviewReport): string {
  const lines: string[] = [];
  let index = 1;
  for (const issue of report.content.issues) {
    lines.push(`问题 ${index}（${ISSUE_KIND_LABELS[issue.kind]}）：${issue.description}`);
    lines.push(`  → 建议：${issue.suggestion}`);
    index += 1;
  }
  for (const issue of report.consistency.issues) {
    lines.push(`问题 ${index}（${ISSUE_KIND_LABELS.consistency}）：${issue.description}`);
    lines.push(`  → 建议：${issue.suggestion}`);
    index += 1;
  }
  if (report.style.skipped) {
    lines.push("文风：本次无参考文风要求，无需调整文风。");
  } else {
    lines.push(
      `文风相似度 ${report.style.score} 分（合格线 ${STYLE_PASS_SCORE}）：${report.style.rationale}`,
    );
    for (const suggestion of report.style.suggestions) {
      lines.push(`  → 建议：${suggestion}`);
    }
  }
  return lines.join("\n");
}

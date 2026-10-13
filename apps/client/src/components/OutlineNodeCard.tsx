import type { DocumentEntry, OutlineNodeEntry, ReviewReport, ReviewStageResult, WriteProgressPhase } from "@novel/shared";
import type { StaleCastCharacter } from "../character-staleness";

/** 章卡伏笔显示模型（PreviewPane 过滤登场/回收两组并解析角色名后传入，卡片纯渲染） */
export interface ChapterForeshadow {
  /** React key（同一伏笔可同时命中登场与回收两组，各显示一条） */
  key: string;
  badge: "登场" | "回收";
  surfaceAction: string;
  hiddenTruth: string;
  attentionLevel: number;
  characterNames: string[];
}

/** 正文生成进度显示模型（PreviewPane 从 write-progress 消息提取后传入） */
export interface ChapterWriteProgress {
  round: number;
  totalRounds: number;
  phase: WriteProgressPhase;
  report?: ReviewReport;
  stageResults: ReviewStageResult[];
}

/** 进度步骤（drafting 与 revising 同属「正文生成」步——修订轮即新一轮生成） */
const PROGRESS_STEPS: { phases: WriteProgressPhase[]; label: string }[] = [
  { phases: ["drafting", "revising"], label: "正文生成" },
  { phases: ["review-content"], label: "内容约束校验" },
  { phases: ["review-style"], label: "文风校验" },
  { phases: ["review-consistency"], label: "前后自洽校验" },
  { phases: ["saving"], label: "保存入库" },
];

/** 问题类别 → 中文标签（与 agent 侧 ISSUE_KIND_LABELS 同义；client 不依赖 agent 代码故独立维护） */
const ISSUE_KIND_LABELS: Record<ReviewReport["content"]["issues"][number]["kind"], string> = {
  worldview: "世界观",
  foreshadow: "伏笔",
  summary: "剧情概述",
  consistency: "前后矛盾",
};

interface OutlineNodeCardProps {
  node: OutlineNodeEntry;
  /** 幕下已有章节点时不再显示生成入口（重新规划/修订流为后续需求） */
  hasChapters?: boolean;
  /** 触发本幕章节规划（浏览页接线到独立章节规划页）；不传则不显示入口 */
  onPlanChapters?: () => void;
  /** 本章已生成的正文（详情 documents 按 chapterId 匹配）；无则显示生成入口 */
  document?: DocumentEntry;
  /** 本章登场人物名（章节规划确认时绑定的 characterIds 经详情 characters 解析，
   *  未匹配兜底原 ID；未绑定（旧数据）传 null/undefined 不渲染区块） */
  castNames?: string[] | null;
  /** 正文生成后被编辑过的登场角色（详情比对 updatedAt 得出）；有则在正文卡给出
   *  「建议重新生成」提示，不做自动重写 */
  staleCast?: StaleCastCharacter[];
  /** 正文生成会话进行中（单例 agent：进行中禁用各章入口，目标章显示生成中） */
  writing?: boolean;
  /** 本章正文生成进度（write-progress 消息；仅目标章传入，其余章 undefined） */
  writeProgress?: ChapterWriteProgress;
  /** 触发本章正文生成（write-chapter 会话）；不传则不显示入口 */
  onWriteChapter?: () => void;
  /** 触发本章正文重新生成（覆盖替换，经弹框确认后调用）；有正文且传入时显示入口 */
  onRegenerateChapter?: () => void;
  /** 本章涉及的伏笔（详情 foreshadows 过滤登场/回收两组；无则不渲染区块） */
  foreshadows?: ChapterForeshadow[];
}

/** 报告 → 摘要行（内容 N 处 · 文风 X 分或无文风要求 · 自洽 M 处） */
function reportSummary(report: ReviewReport): string {
  const styleText = report.style.skipped ? "无文风要求" : `文风 ${report.style.score} 分`;
  return `内容 ${report.content.issues.length} 处 · ${styleText} · 自洽 ${report.consistency.issues.length} 处`;
}

/**
 * 大纲节点只读预览：梗概与关键情节点（仅幕节点有）分上下两张卡片展示，
 * 「规划本幕章节」入口固定在两张卡片下方右对齐——节点名与类型以左栏结构
 * 树为准（点击时已高亮），右栏不再重复；入口仅未规划过章节的幕显示，旧数
 * 据幕缺梗概/情节点（无规划种子内容），禁用并提示原因。
 * 章节点：无正文时同样右对齐显示「✍️ 生成本章正文」入口（写作模型生成，
 * write-chapter 会话）；生成中由 writeProgress 渲染流程进度区块（步骤条 +
 * 单段校验反馈及整改报告摘要，write-progress 消息驱动）；已有正文则在梗概卡下追加正文卡
 * （约 N 字 + 全文——内容存 output 落盘文件，库内只留元数据；重写/修订流为
 * 后续需求）。
 * 浏览路径专用，不进 shared 的 View 体系——
 * 避免浏览专用视图渗入创作流协议（protocol.ts 内嵌 viewSchema）。
 * 历史数据（6 版迁移前入库）summary / keyPlotPoints 为 null，展示空占位。
 */
export function OutlineNodeCard({
  node,
  hasChapters = false,
  onPlanChapters,
  document,
  castNames,
  staleCast,
  writing = false,
  writeProgress,
  onWriteChapter,
  onRegenerateChapter,
  foreshadows,
}: OutlineNodeCardProps) {
  const legacy = node.summary === null || node.keyPlotPoints === null;
  const showEntry = node.type === "act" && !hasChapters && onPlanChapters !== undefined;
  const showWriteEntry =
    node.type === "chapter" && !document && onWriteChapter !== undefined;
  // 有正文且传入回调时显示重新生成入口（覆盖替换，确认弹框由调用方渲染）
  const showRegenEntry =
    node.type === "chapter" && document !== undefined && onRegenerateChapter !== undefined;
  const showProgress = node.type === "chapter" && writing && writeProgress !== undefined;
  const currentStep = writeProgress
    ? PROGRESS_STEPS.findIndex((step) => step.phases.includes(writeProgress.phase))
    : -1;
  const report = writeProgress?.report;
  const reportIssues = report
    ? [
        ...report.content.issues.map((issue) => ({ ...issue, key: `c-${issue.description}` })),
        ...report.consistency.issues.map((issue) => ({ ...issue, key: `s-${issue.description}` })),
      ]
    : [];

  return (
    <>
      <section className="viewcard">
        <p className="card-label">梗概</p>
        {node.summary ? (
          <p className="outline-summary">{node.summary}</p>
        ) : (
          <p className="dim">（暂无梗概——旧数据未入库内容）</p>
        )}
      </section>
      {node.type === "act" ? (
        <section className="viewcard">
          <p className="card-label">关键情节点</p>
          {node.keyPlotPoints ? (
            <ol className="plot-list">
              {node.keyPlotPoints.map((point, index) => (
                <li key={index}>{point}</li>
              ))}
            </ol>
          ) : (
            <p className="dim">（暂无关键情节点——旧数据未入库内容）</p>
          )}
        </section>
      ) : null}
      {node.type === "chapter" && castNames && castNames.length > 0 ? (
        <section className="viewcard">
          <p className="card-label">🎭 登场人物</p>
          <p className="outline-summary">{castNames.join("、")}</p>
        </section>
      ) : null}
      {node.type === "chapter" && document ? (
        <section className="viewcard">
          <p className="card-label">正文 · 约 {document.wordCount} 字</p>
          {staleCast && staleCast.length > 0 ? (
            <p className="cast-stale">
              ⚠️ 登场角色卡已更新（{staleCast.map((c) => `${c.name} 现 v${c.version}`).join("、")}
              ）——本章正文生成于更新之前，如需保持一致建议「🔄 重新生成」
            </p>
          ) : null}
          {document.content ? (
            <div className="prose-content">{document.content}</div>
          ) : (
            <p className="dim">（正文文件缺失或已被移动）</p>
          )}
        </section>
      ) : null}
      {node.type === "chapter" && foreshadows && foreshadows.length > 0 ? (
        <section className="viewcard">
          <p className="card-label">伏笔</p>
          {foreshadows.map((f) => (
            <p key={f.key} className="outline-summary">
              [{f.badge}] {f.surfaceAction} ⇢ {f.hiddenTruth}（注意度 {f.attentionLevel}
              {f.characterNames.length > 0 ? `，服务：${f.characterNames.join("、")}` : ""}）
            </p>
          ))}
        </section>
      ) : null}
      {showProgress && writeProgress ? (
        <section className="viewcard write-progress">
          <p className="card-label">
            生成进度 · 第 {writeProgress.round}/{writeProgress.totalRounds} 轮
          </p>
          <ol className="progress-steps">
            {PROGRESS_STEPS.map((step, index) => {
              const stage = writeProgress.stageResults.find((item) => step.phases.includes(item.phase));
              const failed = stage?.phase === "review-style"
                ? !stage.result.skipped && stage.result.score < 90
                : stage !== undefined && stage.result.issues.length > 0;
              const skipped = stage?.phase === "review-style" && stage.result.skipped;
              return (
                <li
                  key={step.label}
                  className={failed ? "warning" : skipped ? "skipped" : index === currentStep && !stage ? "current" : stage || index < currentStep ? "done" : undefined}
                >
                  <span>{failed ? "⚠ " : skipped ? "— " : stage || index < currentStep ? "✓ " : ""}{step.label}{skipped ? "（已跳过）" : ""}</span>
                  {stage?.phase === "review-style" && !stage.result.skipped ? (
                    <div className="stage-feedback">
                      <p>文风 {stage.result.score} 分：{stage.result.rationale}</p>
                      {failed && stage.result.suggestions.length > 0 ? (
                        <ul>{stage.result.suggestions.map((suggestion, i) => <li key={i}>{suggestion}</li>)}</ul>
                      ) : null}
                    </div>
                  ) : null}
                  {stage && stage.phase !== "review-style" && stage.result.issues.length > 0 ? (
                    <ul className="stage-feedback">
                      {stage.result.issues.map((issue, i) => (
                        <li key={i}>[{ISSUE_KIND_LABELS[issue.kind]}] {issue.description} → {issue.suggestion}</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {report ? (
            <div className="write-report">
              <p className={report.passed ? "report-verdict pass" : "report-verdict fail"}>
                {report.passed ? "✅ 已达标" : "⚠️ 未达标"}（{reportSummary(report)}）
              </p>
              {reportIssues.length > 0 ? (
                <details>
                  <summary>{reportIssues.length} 条问题与建议</summary>
                  <ul className="report-issues">
                    {reportIssues.map((issue) => (
                      <li key={issue.key}>
                        [{ISSUE_KIND_LABELS[issue.kind]}] {issue.description} → {issue.suggestion}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
      {showEntry ? (
        <div className="act-actions">
          <button
            className={legacy ? undefined : "primary"}
            disabled={legacy}
            title={legacy ? "旧数据未入库幕梗概/关键情节点，无法规划章节" : undefined}
            onClick={onPlanChapters}
          >
            📑 规划本幕章节
          </button>
        </div>
      ) : null}
      {showWriteEntry ? (
        <div className="act-actions">
          <button
            className="primary"
            disabled={writing || node.summary === null}
            title={
              node.summary === null
                ? "旧数据未入库章节概述，无法生成正文"
                : writing
                  ? "正文生成中…"
                  : undefined
            }
            onClick={onWriteChapter}
          >
            {writing ? "✍️ 正文生成中…" : "✍️ 生成本章正文"}
          </button>
        </div>
      ) : null}
      {showRegenEntry ? (
        <div className="act-actions">
          <button
            disabled={writing}
            title={writing ? "正文生成中…" : "重新生成并覆盖现有正文（会先弹出确认）"}
            onClick={onRegenerateChapter}
          >
            {writing ? "🔄 重新生成中…" : "🔄 重新生成"}
          </button>
        </div>
      ) : null}
    </>
  );
}

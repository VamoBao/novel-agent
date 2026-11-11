import { useEffect, useState } from "react";
import { Check, ChevronDown, CircleCheck, CirclePause, Clock3, Feather, LoaderCircle, Minus, PenLine, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { DEFAULT_STYLE_PASS_SCORE, type ReviewReport, type ReviewStageResult, type WriteProgressPhase } from "@novel/shared";
import { isWriting, type ChapterWriteSession } from "./write-session";
import "./chapter-writing.css";

const STEPS: { phase: WriteProgressPhase; label: string; short: string }[] = [
  { phase: "drafting", label: "正文生成", short: "生成" },
  { phase: "review-content", label: "内容约束校验", short: "内容" },
  { phase: "review-style", label: "文风校验", short: "文风" },
  { phase: "review-consistency", label: "前后自洽校验", short: "自洽" },
  { phase: "saving", label: "保存入库", short: "保存" },
];
const PHASE_COPY: Record<WriteProgressPhase, { label: string; description: string }> = {
  drafting: { label: "正在创作正文", description: "依据章节概述、人物与世界设定展开情节。" },
  revising: { label: "正在修订正文", description: "根据上一轮审校意见，修订最新一版正文。" },
  "review-content": { label: "正在校验内容", description: "检查世界观、章节剧情、角色状态与伏笔安排。" },
  "review-style": { label: "正在校验文风", description: "对照启用的参考文风，检查表达与叙述节奏。" },
  "review-consistency": { label: "正在校验自洽性", description: "检查前后衔接与正文中的逻辑矛盾。" },
  saving: { label: "正在保存正文", description: "正在写入正文文件并更新章节资料，请等待保存完成。" },
};
const ISSUE_LABELS: Record<ReviewReport["content"]["issues"][number]["kind"], string> = {
  worldview: "世界观", foreshadow: "伏笔", summary: "剧情概述", character: "角色变化", consistency: "前后矛盾",
};
function reportSummary(report: ReviewReport): string {
  return `内容 ${report.content.issues.length} 处 · ${report.style.skipped ? "无文风要求" : `文风 ${report.style.score} 分`} · 自洽 ${report.consistency.issues.length} 处`;
}
function Issues({ issues }: { issues: ReviewReport["content"]["issues"] }) {
  return <ul className="writing-issues">{issues.map((issue, index) => <li key={index}>{`[${ISSUE_LABELS[issue.kind]}] ${issue.description} → ${issue.suggestion}`}</li>)}</ul>;
}

/** 任务结果与审校结果分开呈现，保存阶段不提前宣称正文已保存。 */
export function ChapterWritingProgress({ chapterName, session, disabled = false, disabledReason, onStart, onRetry }: {
  chapterName: string;
  session?: ChapterWriteSession;
  disabled?: boolean;
  disabledReason?: string;
  onStart?: () => void;
  onRetry?: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  const active = isWriting(session);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  const progress = session?.progress;
  const status = session?.status ?? "idle";
  const lastReport = session?.reports.at(-1);
  const needsReview = status === "completed" && lastReport?.passed === false;
  const label = status === "idle" ? "准备开始" : status === "preparing" ? "正在准备"
    : status === "failed" ? "生成已中断" : status === "completed" ? needsReview ? "已保存 · 待复核" : "正文已保存"
    : progress ? PHASE_COPY[progress.phase].label : "正在处理";
  const StatusIcon = status === "failed" ? CirclePause : status === "completed" ? needsReview ? TriangleAlert : CircleCheck : active ? LoaderCircle : Feather;
  const currentIndex = progress ? STEPS.findIndex((step) => step.phase === (progress.phase === "revising" ? "drafting" : progress.phase)) : -1;
  const elapsed = session ? Math.max(0, Math.floor(((session.endedAt ?? now) - session.startedAt) / 1000)) : 0;
  const duration = elapsed < 60 ? `${elapsed} 秒` : `${Math.floor(elapsed / 60)} 分 ${elapsed % 60} 秒`;
  const threshold = progress?.stylePassScore ?? DEFAULT_STYLE_PASS_SCORE;
  const results = [...(progress?.stageResults ?? [])];
  // 当前轮完整报告同样是实际结果，兼容未收到逐项结果的旧消息。
  if (progress?.report && progress.report.round === progress.round) {
    const report = progress.report;
    for (const item of [
      { phase: "review-content", result: report.content }, { phase: "review-style", result: report.style }, { phase: "review-consistency", result: report.consistency },
    ] as ReviewStageResult[]) if (!results.some((result) => result.phase === item.phase)) results.push(item);
  }
  const stageState = (phase: WriteProgressPhase, index: number): string => {
    const stage = results.find((item) => item.phase === phase);
    if (stage?.phase === "review-style") return stage.result.skipped ? "skipped" : stage.result.score < threshold ? "warning" : "done";
    if (stage) return stage.result.issues.length > 0 ? "warning" : "done";
    if (status === "completed") return index === 0 || index === 4 ? "done" : "pending";
    if (index === currentIndex) return status === "failed" ? "failed" : "current";
    return index === 0 && currentIndex > 0 ? "done" : "pending";
  };

  return <section className="viewcard writing-process" data-status={status} aria-label="正文生成过程">
    <div className="writing-process-header"><span className="writing-avatar"><Feather size={20} aria-hidden /></span>
      <div className="writing-identity"><span className="writing-eyebrow">正文创作</span><h3>{chapterName}</h3></div>
      <span className={`writing-status ${needsReview ? "warning" : status}`} role="status"><StatusIcon size={14} aria-hidden />{label}</span>
    </div>
    {session ? <details className="writing-process-details" open={status !== "completed"}>
      <summary><span>{needsReview ? "仍有未达标项，展开审校记录" : "查看本次生成过程与审校记录"}</span><span>{progress ? `第 ${progress.round} 轮 · ${duration}` : duration}</span><ChevronDown size={14} aria-hidden /></summary>
      <div className="writing-meta"><span><RefreshCw size={13} aria-hidden />{progress ? `第 ${progress.round} / ${progress.totalRounds} 轮` : "准备章节资料"}</span><span><Clock3 size={13} aria-hidden />{duration}</span></div>
      <ol className="progress-steps writing-steps" aria-label="正文生成步骤">
        {STEPS.map((step, index) => {
          const state = stageState(step.phase, index);
          const skipped = state === "skipped";
          const Icon = state === "done" ? Check : skipped ? Minus : state === "warning" || state === "failed" ? TriangleAlert : state === "current" ? LoaderCircle : undefined;
          return <li key={step.phase} className={state} aria-current={state === "current" ? "step" : undefined}>
            <span className="writing-step-icon">{Icon ? <Icon size={14} aria-hidden /> : String(index + 1).padStart(2, "0")}</span>
            <span>{step.short}</span><span className="writing-step-accessible">{skipped ? "（已跳过）" : state === "pending" ? "（等待中）" : ""}</span>
          </li>;
        })}
      </ol>
      <div className={`writing-current ${needsReview ? "warning" : status}`}>
        <StatusIcon size={18} aria-hidden /><div><strong>{label}</strong>
          <p>{status === "preparing" ? "正在准备章节资料与写作模型，进度将在这里更新。"
            : status === "failed" ? session.error ?? "生成意外结束，未收到保存完成确认。"
            : status === "completed" ? needsReview ? "最后一版正文已保存，仍有未达标项，建议人工复核或重新生成。" : "本章正文已完成并保存，可以继续阅读。"
            : progress ? PHASE_COPY[progress.phase].description : "正在等待生成进度。"}</p>
        </div>
      </div>
      {status === "failed" ? <div className="writing-recovery"><p>{session.replacing ? "原有正文仍保留，可继续阅读。重新尝试前仍需确认覆盖。" : "本次生成尚未确认保存。重新尝试将重新生成本章正文。"}</p>
        {onRetry ? <button className="primary" disabled={disabled} onClick={onRetry}><RefreshCw size={15} aria-hidden />重新尝试</button> : null}</div> : null}
      {progress ? <div className="writing-reviews">
        {STEPS.slice(1, 4).map((step, index) => {
          const stage = results.find((item) => item.phase === step.phase);
          const state = stageState(step.phase, index + 1);
          const failed = state === "warning";
          const skipped = state === "skipped";
          const title = step.label + (skipped ? "（已跳过）" : "");
          return <details key={step.phase} className="writing-review" data-stage={step.phase} data-state={state}>
            <summary><ShieldCheck size={16} aria-hidden /><span><strong>{title}</strong><span>{stage?.phase === "review-style" ? stage.result.skipped ? "未启用参考文风" : `${stage.result.score} 分 · 合格线 ${threshold} 分`
              : stage ? stage.result.issues.length ? `${stage.result.issues.length} 处待调整` : "未发现问题" : state === "failed" ? "检查已中断" : state === "current" ? "正在检查" : "等待检查"}</span></span><ChevronDown size={14} aria-hidden /></summary>
            <div className="writing-review-body">
              {stage?.phase === "review-style" ? stage.result.skipped ? <p>未启用参考文风，本项无需评分。</p> : <><p>{`文风 ${stage.result.score} 分：${stage.result.rationale}`}</p>{failed && stage.result.suggestions.length ? <ul className="writing-issues">{stage.result.suggestions.map((text, i) => <li key={i}>{text}</li>)}</ul> : null}</>
                : stage ? stage.result.issues.length ? <Issues issues={stage.result.issues} /> : <p>本项校验已完成，未发现需要调整的问题。</p> : <p>{state === "failed" ? "本项检查已中断，重新尝试后会重新生成并校验。" : "本项结果将在校验结束后显示。"}</p>}
            </div>
          </details>;
        })}
      </div> : null}
      {session.reports.length ? <div className="writing-reports"><h4>审校记录</h4><p className="writing-report-hint">{status === "completed" ? "报告对应各轮稿件，最后一轮报告为本次保存版本的审校结果。"
        : status === "failed" ? "以下为已收到的审校记录，本次生成尚未确认保存。"
        : "每份报告对应当轮稿件；修订中的新稿尚未形成最终结论。"}</p>
        {session.reports.map((report) => <details className="writing-report" key={report.round}>
          <summary><span>第 {report.round} 轮</span><span className={report.passed ? "pass" : "warning"}>{report.passed ? "已达标" : "需调整"}</span><ChevronDown size={14} aria-hidden /></summary>
          <div className="writing-review-body"><p className={report.passed ? "report-verdict pass" : "report-verdict fail"}>{`${report.passed ? "已达标" : "未达标"}（${reportSummary(report)}）`}</p>
            <Issues issues={[...report.content.issues, ...report.consistency.issues]} />
            {!report.style.skipped && report.style.suggestions.length ? <ul className="writing-issues">{report.style.suggestions.map((text, i) => <li key={i}>{text}</li>)}</ul> : null}
          </div>
        </details>)}
      </div> : null}
    </details> : <div className="writing-launch"><p>依据本章概述展开正文，经内容、文风与自洽校验后保存。未达标时会自动修订。</p>
      <div><span><ShieldCheck size={14} aria-hidden />生成 · 三项审校 · 保存</span><button className="primary" disabled={disabled} onClick={onStart}><PenLine size={15} aria-hidden />{disabled ? disabledReason ?? "其他章节正在生成…" : "生成本章正文"}</button></div>
    </div>}
  </section>;
}

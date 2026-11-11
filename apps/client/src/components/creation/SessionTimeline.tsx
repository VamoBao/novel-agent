import { BookOpen, Check, CircleAlert, MessageSquare, Sparkles, UserRound } from "lucide-react";
import type { SessionAnswer, SessionRequest, TimelineEntry } from "../../hooks/session-timeline";
import { QuestionCard } from "../QuestionCard";
import { ViewCard } from "../ViewCard";
import { ActivityCard } from "./ActivityCard";
import { CREATION_STEPS, creationNotice, creationStep, questionTitle } from "./creation-content";

function AnswerCard({ entry }: { entry: Extract<TimelineEntry, { kind: "request" }> }) {
  const value = entry.answer;
  const answer = typeof value === "boolean" ? value ? "确认，继续下一步" : "我想调整一下"
    : value === "" ? "暂时跳过" : value;
  return <section className="creation-card answer-card" data-delivery={entry.deliveryError ? "failed" : "answered"}>
    <div className="creation-card-heading"><span className="creation-avatar user"><UserRound size={17} aria-hidden /></span>
      <span className="creation-card-label">你的回答</span><span className="creation-card-meta">{entry.deliveryError ? "发送失败" : "已提交"}</span></div>
    <h3>{questionTitle(entry.request.ask.prompt)}</h3>
    {entry.request.ask.type === "confirm" && entry.request.ask.view ? <ViewCard view={entry.request.ask.view} /> : null}
    {Array.isArray(answer) ? <div className="answer-tags">{answer.map((item) => <span key={item}>{item}</span>)}</div>
      : <p className="answer-content">{answer}</p>}
    {entry.deliveryError ? <p className="creation-input-error">{entry.deliveryError}</p> : null}
  </section>;
}

/** 两个工作台共用事件卡片；页面只负责资料、导航与会话状态。 */
export function SessionTimeline({ timeline, requests, currentRequest, onAnswer, autoFocus, showStages = true, resultLabel = "创作成果" }: {
  timeline: TimelineEntry[];
  requests: SessionRequest[];
  currentRequest?: SessionRequest;
  onAnswer: (id: number, value: SessionAnswer) => void;
  autoFocus: boolean;
  showStages?: boolean;
  resultLabel?: string;
}) {
  const answer = onAnswer;
  const activities = new Map(timeline.flatMap((entry) => entry.kind === "activity" ? [[entry.activity.id, entry.activity] as const] : []));
  const waitingIds = new Set(requests.flatMap((request) => {
    if (!request.activityId) return [];
    const parentId = activities.get(request.activityId)?.parentId;
    return parentId ? [request.activityId, parentId] : [request.activityId];
  }));
  const renderEntry = (entry: TimelineEntry) => {
    switch (entry.kind) {
      case "stage": {
        if (!showStages) return null;
        const step = creationStep(entry.stage);
        return <section className="creation-card creation-stage-card" data-stage-anchor={entry.stage}>
          <div><span className="creation-eyebrow">{entry.stage === "chapter" ? "继续规划" : `步骤 ${String(CREATION_STEPS.findIndex((item) => item.stage === entry.stage) + 1).padStart(2, "0")}`}</span>
            <h2>{step.label}</h2><p>{step.description}</p></div><BookOpen size={26} aria-hidden /></section>;
      }
      case "notify": {
        const text = creationNotice(entry.text);
        if (!text) return null;
        const warning = /警告|跳过|⚠|失败|尚无|未匹配/u.test(entry.text);
        return <section className="creation-card creation-notice" data-tone={entry.tone ?? (warning ? "warning" : "info")}>
          {warning || entry.tone ? <CircleAlert size={16} aria-hidden /> : <Sparkles size={16} aria-hidden />}<p>{text}</p></section>;
      }
      case "view": return <section className="creation-card creation-result-card">
        <div className="creation-card-heading"><span className="creation-avatar result"><BookOpen size={17} aria-hidden /></span>
          <span className="creation-card-label">{resultLabel}</span><span className="creation-card-meta"><Check size={13} aria-hidden />已整理</span></div>
        <ViewCard view={entry.view} /></section>;
      case "activity": {
        const parent = entry.activity.parentId ? activities.get(entry.activity.parentId) : undefined;
        return <ActivityCard activity={entry.activity} waiting={waitingIds.has(entry.activity.id)}
          parentName={parent?.name} />;
      }
      case "request": {
        if (entry.answer !== undefined) return <AnswerCard entry={entry} />;
        const active = entry.request.id === currentRequest?.id && !entry.interrupted;
        return <section className={`creation-card creation-input-card ${active ? "is-current" : "is-queued"}`}>
          <div className="creation-card-heading"><span className="creation-avatar input"><MessageSquare size={17} aria-hidden /></span>
            <span className="creation-card-label">{entry.interrupted ? "输入已中断" : active ? "轮到你了" : "接下来的问题"}</span>
            <span className="creation-card-meta">{active ? "等待输入" : entry.interrupted ? "继续流程后重新开始" : "等待前一项回答"}</span></div>
          {active ? <QuestionCard key={entry.request.id} request={entry.request} appearance="workbench" autoFocus={autoFocus} onAnswer={answer} />
            : <p>{questionTitle(entry.request.ask.prompt)}</p>}
        </section>;
      }
    }
  };

  return timeline.map((entry) => entry.kind === "stage" && !showStages ? null
    : <div className="creation-entry" data-entry-key={entry.key} key={entry.key}>{renderEntry(entry)}</div>);
}

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, BookOpen, Check, CircleAlert, Feather, LoaderCircle, MessageSquare, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import type { Stage } from "@novel/shared";
import { useAgentSession } from "../hooks/use-agent-session";
import type { TimelineEntry } from "../hooks/session-timeline";
import { QuestionCard } from "./QuestionCard";
import { ViewCard } from "./ViewCard";
import { ActivityCard } from "./creation/ActivityCard";
import { CREATION_STEPS, creationNotice, creationStep, questionTitle } from "./creation/creation-content";
import "./creation/creation-workbench.css";

interface CreationFlowProps {
  resumeRunId?: string;
  onFinished: (novelId: string) => void;
  onClose: () => void;
}

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

/** 新建/恢复创作：有序卡片时间流，原位更新调用，保留逐次输入。 */
export function CreationFlow({ resumeRunId, onFinished, onClose }: CreationFlowProps) {
  const { phase, timeline, stage, requests, currentRequest, error, exitCode, answer, start } = useAgentSession({
    startOptions: resumeRunId ? { mode: "resume", runId: resumeRunId } : undefined, onFinished,
  });
  const bottomRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<HTMLElement>(null);
  const followingRef = useRef(true);
  const [unread, setUnread] = useState(false);
  const currentIndex = CREATION_STEPS.findIndex((step) => step.stage === stage);
  const steps = stage === "chapter" ? [creationStep("chapter")] : CREATION_STEPS;
  const status = phase === "error" ? "创作已暂停" : currentRequest ? "等待你的输入" : "AI 正在处理";
  const StatusIcon = phase === "error" ? CircleAlert : currentRequest ? MessageSquare : LoaderCircle;

  useEffect(() => {
    if (!timeline.length) { followingRef.current = true; setUnread(false); }
    if (followingRef.current) bottomRef.current?.scrollIntoView?.({ behavior: "instant", block: "end" });
    else setUnread(true);
  }, [timeline]);

  const close = (): void => { void window.agent.stop(); onClose(); };
  const jumpTo = (target: Stage | null): void => {
    const section = streamRef.current?.querySelector(`[data-stage-anchor="${target ?? "start"}"]`);
    if (section) {
      followingRef.current = false;
      section.scrollIntoView?.({ behavior: "smooth", block: "start" });
    }
  };
  const latest = (): void => {
    followingRef.current = true; setUnread(false);
    bottomRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  };
  const waitingFor = (id: string): boolean => requests.some((request) => {
    if (request.activityId === id) return true;
    return timeline.some((entry) => entry.kind === "activity" && entry.activity.id === request.activityId && entry.activity.parentId === id);
  });

  const renderEntry = (entry: TimelineEntry) => {
    switch (entry.kind) {
      case "stage": {
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
          <span className="creation-card-label">创作成果</span><span className="creation-card-meta"><Check size={13} aria-hidden />已整理</span></div>
        <ViewCard view={entry.view} /></section>;
      case "activity": {
        const parent = timeline.find((item) => item.kind === "activity" && item.activity.id === entry.activity.parentId);
        return <ActivityCard activity={entry.activity} waiting={waitingFor(entry.activity.id)}
          parentName={parent?.kind === "activity" ? parent.activity.name : undefined} />;
      }
      case "request": {
        if (entry.answer !== undefined) return <AnswerCard entry={entry} />;
        const active = entry.request.id === currentRequest?.id && !entry.interrupted;
        return <section className={`creation-card creation-input-card ${active ? "is-current" : "is-queued"}`}>
          <div className="creation-card-heading"><span className="creation-avatar input"><MessageSquare size={17} aria-hidden /></span>
            <span className="creation-card-label">{entry.interrupted ? "输入已中断" : active ? "轮到你了" : "接下来的问题"}</span>
            <span className="creation-card-meta">{active ? "等待输入" : entry.interrupted ? "继续流程后重新开始" : "等待前一项回答"}</span></div>
          {active ? <QuestionCard key={entry.request.id} request={entry.request} appearance="workbench" autoFocus={followingRef.current} onAnswer={answer} />
            : <p>{questionTitle(entry.request.ask.prompt)}</p>}
        </section>;
      }
    }
  };

  return <div className="creation-workbench">
    <header className="creation-header workbench-header">
      <button className="icon-btn" onClick={close} title="终止创作并返回书库" aria-label="返回书库"><ArrowLeft className="ic-btn" aria-hidden /></button>
      <div className="creation-page-title"><strong>{resumeRunId ? "继续创作流程" : "新建小说"}</strong><span>创作工作台</span></div>
      <span className="creation-header-note"><ShieldCheck size={14} aria-hidden />已确认内容自动保存</span>
      <span className={`creation-status ${phase === "error" ? "failed" : currentRequest ? "waiting" : "running"}`} role="status"><StatusIcon size={14} aria-hidden />{status}</span>
    </header>
    <div className="creation-workspace">
      <aside className="creation-sidebar">
        <div className="creation-sidebar-heading"><span className="creation-eyebrow">创作路线</span><span>{Math.max(1, currentIndex + 1)} / {steps.length}</span></div>
        <nav aria-label="小说创作阶段"><ol className="creation-stage-list">
          {steps.map((step, index) => {
            const active = step.stage === stage;
            const done = stage !== "chapter" && index < currentIndex;
            const available = active || done;
            return <li key={step.stage ?? "start"} className={active ? "active" : done ? "done" : "future"}>
              <button disabled={!available} onClick={() => jumpTo(step.stage)} aria-current={active ? "step" : undefined}>
                <span className="creation-step-number">{done ? <Check size={14} aria-hidden /> : String(index + 1).padStart(2, "0")}</span>
                <span>{step.label}</span>{active ? <span className="creation-step-dot" /> : null}</button></li>;
          })}
        </ol></nav>
        <div className="creation-sidebar-note"><span className="creation-avatar agent"><Feather size={18} aria-hidden /></span><h3>你的灵感，逐步成形</h3>
          <p>输入、AI 调用与创作成果都会留在右侧，随时可以回看。</p>
          <div><MessageSquare size={13} aria-hidden />已记录 {timeline.filter((entry) => entry.kind === "request" && entry.answer !== undefined).length} 次回答</div>
        </div>
      </aside>
      <main className="creation-stream" ref={streamRef} onScroll={() => {
        const node = streamRef.current;
        if (!node) return;
        followingRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 96;
        if (followingRef.current) setUnread(false);
      }}>
        <div className="creation-stream-content">
          <section className="creation-card creation-welcome" data-stage-anchor="start">
            <span className="creation-avatar welcome"><Feather size={25} aria-hidden /></span>
            <div><span className="creation-eyebrow">从灵感到故事</span><h1>让故事，从一个想法开始</h1>
              <p>你负责想象，AI 陪你搭建世界、塑造人物、梳理故事脉络。</p></div>
            <span className="creation-welcome-badge"><Sparkles size={14} aria-hidden />AI 协作创作</span>
          </section>
          {timeline.map((entry) => <div className="creation-entry" key={entry.key}>{renderEntry(entry)}</div>)}
          {phase === "running" && !currentRequest ? <section className="creation-card creation-thinking" role="status"><LoaderCircle size={17} aria-hidden />
            <span>{timeline.length ? "正在整理你的故事，下一步即将开始…" : "正在准备创作空间…"}</span><span className="thinking-dots"><i /><i /><i /></span></section> : null}
          {phase === "error" ? <section className="creation-card error-panel creation-error">
            <span className="creation-avatar error"><CircleAlert size={20} aria-hidden /></span><h3>创作暂时停在这里</h3>
            <p>{error ?? (exitCode !== null ? `创作进程已退出（${exitCode}）` : "发生错误")}</p>
            <p className="hint">已确认的结果已保存。继续后会从未完成的阶段重新开始问答。</p>
            <div className="row center"><button className="primary" onClick={start}>继续未完成流程</button><button onClick={close}>返回书库</button></div>
          </section> : null}
          <div ref={bottomRef} className="creation-bottom" />
        </div>
      </main>
      {unread ? <button className="creation-latest" onClick={latest}><ArrowDown size={15} aria-hidden />回到最新内容</button> : null}
    </div>
  </div>;
}

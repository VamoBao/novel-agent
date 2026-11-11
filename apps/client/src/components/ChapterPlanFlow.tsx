import { useEffect, useState } from "react";
import { ArrowDown, ArrowLeft, BookOpen, ChevronDown, CircleAlert, ClipboardList, ListOrdered, LoaderCircle, MessageSquare, ShieldCheck, Sparkles } from "lucide-react";
import { useAgentSession } from "../hooks/use-agent-session";
import { useTimelineScroll } from "../hooks/use-timeline-scroll";
import { SessionTimeline } from "./creation/SessionTimeline";
import "./creation/creation-workbench.css";
import "./chapter-planning/chapter-plan-workbench.css";

interface ChapterPlanFlowProps {
  novelId: string;
  novelName: string;
  actNodeId: string;
  actName: string;
  partName?: string;
  actSummary?: string | null;
  keyPlotPoints?: string[] | null;
  onFinished: (novelId: string) => void;
  onClose: () => void;
}

/** 单幕规划工作台：资料导航与真实事件流，共用创作页的输入、活动、历史与恢复契约。 */
export function ChapterPlanFlow({ novelId, novelName, actNodeId, actName, partName, actSummary, keyPlotPoints, onFinished, onClose }: ChapterPlanFlowProps) {
  const { phase, timeline, requests, currentRequest, error, exitCode, answer, start } = useAgentSession({
    startOptions: { mode: "plan-chapters", novelId, actNodeId }, onFinished,
  });
  const { bottomRef, streamRef, followingRef, unread, onScroll, scrollTo, latest } = useTimelineScroll(timeline);
  const [contextOpen, setContextOpen] = useState(() => window.matchMedia("(min-width: 961px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 961px)");
    const change = (): void => setContextOpen(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  const [activeNav, setActiveNav] = useState("overview");
  const currentEntry = timeline.find((entry) => entry.kind === "request" && entry.request.id === currentRequest?.id);
  const planEntry = timeline.findLast((entry) => (entry.kind === "view" && entry.view.kind === "chapter-plan")
    || (entry.kind === "request" && entry.request.ask.type === "confirm" && entry.request.ask.view?.kind === "chapter-plan"));
  const answers = timeline.filter((entry) => entry.kind === "request" && entry.answer !== undefined).length;
  const status = phase === "error" ? "规划已暂停" : currentRequest ? "等待你的输入" : "AI 正在规划";
  const StatusIcon = phase === "error" ? CircleAlert : currentRequest ? MessageSquare : LoaderCircle;
  const close = (): void => { void window.agent.stop(); onClose(); };
  const navigate = (key: string, entryKey?: number): void => {
    const target = streamRef.current?.querySelector(entryKey === undefined ? ".chapter-intro" : `[data-entry-key="${entryKey}"]`);
    if (!target) return;
    if (key === "overview") setContextOpen(true);
    setActiveNav(key); scrollTo(target);
  };

  return <div className="creation-workbench chapter-plan-workbench">
    <header className="creation-header workbench-header">
      <button className="icon-btn" onClick={close} title="终止章节规划并返回书库" aria-label="返回书库"><ArrowLeft className="ic-btn" aria-hidden /></button>
      <div className="creation-page-title"><strong>章节规划</strong><span>把一幕故事，铺展成章</span></div>
      <span className="creation-header-note"><ShieldCheck size={14} aria-hidden />确认后保存章节方案</span>
      <span className={`creation-status ${phase === "error" ? "failed" : currentRequest ? "waiting" : "running"}`} role="status"><StatusIcon size={14} aria-hidden />{status}</span>
    </header>
    <div className="creation-workspace">
      <aside className="creation-sidebar chapter-sidebar" aria-label="本幕规划资料">
        <details className="chapter-context" open={contextOpen} onToggle={(event) => setContextOpen(event.currentTarget.open)}>
          <summary><span className="chapter-context-icon"><BookOpen size={18} aria-hidden /></span><span><span className="creation-eyebrow">本次规划</span>
            <strong>{actName}</strong><span className="chapter-novel-name">《{novelName}》{partName ? ` · ${partName}` : ""}</span></span><ChevronDown size={15} className="chapter-context-chevron" aria-hidden /></summary>
          <div className="chapter-context-body">
            <h2>本幕梗概</h2><p>{actSummary || "本幕资料由 AI 从故事大纲中读取。"}</p>
            {keyPlotPoints?.length ? <><h2>关键情节点</h2><ol>{keyPlotPoints.map((point, index) => <li key={index}>{point}</li>)}</ol></> : null}
          </div>
        </details>
        <nav className="chapter-nav" aria-label="章节规划导航">
          <span className="creation-eyebrow">本次会话</span>
          {[
            { key: "overview", label: "本幕概要", Icon: BookOpen, enabled: true, entry: undefined },
            { key: "current", label: "当前交互", Icon: MessageSquare, enabled: !!currentEntry, entry: currentEntry?.key },
            { key: "plan", label: "章节方案", Icon: ListOrdered, enabled: !!planEntry, entry: planEntry?.key },
          ].map(({ key, label, Icon, enabled, entry }) => <button key={key} disabled={!enabled}
            aria-current={activeNav === key ? "location" : undefined} onClick={() => navigate(key, entry)}>
            <Icon size={16} aria-hidden /><span>{label}</span>{key === "current" && currentRequest ? <span className="chapter-nav-dot" /> : null}</button>)}
        </nav>
        <div className="creation-sidebar-note chapter-sidebar-note"><span className="creation-avatar agent"><ClipboardList size={18} aria-hidden /></span>
          <h3>先理清脉络，再落笔成章</h3><p>逐章梳理情节、人物登场与伏笔安排。你可以确认方案，也可以提出修改意见。</p>
          <div><MessageSquare size={13} aria-hidden />已记录 {answers} 次回答</div>
        </div>
      </aside>
      <main className="creation-stream" aria-label="章节规划交互记录" ref={streamRef} onScroll={onScroll}>
        <div className="creation-stream-content">
          <section className="creation-card creation-welcome chapter-intro">
            <span className="creation-avatar welcome"><ListOrdered size={25} aria-hidden /></span>
            <div><span className="creation-eyebrow">本幕章节工作台</span><h1>{actName}</h1><p>从这一幕的关键情节出发，一起确定章节节奏、人物登场与伏笔安排。</p></div>
            <span className="creation-welcome-badge"><Sparkles size={14} aria-hidden />AI 协作规划</span>
          </section>
          <SessionTimeline timeline={timeline} requests={requests} currentRequest={currentRequest} onAnswer={answer}
            autoFocus={followingRef.current} showStages={false} resultLabel="章节方案" />
          {phase === "running" && !currentRequest ? <section className="creation-card creation-thinking" role="status"><LoaderCircle size={17} aria-hidden />
            <span>{timeline.length ? "正在整理本幕章节与相关资料…" : "正在读取故事大纲，准备本幕规划…"}</span><span className="thinking-dots"><i /><i /><i /></span></section> : null}
          {phase === "error" ? <section className="creation-card error-panel creation-error">
            <span className="creation-avatar error"><CircleAlert size={20} aria-hidden /></span><h3>章节规划暂时停在这里</h3>
            <p>{error ?? (exitCode !== null ? `规划进程已退出（${exitCode}）` : "发生错误")}</p>
            <p className="hint">已确认的结果已保存。继续后会从未完成的阶段重新开始问答。</p>
            <div className="row center"><button className="primary" onClick={() => { setActiveNav("overview"); start(); }}>继续未完成流程</button><button onClick={close}>返回书库</button></div>
          </section> : null}
          <div ref={bottomRef} className="creation-bottom" />
        </div>
      </main>
      {unread ? <button className="creation-latest" onClick={latest}><ArrowDown size={15} aria-hidden />回到最新内容</button> : null}
    </div>
  </div>;
}

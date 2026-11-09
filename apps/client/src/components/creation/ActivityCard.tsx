import { useEffect, useState } from "react";
import { Bot, Check, ChevronDown, CircleAlert, Clock3, LoaderCircle, Wrench } from "lucide-react";
import type { Activity } from "@novel/shared";
import { TOOL_LABELS } from "./creation-content";

function DetailText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  return <>
    <pre>{expanded ? text : text.slice(0, 1200)}{!expanded && text.length > 1200 ? "…" : ""}</pre>
    {text.length > 1200 ? <button className="activity-expand" onClick={() => setExpanded(!expanded)}>
      {expanded ? "收起内容" : "展开完整内容"}
    </button> : null}
  </>;
}

/** 原生 details 保持键盘操作与折叠状态，活动快照更新不会重建卡片。 */
export function ActivityCard({ activity, waiting, parentName }: {
  activity: Activity; waiting: boolean; parentName?: string;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (activity.status !== "running") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [activity.status]);
  const status = activity.status === "running" && waiting ? "waiting" : activity.status;
  const label = { running: "执行中", waiting: "等待输入", completed: "已完成", failed: "执行失败", interrupted: "已中断" }[status];
  const StatusIcon = status === "running" ? LoaderCircle : status === "completed" ? Check
    : status === "waiting" || status === "interrupted" ? Clock3 : CircleAlert;
  const Icon = activity.kind === "agent" ? Bot : Wrench;
  const elapsed = Math.max(0, ((activity.endedAt ?? now) - activity.startedAt) / 1000);
  const duration = elapsed < 60 ? `${elapsed.toFixed(elapsed < 1 ? 1 : 0)} 秒` : `${Math.floor(elapsed / 60)} 分 ${Math.floor(elapsed % 60)} 秒`;
  return (
    <details className="creation-card activity-card" data-status={status} data-kind={activity.kind}>
      <summary>
        <span className={`creation-avatar ${activity.kind}`}><Icon size={18} aria-hidden /></span>
        <span className="activity-identity">
          <span className="activity-title">{TOOL_LABELS[activity.name] ?? activity.name}</span>
          <span className="activity-subtitle">{activity.kind === "agent" ? "AI 创作助手" : `${parentName ?? "创作助手"} · ${activity.name}`}</span>
        </span>
        <span className={`creation-status ${status}`}><StatusIcon size={13} aria-hidden />{label}</span>
        <span className="activity-duration">{duration}</span>
        <ChevronDown className="activity-chevron" size={16} aria-hidden />
      </summary>
      {activity.status === "failed" && activity.output ? <p className="activity-failure">{activity.output.slice(0, 200)}</p> : null}
      <div className="activity-details">
        {activity.input ? <div><h4>{activity.kind === "agent" ? "任务输入" : "调用参数"}</h4><DetailText text={activity.input} /></div> : null}
        {activity.output ? <div><h4>执行结果</h4><DetailText text={activity.output} /></div>
          : <p className="creation-muted">{waiting ? "等待你完成下方的输入或确认，之后会继续执行。" : "正在处理，结果会在这里更新。"}</p>}
      </div>
    </details>
  );
}

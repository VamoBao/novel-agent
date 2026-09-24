import { useEffect, useRef } from "react";
import { useAgentSession } from "../hooks/use-agent-session";
import { QuestionCard } from "./QuestionCard";
import { ViewCard } from "./ViewCard";

interface ChapterPlanFlowProps {
  novelId: string;
  novelName: string;
  actNodeId: string;
  actName: string;
  /** run_finished 后上报：父级关闭页面、刷新详情并保持选中该幕 */
  onFinished: (novelId: string) => void;
  /** 用户主动关闭（终止 agent 并返回浏览页） */
  onClose: () => void;
}

/**
 * 单幕章节规划问答流（独立页面内容）：挂载即以 plan-chapters 模式 spawn agent，
 * 章节 Agent 展示章节规划确认视图，用户确认或提修改意见（与创作流同一确认门）；
 * 头部提供「返回浏览页」（终止 agent，已确认入库的章节保留）。
 * 单阶段会话不展示 StageBar（六阶段进度条为新建小说全流程专用）。
 */
export function ChapterPlanFlow({
  novelId,
  novelName,
  actNodeId,
  actName,
  onFinished,
  onClose,
}: ChapterPlanFlowProps) {
  const { phase, flow, requests, currentRequest, error, exitCode, answer, start } =
    useAgentSession({
      startOptions: { mode: "plan-chapters", novelId, actNodeId },
      onFinished,
    });
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [flow.length, requests.length]);

  /** 返回浏览页 = 终止 agent（未确认的规划不入库，已确认入库的章节保留） */
  const close = (): void => {
    void window.agent.stop();
    onClose();
  };

  return (
    <>
      <div className="creation-header">
        <button className="icon-btn" onClick={close} title="终止章节规划并返回浏览页">
          ←
        </button>
        <strong>
          📑 章节规划 ·《{novelName}》· {actName}
        </strong>
      </div>
      <main className="flow">
        {flow.map((item, index) =>
          item.kind === "notify" ? (
            <p key={index} className="notify">
              {item.text}
            </p>
          ) : (
            <ViewCard key={index} view={item.view} />
          ),
        )}

        {currentRequest ? (
          <QuestionCard request={currentRequest} onAnswer={answer} />
        ) : null}

        {phase === "error" ? (
          <div className="error-panel">
            <p>❌ {error ?? (exitCode !== null ? `agent 已退出（exit ${exitCode}）` : "发生错误")}</p>
            <p className="hint">v1 无会话恢复；重启即重新开始本幕规划（章节一旦确认入库即保留，重复规划会被拒绝）。</p>
            <div className="row center">
              <button className="primary" onClick={start}>
                重启 agent
              </button>
              <button onClick={close}>返回浏览页</button>
            </div>
          </div>
        ) : null}

        <div ref={bottomRef} />
      </main>
    </>
  );
}

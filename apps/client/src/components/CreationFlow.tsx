import { useEffect, useRef } from "react";
import { useAgentSession } from "../hooks/use-agent-session";
import { QuestionCard } from "./QuestionCard";
import { StageBar } from "./StageBar";
import { ViewCard } from "./ViewCard";

interface CreationFlowProps {
  /** run_finished 后上报：父级负责关闭覆盖层、刷新书库并选中新作 */
  onFinished: (novelId: string) => void;
  /** 用户主动关闭（终止 agent 并返回书库） */
  onClose: () => void;
}

/**
 * 创作问答流（独立创作页内容）：挂载即 spawn agent 开始一次创作会话；
 * 头部提供「返回书库」（终止 agent，已完成部分已落库）。
 * 会话消息泵抽至 useAgentSession（与单幕章节规划页共用）。
 */
export function CreationFlow({ onFinished, onClose }: CreationFlowProps) {
  const { phase, flow, stage, requests, currentRequest, error, exitCode, answer, start } =
    useAgentSession({ onFinished });
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [flow.length, requests.length]);

  /** 返回书库 = 终止 agent（v1 无优雅取消，state 已增量落库） */
  const close = (): void => {
    void window.agent.stop();
    onClose();
  };

  return (
    <>
      <div className="creation-header">
        <button className="icon-btn" onClick={close} title="终止创作并返回书库">
          ←
        </button>
        <strong>✍️ 新建小说</strong>
        {phase === "running" ? <StageBar current={stage} /> : null}
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
            <p className="hint">v1 无会话恢复，重启即从头开始（已完成部分已落库）。</p>
            <div className="row center">
              <button className="primary" onClick={start}>
                重启 agent
              </button>
              <button onClick={close}>返回书库</button>
            </div>
          </div>
        ) : null}

        <div ref={bottomRef} />
      </main>
    </>
  );
}

import { useEffect, useRef } from "react";
import { useAgentSession } from "../hooks/use-agent-session";
import { QuestionCard } from "./QuestionCard";
import { StageBar } from "./StageBar";
import { ViewCard } from "./ViewCard";

interface CreationFlowProps {
  /** 从书库恢复未完成流程（流程种类由服务端判定） */
  resumeRunId?: string;
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
export function CreationFlow({ resumeRunId, onFinished, onClose }: CreationFlowProps) {
  const { phase, flow, stage, requests, currentRequest, error, exitCode, answer, start } =
    useAgentSession({
      startOptions: resumeRunId ? { mode: "resume", runId: resumeRunId } : undefined,
      onFinished,
    });
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [flow.length, requests.length]);

  /** 返回书库 = 终止 agent，已确认结果保留供下次继续 */
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
        <strong>{resumeRunId ? "✍️ 继续创作流程" : "✍️ 新建小说"}</strong>
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
            <p className="hint">已确认的结果已保存。继续后会从未完成的阶段重新开始问答。</p>
            <div className="row center">
              <button className="primary" onClick={start}>
                继续未完成流程
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

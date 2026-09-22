import { useEffect, useRef, useState } from "react";
import type { AgentMessage, Stage, View } from "@novel/shared";
import { QuestionCard } from "./QuestionCard";
import { StageBar } from "./StageBar";
import { ViewCard } from "./ViewCard";

type RequestMsg = Extract<AgentMessage, { type: "request" }>;
type Phase = "running" | "error";
type FlowItem = { kind: "notify"; text: string } | { kind: "view"; view: View };

interface CreationFlowProps {
  /** run_finished 后上报：父级负责关闭覆盖层、刷新书库并选中新作 */
  onFinished: (novelId: string) => void;
  /** 用户主动关闭（终止 agent 并返回书库） */
  onClose: () => void;
}

/**
 * 创作问答流（独立创作页内容）：挂载即 spawn agent 开始一次创作会话；
 * 头部提供「返回书库」（终止 agent，已完成部分已落库）。
 */
export function CreationFlow({ onFinished, onClose }: CreationFlowProps) {
  const [phase, setPhase] = useState<Phase>("running");
  const [flow, setFlow] = useState<FlowItem[]>([]);
  const [stage, setStage] = useState<Stage | null>(null);
  /** 到达但未作答的提问队列（agent 侧无效应答会以新 id 重问，自然入队） */
  const [requests, setRequests] = useState<RequestMsg[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const start = (): void => {
    setPhase("running");
    setFlow([]);
    setStage(null);
    setRequests([]);
    setError(null);
    setExitCode(null);
    void window.agent.start();
  };

  useEffect(() => {
    start();
    const offMessage = window.agent.onMessage((message) => {
      switch (message.type) {
        case "hello":
          setPhase("running");
          break;
        case "notify":
          setFlow((items) => [...items, { kind: "notify", text: message.text }]);
          break;
        case "view":
          setFlow((items) => [...items, { kind: "view", view: message.view }]);
          break;
        case "stage":
          setStage(message.stage);
          break;
        case "request":
          setRequests((queue) => [...queue, message]);
          break;
        case "run_finished":
          onFinished(message.novelId);
          break;
        case "error":
          setError(message.message);
          if (message.fatal) {
            setRequests([]);
            setPhase("error");
          }
          break;
      }
    });
    const offExit = window.agent.onExit((code) => {
      setExitCode(code);
      // agent 结束但流程未完成（异常退出 / 被中断 / 用户关闭）：错误视图提供重启；
      // run_finished 先于 exit 到达，完成路径不走这里
      setError(
        code === 0
          ? "agent 已结束（本次创作未完成——被中断或输入通道关闭）"
          : `agent 异常退出（exit ${code}）`,
      );
      setRequests([]);
      setPhase((current) => (current === "running" ? "error" : current));
    });
    return () => {
      offMessage();
      offExit();
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [flow.length, requests.length]);

  const answer = (id: number, value: string | string[] | boolean | number): void => {
    setRequests((queue) => queue.filter((request) => request.id !== id));
    void window.agent.respond(id, value);
  };

  /** 返回书库 = 终止 agent（v1 无优雅取消，state 已增量落库） */
  const close = (): void => {
    void window.agent.stop();
    onClose();
  };

  const currentRequest = requests[0];

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

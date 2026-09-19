import { useEffect, useRef, useState } from "react";
import type { AgentMessage, Stage, View } from "@novel/shared";
import { QuestionCard } from "./components/QuestionCard";
import { StageBar } from "./components/StageBar";
import { ViewCard } from "./components/ViewCard";

type RequestMsg = Extract<AgentMessage, { type: "request" }>;
type Phase = "idle" | "running" | "finished" | "error";
type FlowItem = { kind: "notify"; text: string } | { kind: "view"; view: View };

export function App() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [flow, setFlow] = useState<FlowItem[]>([]);
  const [stage, setStage] = useState<Stage | null>(null);
  /** 到达但未作答的提问队列（agent 侧无效应答会以新 id 重问，自然入队） */
  const [requests, setRequests] = useState<RequestMsg[]>([]);
  const [finished, setFinished] = useState<{ novelId: string; outputPath: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
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
          setFinished({ novelId: message.novelId, outputPath: message.outputPath });
          setRequests([]);
          setPhase("finished");
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
      // agent 结束但流程未完成（异常退出 / 被中断）：进入错误视图，提供重启；
      // run_finished 先于 exit 到达，finished 状态不受影响
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

  const start = (): void => {
    setPhase("running");
    setFlow([]);
    setStage(null);
    setRequests([]);
    setError(null);
    setFinished(null);
    setExitCode(null);
    void window.agent.start();
  };

  const currentRequest = requests[0];

  return (
    <div className="app">
      <header className="header">
        <h1>📖 novel-agent 创作向导</h1>
        {phase === "running" ? <StageBar current={stage} /> : null}
      </header>

      <main className="flow">
        {phase === "idle" ? (
          <div className="idle">
            <p>通过问答收集类型、受众、世界观、角色与核心冲突，生成两级大纲。</p>
            <button className="primary" onClick={start}>
              开始创作
            </button>
          </div>
        ) : null}

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

        {phase === "finished" && finished ? (
          <div className="finished">
            <p>✅ 小说初始化完成！</p>
            <p>创作 ID：{finished.novelId}</p>
            <p>大纲已落盘：{finished.outputPath}</p>
            <button className="primary" onClick={start}>
              再来一部
            </button>
          </div>
        ) : null}

        {phase === "error" ? (
          <div className="error-panel">
            <p>❌ {error ?? (exitCode !== null ? `agent 已退出（exit ${exitCode}）` : "发生错误")}</p>
            <p className="hint">v1 无会话恢复，重启即从头开始。</p>
            <button className="primary" onClick={start}>
              重启 agent
            </button>
          </div>
        ) : null}

        <div ref={bottomRef} />
      </main>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import type { AgentMessage, AgentStartOptions, Stage, View } from "@novel/shared";

type RequestMsg = Extract<AgentMessage, { type: "request" }>;
type Phase = "running" | "error";
export type FlowItem = { kind: "notify"; text: string } | { kind: "view"; view: View };

interface UseAgentSessionOptions {
  /** 会话启动参数（重启时复用）；缺省为新建小说会话 */
  startOptions?: AgentStartOptions;
  /** run_finished 后上报：父级据此关闭页面并刷新（经 ref 持有，始终调用最新闭包） */
  onFinished: (novelId: string) => void;
}

/**
 * agent 会话共用泵：挂载即 spawn（start）、订阅消息与退出事件，维护问答流 /
 * 提问队列 / 错误视图与重启。新建小说页（CreationFlow）与单幕章节规划页
 * （ChapterPlanFlow）共用——两页始终互斥挂载，共用单例 AgentProcess。
 */
export function useAgentSession({ startOptions, onFinished }: UseAgentSessionOptions) {
  const [phase, setPhase] = useState<Phase>("running");
  const [flow, setFlow] = useState<FlowItem[]>([]);
  const [stage, setStage] = useState<Stage | null>(null);
  /** 到达但未作答的提问队列（agent 侧无效应答会以新 id 重问，自然入队） */
  const [requests, setRequests] = useState<RequestMsg[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;

  const start = (): void => {
    setPhase("running");
    setFlow([]);
    setStage(null);
    setRequests([]);
    setError(null);
    setExitCode(null);
    void window.agent.start(startOptions);
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
          finishedRef.current(message.novelId);
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
      // run_finished 先于 exit 到达，完成路径由父级卸载页面，不走这里
      setError(
        code === 0
          ? "agent 已结束（本次会话未完成——被中断或输入通道关闭）"
          : `agent 异常退出（exit ${code}）`,
      );
      setRequests([]);
      setPhase((current) => (current === "running" ? "error" : current));
    });
    return () => {
      offMessage();
      offExit();
    };
    // 挂载时启动一次；重启经 start() 显式触发（startOptions 在页面生命周期内不变）
  }, []);

  const answer = (id: number, value: string | string[] | boolean | number): void => {
    setRequests((queue) => queue.filter((request) => request.id !== id));
    void window.agent.respond(id, value);
  };

  return { phase, flow, stage, requests, currentRequest: requests[0], error, exitCode, answer, start };
}

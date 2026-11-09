import { useEffect, useReducer, useRef, useState } from "react";
import type { AgentMessage, AgentStartOptions, Stage, View } from "@novel/shared";
import { initialTimeline, timelineReducer } from "./session-timeline";

type RequestMsg = Extract<AgentMessage, { type: "request" }>;
type Phase = "running" | "error";
export type FlowItem = { kind: "notify"; text: string } | { kind: "view"; view: View };

interface UseAgentSessionOptions {
  /** 首次会话启动参数；收到流程标识后以恢复模式继续 */
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
  const requestsRef = useRef<RequestMsg[]>([]);
  const [timeline, dispatch] = useReducer(timelineReducer, initialTimeline);
  const [error, setError] = useState<string | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;
  const initialOptionsRef = useRef(startOptions);
  const runIdRef = useRef(startOptions?.mode === "resume" ? startOptions.runId : null);
  const startingRef = useRef(false);
  const generationRef = useRef(0);
  const completedRef = useRef(false);
  const endedRef = useRef(false);

  const clearRequests = (): void => {
    requestsRef.current = [];
    setRequests([]);
  };

  const start = (): void => {
    if (startingRef.current) return;
    startingRef.current = true;
    completedRef.current = false;
    endedRef.current = false;
    const generation = ++generationRef.current;
    setPhase("running");
    setFlow([]);
    setStage(null);
    clearRequests();
    dispatch({ type: "reset" });
    setError(null);
    setExitCode(null);
    void (async () => {
      try {
        // 旧进程退出后再恢复；该次 stop 的 exit 不属于新会话。
        await window.agent.stop();
        if (generation !== generationRef.current) return;
        startingRef.current = false;
        await window.agent.start(
          runIdRef.current
            ? { mode: "resume", runId: runIdRef.current }
            : initialOptionsRef.current,
        );
      } catch (error) {
        if (generation !== generationRef.current) return;
        setError(error instanceof Error ? error.message : String(error));
        setPhase("error");
        endedRef.current = true;
        clearRequests();
        dispatch({ type: "interrupt" });
      } finally {
        if (generation === generationRef.current) startingRef.current = false;
      }
    })();
  };

  useEffect(() => {
    const offMessage = window.agent.onMessage((message) => {
      if (startingRef.current || endedRef.current || completedRef.current) return;
      dispatch({ type: "message", message });
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
        case "workflow-run":
          runIdRef.current = message.runId;
          break;
        case "request":
          requestsRef.current = [...requestsRef.current, message];
          setRequests(requestsRef.current);
          break;
        case "run_finished":
          completedRef.current = true;
          finishedRef.current(message.novelId);
          break;
        case "error":
          setError(message.message);
          if (message.fatal) {
            endedRef.current = true;
            clearRequests();
            dispatch({ type: "interrupt" });
            setPhase("error");
          }
          break;
      }
    });
    const offExit = window.agent.onExit((code) => {
      if (startingRef.current || completedRef.current || endedRef.current) return;
      endedRef.current = true;
      setExitCode(code);
      // agent 结束但流程未完成（异常退出 / 被中断 / 用户关闭）：错误视图提供重启；
      // run_finished 先于 exit 到达，完成路径由父级卸载页面，不走这里
      setError(
        code === 0
          ? "agent 已结束（本次会话未完成——被中断或输入通道关闭）"
          : `agent 异常退出（exit ${code}）`,
      );
      clearRequests();
      dispatch({ type: "interrupt" });
      setPhase((current) => (current === "running" ? "error" : current));
    });
    start();
    return () => {
      generationRef.current++;
      startingRef.current = false;
      offMessage();
      offExit();
    };
    // 订阅后启动；重试始终复用首次参数或收到的流程标识。
  }, []);

  const answer = (id: number, value: string | string[] | boolean | number): void => {
    // 同一次渲染中的双击、Enter+click 也只能提交首个待答问题一次。
    if (endedRef.current || requestsRef.current[0]?.id !== id) return;
    requestsRef.current = requestsRef.current.slice(1);
    setRequests(requestsRef.current);
    dispatch({ type: "answer", id, answer: value });
    const generation = generationRef.current;
    void (async () => {
      try {
        await window.agent.respond(id, value);
      } catch (error) {
        if (generation !== generationRef.current || completedRef.current || endedRef.current) return;
        const text = error instanceof Error ? error.message : String(error);
        dispatch({ type: "delivery-error", id, error: text });
        dispatch({ type: "interrupt" });
        endedRef.current = true;
        clearRequests();
        setError(`回答发送失败：${text}`);
        setPhase("error");
      }
    })();
  };

  return { phase, flow, timeline: timeline.entries, stage, requests, currentRequest: requests[0], error, exitCode, answer, start };
}

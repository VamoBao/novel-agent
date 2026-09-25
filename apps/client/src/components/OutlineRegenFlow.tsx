import { useEffect, useRef } from "react";
import { useAgentSession } from "../hooks/use-agent-session";
import { QuestionCard } from "./QuestionCard";
import { ViewCard } from "./ViewCard";

interface OutlineRegenFlowProps {
  novelId: string;
  novelName: string;
  /** run_finished 后上报：父级关闭页面、刷新详情并重置选中（旧节点 ID 已降级失效） */
  onFinished: (novelId: string) => void;
  /** 用户主动关闭（终止 agent 并返回浏览页） */
  onClose: () => void;
}

/**
 * 大纲重新生成问答流（独立页面内容）：挂载即以 regen-outline 模式 spawn agent，
 * 先填幕数/部数表单，大纲 Agent 基于书名/logline + 世界观 + 角色生成新大纲，
 * 经确认视图「确认 / 修改意见 → 调整 → 再确认」循环，确认后新版本入库、
 * 旧大纲与已生成章节归档为历史版本。单阶段会话不展示 StageBar。
 */
export function OutlineRegenFlow({
  novelId,
  novelName,
  onFinished,
  onClose,
}: OutlineRegenFlowProps) {
  const { phase, flow, requests, currentRequest, error, exitCode, answer, start } =
    useAgentSession({
      startOptions: { mode: "regen-outline", novelId },
      onFinished,
    });
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [flow.length, requests.length]);

  /** 返回浏览页 = 终止 agent（未确认的大纲不入库，当前版本不受影响） */
  const close = (): void => {
    void window.agent.stop();
    onClose();
  };

  return (
    <>
      <div className="creation-header">
        <button className="icon-btn" onClick={close} title="终止大纲重新生成并返回浏览页">
          ←
        </button>
        <strong>🛠 重新生成大纲 ·《{novelName}》</strong>
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
            <p className="hint">
              v1 无会话恢复；重启即重新开始（未确认入库的大纲不影响库中当前版本）。
            </p>
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

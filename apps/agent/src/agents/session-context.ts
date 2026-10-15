import { AsyncLocalStorage } from "node:async_hooks";
import type { WorkflowRunStore } from "../state/workflow-run-store";

export interface AgentMessageCacheContext {
  runId: string;
  agentName: string;
  store: Pick<WorkflowRunStore, "beginTrace" | "saveTrace">;
}

const context = new AsyncLocalStorage<AgentMessageCacheContext>();

export function withAgentMessageCache<T>(value: AgentMessageCacheContext, action: () => T): T {
  return context.run(value, action);
}

export function getAgentMessageCache(): AgentMessageCacheContext | undefined {
  return context.getStore();
}

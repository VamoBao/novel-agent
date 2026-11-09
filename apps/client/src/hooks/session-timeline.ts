import type { Activity, AgentMessage, Stage, View } from "@novel/shared";

export type SessionRequest = Extract<AgentMessage, { type: "request" }>;
export type SessionAnswer = string | string[] | boolean | number;
interface EntryBase { key: number; stage: Stage | null }
export type TimelineEntry = EntryBase & (
  | { kind: "notify"; text: string; tone?: "error" }
  | { kind: "view"; view: View }
  | { kind: "stage" }
  | { kind: "activity"; activity: Activity }
  | { kind: "request"; request: SessionRequest; answer?: SessionAnswer; interrupted?: boolean; deliveryError?: string }
);

interface TimelineState { entries: TimelineEntry[]; stage: Stage | null; nextKey: number }
export type TimelineAction =
  | { type: "reset" }
  | { type: "message"; message: AgentMessage }
  | { type: "answer"; id: number; answer: SessionAnswer }
  | { type: "delivery-error"; id: number; error: string }
  | { type: "interrupt" };

export const initialTimeline: TimelineState = { entries: [], stage: null, nextKey: 1 };

/** 原位更新回答和调用快照，稳定 key 保持展开状态与输入控件生命周期。 */
export function timelineReducer(state: TimelineState, action: TimelineAction): TimelineState {
  if (action.type === "reset") return initialTimeline;
  if (action.type === "interrupt") return {
    ...state,
    entries: state.entries.map((entry) => {
      if (entry.kind === "activity" && entry.activity.status === "running") return {
        ...entry, activity: { ...entry.activity, status: "interrupted", endedAt: Date.now() },
      };
      if (entry.kind === "request" && entry.answer === undefined) return { ...entry, interrupted: true };
      return entry;
    }),
  };
  if (action.type === "answer" || action.type === "delivery-error") return {
    ...state,
    entries: state.entries.map((entry) => entry.kind === "request" && entry.request.id === action.id
      ? action.type === "answer" ? { ...entry, answer: action.answer } : { ...entry, deliveryError: action.error }
      : entry),
  };
  const message = action.message;
  const base = { key: state.nextKey, stage: state.stage };
  let entry: TimelineEntry;
  switch (message.type) {
    case "stage":
      if (message.stage === state.stage) return state;
      entry = { ...base, kind: "stage", stage: message.stage };
      return { entries: [...state.entries, entry], stage: message.stage, nextKey: state.nextKey + 1 };
    case "notify": entry = { ...base, kind: "notify", text: message.text }; break;
    case "error":
      if (message.fatal) return state; // 致命错误由带恢复动作的错误卡承接。
      entry = { ...base, kind: "notify", text: message.message, tone: "error" }; break;
    case "view": entry = { ...base, kind: "view", view: message.view }; break;
    case "request": entry = { ...base, kind: "request", request: message }; break;
    case "activity": {
      const exists = state.entries.some((item) => item.kind === "activity" && item.activity.id === message.activity.id);
      if (exists) return {
        ...state, entries: state.entries.map((item) => item.kind === "activity" && item.activity.id === message.activity.id
          ? { ...item, activity: message.activity } : item),
      };
      entry = { ...base, kind: "activity", activity: message.activity };
      break;
    }
    default: return state;
  }
  return { ...state, entries: [...state.entries, entry], nextKey: state.nextKey + 1 };
}

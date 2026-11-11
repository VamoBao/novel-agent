import type { AgentMessage, ReviewReport, ReviewStageResult, WriteProgressPhase } from "@novel/shared";

export interface ChapterWriteProgress {
  round: number;
  totalRounds: number;
  phase: WriteProgressPhase;
  stylePassScore?: number;
  report?: ReviewReport;
  stageResults: ReviewStageResult[];
}

export interface ChapterWriteSession {
  novelId: string;
  chapterNodeId: string;
  status: "preparing" | "running" | "completed" | "failed";
  replacing: boolean;
  startedAt: number;
  endedAt?: number;
  error?: string;
  progress: ChapterWriteProgress | null;
  reports: ReviewReport[];
}

export function isWriting(session: ChapterWriteSession | null | undefined): boolean {
  return session?.status === "preparing" || session?.status === "running";
}

/** 轮内分项累积、跨轮重置分项但保留报告；协议阈值优先且后续缺省消息不覆盖。 */
export function advanceWriteSession(session: ChapterWriteSession, message: Extract<AgentMessage, { type: "write-progress" }>): ChapterWriteSession {
  if (message.chapterNodeId !== session.chapterNodeId || !isWriting(session)) return session;
  const previous = session.progress;
  const stageResults = previous?.round === message.round ? previous.stageResults : [];
  return {
    ...session, status: "running",
    progress: {
      round: message.round, totalRounds: message.totalRounds, phase: message.phase,
      stylePassScore: message.stylePassScore ?? previous?.stylePassScore,
      report: message.report ?? previous?.report,
      stageResults: message.stageResult
        ? [...stageResults.filter((item) => item.phase !== message.stageResult?.phase), message.stageResult]
        : stageResults,
    },
    reports: message.report
      ? [...session.reports.filter((report) => report.round !== message.report?.round), message.report].sort((a, b) => a.round - b.round)
      : session.reports,
  };
}

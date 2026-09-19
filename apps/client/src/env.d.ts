/// <reference types="vite/client" />
import type { AgentMessage } from "@novel/shared";

declare global {
  interface Window {
    agent: {
      start: () => Promise<void>;
      respond: (id: number, answer: string | string[] | boolean | number) => Promise<void>;
      onMessage: (callback: (message: AgentMessage) => void) => () => void;
      onExit: (callback: (code: number) => void) => () => void;
    };
  }
}

export {};

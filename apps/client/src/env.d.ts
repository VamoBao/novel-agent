/// <reference types="vite/client" />
import type { AgentMessage, NovelDetail, NovelListItem } from "@novel/shared";

declare global {
  interface Window {
    agent: {
      start: () => Promise<void>;
      stop: () => Promise<void>;
      respond: (id: number, answer: string | string[] | boolean | number) => Promise<void>;
      onMessage: (callback: (message: AgentMessage) => void) => () => void;
      onExit: (callback: (code: number) => void) => () => void;
      listNovels: () => Promise<NovelListItem[]>;
      getNovelDetail: (novelId: string) => Promise<NovelDetail>;
      isAutostart: () => boolean;
      autoSelectNovelId: () => string | null;
    };
  }
}

export {};

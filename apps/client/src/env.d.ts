/// <reference types="vite/client" />
import type { AgentMessage, AgentStartOptions, NovelDetail, NovelListItem } from "@novel/shared";

declare global {
  interface Window {
    agent: {
      start: (options?: AgentStartOptions) => Promise<void>;
      stop: () => Promise<void>;
      respond: (id: number, answer: string | string[] | boolean | number) => Promise<void>;
      onMessage: (callback: (message: AgentMessage) => void) => () => void;
      onExit: (callback: (code: number) => void) => () => void;
      listNovels: () => Promise<NovelListItem[]>;
      getNovelDetail: (novelId: string) => Promise<NovelDetail>;
      renameNovel: (novelId: string, name: string) => Promise<NovelListItem>;
      setNovelPinned: (novelId: string, pinned: boolean) => Promise<NovelListItem>;
      setNovelFavorite: (novelId: string, favorite: boolean) => Promise<NovelListItem>;
      deleteNovel: (novelId: string) => Promise<{ deleted: string }>;
      isAutostart: () => boolean;
      autoSelectNovelId: () => string | null;
    };
  }
}

export {};

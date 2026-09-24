import { contextBridge, ipcRenderer } from "electron";
import type { AgentMessage, AgentStartOptions, NovelDetail, NovelListItem } from "@novel/shared";

/**
 * 渲染进程唯一入口：contextBridge 暴露最小 API。
 * 消息经 main 进程 zod 复验后才到达，renderer 直接信任结构。
 */
contextBridge.exposeInMainWorld("agent", {
  /** 启动 agent 会话；options 选择会话模式（新建小说 / 单幕章节规划），缺省新建 */
  start: (options?: AgentStartOptions): Promise<void> =>
    ipcRenderer.invoke("agent:start", options),
  stop: (): Promise<void> => ipcRenderer.invoke("agent:stop"),
  respond: (id: number, answer: string | string[] | boolean | number): Promise<void> =>
    ipcRenderer.invoke("agent:respond", id, answer),
  onMessage: (callback: (message: AgentMessage) => void): (() => void) => {
    const listener = (_event: unknown, message: AgentMessage) => callback(message);
    ipcRenderer.on("agent:message", listener as never);
    return () => ipcRenderer.removeListener("agent:message", listener as never);
  },
  onExit: (callback: (code: number) => void): (() => void) => {
    const listener = (_event: unknown, code: number) => callback(code);
    ipcRenderer.on("agent:exit", listener as never);
    return () => ipcRenderer.removeListener("agent:exit", listener as never);
  },
  /** 书库只读查询（main 进程 spawn 查询 CLI，结构经 shared schema 复验） */
  listNovels: (): Promise<NovelListItem[]> => ipcRenderer.invoke("library:list"),
  getNovelDetail: (novelId: string): Promise<NovelDetail> =>
    ipcRenderer.invoke("library:get", novelId),
  /** 书库管理（右键菜单）：返回更新后的列表项 / 被删 ID */
  renameNovel: (novelId: string, name: string): Promise<NovelListItem> =>
    ipcRenderer.invoke("library:rename", novelId, name),
  setNovelPinned: (novelId: string, pinned: boolean): Promise<NovelListItem> =>
    ipcRenderer.invoke("library:setPinned", novelId, pinned),
  setNovelFavorite: (novelId: string, favorite: boolean): Promise<NovelListItem> =>
    ipcRenderer.invoke("library:setFavorite", novelId, favorite),
  deleteNovel: (novelId: string): Promise<{ deleted: string }> =>
    ipcRenderer.invoke("library:delete", novelId),
  /** 诊断钩子：无头冒烟自动打开创作覆盖层（preload 沙箱关闭，可直接读环境变量） */
  isAutostart: (): boolean => process.env.NOVEL_CLIENT_AUTOSTART === "1",
  /** 诊断钩子：无头冒烟自动选中小说并预览首个可用节点 */
  autoSelectNovelId: (): string | null => process.env.NOVEL_CLIENT_SELECT ?? null,
});

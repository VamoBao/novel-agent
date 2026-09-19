import { contextBridge, ipcRenderer } from "electron";
import type { AgentMessage } from "@novel/shared";

/**
 * 渲染进程唯一入口：contextBridge 暴露最小 API。
 * 消息经 main 进程 zod 复验后才到达，renderer 直接信任结构。
 */
contextBridge.exposeInMainWorld("agent", {
  start: (): Promise<void> => ipcRenderer.invoke("agent:start"),
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
});

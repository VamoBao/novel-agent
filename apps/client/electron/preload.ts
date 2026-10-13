import { contextBridge, ipcRenderer } from "electron";
import type { AppSettings } from "./settings";
import type {
  AgentMessage,
  AgentStartOptions,
  Character,
  CharacterEntry,
  CharacterMigrationEntry,
  CharacterMigrationPatch,
  Foreshadow,
  ForeshadowEntry,
  NewCharacterMigration,
  SaveCharacterMigration,
  NovelDetail,
  NovelListItem,
  StyleReferenceEntry,
} from "@novel/shared";

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
  /** 角色管理（新增）：返回带 version 的角色条目（version=1 即固定基准） */
  addCharacter: (novelId: string, character: Character): Promise<CharacterEntry> =>
    ipcRenderer.invoke("library:addCharacter", novelId, character),
  /** 角色迁移管理（固定基准之上的人物变化计划）：新建 / 编辑 / 确认 / 取消 */
  saveMigration: (novelId: string, characterId: string, request: SaveCharacterMigration): Promise<CharacterMigrationEntry> =>
    ipcRenderer.invoke("library:saveMigration", novelId, characterId, request),
  addMigration: (
    novelId: string,
    characterId: string,
    input: NewCharacterMigration,
  ): Promise<CharacterMigrationEntry> =>
    ipcRenderer.invoke("library:addMigration", novelId, characterId, input),
  updateMigration: (
    novelId: string,
    migrationId: string,
    patch: CharacterMigrationPatch,
  ): Promise<CharacterMigrationEntry> =>
    ipcRenderer.invoke("library:updateMigration", novelId, migrationId, patch),
  confirmMigration: (novelId: string, migrationId: string): Promise<CharacterMigrationEntry> =>
    ipcRenderer.invoke("library:confirmMigration", novelId, migrationId),
  cancelMigration: (novelId: string, migrationId: string): Promise<CharacterMigrationEntry> =>
    ipcRenderer.invoke("library:cancelMigration", novelId, migrationId),
  updateForeshadow: (novelId: string, foreshadowId: string, foreshadow: Foreshadow): Promise<ForeshadowEntry> =>
    ipcRenderer.invoke("library:updateForeshadow", novelId, foreshadowId, foreshadow),
  /** 参考文风管理（新增 / 编辑 / 删除）：返回文风条目（删除返回被删 ID） */
  addStyle: (
    novelId: string,
    style: { name: string; content: string; enabled?: boolean },
  ): Promise<StyleReferenceEntry> => ipcRenderer.invoke("library:addStyle", novelId, style),
  updateStyle: (
    novelId: string,
    styleId: string,
    style: { name: string; content: string; enabled: boolean },
  ): Promise<StyleReferenceEntry> =>
    ipcRenderer.invoke("library:updateStyle", novelId, styleId, style),
  deleteStyle: (styleId: string): Promise<{ deleted: string }> =>
    ipcRenderer.invoke("library:deleteStyle", styleId),
  /** 模型设置读写（设置弹窗）：明文 JSON 于 userData（优先级 设置 > .env > 继承环境变量） */
  getSettings: (): Promise<{ settings: AppSettings; filePath: string }> =>
    ipcRenderer.invoke("settings:get"),
  saveSettings: (settings: AppSettings): Promise<{ settings: AppSettings; filePath: string }> =>
    ipcRenderer.invoke("settings:save", settings),
  /** 诊断钩子：无头冒烟自动打开创作覆盖层（preload 沙箱关闭，可直接读环境变量） */
  isAutostart: (): boolean => process.env.NOVEL_CLIENT_AUTOSTART === "1",
  /** 诊断钩子：无头冒烟自动选中小说并预览首个可用节点 */
  autoSelectNovelId: (): string | null => process.env.NOVEL_CLIENT_SELECT ?? null,
});

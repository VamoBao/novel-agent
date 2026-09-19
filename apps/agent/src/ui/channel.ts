import type { Stage, View } from "@novel/shared";

/**
 * 交互通道：agent 与用户之间的全部交互（提问、确认、展示）都经此接口，
 * 业务层（workflows / tools / agents）只依赖本接口，不触碰具体实现。
 *
 * 实现：
 * - CliChannel（ui/cli-channel）：终端实现，包装 cli/prompt 原语
 * - ProtocolChannel：stdio JSON 协议实现，由 Electron 客户端驱动
 * - FakeChannel（ui/fake-channel）：测试脚本化应答
 *
 * 约定：任一 ask* 在通道关闭/用户中止时抛 UserAbortedError；
 * 唯一例外是 askLine（返回 null），供 ask_user 工具把「用户已终止」
 * 告知模型优雅收尾，而非直接中止整个工作流。
 */
export interface UiChannel {
  /** 原始一行输入；通道已关闭返回 null（仅 ask_user 工具使用） */
  askLine(prompt: string): Promise<string | null>;

  /** 一行文本；optional 时空串直接返回，否则重问直至非空 */
  askText(prompt: string, opts?: { optional?: boolean }): Promise<string>;

  /** 单选；allowCustom 时 UI 须提供自定义输入入口 */
  askSelect(
    prompt: string,
    options: readonly string[],
    opts?: { allowCustom?: boolean },
  ): Promise<string>;

  /** 多选，返回选中的选项文本（按输入顺序去重） */
  askMultiSelect(prompt: string, options: readonly string[]): Promise<string[]>;

  /** 是/否确认；view 会与提问原子绑定展示（字段摘要/角色卡/大纲等确认门） */
  askConfirm(prompt: string, opts?: { default?: boolean; view?: View }): Promise<boolean>;

  /** 整数输入：范围校验，直接回车取默认值 */
  askInt(prompt: string, opts: { min: number; max: number; default: number }): Promise<number>;

  /** 单向文本提示（阶段标记、进度说明） */
  notify(text: string): void;

  /** 阶段切换（type/audience/worldview/character/conflict/outline）；CLI 实现为静默（文本标记已有） */
  stage(stage: Stage): void;

  /** 单向结构化展示（世界观/冲突等阶段性成果、大纲全量展示） */
  present(view: View): void;

  /** 通道收尾（关闭底层输入流等）；工作流结束或中止时调用 */
  close(): void;
}

import type { Activity } from "@novel/shared";
import type { ToolSet } from "ai";
import type { UiChannel } from "../ui/channel";
import { withActivityScope } from "../ui/activity-scope";

export interface AgentActivityOptions {
  channel: UiChannel;
  name: string;
  input?: string;
}

/** 单轮结构化模型调用也使用相同活动出口。 */
export async function runAgentActivity<T>(options: AgentActivityOptions, action: () => Promise<T>): Promise<T> {
  const activity = new AgentActivity(options);
  try {
    const result = await action();
    activity.finish(result);
    return result;
  } catch (error) {
    activity.finish(error, true);
    throw error;
  }
}

/** 只发送业务摘要，过滤工具数据内的标识、文件路径与连接凭据。 */
function summary(value: unknown): string {
  if (value instanceof Error) return value.message.slice(0, 12000);
  if (typeof value === "string") return value.slice(0, 12000);
  try {
    return (JSON.stringify(value, (key, item: unknown) =>
      /(?:^id$|Id$|Ids$|_id$|_ids$)/.test(key) || /api.?key|token|password|secret|file.?path|base.?url/i.test(key) ? undefined : item,
    2) ?? "无返回内容").slice(0, 12000);
  } catch {
    return "内容无法转换为文本";
  }
}

/** 生命周期只负责观察；终态判定、异常传播与消息缓存仍由运行器管理。 */
export class AgentActivity {
  private readonly agent: Activity;
  private readonly tools = new Map<string, Activity>();

  constructor(private readonly options: AgentActivityOptions) {
    this.agent = {
      id: Bun.randomUUIDv7(), kind: "agent", name: options.name, status: "running", startedAt: Date.now(),
      ...(options.input ? { input: summary(options.input) } : {}),
    };
    options.channel.activity?.(this.agent);
  }

  observeTools(tools: ToolSet): ToolSet {
    return Object.fromEntries(Object.entries(tools).map(([name, definition]) => {
      const execute = definition.execute;
      if (!execute) return [name, definition];
      const wrapped: typeof definition = {
        ...definition,
        execute: (input, context) => withActivityScope(
          this.tools.get(context.toolCallId)?.id ?? this.agent.id,
          () => execute(input, context),
        ),
      };
      return [name, wrapped];
    }));
  }

  startTool(call: { toolCallId: string; toolName: string; input: unknown }): void {
    const activity: Activity = {
      id: Bun.randomUUIDv7(), parentId: this.agent.id, kind: "tool", name: call.toolName,
      status: "running", startedAt: Date.now(), input: summary(call.input),
    };
    this.tools.set(call.toolCallId, activity);
    this.options.channel.activity?.(activity);
  }

  endTool(id: string, output: unknown, failed: boolean): void {
    const activity = this.tools.get(id);
    if (!activity) return;
    this.options.channel.activity?.({
      ...activity, status: failed ? "failed" : "completed", endedAt: Date.now(), output: summary(output),
    });
    this.tools.delete(id);
  }

  finish(output: unknown, failed = false): void {
    for (const [id] of this.tools) this.endTool(id, "执行已结束", true);
    this.options.channel.activity?.({
      ...this.agent, status: failed ? "failed" : "completed", endedAt: Date.now(), output: summary(output),
    });
  }
}

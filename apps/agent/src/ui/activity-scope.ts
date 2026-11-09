import { AsyncLocalStorage } from "node:async_hooks";

const scope = new AsyncLocalStorage<string>();

/** 将并发工具内部的提问关联到真正发起它的活动。 */
export function withActivityScope<T>(id: string, action: () => T): T {
  return scope.run(id, action);
}

export function currentActivityId(): string | undefined {
  return scope.getStore();
}

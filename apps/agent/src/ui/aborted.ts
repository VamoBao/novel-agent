/** 用户输入通道关闭（EOF / Ctrl+D / 协议通道断开）时抛出，用于优雅终止整个工作流 */
export class UserAbortedError extends Error {
  constructor() {
    super("用户终止了输入");
    this.name = "UserAbortedError";
  }
}

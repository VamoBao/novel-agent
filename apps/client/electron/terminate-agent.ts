import type { ChildProcess } from "node:child_process";

/** IPC stop 必须等旧子进程真正退出，再允许恢复进程占用工作流锁。 */
export async function terminateAgent(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const finish = (): void => {
      clearTimeout(timer);
      child.off("exit", finish);
      child.off("error", finish);
      resolve();
    };
    const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
    child.once("exit", finish);
    child.once("error", finish);
    child.kill("SIGTERM");
  });
}

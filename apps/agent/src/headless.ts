import * as path from "node:path";
import { PROTOCOL_VERSION, type AgentMessage } from "@novel/shared";
import { createNovel } from "./workflows";
import { UserAbortedError } from "./ui/aborted";
import { ProtocolChannel } from "./ui/protocol-channel";
import { OUTPUT_DIR } from "./output/outline-writer";

/**
 * 协议模式入口：不触碰 TTY，stdin/stdout 按行收发 JSON 消息（协议见 @novel/shared protocol.ts）。
 * 由宿主进程（Electron main）spawn，生命周期随 stdin 关闭或 SIGTERM 结束；
 * 数据路径由宿主经环境变量传入绝对路径（NOVEL_DB_PATH / NOVEL_OUTPUT_DIR），hello 回显校验。
 */
async function main(): Promise<void> {
  if (!process.env.DEEPSEEK_API_KEY) {
    process.stderr.write("NOVEL_AGENT_FATAL: 未设置 DEEPSEEK_API_KEY\n");
    process.exit(1);
  }

  const dbPath = path.resolve(process.env.NOVEL_DB_PATH ?? "data/novel.db");
  const outputDir = path.resolve(OUTPUT_DIR);

  const send = (message: AgentMessage): void => {
    process.stdout.write(`${JSON.stringify(message)}\n`);
  };

  const channel = new ProtocolChannel(send);
  send({ type: "hello", protoVersion: PROTOCOL_VERSION, dbPath, outputDir });

  const dispatch = (line: string): void => {
    try {
      channel.handleLine(line);
    } catch (error) {
      // 协议消息不合法：fail-fast，通知后退出（开发期暴露协议 bug）
      send({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
        fatal: true,
      });
      process.exit(1);
    }
  };

  // stdin 按行缓冲（与 CLI 管道模式同款做法：不用 readline，避免 Bun 管道丢行）
  let partial = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    partial += chunk;
    const parts = partial.split("\n");
    partial = parts.pop() ?? "";
    for (const line of parts) dispatch(line);
  });
  process.stdin.on("end", () => {
    if (partial.length > 0) {
      dispatch(partial);
      partial = "";
    }
    channel.abort();
  });
  // client 退出即整会话结束：state 已增量落库，无需善后
  process.on("SIGTERM", () => process.exit(0));

  try {
    const state = await createNovel({ channel });
    send({
      type: "run_finished",
      novelId: state.id,
      outputPath: path.join(outputDir, `${state.id}.json`),
    });
  } catch (error) {
    if (error instanceof UserAbortedError) {
      // client 已断开，无处可发，安静退出（EOF 前完成的写入均已落库）
      process.exit(0);
    }
    send({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
      fatal: true,
    });
    process.exitCode = 1;
  } finally {
    channel.close();
  }
}

if (import.meta.main) {
  void main();
}

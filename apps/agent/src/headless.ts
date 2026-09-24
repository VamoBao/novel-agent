import * as path from "node:path";
import { PROTOCOL_VERSION, type AgentMessage } from "@novel/shared";
import { createNovel, planActChapters } from "./workflows";
import { UserAbortedError } from "./ui/aborted";
import { ProtocolChannel } from "./ui/protocol-channel";
import { OUTPUT_DIR } from "./output/outline-writer";

/**
 * 协议模式入口：不触碰 TTY，stdin/stdout 按行收发 JSON 消息（协议见 @novel/shared protocol.ts）。
 * 由宿主进程（Electron main）spawn，生命周期随 stdin 关闭或 SIGTERM 结束；
 * 数据路径由宿主经环境变量传入绝对路径（NOVEL_DB_PATH / NOVEL_OUTPUT_DIR），hello 回显校验。
 * 会话模式经 argv 选择（对齐 query CLI 传参先例，协议消息 schema 不动）：
 * 无参 = 新建小说全流程；`plan-chapters <novelId> <actNodeId>` = 既有小说单幕章节规划。
 */

/** 会话模式：与 client 侧 AgentStartOptions（@novel/shared）一一对应 */
type Session = { kind: "create" } | { kind: "plan-chapters"; novelId: string; actNodeId: string };

function parseSession(argv: string[]): Session {
  if (argv.length === 0) return { kind: "create" };
  const [mode, novelId, actNodeId] = argv;
  if (mode === "plan-chapters" && argv.length === 3 && novelId && actNodeId) {
    return { kind: "plan-chapters", novelId, actNodeId };
  }
  process.stderr.write(
    `NOVEL_AGENT_FATAL: 无法识别的启动参数：${argv.join(" ")}（用法：headless.ts [plan-chapters <novelId> <actNodeId>]）\n`,
  );
  process.exit(1);
}

async function main(): Promise<void> {
  if (!process.env.DEEPSEEK_API_KEY) {
    process.stderr.write("NOVEL_AGENT_FATAL: 未设置 DEEPSEEK_API_KEY\n");
    process.exit(1);
  }

  const session = parseSession(process.argv.slice(2));
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
    // 两种会话共用同一收尾：run_finished 携带小说 ID（client 据此刷新书库/详情）
    const novelId =
      session.kind === "create"
        ? (await createNovel({ channel })).id
        : (
            await planActChapters({
              channel,
              novelId: session.novelId,
              actNodeId: session.actNodeId,
            })
          ).novelId;
    send({
      type: "run_finished",
      novelId,
      outputPath: path.join(outputDir, `${novelId}.json`),
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

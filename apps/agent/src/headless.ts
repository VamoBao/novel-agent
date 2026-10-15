import { resolveAgentModelConfig } from "./providers/agent-model";
import * as path from "node:path";
import { characterSchema, PROTOCOL_VERSION, type AgentMessage, type Character } from "@novel/shared";
import { createNovel, planActChapters, polishCharacter, regenerateOutline, writeChapter, resumeWorkflow } from "./workflows";
import type { WorkflowRun } from "./state/workflow-run-store";
import { UserAbortedError } from "./ui/aborted";
import { ProtocolChannel } from "./ui/protocol-channel";
import { OUTPUT_DIR } from "./output/outline-writer";

/**
 * 协议模式入口：不触碰 TTY，stdin/stdout 按行收发 JSON 消息（协议见 @novel/shared protocol.ts）。
 * 由宿主进程（Electron main）spawn，生命周期随 stdin 关闭或 SIGTERM 结束；
 * 数据路径由宿主经环境变量传入绝对路径（NOVEL_DB_PATH / NOVEL_OUTPUT_DIR），hello 回显校验。
 * 会话模式经 argv 选择；三条创作主流程经 workflow-run 消息回传恢复标识：
 * 无参 = 新建小说全流程；`plan-chapters <novelId> <actNodeId>` = 既有小说单幕章节规划；
 * `regen-outline <novelId>` = 既有小说大纲重新生成（新版本入库，旧版本归档）；
 * `resume <runId>` = 按已保存的模式、小说与目标继续未完成主流程；
 * `polish-character <novelId> [characterId] <formJson>` = 角色 AI 润色（编辑流传角色 ID，
 * 新建流缺省；formJson 为表单当前值 JSON——argv 传参，结果经 polish-result 消息回传）；
 * `write-chapter <novelId> <chapterNodeId>` = 章节正文生成（写作模型单轮生成，
 * 三段校验 + 修订循环后入库；流程经 write-progress 消息实时回传；
 * 校验经 Agent 会话模型，故本会话与其余会话同样需要 AGENT_MODEL_API_KEY）。
 */

/** 会话模式：与 client 侧 AgentStartOptions（@novel/shared）一一对应 */
type Session =
  | { kind: "create" }
  | { kind: "resume"; runId: string }
  | { kind: "plan-chapters"; novelId: string; actNodeId: string }
  | { kind: "regen-outline"; novelId: string }
  | { kind: "polish-character"; novelId: string; characterId?: string; formJson: string }
  | { kind: "write-chapter"; novelId: string; chapterNodeId: string };

function parseSession(argv: string[]): Session {
  if (argv.length === 0) return { kind: "create" };
  const [mode, novelId, arg3, arg4] = argv;
  if (mode === "resume" && argv.length === 2 && novelId) return { kind: "resume", runId: novelId };
  if (mode === "plan-chapters" && argv.length === 3 && novelId && arg3) {
    return { kind: "plan-chapters", novelId, actNodeId: arg3 };
  }
  if (mode === "regen-outline" && argv.length === 2 && novelId) {
    return { kind: "regen-outline", novelId };
  }
  if (mode === "polish-character" && novelId) {
    // 无 characterId：`polish-character <novelId> <formJson>`；有：`polish-character <novelId> <characterId> <formJson>`
    if (argv.length === 3 && arg3) {
      return { kind: "polish-character", novelId, formJson: arg3 };
    }
    if (argv.length === 4 && arg3 && arg4) {
      return { kind: "polish-character", novelId, characterId: arg3, formJson: arg4 };
    }
  }
  if (mode === "write-chapter" && argv.length === 3 && novelId && arg3) {
    return { kind: "write-chapter", novelId, chapterNodeId: arg3 };
  }
  process.stderr.write(
    `NOVEL_AGENT_FATAL: 无法识别的启动参数：${argv.join(" ")}（用法：headless.ts [resume <runId>] [plan-chapters <novelId> <actNodeId>] [regen-outline <novelId>] [polish-character <novelId> [characterId] <formJson>] [write-chapter <novelId> <chapterNodeId>]）\n`,
  );
  process.exit(1);
}

/** 执行会话并返回小说 ID（含恢复在内的全部会话共用 run_finished 收尾） */
async function runSession(session: Session, channel: ProtocolChannel, send: (message: AgentMessage) => void): Promise<string> {
  const onRun = (run: WorkflowRun): void => send({ type: "workflow-run", runId: run.id, novelId: run.novelId });
  switch (session.kind) {
    case "create":
      return (await createNovel({ channel, onRun })).id;
    case "resume": return resumeWorkflow(session.runId, { channel, onRun });
    case "plan-chapters":
      return (
        await planActChapters({ channel, onRun, novelId: session.novelId, actNodeId: session.actNodeId })
      ).novelId;
    case "regen-outline":
      return (await regenerateOutline({ channel, onRun, novelId: session.novelId })).novelId;
    case "polish-character": {
      let form: Character;
      try {
        form = characterSchema.parse(JSON.parse(session.formJson));
      } catch (error) {
        throw new Error(
          `润色入参（角色表单 JSON）不合法：${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
      const { character } = await polishCharacter({
        channel,
        novelId: session.novelId,
        characterId: session.characterId,
        form,
      });
      send({ type: "polish-result", character });
      return session.novelId;
    }
    case "write-chapter":
      return (
        await writeChapter({
          channel,
          novelId: session.novelId,
          chapterNodeId: session.chapterNodeId,
          // 流程进度透传：生成/校验/修订/保存各阶段实时回传客户端（章卡进度区块）
          onProgress: (event) =>
            send({
              type: "write-progress",
              chapterNodeId: event.chapterNodeId,
              round: event.round,
              totalRounds: event.totalRounds,
              phase: event.phase,
              stylePassScore: event.stylePassScore,
              ...(event.report ? { report: event.report } : {}),
              ...(event.stageResult ? { stageResult: event.stageResult } : {}),
            }),
        })
      ).novelId;
  }
}

async function main(): Promise<void> {
  const session = parseSession(process.argv.slice(2));
  // 所有会话（包括正文校验）均需要 Agent 模型 API Key。
  if (!resolveAgentModelConfig().apiKey) {
    process.stderr.write("NOVEL_AGENT_FATAL: 未设置 AGENT_MODEL_API_KEY（兼容旧 DEEPSEEK_API_KEY）\n");
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
    // 五种会话共用同一收尾：run_finished 携带小说 ID（client 据此刷新书库/详情）；
    // 润色会话的业务结果经 polish-result 消息先行回传
    const novelId = await runSession(session, channel, send);
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

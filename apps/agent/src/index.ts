import { createNovel, resumeWorkflow } from "./workflows";
import { UserAbortedError } from "./ui/aborted";
import { CliChannel } from "./ui/cli-channel";
import { resolveAgentModelConfig } from "./providers/agent-model";

async function main(): Promise<void> {
  if (!resolveAgentModelConfig().apiKey) {
    console.error(
      "❌ 未设置 AGENT_MODEL_API_KEY。请在项目根目录 .env 中配置 API Key、AGENT_MODEL_NAME 和 AGENT_MODEL_BASE_URL（模型与地址留空默认使用 DeepSeek；兼容旧 DEEPSEEK_API_KEY）。",
    );
    process.exit(1);
  }

  const channel = new CliChannel();
  try {
    const [mode, runId] = process.argv.slice(2);
    if (mode === "resume" && runId && process.argv.length === 4) {
      await resumeWorkflow(runId, { channel });
      channel.notify("✅ 恢复流程已完成");
    } else if (mode === undefined) {
      await createNovel({ channel, onRun: (run) => channel.notify(`恢复标识：${run.id}（失败后执行 bun run dev resume ${run.id}）`) });
    } else {
      throw new Error("用法：bun run dev [resume <runId>]；查询未完成流程：bun run apps/agent/src/query.ts list-runs");
    }
  } catch (error) {
    if (error instanceof UserAbortedError) {
      console.log("\n👋 输入已关闭，本次创作未完成，已安全退出。");
      return;
    }
    throw error;
  } finally {
    channel.close();
  }
}

if (import.meta.main) {
  void main().catch((error) => {
    console.error("❌ 工作流执行失败：", error);
    process.exitCode = 1;
  });
}

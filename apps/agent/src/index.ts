import { createNovel } from "./workflows";
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
    await createNovel({ channel });
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

import { createNovel } from "./workflows";
import { UserAbortedError, closePrompt } from "./cli/prompt";

async function main(): Promise<void> {
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error(
      "❌ 未设置 DEEPSEEK_API_KEY。请在项目根目录 .env 中配置（模型可用 DEEPSEEK_MODEL_NAME 覆盖，默认 deepseek-flash）。",
    );
    process.exit(1);
  }

  try {
    await createNovel();
  } catch (error) {
    if (error instanceof UserAbortedError) {
      console.log("\n👋 输入已关闭，本次创作未完成，已安全退出。");
      return;
    }
    throw error;
  } finally {
    closePrompt();
  }
}

if (import.meta.main) {
  void main().catch((error) => {
    console.error("❌ 工作流执行失败：", error);
    process.exitCode = 1;
  });
}

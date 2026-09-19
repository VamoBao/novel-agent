import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { Database } from "bun:sqlite";
import { agentMessageSchema, type AgentMessage, type ClientMessage } from "@novel/shared";

/**
 * 协议端到端驱动器：spawn headless 入口，按规则自动应答全部提问，
 * 用真实 LLM 跑通完整创作流（GUI 交互观感由人工验收，本脚本验证协议 × 工作流 × 持久化闭环）。
 *
 * 用法：bun run apps/agent/scripts/protocol-e2e.ts [--db <path>] [--eof-after <n>]
 *   --db         专用 SQLite 路径（默认 data/e2e.db，避免污染开发库）
 *   --eof-after  第 n 次应答后关闭 stdin（验证 EOF 中断语义，不跑完全程）
 */

const argv = process.argv.slice(2);
function argValue(name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
const dbPath = argValue("--db") ?? path.join(repoRoot, "data", "e2e.db");
const eofAfter = argValue("--eof-after") ? Number(argValue("--eof-after")) : undefined;

const child = spawn("bun", ["run", "apps/agent/src/headless.ts"], {
  cwd: repoRoot,
  env: {
    ...process.env,
    NOVEL_DB_PATH: dbPath,
    NOVEL_OUTPUT_DIR: path.join(repoRoot, "output"),
  },
  stdio: ["pipe", "pipe", "inherit"],
});

/** 按提问内容给出固定剧本应答（关键词匹配；未匹配的追问交给模型按常识自答） */
function scriptedText(prompt: string): string {
  if (prompt.includes("世界观构想")) return "九州大陆，灵脉被宗门垄断的修仙世界，散修处境艰难";
  if (prompt.includes("首个角色")) return "林恒，十六岁的散修少年，性格坚韧，是本书主角";
  if (prompt.includes("核心冲突")) return "宗门垄断灵脉资源，散修被迫依附，主角要打破垄断让灵脉归于众生";
  if (prompt.includes("下一个角色")) return "";
  if (prompt.includes("小说名称")) return "灵脉归众";
  if (prompt.includes("补充说明")) return "";
  return "按常理设定即可";
}

let answers = 0;
const stats = { notify: 0, view: 0, request: 0, stage: 0 };
const viewKinds = new Set<string>();

function handleAgentMessage(message: AgentMessage): void {
  switch (message.type) {
    case "hello":
      console.log(`[e2e] hello proto=${message.protoVersion} db=${message.dbPath}`);
      break;
    case "stage":
      stats.stage += 1;
      console.log(`[e2e] stage → ${message.stage}`);
      break;
    case "notify":
      stats.notify += 1;
      break;
    case "view":
      stats.view += 1;
      viewKinds.add(message.view.kind);
      break;
    case "request": {
      stats.request += 1;
      const { id, ask } = message;
      let answer: string | string[] | boolean | number;
      switch (ask.type) {
        case "line":
        case "text":
          answer = ask.type === "text" && ask.optional ? "" : scriptedText(ask.prompt);
          break;
        case "select":
          answer = ask.options[0] ?? "";
          break;
        case "multi":
          answer = [ask.options[0] ?? ""].filter((item) => item.length > 0);
          break;
        case "confirm":
          answer = true;
          break;
        case "int":
          answer = ask.default;
          break;
      }
      console.log(`[e2e] request#${id} ${ask.type} → ${JSON.stringify(answer).slice(0, 80)}`);
      answers += 1;
      if (eofAfter !== undefined && answers >= eofAfter) {
        console.log(`[e2e] 已应答 ${answers} 次，关闭 stdin 验证 EOF 中断语义`);
        child.stdin?.end();
        return;
      }
      const response: ClientMessage = { type: "response", id, answer };
      child.stdin?.write(`${JSON.stringify(response)}\n`);
      break;
    }
    case "run_finished": {
      console.log(`[e2e] run_finished novelId=${message.novelId} outputPath=${message.outputPath}`);
      console.log(`[e2e] 统计：notify=${stats.notify} view=${stats.view}(${[...viewKinds].join("/")}) request=${stats.request} stage=${stats.stage}`);
      const outputOk = existsSync(message.outputPath);
      const db = new Database(dbPath, { readonly: true });
      const count = (sql: string): number => {
        const row = db.query(sql).get(message.novelId) as { c: number } | null;
        return row?.c ?? 0;
      };
      const counts = {
        novels: count("SELECT COUNT(*) c FROM novels WHERE id = ?"),
        characters: count("SELECT COUNT(*) c FROM characters WHERE novel_id = ?"),
        worldviews: count("SELECT COUNT(*) c FROM worldviews WHERE novel_id = ?"),
        outlines: count("SELECT COUNT(*) c FROM outlines WHERE novel_id = ?"),
      };
      db.close();
      console.log(`[e2e] 落盘文件存在：${outputOk}`);
      console.log(
        `[e2e] 入库行数：novels=${counts.novels} characters=${counts.characters} worldviews=${counts.worldviews} outlines=${counts.outlines}`,
      );
      const ok =
        outputOk &&
        counts.novels === 1 &&
        counts.characters >= 1 &&
        counts.worldviews === 1 &&
        counts.outlines >= 2;
      console.log(ok ? "[e2e] ✅ 端到端验证通过" : "[e2e] ❌ 端到端验证失败");
      child.stdin?.end();
      break;
    }
    case "error":
      console.error(`[e2e] error(fatal=${message.fatal})：${message.message}`);
      break;
  }
}

let buffer = "";
child.stdout?.setEncoding("utf8");
child.stdout?.on("data", (chunk: string) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const parsed = agentMessageSchema.safeParse(JSON.parse(line));
    if (parsed.success) handleAgentMessage(parsed.data);
  }
});

child.on("exit", (code) => {
  console.log(`[e2e] agent 退出：code=${code ?? "null"}`);
  process.exit(code ?? 1);
});

// 看门狗：真实 LLM 全流程也不应超过 8 分钟
setTimeout(() => {
  console.error("[e2e] ⏱ 超时（8 分钟），终止");
  child.kill("SIGKILL");
  process.exit(1);
}, 8 * 60 * 1000).unref();

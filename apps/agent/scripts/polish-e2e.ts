import { spawn } from "node:child_process";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { agentMessageSchema, type AgentMessage } from "@novel/shared";
import { openDatabase } from "../src/state/db";
import { NovelStore } from "../src/state/novel-store";
import { WorldviewStore } from "../src/state/worldview-store";
import { CharacterStore } from "../src/state/character-store";
import type { Character } from "@novel/shared";

/**
 * 角色 AI 润色协议端到端驱动器：临时库播种（小说 + 世界观 + 角色）→
 * spawn headless `polish-character <novelId> <characterId> <formJson>`（真实 LLM）→
 * 校验 polish-result 全字段回填、库零写入（润色不自动入库）、run_finished 收尾。
 * 用法：bun run apps/agent/scripts/polish-e2e.ts
 */

const NOVEL_ID = "eeeeeeee-9999-7444-8555-666677778888";

const dir = await mkdtemp(join2("novel-polish-e2e-"));
function join2(prefix: string): string {
  return path.join(tmpdir(), prefix);
}
const dbPath = path.join(dir, "e2e.db");

// 播种：novels / worldviews / characters（编辑流：角色已在库）
const db = openDatabase(dbPath);
new NovelStore(db).createNovel({ id: NOVEL_ID, name: "灵脉归众" });
new WorldviewStore(db).saveWorldview(NOVEL_ID, {
  background: { geography: "九州大陆，灵脉被宗门垄断", fantasyAttributes: "修仙炼气体系" },
  taboos: ["不可出现现代科技"],
});
const seeded = new CharacterStore(db).addCharacter(NOVEL_ID, {
  basicInfo: { name: "林恒" },
  core: { desire: "夺回灵脉", fear: "辜负同伴", narrativeRole: "主角" },
  background: "青云市集的散修少年",
  creationPurpose: "承载打破垄断的主线",
  endingDirection: "打破垄断后归隐",
});
db.close();

// 表单当前值（用户在编辑表单改动了背景、留空其余可选项）
const form: Character = {
  basicInfo: { name: "林恒" },
  core: { desire: "夺回灵脉", fear: "辜负同伴", narrativeRole: "主角" },
  background: "青云市集的散修少年，幼年目睹灵脉枯竭",
  creationPurpose: "承载打破垄断的主线",
  endingDirection: "打破垄断后归隐",
};

console.log(`[e2e] 播种完成：db=${dbPath} characterId=${seeded.id}`);
const child = spawn(
  "bun",
  [
    "run",
    "apps/agent/src/headless.ts",
    "polish-character",
    NOVEL_ID,
    seeded.id,
    JSON.stringify(form),
  ],
  {
    cwd: path.resolve(import.meta.dir, "..", "..", ".."),
    env: { ...process.env, NOVEL_DB_PATH: dbPath, NOVEL_OUTPUT_DIR: path.resolve(import.meta.dir, "..", "..", "..", "output") },
    stdio: ["pipe", "pipe", "inherit"],
  },
);

let sawResult = false;
let finished = false;
let buffer = "";

function handle(message: AgentMessage): void {
  switch (message.type) {
    case "hello":
      console.log(`[e2e] hello proto=${message.protoVersion}`);
      break;
    case "notify":
      console.log(`[e2e] notify: ${message.text}`);
      break;
    case "polish-result": {
      sawResult = true;
      const c = message.character;
      console.log(
        `[e2e] polish-result：name=${c.basicInfo.name} gender=${c.basicInfo.gender ?? "∅"} personality=${(c.personality ?? "∅").slice(0, 24)}…`,
      );
      const optionals = [c.basicInfo.gender, c.basicInfo.appearance, c.personality, c.characterGoal, c.trajectory, c.relationships];
      const allFilled = optionals.every((v) => typeof v === "string" && v.length > 0);
      const requiredIntact =
        c.basicInfo.name === "林恒" &&
        c.core.desire.length > 0 &&
        c.core.fear.length > 0 &&
        c.core.narrativeRole.length > 0 &&
        c.background.length > 0 &&
        c.creationPurpose.length > 0 &&
        c.endingDirection.length > 0;
      console.log(`[e2e] 全字段填充（含 6 可选项）：${allFilled}；必填与姓名保持：${requiredIntact}`);
      if (!allFilled || !requiredIntact) process.exitCode = 1;
      break;
    }
    case "run_finished":
      finished = true;
      console.log(`[e2e] run_finished novelId=${message.novelId}`);
      // 润色会话无后续问答：关闭 stdin 让 agent 走 EOF 收尾（对齐 protocol-e2e 先例）
      child.stdin?.end();
      break;
    case "error":
      console.error(`[e2e] error(fatal=${message.fatal})：${message.message}`);
      process.exitCode = 1;
      break;
  }
}

child.stdout?.setEncoding("utf8");
child.stdout?.on("data", (chunk: string) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const parsed = agentMessageSchema.safeParse(JSON.parse(line));
    if (parsed.success) handle(parsed.data);
  }
});

child.on("exit", (code) => {
  // 库零写入校验：主行 version 仍为 1、无快照（润色不自动入库）
  const verify = new Database(dbPath, { readonly: true });
  const versionRow = verify
    .query("SELECT version FROM characters WHERE id = ?")
    .get(seeded.id) as { version: number } | null;
  const snapshotCount = verify
    .query("SELECT COUNT(*) c FROM character_versions")
    .get() as { c: number };
  verify.close();
  console.log(
    `[e2e] 库零写入：version=${versionRow?.version}（期望 1） snapshots=${snapshotCount.c}（期望 0）`,
  );
  const ok = code === 0 && sawResult && finished && versionRow?.version === 1 && snapshotCount.c === 0 && process.exitCode === undefined;
  console.log(ok ? "[e2e] ✅ 润色端到端验证通过" : "[e2e] ❌ 润色端到端验证失败");
  void rm(dir, { recursive: true, force: true }).then(() => {
    process.exit(ok ? 0 : 1);
  });
});

setTimeout(() => {
  console.error("[e2e] ⏱ 超时（3 分钟），终止");
  child.kill("SIGKILL");
  process.exit(1);
}, 3 * 60 * 1000).unref();

import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../state/db";
import { NovelStore } from "../state/novel-store";
import { WorkflowRunStore, type WorkflowKind } from "../state/workflow-run-store";

test.each(["create", "plan-chapters", "regen-outline"] satisfies WorkflowKind[])(
  "headless resume 恢复原运行并返回结果，不新建小说或工作流：%s", async (kind) => {
    const dir = await mkdtemp(join(tmpdir(), "novel-resume-entry-"));
    const dbPath = join(dir, "test.db");
    const db = openDatabase(dbPath);
    const novel = new NovelStore(db).createNovel({ name: "恢复入口测试" });
    const store = new WorkflowRunStore(db);
    const run = store.create({ kind, novelId: novel.id, targetId: kind === "plan-chapters" ? "act1" : undefined });
    store.record(run.id, "workflow-result", kind === "create"
      ? { id: novel.id, status: "outlined", createdAt: novel.createdAt, updatedAt: novel.updatedAt }
      : { novelId: novel.id, actNodeId: "act1", actName: "幕", chapterCount: 1, version: 2, partCount: 1, actCount: 3 });
    store.finish(run.id, "completed");
    db.close();
    try {
      const proc = Bun.spawn([process.execPath, fileURLToPath(new URL("../headless.ts", import.meta.url)), "resume", run.id], {
        env: { ...process.env, NOVEL_DB_PATH: dbPath, NOVEL_OUTPUT_DIR: dir, AGENT_MODEL_API_KEY: "test" },
        stdin: "ignore", stdout: "pipe", stderr: "pipe",
      });
      const [out, err, exit] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      expect(err).toBe("");
      expect(exit).toBe(0);
      const messages = out.trim().split("\n").map((line) => JSON.parse(line));
      expect(messages).toContainEqual({ type: "workflow-run", runId: run.id, novelId: novel.id });
      expect(messages.at(-1)).toMatchObject({ type: "run_finished", novelId: novel.id });
      expect(messages.some((message) => message.type === "request")).toBe(false);
      if (kind === "create") {
        const cli = Bun.spawn([process.execPath, fileURLToPath(new URL("../index.ts", import.meta.url)), "resume", run.id], {
          env: { ...process.env, NOVEL_DB_PATH: dbPath, NOVEL_OUTPUT_DIR: dir, AGENT_MODEL_API_KEY: "test" },
          stdin: "ignore", stdout: "pipe", stderr: "pipe",
        });
        const [cliOut, cliErr, cliExit] = await Promise.all([
          new Response(cli.stdout).text(), new Response(cli.stderr).text(), cli.exited,
        ]);
        expect(cliErr).toBe("");
        expect(cliExit).toBe(0);
        expect(cliOut).toContain("恢复流程已完成");
      }
      const reopened = openDatabase(dbPath);
      expect(new NovelStore(reopened).listNovels()).toHaveLength(1);
      expect(reopened.query("SELECT count(*) AS count FROM workflow_runs").get()).toEqual({ count: 1 });
      reopened.close();
    } finally { await rm(dir, { recursive: true, force: true }); }
  },
);

test("headless 会话收尾后进程退出：宿主保持 stdin 管道打开时不驻留", async () => {
  const dir = await mkdtemp(join(tmpdir(), "novel-headless-exit-"));
  const dbPath = join(dir, "test.db");
  // stdin 用 pipe 且全程不关——对齐 Electron 宿主（单例持有子进程 stdin 不关）；
  // 修复前 stdin 的 data 监听保活事件循环，发完收尾消息后进程永久驻留
  const proc = Bun.spawn(
    [process.execPath, fileURLToPath(new URL("../headless.ts", import.meta.url)), "write-chapter", "missing-novel", "missing-chapter"],
    {
      env: { ...process.env, NOVEL_DB_PATH: dbPath, NOVEL_OUTPUT_DIR: dir, AGENT_MODEL_API_KEY: "test" },
      stdin: "pipe", stdout: "pipe", stderr: "pipe",
    },
  );
  try {
    const stdinSink = proc.stdin; // 保持引用：父进程侧管道全程打开
    void stdinSink;
    const exit = await Promise.race([
      proc.exited,
      Bun.sleep(4000).then(() => "timeout" as const),
    ]);
    expect(exit).toBe(1);
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    expect(out).toContain("小说不存在");
    expect(err).toBe("");
  } finally {
    try { proc.kill(); } catch { /* 已退出时忽略 */ }
    await rm(dir, { recursive: true, force: true });
  }
}, 10000);

test("headless resume 缺失运行报可读错误", async () => {
  const proc = Bun.spawn([process.execPath, fileURLToPath(new URL("../headless.ts", import.meta.url)), "resume", "missing"], {
    env: { ...process.env, NOVEL_DB_PATH: ":memory:", AGENT_MODEL_API_KEY: "test" },
    stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  const [out, err, exit] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  expect(err).toBe("");
  expect(exit).toBe(1);
  expect(out).toContain("需要恢复的工作流不存在");
});

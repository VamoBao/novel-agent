import { app, BrowserWindow, ipcMain } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  agentMessageSchema,
  novelDeletedResultSchema,
  novelDetailSchema,
  novelListItemSchema,
  PROTOCOL_VERSION,
  type AgentStartOptions,
  type NovelDetail,
  type NovelListItem,
} from "@novel/shared";

/** 仓库根（dev：app 路径为 apps/client，上两级即根；打包分发形态 v2 再调整） */
function resolveRepoRoot(): string {
  return path.resolve(app.getAppPath(), "..", "..");
}

/** 极简 .env 解析（KEY=VALUE 行，# 注释）：Electron 不自动加载根 .env，agent 子进程需要 API Key */
function loadEnvFile(file: string): Record<string, string> {
  try {
    return Object.fromEntries(
      fs
        .readFileSync(file, "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"))
        .map((line) => {
          const eq = line.indexOf("=");
          return [line.slice(0, eq), line.slice(eq + 1)];
        }),
    );
  } catch {
    return {};
  }
}

/** agent / 查询 CLI 子进程共用环境：数据路径传绝对路径（相对路径会随 spawn cwd 漂移） */
function childEnv(): NodeJS.ProcessEnv {
  const repoRoot = resolveRepoRoot();
  return {
    ...process.env,
    ...loadEnvFile(path.join(repoRoot, ".env")),
    NOVEL_DB_PATH: path.join(repoRoot, "data", "novel.db"),
    NOVEL_OUTPUT_DIR: path.join(repoRoot, "output"),
  };
}

/**
 * 执行一次性库查询 CLI（apps/agent/src/query.ts）：收集 stdout 单行 JSON 原样返回，
 * 结构由调用方用 shared schema 复验；超时 / 非零退出（stderr 为错误信息）→ reject。
 */
function runLibraryQuery(args: string[], timeoutMs = 8000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn("bun", ["run", "apps/agent/src/query.ts", ...args], {
      cwd: resolveRepoRoot(),
      env: childEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`库查询超时（${timeoutMs}ms）`));
    }, timeoutMs);
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`库查询进程启动失败：${error.message}`));
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `库查询失败（exit ${code ?? "null"}）`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`库查询输出不是合法 JSON：${stdout.slice(0, 200)}`));
      }
    });
  });
}

/** agent 子进程宿主：spawn headless 入口、转发协议消息、退出回收 */
class AgentProcess {
  private child: ChildProcess | null = null;
  private stdoutBuffer = "";
  private win: BrowserWindow | null = null;

  get running(): boolean {
    return this.child !== null;
  }

  start(win: BrowserWindow, options: AgentStartOptions = { mode: "create" }): void {
    if (this.child) return;
    this.win = win;
    const repoRoot = resolveRepoRoot();
    // 会话模式映射为 headless argv（create → 无参；plan-chapters → 传小说与幕节点 ID）
    const sessionArgs =
      options.mode === "plan-chapters"
        ? ["plan-chapters", options.novelId, options.actNodeId]
        : [];
    const child = spawn("bun", ["run", "apps/agent/src/headless.ts", ...sessionArgs], {
      cwd: repoRoot,
      env: childEnv(),
      stdio: ["pipe", "pipe", "inherit"],
    });
    this.child = child;
    console.log(`[agent] spawned（cwd=${repoRoot}）`);

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      this.stdoutBuffer += chunk;
      const lines = this.stdoutBuffer.split("\n");
      this.stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) this.dispatchAgentLine(line);
    });
    child.on("exit", (code) => {
      console.log(`[agent] exited（code=${code ?? "null"}）`);
      this.child = null;
      this.win?.webContents.send("agent:exit", code ?? -1);
    });
    child.on("error", (error) => {
      console.error("[agent] spawn 失败：", error);
      this.child = null;
      this.win?.webContents.send("agent:exit", -1);
    });
  }

  /** agent → client 消息：zod 复验后转发渲染进程；未知消息向前兼容忽略并记日志 */
  private dispatchAgentLine(line: string): void {
    if (line.trim().length === 0) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      console.warn("[agent] 非 JSON 行：", line.slice(0, 200));
      return;
    }
    const message = agentMessageSchema.safeParse(parsed);
    if (!message.success) {
      console.warn("[agent] 消息不合协议 schema，已忽略：", line.slice(0, 200));
      return;
    }
    if (message.data.type === "hello") {
      console.log(
        `[agent] hello：protoVersion=${message.data.protoVersion}，db=${message.data.dbPath}，output=${message.data.outputDir}`,
      );
      if (message.data.protoVersion !== PROTOCOL_VERSION) {
        this.win?.webContents.send("agent:message", {
          type: "error",
          message: `协议版本不匹配：agent=${message.data.protoVersion}，client=${PROTOCOL_VERSION}`,
          fatal: true,
        });
        this.kill();
        return;
      }
    }
    this.win?.webContents.send("agent:message", message.data);
  }

  respond(id: number, answer: string | string[] | boolean | number): void {
    this.child?.stdin?.write(`${JSON.stringify({ type: "response", id, answer })}\n`);
  }

  kill(): void {
    this.child?.kill("SIGTERM");
    this.child = null;
  }
}

const agentProcess = new AgentProcess();

// WSL2 / 虚拟桌面环境下 GPU 进程与 sandbox 初始化失败会直接 FATAL，禁用后以软件渲染运行
// （本地单机应用、渲染进程不加载远程内容，风险可控；打包分发时再评估恢复 sandbox）
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("no-sandbox");
// GPU 子进程在本环境启动即崩（error_code=1002），并入主进程以软件渲染运行
app.commandLine.appendSwitch("in-process-gpu");

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 820,
    title: "novel-agent",
    webPreferences: {
      // electron-vite 4 的 preload 产物为 ESM（.mjs；需 sandbox:false，Electron ≥28 支持）
      preload: path.join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  // 诊断：renderer 控制台与加载异常转发到主进程 stdout（无头冒烟排障用）
  win.webContents.on("console-message", (_event, _level, message) => {
    console.log(`[renderer] ${message}`);
  });
  win.webContents.on("did-fail-load", (_event, code, desc, url) => {
    console.error(`[renderer] 加载失败 ${url}：${code} ${desc}`);
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    console.error("[renderer] 渲染进程消失：", details.reason);
  });

  // 诊断钩子（默认关闭，仅环境变量显式开启；用于无头冒烟与端到端联调）：
  // NOVEL_CLIENT_AUTOSTART=1：页面加载完成后自动打开创作覆盖层（等价点击「新建小说」，
  //   由 renderer 读同款环境变量触发，agent 的 spawn 始终由 CreationFlow 发起）
  // NOVEL_CLIENT_SCREENSHOT=<path>：加载完成数秒后截图存盘并退出
  const autostart = process.env.NOVEL_CLIENT_AUTOSTART === "1";
  const screenshot = process.env.NOVEL_CLIENT_SCREENSHOT;
  win.webContents.on("did-finish-load", () => {
    if (screenshot) {
      setTimeout(
        () => {
          win.webContents
            .capturePage()
            .then((image) => {
              fs.writeFileSync(screenshot, image.toPNG());
              console.log(`[client] 截图已保存：${screenshot}`);
              if (autostart) agentProcess.kill();
              app.quit();
            })
            .catch((error: unknown) => {
              console.error("[client] 截图失败：", error);
              app.quit();
            });
        },
        autostart ? 4000 : 1500,
      );
    }
  });
  return win;
}

ipcMain.handle("agent:start", (_event, options?: AgentStartOptions) => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) agentProcess.start(win, options ?? { mode: "create" });
});

ipcMain.handle("agent:respond", (_event, id: number, answer: string | string[] | boolean | number) => {
  agentProcess.respond(id, answer);
});

// 中断 = 终止 agent 子进程（v1 无优雅取消协议；state 已增量落库）
ipcMain.handle("agent:stop", () => {
  agentProcess.kill();
});

ipcMain.handle("library:list", async (): Promise<NovelListItem[]> => {
  const result = novelListItemSchema.array().safeParse(await runLibraryQuery(["list"]));
  if (!result.success) {
    throw new Error(`小说列表不合查询 schema：${result.error.issues[0]?.message ?? "未知错误"}`);
  }
  return result.data;
});

ipcMain.handle("library:get", async (_event, novelId: string): Promise<NovelDetail> => {
  const result = novelDetailSchema.safeParse(await runLibraryQuery(["get", novelId]));
  if (!result.success) {
    throw new Error(`小说详情不合查询 schema：${result.error.issues[0]?.message ?? "未知错误"}`);
  }
  return result.data;
});

/** 书库管理：操作成功返回更新后的列表项（delete 返回被删 ID） */
function handleItemMutation(args: string[]): Promise<NovelListItem> {
  return runLibraryQuery(args).then((raw) => {
    const result = novelListItemSchema.safeParse(raw);
    if (!result.success) {
      throw new Error(`管理结果不合查询 schema：${result.error.issues[0]?.message ?? "未知错误"}`);
    }
    return result.data;
  });
}

ipcMain.handle("library:rename", (_event, novelId: string, name: string) =>
  handleItemMutation(["rename", novelId, name]),
);

ipcMain.handle("library:setPinned", (_event, novelId: string, pinned: boolean) =>
  handleItemMutation([pinned ? "pin" : "unpin", novelId]),
);

ipcMain.handle("library:setFavorite", (_event, novelId: string, favorite: boolean) =>
  handleItemMutation([favorite ? "favorite" : "unfavorite", novelId]),
);

ipcMain.handle("library:delete", async (_event, novelId: string) => {
  const result = novelDeletedResultSchema.safeParse(await runLibraryQuery(["delete", novelId]));
  if (!result.success) {
    throw new Error(`删除结果不合查询 schema：${result.error.issues[0]?.message ?? "未知错误"}`);
  }
  return result.data;
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("will-quit", () => {
  agentProcess.kill();
});

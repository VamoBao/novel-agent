# Agent OpenAI 兼容接入实现计划

**目标：** 按已确认设计，让 Agent 支持 API Key、模型名、Base URL，并兼容历史配置。

**架构：** `providers/agent-model.ts` 解析通用环境变量并创建兼容模型。客户端 settings 归一化历史组并解析各来源优先级，现有 IPC 类型随 AppSettings 更新。工作流统一引用新的 Agent 模型，写作模型回落共用实例。

**技术栈：** Bun、TypeScript、AI SDK 7、@ai-sdk/openai-compatible、React、bun:test。

按仓库约定串行执行，代码与文档最后统一原子提交；在当前用户共享工作区执行。

## 任务 1：Agent 接入

- [x] 新建 `apps/agent/src/providers/agent-model.test.ts`：默认值、旧变量、通用变量覆盖、空白配置与 HTTP 请求协议。独立 Bun 子进程加载真实 AI SDK，以 fetch 替身记录请求并返回文本、工具调用、JSON 输出；断言 URL、Authorization、model 和解析结果。
- [x] 运行 `bun test apps/agent/src/providers/agent-model.test.ts`，确认新接口缺失导致失败。
- [x] 新建 `agent-model.ts`，导出 `resolveAgentModelConfig(env = process.env)`、`createAgentModel(env = process.env)` 和默认 `model`，配置解析形如 `env.AGENT_MODEL_API_KEY?.trim() || env.DEEPSEEK_API_KEY?.trim() || ""`。模型名与 Base URL 的默认值分别为 `deepseek-flash`、`https://api.deepseek.com`。
- [x] 替换 react、polish-character、write-chapter、writing-model 及测试的 provider 引用。CLI/headless 调用同一解析器检查 API Key，空白视为未配置。
- [x] 移除 DeepSeek 专用 provider 和直接依赖，更新锁文件；运行 provider 与受影响工作流测试。

## 任务 2：客户端配置

- [x] 扩展 `apps/client/electron/settings.test.ts`：agentModel 三字段、legacy deepseek 迁移、新组为空不恢复旧组、各来源通用变量与旧变量混合的优先级、Base URL 保存往返。
- [x] 运行 `bun test apps/client/electron/settings.test.ts`，确认新设置字段与通用变量断言失败。
- [x] AppSettings 改为 agentModel 三字段；归一化取 `Object.hasOwn(source, "agentModel") ? source.agentModel : source.deepseek`；同来源通用变量先于旧变量，输出六个模型变量。
- [x] 修改 SettingsDialog 的加载、表单、保存与文案，增加 Agent Base URL 输入与默认地址提示。
- [x] 新建 `SettingsDialog.interaction.test.tsx`，真实 React + happy-dom 表单挂接临时 settings 文件，验证加载 Base URL、编辑、保存、重读与子进程变量解析。
- [x] 运行客户端设置与表单测试，更新根进度清单。

## 任务 3：验证与交付

- [x] 同步 `.env.example`、README、AGENTS、根与 workflows 架构文档，记录通用配置、默认值与兼容规则。
- [x] 运行 `bun run typecheck`、`bun run lint`、`bun run test`，检查全部退出码及失败数；模型请求测试不访问真实服务。
- [x] 使用 requesting-code-review 技能安排独立审查，处理必要修复并验证。
- [x] 已完成记录保留最近五条，其余滚入历史归档；更新设计状态与本计划复选框。
- [x] `git diff --check` 后按 `docs/git-commit-guide.md` 执行一次原子提交。

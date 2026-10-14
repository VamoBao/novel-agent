# Agent 模型 OpenAI 兼容接入设计

状态：2026-10-14 用户确认后已完成；typecheck、lint、489 项测试通过，独立审查无必须修复问题。

## 目标

Agent 会话模型统一使用 OpenAI Chat Completions 兼容接口，客户端与 CLI 均可配置 API Key、模型名和 Base URL。世界观、角色、大纲、章节规划、角色润色和正文校验共用该 Agent 模型；独立写作模型保留现有配置与回落行为。

## 方案选择

推荐新增通用 `agent-model.ts`，复用现有 `@ai-sdk/openai-compatible`，以 `AGENT_MODEL_API_KEY`、`AGENT_MODEL_NAME`、`AGENT_MODEL_BASE_URL` 配置 Agent。相比继续沿用 DeepSeek 命名，这能直接表达可连接任意兼容服务；相比增加 provider 类型选择，这能避免为同一种接口引入多套接入逻辑。

## 配置与兼容

- 客户端 Agent 配置组改为 `agentModel: { apiKey, modelName, baseUrl }`，展示「Agent 会话模型（OpenAI 接口兼容）」。保存后下一次会话生效。
- 历史 `settings.json` 的 `deepseek` 配置组在读取时迁移为 `agentModel`；新组存在时以新组为准，避免重新启用用户已经清空的旧配置。
- CLI 使用 `AGENT_MODEL_*`，兼容旧 `DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL_NAME`。配置空串或纯空白视为未配置。
- 模型名与 Base URL 未配置时保留现有 DeepSeek 默认体验：`deepseek-flash` 与 `https://api.deepseek.com`。接入其他服务时填写该服务的模型名与 Base URL（例如 `https://api.example.com/v1`）。
- 客户端按字段保持「设置 > .env > 继承环境变量」优先级；同一环境来源内通用变量优先于旧变量。解析结果统一注入 `AGENT_MODEL_*`。
- CLI 和 headless 的启动检查改为检查解析后的 Agent API Key，错误信息引导填写通用配置；正文生成仍需要 Agent 模型执行校验。
- 写作模型三项齐全时独立使用，任一未配置时回落到同一个 Agent 模型实例。

## 接入与错误处理

更新所有 Agent 模型消费者，去除业务代码中的 DeepSeek provider 依赖。保留现有模型注入接口，数据库与小说业务流程无需迁移。

Agent 需要工具调用及 JSON 输出。使用兼容 provider 的通用能力，不默认要求服务支持严格 JSON Schema 输出，避免对兼容端点施加额外协议要求。网络、鉴权和模型调用错误继续使用现有会话错误处理。

实现依据：[AI SDK OpenAI Compatible Providers 官方文档](https://ai-sdk.dev/providers/openai-compatible-providers)。

## 串行任务清单

1. Agent 接入：通用配置解析与模型 provider、启动检查、各模型消费者及写作模型回落；验收为自定义端点收到指定模型与 Bearer Key，旧变量与默认值可用。
2. 客户端配置：新设置结构、历史设置读取、三级优先级和 Base URL 表单；验收为设置保存读取往返正确、六个模型配置变量正确注入子进程。
3. 回归与交付：补充配置及协议请求测试，运行 typecheck、lint、全量测试，同步 README、环境变量示例、入口与两级状态文档；最后按仓库约定统一原子提交。

测试使用临时设置文件与 mock 兼容端点，覆盖文本、工具调用、JSON 输出和写作模型回落，不依赖真实 API Key。真实服务的模型能力与连接情况由实际配置后的会话验证。

## 范围

本次只调整模型接入及配置链路，不增加服务商选择器、模型列表查询或配置热更新。

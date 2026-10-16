# 模型 provider 选择与 DeepSeek JSON 输出修复

状态：已实施（2026-10-16，用户确认按推荐方案执行：Agent 与独立写作模型分别选择 provider）。实施记录与验收见根 `PROGRESS.md` 同日条目，决策见 `DECISIONS.md`。

## 目标与根因

设置弹窗提供 OpenAI、DeepSeek、Claude 三种接口类型，模型调用使用对应 AI SDK 官方 provider，继续支持 API Key、模型名和自定义 Base URL。

当前 agent-model.ts 使用 openai-compatible。实际 SDK 请求拦截验证：generateObject 的中文提示「请提取角色名字」发送 response_format=json_object，但 system/user 消息不含 json。按 DeepSeek 的接口规则返回 400，可复现用户报错。现有 @ai-sdk/deepseek 3.0.54 的 convert-to-deepseek-chat-messages 会在此路径自动注入 JSON 指令和 schema，因此应使用专用 provider，而不是在各业务 prompt 中零散打补丁。

上次协议测试的模拟端点没有校验 JSON 指令，本次回归须模拟该服务端约束。

## 方案比较

1. **推荐：显式选择并调用官方 provider。** 符合用户要求，适配各家消息、工具、鉴权与结构化输出协议。
2. 保持通用接口并追加 JSON 指令。可解决当前单一报错，但不能支持 Claude 原生接口，也不满足 provider 选择要求。
3. 根据模型名或域名自动选择。无法可靠识别代理与自定义端点，不作为正常配置机制；仅用于兼容缺少新字段的历史配置。

## provider 映射

| 设置名称 | 标识 | SDK 包 | 接口 |
| --- | --- | --- | --- |
| OpenAI | openai | @ai-sdk/openai | 显式使用 chat(modelName)，继续支持 Chat Completions 自定义地址 |
| DeepSeek | deepseek | @ai-sdk/deepseek | createDeepSeek(...)(modelName)，使用 SDK 的 JSON 指令与 schema 适配 |
| Claude | claude | @ai-sdk/anthropic | createAnthropic(...)(modelName)，使用 Anthropic Messages 协议与鉴权 |

Base URL 留空时按 provider 采用官方默认地址：OpenAI 为 https://api.openai.com/v1；DeepSeek 为 https://api.deepseek.com；Claude 为 https://api.anthropic.com/v1。自定义地址必须支持所选协议，选项名称表示接口类型，不根据实际模型名称再次切换。

## 配置与界面

- Agent 与写作模型各增加一个 provider 下拉框，仅提供上述三种选择。
- 保留各组 API Key、模型名、Base URL；切换 provider 不复用旧的官方默认地址，而采用新 provider 默认地址提示；用户填写的值不自动改写或删除。模型名按所接服务填写，DeepSeek 继续支持原有默认模型名。
- 新增 AGENT_MODEL_PROVIDER / WRITING_MODEL_PROVIDER 环境变量。配置来源保持「设置 > .env > 继承环境变量」，没有显式 provider 的来源不得遮蔽下一层已配置的值；环境变量非法值给出清晰错误，不静默走错协议。
- 旧 DEEPSEEK_* 变量与历史 deepseek 设置组继续兼容。缺少 provider 的历史配置按原有有效地址迁移：DeepSeek 官方地址（包括原 Agent 空地址的默认值）使用 DeepSeek，其余现有 OpenAI 兼容地址使用 OpenAI；自定义 DeepSeek 代理可由用户明确选择 DeepSeek。
- 全新 Agent 默认 DeepSeek，保留既有开箱体验；独立写作默认 OpenAI。旧写作三字段均空或部分配置时仍回落 Agent，不因增加默认 provider 而意外启用。
- Agent 与正文审校共用所选 Agent provider；独立写作未启用时回落同一 Agent 实例。会话启动时读取配置，保存后下一次会话生效。
- 仅保存一套当前配置，不增加按 provider 分别记住 Key 的功能。数据库与流程缓存不保存模型连接配置，继续保持现有恢复语义。

## 串行任务包

1. **模型接入与缺陷回归｜已完成（2026-10-16）。** 涉及 agent providers、对应依赖与共享 provider 类型。建立三种官方 provider 工厂，分别接入 Agent/写作模型；先写 DeepSeek JSON 指令回归。完成条件：真实 SDK 请求经过模拟服务端检查，DeepSeek 无 JSON 字样的业务 prompt 可正常得到结构化对象；OpenAI 与 Claude 的地址、鉴权、文本、工具及结构化输出符合各自协议。
2. **设置与配置链路｜已完成（2026-10-16）。** 涉及 client settings、IPC 贯通类型、SettingsDialog 和环境变量示例。完成条件：三个选项保存读取往返，Base URL 按类型提示，三级优先级与旧配置迁移正确，两个模型可分别选择，未启用写作仍回落。
3. **验证与文档交付｜已完成（2026-10-16）。** 根目录为状态文档主所有者，workflows 记录相关引用。完成条件：typecheck、lint、全量测试及独立审查通过，README / AGENTS / 两级状态文档同步，代码与文档统一原子提交。

## 验证边界

测试使用真实 SDK，替换网络边界，模拟各家响应与错误约束；不使用真实 Key、不发起付费模型调用。包含真实 React 下拉框、输入与保存交互测试。不能只断言 modelId 或检查 provider 名称来证明适配成功。

## 参考

- [DeepSeek JSON 输出要求](https://api-docs.deepseek.com/guides/json_mode/)
- [AI SDK DeepSeek provider](https://ai-sdk.dev/providers/ai-sdk-providers/deepseek)
- [AI SDK OpenAI provider 与 Chat Completions](https://ai-sdk.dev/providers/ai-sdk-providers/openai)
- [AI SDK Anthropic provider](https://ai-sdk.dev/providers/ai-sdk-providers/anthropic)
- [OpenAI JSON mode 与结构化输出](https://developers.openai.com/api/docs/guides/structured-outputs)

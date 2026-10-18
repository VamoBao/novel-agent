# 正文修订复用写作对话 实现计划

> 按用户已确认的调研方案在当前工作区串行执行，WIP = 1；按项目指南整项验收后统一原子提交。设计见同日 specs/2026-10-18-chapter-conversation-cache-design.md。

**目标：** 写作者持续追加历史、启用 Claude 缓存并提供可测量的每次写作用量和耗时。

**架构：** write-chapter 维护会话内原生消息，chapter-review 保持独立；headless 记录结构化诊断，不变更 shared/客户端协议。

**技术栈：** Bun、TypeScript、AI SDK 7、现有官方 provider、bun:test。

## 文件职责

- `apps/agent/src/workflows/write-chapter.ts`：初稿消息、历史追加、修订消息、缓存选项、成功调用用量回调。
- `apps/agent/src/workflows/write-chapter.test.ts`：现有 SQLite 集成回归及多轮历史契约。
- `apps/agent/src/workflows/write-chapter-sdk.test.ts`：独立进程跑真实 SDK/工作流，只替换 HTTP，覆盖三种协议及 headless 诊断。
- `apps/agent/src/headless.ts`：onUsage → stderr 单行 JSON。
- 根/模块架构、进度、AGENTS、DECISIONS：同步最终行为及验证边界。

## 任务 1：持续追加写作历史

- [x] 先补三轮历史和原生元信息保真测试，运行确认失败。
- [x] 将 buildPrompt 收敛成仅生成一次的初稿字符串；调用改用 messages；原生响应整条追加，未通过时仅追加当前报告及修订指令。
- [x] 调整既有 prompt 断言为首条消息/最新修订消息，运行正文和审校定向回归（42 项通过）。

## 任务 2：缓存、诊断与真实 SDK 验证

- [x] 先补真实 SDK 三种 provider 请求边界、缓存字段、用量/耗时及 headless stderr 契约测试，运行确认失败。
- [x] 写作调用添加 Claude canonical cacheControl 命名空间；新增 onUsage 类型/回调，headless 记录 JSON，SDK 缺失计数保留 null。
- [x] 运行真实 SDK/SQLite/入口集成测试和定向回归（48 项通过）。

## 任务 3：整体验证、审查与归档

- [x] 运行 typecheck/lint/全量测试，请独立审查并处理阻塞问题。
- [x] 同步架构/进度/决策及入口说明；完成清单归一（只保留最近五条完成摘要）。
- [x] 检查 diff 与敏感信息，按提交指南统一原子提交并报告验证与实际缓存收益未测的边界。

验证结果：typecheck 三工程、lint、全量 684 项（64 文件）通过；真实 SDK 集成 11 项。独立审查发现 SDK 将缺失 usage 字段归零，已按原始允许字段识别缺失并增加回归，复审关闭。未发起真实模型调用。

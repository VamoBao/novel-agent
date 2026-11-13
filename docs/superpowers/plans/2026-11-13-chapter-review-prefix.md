# 正文审校共享前缀实施计划

**目标：** 保留内容、文风、自洽三次独立审校，以相同资料消息和输出 schema 支持供应商前缀缓存。

**架构：** 每稿组装一次通用 system 与资料 user 消息，各阶段仅追加独立任务。资料含小说简介、所属部/幕梗概及关键情节点、章概述、世界观、登场角色与迁移、伏笔、文风、当前正文；不加入其他审校报告。统一模型输出为 styleRating（可空整数）、issues（类别/依据/建议）、rationale；转换回既有 ReviewReport。Claude 在资料消息末尾设置显式缓存断点；其他 provider 沿用自身缓存机制。

**技术栈：** Bun、TypeScript、Vercel AI SDK、Zod；无新依赖、数据库/客户端协议变更。

用户已在本聊天确认共享前缀及统一 schema，并授权实施。复用当前工作区，保留已有未跟踪的技能文件。

## 任务 1：共享前缀和统一输出

- [x] 修改 chapter-review.test.ts，验证公共消息及 schema 完全一致、仅任务尾部不同、无前项报告污染、无文风跳过、无评分拒绝、结果转换及错误透传；先执行并确认失败。
- [x] 修改 chapter-review.ts：固定 schema 和 system；构建公共资料消息，添加 Claude 内容块 cacheControl；三段只追加任务；阶段结果做语义守卫并映射旧报告。
- [x] 运行 `bun test apps/agent/src/workflows/agents/chapter-writing-agent/chapter-review.test.ts`（16 项通过）。

## 任务 2：大纲接入及真实 SDK 请求验证

- [x] writeChapter 向审校传入与写作同源的小说/部/幕上下文，修订轮只替换当前稿正文。
- [x] 更新 index.test.ts 的模型边界脚本，保留修订、覆盖、失败零落盘及进度断言。
- [x] sdk.test.ts 使用统一返回结构，增加三 provider 的真实 SDK/HTTP 边界检查：schema/前缀稳定、Claude 断点位于资料而非任务、每稿正文隔离。
- [x] 运行 `bun test apps/agent/src/workflows/agents/chapter-writing-agent`（98 项通过）。

## 任务 3：验证与文档

- [x] 更新两级架构/进度、shared 注释及决策记录，保持最近五条完成记录约定。
- [x] 执行 `bun run typecheck`、`bun run lint`、`bun run test`，修复本次引入的问题。
- [x] 独立代码审查、处理阻塞项；按仓库规范原子提交。

线上命中率、费用和文学质量不由离线替身证明，交付时明确此验证边界。

验证：模块 98 项、全量 724 项（71 文件）通过；typecheck/lint 通过，独立审查未发现需修复问题。

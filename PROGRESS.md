# 进度与已知 Bug

时间格式统一为 `YYYY-MM-DD`。

## 已完成

- 2026-09-14 [feat] 接入 AI SDK（`ai@7` + `@ai-sdk/deepseek@3`），创建 `src/providers/deepseek.ts` 提供 provider 实例；搭建 `src/` 分层结构（providers / tools / workflows），入口迁移至 `src/index.ts`；`tools/` 与 `workflows/` 为占位。AC：typecheck / lint / test 通过，`bun run dev` 正常输出，provider 实例可创建 `deepseek-v4-flash` 模型（运行时冒烟验证）
- 2026-09-14 [chore] 初始化项目：Bun + TypeScript 6 脚手架、ESLint 10 工具链、Agent 工作流文档（AGENTS.md + docs/ 三份指引）、git init

## 已知 Bug

（暂无）

## 流程复盘记录

（暂无）

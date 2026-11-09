# 新建小说创作工作台实现计划

用户已于 2026-11-09 确认设计与四项任务，按顺序在当前功能分支内执行，WIP = 1，整个需求统一原子提交。

**目标：** 现代化新建小说页，保留问题与回答，实时展示真实工具/子 Agent 执行。

**架构：** shared 定义 activity 消息，UiChannel 转发，通用 ReAct 运行器使用已安装 SDK 的 onToolExecutionStart/End 回调发事件。客户端独立 timeline 保留问答、阶段、成果与调用，原 flow 契约继续服务章节规划和大纲重生成。CreationFlow 用阶段导航与卡片时间流消费 timeline。

**技术栈：** Bun、TypeScript、zod、AI SDK、React、lucide-react、CSS 语义令牌、happy-dom、Electron。

## 任务 1：活动事件贯通

文件：shared `activity.ts` / `protocol.ts` / `index.ts`，agent `ui/channel.ts`、`ui/protocol-channel.ts`，`agents/react.ts`、`agents/activity.ts` 与相关业务 Agent 入口。

- [x] 添加真实 SDK + HTTP 边界替身测试：执行工具时必须已出现 running 事件；并发工具按独立 ID 关联同一 Agent；工具错误及模型错误闭合事件；终态未完成不得标记成功。
- [x] 运行 `bun test apps/agent/src/agents/react-activity.test.ts` 确认新增行为缺失。
- [x] 定义 Activity：id、parentId、kind、name、status、startedAt、endedAt、input/output 字符串摘要；输入输出限制大小，排除库内 ID 等元信息。
- [x] UiChannel 提供可选 activity 方法以兼容现存通道实现；ProtocolChannel 发送结构化事件，FakeChannel 收集事件，CLI 不额外输出。
- [x] ReAct 增 activity 配置，使用开始/结束回调报告真实工具边界与 SDK 错误；新建流程四个 Agent 入口传通道和名称。
- [x] 验证新增测试及 `react-cache.test.ts`、`protocol-channel.test.ts` 与业务 Agent 定向回归。

## 任务 2：活动时间流与回答历史

文件：client `hooks/session-timeline.ts`、`hooks/use-agent-session.ts` 与对应测试。

- [x] 添加失败测试：问题与答案原位保留、活动乱序结束只更新对应卡、同名工具不合并、终止清理运行态、重试清空旧执行。
- [x] 运行新测试确认缺失行为。
- [x] 新建纯 reducer，timeline 使用递增稳定 key，stage 快照跟随每条记录；flow 保持原 union。
- [x] 会话泵同步 ref 持有请求队列，answer 仅处理尚未提交的首个请求，发送失败保留内容并进入恢复路径。
- [x] 测试命令：`bun test apps/client/src/hooks/session-timeline.test.ts apps/client/src/workflow-resume.interaction.test.tsx`。

## 任务 3：卡片工作台

文件：CreationFlow、QuestionCard、`creation/` 专属阶段/活动卡组件、`creation-workbench.css`、交互测试。

- [x] 添加真实 React 交互回归：回答历史、工具更新/折叠、Agent 等待输入、阶段定位、错误恢复、中文输入法与重复提交。
- [x] 实现顶部状态、阶段导航、初始引导卡、所有消息类型卡片、当前输入区与回到最新入口；以 request id 重置 QuestionCard。
- [x] 输入组件增加可选 workbench 外观，保留其他页用法；长文本使用 textarea 并尊重 composition 状态，数字输入校验无效值。
- [x] 样式限定工作台，复用语义令牌，响应式导航与浅暗主题，处理长值与 reduced-motion。
- [x] 运行新交互测试及 workflow-resume/既有页面回归。

## 任务 4：完整验收与收尾

- [x] 运行 `bun run typecheck`、`bun run lint`、`bun run test`，修复本次引入的问题。
- [x] 运行 `bun run --cwd apps/client build` 验证 Electron 打包构建。
- [x] 在 Electron 中加载真实 CreationFlow 与受控 IPC 活动数据，检查 900/1600px × 浅暗主题截图及横向溢出，检查初始/等待输入/运行/成果/失败状态。
- [x] 自查协议开始事件与用户等待状态、恢复行为、取消生命周期、历史阅读滚动和其他会话页兼容。
- [x] 更新根与 workflows 的架构/进度、入口文档和设计确认状态，按项目提交指南统一提交代码、测试和文档。

验证记录：704 项测试、三工程类型检查、lint 与 Electron build 通过；20 组真实渲染场景无横向溢出，输入/确认/错误卡与调用详情目测通过。截图及布局指标存于 `/tmp/novel-creation-preview/`；无线上模型调用。独立审查未发现阻塞项，指出的无效应答重问关联缺陷已补回归并修复。

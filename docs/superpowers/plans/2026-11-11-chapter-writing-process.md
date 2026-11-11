# 正文生成过程卡实现计划

**目标：** 保留章内生成入口，统一过程、审校与恢复的卡片呈现。
**架构：** PreviewPane 管理目标章会话；chapter-writing 模块提供状态与展示，OutlineNodeCard 只组装。沿用现有 Agent/protocol。
**技术栈：** React、TypeScript、Bun/happy-dom、Electron。

## 任务 1：会话与过程卡交互

- [x] 新增真实 PreviewPane+IPC 交互用例，断言启动即显示准备、分项阈值、报告跨轮、保存未完成/完成状态、异常退出/启动拒绝、目标章隔离与重试；先验证旧版失败。
- [x] 创建 chapter-writing/write-session.ts，定义目标章会话和协议进度归并纯函数（保留轮内结果、按轮保存报告、会话阈值），通过组件测试消费。
- [x] 创建 ChapterWritingProgress.tsx，提供实际状态、五步、三项审校详情、历史报告与失败恢复；OutlineNodeCard 移除旧进度内联实现并委托组件。
- [x] PreviewPane 接收实际消息并保留完成/失败结果；启动拒绝与异常退出收尾，重试复用目标；原覆盖确认与全书单例守卫保持。
- [x] 运行定向交互、章卡回归和类型检查。

## 任务 2：视觉与交付

- [x] 使用专属 CSS/设计令牌，过程卡和报告与现有工作台统一；窄预览内步骤/审校项适配，旧正文仍可滚动阅读。
- [x] 真实 Electron 双主题×宽窄预览验证准备/运行/修订/保存/完成/保底/错误，检查长文本、折叠、状态真实性和溢出。
- [x] 运行全量 typecheck/lint/test/build、独立审查、diff --check。
- [x] 更新根 ARCHITECTURE/PROGRESS/AGENTS/DESIGN/DECISIONS，按仓库约定原子提交。

验收：715项测试（71文件）、类型检查/Lint/build通过；Electron 80组主题/尺寸/流程状态与溢出检查、12组展开审校/历史报告检查通过，独立复核无阻塞。

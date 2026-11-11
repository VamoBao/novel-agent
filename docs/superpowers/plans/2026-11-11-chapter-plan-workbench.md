# 章节规划工作台实现计划

> 面向 AI 代理的工作者：在当前会话内按顺序执行，每个任务完成后更新 PROGRESS.md。用户已确认双栏方案，复用当前 checkout，保留此前 macOS 编辑菜单修复。

**目标：** 让单幕章节规划复用新建小说的卡片工作台与真实调用历史。
**架构：** renderer 内提取时间流展示与滚动 hook，章节页提供专属本幕资料和定位导航；Agent/schema/持久化保持现状。
**技术栈：** React 19、TypeScript、Bun、happy-dom、Electron。

## 任务 1：可复用卡片流与章节页交互

- [x] 先新增 ChapterPlanFlow.interaction.test.tsx：真实组件挂载，发出 activity/request/view/error，断言回答卡与等待工具、确认方案、恢复目标、历史滚动与定位。旧章节页应因不展示活动/回答卡而失败。
- [x] 将 CreationFlow 内 AnswerCard/renderEntry 提取为 creation/SessionTimeline.tsx；保留阶段渲染与 key，默认文案不变，章节页可关闭阶段卡并使用“章节方案”成果标题。
- [x] 提取 hooks/use-timeline-scroll.ts，保持跟随阈值96px、历史不抢焦点和回到最新行为，两页共用。
- [x] 重写 ChapterPlanFlow，复用时间流/样式，左栏本幕概要与已存在内容定位；状态由会话与请求派生，错误/继续沿用现有会话泵。
- [x] App 的规划目标携带已有的所属部/幕梗概/关键情节点；仅展示，不新增协议或查询。
- [x] 运行新增交互、CreationFlow、workflow-resume 与类型检查。

## 任务 2：视觉与交付验证

- [x] 新增章节页专属 CSS，基于全局令牌；960px资料收起与横向导航，640px动作换行；确认结果保留完整信息。
- [x] Electron 浅暗 ×900/1600px准备/输入/确认/错误状态，640px与长标题补查，修复溢出；观察真实控件、折叠详情和输入布局。
- [x] 运行 bun run typecheck、bun run lint、bun run test、客户端 build，检查 git diff --check。
- [x] 按 requesting-code-review 做独立审查并处理阻塞项；同步 ARCHITECTURE.md/PROGRESS.md/AGENTS.md/DESIGN.md 中职责与引用，保留已完成最近5条。

验收结果：709项测试（70文件），类型检查/Lint/build通过；24组Electron主题/尺寸/状态无横向溢出，独立审查无阻塞。

# 伏笔多幕回收规划实现计划

> 使用 subagent-driven-development 分工实现，根协调者维护文档与整体审查。用户已要求修改流程；澄清结果为保留原注意度定义。

目标：自动新增伏笔必须带回收计划，逐幕细化并保留多幕回收链。
架构：SDK 结构化输出强约束 + 确认前上下文校验 + 确定性入库；SQLite 增量迁移，兼容旧缓存。

- [x] 任务 1：数据契约与迁移。shared 新输出 outline.recoverActNames（非空唯一数组）；chapter.recoveryPlan（非空幕列表，各带 chapterNames）；查询新增 recoverActNodeIds 数组。store addForeshadow 第四参兼容单字符串/数组，读侧提供数组及旧 singular 首项。22→23 增JSON列并迁移，listUnrecoveredByAct 按该幕章绑定过滤。先测旧库迁移、多幕分别待办、重开库，再实现。
- [x] 任务 2：Agent 与编排。大纲校验回收幕存在且全书序不早于埋设；章节输入 fullOutline（当前树有序幕与章概述），必须覆盖本幕既有伏笔登场/回收；新增回收计划允许本幕/已有后幕真实章或未规划后幕留空。先测拒绝遗漏与非法引用，再实现及串联真实 store 集成。
- [x] 任务 3：确定性入库和写作。接收旧缓存单幕与新数组，存全部回收幕；章节新增回收规划解析章 ID；回收指令合并已有章。逆序规划按埋设幕校验，登场后验证具体章顺序。后续计划幕未细化不判最终回收。先测多幕追加、同幕先登场后回收、旧缓存与恢复，再实现。
- [x] 任务 4：展示、验收与提交。CLI/确认视图/伏笔卡展示多幕与已细化章节，保留未细化幕提示；真实 React 验证。同步 AGENTS、根/模块 ARCHITECTURE/PROGRESS 与 DECISIONS；typecheck、lint、全量测试、独立审查通过后原子提交。

稳定接口：StoredForeshadow.recoverActNodeIds: string[]，保留 recoverActNodeId: string|null 兼容旧载荷。PlanChaptersInput.fullOutline?: { id: string; partName: string; partSummary?: string; name: string; summary: string; keyPlotPoints: string[]; chapters: { id: string; name: string; summary: string }[] }[]。UI读取 optional 新数组时回退旧单幕。新 output 不接受旧 singular 字段代替必填数组；旧确认缓存仅在 intake 兼容。

复审补充：普通编辑计数与自动追加分离；未确认任务刷新清单并将序号映射同产物缓存；新增 foreshadow-refinement.ts 处理确认后其他幕先完成规划的漂移，仅选择真实回收章再确认，按轮缓存以免数据库失败后重复询问。

最终验收：typecheck三工程、lint、627项测试（62文件）全部通过；独立复审所报三项恢复边界均修复并通过复审。测试未调用真实模型，全部数据库改动仅在内存/临时库验证。

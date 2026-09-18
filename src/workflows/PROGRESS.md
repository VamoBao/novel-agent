# workflows 模块进度与已知 Bug

时间格式统一为 `YYYY-MM-DD`。模块建档于 2026-09-18，此前条目自根目录 `PROGRESS.md` 按模块视角回填（完整 AC 与端到端记录见根文档对应条目）。

## 已完成

- 2026-09-18 [docs] 建立本模块 ARCHITECTURE / PROGRESS 文档；顺带修正根架构文档两处失真：依赖边界补 `output/`（create-novel 实际导入 outline-writer）、目录树补 `workflows/index.ts`
- 2026-09-18 [feat] 大纲生成前询问幕数：`askInt`（3-20，回车默认 5）在编排层收集，经 `outlineSchemaForActs`（refine）在 `save_outline` 入参层强校验恰好 N 幕，模型给错被 schema 拒绝重试。AC：typecheck/lint/test 通过；端到端验证指定 4 幕 → 恰好 4 幕
- 2026-09-17 [feat] 创建流程新增可选命名步骤：命名在 ID 生成后、大纲前询问（回车跳过）；novels 行初始化即建并携带书名；已命名时大纲 title 强制沿用，未命名时大纲确认后以标题回填 name、以 logline 回填 description
- 2026-09-17 [feat] 世界观/角色接入 SQLite 持久化：世界观确认后按创作 ID upsert 入库（1:1）；角色每张卡确认后立即增量入库（1:N，novels 行先建满足外键顺序）
- 2026-09-17 [feat] 大纲增加用户确认循环：`save_outline` 升级最终确认门（确认视图拼入提示原子出现），拒绝 → 按反馈调整 → 再确认循环；去 stopTool 改 isDone 模式，maxSteps 12。端到端验证完整「拒绝→修订→再确认」回路
- 2026-09-16 [feat] `submit_character` 升级最终确认门：必填齐全后由代码组装整卡（assembleCharacter 过 schema）展示用户确认，有反馈则处理后重新提交
- 2026-09-16 [feat] 角色收集重设计为字段协议：13 个扁平字段（FIELD_SPECS），`save_field` 在 execute 内代码强制「概括→确认→保存」，杜绝模型改写漂移；多角色外层循环约束至少一名主角
- 2026-09-15 [feat] 主角/核心冲突收集：自由文本 → `generateObject` 归一化 + 强约束 prompt + 用户确认门
- 2026-09-15 [feat] 模块首建：`createNovel` 主编排 + worldview/outline subAgent（ReAct 终态工具模式）首次端到端跑通；大纲确认后落盘 `output/<id>.json`

## 已知 Bug

- （非阻塞）deepseek-flash 在主角归一化时可能小幅补全用户未提及字段——本模块角色 Agent 的「确认门」兜底，用户答 n 可重新描述；换更强模型可进一步降低漂移
- （限制，非 Bug）ID 续作/恢复路径目前仅「检测到已有 state 直接返回」，未接入分步恢复；依赖 NovelState 持久化（见待办）

## 待办与后续接入点

- `outlines` 表（2026-09-18 已建表与 `OutlineStore`，见 state 模块）接入 createNovel：大纲确认后写入库内大纲树；当前大纲仅落 `output/<id>.json`
- NovelState 整体 SQLite 化：state 仍为内存态（`memoryNovelStateStore`），`store` 已参数化可直接替换实现
- 未来写作工作流：`document_id` 关联正文（documents 表落地后补外键）

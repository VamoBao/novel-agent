# 小说创作参数持久化实现计划

执行：用户已指示开始，按任务包串行执行、WIP=1；测试先行，全部任务完成后统一原子提交。

目标：三项创作条件永久绑定小说，并供详情查询与大纲重生成使用。

架构：共享 novelCreationParamsSchema 校验三项可空属性；NovelStore 负责 JSON 编解码与 SQL；工作流负责收集时机和生成上下文。

技术栈：Bun、TypeScript、SQLite、zod。

## 任务 1：数据模型与迁移

- [x] db.test.ts 新增 v15 三列补齐、旧小说与世界观保留、重开幂等及新库默认 null 用例；先运行观察失败。
- [x] 新增 packages/shared/src/novel.ts：genre 为非空字符串或 null，audience 为非空字符串数组或 null（数组可空），coreConflict 复用 coreConflictSchema 或 null；从 index.ts 导出。
- [x] db.ts schema=16，旧版本迁移内用 db.transaction 补三列，新库 novels 定义补三列；迁移测试目标版本统一 16。
- [x] 运行 bun test apps/agent/src/state/db.test.ts，通过后更新根进度。

## 任务 2：持久化与详情查询

- [x] novel-store.test.ts 验证缺省 null、创建/更新/重开往返、空受众、改名/简介/标记保留、非法输入零写入、损坏 JSON 定位。query.test.ts 与 shared query.test.ts 验证详情传字段和旧载荷兼容；先运行观察失败。
- [x] NovelRecord 继承 NovelCreationParams，NovelInput 新增可选参数，NovelPatch 可更新；INSERT/SELECT/UPDATE SQL 补列；JSON 解码后共享 schema 校验，写入前校验。
- [x] novelDetailSchema.novel 扩展三项字段，旧载荷默认 null；buildNovelDetail 将小说记录的原生值带出，列表契约不变。
- [x] 运行上述三个测试文件与 typecheck，通过后更新根进度。

## 任务 3：工作流接入

- [x] create-novel.test.ts 验证完整入库、类型后中止、受众后中止、大纲前中止的已采集数据保留；regen-outline.test.ts 验证非空条件出现在实际模型请求、历史空条件沿用缺省策略；先运行观察失败。
- [x] create-novel.ts 类型、受众、冲突收集各自完成后 updateNovel；regen-outline.ts 仅传非 null 字段；修正 outline-agent.ts 关于内存字段的注释。
- [x] 运行新建与重生成集成测试，通过后更新根进度。

## 任务 4：验证与收尾

- [x] 同步 AGENTS.md、根/模块 ARCHITECTURE.md 与 PROGRESS.md、DECISIONS.md。
- [x] 运行 bun run typecheck、bun run lint、bun run test，检查 git diff --check。
- [x] 检查实现与任务包一致，任务完成记录归一，代码与文档一次提交。

验收补充：审查复现后加入迁移中断回滚、两连接迁移穿插、两连接管理穿插测试；补列与版本标记同事务并锁内复查，UPDATE 仅写明确字段。

# 书库管理（右键菜单）设计规格

> 状态：已确认（2026-09-21，交互语义采用合理默认并经任务包摘要说明）
> 关联：`docs/superpowers/specs/2026-09-21-client-browse-ui-design.md`（三栏浏览 UI）

## 需求

书库左栏列表支持右键菜单管理小说：**重命名、置顶、收藏、删除**。novels 表添加对应字段。

## 数据层（agent）

### novels 表新增列（SCHEMA_VERSION 4 → 5）

- `pinned INTEGER NOT NULL DEFAULT 0`——置顶
- `favorite INTEGER NOT NULL DEFAULT 0`——收藏
- 重命名复用既有 `name` 列（updateNovel），删除不需要新字段

**迁移策略（重大变更）**：此前「user_version 不匹配即 DROP 重建」的前提是开发期数据可弃；客户端书库已投入使用（真实数据在库），4→5 改为 **ALTER TABLE 增列的保数据迁移**。仅版本 <4 的开发期旧库（或异常版本）保留 DROP 重建兜底。

### NovelStore 扩展

- `listNovels()` 排序改为 `pinned DESC, created_at DESC, id DESC`（置顶组内按创建时间倒序）
- `setNovelPinned(id, pinned)` / `setNovelFavorite(id, favorite)`：置位并返回更新后记录；小说不存在抛错
- `deleteNovel(id)`：**单事务级联删除** outlines（自引用树整删）→ characters → worldviews → novels；小说不存在抛错
- `NovelRecord` 增加 `pinned / favorite` 布尔字段

## 查询 / 管理 CLI（apps/agent/src/query.ts 扩展）

新增子命令（stdout 单行 JSON，失败 stderr + 非零退出）：

| 命令 | 行为 | 输出 |
| --- | --- | --- |
| `rename <id> <name>` | 更新名称（name trim 非空校验） | 更新后 `NovelListItem` |
| `pin <id>` / `unpin <id>` | 置顶 / 取消置顶 | 更新后 `NovelListItem` |
| `favorite <id>` / `unfavorite <id>` | 收藏 / 取消收藏 | 更新后 `NovelListItem` |
| `delete <id>` | 级联删除 + best-effort 清理 `output/<id>.json` 产物 | `{"deleted": "<id>"}` |

**连接方式变更**：list/get 弃用 readonly 连接、统一走 `openDatabase()`——4→5 迁移必须能被纯浏览路径触发（否则旧库首次 `list` 即 `no such column`）；有了保数据迁移后统一连接不再有「查询触发重建」的风险。

## shared 契约

- `novelListItemSchema` 增加 `pinned: boolean` / `favorite: boolean`
- 新增 `novelDeletedResultSchema`：`{ deleted: string }`

## Electron 通道

- main：`library:rename` / `library:setPinned` / `library:setFavorite` / `library:delete` IPC（复用 runLibraryQuery + shared schema 复验）
- preload：`renameNovel(id, name)` / `setNovelPinned(id, pinned)` / `setNovelFavorite(id, favorite)` / `deleteNovel(id)`

## renderer 交互

- 小说项 `onContextMenu` 弹出自定义 HTML 菜单（fixed 定位；点击菜单项或空白处关闭）：**✏️ 重命名 / 📌 置顶（已置顶显示「取消置顶」）/ ⭐ 收藏（同上动态）/ 🗑 删除（红色）**
- 重命名：列表项就地变输入框（Enter 确认、Esc 取消、失焦确认）
- 删除：项内二次确认条（文案明示「角色 / 世界观 / 大纲一并删除」）
- 标识：置顶显示 📌 前缀、收藏显示 ⭐ 后缀；不引入拖拽排序与收藏筛选（YAGNI）
- 联动：操作成功后刷新列表保持选中；删除的是当前选中小说时清空选中与预览

## 任务拆分（同步落盘 PROGRESS.md「进行中」）

1. shared 契约扩展（pinned / favorite / deleted 结果）+ schema 单测
2. agent 数据层：SCHEMA_VERSION 5 + 4→5 ALTER 保数据迁移 + NovelStore 新方法与排序 + 单测（含 v4 库迁移保数据、级联删除）
3. agent query CLI 管理子命令（rename / pin / unpin / favorite / unfavorite / delete + 产物清理 + 统一连接）+ 单测
4. client main / preload 管理 IPC 与 API
5. renderer 右键菜单、内联重命名、删除确认、置顶收藏标识与 App 联动
6. 端到端验证（真实库迁移前后数据保留、CLI 实跑、pin 后无头冒烟截图）+ 文档同步 + 原子提交

## 验收标准（AC）

1. typecheck（3 工程）/ lint / test 全过（含迁移与级联删除新用例）
2. 真实 `data/novel.db`（v4，3 本小说）经新代码打开后：数据完整保留、user_version=5、pin 命令生效且 list 顺序置顶优先
3. 右键菜单四操作在 GUI 可用（重命名 / 置顶 / 收藏 / 删除含二次确认），操作后列表即时刷新——用户人工验收
4. deleteNovel 后 characters / worldviews / outlines 无残留行，output 产物文件被清理（单测 + 实跑验证）

## 不做范围

- 不做拖拽自定义排序（置顶为布尔语义，组内按创建时间）
- 不做收藏筛选视图（收藏仅星标）
- 不做批量操作与撤销恢复
- 不改创作工作流与协议消息

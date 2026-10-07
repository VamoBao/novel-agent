# 章节预览伏笔展示 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 客户端章卡展示本章涉及的伏笔（登场 + 回收两形态带徽标、服务角色 ID 解析名字），数据经 `novelDetail` 查询契约新增的 `foreshadows` 数组下发。

**架构：** 镜像 `documents` 先例——shared 查询契约加 `foreshadowEntrySchema`（`foreshadowSchema.extend({ id })`）与 `novelDetail.foreshadows`；agent 查询 CLI `buildNovelDetail` 读 `ForeshadowStore`；`PreviewPane` 过滤（登场/回收）并解析角色名，`OutlineNodeCard` 纯渲染。规格见 `docs/superpowers/specs/2026-10-07-chapter-foreshadow-preview-design.md`。

**技术栈：** Bun 1.4 + TypeScript 6（strict）、zod 4、`bun:sqlite`、React（client）、`bun:test`。

**执行约定（项目规范，优先于通用惯例）：** SDD 流水线（本会话第四轮）：worktree 分支逐任务提交（每任务实现 + 独立审查），收尾整分支最终审查后 squash 合并回 master 为唯一原子提交；开始任务 1 前把任务清单落盘 `apps/agent/src/workflows/PROGRESS.md`「进行中」并逐任务勾选；每任务闭环 = 聚焦测试绿；任务 4 跑全量。真实 LLM / GUI 端到端由用户复验。

---

## 文件结构（创建 / 修改清单）

| 文件 | 动作 | 职责 |
| --- | --- | --- |
| `packages/shared/src/query.ts` | 修改 | `foreshadowEntrySchema` + `novelDetailSchema.foreshadows` |
| `packages/shared/src/index.ts` | 修改 | 出口补 `foreshadowEntrySchema` / `ForeshadowEntry` |
| `packages/shared/src/query.test.ts` | 修改 | 契约单测 |
| `apps/agent/src/query.ts` | 修改 | `buildNovelDetail` 增伏笔列表 |
| `apps/agent/src/query.test.ts` | 修改 | 集成用例 |
| `apps/client/src/components/OutlineNodeCard.tsx` | 修改 | 导出 `ChapterForeshadow` 显示模型 + 章卡伏笔区块 |
| `apps/client/src/components/PreviewPane.tsx` | 修改 | 过滤（登场/回收）+ 角色名解析 + 传参 |
| 任务 4 另涉及 | 修改 | `AGENTS.md`、根 `ARCHITECTURE.md`、根与模块 `PROGRESS.md` |

命名约定（全计划统一）：`foreshadowEntrySchema` / `ForeshadowEntry`（shared）；`foreshadows: ForeshadowEntry[]`（`novelDetailSchema` 新字段与 `buildNovelDetail` 返回字段同名同形）；`ChapterForeshadow`（OutlineNodeCard 导出的客户端显示模型）；`toChapterForeshadows(detail, chapterId)`（PreviewPane 辅助函数）。

---

### 任务 1：shared 查询契约——foreshadowEntry 与 novelDetail.foreshadows

**文件：**
- 修改：`packages/shared/src/query.ts`、`index.ts`
- 测试：`packages/shared/src/query.test.ts`

- [ ] **步骤 1：编写失败的测试**

`query.test.ts` 顶部 import 增 `foreshadowEntrySchema, novelDetailSchema`（自 `./index`，已有则不重复），文件末尾追加：

```typescript
describe("foreshadowEntrySchema 与 novelDetail.foreshadows", () => {
  const entry = {
    id: "cccccccc-0000-7000-8000-000000000001",
    surfaceAction: "老周把主角派去北境送信",
    hiddenTruth: "暗示老周已经投敌",
    attentionLevel: 4,
    appearChapterId: "ch-1",
    recoverChapterIds: ["ch-9"],
    characterIds: ["char-1", "char-2"],
  };

  test("完整伏笔条目通过；recoveryStatus 缺省补 unrecovered", () => {
    const parsed = foreshadowEntrySchema.parse(entry);
    expect(parsed.recoveryStatus).toBe("unrecovered");
    expect(parsed.appearChapterId).toBe("ch-1");
  });

  test("novelDetail 携带 foreshadows 数组通过契约校验", () => {
    const detail = novelDetailSchema.parse({
      novel: {
        id: "aaaaaaaa-0000-7000-8000-000000000001",
        name: "灵脉破晓",
        pinned: false,
        favorite: false,
        createdAt: "2026-10-07T00:00:00Z",
        updatedAt: "2026-10-07T00:00:00Z",
      },
      worldview: null,
      characters: [],
      outlineNodes: [],
      documents: [],
      foreshadows: [{ ...entry, recoveryStatus: "unrecovered" }],
    });
    expect(detail.foreshadows).toHaveLength(1);
    expect(detail.foreshadows[0]?.characterIds).toEqual(["char-1", "char-2"]);
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`bun test packages/shared`——预期 FAIL（导出不存在 / unknown field）。

- [ ] **步骤 3：编写实现**

`query.ts`：
- import 增 `import { foreshadowSchema } from "./foreshadow";`
- `documentEntrySchema` 之后新增：

```typescript
/** 伏笔条目：foreshadows 表当前行（章卡按 appearChapterId / recoverChapterIds 取用）；
 *  服务角色为 ID，客户端经详情 characters 解析名字 */
export const foreshadowEntrySchema = foreshadowSchema.extend({
  id: z.string().min(1).describe("foreshadows 表主键（UUIDv7）"),
});
export type ForeshadowEntry = z.infer<typeof foreshadowEntrySchema>;
```

- `novelDetailSchema` 在 `documents` 之后增：

```typescript
  foreshadows: z
    .array(foreshadowEntrySchema)
    .describe("全部伏笔（按入库顺序，未生成为空数组；章节点预览按 appearChapterId / recoverChapterIds 取用）"),
```

`index.ts` 的 query 出口块补 `foreshadowEntrySchema` 与 `type ForeshadowEntry`。

- [ ] **步骤 4：运行测试验证通过**

运行：`bun test packages/shared`——预期 PASS（新增 2 条全绿，既有零回归）。

- [ ] **步骤 5：更新 PROGRESS 任务清单**（落盘 4 任务清单并勾选任务 1，不 commit）

---

### 任务 2：agent 查询 CLI——buildNovelDetail 增伏笔

**文件：**
- 修改：`apps/agent/src/query.ts`
- 测试：`apps/agent/src/query.test.ts`

- [ ] **步骤 1：编写失败的测试**

`query.test.ts` 追加用例（沿用文件既有 `newFixture` / `worldview` / `character` 辅助与 `describe("query CLI…")` 组织；ForeshadowStore 种子需 novels 行先建）：

```typescript
  test("get 全量资料携带伏笔条目（登场 / 回收 / 未绑定三形态，按入库顺序）", async () => {
    const { db } = await newFixture();
    const id = "bbbbbbbb-0000-7000-8000-00000000000f";
    new NovelStore(db).createNovel({ id, name: "伏笔之书" });
    const characters = new CharacterStore(db);
    const charId = characters.addCharacter(id, character).id;
    const store = new ForeshadowStore(db);
    const fs = store.addForeshadow(
      id,
      {
        surfaceAction: "宗主赐下断脉散",
        hiddenTruth: "药中掺了追踪灵脉的蛊种",
        attentionLevel: 6,
        appearChapterId: "ch-1",
        characterIds: [charId],
      },
    );
    store.addForeshadow(id, {
      surfaceAction: "半块玉佩",
      hiddenTruth: "主角身世信物",
      attentionLevel: 3,
      recoverChapterIds: ["ch-9"],
    });
    store.addForeshadow(id, {
      surfaceAction: "尚未绑定的伏笔",
      hiddenTruth: "等待章节规划",
      attentionLevel: 5,
    });
    const detail = buildNovelDetail(db, id);
    expect(detail.foreshadows.map((f) => f.surfaceAction)).toEqual([
      "宗主赐下断脉散",
      "半块玉佩",
      "尚未绑定的伏笔",
    ]);
    expect(detail.foreshadows[0]).toMatchObject({
      id: fs.id,
      appearChapterId: "ch-1",
      characterIds: [charId],
      recoveryStatus: "unrecovered",
    });
    expect(detail.foreshadows[1]?.recoverChapterIds).toEqual(["ch-9"]);
    expect(detail.foreshadows[2]?.appearChapterId).toBeUndefined();
    db.close();
  });
```

（import 增 `import { ForeshadowStore } from "./state/foreshadow-store";`；`addForeshadow` 首条可不传 actNodeId——签名第三参可选。）

- [ ] **步骤 2：运行测试验证失败**

运行：`bun test apps/agent/src/query.test.ts`——预期 FAIL（`detail.foreshadows` 不存在）。

- [ ] **步骤 3：编写实现**

`query.ts`：import 增 `ForeshadowStore` 与 `type ForeshadowEntry`（`@novel/shared`）；`buildNovelDetail` 在 documents 组装之后增：

```typescript
  const foreshadows: ForeshadowEntry[] = new ForeshadowStore(db)
    .listForeshadows(novelId)
    .map((f) => ({ id: f.id, ...f.foreshadow }));
```

返回对象在 `documents` 之后增 `foreshadows`（`novelDetailSchema.parse` 校验链路随之覆盖新字段——若 `buildNovelDetail` 返回经 schema parse 复验则自动生效，报告说明实际校验点）。

- [ ] **步骤 4：运行测试验证通过**

运行：`bun test apps/agent/src/query.test.ts && bun run typecheck`——预期 PASS，既有用例零回归。

- [ ] **步骤 5：更新 PROGRESS 任务清单**（勾选任务 2，不 commit）

---

### 任务 3：客户端——PreviewPane 过滤解析 + 章卡伏笔区块

**文件：**
- 修改：`apps/client/src/components/OutlineNodeCard.tsx`、`PreviewPane.tsx`

- [ ] **步骤 1：编写实现（client 无组件测试基建，typecheck + 逻辑自查为验证）**

`OutlineNodeCard.tsx`：
- props 接口上方新增导出显示模型：

```typescript
/** 章卡伏笔显示模型（PreviewPane 过滤登场/回收两组并解析角色名后传入，卡片纯渲染） */
export interface ChapterForeshadow {
  /** React key（同一伏笔可同时命中登场与回收两组，各显示一条） */
  key: string;
  badge: "登场" | "回收";
  surfaceAction: string;
  hiddenTruth: string;
  attentionLevel: number;
  characterNames: string[];
}
```

- `OutlineNodeCardProps` 增：

```typescript
  /** 本章涉及的伏笔（详情 foreshadows 过滤登场/回收两组；无则不渲染区块） */
  foreshadows?: ChapterForeshadow[];
```

- 组件参数解构增 `foreshadows`；正文卡 section（`node.type === "chapter" && document` 块）之后、`showEntry` 块之前插入：

```tsx
      {node.type === "chapter" && foreshadows && foreshadows.length > 0 ? (
        <section className="viewcard">
          <p className="card-label">伏笔</p>
          {foreshadows.map((f) => (
            <p key={f.key} className="outline-summary">
              [{f.badge}] {f.surfaceAction} ⇢ {f.hiddenTruth}（注意度 {f.attentionLevel}
              {f.characterNames.length > 0 ? `，服务：${f.characterNames.join("、")}` : ""}）
            </p>
          ))}
        </section>
      ) : null}
```

`PreviewPane.tsx`：
- import 增 `type ForeshadowEntry`（`@novel/shared`）与 `type { ChapterForeshadow }`（`./OutlineNodeCard`）；
- `toWorldviewView` 之前新增两个模块级辅助函数：

```typescript
/** 伏笔条目 → 章卡显示模型（badge 区分登场/回收；服务角色 ID 经详情 characters 解析名字，未匹配兜底原 ID） */
function toChapterForeshadow(
  f: ForeshadowEntry,
  badge: ChapterForeshadow["badge"],
  nameById: Map<string, string>,
): ChapterForeshadow {
  return {
    key: `${f.id}-${badge}`,
    badge,
    surfaceAction: f.surfaceAction,
    hiddenTruth: f.hiddenTruth,
    attentionLevel: f.attentionLevel,
    characterNames: (f.characterIds ?? []).map((id) => nameById.get(id) ?? id),
  };
}

/** 章节点 → 涉及的伏笔（登场 appearChapterId / 回收 recoverChapterIds 含本章；同一伏笔可两组各显示一条） */
function toChapterForeshadows(detail: NovelDetail, chapterId: string): ChapterForeshadow[] {
  const nameById = new Map(detail.characters.map((c) => [c.id, c.character.basicInfo.name]));
  const items: ChapterForeshadow[] = [];
  for (const f of detail.foreshadows) {
    if (f.appearChapterId === chapterId) {
      items.push(toChapterForeshadow(f, "登场", nameById));
    }
    if (f.recoverChapterIds?.includes(chapterId)) {
      items.push(toChapterForeshadow(f, "回收", nameById));
    }
  }
  return items;
}
```

- 章节分支 `OutlineNodeCard` 传参增（`document` 行之后）：

```tsx
          foreshadows={
            node.type === "chapter" ? toChapterForeshadows(detail, node.id) : undefined
          }
```

- [ ] **步骤 2：运行验证**

运行：`bun run typecheck && bun run lint && bun run test`——预期全绿（client typecheck 过；全量零回归）。

- [ ] **步骤 3：更新 PROGRESS 任务清单**（勾选任务 3，不 commit；commit 留任务 4 统一执行——本任务不单独提交则与任务 4 合并提交，报告说明）

> 执行注记：client 无组件测试基建，本任务验证 = typecheck + 全量回归；渲染逻辑正确性由任务审查者代码检视把关，GUI 观感由用户人工验收（可选用 `NOVEL_CLIENT_SELECT` + `NOVEL_CLIENT_SCREENSHOT` 无头截图）。

---

### 任务 4：全量校验 + 文档同步 + 提交

**文件：**
- 修改：`AGENTS.md`、根 `ARCHITECTURE.md`、根与模块 `PROGRESS.md`

- [ ] **步骤 1：全量工程校验**

运行：`bun run typecheck && bun run lint && bun run test`——预期 100% 通过（基线 262 + 净增用例）。

- [ ] **步骤 2：文档同步**

- `AGENTS.md`：client 条目章卡描述补「本章涉及的伏笔（登场/回收徽标 + 服务角色名）」；query 契约描述补 foreshadows。
- 根 `ARCHITECTURE.md`：query CLI `get` 描述补伏笔条目；客户端浏览描述（章卡）补伏笔区块。
- 根与模块 `PROGRESS.md`：进行中清单归一为完成总结（最近 5 条滚动归档；AC 含全量校验结果与 GUI 待人工验收标注）。
- 文档事实以代码为准（`toChapterForeshadows` / `ChapterForeshadow` / 渲染文案「[登场] 表面行为 ⇢ 隐藏真相（注意度 N，服务：…）」grep 核实）。

- [ ] **步骤 3：提交**

```bash
git add -A
git commit -m "feat(client): 章节预览卡展示本章伏笔——查询契约与章卡渲染"
```

（若任务 3 未单独提交，本提交含其改动；提交信息相应覆盖。提交前 `git status` 复核不得混入 `files/`、`.env`、临时产物。）

---

## 自检记录（编写时已执行）

1. **规格覆盖度**：§3.1→任务 1；§3.2→任务 2；§3.3→任务 3；§4 边界（无伏笔不渲染 / 名字解析兜底原 ID / 回收空数组无感 / 必填数组兼容性）落在任务 1-3 测试与代码；§5 测试计划逐一对应；§6→任务 4。无遗漏。
2. **占位符扫描**：无待定/TODO/「类似任务 N」；每个代码步骤有完整代码块。
3. **类型一致性**：`foreshadowEntrySchema` / `ForeshadowEntry` / `foreshadows` / `ChapterForeshadow` / `toChapterForeshadows` 全计划一致；`characterIds ?? []` 对 optional 数组兜底；`addForeshadow` 第三参可选签名与任务 2 种子用法一致；PreviewPane 传参点（章节分支 `OutlineNodeCard`）与实读 JSX 行位对应。

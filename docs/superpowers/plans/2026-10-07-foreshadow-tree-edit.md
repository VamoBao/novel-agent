# 结构树伏笔组与预览编辑 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 中栏结构树在角色与大纲之间展示伏笔组（按埋设幕两级树、可展开），点击伏笔右栏预览全字段并支持编辑（含登场章与服务角色绑定修正，经 `update-foreshadow` 查询管理命令直写库）。

**架构：** 查询契约补 `foreshadowEntry.actNodeId`（树分组依据）→ agent 查询 CLI 新增 `update-foreshadow`（完整卡 parse 后转 patch：可选空=null 清空、回收章不入 patch）→ client IPC 链（main/preload/env.d.ts）→ StructureTreePanel 伏笔组（Selection 扩展）→ ForeshadowPreview + ForeshadowEditForm（镜像角色先例）。规格见 `docs/superpowers/specs/2026-10-07-foreshadow-tree-edit-design.md`。

**技术栈：** Bun 1.4 + TypeScript 6（strict）、zod 4、`bun:sqlite`、React（client）、`bun:test`。

**执行约定（项目规范，优先于通用惯例）：** 同前四轮：worktree 分支逐任务提交 + 独立任务审查（子代理配额受限时降级内联执行并如实记录）、收尾 squash 回 master 唯一原子提交；每任务边界全量测试绿（跨任务契约变更须带机械适配）；任务清单落盘 `apps/agent/src/workflows/PROGRESS.md` 并逐任务勾选；GUI 观感由用户人工验收。

---

## 文件结构（创建 / 修改清单）

| 文件 | 动作 | 职责 |
| --- | --- | --- |
| `packages/shared/src/query.ts` | 修改 | `foreshadowEntrySchema` 增 `actNodeId: string \| null` |
| `packages/shared/src/query.test.ts` | 修改 | actNodeId 两态单测（既有载荷适配） |
| `apps/agent/src/query.ts` | 修改 | 条目补 actNodeId；`parseForeshadowJson` / `toForeshadowEntry` / `toForeshadowPatch` / `updateForeshadowEntry` + `update-foreshadow` 命令与用法行 |
| `apps/agent/src/query.test.ts` | 修改 | update-foreshadow 集成用例 |
| `apps/client/electron/main.ts` | 修改 | `handleForeshadowMutation` + `library:updateForeshadow` handler |
| `apps/client/electron/preload.ts` | 修改 | `updateForeshadow` 暴露 |
| `apps/client/src/env.d.ts` | 修改 | `updateForeshadow` 类型 |
| `apps/client/src/components/StructureTreePanel.tsx` | 修改 | Selection 扩展 + 伏笔组（按幕两级树） |
| `apps/client/src/components/ForeshadowEditForm.tsx` | 创建 | 伏笔编辑表单 |
| `apps/client/src/components/PreviewPane.tsx` | 修改 | `ForeshadowPreview` 分支 + props |
| `apps/client/src/App.tsx` | 修改 | `onForeshadowSaved` 接线 |
| 任务 6 另涉及 | 修改 | `AGENTS.md`、根 `ARCHITECTURE.md`、根与模块 `PROGRESS.md`、根 `DECISIONS.md` |

命名约定（全计划统一）：`actNodeId`（entry 字段）；`parseForeshadowJson` / `toForeshadowEntry` / `toForeshadowPatch` / `updateForeshadowEntry`（agent query.ts 导出或模块内）；`update-foreshadow` CLI 命令；`updateForeshadow`（preload/env.d.ts）；`Selection` 增 `{ kind: "foreshadow"; foreshadowId: string }`；`ForeshadowEditForm`（新组件，props：`novelId` / `entry: ForeshadowEntry` / `chapters: { id; label }[]` / `characters: CharacterEntry[]` / `onSubmitted` / `onCancel`）；`ForeshadowPreview`（PreviewPane 内模块级组件）。

---

### 任务 1：shared 契约——actNodeId

**文件：**
- 修改：`packages/shared/src/query.ts`；`apps/agent/src/query.ts`（一行机械适配）
- 测试：`packages/shared/src/query.test.ts`；`apps/agent/src/query.test.ts`（既有断言适配）

- [ ] **步骤 1：编写失败的测试**

`query.test.ts`（shared）既有 foreshadowEntry 用例的 `entry` 载荷补 `actNodeId: "act-1"`，并追加两态断言：

```typescript
  test("actNodeId 值与 null 两态均合法（树分组依据）", () => {
    expect(foreshadowEntrySchema.parse({ ...entry, actNodeId: "act-1" }).actNodeId).toBe("act-1");
    expect(foreshadowEntrySchema.parse({ ...entry, actNodeId: null }).actNodeId).toBeNull();
  });
```

（novelDetail 用例载荷的 foreshadows 条目同步补 `actNodeId: "act-1"`。）

- [ ] **步骤 2：运行测试验证失败**

运行：`bun test packages/shared`——预期 FAIL（unknown field 剥离后 actNodeId 为 undefined）。

- [ ] **步骤 3：编写实现**

`query.ts`（shared）`foreshadowEntrySchema` 的 `id` 之后增：

```typescript
  actNodeId: z
    .string()
    .min(1)
    .nullable()
    .describe("埋设幕节点 ID（outlines 表 act 节点）；未绑幕 / 旧数据为 null"),
```

**机械适配**（保持全量绿——`buildNovelDetail` 返回经 `novelDetailSchema.parse`，缺必填字段会 5 红同前轮先例）：`apps/agent/src/query.ts` 的伏笔映射改为 `.map((f) => ({ id: f.id, ...f.foreshadow, actNodeId: f.actNodeId }))`；agent `query.test.ts` 既有伏笔用例的 `toMatchObject` 断言不受影响，但其种子若经 `buildNovelDetail` 回读则自然携带（无需改动；若有直构 entry 载荷处补 actNodeId）。

- [ ] **步骤 4：运行测试验证通过**

运行：`bun test packages/shared && bun run typecheck && bun run test`——预期全绿（agent 侧零红）。

- [ ] **步骤 5：Commit + PROGRESS 勾选任务 1**

```bash
git commit -m "feat(shared): foreshadowEntry 增 actNodeId（结构树幕分组依据）"
```

---

### 任务 2：agent 查询 CLI——update-foreshadow 命令

**文件：**
- 修改：`apps/agent/src/query.ts`
- 测试：`apps/agent/src/query.test.ts`

- [ ] **步骤 1：编写失败的测试**

`query.test.ts` 追加 describe（种子：novels 行 + OutlineStore 两部四幕树 + saveChapters 两个章节点 + CharacterStore 两角色 + ForeshadowStore 一条伏笔——挂幕一、绑章一、绑角色一、带 `recoverChapterIds: ["ch-x"]` 与 `plantingMethod`）：

```typescript
describe("query CLI update-foreshadow", () => {
  test("改必填值 / 清空可选项（null 语义）/ 改登场章与服务角色 / 回收章现值保留 / 返回条目含 actNodeId", async () => {
    const { db } = await newFixture();
    const id = "dddddddd-0000-7000-8000-000000000001";
    new NovelStore(db).createNovel({ id, name: "伏笔编辑之书" });
    const outlineStore = new OutlineStore(db);
    const tree = outlineStore.saveOutlineTree(id, [
      { name: "第一部", summary: "概述", acts: [
        { name: "第1幕", summary: "梗概", keyPlotPoints: ["情节点"] },
        { name: "第2幕", summary: "梗概", keyPlotPoints: ["情节点"] },
      ] },
    ]);
    const act1 = tree.find((n) => n.node.type === "act")!;
    const act2 = tree.filter((n) => n.node.type === "act")[1]!;
    const chapters = outlineStore.saveChapters(id, act1.id, [
      { name: "第一章", summary: "概述" },
      { name: "第二章", summary: "概述" },
    ]);
    const chapter1 = chapters[0]!;
    const characterStore = new CharacterStore(db);
    const charA = characterStore.addCharacter(id, character);
    const charB = characterStore.addCharacter(id, { ...character, basicInfo: { name: "老周", gender: "男" } });
    const fs = new ForeshadowStore(db).addForeshadow(id, {
      surfaceAction: "宗主赐下断脉散",
      hiddenTruth: "药中掺了蛊种",
      attentionLevel: 6,
      recoveryStatus: "unrecovered",
      plantingMethod: "对话",
      purpose: "引子",
      appearChapterId: chapter1.id,
      recoverChapterIds: ["chapter-recover-keep"],
      characterIds: [charA.id],
    }, act1.id);

    const updated = updateForeshadowEntry(db, id, fs.id, JSON.stringify({
      surfaceAction: "宗主赐下的药",
      hiddenTruth: "药中掺了追踪蛊种",
      attentionLevel: 8,
      recoveryStatus: "partial",
      appearChapterId: chapters[1]!.id,
      characterIds: [charB.id],
    }));

    expect(updated.id).toBe(fs.id);
    expect(updated.actNodeId).toBe(act1.id);          // 幕归属不受编辑影响
    expect(updated.surfaceAction).toBe("宗主赐下的药");
    expect(updated.attentionLevel).toBe(8);
    expect(updated.recoveryStatus).toBe("partial");
    expect(updated.plantingMethod).toBeUndefined();   // 未携带 → 清空
    expect(updated.purpose).toBeUndefined();
    expect(updated.appearChapterId).toBe(chapters[1]!.id);
    expect(updated.characterIds).toEqual([charB.id]);
    expect(updated.recoverChapterIds).toEqual(["chapter-recover-keep"]); // 回收章保留现值
    expect(new ForeshadowStore(db).getForeshadow(fs.id)?.foreshadow.hiddenTruth).toBe("药中掺了追踪蛊种");
    db.close();
  });

  test("伏笔不存在：抛可读错误", async () => {
    const { db } = await newFixture();
    const id = "dddddddd-0000-7000-8000-000000000002";
    new NovelStore(db).createNovel({ id });
    expect(() =>
      updateForeshadowEntry(db, id, "no-such-fs", JSON.stringify({
        surfaceAction: "x", hiddenTruth: "y", attentionLevel: 1, recoveryStatus: "unrecovered",
      })),
    ).toThrow("伏笔不存在");
    db.close();
  });
});
```

（import 增 `updateForeshadowEntry`；`character` 为文件既有 fixture。）

- [ ] **步骤 2：运行测试验证失败**

运行：`bun test apps/agent/src/query.test.ts`——预期 FAIL（`updateForeshadowEntry` 未导出）。

- [ ] **步骤 3：编写实现**

`query.ts` 在 `updateCharacterEntry` 之后新增（imports 补 `ForeshadowStore`（已有）、`foreshadowSchema, type Foreshadow, type ForeshadowPatch, type ForeshadowEntry`（`@novel/shared`）与 `type StoredForeshadow`）：

```typescript
function parseForeshadowJson(json: string): Foreshadow {
  try {
    return foreshadowSchema.parse(JSON.parse(json));
  } catch (error) {
    throw new Error(`伏笔 JSON 不合法：${error instanceof Error ? error.message : String(error)}`);
  }
}

function toForeshadowEntry(stored: StoredForeshadow): ForeshadowEntry {
  return { id: stored.id, ...stored.foreshadow, actNodeId: stored.actNodeId };
}

/**
 * 表单完整卡 → patch：必填字段与回收状态直接覆盖；可选项有值传值、缺省传 null
 * （清空——patch 语义 undefined=不动）；characterIds 空选传 null 清空；
 * recoverChapterIds 不入 patch（编辑面不含回收章，保留现值）。
 */
function toForeshadowPatch(foreshadow: Foreshadow): ForeshadowPatch {
  return {
    surfaceAction: foreshadow.surfaceAction,
    hiddenTruth: foreshadow.hiddenTruth,
    attentionLevel: foreshadow.attentionLevel,
    recoveryStatus: foreshadow.recoveryStatus,
    plantingMethod: foreshadow.plantingMethod ?? null,
    purpose: foreshadow.purpose ?? null,
    appearChapterId: foreshadow.appearChapterId ?? null,
    characterIds: foreshadow.characterIds ?? null,
  };
}

/** update-foreshadow 载荷：patch 更新伏笔（服务角色同小说校验在 store 内），返回更新后条目 */
export function updateForeshadowEntry(
  db: ReturnType<typeof openDatabase>,
  novelId: string,
  foreshadowId: string,
  foreshadowJson: string,
): ForeshadowEntry {
  const patch = toForeshadowPatch(parseForeshadowJson(foreshadowJson));
  return toForeshadowEntry(new ForeshadowStore(db).updateForeshadow(foreshadowId, patch));
}
```

`main` 的 switch 增（update-character 之后）：

```typescript
      case "update-foreshadow":
        if (!novelId || rest.length !== 2 || !rest[0] || !rest[1]) break;
        process.stdout.write(`${JSON.stringify(updateForeshadowEntry(db, novelId, rest[0], rest[1]))}\n`);
        return 0;
```

文件头用法注释与 usage 字符串各补 `| update-foreshadow <novelId> <foreshadowId> <伏笔JSON>`。

- [ ] **步骤 4：运行测试验证通过**

运行：`bun test apps/agent/src/query.test.ts && bun run typecheck`——预期 PASS 零回归。

- [ ] **步骤 5：Commit + PROGRESS 勾选任务 2**

```bash
git commit -m "feat(query): update-foreshadow 管理命令——patch 语义编辑伏笔"
```

---

### 任务 3：client IPC 链

**文件：**
- 修改：`apps/client/electron/main.ts`、`preload.ts`、`src/env.d.ts`

- [ ] **步骤 1：编写实现（typecheck 验证）**

`main.ts`：import 增 `foreshadowEntrySchema, type ForeshadowEntry`（shared，检查既有 import 块合并）；`handleCharacterMutation` 之后新增：

```typescript
/** 伏笔管理（编辑）：操作成功返回伏笔条目（含 actNodeId） */
function handleForeshadowMutation(args: string[]): Promise<ForeshadowEntry> {
  return runLibraryQuery(args).then((raw) => {
    const result = foreshadowEntrySchema.safeParse(raw);
    if (!result.success) {
      throw new Error(`伏笔结果不合查询 schema：${result.error.issues[0]?.message ?? "未知错误"}`);
    }
    return result.data;
  });
}

ipcMain.handle(
  "library:updateForeshadow",
  (_event, novelId: string, foreshadowId: string, foreshadow: Foreshadow): Promise<ForeshadowEntry> =>
    handleForeshadowMutation(["update-foreshadow", novelId, foreshadowId, JSON.stringify(foreshadow)]),
);
```

（`Foreshadow` 类型自 shared import。）

`preload.ts`（updateCharacter 之后）：

```typescript
  updateForeshadow: (novelId: string, foreshadowId: string, foreshadow: Foreshadow): Promise<ForeshadowEntry> =>
    ipcRenderer.invoke("library:updateForeshadow", novelId, foreshadowId, foreshadow),
```

`env.d.ts`（对齐 preload 签名，import 增 `Foreshadow` / `ForeshadowEntry` 类型）：

```typescript
      updateForeshadow: (novelId: string, foreshadowId: string, foreshadow: Foreshadow) => Promise<ForeshadowEntry>;
```

- [ ] **步骤 2：运行验证**

运行：`bun run typecheck && bun run lint && bun run test`——预期全绿。

- [ ] **步骤 3：Commit + PROGRESS 勾选任务 3**

```bash
git commit -m "feat(client): library:updateForeshadow IPC 链——主进程/预加载/类型声明"
```

---

### 任务 4：结构树伏笔组

**文件：**
- 修改：`apps/client/src/components/StructureTreePanel.tsx`

- [ ] **步骤 1：编写实现（typecheck + 逻辑自查验证）**

- `Selection` 联合增：

```typescript
  | { kind: "foreshadow"; foreshadowId: string };
```

- 组件内新增 state（charsCollapsed 之后）：

```typescript
  /** 伏笔分组整组收起（默认展开），会话内保持 */
  const [fsGroupCollapsed, setFsGroupCollapsed] = useState(false);
  /** 收起的伏笔幕分组（actNodeId；未绑幕组键 "__none__"），默认空 = 全展开，会话内保持 */
  const [fsActCollapsed, setFsActCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const toggleFsAct = (key: string): void => {
    setFsActCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
```

- 角色组渲染之后、大纲组 `tree-group` 之前插入（分组构造放在 JSX 前）：

```typescript
  // 伏笔按埋设幕分组：幕顺序对齐大纲树当前版本 act 顺序；未绑幕归末尾「未绑幕」组
  const fsGroups: { key: string; label: string; items: ForeshadowEntry[] }[] = detail
    ? (() => {
        const actOrder = detail.outlineNodes
          .filter((n) => n.type === "act")
          .map((n) => ({ id: n.id, name: n.name }));
        const groups = actOrder.map((act) => ({
          key: act.id,
          label: act.name,
          items: detail.foreshadows.filter((f) => f.actNodeId === act.id),
        }));
        const unbound = detail.foreshadows.filter((f) => f.actNodeId === null);
        if (unbound.length > 0) groups.push({ key: "__none__", label: "未绑幕", items: unbound });
        return groups.filter((g) => g.items.length > 0);
      })()
    : [];
```

JSX（角色组块之后）：

```tsx
          <div className="tree-group">
            {detail.foreshadows.length > 0 ? (
              <button
                className="tree-toggle"
                title={fsGroupCollapsed ? "展开伏笔" : "收起伏笔"}
                onClick={() => setFsGroupCollapsed((v) => !v)}
              >
                {fsGroupCollapsed ? "▸" : "▾"}
              </button>
            ) : null}
            <span>🔮 伏笔</span>
          </div>
          {detail.foreshadows.length === 0 ? (
            <TreeNode label="（暂无伏笔）" depth={1} muted />
          ) : fsGroupCollapsed ? null : (
            fsGroups.map((group) => (
              <div key={group.key}>
                <div className="tree-row" style={{ paddingLeft: 16 }}>
                  <button
                    className="tree-toggle"
                    title={fsActCollapsed.has(group.key) ? "展开" : "收起"}
                    onClick={() => toggleFsAct(group.key)}
                  >
                    {fsActCollapsed.has(group.key) ? "▸" : "▾"}
                  </button>
                  <span className="tree-node static">{group.label}（{group.items.length}）</span>
                </div>
                {fsActCollapsed.has(group.key)
                  ? null
                  : group.items.map((f) => (
                      <TreeNode
                        key={f.id}
                        label={`✦ ${f.surfaceAction}`}
                        depth={2}
                        active={selection?.kind === "foreshadow" && selection.foreshadowId === f.id}
                        onClick={() => onSelect({ kind: "foreshadow", foreshadowId: f.id })}
                      />
                    ))}
              </div>
            ))
          )}
```

（import 增 `type ForeshadowEntry`；`tree-node static` 若无既有样式类，改用纯 `<span>` 不带 class——以 styles.css 既有类为准，无则不加并报告说明。）

- [ ] **步骤 2：运行验证**

`bun run typecheck && bun run lint && bun run test` 全绿。

- [ ] **步骤 3：Commit + PROGRESS 勾选任务 4**

```bash
git commit -m "feat(client): 结构树角色与大纲之间增伏笔组——按幕分组两级树"
```

---

### 任务 5：右栏预览与编辑表单

**文件：**
- 创建：`apps/client/src/components/ForeshadowEditForm.tsx`
- 修改：`apps/client/src/components/PreviewPane.tsx`、`apps/client/src/App.tsx`

- [ ] **步骤 1：编写 ForeshadowEditForm（完整组件，骨架对齐 CharacterEditForm——写前通读该文件）**

```typescript
import { useState } from "react";
import { foreshadowSchema, type Foreshadow, type ForeshadowEntry, type CharacterEntry } from "@novel/shared";

/** 登场章选项：当前版本章节点（label 为 部名/幕名/章名），空串 = 未绑定 */
export interface ChapterOption {
  id: string;
  label: string;
}

interface ForeshadowEditFormProps {
  novelId: string;
  entry: ForeshadowEntry;
  chapters: readonly ChapterOption[];
  characters: readonly CharacterEntry[];
  onSubmitted: (entry: ForeshadowEntry) => void;
  onCancel: () => void;
}

const RECOVERY_OPTIONS: readonly { value: Foreshadow["recoveryStatus"]; label: string }[] = [
  { value: "unrecovered", label: "未回收" },
  { value: "partial", label: "部分回收" },
  { value: "recovered", label: "已回收" },
];

/** 表单值 → 完整伏笔卡（可选项空 = undefined；characterIds 空选 = undefined——schema min(1)） */
function toForeshadow(
  form: Omit<ReturnType<typeof initialState>, never> extends never ? never : never,
): never {
  throw new Error("占位——见下方真实实现");
}
```

（**注意**：上方 `toForeshadow` 为占位示意，**必须**按下列真实形态实现——本段防止抄错，实现如下。）

真实实现要点（组件完整落地，字段与校验按此写）：
- `FormState { surfaceAction: string; hiddenTruth: string; attentionLevel: string; recoveryStatus: Foreshadow["recoveryStatus"]; plantingMethod: string; purpose: string; appearChapterId: string; characterIds: string[] }`；`initialState(entry)`：attentionLevel 取 `String(entry.attentionLevel)`、appearChapterId 取 `entry.appearChapterId ?? ""`、characterIds 取 `entry.characterIds ?? []`、其余文本 `?? ""`。
- `toForeshadow(form): Foreshadow`：

```typescript
function toForeshadow(form: FormState): Foreshadow {
  const opt = (value: string): string | undefined => {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };
  return foreshadowSchema.parse({
    surfaceAction: form.surfaceAction.trim(),
    hiddenTruth: form.hiddenTruth.trim(),
    attentionLevel: Number(form.attentionLevel),
    recoveryStatus: form.recoveryStatus,
    plantingMethod: opt(form.plantingMethod),
    purpose: opt(form.purpose),
    appearChapterId: opt(form.appearChapterId),
    ...(form.characterIds.length > 0 ? { characterIds: form.characterIds } : {}),
  });
}
```

- `submit()`：`Number(form.attentionLevel)` 非整数或不在 1-10 → `setError("读者注意度须为 1-10 的整数")` 拦截；`foreshadowSchema.safeParse` 失败提示首个 issue；通过后 `setSubmitting(true)` → `window.agent.updateForeshadow(novelId, entry.id, toForeshadow(form))` → 成功 `onSubmitted(updated)` / 失败 `setError(String(err))` / finally 复位 submitting。
- JSX（`<section className="viewcard">` + `card-label`「编辑伏笔」）：surfaceAction / hiddenTruth 为 textarea（`.form-textarea` 或既有类，对齐 CharacterEditForm 字段类名）；attentionLevel 为 `<input type="number" min={1} max={10}>`；recoveryStatus 为 `<select>`（RECOVERY_OPTIONS）；plantingMethod / purpose 为 `<input type="text">`；appearChapterId 为 `<select>`——首项 `<option value="">（未绑定）</option>` + chapters 选项；characterIds 为 checkbox 组（`characters.map` + checked 切换 setField）；底部错误行 + 按钮区（「提交」primary / 「取消」）——全部类名与结构对齐 CharacterEditForm 既有形态（写前通读取类名）。

- [ ] **步骤 2：PreviewPane 接线**

- props 增 `onForeshadowSaved?: () => void;`
- import 增 `ForeshadowEditForm`、`type ForeshadowEntry`（shared）；
- 模块级新增 `ForeshadowPreview`（镜像 CharacterPreview：`editing` state；编辑态渲染 `ForeshadowEditForm`，props 需 `chapters`——由 PreviewPane 从 `detail.outlineNodes` 构造：章节点 `type === "chapter"`，label 为「部名/幕名/章名」（按 parentId 上溯两级，缺失级省略）；预览态为 `<div className="preview-actions"><button onClick={() => setEditing(true)}>✏️ 编辑伏笔</button></div>` + viewcard 只读卡）：

```tsx
function ForeshadowPreview({
  novelId,
  entry,
  detail,
  onSaved,
}: {
  novelId: string;
  entry: ForeshadowEntry;
  detail: NovelDetail;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const chapters = chapterOptions(detail);
  const actName = detail.outlineNodes.find((n) => n.id === entry.actNodeId)?.name ?? "未绑幕";
  const appearName = detail.outlineNodes.find((n) => n.id === entry.appearChapterId)?.name ?? null;
  const nameById = new Map(detail.characters.map((c) => [c.id, c.character ? c.basicInfo.name : c.basicInfo.name]));
  if (editing) {
    return (
      <ForeshadowEditForm
        novelId={novelId}
        entry={entry}
        chapters={chapters}
        characters={detail.characters}
        onSubmitted={() => {
          setEditing(false);
          onSaved();
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }
  return (
    <>
      <div className="preview-actions">
        <button onClick={() => setEditing(true)}>✏️ 编辑伏笔</button>
      </div>
      <section className="viewcard">
        <p className="card-label">伏笔 · {actName}</p>
        <p className="outline-summary">表面行为：{entry.surfaceAction}</p>
        <p className="outline-summary">隐藏真相：{entry.hiddenTruth}</p>
        <p className="outline-summary">注意度：{entry.attentionLevel}　回收状态：{recoveryLabel(entry.recoveryStatus)}</p>
        <p className="outline-summary">登场章：{appearName ?? "（未绑定）"}</p>
        <p className="outline-summary">服务角色：{(entry.characterIds ?? []).map((cid) => nameById.get(cid) ?? cid).join("、") || "（无）"}</p>
        {entry.plantingMethod ? <p className="outline-summary">埋线方式：{entry.plantingMethod}</p> : null}
        {entry.purpose ? <p className="outline-summary">创作目的：{entry.purpose}</p> : null}
      </section>
    </>
  );
}
```

（**注意**：上方 `nameById` 行含一处待修正写法 `c.character ? ... : ...`——`CharacterEntry` 为扁平结构，直接 `c.basicInfo.name`；`recoveryLabel` 与 `chapterOptions` 为需实现的模块级辅助——`recoveryLabel(status)` 返回 RECOVERY 三态中文（与表单常量一致，可从 ForeshadowEditForm 导出复用）；`chapterOptions(detail)` 构造 `ChapterOption[]`。落地时以修正后形态实现。）

- 分支（character 分支之后）：

```tsx
  } else if (selection.kind === "foreshadow") {
    const entry = detail.foreshadows.find((f) => f.id === selection.foreshadowId);
    body = entry ? (
      <ForeshadowPreview
        novelId={detail.novel.id}
        entry={entry}
        detail={detail}
        onSaved={onForeshadowSaved ?? (() => {})}
      />
    ) : (
      <p className="pane-error">该伏笔内容未能加载（数据缺失）。</p>
    );
  }
```

- [ ] **步骤 3：App 接线**

`PreviewPane` 使用处增 `onForeshadowSaved={() => { if (selectedId) void reloadDetail(selectedId); }}`（对齐 onCharacterSaved 既有接线形态——读 App.tsx 该处实际写法照搬）。

- [ ] **步骤 4：运行验证**

`bun run typecheck && bun run lint && bun run test` 全绿；`bun run dev:client` 启动冒烟（可选，GUI 留人工验收）。

- [ ] **步骤 5：Commit + PROGRESS 勾选任务 5**

```bash
git commit -m "feat(client): 伏笔右栏预览与编辑表单——全字段含登场章/服务角色绑定"
```

---

### 任务 6：全量校验 + 文档同步 + 提交

**文件：**
- 修改：`AGENTS.md`、根 `ARCHITECTURE.md` / `DECISIONS.md`、根与模块 `PROGRESS.md`

- [ ] **步骤 1：全量工程校验**

`bun run typecheck && bun run lint && bun run test` 100% 通过。

- [ ] **步骤 2：文档同步**

- `AGENTS.md`：query 管理命令补 update-foreshadow；client 条目结构树补「伏笔组（按幕两级树）」与 ForeshadowEditForm；预览描述补伏笔预览/编辑。
- 根 `ARCHITECTURE.md`：query CLI 命令清单；客户端浏览描述（结构树伏笔组、右栏伏笔预览/编辑）。
- 根 `DECISIONS.md`：patch 编辑语义（undefined=不动 / null=清空与表单清空映射、recoverChapterIds 保留现值）与幕分组行不选中两项。
- 根与模块 `PROGRESS.md`：进行中清单归一为完成总结（最近 5 条滚动归档；AC 含全量校验与 GUI 待人工验收）。
- 文档事实以代码为准 grep 核实（命令名 / 组件名 / 渲染文案）。

- [ ] **步骤 3：提交**

```bash
git add -A
git commit -m "docs: 结构树伏笔组与编辑需求同步入口/架构/进度/决策文档"
```

---

## 自检记录（编写时已执行）

1. **规格覆盖度**：§3.1→任务 1；§3.2→任务 2；§3.3→任务 3；§3.4→任务 4；§3.5→任务 5；§4 边界（幕/章解析兜底、清空 null 语义、伏笔不存在、旧数据未绑幕组）落在任务 1/2/4/5；§5 测试计划逐一对应；§6→任务 6。无遗漏。
2. **占位符扫描**：任务 5 步骤 1 的 `toForeshadow`「占位示意」段与步骤 2 的「待修正写法」均附**真实实现文本**与修正说明（防抄错而非缺内容）；其余步骤均有完整代码或精确指令。
3. **类型一致性**：`actNodeId` / `updateForeshadowEntry` / `toForeshadowPatch` / `update-foreshadow` / `updateForeshadow`（IPC）/ `ForeshadowEntry`（flat：`c.basicInfo.name`）/ `ChapterOption` / `chapterOptions` / `recoveryLabel` 全计划一致；任务 1 机械适配（buildNovelDetail 映射）显式列出防 5 红。

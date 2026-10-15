import { useState } from "react";
import {
  CHARACTER_MIGRATION_FIELD_PATHS,
  CHARACTER_FIELD_SPECS,
  type CharacterEntry,
  type CharacterFieldPath,
  type CharacterMigrationEntry,
  type CharacterMigrationStatus,
  type NovelDetail,
} from "@novel/shared";
import { chapterOptions } from "../chapter-options";
import { globalChapterOrder } from "../chapter-order";

/** 迁移状态 → 中文标签 */
const STATUS_LABELS: Record<CharacterMigrationStatus, string> = {
  draft: "草案",
  confirmed: "已确认",
  cancelled: "已取消",
};

interface MigrationFormState {
  migrateField: CharacterFieldPath;
  newValue: string;
  startChapterId: string;
  endChapterId: string;
  trigger: string;
  transitionGuidance: string;
}

const EMPTY_FORM: MigrationFormState = {
  migrateField: "personality",
  newValue: "",
  startChapterId: "",
  endChapterId: "",
  trigger: "",
  transitionGuidance: "",
};

/** 迁移条目 → 表单初始值（编辑 / 复制为新草案共用） */
function fromMigration(entry: CharacterMigrationEntry): MigrationFormState {
  return {
    migrateField: entry.migrateField,
    newValue: entry.newValue ?? "",
    startChapterId: entry.startChapterId ?? "",
    endChapterId: entry.endChapterId ?? "",
    trigger: entry.trigger ?? "",
    transitionGuidance: entry.transitionGuidance ?? "",
  };
}

/** 复制方案保留字段、目标与创作指导，清空章节供作者重新安排。 */
function copyAsDraft(entry: CharacterMigrationEntry): MigrationFormState {
  return {
    ...EMPTY_FORM,
    migrateField: entry.migrateField,
    newValue: entry.newValue ?? "",
    trigger: entry.trigger ?? "",
    transitionGuidance: entry.transitionGuidance ?? "",
  };
}

interface MigrationFormProps {
  novelId: string;
  characterId: string;
  detail: NovelDetail;
  /** 编辑态源条目；缺省 = 新建 */
  entry?: CharacterMigrationEntry;
  /** 初始值覆盖（复制为新草案用） */
  initial?: MigrationFormState;
  /** 表单展示的旧值（服务端派生；新建时为提示文案） */
  oldValueHint: string;
  onDone: () => void;
  onCancel: () => void;
}

/**
 * 迁移编辑 / 新建表单：字段（新建时可改，编辑态只读）、目标值、起止章、诱因与过渡描述；
 * 旧值只读（服务端派生）。草案可保存或原子保存并确认；已确认记录仅保存修改。
 * 新建目标值一律必填（新增表达一次变化必须有目标），编辑可选字段留空 = 清空；
 * 必填项、区间与全链校验由服务端复核，失败零写入并原样回显错误。
 */
function MigrationForm({
  novelId,
  characterId,
  detail,
  entry,
  initial,
  oldValueHint,
  onDone,
  onCancel,
}: MigrationFormProps) {
  const [form, setForm] = useState<MigrationFormState>(() =>
    initial ?? (entry ? fromMigration(entry) : EMPTY_FORM),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chapters = chapterOptions(detail);
  const order = globalChapterOrder(detail);
  const spec = CHARACTER_FIELD_SPECS[form.migrateField];
  const newValueMissing = form.newValue.trim().length === 0;

  const setField = <K extends keyof MigrationFormState>(key: K, value: MigrationFormState[K]): void => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  /** 客户端预校验（服务端仍会复核）：新建目标值一律必填、编辑必填字段不可清空、起止章顺序 */
  const localError = (): string | null => {
    if (newValueMissing) {
      if (entry === undefined) return "目标值不能为空";
      if (spec.required) return `字段「${spec.label}」为必填，目标值不能为空`;
    }
    if (form.endChapterId !== "" && form.startChapterId === "") return "结束章不能在没有起始章时绑定";
    if (form.startChapterId !== "" && form.endChapterId !== "") {
      const start = order.get(form.startChapterId);
      const end = order.get(form.endChapterId);
      if (start !== undefined && end !== undefined && end < start) return "起始章不能晚于结束章";
    }
    return null;
  };

  /** 保存与确认是一笔提交；校验失败不会留下草案或部分编辑。 */
  const persist = async (confirm: boolean): Promise<CharacterMigrationEntry> => {
    const values = {
      newValue: form.newValue.trim().length > 0 ? form.newValue.trim() : null,
      startChapterId: form.startChapterId || null,
      endChapterId: form.endChapterId || null,
      trigger: form.trigger.trim().length > 0 ? form.trigger.trim() : null,
      transitionGuidance:
        form.transitionGuidance.trim().length > 0 ? form.transitionGuidance.trim() : null,
    };
    if (entry) {
      return window.agent.saveMigration(novelId, characterId, {
        action: "update", migrationId: entry.id, patch: values, confirm,
      });
    }
    if (form.migrateField === "basicInfo.name") throw new Error("姓名为固定项，不允许迁移修改");
    return window.agent.saveMigration(novelId, characterId, {
      action: "create", input: { migrateField: form.migrateField, ...values }, confirm,
    });
  };

  const run = (action: "save" | "confirm"): void => {
    const invalid = localError();
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    persist(action === "confirm")
      .then(() => onDone())
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <section className="character-form migration-form">
      <h3>{entry ? `✏️ 编辑迁移（序号 ${entry.sequence} · 修订 v${entry.revision}）` : "🧬 新增角色迁移"}</h3>
      <div className="form-fields">
        <div className="field">
          <label>变化字段</label>
          {entry ? (
            <input value={spec.label} readOnly />
          ) : (
            <select
              value={form.migrateField}
              disabled={busy}
              onChange={(e) => setField("migrateField", e.target.value as CharacterFieldPath)}
            >
              {CHARACTER_MIGRATION_FIELD_PATHS.map((path) => (
                <option key={path} value={path}>
                  {CHARACTER_FIELD_SPECS[path].label}
                  {CHARACTER_FIELD_SPECS[path].required ? "（必填）" : ""}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="field">
          <label>原值（服务端派生，只读）</label>
          <input value={oldValueHint} readOnly />
        </div>
        <div className="field">
          <label>
            目标值{entry === undefined || spec.required ? <span className="req"> *</span> : null}
          </label>
          <textarea
            rows={2}
            value={form.newValue}
            disabled={busy}
            placeholder={
              entry === undefined
                ? "目标值不能为空"
                : spec.required
                  ? "必填字段的目标值不能为空"
                  : "留空表示清空该可选字段"
            }
            onChange={(e) => setField("newValue", e.target.value)}
          />
        </div>
        <div className="field">
          <label>起始章（确认生效前必填）</label>
          <select
            value={form.startChapterId}
            disabled={busy}
            onChange={(e) => setField("startChapterId", e.target.value)}
          >
            <option value="">（未绑定）</option>
            {chapters.map((chapter) => (
              <option key={chapter.id} value={chapter.id}>
                {chapter.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>结束章（留空 = 开放区间）</label>
          <select
            value={form.endChapterId}
            disabled={busy || form.startChapterId === ""}
            title={form.startChapterId === "" ? "请先绑定起始章" : undefined}
            onChange={(e) => setField("endChapterId", e.target.value)}
          >
            <option value="">（未确定）</option>
            {chapters.map((chapter) => (
              <option key={chapter.id} value={chapter.id}>
                {chapter.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>诱因 / 变化目的（创作计划；确认生效前必填）</label>
          <textarea
            rows={2}
            value={form.trigger}
            disabled={busy}
            onChange={(e) => setField("trigger", e.target.value)}
          />
        </div>
        <div className="field">
          <label>过渡描述（中间过程 / 保留的特征 / 结束时表现；确认生效前必填）</label>
          <textarea
            rows={3}
            value={form.transitionGuidance}
            disabled={busy}
            onChange={(e) => setField("transitionGuidance", e.target.value)}
          />
        </div>
      </div>
      <p className="hint">
        起止章须属于同一大纲树版本；同字段的生效区间不能重叠，不同字段可并行。旧值由服务端按
        起始章之前最近一条同字段已确认迁移的新值派生（无前置迁移则取基准），确认时重新解析。
      </p>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="form-actions">
        <button className={entry?.status === "confirmed" ? "primary" : undefined} disabled={busy} onClick={() => run("save")}>
          {busy ? "提交中…" : entry?.status === "confirmed" ? "💾 保存修改" : "💾 保存草案"}
        </button>
        {entry?.status !== "confirmed" ? (
          <button className="primary" disabled={busy} onClick={() => run("confirm")}>
            ✅ 确认生效
          </button>
        ) : null}
        <button disabled={busy} onClick={onCancel}>
          取消
        </button>
      </div>
    </section>
  );
}

interface CharacterMigrationPanelProps {
  novelId: string;
  character: CharacterEntry;
  detail: NovelDetail;
  /** 迁移增删改确认成功后刷新详情（App 侧 reloadDetail） */
  onChanged: () => void;
}

/**
 * 角色迁移清单与操作入口（固定基准下的「人物线」维护面）：
 * 逐条展示序号 / 修订版 / 状态 / 字段 / 原值 → 目标值 / 章节区间 / 诱因 / 过渡描述，
 * 并提供新增、编辑、确认生效、取消与「复制为新草案」（归档旧版方案重新绑定用）。
 * 基准卡只读——角色卡本体的修改一律经迁移表达。
 */
export function CharacterMigrationPanel({
  novelId,
  character,
  detail,
  onChanged,
}: CharacterMigrationPanelProps) {
  /** 复制属于新建态，源记录仅提供初始值，绝不作为更新目标。 */
  const [editing, setEditing] = useState<
    null | { mode: "new"; initial?: MigrationFormState } | { mode: "edit"; entry: CharacterMigrationEntry }
  >(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const migrations = detail.migrations
    .filter((migration) => migration.characterId === character.id)
    .sort((a, b) => a.sequence - b.sequence);
  // 章名解析：绑定在归档旧版大纲上的章不在当前树内，以文案占位（不展示 ID）
  const chapters = chapterOptions(detail);
  const chapterLabel = (id: string | null): string =>
    id === null ? "—" : (chapters.find((option) => option.id === id)?.label ?? "（归档版本章）");
  const fieldLabel = (field: CharacterFieldPath): string => CHARACTER_FIELD_SPECS[field].label;

  const act = (migrationId: string, request: Promise<unknown>): void => {
    setBusyId(migrationId);
    setRowError(null);
    request
      .then(() => onChanged())
      .catch((e: unknown) => setRowError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusyId(null));
  };

  if (editing !== null) {
    const entry = editing.mode === "edit" ? editing.entry : undefined;
    return (
      <MigrationForm
        novelId={novelId}
        characterId={character.id}
        detail={detail}
        entry={entry}
        initial={editing.mode === "new" ? editing.initial : undefined}
        oldValueHint={
          entry
            ? (entry.oldValue ?? "（未定起始章，确认时由服务端派生）")
            : "（保存后按起始章由服务端派生）"
        }
        onDone={() => {
          setEditing(null);
          onChanged();
        }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <section className="viewcard migration-panel">
      <div className="migration-head">
        <p className="card-label">🧬 角色迁移（{migrations.length}）</p>
        <button className="tree-group-btn" title="新增迁移" onClick={() => setEditing({ mode: "new" })}>
          ＋
        </button>
      </div>
      {rowError ? <p className="form-error">{rowError}</p> : null}
      {migrations.length === 0 ? (
        <p className="dim">（暂无迁移——角色卡为固定基准，人物变化经迁移表达）</p>
      ) : (
        <ul className="migration-list">
          {migrations.map((migration) => (
            <li key={migration.id} className={`migration-row ${migration.status}`}>
              <p className="migration-title">
                {`#${migration.sequence} · ${fieldLabel(migration.migrateField)}（${STATUS_LABELS[migration.status]} · 修订 v${migration.revision}）`}
              </p>
              <p className="outline-summary">
                {migration.oldValue ?? "（未定）"} → {migration.newValue ?? "（清空）"}
              </p>
              <p className="outline-summary">
                章节：{chapterLabel(migration.startChapterId)} ~{" "}
                {migration.endChapterId ? chapterLabel(migration.endChapterId) : "（开放）"}
                {migration.outlineVersion !== null ? ` · 大纲 v${migration.outlineVersion}` : ""}
              </p>
              {migration.trigger ? (
                <p className="outline-summary">诱因：{migration.trigger}</p>
              ) : null}
              {migration.transitionGuidance ? (
                <p className="outline-summary">过渡：{migration.transitionGuidance}</p>
              ) : null}
              <div className="migration-actions">
                {migration.migrateField === "basicInfo.name" ? <p className="hint">姓名为固定项，历史迁移仅供查看或取消。</p> : null}
                {migration.status === "draft" && migration.migrateField !== "basicInfo.name" ? (
                  <>
                    <button
                      disabled={busyId === migration.id}
                      onClick={() => setEditing({ mode: "edit", entry: migration })}
                    >
                      ✏️ 编辑
                    </button>
                    <button
                      className="primary"
                      disabled={busyId === migration.id}
                      onClick={() =>
                        act(migration.id, window.agent.confirmMigration(novelId, migration.id))
                      }
                    >
                      ✅ 确认生效
                    </button>
                  </>
                ) : null}
                {migration.status === "confirmed" && migration.migrateField !== "basicInfo.name" ? (
                  <button
                    disabled={busyId === migration.id}
                    onClick={() => setEditing({ mode: "edit", entry: migration })}
                  >
                    ✏️ 编辑
                  </button>
                ) : null}
                {migration.status !== "cancelled" ? (
                  <button
                    disabled={busyId === migration.id}
                    onClick={() =>
                      act(migration.id, window.agent.cancelMigration(novelId, migration.id))
                    }
                  >
                    🗑 取消
                  </button>
                ) : null}
                {migration.status !== "draft" && migration.migrateField !== "basicInfo.name" ? (
                  <button
                    disabled={busyId === migration.id}
                    title="以该方案新建一条草案（章节与状态重新填写）"
                    onClick={() =>
                      setEditing({ mode: "new", initial: copyAsDraft(migration) })
                    }
                  >
                    ⧉ 复制为新草案
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

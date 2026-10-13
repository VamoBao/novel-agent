import { useState } from "react";
import {
  CHARACTER_FIELD_PATHS,
  CHARACTER_FIELD_SPECS,
  type CharacterEntry,
  type CharacterFieldPath,
  type CharacterMigrationEntry,
  type CharacterMigrationPatch,
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

/** 空表单（复制为新草案：只带字段与目标值，章节与诱因留待作者重新填写） */
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
 * 旧值只读（服务端派生）。两个提交动作——「保存草案」只落库，「确认生效」先落库再确认
 * （必填项与区间校验在服务端，错误原样回显）。
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

  /** 客户端预校验（服务端仍会复核）：必填目标值、起止章顺序 */
  const localError = (): string | null => {
    if (newValueMissing && spec.required) return `字段「${spec.label}」为必填，目标值不能为空`;
    if (form.endChapterId !== "" && form.startChapterId === "") return "结束章不能在没有起始章时绑定";
    if (form.startChapterId !== "" && form.endChapterId !== "") {
      const start = order.get(form.startChapterId);
      const end = order.get(form.endChapterId);
      if (start !== undefined && end !== undefined && end < start) return "起始章不能晚于结束章";
    }
    return null;
  };

  /** 落库（新建走 addMigration、编辑走 updateMigration），返回迁移条目 */
  const persist = async (): Promise<CharacterMigrationEntry> => {
    const values = {
      newValue: form.newValue.trim().length > 0 ? form.newValue.trim() : null,
      startChapterId: form.startChapterId || null,
      endChapterId: form.endChapterId || null,
      trigger: form.trigger.trim().length > 0 ? form.trigger.trim() : null,
      transitionGuidance:
        form.transitionGuidance.trim().length > 0 ? form.transitionGuidance.trim() : null,
    };
    if (entry) {
      const patch: CharacterMigrationPatch = values;
      return window.agent.updateMigration(novelId, entry.id, patch);
    }
    return window.agent.addMigration(novelId, characterId, {
      migrateField: form.migrateField,
      ...values,
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
    persist()
      .then(async (saved) => {
        if (action === "confirm") {
          await window.agent.confirmMigration(novelId, saved.id);
        }
        onDone();
      })
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
              {CHARACTER_FIELD_PATHS.map((path) => (
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
            目标值{spec.required ? <span className="req"> *</span> : null}
          </label>
          <textarea
            rows={2}
            value={form.newValue}
            disabled={busy}
            placeholder={spec.required ? "必填字段的目标值不能为空" : "留空表示清空该可选字段"}
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
        <button disabled={busy} onClick={() => run("save")}>
          {busy ? "提交中…" : "💾 保存草案"}
        </button>
        <button className="primary" disabled={busy} onClick={() => run("confirm")}>
          ✅ 确认生效
        </button>
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
  /** null = 清单态；"new" = 新建；条目 = 编辑该条；{entry, initial} = 复制为新草案 */
  const [editing, setEditing] = useState<
    null | "new" | { entry: CharacterMigrationEntry; initial?: MigrationFormState }
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
    const entry = editing === "new" ? undefined : editing.entry;
    return (
      <MigrationForm
        novelId={novelId}
        characterId={character.id}
        detail={detail}
        entry={entry}
        initial={editing !== "new" ? editing.initial : undefined}
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
        <button className="tree-group-btn" title="新增迁移" onClick={() => setEditing("new")}>
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
                {migration.status === "draft" ? (
                  <>
                    <button
                      disabled={busyId === migration.id}
                      onClick={() => setEditing({ entry: migration })}
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
                {migration.status === "confirmed" ? (
                  <button
                    disabled={busyId === migration.id}
                    onClick={() => setEditing({ entry: migration })}
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
                {migration.status !== "draft" ? (
                  <button
                    disabled={busyId === migration.id}
                    title="以该方案新建一条草案（章节与状态重新填写）"
                    onClick={() =>
                      setEditing({ entry: migration, initial: copyAsDraft(migration) })
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

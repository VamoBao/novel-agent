import { useState } from "react";
import {
  foreshadowSchema,
  type CharacterEntry,
  type Foreshadow,
  type ForeshadowEntry,
} from "@novel/shared";

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
  /** 提交成功（返回更新后条目） */
  onSubmitted: (entry: ForeshadowEntry) => void;
  /** 取消：退出表单，不做任何修改 */
  onCancel: () => void;
}

/** 回收状态三态文案（表单下拉与预览卡共用，经 recoveryLabel 取用） */
export const RECOVERY_OPTIONS: readonly { value: Foreshadow["recoveryStatus"]; label: string }[] =
  [
    { value: "unrecovered", label: "未回收" },
    { value: "partial", label: "部分回收" },
    { value: "recovered", label: "已回收" },
  ];

/** 回收状态枚举值 → 中文（未匹配兜底原值；与表单下拉文案同源） */
export function recoveryLabel(status: Foreshadow["recoveryStatus"]): string {
  return RECOVERY_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

/** 表单态：与 foreshadowSchema 字段对应的扁平字符串（可选项空串 = 未填），
 *  characterIds 为勾选的服务角色 ID 列表（空选 = 无服务角色） */
interface FormState {
  surfaceAction: string;
  hiddenTruth: string;
  attentionLevel: string;
  recoveryStatus: Foreshadow["recoveryStatus"];
  plantingMethod: string;
  purpose: string;
  appearChapterId: string;
  characterIds: string[];
}

/** 伏笔条目 → 表单值（undefined → 空串 / 空数组） */
function initialState(entry: ForeshadowEntry): FormState {
  return {
    surfaceAction: entry.surfaceAction,
    hiddenTruth: entry.hiddenTruth,
    attentionLevel: String(entry.attentionLevel),
    recoveryStatus: entry.recoveryStatus,
    plantingMethod: entry.plantingMethod ?? "",
    purpose: entry.purpose ?? "",
    appearChapterId: entry.appearChapterId ?? "",
    characterIds: entry.characterIds ?? [],
  };
}

/** 表单值 → 完整伏笔卡（trim；可选项空 = undefined；characterIds 空选展开省略——schema min(1)） */
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

/** string 文本字段（textarea / 数字输入 / 下拉共用受控更新；
 *  recoveryStatus 枚举与 characterIds 勾选组单独更新） */
type TextFieldName =
  | "surfaceAction"
  | "hiddenTruth"
  | "attentionLevel"
  | "plantingMethod"
  | "purpose"
  | "appearChapterId";

/**
 * 伏笔编辑表单（仅编辑既有伏笔——伏笔由大纲 / 章节规划流自动入库，无新建模式）：
 * 字段对齐 foreshadowSchema，必填三项（表面行为 / 隐藏真相非空 + 注意度 1-10 整数）
 * 不满足时禁止提交并提示。提交经 query CLI 直写库（patch 语义按主键更新）；
 * 取消零副作用。登场章下拉选项与回收状态文案由调用方（PreviewPane）复用导出。
 */
export function ForeshadowEditForm({
  novelId,
  entry,
  chapters,
  characters,
  onSubmitted,
  onCancel,
}: ForeshadowEditFormProps) {
  const [form, setForm] = useState<FormState>(() => initialState(entry));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setTextField = (field: TextFieldName, value: string): void => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const toggleCharacter = (id: string, checked: boolean): void => {
    setForm((prev) => ({
      ...prev,
      characterIds: checked
        ? [...prev.characterIds, id]
        : prev.characterIds.filter((cid) => cid !== id),
    }));
  };

  const missing: string[] = [];
  if (form.surfaceAction.trim().length === 0) missing.push("表面行为");
  if (form.hiddenTruth.trim().length === 0) missing.push("隐藏真相");
  const attention = Number(form.attentionLevel);
  const attentionInvalid = !Number.isInteger(attention) || attention < 1 || attention > 10;
  const busy = submitting;

  const submit = (): void => {
    if (attentionInvalid) {
      setError("读者注意度须为 1-10 的整数");
      return;
    }
    if (missing.length > 0) {
      setError(`必填字段未填：${missing.join("、")}`);
      return;
    }
    // 上述守卫通过后 toForeshadow 内 foreshadowSchema.parse 不会再失败
    //（可选项空串已归一 undefined、勾选列表为非空串 ID、枚举来自固定下拉）
    setSubmitting(true);
    setError(null);
    window.agent
      .updateForeshadow(novelId, entry.id, toForeshadow(form))
      .then((updated) => {
        onSubmitted(updated);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        setSubmitting(false);
      });
  };

  return (
    <section className="viewcard character-form">
      <p className="card-label">编辑伏笔</p>
      <div className="form-fields">
        <div className={`field${form.surfaceAction.trim().length === 0 ? " invalid" : ""}`}>
          <label>
            表面行为（伏笔的表面表现）
            <span className="req"> *</span>
          </label>
          <textarea
            rows={3}
            value={form.surfaceAction}
            disabled={busy}
            onChange={(e) => setTextField("surfaceAction", e.target.value)}
          />
        </div>
        <div className={`field${form.hiddenTruth.trim().length === 0 ? " invalid" : ""}`}>
          <label>
            隐藏真相（伏笔真正要反映的剧情）
            <span className="req"> *</span>
          </label>
          <textarea
            rows={3}
            value={form.hiddenTruth}
            disabled={busy}
            onChange={(e) => setTextField("hiddenTruth", e.target.value)}
          />
        </div>
        <div className={`field${attentionInvalid ? " invalid" : ""}`}>
          <label>
            读者注意度（1 最易发现，10 最难发现）
            <span className="req"> *</span>
          </label>
          <input
            type="number"
            min={1}
            max={10}
            step={1}
            value={form.attentionLevel}
            disabled={busy}
            onChange={(e) => setTextField("attentionLevel", e.target.value)}
          />
        </div>
        <div className="field">
          <label>回收状态</label>
          <select
            value={form.recoveryStatus}
            disabled={busy}
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                recoveryStatus: e.target.value as Foreshadow["recoveryStatus"],
              }))
            }
          >
            {RECOVERY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>登场章（伏笔首次出现的章；未绑定 = 暂不指定）</label>
          <select
            value={form.appearChapterId}
            disabled={busy}
            onChange={(e) => setTextField("appearChapterId", e.target.value)}
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
          <label>服务角色（伏笔暗示其走向的角色，可多选）</label>
          {characters.length === 0 ? (
            <p className="hint">（暂无角色）</p>
          ) : (
            characters.map((character) => (
              <label key={character.id} className="checkbox-row">
                <input
                  type="checkbox"
                  checked={form.characterIds.includes(character.id)}
                  disabled={busy}
                  onChange={(e) => toggleCharacter(character.id, e.target.checked)}
                />
                {character.basicInfo.name}
              </label>
            ))
          )}
        </div>
        <div className="field">
          <label>埋线方式（如对话、一个物件描述、托梦）</label>
          <input
            type="text"
            value={form.plantingMethod}
            disabled={busy}
            onChange={(e) => setTextField("plantingMethod", e.target.value)}
          />
        </div>
        <div className="field">
          <label>创作目的（如某一重大事件的引子）</label>
          <input
            type="text"
            value={form.purpose}
            disabled={busy}
            onChange={(e) => setTextField("purpose", e.target.value)}
          />
        </div>
      </div>
      {missing.length > 0 ? <p className="form-error">必填字段未填：{missing.join("、")}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
      <div className="form-actions">
        <button
          className="primary"
          disabled={busy || missing.length > 0 || attentionInvalid}
          title={
            missing.length > 0
              ? `必填未填：${missing.join("、")}`
              : attentionInvalid
                ? "读者注意度须为 1-10 的整数"
                : undefined
          }
          onClick={submit}
        >
          {submitting ? "提交中…" : "提交"}
        </button>
        <button disabled={busy} onClick={onCancel}>
          取消
        </button>
      </div>
    </section>
  );
}

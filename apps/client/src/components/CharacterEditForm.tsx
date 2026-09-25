import { useEffect, useRef, useState } from "react";
import { characterSchema, type Character, type CharacterEntry } from "@novel/shared";

/** 表单态：与 characterSchema 字段一一对应的扁平字符串（可选项空串 = 未填） */
interface FormState {
  name: string;
  gender: string;
  appearance: string;
  desire: string;
  fear: string;
  narrativeRole: string;
  background: string;
  personality: string;
  characterGoal: string;
  creationPurpose: string;
  trajectory: string;
  endingDirection: string;
  relationships: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  gender: "",
  appearance: "",
  desire: "",
  fear: "",
  narrativeRole: "",
  background: "",
  personality: "",
  characterGoal: "",
  creationPurpose: "",
  trajectory: "",
  endingDirection: "",
  relationships: "",
};

/** 必填字段（与 characterSchema 的 min(1) 约束一致）：缺一不可提交 */
const REQUIRED_FIELDS: readonly (readonly [keyof FormState, string])[] = [
  ["name", "姓名"],
  ["desire", "渴望"],
  ["fear", "恐惧"],
  ["narrativeRole", "叙事定位"],
  ["background", "背景"],
  ["creationPurpose", "创作目的"],
  ["endingDirection", "结局方向"],
];

const TEXTAREA_FIELDS: ReadonlySet<keyof FormState> = new Set([
  "appearance",
  "desire",
  "fear",
  "background",
  "personality",
  "characterGoal",
  "creationPurpose",
  "trajectory",
  "endingDirection",
  "relationships",
]);

/** 表单值 → 角色卡（trim；可选项空串归一为 undefined） */
function toCharacter(form: FormState): Character {
  const opt = (value: string): string | undefined => {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };
  return {
    basicInfo: {
      name: form.name.trim(),
      gender: opt(form.gender),
      appearance: opt(form.appearance),
    },
    core: {
      desire: form.desire.trim(),
      fear: form.fear.trim(),
      narrativeRole: form.narrativeRole.trim(),
    },
    background: form.background.trim(),
    personality: opt(form.personality),
    characterGoal: opt(form.characterGoal),
    creationPurpose: form.creationPurpose.trim(),
    trajectory: opt(form.trajectory),
    endingDirection: form.endingDirection.trim(),
    relationships: opt(form.relationships),
  };
}

/** 角色卡 → 表单值（润色结果回填与编辑初始值共用；undefined → 空串） */
function fromCharacter(character: Character): FormState {
  return {
    name: character.basicInfo.name,
    gender: character.basicInfo.gender ?? "",
    appearance: character.basicInfo.appearance ?? "",
    desire: character.core.desire,
    fear: character.core.fear,
    narrativeRole: character.core.narrativeRole,
    background: character.background,
    personality: character.personality ?? "",
    characterGoal: character.characterGoal ?? "",
    creationPurpose: character.creationPurpose,
    trajectory: character.trajectory ?? "",
    endingDirection: character.endingDirection,
    relationships: character.relationships ?? "",
  };
}

interface CharacterEditFormProps {
  novelId: string;
  /** 编辑模式传角色条目（初始值 + 按主键更新）；缺省 = 新建模式（空表单，入库 version=1） */
  character?: CharacterEntry;
  /** 世界观是否已确认（润色的依据；未确认时 AI 润色禁用） */
  hasWorldview: boolean;
  /** 提交成功（编辑返回更新后条目 / 新建返回新条目） */
  onSubmitted: (entry: CharacterEntry) => void;
  /** 取消：退出表单，不做任何修改 */
  onCancel: () => void;
}

/**
 * 角色编辑 / 新建表单（两模式共用）：字段对齐 characterSchema，7 个必填字段
 * 空值时禁止提交并提示。三个动作——
 * - 🪄 AI 润色：以表单当前值 + 世界观经 LLM 全字段润色后回填表单（polish-result
 *   协议消息；可重复润色；不自动入库，可订阅期间取消编辑即中止 agent 会话）；
 * - 提交：zod 校验通过后经 query CLI 直写库（编辑版本化 version+1，新建 version=1）；
 * - 取消：退出表单零副作用。
 */
export function CharacterEditForm({
  novelId,
  character,
  hasWorldview,
  onSubmitted,
  onCancel,
}: CharacterEditFormProps) {
  const [form, setForm] = useState<FormState>(() =>
    character ? fromCharacter(character) : EMPTY_FORM,
  );
  const [polishing, setPolishing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 润色会话消息订阅：结果回填表单；会话收尾 / 错误复位润色态
  useEffect(() => {
    const offMessage = window.agent.onMessage((message) => {
      if (message.type === "polish-result") {
        setForm(fromCharacter(message.character));
        setPolishing(false);
        setError(null);
      } else if (message.type === "run_finished" || message.type === "error") {
        if (message.type === "error") setError(message.message);
        setPolishing(false);
        // 收尾兜底：确保单例 agent 空闲，不影响下一次润色（对已退出进程是空操作）
        void window.agent.stop();
      }
    });
    const offExit = window.agent.onExit(() => setPolishing(false));
    return () => {
      offMessage();
      offExit();
    };
  }, []);

  // 卸载时若润色仍在进行（用户取消编辑 / 切换节点）：中止会话
  const polishingRef = useRef(polishing);
  polishingRef.current = polishing;
  useEffect(
    () => () => {
      if (polishingRef.current) void window.agent.stop();
    },
    [],
  );

  const setField = (field: keyof FormState, value: string): void => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const missing = REQUIRED_FIELDS.filter(([field]) => form[field].trim().length === 0).map(
    ([, label]) => label,
  );
  const hasAnyInput = Object.values(form).some((value) => value.trim().length > 0);
  const busy = polishing || submitting;

  const polish = (): void => {
    setPolishing(true);
    setError(null);
    void window.agent.start({
      mode: "polish-character",
      novelId,
      characterId: character?.id,
      formJson: JSON.stringify(toCharacter(form)),
    });
  };

  const submit = (): void => {
    const parsed = characterSchema.safeParse(toCharacter(form));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(`角色卡数据不合法（${issue?.path.join(".") || "根"}）：${issue?.message ?? "未知问题"}`);
      return;
    }
    setSubmitting(true);
    setError(null);
    const request = character
      ? window.agent.updateCharacter(novelId, character.id, parsed.data)
      : window.agent.addCharacter(novelId, parsed.data);
    request
      .then((entry) => {
        onSubmitted(entry);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        setSubmitting(false);
      });
  };

  return (
    <section className="character-form">
      <h3>{character ? `✏️ 编辑角色（第 ${character.version} 版）` : "✨ 新增角色"}</h3>
      <div className="form-fields">
        {(
          [
            ["name", "姓名"],
            ["gender", "性别"],
            ["appearance", "外貌特征"],
            ["desire", "渴望（这个角色想要什么）"],
            ["fear", "恐惧（这个角色害怕什么）"],
            ["narrativeRole", "叙事定位（主角/配角/反派等）"],
            ["background", "背景（门派/师承/身世等）"],
            ["personality", "性格（做事方式与说话风格）"],
            ["characterGoal", "角色目的（故事线中的最终目的）"],
            ["creationPurpose", "创作目的（该角色服务的内容）"],
            ["trajectory", "轨迹（概括性的人生轨迹）"],
            ["endingDirection", "结局方向"],
            ["relationships", "关系（与其他角色的概括性关系）"],
          ] as const
        ).map(([field, label]) => (
          <div key={field} className={`field${form[field].trim().length === 0 && REQUIRED_FIELDS.some(([r]) => r === field) ? " invalid" : ""}`}>
            <label>
              {label}
              {REQUIRED_FIELDS.some(([r]) => r === field) ? <span className="req"> *</span> : null}
            </label>
            {TEXTAREA_FIELDS.has(field) ? (
              <textarea
                rows={3}
                value={form[field]}
                disabled={busy}
                onChange={(e) => setField(field, e.target.value)}
              />
            ) : (
              <input value={form[field]} disabled={busy} onChange={(e) => setField(field, e.target.value)} />
            )}
          </div>
        ))}
      </div>
      {missing.length > 0 ? <p className="form-error">必填字段未填：{missing.join("、")}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
      {polishing ? <p className="hint">🪄 润色中，结果将自动回填表单（可再次润色或直接提交）…</p> : null}
      <div className="form-actions">
        <button
          disabled={busy || !hasWorldview || !hasAnyInput}
          title={
            !hasWorldview
              ? "世界观未确认，无法润色"
              : !hasAnyInput
                ? "请至少填写一个字段再润色"
                : undefined
          }
          onClick={polish}
        >
          🪄 AI 润色
        </button>
        <button
          className="primary"
          disabled={busy || missing.length > 0}
          title={missing.length > 0 ? `必填未填：${missing.join("、")}` : undefined}
          onClick={submit}
        >
          {submitting ? "提交中…" : "提交"}
        </button>
        <button disabled={polishing} onClick={onCancel}>
          取消
        </button>
      </div>
    </section>
  );
}

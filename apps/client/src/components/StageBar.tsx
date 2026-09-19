import type { Stage } from "@novel/shared";

const STAGES: Stage[] = ["type", "audience", "worldview", "character", "conflict", "outline"];
const LABELS: Record<Stage, string> = {
  type: "类型",
  audience: "受众",
  worldview: "世界观",
  character: "角色",
  conflict: "冲突",
  outline: "大纲",
};

/** 六阶段进度条：已过 ✓、当前高亮、未到灰 */
export function StageBar({ current }: { current: Stage | null }) {
  return (
    <ol className="stagebar">
      {STAGES.map((stage) => {
        const currentIndex = current ? STAGES.indexOf(current) : -1;
        const stageIndex = STAGES.indexOf(stage);
        const state =
          currentIndex === -1 || stageIndex < currentIndex
            ? "done"
            : stageIndex === currentIndex
              ? "active"
              : "todo";
        return (
          <li key={stage} className={`stage ${state}`}>
            {LABELS[stage]}
          </li>
        );
      })}
    </ol>
  );
}

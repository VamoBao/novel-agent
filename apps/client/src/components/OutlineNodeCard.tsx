import type { OutlineNodeEntry } from "@novel/shared";

interface OutlineNodeCardProps {
  node: OutlineNodeEntry;
  /** 幕下已有章节点时不再显示生成入口（重新规划/修订流为后续需求） */
  hasChapters?: boolean;
  /** 触发本幕章节规划（浏览页接线到独立章节规划页）；不传则不显示入口 */
  onPlanChapters?: () => void;
}

/**
 * 大纲节点只读预览：梗概与关键情节点（仅幕节点有）分上下两张卡片展示，
 * 「规划本幕章节」入口固定在两张卡片下方右对齐——节点名与类型以左栏结构
 * 树为准（点击时已高亮），右栏不再重复；入口仅未规划过章节的幕显示，旧数
 * 据幕缺梗概/情节点（无规划种子内容），禁用并提示原因。
 * 浏览路径专用，不进 shared 的 View 体系——
 * 避免浏览专用视图渗入创作流协议（protocol.ts 内嵌 viewSchema）。
 * 历史数据（6 版迁移前入库）summary / keyPlotPoints 为 null，展示空占位。
 */
export function OutlineNodeCard({ node, hasChapters = false, onPlanChapters }: OutlineNodeCardProps) {
  const legacy = node.summary === null || node.keyPlotPoints === null;
  const showEntry = node.type === "act" && !hasChapters && onPlanChapters !== undefined;

  return (
    <>
      <section className="viewcard">
        <p className="card-label">梗概</p>
        {node.summary ? (
          <p className="outline-summary">{node.summary}</p>
        ) : (
          <p className="dim">（暂无梗概——旧数据未入库内容）</p>
        )}
      </section>
      {node.type === "act" ? (
        <section className="viewcard">
          <p className="card-label">关键情节点</p>
          {node.keyPlotPoints ? (
            <ol className="plot-list">
              {node.keyPlotPoints.map((point, index) => (
                <li key={index}>{point}</li>
              ))}
            </ol>
          ) : (
            <p className="dim">（暂无关键情节点——旧数据未入库内容）</p>
          )}
        </section>
      ) : null}
      {showEntry ? (
        <div className="act-actions">
          <button
            className={legacy ? undefined : "primary"}
            disabled={legacy}
            title={legacy ? "旧数据未入库幕梗概/关键情节点，无法规划章节" : undefined}
            onClick={onPlanChapters}
          >
            📑 规划本幕章节
          </button>
        </div>
      ) : null}
    </>
  );
}

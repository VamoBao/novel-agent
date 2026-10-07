import type { DocumentEntry, OutlineNodeEntry } from "@novel/shared";

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

interface OutlineNodeCardProps {
  node: OutlineNodeEntry;
  /** 幕下已有章节点时不再显示生成入口（重新规划/修订流为后续需求） */
  hasChapters?: boolean;
  /** 触发本幕章节规划（浏览页接线到独立章节规划页）；不传则不显示入口 */
  onPlanChapters?: () => void;
  /** 本章已生成的正文（详情 documents 按 chapterId 匹配）；无则显示生成入口 */
  document?: DocumentEntry;
  /** 正文生成会话进行中（单例 agent：进行中禁用各章入口，目标章显示生成中） */
  writing?: boolean;
  /** 触发本章正文生成（write-chapter 会话）；不传则不显示入口 */
  onWriteChapter?: () => void;
  /** 本章涉及的伏笔（详情 foreshadows 过滤登场/回收两组；无则不渲染区块） */
  foreshadows?: ChapterForeshadow[];
}

/**
 * 大纲节点只读预览：梗概与关键情节点（仅幕节点有）分上下两张卡片展示，
 * 「规划本幕章节」入口固定在两张卡片下方右对齐——节点名与类型以左栏结构
 * 树为准（点击时已高亮），右栏不再重复；入口仅未规划过章节的幕显示，旧数
 * 据幕缺梗概/情节点（无规划种子内容），禁用并提示原因。
 * 章节点：无正文时同样右对齐显示「✍️ 生成本章正文」入口（写作模型生成，
 * write-chapter 会话）；已有正文则在梗概卡下追加正文卡（约 N 字 + 全文 +
 * 落盘路径——内容存 output/<小说名>/<部名>/<章名>.md，库内只留元数据；
 * 重写/修订流为后续需求）。
 * 浏览路径专用，不进 shared 的 View 体系——
 * 避免浏览专用视图渗入创作流协议（protocol.ts 内嵌 viewSchema）。
 * 历史数据（6 版迁移前入库）summary / keyPlotPoints 为 null，展示空占位。
 */
export function OutlineNodeCard({
  node,
  hasChapters = false,
  onPlanChapters,
  document,
  writing = false,
  onWriteChapter,
  foreshadows,
}: OutlineNodeCardProps) {
  const legacy = node.summary === null || node.keyPlotPoints === null;
  const showEntry = node.type === "act" && !hasChapters && onPlanChapters !== undefined;
  const showWriteEntry =
    node.type === "chapter" && !document && onWriteChapter !== undefined;

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
      {node.type === "chapter" && document ? (
        <section className="viewcard">
          <p className="card-label">正文 · 约 {document.wordCount} 字</p>
          {document.content ? (
            <div className="prose-content">{document.content}</div>
          ) : (
            <p className="dim">（正文文件缺失或已被移动）</p>
          )}
          <p className="doc-path">已保存至 output/{document.filePath}</p>
        </section>
      ) : null}
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
      {showWriteEntry ? (
        <div className="act-actions">
          <button
            className="primary"
            disabled={writing || node.summary === null}
            title={
              node.summary === null
                ? "旧数据未入库章节概述，无法生成正文"
                : writing
                  ? "正文生成中…"
                  : undefined
            }
            onClick={onWriteChapter}
          >
            {writing ? "✍️ 正文生成中…" : "✍️ 生成本章正文"}
          </button>
        </div>
      ) : null}
    </>
  );
}

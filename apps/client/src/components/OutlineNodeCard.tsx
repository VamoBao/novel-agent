import {
  Drama,
  ListOrdered,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import type { DocumentEntry, OutlineNodeEntry } from "@novel/shared";
import { ChapterWritingProgress } from "./chapter-writing/ChapterWritingProgress";
import { isWriting, type ChapterWriteProgress, type ChapterWriteSession } from "./chapter-writing/write-session";
export type { ChapterWriteProgress } from "./chapter-writing/write-session";
import type { StaleCastMigration } from "../character-staleness";

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
  /** 本章登场人物名（章节规划确认时绑定的 characterIds 经详情 characters 解析，
   *  未匹配兜底原 ID；未绑定（旧数据）传 null/undefined 不渲染区块） */
  castNames?: string[] | null;
  /** 影响本章的已确认迁移（详情按迁移影响范围得出）；有则在正文卡给出
   *  「建议重新生成」提示，不做自动重写 */
  staleMigrations?: StaleCastMigration[];
  /** 正文生成会话进行中（单例 agent：进行中禁用各章入口，目标章显示生成中） */
  writing?: boolean;
  /** 本章正文生成进度（write-progress 消息；仅目标章传入，其余章 undefined） */
  writeProgress?: ChapterWriteProgress;
  /** 目标章本次会话，包含准备/完成/失败与各轮报告。 */
  writeSession?: ChapterWriteSession;
  /** 触发本章正文生成（write-chapter 会话）；不传则不显示入口 */
  onWriteChapter?: () => void;
  /** 触发本章正文重新生成（覆盖替换，经弹框确认后调用）；有正文且传入时显示入口 */
  onRegenerateChapter?: () => void;
  /** 本章涉及的伏笔（详情 foreshadows 过滤登场/回收两组；无则不渲染区块） */
  foreshadows?: ChapterForeshadow[];
}

/**
 * 大纲节点只读预览：梗概与关键情节点（仅幕节点有）分上下两张卡片展示，
 * 「规划本幕章节」入口固定在两张卡片下方右对齐——节点名与类型以左栏结构
 * 树为准（点击时已高亮），右栏不再重复；入口仅未规划过章节的幕显示，旧数
 * 据幕缺梗概/情节点（无规划种子内容），禁用并提示原因。
 * 章节点：无正文时同样右对齐显示「生成本章正文」入口（写作模型生成，
 * write-chapter 会话）；chapter-writing/ChapterWritingProgress 在章卡顶部呈现准备、
 * 五步流程、分项校验、各轮报告与完成/失败状态；已有正文则在梗概卡下追加正文卡
 * （约 N 字 + 全文——内容存 output 落盘文件，库内只留元数据；重新生成经覆盖确认）。
 * 浏览路径专用，不进 shared 的 View 体系——
 * 避免浏览专用视图渗入创作流协议（protocol.ts 内嵌 viewSchema）。
 * 历史数据（6 版迁移前入库）summary / keyPlotPoints 为 null，展示空占位。
 */
export function OutlineNodeCard({
  node,
  hasChapters = false,
  onPlanChapters,
  document,
  castNames,
  staleMigrations,
  writing = false,
  writeProgress,
  writeSession,
  onWriteChapter,
  onRegenerateChapter,
  foreshadows,
}: OutlineNodeCardProps) {
  const legacy = node.summary === null || node.keyPlotPoints === null;
  const showEntry = node.type === "act" && !hasChapters && onPlanChapters !== undefined;
  const session = writeSession ?? (writing && writeProgress ? {
    novelId: "", chapterNodeId: node.id, status: "running" as const, replacing: !!document,
    startedAt: Date.now(), progress: writeProgress, reports: writeProgress.report ? [writeProgress.report] : [],
  } : undefined);
  const targetActive = isWriting(session);
  const showWriteEntry = node.type === "chapter" && !document && onWriteChapter !== undefined;
  const showProgress = node.type === "chapter" && (session !== undefined || showWriteEntry);
  const showRegenEntry = node.type === "chapter" && document !== undefined && onRegenerateChapter !== undefined
    && !targetActive && session?.status !== "failed";

  return (
    <>
      {showProgress ? <ChapterWritingProgress chapterName={node.name} session={session}
        disabled={(writing && !targetActive) || node.summary === null}
        disabledReason={node.summary === null ? "缺少章节概述" : undefined}
        onStart={onWriteChapter} onRetry={document ? onRegenerateChapter : onWriteChapter} /> : null}
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
      {node.type === "chapter" && castNames && castNames.length > 0 ? (
        <section className="viewcard">
          <p className="card-label">
            <Drama className="ic" aria-hidden />
            登场人物
          </p>
          <p className="outline-summary">{castNames.join("、")}</p>
        </section>
      ) : null}
      {node.type === "chapter" && document ? (
        <section className="viewcard">
          <p className="card-label">正文 · 约 {document.wordCount} 字</p>
          {staleMigrations && staleMigrations.length > 0 ? (
            <p className="cast-stale">
              <TriangleAlert className="ic" aria-hidden />
              登场角色的迁移计划已更新（
              {staleMigrations
                .map((m) => `${m.name} ${m.fieldLabel} 第 ${m.sequence} 条`)
                .join("、")}
              ）——本章正文生成于该计划确认之前，如需保持一致建议「重新生成」
            </p>
          ) : null}
          {document.content ? (
            <div className="prose-content">{document.content}</div>
          ) : (
            <p className="dim">（正文文件缺失或已被移动）</p>
          )}
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
            <ListOrdered className="ic" aria-hidden />
            规划本幕章节
          </button>
        </div>
      ) : null}
      {showRegenEntry ? (
        <div className="act-actions">
          <button
            disabled={writing}
            title={writing ? "正文生成中…" : "重新生成并覆盖现有正文（会先弹出确认）"}
            onClick={onRegenerateChapter}
          >
            <RefreshCw className="ic" aria-hidden />
            {writing ? "其他章节正在生成…" : "重新生成"}
          </button>
        </div>
      ) : null}
    </>
  );
}

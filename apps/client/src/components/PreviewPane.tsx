import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import type {
  CharacterEntry,
  ForeshadowEntry,
  LocationEntry,
  NovelDetail,
  OutlineNodeEntry,
  StyleReferenceEntry,
  View,
} from "@novel/shared";
import { CharacterEditForm } from "./CharacterEditForm";
import { CharacterMigrationPanel } from "./CharacterMigrationPanel";
import { ChapterRegenDialog } from "./ChapterRegenDialog";
import { ForeshadowEditForm, recoveryLabel } from "./ForeshadowEditForm";
import { StyleEditForm } from "./StyleEditForm";
import { ViewCard } from "./ViewCard";
import { OutlineNodeCard } from "./OutlineNodeCard";
import type { ChapterForeshadow, ChapterWriteProgress } from "./OutlineNodeCard";
import type { Selection } from "./StructureTreePanel";
import { chapterOptions } from "../chapter-options";
import { globalChapterOrder } from "../chapter-order";
import { staleCastMigrations } from "../character-staleness";

interface PreviewPaneProps {
  /** null = 未选中小说 */
  detail: NovelDetail | null;
  loading: boolean;
  error: string | null;
  selection: Selection | null;
  /** 幕节点「规划本幕章节」入口（App 接线到独立章节规划页）；不传则幕卡不显示入口 */
  onPlanChapters?: (node: OutlineNodeEntry) => void;
  /** 新建角色态（App 持有）：右栏渲染空表单；提交 / 取消 / 改选节点时退出 */
  creatingCharacter?: boolean;
  onCreateCharacterSubmitted?: (entry: CharacterEntry) => void;
  onCreateCharacterCancelled?: () => void;
  /** 角色迁移增删改确认成功后刷新详情（角色 id 稳定，选中不失效） */
  onCharacterSaved?: () => void;
  /** 伏笔编辑提交成功后刷新详情（伏笔 id 稳定，选中不失效） */
  onForeshadowSaved?: () => void;
  /** 章节正文生成完成（run_finished）后刷新详情（章节点 id 稳定，选中保持） */
  onDocumentSaved?: () => void;
  /** 新建文风态（App 持有，镜像新建角色）：提交 / 取消 / 改选节点时退出 */
  creatingStyle?: boolean;
  onStyleCreatedSubmitted?: (entry: StyleReferenceEntry) => void;
  onStyleCreatedCancelled?: () => void;
  /** 文风编辑提交成功后刷新详情（文风 id 稳定，选中不失效） */
  onStyleSaved?: () => void;
  /** 文风删除成功后重置选中并刷新详情（原 id 已不存在） */
  onStyleDeleted?: () => void;
}

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
  const nameById = new Map(detail.characters.map((c) => [c.id, c.basicInfo.name]));
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

/** 章节点 → 登场人物名（characterIds 经详情 characters 解析名字，未匹配兜底原 ID——
 *  对齐伏笔表单既有策略；未绑定（旧数据）返回 null 不渲染区块） */
function toChapterCastNames(node: OutlineNodeEntry, detail: NovelDetail): string[] | null {
  if (node.characterIds === null) return null;
  const nameById = new Map(detail.characters.map((c) => [c.id, c.basicInfo.name]));
  return node.characterIds.map((id) => nameById.get(id) ?? id);
}

/** worldview 选中项 → 只读视图（角色预览带编辑入口自成一节；大纲节点不经此处） */
function toWorldviewView(detail: NovelDetail): View | null {
  return detail.worldview ? { kind: "worldview", worldview: detail.worldview } : null;
}

/**
 * 角色卡预览（固定基准，只读）：角色卡本体不再提供编辑入口——人物变化一律经
 * 迁移清单表达（CharacterMigrationPanel）。按 id 作 key，切换角色即退出迁移表单态。
 */
function CharacterPreview({
  novelId,
  entry,
  detail,
  onSaved,
}: {
  novelId: string;
  entry: CharacterEntry;
  detail: NovelDetail;
  onSaved: () => void;
}) {
  return (
    <>
      <ViewCard view={{ kind: "character-card", character: entry }} />
      <CharacterMigrationPanel
        novelId={novelId}
        character={entry}
        detail={detail}
        onChanged={onSaved}
      />
    </>
  );
}

/** 伏笔卡预览（带编辑入口，镜像 CharacterPreview）：编辑态切换为 ForeshadowEditForm；
 *  预览态为 viewcard 只读卡——幕名 / 登场章名经 outlineNodes 解析，服务角色名经 characters 解析 */
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
  const chapterOrder = globalChapterOrder(detail);
  const actName = detail.outlineNodes.find((n) => n.id === entry.actNodeId)?.name ?? "未绑幕";
  const appearName = detail.outlineNodes.find((n) => n.id === entry.appearChapterId)?.name ?? null;
  const recoverNames = (entry.recoverChapterIds ?? []).map(
    (cid) => detail.outlineNodes.find((n) => n.id === cid)?.name ?? cid,
  );
  const recoverActName = entry.recoverActNodeId
    ? detail.outlineNodes.find((n) => n.id === entry.recoverActNodeId)?.name ?? entry.recoverActNodeId
    : null;
  const nameById = new Map(detail.characters.map((c) => [c.id, c.basicInfo.name]));
  if (editing) {
    return (
      <ForeshadowEditForm
        novelId={novelId}
        entry={entry}
        chapters={chapters}
        chapterOrder={chapterOrder}
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
        <p className="outline-summary">
          注意度：{entry.attentionLevel} · 回收状态：{recoveryLabel(entry.recoveryStatus)}
        </p>
        <p className="outline-summary">登场章：{appearName ?? "（未绑定）"}</p>
        <p className="outline-summary">
          回收章：{recoverNames.length > 0 ? recoverNames.join("、") : "（未规划）"}
        </p>
        {recoverActName && recoverNames.length === 0 ? (
          <p className="outline-summary">回收幕：{recoverActName}（待该幕章节规划时绑定回收章）</p>
        ) : null}
        <p className="outline-summary">
          服务角色：
          {(entry.characterIds ?? []).map((cid) => nameById.get(cid) ?? cid).join("、") || "（无）"}
        </p>
        {entry.plantingMethod ? (
          <p className="outline-summary">埋线方式：{entry.plantingMethod}</p>
        ) : null}
        {entry.purpose ? <p className="outline-summary">创作目的：{entry.purpose}</p> : null}
      </section>
    </>
  );
}

/** 地点卡预览（只读，无编辑入口）：名字 + 定位 + 已设定的可选字段；父级名经 detail.locations
 *  解析（未匹配兜底原 ID）；坐标 / 图层 / 人口未设定不渲染——不展示 id（全页面去 ID 约定） */
function LocationPreview({ entry, detail }: { entry: LocationEntry; detail: NovelDetail }) {
  const parentName = entry.parentId
    ? detail.locations.find((l) => l.id === entry.parentId)?.name ?? entry.parentId
    : null;
  return (
    <section className="viewcard">
      <p className="card-label">地点</p>
      <p className="part-name">{entry.name}</p>
      {entry.description ? <p className="outline-summary">{entry.description}</p> : null}
      {entry.x !== undefined && entry.y !== undefined ? (
        <p className="outline-summary">坐标：（{entry.x}, {entry.y}）</p>
      ) : null}
      {entry.layer ? <p className="outline-summary">图层：{entry.layer}</p> : null}
      {entry.population !== undefined ? (
        <p className="outline-summary">主要物种数量：{entry.population}</p>
      ) : null}
      {parentName ? <p className="outline-summary">父级：{parentName}</p> : null}
    </section>
  );
}

/** 文风卡预览（带编辑入口，镜像 ForeshadowPreview）：启用徽标 + 内容全文（pre-wrap 滚动阅读）；
 *  编辑态切换 StyleEditForm，删除成功经 onDeleted 上抛（调用方重置选中并刷新详情） */
function StylePreview({
  novelId,
  entry,
  onSaved,
  onDeleted,
}: {
  novelId: string;
  entry: StyleReferenceEntry;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <StyleEditForm
        novelId={novelId}
        entry={entry}
        onSubmitted={() => {
          setEditing(false);
          onSaved();
        }}
        onDeleted={() => {
          setEditing(false);
          onDeleted();
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }
  return (
    <>
      <div className="preview-actions">
        <button onClick={() => setEditing(true)}>✏️ 编辑文风</button>
      </div>
      <section className="viewcard">
        <p className="card-label">参考文风</p>
        <p className="part-name">{entry.name}</p>
        <p className="outline-summary">
          {entry.enabled ? "✅ 启用中（生成正文时注入）" : "⏸ 已停用（生成正文时不注入）"}
        </p>
        <div className="prose-content">{entry.content}</div>
      </section>
    </>
  );
}

/**
 * 右栏内容预览：结构树选中节点的只读视图 / 角色与伏笔编辑表单 / 新建角色表单。
 * 章节正文生成会话（write-chapter）由本组件收口：目标章节点 id 记录生成态，
 * run_finished 后回调刷新详情（正文随 documents 到达，章节点 id 稳定选中保持）；
 * 生成中用户切换选中不打断会话，卸载（离开浏览页）时中止。
 */
export function PreviewPane({
  detail,
  loading,
  error,
  selection,
  onPlanChapters,
  creatingCharacter = false,
  onCreateCharacterSubmitted,
  onCreateCharacterCancelled,
  onCharacterSaved,
  onForeshadowSaved,
  onDocumentSaved,
  creatingStyle = false,
  onStyleCreatedSubmitted,
  onStyleCreatedCancelled,
  onStyleSaved,
  onStyleDeleted,
}: PreviewPaneProps) {
  /** 正文生成中的章节点 ID（null = 空闲）；agent 会话单例，进行中禁用各章入口 */
  const [writingNodeId, setWritingNodeId] = useState<string | null>(null);
  /** 目标章的生成进度；单段结果按轮累积，完整报告在轮次间保持展示。 */
  const [writeProgress, setWriteProgress] = useState<ChapterWriteProgress | null>(null);
  /** 待确认重生成的章节点（弹框确认后发起会话；生成与重生成走同一 write-chapter 会话） */
  const [regenConfirmNode, setRegenConfirmNode] = useState<OutlineNodeEntry | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);

  // 正文生成会话消息订阅（对齐 CharacterEditForm 润色订阅模式）：
  // write-progress → 更新目标章流程进度；run_finished → 清生成态并刷新详情；
  // error → 展示错误；exit 兜底复位
  useEffect(() => {
    const offMessage = window.agent.onMessage((message) => {
      if (writingNodeId === null) return;
      if (message.type === "run_finished") {
        setWritingNodeId(null);
        setWriteProgress(null);
        setWriteError(null);
        onDocumentSaved?.();
      } else if (message.type === "write-progress" && message.chapterNodeId === writingNodeId) {
        setWriteProgress((previous) => {
          const sameRound = previous?.round === message.round;
          const priorResults = sameRound ? previous.stageResults : [];
          return {
            round: message.round,
            totalRounds: message.totalRounds,
            phase: message.phase,
            stylePassScore: message.stylePassScore ?? previous?.stylePassScore,
            report: message.report ?? previous?.report,
            stageResults: message.stageResult
              ? [...priorResults.filter((item) => item.phase !== message.stageResult?.phase), message.stageResult]
              : priorResults,
          };
        });
      } else if (message.type === "error") {
        setWritingNodeId(null);
        setWriteProgress(null);
        setWriteError(message.message);
        // 收尾兜底：确保单例 agent 空闲（对已退出进程是空操作）
        void window.agent.stop();
      }
    });
    const offExit = window.agent.onExit(() => {
      setWritingNodeId(null);
      setWriteProgress(null);
    });
    return () => {
      offMessage();
      offExit();
    };
  }, [writingNodeId, onDocumentSaved]);

  // 卸载时若生成仍在进行（离开浏览页 / 切换小说）：中止会话
  const writingRef = useRef(writingNodeId);
  writingRef.current = writingNodeId;
  useEffect(
    () => () => {
      if (writingRef.current !== null) void window.agent.stop();
    },
    [],
  );

  /** 发起本章正文生成（write-chapter 会话，写作模型生成 → 三段校验 → 修订循环 → 入库） */
  const startWriteChapter = (novelId: string, chapterNodeId: string): void => {
    setWritingNodeId(chapterNodeId);
    setWriteProgress(null);
    setWriteError(null);
    void window.agent.start({ mode: "write-chapter", novelId, chapterNodeId });
  };

  let body: ReactElement;
  if (!detail) {
    body = (
      <p className="pane-hint">
        {loading ? "加载中…" : error ?? "← 从书库选择一本小说，点击中间结构树预览内容。"}
      </p>
    );
  } else if (creatingCharacter) {
    body = (
      <CharacterEditForm
        novelId={detail.novel.id}
        hasWorldview={detail.worldview !== null}
        onSubmitted={onCreateCharacterSubmitted ?? (() => {})}
        onCancel={onCreateCharacterCancelled ?? (() => {})}
      />
    );
  } else if (creatingStyle) {
    body = (
      <StyleEditForm
        novelId={detail.novel.id}
        onSubmitted={onStyleCreatedSubmitted ?? (() => {})}
        onCancel={onStyleCreatedCancelled ?? (() => {})}
      />
    );
  } else if (!selection) {
    body = <p className="pane-hint">← 点击中间结构树节点预览对应内容。</p>;
  } else if (selection.kind === "outline") {
    const node = detail.outlineNodes.find((n) => n.id === selection.outlineNodeId);
    body = node ? (
      <>
        {writeError ? <p className="pane-error">{writeError}</p> : null}
        <OutlineNodeCard
          node={node}
          hasChapters={detail.outlineNodes.some(
            (n) => n.parentId === node.id && n.type === "chapter",
          )}
          onPlanChapters={onPlanChapters ? () => onPlanChapters(node) : undefined}
          document={detail.documents.find((d) => d.chapterId === node.id)}
          castNames={node.type === "chapter" ? toChapterCastNames(node, detail) : undefined}
          staleMigrations={
            node.type === "chapter" ? staleCastMigrations(node, detail) : undefined
          }
          foreshadows={
            node.type === "chapter" ? toChapterForeshadows(detail, node.id) : undefined
          }
          writing={writingNodeId !== null}
          writeProgress={writingNodeId === node.id ? (writeProgress ?? undefined) : undefined}
          onWriteChapter={
            node.type === "chapter"
              ? () => startWriteChapter(detail.novel.id, node.id)
              : undefined
          }
          onRegenerateChapter={
            node.type === "chapter" && node.summary !== null
              ? () => setRegenConfirmNode(node)
              : undefined
          }
        />
      </>
    ) : (
      <p className="pane-error">该节点内容未能加载（数据缺失）。</p>
    );
  } else if (selection.kind === "character") {
    const entry = detail.characters.find((c) => c.id === selection.characterId);
    body = entry ? (
      <CharacterPreview
        key={entry.id}
        novelId={detail.novel.id}
        entry={entry}
        detail={detail}
        onSaved={() => onCharacterSaved?.()}
      />
    ) : (
      <p className="pane-error">该节点内容未能加载（数据缺失）。</p>
    );
  } else if (selection.kind === "foreshadow") {
    const entry = detail.foreshadows.find((f) => f.id === selection.foreshadowId);
    body = entry ? (
      <ForeshadowPreview
        key={entry.id}
        novelId={detail.novel.id}
        entry={entry}
        detail={detail}
        onSaved={onForeshadowSaved ?? (() => {})}
      />
    ) : (
      <p className="pane-error">该伏笔内容未能加载（数据缺失）。</p>
    );
  } else if (selection.kind === "location") {
    const entry = detail.locations.find((l) => l.id === selection.locationId);
    body = entry ? (
      <LocationPreview key={entry.id} entry={entry} detail={detail} />
    ) : (
      <p className="pane-error">该地点内容未能加载（数据缺失）。</p>
    );
  } else if (selection.kind === "style") {
    const entry = detail.styleReferences.find((s) => s.id === selection.styleId);
    body = entry ? (
      <StylePreview
        key={entry.id}
        novelId={detail.novel.id}
        entry={entry}
        onSaved={() => onStyleSaved?.()}
        onDeleted={() => onStyleDeleted?.()}
      />
    ) : (
      <p className="pane-error">该文风内容未能加载（数据缺失或已删除）。</p>
    );
  } else {
    const view = toWorldviewView(detail);
    body = view ? (
      <ViewCard view={view} />
    ) : (
      <p className="pane-error">该节点内容未能加载（数据缺失）。</p>
    );
  }

  // 不再展示小说名标题行——左栏书库选中高亮已表明当前小说，右栏只留内容
  return (
    <section className="preview">
      {body}
      {regenConfirmNode && detail ? (
        <ChapterRegenDialog
          chapterName={regenConfirmNode.name}
          onCancel={() => setRegenConfirmNode(null)}
          onConfirm={() => {
            const target = regenConfirmNode;
            setRegenConfirmNode(null);
            startWriteChapter(detail.novel.id, target.id);
          }}
        />
      ) : null}
    </section>
  );
}

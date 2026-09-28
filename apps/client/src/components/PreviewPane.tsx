import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { CharacterEntry, NovelDetail, OutlineNodeEntry, View } from "@novel/shared";
import { CharacterEditForm } from "./CharacterEditForm";
import { ViewCard } from "./ViewCard";
import { OutlineNodeCard } from "./OutlineNodeCard";
import type { Selection } from "./StructureTreePanel";

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
  /** 角色编辑提交成功后刷新详情（角色 id 稳定，选中不失效） */
  onCharacterSaved?: () => void;
  /** 章节正文生成完成（run_finished）后刷新详情（章节点 id 稳定，选中保持） */
  onDocumentSaved?: () => void;
}

/** worldview 选中项 → 只读视图（角色预览带编辑入口自成一节；大纲节点不经此处） */
function toWorldviewView(detail: NovelDetail): View | null {
  return detail.worldview ? { kind: "worldview", worldview: detail.worldview } : null;
}

/** 角色卡预览（带编辑入口）：编辑态切换为 CharacterEditForm；按 id 作 key，切换角色即退出编辑态 */
function CharacterPreview({
  novelId,
  entry,
  hasWorldview,
  onSaved,
}: {
  novelId: string;
  entry: CharacterEntry;
  hasWorldview: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <CharacterEditForm
        novelId={novelId}
        character={entry}
        hasWorldview={hasWorldview}
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
        <button onClick={() => setEditing(true)}>✏️ 编辑角色</button>
      </div>
      <ViewCard view={{ kind: "character-card", character: entry }} />
    </>
  );
}

/**
 * 右栏内容预览：结构树选中节点的只读视图 / 角色编辑表单 / 新建角色表单。
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
  onDocumentSaved,
}: PreviewPaneProps) {
  /** 正文生成中的章节点 ID（null = 空闲）；agent 会话单例，进行中禁用各章入口 */
  const [writingNodeId, setWritingNodeId] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);

  // 正文生成会话消息订阅（对齐 CharacterEditForm 润色订阅模式）：
  // run_finished → 清生成态并刷新详情；error → 展示错误；exit 兜底复位
  useEffect(() => {
    const offMessage = window.agent.onMessage((message) => {
      if (writingNodeId === null) return;
      if (message.type === "run_finished") {
        setWritingNodeId(null);
        setWriteError(null);
        onDocumentSaved?.();
      } else if (message.type === "error") {
        setWritingNodeId(null);
        setWriteError(message.message);
        // 收尾兜底：确保单例 agent 空闲（对已退出进程是空操作）
        void window.agent.stop();
      }
    });
    const offExit = window.agent.onExit(() => setWritingNodeId(null));
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

  /** 发起本章正文生成（write-chapter 会话，写作模型单轮生成入库） */
  const startWriteChapter = (novelId: string, chapterNodeId: string): void => {
    setWritingNodeId(chapterNodeId);
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
          writing={writingNodeId !== null}
          onWriteChapter={
            node.type === "chapter"
              ? () => startWriteChapter(detail.novel.id, node.id)
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
        hasWorldview={detail.worldview !== null}
        onSaved={() => onCharacterSaved?.()}
      />
    ) : (
      <p className="pane-error">该节点内容未能加载（数据缺失）。</p>
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
  return <section className="preview">{body}</section>;
}

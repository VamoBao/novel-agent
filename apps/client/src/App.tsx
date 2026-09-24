import { useCallback, useEffect, useState } from "react";
import type { NovelDetail, NovelListItem, OutlineNodeEntry } from "@novel/shared";
import { ChapterPlanFlow } from "./components/ChapterPlanFlow";
import { CreationFlow } from "./components/CreationFlow";
import { NovelListPanel } from "./components/NovelListPanel";
import { PreviewPane } from "./components/PreviewPane";
import { StructureTreePanel, type Selection } from "./components/StructureTreePanel";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 单幕章节规划页目标：小说 + 幕节点定位（页面生命周期内不变） */
interface ChapterPlanTarget {
  novelId: string;
  novelName: string;
  actNodeId: string;
  actName: string;
}

/**
 * 页面级切换：三栏浏览主页（左栏书库可汉堡折叠 / 中栏结构树 / 右栏内容预览）
 * 与两个独立整页会话：创作页（CreationFlow 新建小说问答流）和章节规划页
 * （ChapterPlanFlow 单幕章节规划问答流）。会话完成后返回浏览页并刷新对应数据。
 */
export function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [chapterPlan, setChapterPlan] = useState<ChapterPlanTarget | null>(null);

  /** null = 列表加载中 */
  const [novels, setNovels] = useState<NovelListItem[] | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [detail, setDetail] = useState<NovelDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);

  const refreshList = useCallback(async (): Promise<NovelListItem[] | undefined> => {
    setLibraryError(null);
    try {
      const list = await window.agent.listNovels();
      setNovels(list);
      return list;
    } catch (error) {
      setLibraryError(errorMessage(error));
      setNovels([]);
      return undefined;
    }
  }, []);

  useEffect(() => {
    void refreshList();
    // 无头冒烟钩子：AUTOSTART 等价点击「新建小说」（agent 始终由 CreationFlow 挂载时发起）；
    // SELECT 自动选中指定小说（详情加载后自动预览首个可用节点）
    if (window.agent.isAutostart()) setCreating(true);
    const autoSelect = window.agent.autoSelectNovelId();
    if (autoSelect) setSelectedId(autoSelect);
  }, [refreshList]);

  // 选中小说变化 → 重新加载详情；切换时清空上一次的结构树选中
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    window.agent
      .getNovelDetail(selectedId)
      .then((loaded) => {
        if (cancelled) return;
        setDetail(loaded);
        // 冒烟诊断：自动预览首个可用节点（世界观 → 首个大纲节点）
        if (window.agent.autoSelectNovelId()) {
          const firstOutlineNode = loaded.outlineNodes[0];
          setSelection(
            loaded.worldview
              ? { kind: "worldview" }
              : firstOutlineNode
                ? { kind: "outline", outlineNodeId: firstOutlineNode.id }
                : null,
          );
        } else {
          setSelection(null);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setDetail(null);
        setDetailError(errorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  /** 创作完成：回浏览页 → 刷新书库 → 自动选中新作（列表已含新作时） */
  const handleFinished = (novelId: string): void => {
    setCreating(false);
    void refreshList().then((list) => {
      if (list?.some((novel) => novel.id === novelId)) setSelectedId(novelId);
    });
  };

  /** 返回书库：终止 agent（已增量落库）并刷新书库（中途成果可见） */
  const handleCloseCreation = (): void => {
    setCreating(false);
    void refreshList();
  };

  /** 幕卡「规划本幕章节」：进入独立章节规划页（目标幕定位自当前选中小说） */
  const handlePlanChapters = (node: OutlineNodeEntry): void => {
    if (!selectedId || !detail) return;
    setChapterPlan({
      novelId: selectedId,
      novelName: detail.novel.name ?? "未命名小说",
      actNodeId: node.id,
      actName: node.name,
    });
  };

  /** 重载当前详情（不动选中状态）：章节规划完成后结构树出现章节点，保持选中该幕 */
  const reloadDetail = useCallback(async (id: string): Promise<void> => {
    try {
      setDetail(await window.agent.getNovelDetail(id));
    } catch (error) {
      setDetailError(errorMessage(error));
    }
  }, []);

  /** 章节规划完成：回浏览页并刷新详情（已确认入库的章节即刻可见） */
  const handlePlanFinished = (novelId: string): void => {
    setChapterPlan(null);
    void reloadDetail(novelId);
  };

  /** 返回浏览页：终止 agent（未确认的规划不入库）并刷新详情（中途成果可见） */
  const handleCloseChapterPlan = (): void => {
    setChapterPlan(null);
    if (selectedId) void reloadDetail(selectedId);
  };

  /** 书库管理操作：失败回显到书库错误区，成功后刷新列表保持选中 */
  const handleRename = async (id: string, name: string): Promise<void> => {
    try {
      await window.agent.renameNovel(id, name);
      await refreshList();
    } catch (error) {
      setLibraryError(errorMessage(error));
    }
  };

  const handleSetPinned = async (id: string, pinned: boolean): Promise<void> => {
    try {
      await window.agent.setNovelPinned(id, pinned);
      await refreshList();
    } catch (error) {
      setLibraryError(errorMessage(error));
    }
  };

  const handleSetFavorite = async (id: string, favorite: boolean): Promise<void> => {
    try {
      await window.agent.setNovelFavorite(id, favorite);
      await refreshList();
    } catch (error) {
      setLibraryError(errorMessage(error));
    }
  };

  const handleDelete = async (id: string): Promise<void> => {
    try {
      await window.agent.deleteNovel(id);
      if (id === selectedId) setSelectedId(null);
      await refreshList();
    } catch (error) {
      setLibraryError(errorMessage(error));
    }
  };

  // 会话页：独立整页呈现（不带浏览页的汉堡 / 三栏结构），与浏览页互斥
  if (creating) {
    return (
      <div className="app create-app">
        <CreationFlow onFinished={handleFinished} onClose={handleCloseCreation} />
      </div>
    );
  }
  if (chapterPlan) {
    return (
      <div className="app create-app">
        <ChapterPlanFlow
          novelId={chapterPlan.novelId}
          novelName={chapterPlan.novelName}
          actNodeId={chapterPlan.actNodeId}
          actName={chapterPlan.actName}
          onFinished={handlePlanFinished}
          onClose={handleCloseChapterPlan}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <button
            className="icon-btn"
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
            title={sidebarCollapsed ? "展开小说列表" : "折叠小说列表"}
          >
            ☰
          </button>
          <h1>📖 novel-agent</h1>
        </div>
        <button className="primary" onClick={() => setCreating(true)}>
          ＋ 新建小说
        </button>
      </header>

      <div className={`workspace${sidebarCollapsed ? " collapsed" : ""}`}>
        <aside className="sidebar">
          <NovelListPanel
            novels={novels}
            error={libraryError}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onRefresh={() => void refreshList()}
            onRename={(id, name) => void handleRename(id, name)}
            onSetPinned={(id, pinned) => void handleSetPinned(id, pinned)}
            onSetFavorite={(id, favorite) => void handleSetFavorite(id, favorite)}
            onDelete={(id) => void handleDelete(id)}
          />
        </aside>
        <nav className="tree-pane">
          <StructureTreePanel
            detail={detail}
            loading={detailLoading}
            error={detailError}
            selection={selection}
            onSelect={setSelection}
          />
        </nav>
        <main className="preview-pane">
          <PreviewPane
            detail={detail}
            loading={detailLoading}
            error={detailError}
            selection={selection}
            onPlanChapters={handlePlanChapters}
          />
        </main>
      </div>
    </div>
  );
}

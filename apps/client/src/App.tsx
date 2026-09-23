import { useCallback, useEffect, useState } from "react";
import type { NovelDetail, NovelListItem } from "@novel/shared";
import { CreationFlow } from "./components/CreationFlow";
import { NovelListPanel } from "./components/NovelListPanel";
import { PreviewPane } from "./components/PreviewPane";
import { StructureTreePanel, type Selection } from "./components/StructureTreePanel";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 页面级切换：三栏浏览主页（左栏书库可汉堡折叠 / 中栏结构树 / 右栏内容预览）
 * 与独立的创作页（CreationFlow 问答流，整页呈现、带返回书库入口）。
 * 创作完成后返回浏览页、刷新书库并自动选中新作。
 */
export function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [creating, setCreating] = useState(false);

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

  // 创作页：独立整页呈现（不带浏览页的汉堡 / 三栏结构）
  if (creating) {
    return (
      <div className="app create-app">
        <CreationFlow onFinished={handleFinished} onClose={handleCloseCreation} />
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
          />
        </main>
      </div>
    </div>
  );
}

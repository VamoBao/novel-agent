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
 * 三栏浏览主界面：左栏书库（可汉堡折叠）/ 中栏结构树 / 右栏内容预览。
 * 「新建小说」以覆盖层盖住中+右栏呈现创作问答流（CreationFlow），左栏书库保持可见；
 * 创作完成后关闭覆盖层、刷新书库并自动选中新作。
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
        // 冒烟诊断：自动预览首个可用节点（世界观 → 大纲）
        if (window.agent.autoSelectNovelId()) {
          setSelection(
            loaded.worldview ? { kind: "worldview" } : loaded.outline ? { kind: "outline" } : null,
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

  /** 创作完成：关覆盖层 → 刷新书库 → 自动选中新作（列表已含新作时） */
  const handleFinished = (novelId: string): void => {
    setCreating(false);
    void refreshList().then((list) => {
      if (list?.some((novel) => novel.id === novelId)) setSelectedId(novelId);
    });
  };

  /** 手动关闭创作覆盖层：终止 agent（已增量落库）并刷新书库（中途成果可见） */
  const handleCloseCreation = (): void => {
    setCreating(false);
    void refreshList();
  };

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
        <button className="primary" disabled={creating} onClick={() => setCreating(true)}>
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

        {creating ? (
          <div className="creation-overlay">
            <CreationFlow onFinished={handleFinished} onClose={handleCloseCreation} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

import { useEffect, useState, useMemo, useCallback, lazy, Suspense } from "react";
import { validateGraph } from "@understand-anything/core/schema";
import type { GraphIssue } from "@understand-anything/core/schema";
import { useDashboardStore } from "./store";
import DomainGraphView from "./components/DomainGraphView";
import ObsidianGraphView from "./components/ObsidianGraphView";
import LearnMode from "./components/LearnMode";
import GraphifyFrame from "./components/GraphifyFrame";
import { FOCUS_RING, HEADER_BUTTON, HEADER_ICON_BUTTON, SEGMENT_GROUP, segment } from "./components/header-styles";
import ObsidianSidebar from "./components/ObsidianSidebar";
import type { CodeViewerDock } from "./components/CodeViewer";
import SearchBar from "./components/SearchBar";
import NodeInfo from "./components/NodeInfo";
import DiffToggle from "./components/DiffToggle";
import FilterPanel from "./components/FilterPanel";
import ExportMenu from "./components/ExportMenu";
import PersonaSelector from "./components/PersonaSelector";
import ProjectOverview from "./components/ProjectOverview";
import FileExplorer from "./components/FileExplorer";
import WarningBanner from "./components/WarningBanner";
import StalenessBanner from "./components/StalenessBanner";
import TokenGate from "./components/TokenGate";
import MobileLayout from "./components/MobileLayout";
import { useIsMobile } from "./hooks/useIsMobile";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import type { KeyboardShortcut } from "./hooks/useKeyboardShortcuts";
import { ThemeProvider } from "./themes/index.ts";
import { ThemePicker } from "./components/ThemePicker.tsx";
import type { ThemeConfig } from "./themes/index.ts";
import { I18nProvider, useI18n } from "./contexts/I18nContext.tsx";
import {
  requestFreshnessReport,
  shouldRequestFreshness,
  startFreshnessRefresh,
  type DashboardFreshnessReport,
} from "./freshness";

// Lazy-load heavy / optional components so they ship in separate chunks.
const CodeViewer = lazy(() => import("./components/CodeViewer"));
const LearnPanel = lazy(() => import("./components/LearnPanel"));
const PathFinderModal = lazy(() => import("./components/PathFinderModal"));
const KeyboardShortcutsHelp = lazy(
  () => import("./components/KeyboardShortcutsHelp"),
);
const OnboardingOverlay = lazy(() => import("./components/OnboardingOverlay"));

const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";
const SESSION_TOKEN_KEY = "understand-anything-token";
const ONBOARDING_DISMISSED_KEY = "ua-onboarding-dismissed-v1";
type SidebarTab = "info" | "files";

function shouldShowOnboarding(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get("onboard") === "force") return true;
  return window.localStorage.getItem(ONBOARDING_DISMISSED_KEY) !== "1";
}

/** Resolve data file URL — in demo mode, use env var URLs; otherwise use local paths with token. */
function dataUrl(fileName: string, token: string | null): string {
  if (DEMO_MODE) {
    const envMap: Record<string, string | undefined> = {
      "knowledge-graph.json": import.meta.env.VITE_GRAPH_URL,
      "domain-graph.json": import.meta.env.VITE_DOMAIN_GRAPH_URL,
      "meta.json": import.meta.env.VITE_META_URL,
      "diff-overlay.json": import.meta.env.VITE_DIFF_OVERLAY_URL,
      "config.json": import.meta.env.VITE_CONFIG_URL,
      "staleness.json": import.meta.env.VITE_STALENESS_URL,
    };
    const url = envMap[fileName];
    if (url) return url;
    const base = import.meta.env.BASE_URL || "/";
    return `${base.endsWith("/") ? base : `${base}/`}${fileName}`;
  }
  const path = `/${fileName}`;
  return token ? `${path}?token=${encodeURIComponent(token)}` : path;
}

/**
 * Resolve the access token from the URL query string or sessionStorage.
 * If found in the URL, persist to sessionStorage and strip the param from the address bar.
 */
function resolveInitialToken(): string | null {
  if (DEMO_MODE) return "__demo__";
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get("token");
  if (urlToken) {
    sessionStorage.setItem(SESSION_TOKEN_KEY, urlToken);
    // Clean the URL
    params.delete("token");
    const cleanSearch = params.toString();
    const newUrl =
      window.location.pathname + (cleanSearch ? `?${cleanSearch}` : "") + window.location.hash;
    window.history.replaceState(null, "", newUrl);
    return urlToken;
  }
  return sessionStorage.getItem(SESSION_TOKEN_KEY);
}

function App() {
  const [accessToken, setAccessToken] = useState<string | null>(resolveInitialToken);

  const handleTokenValid = useCallback((token: string) => {
    sessionStorage.setItem(SESSION_TOKEN_KEY, token);
    setAccessToken(token);
  }, []);

  // In demo mode, skip token gate entirely
  if (DEMO_MODE) {
    return <Dashboard accessToken="__demo__" />;
  }

  // Show the token gate when no token is available
  if (accessToken === null) {
    return <TokenGate onTokenValid={handleTokenValid} />;
  }

  return <Dashboard accessToken={accessToken} />;
}

function Dashboard({ accessToken }: { accessToken: string }) {
  const setGraph = useDashboardStore((s) => s.setGraph);
  const setDomainGraph = useDashboardStore((s) => s.setDomainGraph);
  const setDiffOverlay = useDashboardStore((s) => s.setDiffOverlay);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [graphIssues, setGraphIssues] = useState<GraphIssue[]>([]);
  const [graphFreshness, setGraphFreshness] =
    useState<DashboardFreshnessReport | null>(null);
  const [metaTheme, setMetaTheme] = useState<ThemeConfig | null>(null);
  const [outputLanguage, setOutputLanguage] = useState<string | undefined>();

  useEffect(() => {
    fetch(dataUrl("meta.json", accessToken))
      .then((r) => (r.ok ? r.json() : null))
      .then((meta) => {
        if (meta?.theme) setMetaTheme(meta.theme);
      })
      .catch(() => {});
    fetch(dataUrl("config.json", accessToken))
      .then((r) => (r.ok ? r.json() : null))
      .then((config) => {
        if (config?.outputLanguage) setOutputLanguage(config.outputLanguage);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch(dataUrl("knowledge-graph.json", accessToken))
      .then(async (res) => {
        // Guard res.ok before parsing (matching the meta.json/config.json/
        // diff-overlay.json/domain-graph.json fetches in this file). Without
        // this, a serving/config failure returns a 404 JSON error body that
        // gets parsed and handed to validateGraph, which fails project-metadata
        // validation and surfaces the misleading "Invalid knowledge graph:
        // Missing or invalid project metadata" instead of the real cause
        // (graph file not found / GRAPH_DIR unset). See issues #288, #406.
        if (!res.ok) {
          let detail = `HTTP ${res.status}`;
          try {
            const body = await res.json();
            if (body?.error) detail = body.error;
          } catch {
            /* non-JSON error body; keep the status code */
          }
          throw new Error(detail);
        }
        return res.json();
      })
      .then((data: unknown) => {
        const result = validateGraph(data);
        if (result.success && result.data) {
          setGraph(result.data);
          setGraphIssues(result.issues);
          if ((data as Record<string, unknown>).kind === "knowledge") {
            useDashboardStore.getState().setViewMode("knowledge");
            useDashboardStore.getState().setIsKnowledgeGraph(true);
          }
          for (const issue of result.issues) {
            if (issue.level === "auto-corrected") {
              console.warn(`[graph] auto-corrected: ${issue.message}`);
            } else if (issue.level === "dropped") {
              console.error(`[graph] dropped: ${issue.message}`);
            }
          }
        } else if (result.fatal) {
          console.error("Knowledge graph validation failed:", result.fatal);
          setLoadError(`Invalid knowledge graph: ${result.fatal}`);
        } else {
          console.error("Knowledge graph validation failed: unknown error");
          setLoadError("Invalid knowledge graph: unknown validation error");
        }
      })
      .catch((err) => {
        console.error("Failed to load knowledge graph:", err);
        setLoadError(`Failed to load knowledge graph: ${err instanceof Error ? err.message : String(err)}`);
      });
  }, [setGraph]);

  useEffect(() => {
    if (
      !shouldRequestFreshness(
        DEMO_MODE,
        import.meta.env.VITE_STALENESS_URL,
      )
    ) {
      setGraphFreshness(null);
      return;
    }

    return startFreshnessRefresh({
      target: window,
      load: (signal) =>
        requestFreshnessReport(
          dataUrl("staleness.json", accessToken),
          signal,
        ),
      onResult: setGraphFreshness,
    });
  }, [accessToken]);

  useEffect(() => {
    fetch(dataUrl("diff-overlay.json", accessToken))
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data: unknown) => {
        if (
          data &&
          typeof data === "object" &&
          "changedNodeIds" in data &&
          "affectedNodeIds" in data &&
          Array.isArray((data as Record<string, unknown>).changedNodeIds) &&
          Array.isArray((data as Record<string, unknown>).affectedNodeIds)
        ) {
          const d = data as { changedNodeIds: string[]; affectedNodeIds: string[] };
          if (d.changedNodeIds.length > 0) {
            setDiffOverlay(d.changedNodeIds, d.affectedNodeIds);
          }
        }
      })
      .catch(() => {});
  }, [setDiffOverlay]);

  useEffect(() => {
    fetch(dataUrl("domain-graph.json", accessToken))
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data: unknown) => {
        if (!data) return;
        const result = validateGraph(data);
        if (result.success && result.data) {
          setDomainGraph(result.data);
        } else if (result.fatal) {
          console.warn(`[domain-graph] validation failed: ${result.fatal}`);
        }
      })
      .catch(() => {});
  }, [setDomainGraph]);

  return (
    <I18nProvider language={outputLanguage ?? "en"}>
      <ThemeProvider metaTheme={metaTheme}>
        <DashboardContent
          accessToken={accessToken}
          loadError={loadError}
          graphIssues={graphIssues}
          graphFreshness={graphFreshness}
        />
      </ThemeProvider>
    </I18nProvider>
  );
}

function DashboardContent({
  accessToken,
  loadError,
  graphIssues,
  graphFreshness,
}: {
  accessToken: string;
  loadError: string | null;
  graphIssues: GraphIssue[];
  graphFreshness: DashboardFreshnessReport | null;
}) {
  const graph = useDashboardStore((s) => s.graph);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const tourActive = useDashboardStore((s) => s.tourActive);
  const persona = useDashboardStore((s) => s.persona);
  const codeViewerOpen = useDashboardStore((s) => s.codeViewerOpen);
  const codeViewerExpanded = useDashboardStore((s) => s.codeViewerExpanded);
  const expandCodeViewer = useDashboardStore((s) => s.expandCodeViewer);
  const collapseCodeViewer = useDashboardStore((s) => s.collapseCodeViewer);
  const pathFinderOpen = useDashboardStore((s) => s.pathFinderOpen);
  const togglePathFinder = useDashboardStore((s) => s.togglePathFinder);
  const nodeTypeFilters = useDashboardStore((s) => s.nodeTypeFilters);
  const toggleNodeTypeFilter = useDashboardStore((s) => s.toggleNodeTypeFilter);
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("info");
  const [showOnboarding, setShowOnboarding] = useState(shouldShowOnboarding);
  const dismissOnboarding = useCallback((remember: boolean) => {
    if (remember && typeof window !== "undefined") {
      window.localStorage.setItem(ONBOARDING_DISMISSED_KEY, "1");
    }
    setShowOnboarding(false);
  }, []);
  const viewMode = useDashboardStore((s) => s.viewMode);
  const setViewMode = useDashboardStore((s) => s.setViewMode);
  const graphStyle = useDashboardStore((s) => s.graphStyle);
  const setGraphStyle = useDashboardStore((s) => s.setGraphStyle);
  const isKnowledgeGraph = useDashboardStore((s) => s.isKnowledgeGraph);
  const domainGraph = useDashboardStore((s) => s.domainGraph);
  const layoutIssues = useDashboardStore((s) => s.layoutIssues);
  const isMobile = useIsMobile();
  // Obsidian style: the sidebar can be hidden so the graph gets the whole width;
  // below 1100px it slides over the graph instead of squeezing it.
  const isNarrow = useIsMobile(1100);
  const [codeDock, setCodeDock] = useState<CodeViewerDock>(() => {
    try {
      const v = window.localStorage.getItem("ua-code-dock");
      return v === "left" || v === "right" ? v : "bottom";
    } catch {
      return "bottom";
    }
  });
  const dockCodeViewer = (d: CodeViewerDock) => {
    setCodeDock(d);
    try {
      window.localStorage.setItem("ua-code-dock", d);
    } catch {
      // storage unavailable: dock choice lasts this session only
    }
  };
  // the Obsidian page's second header row (Diff, category chips, layers) can be hidden; remembered
  const [mapFilters, setMapFilters] = useState(() => {
    try {
      return window.localStorage.getItem("ua.mapFilters") !== "0";
    } catch {
      return true;
    }
  });
  const toggleMapFilters = () => {
    setMapFilters((shown) => {
      try {
        window.localStorage.setItem("ua.mapFilters", shown ? "0" : "1");
      } catch {
        // storage unavailable: the choice lasts this session only
      }
      return !shown;
    });
  };
  const [visitedPages, setVisitedPages] = useState(() => new Set([graphStyle]));
  useEffect(() => {
    setVisitedPages((prev) => (prev.has(graphStyle) ? prev : new Set(prev).add(graphStyle)));
  }, [graphStyle]);
  const [obsSidebarOpen, setObsSidebarOpen] = useState(
    () => typeof window === "undefined" || window.innerWidth >= 1100,
  );
  useEffect(() => {
    if (selectedNodeId || tourActive) setObsSidebarOpen(true);
  }, [selectedNodeId, tourActive]);
  const { t } = useI18n();
  const allIssues = useMemo(
    () => [...graphIssues, ...layoutIssues],
    [graphIssues, layoutIssues],
  );

  useEffect(() => {
    if (selectedNodeId) setSidebarTab("info");
  }, [selectedNodeId]);

  // Define keyboard shortcuts
  const shortcuts = useMemo<KeyboardShortcut[]>(
    () => [
      // Help
      {
        key: "?",
        shiftKey: true,
        description: t.keyboardShortcuts.showHelp,
        action: () => setShowKeyboardHelp((prev) => !prev),
        category: "General",
      },
      // Navigation
      {
        key: "Escape",
        description: t.keyboardShortcuts.escapeDesc,
        action: () => {
          // Read from store at invocation time to avoid stale closures
          const state = useDashboardStore.getState();
          if (state.pathFinderOpen) {
            state.togglePathFinder();
          } else if (state.filterPanelOpen) {
            state.toggleFilterPanel();
          } else if (state.exportMenuOpen) {
            state.toggleExportMenu();
          } else if (state.codeViewerExpanded) {
            state.collapseCodeViewer();
          } else if (state.codeViewerOpen) {
            state.closeCodeViewer();
          } else if (state.selectedNodeId) {
            state.selectNode(null);
          } else if (state.navigationLevel === "layer-detail") {
            state.navigateToOverview();
          } else if (state.tourActive) {
            state.stopTour();
          } else {
            setShowKeyboardHelp(false);
          }
        },
        category: "Navigation",
      },
      {
        key: "/",
        description: t.keyboardShortcuts.focusSearch,
        action: () => {
          // the search bar lives on the Obsidian page: go there first
          const st = useDashboardStore.getState();
          if (st.graphStyle !== "obsidian") st.setGraphStyle("obsidian");
          setTimeout(() => {
            document.querySelector<HTMLInputElement>('[data-testid="search-input"]')?.focus();
          }, 50);
        },
        category: "Navigation",
      },
      // Tour controls
      {
        key: "ArrowRight",
        description: t.keyboardShortcuts.nextStep,
        action: () => {
          const state = useDashboardStore.getState();
          // the tour lives on the Obsidian page (Learn uses the arrow keys for its own steps)
          if (state.tourActive && state.graphStyle === "obsidian") {
            state.nextTourStep();
          }
        },
        category: "Tour",
      },
      {
        key: "ArrowLeft",
        description: t.keyboardShortcuts.prevStep,
        action: () => {
          const state = useDashboardStore.getState();
          if (state.tourActive && state.graphStyle === "obsidian") {
            state.prevTourStep();
          }
        },
        category: "Tour",
      },
      // View toggles
      {
        key: "d",
        description: t.keyboardShortcuts.toggleDiff,
        action: () => {
          const state = useDashboardStore.getState();
          if (state.graphStyle === "obsidian") state.toggleDiffMode();
        },
        category: "View",
      },
      {
        key: "f",
        description: t.keyboardShortcuts.toggleFilter,
        action: () => {
          const state = useDashboardStore.getState();
          // Filter lives in the Obsidian page's filter row: only there, and show the row if hidden
          if (state.graphStyle !== "obsidian") return;
          setMapFilters(true);
          try {
            window.localStorage.setItem("ua.mapFilters", "1");
          } catch {
            // storage unavailable: shown for this session only
          }
          state.toggleFilterPanel();
        },
        category: "View",
      },
      {
        key: "e",
        description: t.keyboardShortcuts.toggleExport,
        action: () => {
          const state = useDashboardStore.getState();
          state.toggleExportMenu();
        },
        category: "View",
      },
      {
        key: "p",
        description: t.keyboardShortcuts.openPathFinder,
        action: () => {
          const state = useDashboardStore.getState();
          state.togglePathFinder();
        },
        category: "View",
      },
    ],
    [t]
  );

  // Register keyboard shortcuts
  useKeyboardShortcuts(shortcuts);

  // Determine sidebar content
  // NodeInfo always takes priority when a node is selected.
  // Learn mode adds LearnPanel below it; otherwise ProjectOverview shows when idle.
  const isLearnMode = tourActive || persona === "junior";
  // Three pages: the Learn roadmap, the Obsidian dot map (or the domain map when that view is
  // picked), and graphify's own map with its explain panel.
  const domainActive = graphStyle === "obsidian" && viewMode === "domain" && !!domainGraph;
  const obsidianActive = graphStyle === "obsidian" && !domainActive;
  // on narrow screens the sidebar overlays the right edge, so a right-docked viewer moves to the bottom
  const dock = isNarrow && obsidianActive && obsSidebarOpen && codeDock === "right" ? "bottom" : codeDock;
  const infoSidebarContent = (
    <>
      {obsidianActive ? (
        <ObsidianSidebar />
      ) : (
        <>
          {selectedNodeId && <NodeInfo />}
          {isLearnMode && (
            <Suspense fallback={null}>
              <LearnPanel />
            </Suspense>
          )}
          {!selectedNodeId && !isLearnMode && <ProjectOverview />}
        </>
      )}
    </>
  );

  const sidebarContent = (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-1 p-2 border-b border-border-subtle bg-surface shrink-0">
        {(["info", "files"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setSidebarTab(tab)}
            className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              sidebarTab === tab
                ? "bg-accent/15 text-accent"
                : "text-text-muted hover:text-text-primary hover:bg-elevated"
            }`}
          >
            {tab === "info" ? t.sidebar.info : t.sidebar.files}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {sidebarTab === "files" ? <FileExplorer /> : infoSidebarContent}
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <MobileLayout
        accessToken={accessToken}
        showKeyboardHelp={showKeyboardHelp}
        setShowKeyboardHelp={setShowKeyboardHelp}
        loadError={loadError}
        allIssues={allIssues}
        graphFreshness={graphFreshness}
        shortcuts={shortcuts}
      />
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-root text-text-primary noise-overlay">
      {/* Header */}
      <header className="flex flex-wrap items-center px-3 sm:px-5 py-3 bg-surface border-b border-border-subtle shrink-0 gap-x-2 sm:gap-x-4 gap-y-2">
        {/* Left — wraps onto another row on narrow windows, so nothing is hidden or scrolled away */}
        <div className="flex flex-wrap items-center gap-x-3 sm:gap-x-5 gap-y-2">
          <h1 className="font-heading text-base sm:text-lg text-text-primary tracking-wide shrink-0">
            {graph?.project.name ?? t.common.appName}
          </h1>
          <div className="w-px h-5 bg-border-subtle hidden sm:block" />
          {graph && (
            <div className={SEGMENT_GROUP} role="tablist" title={t.obsidian.graphStyle}>
              {(["learn", "obsidian", "graphify"] as const).map((style) => (
                <button
                  key={style}
                  type="button"
                  role="tab"
                  aria-selected={graphStyle === style}
                  onClick={() => setGraphStyle(style)}
                  className={segment(graphStyle === style)}
                >
                  {style === "learn" ? t.obsidian.learn : style === "obsidian" ? t.obsidian.obsidian : t.obsidian.graphify}
                </button>
              ))}
            </div>
          )}
          {graphStyle === "obsidian" && (
            <>
              <div className="w-px h-5 bg-border-subtle" />
              <PersonaSelector />
              <button
                type="button"
                onClick={toggleMapFilters}
                aria-expanded={mapFilters}
                className={`${HEADER_BUTTON} bg-elevated text-text-secondary hover:text-text-primary`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={mapFilters ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
                </svg>
                {mapFilters ? t.obsidian.hideFilters : t.obsidian.showFilters}
              </button>
            </>
          )}
          {graph && graphStyle === "obsidian" && !isKnowledgeGraph && domainGraph && (
            <>
              <div className="w-px h-5 bg-border-subtle" />
              <div className={SEGMENT_GROUP}>
                <button
                  type="button"
                  onClick={() => setViewMode("domain")}
                  title={t.drawer.domain}
                  className={segment(viewMode === "domain")}
                >
                  {t.drawer.domain}
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("structural")}
                  title={t.drawer.structural}
                  className={segment(viewMode === "structural")}
                >
                  {t.drawer.structural}
                </button>
              </div>
            </>
          )}
        </div>

        <div className="flex-1" />

        {/* Right — fixed actions */}
        <div className="flex items-center gap-2 sm:gap-4 shrink-0 ml-auto">
          <ExportMenu />
          <button
            onClick={togglePathFinder}
            className={`${HEADER_BUTTON} bg-elevated text-text-secondary hover:text-text-primary`}
            title={t.pathFinder.title}
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
              />
            </svg>
            <span className="hidden md:inline">{t.common.path}</span>
          </button>
          <ThemePicker />
          <button
            onClick={() => setShowKeyboardHelp(true)}
            aria-label={t.keyboardShortcuts.showHelp}
            className={`${HEADER_ICON_BUTTON} bg-elevated text-text-secondary hover:text-accent`}
            title={t.keyboardShortcuts.showHelp}
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </button>
        </div>

        {/* Row 2, Obsidian only: the map's filters, all the same size on one line */}
        {graphStyle === "obsidian" && mapFilters && (
          <div className="basis-full flex flex-wrap items-center gap-2">
            <DiffToggle />
            {(isKnowledgeGraph ? [
              { key: "knowledge" as const, label: t.nodeTypeLabels.all, color: "var(--color-node-article)" },
            ] : [
              { key: "code" as const, label: t.nodeTypeLabels.code, color: "var(--color-node-file)" },
              { key: "config" as const, label: t.nodeTypeLabels.config, color: "var(--color-node-config)" },
              { key: "docs" as const, label: t.nodeTypeLabels.docs, color: "var(--color-node-document)" },
              { key: "infra" as const, label: t.nodeTypeLabels.infra, color: "var(--color-node-service)" },
              { key: "data" as const, label: t.nodeTypeLabels.data, color: "var(--color-node-table)" },
              { key: "domain" as const, label: t.nodeTypeLabels.domain, color: "var(--color-node-concept)" },
              { key: "knowledge" as const, label: t.nodeTypeLabels.knowledge, color: "var(--color-node-article)" },
            ]).map((cat) => (
              <button
                key={cat.key}
                onClick={() => toggleNodeTypeFilter(cat.key)}
                className={`h-9 inline-flex items-center gap-2 px-3 rounded-lg border text-[13px] font-medium whitespace-nowrap transition-colors ${FOCUS_RING} ${
                  nodeTypeFilters[cat.key] !== false
                    ? "border-border-medium bg-elevated text-text-secondary hover:text-text-primary"
                    : "border-transparent bg-transparent text-text-muted/50 line-through hover:text-text-muted"
                }`}
                title={`${nodeTypeFilters[cat.key] !== false ? "Hide" : "Show"} ${cat.label} nodes`}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{
                    backgroundColor: cat.color,
                    opacity: nodeTypeFilters[cat.key] !== false ? 1 : 0.3,
                  }}
                />
                {cat.label}
              </button>
            ))}
            <FilterPanel />
          </div>
        )}
      </header>

      {/* Search (graphify's page has its own; the Learn roadmap is the navigation there) */}
      {graphStyle === "obsidian" && <SearchBar />}

      {/* Graph freshness warning banner */}
      {!loadError && <StalenessBanner freshness={graphFreshness} />}

      {/* Validation warning banner */}
      {allIssues.length > 0 && !loadError && (
        <WarningBanner issues={allIssues} />
      )}

      {/* Error banner */}
      {loadError && (
        <div className="px-5 py-3 bg-red-900/30 border-b border-red-700 text-red-200 text-sm">
          {loadError}
        </div>
      )}

      {/* Main content: Graph + Sidebar */}
      <div className="flex-1 flex min-h-0 relative">
        {codeViewerOpen && !codeViewerExpanded && dock === "left" && (
          <aside className="w-[min(480px,45%)] shrink-0 bg-surface border-r border-border-subtle overflow-hidden">
            <Suspense fallback={null}>
              <CodeViewer accessToken={accessToken} onExpand={expandCodeViewer} dock={codeDock} onDock={dockCodeViewer} />
            </Suspense>
          </aside>
        )}

        {/* Graph area */}
        <div className="flex-1 min-w-0 min-h-0 relative">
          {/* pages stay mounted once opened, so coming back keeps their place (no reload) */}
          {visitedPages.has("learn") && (
            // a bottom-docked code viewer takes the lower 40%: end the reader above it (Back / Next stay reachable)
            <div
              className={`absolute inset-x-0 top-0 ${graphStyle === "learn" ? "" : "hidden"} ${
                codeViewerOpen && !codeViewerExpanded && dock === "bottom" ? "bottom-[40vh]" : "bottom-0"
              }`}
            >
              <LearnMode />
            </div>
          )}
          {visitedPages.has("graphify") && (
            <div className={`absolute inset-0 ${graphStyle === "graphify" ? "" : "hidden"}`}>
              <GraphifyFrame accessToken={accessToken} />
            </div>
          )}
          {domainActive && <DomainGraphView />}
          {visitedPages.has("obsidian") && (
            <div className={`absolute inset-0 ${obsidianActive ? "" : "hidden"}`}>
              <ObsidianGraphView />
            </div>
          )}
          {obsidianActive ? (
            <button
              type="button"
              onClick={() => setObsSidebarOpen((v) => !v)}
              title={t.obsidian.toggleSidebar}
              aria-label={t.obsidian.toggleSidebar}
              aria-pressed={obsSidebarOpen}
              className="absolute top-3 right-3 z-20 w-9 h-9 rounded-lg border border-border-subtle bg-surface/95 text-text-primary shadow-xl hover:bg-elevated"
            >
              {obsSidebarOpen ? "⇥" : "⇤"}
            </button>
          ) : domainActive ? (
            <div className="absolute top-3 right-3 text-sm text-text-muted/60 pointer-events-none select-none">
              {t.common.pressKeyboard}
            </div>
          ) : null}
        </div>

        {/* Right sidebar — telescopes at narrower widths. In the Obsidian style it can be
            hidden, and on narrow screens it overlays the graph instead of shrinking it. */}
        {(domainActive || (obsidianActive && obsSidebarOpen)) && (
          <aside
            // always beside the map (an overlay hid the zoom buttons and had no way to close)
            className="w-[300px] lg:w-[360px] shrink-0 bg-surface border-l border-border-subtle overflow-auto"
          >
            {sidebarContent}
          </aside>
        )}

        {codeViewerOpen && !codeViewerExpanded && dock === "right" && (
          <aside className="w-[min(480px,45%)] shrink-0 bg-surface border-l border-border-subtle overflow-hidden">
            <Suspense fallback={null}>
              <CodeViewer accessToken={accessToken} onExpand={expandCodeViewer} dock={codeDock} onDock={dockCodeViewer} />
            </Suspense>
          </aside>
        )}

        {/* Code viewer slide-up overlay (collapsed state) */}
        {codeViewerOpen && !codeViewerExpanded && dock === "bottom" && (
          <div className="absolute bottom-0 left-0 right-0 h-[40vh] bg-surface border-t border-border-subtle animate-slide-up z-20 overflow-hidden">
            <Suspense fallback={null}>
              <CodeViewer accessToken={accessToken} onExpand={expandCodeViewer} dock={codeDock} onDock={dockCodeViewer} />
            </Suspense>
          </div>
        )}
      </div>

      {/* Expanded code viewer modal */}
      {codeViewerOpen && codeViewerExpanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4 sm:p-6"
          onMouseDown={collapseCodeViewer}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-[calc(100vw-32px)] max-w-[1120px] h-[calc(100vh-32px)] sm:h-[calc(100vh-48px)] max-h-[820px] rounded-lg border border-border-medium bg-surface shadow-2xl overflow-hidden"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <Suspense fallback={null}>
              <CodeViewer
                accessToken={accessToken}
                presentation="modal"
                onClose={collapseCodeViewer}
              />
            </Suspense>
          </div>
        </div>
      )}

      {/* Keyboard shortcuts help modal */}
      {showKeyboardHelp && (
        <Suspense fallback={null}>
          <KeyboardShortcutsHelp
            shortcuts={shortcuts}
            onClose={() => setShowKeyboardHelp(false)}
          />
        </Suspense>
      )}

      {/* Path Finder Modal — only mounted when open so its chunk is lazy-loaded on demand. */}
      {pathFinderOpen && (
        <Suspense fallback={null}>
          <PathFinderModal isOpen={pathFinderOpen} onClose={togglePathFinder} />
        </Suspense>
      )}

      {/* First-visit onboarding overlay — only mounted when needed so its chunk is lazy-loaded on demand. */}
      {showOnboarding && (
        <Suspense fallback={null}>
          <OnboardingOverlay onDismiss={dismissOnboarding} />
        </Suspense>
      )}
    </div>
  );
}

export default App;

import { useEffect, useRef } from "react";
import { HEADER_BUTTON } from "./header-styles";
import { useDashboardStore, ALL_NODE_TYPES, ALL_COMPLEXITIES, ALL_EDGE_CATEGORIES } from "../store";
import type { NodeType, Complexity, EdgeCategory } from "../store";
import { useI18n } from "../contexts/I18nContext";

export default function FilterPanel() {
  const graph = useDashboardStore((s) => s.graph);
  const filters = useDashboardStore((s) => s.filters);
  const setFilters = useDashboardStore((s) => s.setFilters);
  const resetFilters = useDashboardStore((s) => s.resetFilters);
  const hasActiveFilters = useDashboardStore((s) => s.hasActiveFilters);
  const filterPanelOpen = useDashboardStore((s) => s.filterPanelOpen);
  const toggleFilterPanel = useDashboardStore((s) => s.toggleFilterPanel);
  const { t } = useI18n();

  const containerRef = useRef<HTMLDivElement>(null);

  // only the kinds of parts this project actually has
  const allNodeTypes = ALL_NODE_TYPES.filter((type) => !graph || graph.nodes.some((n) => n.type === type));
  const allComplexities = ALL_COMPLEXITIES;
  const allEdgeCategories = ALL_EDGE_CATEGORIES;
  const layers = graph?.layers ?? [];

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        if (filterPanelOpen) {
          toggleFilterPanel();
        }
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [filterPanelOpen, toggleFilterPanel]);

  const toggleNodeType = (type: NodeType) => {
    const newTypes = new Set(filters.nodeTypes);
    if (newTypes.has(type)) {
      newTypes.delete(type);
    } else {
      newTypes.add(type);
    }
    setFilters({ nodeTypes: newTypes });
  };

  const toggleComplexity = (complexity: Complexity) => {
    const newComplexities = new Set(filters.complexities);
    if (newComplexities.has(complexity)) {
      newComplexities.delete(complexity);
    } else {
      newComplexities.add(complexity);
    }
    setFilters({ complexities: newComplexities });
  };

  const toggleLayer = (layerId: string) => {
    const newLayers = new Set(filters.layerIds);
    if (newLayers.has(layerId)) {
      newLayers.delete(layerId);
    } else {
      newLayers.add(layerId);
    }
    setFilters({ layerIds: newLayers });
  };

  const toggleEdgeCategory = (category: EdgeCategory) => {
    const newCategories = new Set(filters.edgeCategories);
    if (newCategories.has(category)) {
      newCategories.delete(category);
    } else {
      newCategories.add(category);
    }
    setFilters({ edgeCategories: newCategories });
  };

  const isActive = hasActiveFilters();

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={toggleFilterPanel}
        className={`${HEADER_BUTTON} ${
          isActive
            ? "bg-accent/20 text-accent hover:bg-accent/30"
            : "bg-elevated text-text-secondary hover:text-text-primary"
        }`}
        title="Filter graph (F)"
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
            d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
          />
        </svg>
        {t.common.filter}
      </button>

      {filterPanelOpen && (
        <div className="absolute right-0 top-full mt-2 w-72 max-h-[65vh] glass rounded-lg shadow-xl overflow-y-auto overscroll-contain animate-fade-slide-in z-50">
          <div className="p-4 space-y-4">
            {/* Node Types */}
            <div>
              <h3 className="text-xs font-semibold text-text-secondary mb-2">
                {t.filterPanel.nodeTypes}
              </h3>
              <div className="space-y-1.5">
                {allNodeTypes.map((type) => (
                  <label
                    key={type}
                    className="flex items-center gap-2 cursor-pointer hover:bg-elevated/50 rounded px-2 py-1.5 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={filters.nodeTypes.has(type)}
                      onChange={() => toggleNodeType(type)}
                      className="w-4 h-4 rounded border-border-subtle bg-elevated checked:bg-accent checked:border-accent focus:ring-0 focus:ring-offset-0 cursor-pointer"
                    />
                    <span className="text-sm text-text-primary capitalize">{type}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Complexity */}
            <div>
              <h3 className="text-xs font-semibold text-text-secondary mb-2">
                {t.filterPanel.complexity}
              </h3>
              <div className="space-y-1.5">
                {allComplexities.map((complexity) => (
                  <label
                    key={complexity}
                    className="flex items-center gap-2 cursor-pointer hover:bg-elevated/50 rounded px-2 py-1.5 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={filters.complexities.has(complexity)}
                      onChange={() => toggleComplexity(complexity)}
                      className="w-4 h-4 rounded border-border-subtle bg-elevated checked:bg-accent checked:border-accent focus:ring-0 focus:ring-offset-0 cursor-pointer"
                    />
                    <span className="text-sm text-text-primary capitalize">{complexity}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Layers */}
            {layers.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-text-secondary mb-2">
                  {t.filterPanel.layers}
                </h3>
                <div className="space-y-1.5">
                  {layers.map((layer) => (
                    <label
                      key={layer.id}
                      className="flex items-center gap-2 cursor-pointer hover:bg-elevated/50 rounded px-2 py-1.5 transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={filters.layerIds.has(layer.id)}
                        onChange={() => toggleLayer(layer.id)}
                        className="w-4 h-4 rounded border-border-subtle bg-elevated checked:bg-accent checked:border-accent focus:ring-0 focus:ring-offset-0 cursor-pointer"
                      />
                      <div className="w-2 h-2 rounded-full bg-accent/50 shrink-0" />
                      <span className="text-sm text-text-primary">{layer.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Edge Categories */}
            <div>
              <h3 className="text-xs font-semibold text-text-secondary mb-2">
                {t.filterPanel.edgeCategories}
              </h3>
              <div className="space-y-1.5">
                {allEdgeCategories.map((category) => (
                  <label
                    key={category}
                    className="flex items-center gap-2 cursor-pointer hover:bg-elevated/50 rounded px-2 py-1.5 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={filters.edgeCategories.has(category)}
                      onChange={() => toggleEdgeCategory(category)}
                      className="w-4 h-4 rounded border-border-subtle bg-elevated checked:bg-accent checked:border-accent focus:ring-0 focus:ring-offset-0 cursor-pointer"
                    />
                    <span className="text-sm text-text-primary capitalize">
                      {category.replace(/-/g, " ")}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Reset Button */}
            {isActive && (
              <button
                onClick={resetFilters}
                className="w-full px-3 py-1.5 text-sm bg-elevated hover:bg-accent/20 text-text-secondary hover:text-accent rounded-lg transition-colors"
              >
                {t.common.resetAll}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Obsidian-style graph view: dots sized by connection count, thin links, colour
 * groups per layer, physics you can drag/pan/zoom, labels that fade in as you zoom.
 *
 * - Hover a dot: it and its neighbours light up, everything else fades, and a box
 *   shows where it connects (links out / linked from).
 * - Click a dot: selects it (sidebar shows the note) and pins the box; entries in
 *   the pinned box are clickable. Click empty space to unpin.
 *
 * Works for codebase graphs (files by default, functions/classes optional) and
 * knowledge graphs (notes). Data shaping lives in utils/obsidian-graph.ts.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { useDashboardStore } from "../store";
import { useI18n } from "../contexts/I18nContext";
import {
  buildObsidianGraph,
  connectionsOf,
  fileConnectionsOf,
  isFileNode,
  type Connection,
  edgeLabel,
  groupColor,
  hasSymbols,
  nodeRadius,
  type ObsNode,
} from "../utils/obsidian-graph";

type SimNode = ObsNode & SimulationNodeDatum & { r: number };
type SimLink = SimulationLinkDatum<SimNode> & { types: string[] };

const BG = "#1e1e1e";
const LINK = "rgba(160,160,160,0.28)";
const LINK_DIM = "rgba(160,160,160,0.06)";
const LINK_HI = "#a882ff";
const LABEL = "#dadada";
const BOX_ITEMS = 8;

interface View {
  x: number;
  y: number;
  k: number;
}

interface Props {
  /** shown as an "Open note" button in the pinned box (mobile: switch to the Info tab) */
  onOpenNote?: () => void;
}

export default function ObsidianGraphView({ onOpenNote }: Props = {}) {
  const graph = useDashboardStore((s) => s.graph);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const selectNode = useDashboardStore((s) => s.selectNode);
  const searchResults = useDashboardStore((s) => s.searchResults);
  const tourHighlightedNodeIds = useDashboardStore((s) => s.tourHighlightedNodeIds);
  const { t } = useI18n();
  const o = t.obsidian;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const viewRef = useRef<View>({ x: 0, y: 0, k: 1 });
  const sizeRef = useRef({ w: 800, h: 600 });
  const frameRef = useRef<number | null>(null);
  const userMovedRef = useRef(false);
  const dragRef = useRef<{ node: SimNode | null; panning: boolean; moved: boolean; lastX: number; lastY: number }>({
    node: null,
    panning: false,
    moved: false,
    lastX: 0,
    lastY: 0,
  });

  const hasGraph = !!graph;
  const canShowSymbols = useMemo(() => (graph ? hasSymbols(graph) : false), [graph]);
  const [includeSymbols, setIncludeSymbols] = useState(false);
  const [showArrows, setShowArrows] = useState(true);
  const [colorGroups, setColorGroups] = useState(true);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  // display settings start collapsed on small screens, like Obsidian's graph-settings gear
  const [settingsOpen, setSettingsOpen] = useState(
    () => typeof window === "undefined" || window.innerWidth >= 900,
  );

  const obs = useMemo(
    () => (graph ? buildObsidianGraph(graph, { includeSymbols: includeSymbols && canShowSymbols }) : null),
    [graph, includeSymbols, canShowSymbols],
  );

  // Highlight sets (kept in refs too so the draw loop reads the latest without re-subscribing)
  const searchSet = useMemo(() => {
    if (!obs || searchResults.length === 0) return null;
    const s = new Set<string>();
    for (const r of searchResults) {
      const v = obs.visibleIdOf.get(r.nodeId);
      if (v) s.add(v);
    }
    return s;
  }, [obs, searchResults]);
  const tourSet = useMemo(() => {
    if (!obs || tourHighlightedNodeIds.length === 0) return null;
    return new Set(tourHighlightedNodeIds.map((id) => obs.visibleIdOf.get(id)).filter((v): v is string => !!v));
  }, [obs, tourHighlightedNodeIds]);
  const selectedVisible = selectedNodeId && obs ? obs.visibleIdOf.get(selectedNodeId) ?? null : null;
  const focusId = hoverId ?? pinnedId ?? selectedVisible;

  const stateRef = useRef({ focusId, selectedVisible, searchSet, tourSet, showArrows, colorGroups, obs });
  stateRef.current = { focusId, selectedVisible, searchSet, tourSet, showArrows, colorGroups, obs };

  // ---------------------------------------------------------------- drawing
  const draw = useCallback(() => {
    frameRef.current = null;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const { w, h } = sizeRef.current;
    const { x, y, k } = viewRef.current;
    const st = stateRef.current;
    const neighbors = st.focusId ? st.obs?.neighbors.get(st.focusId) : undefined;
    const filter = st.searchSet ?? st.tourSet;

    const isLit = (id: string) => {
      if (st.focusId) return id === st.focusId || !!neighbors?.has(id);
      if (filter) return filter.has(id);
      return true;
    };

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, h);
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * x, dpr * y);

    // links — batched into one path per style (one stroke for thousands of lines),
    // with only the focused node's links drawn separately on top.
    const viewW = w / k, viewH = h / k, minX = -x / k, minY = -y / k;
    const inView = (px: number, py: number, pad: number) =>
      px > minX - pad && px < minX + viewW + pad && py > minY - pad && py < minY + viewH + pad;
    const normal = new Path2D();
    const dim = new Path2D();
    const hi: SimLink[] = [];
    for (const l of linksRef.current) {
      const s = l.source as SimNode;
      const tg = l.target as SimNode;
      if (s.x == null || tg.x == null) continue;
      if (!inView(s.x, s.y!, 400) && !inView(tg.x, tg.y!, 400)) continue;
      if (st.focusId && (s.id === st.focusId || tg.id === st.focusId)) {
        hi.push(l);
        continue;
      }
      const lit = !st.focusId && isLit(s.id) && isLit(tg.id);
      const path = lit ? normal : dim;
      path.moveTo(s.x, s.y!);
      path.lineTo(tg.x, tg.y!);
    }
    ctx.lineWidth = 0.8 / Math.sqrt(k);
    ctx.strokeStyle = LINK_DIM;
    ctx.stroke(dim);
    ctx.strokeStyle = LINK;
    ctx.stroke(normal);
    const arrows = new Path2D();
    const addArrow = (s: SimNode, tg: SimNode) => {
      const ang = Math.atan2(tg.y! - s.y!, tg.x! - s.x!);
      const ax = tg.x! - Math.cos(ang) * (tg.r + 2);
      const ay = tg.y! - Math.sin(ang) * (tg.r + 2);
      const size = 5 / Math.sqrt(k);
      arrows.moveTo(ax, ay);
      arrows.lineTo(ax - Math.cos(ang - 0.45) * size, ay - Math.sin(ang - 0.45) * size);
      arrows.lineTo(ax - Math.cos(ang + 0.45) * size, ay - Math.sin(ang + 0.45) * size);
      arrows.closePath();
    };
    if (st.showArrows && k > 1.4) {
      for (const l of linksRef.current) {
        const s = l.source as SimNode;
        const tg = l.target as SimNode;
        if (s.x == null || tg.x == null || !inView(tg.x, tg.y!, 20)) continue;
        if (st.focusId && (s.id === st.focusId || tg.id === st.focusId)) continue;
        if (!st.focusId && isLit(s.id) && isLit(tg.id)) addArrow(s, tg);
      }
      ctx.fillStyle = LINK;
      ctx.fill(arrows);
    }
    if (hi.length) {
      const hiPath = new Path2D();
      const hiArrows = new Path2D();
      for (const l of hi) {
        const s = l.source as SimNode;
        const tg = l.target as SimNode;
        hiPath.moveTo(s.x!, s.y!);
        hiPath.lineTo(tg.x!, tg.y!);
        if (st.showArrows) {
          const ang = Math.atan2(tg.y! - s.y!, tg.x! - s.x!);
          const ax = tg.x! - Math.cos(ang) * (tg.r + 2);
          const ay = tg.y! - Math.sin(ang) * (tg.r + 2);
          const size = 5 / Math.sqrt(k);
          hiArrows.moveTo(ax, ay);
          hiArrows.lineTo(ax - Math.cos(ang - 0.45) * size, ay - Math.sin(ang - 0.45) * size);
          hiArrows.lineTo(ax - Math.cos(ang + 0.45) * size, ay - Math.sin(ang + 0.45) * size);
          hiArrows.closePath();
        }
      }
      ctx.lineWidth = 1.6 / Math.sqrt(k);
      ctx.strokeStyle = LINK_HI;
      ctx.stroke(hiPath);
      ctx.fillStyle = LINK_HI;
      ctx.fill(hiArrows);
    }

    // nodes — one path per (colour, lit) bucket instead of one fill per dot
    const buckets = new Map<string, Path2D>();
    let focusNode: SimNode | null = null;
    let selectedNode: SimNode | null = null;
    for (const n of nodesRef.current) {
      if (n.x == null || !inView(n.x, n.y!, n.r + 2)) continue;
      if (n.id === st.focusId) focusNode = n;
      if (n.id === st.selectedVisible) selectedNode = n;
      const key = `${isLit(n.id) ? 1 : 0}|${st.colorGroups ? groupColor(n.group) : "#b3b3b3"}`;
      let path = buckets.get(key);
      if (!path) {
        path = new Path2D();
        buckets.set(key, path);
      }
      path.moveTo(n.x + n.r, n.y!);
      path.arc(n.x, n.y!, n.r, 0, Math.PI * 2);
    }
    for (const [key, path] of buckets) {
      const [lit, color] = key.split("|");
      ctx.globalAlpha = lit === "1" ? 1 : 0.12;
      ctx.fillStyle = color;
      ctx.fill(path);
    }
    ctx.globalAlpha = 1;
    if (focusNode) {
      ctx.fillStyle = LINK_HI;
      ctx.beginPath();
      ctx.arc(focusNode.x!, focusNode.y!, focusNode.r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (selectedNode) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5 / k;
      ctx.beginPath();
      ctx.arc(selectedNode.x!, selectedNode.y!, selectedNode.r + 3 / k, 0, Math.PI * 2);
      ctx.stroke();
    }

    // labels: like Obsidian, a label fades in once its dot is big enough on screen
    // (busy hubs get names first, small dots as you zoom in); the focused node and
    // its neighbours always show theirs.
    const labelAlpha = (r: number) => Math.max(0, Math.min(1, (r * k - 9) / 5));
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const n of nodesRef.current) {
      if (n.x == null || !inView(n.x, n.y!, 60)) continue;
      const near = st.focusId ? n.id === st.focusId || !!neighbors?.has(n.id) : false;
      const alpha = st.focusId ? (near ? 1 : 0) : isLit(n.id) ? labelAlpha(n.r) : 0;
      if (alpha <= 0.02) continue;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = LABEL;
      ctx.font = `${(n.id === st.focusId ? 13 : 11) / Math.sqrt(k)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillText(n.name, n.x, n.y! + n.r + 3 / k);
    }
    ctx.globalAlpha = 1;
  }, []);

  const requestDraw = useCallback(() => {
    if (frameRef.current == null) frameRef.current = requestAnimationFrame(draw);
  }, [draw]);

  // ---------------------------------------------------------------- simulation
  useEffect(() => {
    if (!obs) return;
    const prev = new Map(nodesRef.current.map((n) => [n.id, n]));
    const nodes: SimNode[] = obs.nodes.map((n) => {
      const p = prev.get(n.id);
      return { ...n, r: nodeRadius(n.degree), x: p?.x, y: p?.y, vx: p?.vx, vy: p?.vy };
    });
    const links: SimLink[] = obs.links.map((l) => ({ source: l.source, target: l.target, types: l.types }));
    nodesRef.current = nodes;
    linksRef.current = links;

    simRef.current?.stop();
    const sim = forceSimulation<SimNode, SimLink>(nodes)
      .force("link", forceLink<SimNode, SimLink>(links).id((d) => d.id).distance(45).strength(0.5))
      .force("charge", forceManyBody<SimNode>().strength(-90).distanceMax(500))
      .force("center", forceCenter(0, 0))
      .force("x", forceX<SimNode>(0).strength(0.04))
      .force("y", forceY<SimNode>(0).strength(0.04))
      .force("collide", forceCollide<SimNode>((d) => d.r + 3))
      .alphaDecay(nodes.length > 2000 ? 0.06 : 0.03)
      .on("tick", requestDraw);
    simRef.current = sim;
    return () => {
      sim.stop();
    };
  }, [obs, requestDraw]);

  // redraw on highlight changes
  useEffect(requestDraw, [focusId, selectedVisible, searchSet, tourSet, showArrows, colorGroups, requestDraw]);

  // ---------------------------------------------------------------- sizing
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const first = sizeRef.current.w === 800 && viewRef.current.x === 0;
      sizeRef.current = { w: rect.width, h: rect.height };
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      if (first) viewRef.current = { x: rect.width / 2, y: rect.height / 2, k: 1 };
      requestDraw();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [requestDraw, hasGraph]);

  // ---------------------------------------------------------------- camera helpers
  const toWorld = (sx: number, sy: number) => {
    const { x, y, k } = viewRef.current;
    return { x: (sx - x) / k, y: (sy - y) / k };
  };

  const fit = useCallback(() => {
    const ns = nodesRef.current.filter((n) => n.x != null);
    if (ns.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of ns) {
      minX = Math.min(minX, n.x!); maxX = Math.max(maxX, n.x!);
      minY = Math.min(minY, n.y!); maxY = Math.max(maxY, n.y!);
    }
    const { w, h } = sizeRef.current;
    const k = Math.min(2.5, 0.9 * Math.min(w / Math.max(1, maxX - minX + 60), h / Math.max(1, maxY - minY + 60)));
    viewRef.current = { k, x: w / 2 - ((minX + maxX) / 2) * k, y: h / 2 - ((minY + maxY) / 2) * k };
    requestDraw();
  }, [requestDraw]);

  const zoomBy = useCallback(
    (factor: number) => {
      userMovedRef.current = true;
      const { w, h } = sizeRef.current;
      const v = viewRef.current;
      const k = Math.min(8, Math.max(0.08, v.k * factor));
      viewRef.current = { k, x: w / 2 - ((w / 2 - v.x) / v.k) * k, y: h / 2 - ((h / 2 - v.y) / v.k) * k };
      requestDraw();
    },
    [requestDraw],
  );

  const centerOn = useCallback(
    (id: string) => {
      const n = nodesRef.current.find((m) => m.id === id);
      if (!n || n.x == null) return;
      const { w, h } = sizeRef.current;
      const k = Math.max(viewRef.current.k, 1.2);
      viewRef.current = { k, x: w / 2 - n.x * k, y: h / 2 - n.y! * k };
      requestDraw();
    },
    [requestDraw],
  );

  // fit while the first layout settles, until the user pans/zooms/drags themselves
  useEffect(() => {
    userMovedRef.current = false;
    const ids = [400, 1200, 3000].map((ms) =>
      window.setTimeout(() => {
        if (!userMovedRef.current) fit();
      }, ms),
    );
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, [obs, fit]);

  // follow selections made elsewhere (sidebar links, search, tour)
  useEffect(() => {
    if (selectedVisible && selectedVisible !== pinnedId) {
      setPinnedId(selectedVisible);
      centerOn(selectedVisible);
    }
    if (!selectedNodeId) setPinnedId(null);
  }, [selectedVisible, selectedNodeId]);

  const hitTest = (sx: number, sy: number): SimNode | null => {
    const p = toWorld(sx, sy);
    const k = viewRef.current.k;
    let best: SimNode | null = null;
    let bestD = Infinity;
    for (const n of nodesRef.current) {
      if (n.x == null) continue;
      const d = Math.hypot(n.x - p.x, n.y! - p.y);
      if (d < n.r + 4 / k && d < bestD) {
        best = n;
        bestD = d;
      }
    }
    return best;
  };

  // ---------------------------------------------------------------- pointer events
  const localXY = (e: ReactPointerEvent | ReactWheelEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const { sx, sy } = localXY(e);
    const hit = hitTest(sx, sy);
    dragRef.current = { node: hit, panning: !hit, moved: false, lastX: sx, lastY: sy };
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    if (hit) {
      hit.fx = hit.x;
      hit.fy = hit.y;
      simRef.current?.alphaTarget(0.25).restart();
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const { sx, sy } = localXY(e);
    const d = dragRef.current;
    if (d.node || d.panning) {
      const dx = sx - d.lastX;
      const dy = sy - d.lastY;
      if (Math.abs(dx) + Math.abs(dy) > 2) {
        d.moved = true;
        userMovedRef.current = true;
      }
      d.lastX = sx;
      d.lastY = sy;
      if (d.node) {
        const p = toWorld(sx, sy);
        d.node.fx = p.x;
        d.node.fy = p.y;
      } else {
        viewRef.current = { ...viewRef.current, x: viewRef.current.x + dx, y: viewRef.current.y + dy };
        requestDraw();
      }
      return;
    }
    const hit = hitTest(sx, sy);
    setHoverId(hit ? hit.id : null);
    setMouse({ x: sx, y: sy });
    if (canvasRef.current) canvasRef.current.style.cursor = hit ? "pointer" : "grab";
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    if (d.node) {
      d.node.fx = null;
      d.node.fy = null;
      simRef.current?.alphaTarget(0);
      if (!d.moved) {
        setPinnedId(d.node.id);
        selectNode(d.node.id);
      }
    } else if (d.panning && !d.moved) {
      setPinnedId(null);
      selectNode(null);
    }
    dragRef.current = { node: null, panning: false, moved: false, lastX: 0, lastY: 0 };
    (e.target as HTMLCanvasElement).releasePointerCapture(e.pointerId);
  };

  const onWheel = (e: ReactWheelEvent<HTMLCanvasElement>) => {
    const { sx, sy } = localXY(e);
    const v = viewRef.current;
    userMovedRef.current = true;
    const k = Math.min(8, Math.max(0.08, v.k * Math.exp(-e.deltaY * 0.0015)));
    viewRef.current = { k, x: sx - ((sx - v.x) / v.k) * k, y: sy - ((sy - v.y) / v.k) * k };
    requestDraw();
  };

  // ---------------------------------------------------------------- connection box
  const boxId = hoverId ?? pinnedId;
  const boxNode = boxId ? graph?.nodes.find((n) => n.id === boxId) : undefined;
  const boxConnections = useMemo(
    () => {
      if (!graph || !boxId) return null;
      const n = graph.nodes.find((m) => m.id === boxId);
      // files: group by the other file and carry the "why"; symbols/notes: direct links
      return n && isFileNode(n) ? fileConnectionsOf(graph, boxId) : connectionsOf(graph, boxId, { skipContains: true });
    },
    [graph, boxId],
  );
  // Hover box follows the cursor; the pinned box docks top-right so panning never hides it.
  const boxPos = boxId
    ? hoverId
      ? { x: mouse.x + 16, y: mouse.y + 16 }
      : { x: Math.max(12, sizeRef.current.w - 300), y: 56 }
    : null;
  const pinned = !hoverId && !!pinnedId;

  const layerName = (group: number) => (graph && group >= 0 ? graph.layers[group]?.name : undefined);
  const boxGroup = boxId ? nodesRef.current.find((n) => n.id === boxId)?.group ?? -1 : -1;

  const go = (id: string) => {
    selectNode(id);
    const visible = obs?.visibleIdOf.get(id);
    if (visible) {
      setPinnedId(visible);
      centerOn(visible);
    }
  };

  if (!graph || !obs) {
    return (
      <div className="h-full w-full flex items-center justify-center text-text-muted" style={{ background: BG }}>
        {t.common.noGraphLoaded}
      </div>
    );
  }

  const legend = graph.layers.map((l, i) => ({ name: l.name, color: groupColor(i) }));

  return (
    <div ref={wrapRef} className="h-full w-full relative overflow-hidden select-none" style={{ background: BG }}>
      <canvas
        ref={canvasRef}
        className="block touch-none"
        style={{ cursor: "grab" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHoverId(null)}
        onWheel={onWheel}
        aria-label={o.graphLabel}
        role="img"
      />

      {/* Graph settings, like Obsidian's graph-view panel (collapses to a gear) */}
      {!settingsOpen && (
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          title={o.settings}
          aria-label={o.settings}
          className="absolute top-3 left-3 w-9 h-9 rounded-lg border border-white/10 bg-[#262626]/95 text-[#dadada] text-base shadow-xl hover:bg-[#333]"
        >
          ⚙
        </button>
      )}
      {settingsOpen && (
      <div className="absolute top-3 left-3 w-52 max-w-[calc(100%-24px)] rounded-lg border border-white/10 bg-[#262626]/95 p-3 text-xs text-[#dadada] shadow-xl space-y-2">
        <div className="flex items-center justify-between">
          <div className="font-semibold text-[11px] uppercase tracking-wider text-[#999]">{o.display}</div>
          <button
            type="button"
            onClick={() => setSettingsOpen(false)}
            aria-label={o.close}
            className="text-[#999] hover:text-white"
          >
            ×
          </button>
        </div>
        {canShowSymbols && (
          <Toggle label={o.symbols} checked={includeSymbols} onChange={setIncludeSymbols} />
        )}
        <Toggle label={o.arrows} checked={showArrows} onChange={setShowArrows} />
        <Toggle label={o.colorGroups} checked={colorGroups} onChange={setColorGroups} />
        <button
          type="button"
          onClick={fit}
          className="w-full mt-1 rounded-md bg-white/5 hover:bg-white/10 px-2 py-1 text-[#dadada]"
        >
          {o.fit}
        </button>
        <div className="text-[10px] text-[#888] pt-1">
          {obs.nodes.length} {o.dots} · {obs.links.length} {o.lines}
        </div>
        {colorGroups && legend.length > 0 && (
          <div className="pt-2 border-t border-white/10 space-y-1 max-h-48 overflow-auto">
            <div className="font-semibold text-[11px] uppercase tracking-wider text-[#999]">{o.groups}</div>
            {legend.map((g) => (
              <div key={g.name} className="flex items-center gap-2 truncate">
                <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: g.color }} />
                <span className="truncate">{g.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {/* zoom controls (there is no pinch-zoom on touch screens yet) */}
      <div className="absolute bottom-3 right-3 flex flex-col overflow-hidden rounded-lg border border-white/10 bg-[#262626]/95 text-[#dadada] shadow-xl">
        <button type="button" onClick={() => zoomBy(1.3)} aria-label={o.zoomIn} className="w-9 h-9 hover:bg-[#333] text-lg">
          +
        </button>
        <button type="button" onClick={() => zoomBy(1 / 1.3)} aria-label={o.zoomOut} className="w-9 h-9 hover:bg-[#333] text-lg border-t border-white/10">
          −
        </button>
        <button type="button" onClick={fit} aria-label={o.fit} title={o.fit} className="w-9 h-9 hover:bg-[#333] border-t border-white/10">
          ⤢
        </button>
      </div>

      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[11px] text-[#888] pointer-events-none hidden md:block">
        {o.hint}
      </div>

      {/* "Where it connects" box */}
      {boxNode && boxConnections && boxPos && (
        <div
          className={`absolute z-10 w-72 max-w-[calc(100%-24px)] max-h-[60%] overflow-auto rounded-lg border bg-[#262626]/97 p-3 text-xs text-[#dadada] shadow-2xl ${
            pinned ? "border-[#a882ff]/60 pointer-events-auto" : "border-white/10 pointer-events-none"
          }`}
          style={{
            left: Math.max(12, Math.min(boxPos.x, sizeRef.current.w - 300)),
            top: Math.max(8, Math.min(boxPos.y, sizeRef.current.h - 240)),
          }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="font-semibold text-sm text-white break-words">{boxNode.name}</div>
            {pinned && (
              <button
                type="button"
                onClick={() => {
                  setPinnedId(null);
                  selectNode(null);
                }}
                className="text-[#999] hover:text-white"
                aria-label={o.close}
              >
                ×
              </button>
            )}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-[#999] mt-0.5">
            {boxNode.type}
            {layerName(boxGroup) ? ` · ${layerName(boxGroup)}` : ""}
          </div>
          {boxNode.filePath && boxNode.type !== "article" && (
            <div className="text-[10px] font-mono text-[#888] mt-0.5 break-all">{boxNode.filePath}</div>
          )}
          <div className="mt-1 text-[#bbb]">
            {boxConnections.outgoing.length} {o.links.toLowerCase()} · {boxConnections.incoming.length}{" "}
            {o.backlinks.toLowerCase()}
          </div>
          <ConnList
            title={o.linksTo}
            arrow="→"
            items={boxConnections.outgoing}
            pinned={pinned}
            onGo={go}
            moreLabel={o.more}
          />
          <ConnList
            title={o.linkedFrom}
            arrow="←"
            items={boxConnections.incoming}
            pinned={pinned}
            onGo={go}
            moreLabel={o.more}
          />
          {pinned && onOpenNote && (
            <button
              type="button"
              onClick={onOpenNote}
              className="mt-3 w-full rounded-md bg-[#a882ff]/20 py-1.5 text-[#d6c4ff] hover:bg-[#a882ff]/30"
            >
              {o.openNote} →
            </button>
          )}
          {!pinned && <div className="mt-2 text-[10px] text-[#888]">{o.clickToPin}</div>}
        </div>
      )}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-2 cursor-pointer">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative w-8 h-4 rounded-full transition-colors ${checked ? "bg-[#a882ff]" : "bg-white/15"}`}
      >
        <span
          className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${checked ? "left-4" : "left-0.5"}`}
        />
      </button>
    </label>
  );
}

function ConnList({
  title,
  arrow,
  items,
  pinned,
  onGo,
  moreLabel,
}: {
  title: string;
  arrow: string;
  items: Connection[];
  pinned: boolean;
  onGo: (id: string) => void;
  moreLabel: string;
}) {
  if (items.length === 0) return null;
  const shown = pinned ? items : items.slice(0, BOX_ITEMS);
  return (
    <div className="mt-2">
      <div className="text-[10px] uppercase tracking-wider text-[#999] mb-1">
        {title} ({items.length})
      </div>
      <ul className="space-y-0.5">
        {shown.map((c) => (
          <li key={c.nodeId}>
            <button
              type="button"
              disabled={!pinned}
              onClick={() => onGo(c.nodeId)}
              className={`w-full text-left rounded px-1 py-0.5 ${
                pinned ? "hover:bg-white/10 cursor-pointer" : "cursor-default"
              }`}
            >
              <span className="flex items-baseline gap-1.5">
                <span className="text-[#a882ff]">{arrow}</span>
                <span className="truncate text-[#e6e6e6]">{c.name}</span>
                {c.file && <span className="shrink-0 text-[10px] text-[#777]">{c.file}</span>}
                <span className="ml-auto shrink-0 text-[10px] text-[#888]">{edgeLabel(c.edgeTypes)}</span>
              </span>
              {c.why && (
                <span className={`block pl-4 text-[11px] leading-snug text-[#b9b9b9] ${pinned ? "" : "line-clamp-1"}`}>
                  {c.why}
                </span>
              )}
              {pinned && c.via && c.via.length > 0 && (
                <span className="block pl-4 text-[10px] text-[#777] truncate">via {c.via.join(", ")}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {!pinned && items.length > BOX_ITEMS && (
        <div className="text-[10px] text-[#888] mt-0.5">
          +{items.length - BOX_ITEMS} {moreLabel}
        </div>
      )}
    </div>
  );
}

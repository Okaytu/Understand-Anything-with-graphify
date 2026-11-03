/**
 * Obsidian-style note pane for the sidebar (used with ObsidianGraphView).
 *
 * Reads like an Obsidian note: big title, #tags, the note body rendered as
 * markdown with clickable [[wikilinks]] (unwritten ones dimmed), then "Links"
 * (outgoing) and "Backlinks" (incoming) lists you can click through.
 * Code nodes show their summary, file/line, an Open code button, and what the
 * file defines.
 */
import { useMemo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useDashboardStore } from "../store";
import { useI18n } from "../contexts/I18nContext";
import {
  buildNameIndex,
  childrenOf,
  connectionsOf,
  edgeLabel,
  splitWikilinks,
  type Connection,
} from "../utils/obsidian-graph";

const NODE_HREF = "#ua-node=";
const MISSING_HREF = "#ua-missing";
const LINK_COLOR = "text-[#a882ff]";

/** Rewrite [[wikilinks]] into markdown links the custom `a` renderer understands. */
function wikilinksToMarkdown(text: string, nameIndex: Map<string, string>): string {
  return splitWikilinks(text, nameIndex)
    .map((s) => {
      if (s.kind === "text") return s.text;
      const label = s.text.replace(/[[\]]/g, "");
      return s.nodeId ? `[${label}](${NODE_HREF}${encodeURIComponent(s.nodeId)})` : `[${label}](${MISSING_HREF})`;
    })
    .join("");
}

/** Drop a leading "# Title" line when it just repeats the note title. */
function stripTitle(body: string, title: string): string {
  const lines = body.split("\n");
  if (lines[0]?.replace(/^#\s+/, "").trim().toLowerCase() === title.trim().toLowerCase()) {
    return lines.slice(1).join("\n").replace(/^\s+/, "");
  }
  return body;
}

export default function ObsidianNotePanel() {
  const graph = useDashboardStore((s) => s.graph);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const selectNode = useDashboardStore((s) => s.selectNode);
  const goBackNode = useDashboardStore((s) => s.goBackNode);
  const nodeHistory = useDashboardStore((s) => s.nodeHistory);
  const openCodeViewer = useDashboardStore((s) => s.openCodeViewer);
  const { t } = useI18n();
  const o = t.obsidian;

  const node = useMemo(() => graph?.nodes.find((n) => n.id === selectedNodeId), [graph, selectedNodeId]);
  const nameIndex = useMemo(() => (graph ? buildNameIndex(graph) : new Map<string, string>()), [graph]);
  const conns = useMemo(
    () => (graph && node ? connectionsOf(graph, node.id, { skipContains: true }) : null),
    [graph, node],
  );
  const defined = useMemo(() => (graph && node ? childrenOf(graph, node.id) : []), [graph, node]);
  const layer = useMemo(
    () => (graph && node ? graph.layers.find((l) => l.nodeIds.includes(node.id)) : undefined),
    [graph, node],
  );
  const unwritten = useMemo(() => {
    if (!node) return [];
    const links = node.knowledgeMeta?.wikilinks ?? [];
    return links.filter((l) => !nameIndex.has(l.toLowerCase()));
  }, [node, nameIndex]);

  if (!graph || !node || !conns) return null;

  // Notes are real markdown. Code summaries are plain text full of paths like
  // src/__tests__/x.ts, so escape the characters markdown would turn into bold/italics.
  const body = node.knowledgeMeta?.content
    ? stripTitle(node.knowledgeMeta.content, node.name)
    : [node.summary, node.languageNotes]
        .filter(Boolean)
        .map((s) => (s as string).replace(/([_*])/g, "\\$1"))
        .join("\n\n");

  const components: Components = {
    a: ({ href, children }) => {
      if (href?.startsWith(NODE_HREF)) {
        const id = decodeURIComponent(href.slice(NODE_HREF.length));
        return (
          <button
            type="button"
            onClick={() => selectNode(id)}
            className={`${LINK_COLOR} hover:underline underline-offset-2 cursor-pointer`}
          >
            {children}
          </button>
        );
      }
      if (href === MISSING_HREF) {
        return (
          <span className="text-[#a882ff]/50 underline decoration-dotted" title={o.unwritten}>
            {children}
          </span>
        );
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className={`${LINK_COLOR} underline`}>
          {children}
        </a>
      );
    },
    h1: ({ children }) => <h2 className="text-lg font-semibold text-text-primary mt-4 mb-2">{children}</h2>,
    h2: ({ children }) => <h3 className="text-base font-semibold text-text-primary mt-4 mb-1.5">{children}</h3>,
    h3: ({ children }) => <h4 className="text-sm font-semibold text-text-primary mt-3 mb-1">{children}</h4>,
    p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
    strong: ({ children }) => <strong className="font-semibold text-text-primary">{children}</strong>,
    ul: ({ children }) => <ul className="list-disc pl-5 mb-3 space-y-1">{children}</ul>,
    ol: ({ children }) => <ol className="list-decimal pl-5 mb-3 space-y-1">{children}</ol>,
    blockquote: ({ children }) => (
      <blockquote className="border-l-2 border-[#a882ff]/60 pl-3 text-text-muted mb-3">{children}</blockquote>
    ),
    code: ({ className, children }) =>
      className?.includes("language-") ? (
        <code className="block bg-elevated rounded px-2 py-1.5 mb-3 overflow-x-auto text-[12px]">{children}</code>
      ) : (
        <code className="bg-elevated rounded px-1 py-0.5 text-[12px] text-[#e6a96b]">{children}</code>
      ),
    table: ({ children }) => <table className="mb-3 text-xs border-collapse">{children}</table>,
    th: ({ children }) => <th className="border border-border-subtle px-2 py-1 text-left">{children}</th>,
    td: ({ children }) => <td className="border border-border-subtle px-2 py-1">{children}</td>,
  };

  const location =
    node.filePath && node.type !== "article"
      ? `${node.filePath}${node.lineRange ? `:${node.lineRange[0]}` : ""}`
      : undefined;
  const category = node.knowledgeMeta?.category ?? layer?.name;

  return (
    <div className="px-5 py-4 text-[14px] leading-relaxed text-text-secondary">
      {nodeHistory.length > 0 && (
        <button
          type="button"
          onClick={goBackNode}
          className="text-xs text-text-muted hover:text-text-primary mb-3"
        >
          ← {t.common.back}
        </button>
      )}

      <h1 className="text-2xl font-semibold text-text-primary leading-tight break-words">{node.name}</h1>
      <div className="mt-1 text-xs text-text-muted flex flex-wrap gap-x-2">
        <span className="uppercase tracking-wider">{node.type}</span>
        {category && <span>· {category}</span>}
        {location && <span className="font-mono break-all">· {location}</span>}
      </div>

      {node.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {node.tags.map((tag) => (
            <span key={tag} className="rounded-full bg-[#a882ff]/12 px-2 py-0.5 text-[11px] text-[#c4a8ff]">
              #{tag}
            </span>
          ))}
        </div>
      )}

      {node.filePath && node.type !== "article" && (
        <button
          type="button"
          onClick={() => openCodeViewer(node.id)}
          className="mt-3 rounded-md border border-border-medium px-3 py-1 text-xs text-text-primary hover:bg-elevated"
        >
          {t.common.openCode}
        </button>
      )}

      <div className="mt-4 border-t border-border-subtle pt-4">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {wikilinksToMarkdown(body, nameIndex)}
        </ReactMarkdown>
      </div>

      {defined.length > 0 && (
        <Section title={o.defined} count={defined.length}>
          {defined.map((c) => (
            <Item key={c.id} name={c.name} meta={c.type} onClick={() => selectNode(c.id)} />
          ))}
        </Section>
      )}

      <Section title={o.links} count={conns.outgoing.length} empty={o.noLinks}>
        {conns.outgoing.map((c) => (
          <ConnItem key={c.nodeId} c={c} onClick={() => selectNode(c.nodeId)} />
        ))}
      </Section>

      <Section title={o.backlinks} count={conns.incoming.length} empty={o.noBacklinks}>
        {conns.incoming.map((c) => (
          <ConnItem key={c.nodeId} c={c} onClick={() => selectNode(c.nodeId)} />
        ))}
      </Section>

      {unwritten.length > 0 && (
        <Section title={o.unwritten} count={unwritten.length}>
          {unwritten.map((name) => (
            <li key={name} className="px-2 py-1 text-[#a882ff]/50">
              {name}
            </li>
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  count,
  empty,
  children,
}: {
  title: string;
  count: number;
  empty?: string;
  children: ReactNode;
}) {
  return (
    <div className="mt-5 border-t border-border-subtle pt-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">
        {title} <span className="text-text-muted/70">{count}</span>
      </div>
      {count === 0 && empty ? (
        <div className="text-xs text-text-muted/70 px-2">{empty}</div>
      ) : (
        <ul className="space-y-0.5">{children}</ul>
      )}
    </div>
  );
}

function Item({ name, file, meta, onClick }: { name: string; file?: string; meta: string; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left flex items-baseline gap-2 rounded px-2 py-1 hover:bg-elevated"
      >
        <span className={`${LINK_COLOR} truncate`}>{name}</span>
        {file && <span className="shrink-0 text-[10px] text-text-muted/70">{file}</span>}
        <span className="ml-auto shrink-0 text-[10px] text-text-muted">{meta}</span>
      </button>
    </li>
  );
}

function ConnItem({ c, onClick }: { c: Connection; onClick: () => void }) {
  return <Item name={c.name} file={c.file} meta={edgeLabel(c.edgeTypes)} onClick={onClick} />;
}

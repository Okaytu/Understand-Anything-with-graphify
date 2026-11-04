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
  fileConnectionsOf,
  isFileNode,
  edgeLabel,
  splitWikilinks,
  type Connection,
} from "../utils/obsidian-graph";
import { complexityOf, firstSentence } from "../utils/learn";

const COMPLEXITY_DOT = { simple: "bg-emerald-400", moderate: "bg-amber-400", complex: "bg-rose-400" } as const;

const NODE_HREF = "#ua-node=";
const MISSING_HREF = "#ua-missing";
const LINK_COLOR = "text-accent";

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
    () =>
      graph && node
        ? isFileNode(node)
          ? fileConnectionsOf(graph, node.id)
          : connectionsOf(graph, node.id, { skipContains: true })
        : null,
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
    : [node.summary]
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
          <span className="text-accent/60 underline decoration-dotted" title={o.unwritten}>
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
        <code className="bg-elevated rounded px-1 py-0.5 text-[12px] text-text-primary">{children}</code>
      ),
    table: ({ children }) => <table className="mb-3 text-xs border-collapse">{children}</table>,
    th: ({ children }) => <th className="border border-border-subtle px-2 py-1 text-left">{children}</th>,
    td: ({ children }) => <td className="border border-border-subtle px-2 py-1">{children}</td>,
  };

  // the converter's own bookkeeping tags mean nothing to a reader
  const shownTags = node.tags.filter((tag) => !/^(graphify|explained|explanation-outdated|code|concept|community:|confidence:)/.test(tag));
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
          className="mb-4 px-3 py-1.5 rounded-lg border border-border-medium bg-elevated text-sm font-semibold text-text-primary hover:bg-surface"
        >
          ← {t.common.back}
        </button>
      )}

      <h1 className="text-2xl font-semibold text-text-primary leading-tight break-words">{node.name}</h1>
      <div className="mt-1 text-xs text-text-muted flex flex-wrap gap-x-2">
        <span className="">{node.type}</span>
        {category && <span>· {category}</span>}
        {location && <span className="font-mono break-all">· {location}</span>}
      </div>
      {node.filePath && node.type !== "article" && (
        <div className="mt-2 inline-flex items-center gap-2 text-sm text-text-secondary">
          <span className={`w-2.5 h-2.5 rounded-full ${COMPLEXITY_DOT[complexityOf(node)]}`} aria-hidden />
          {t.learnMode[complexityOf(node)]}
        </div>
      )}

      {shownTags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {shownTags.map((tag) => (
            <span key={tag} className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] text-accent">
              #{tag}
            </span>
          ))}
        </div>
      )}

      {node.filePath && node.type !== "article" && (
        <button
          type="button"
          onClick={() => openCodeViewer(node.id)}
          className="mt-3 h-9 rounded-lg border border-border-medium px-4 text-sm text-text-primary hover:bg-elevated"
        >
          {t.common.openCode}
        </button>
      )}

      <div className="mt-4 border-t border-border-subtle pt-4">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {wikilinksToMarkdown(body, nameIndex)}
        </ReactMarkdown>
      </div>

      {node.languageNotes && (
        <aside className="mt-4 border-l-4 border-accent/60 bg-accent/5 rounded-r-lg px-4 py-3">
          <div className="text-sm font-semibold text-accent">{t.learnMode.languageConcept}</div>
          <p className="mt-1 text-sm leading-relaxed text-text-secondary">{node.languageNotes}</p>
        </aside>
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

      {defined.length > 0 && (
        <Section title={o.defined} count={defined.length}>
          {defined.map((c) => (
            <Item
              key={c.id}
              name={c.name}
              meta={c.type}
              why={c.summary ? firstSentence(c.summary) : undefined}
              onClick={() => selectNode(c.id)}
            />
          ))}
        </Section>
      )}

      {unwritten.length > 0 && (
        <Section title={o.unwritten} count={unwritten.length}>
          {unwritten.map((name) => (
            <li key={name} className="px-2 py-1 text-accent/60">
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
      <div className="text-sm font-semibold text-text-muted mb-1.5">
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

function Item({
  name,
  file,
  meta,
  why,
  via,
  onClick,
}: {
  name: string;
  file?: string;
  meta: string;
  why?: string;
  via?: string[];
  onClick: () => void;
}) {
  return (
    <li>
      <button type="button" onClick={onClick} className="w-full text-left rounded px-2 py-1 hover:bg-elevated">
        <span className="flex items-baseline gap-2">
          <span className={`${LINK_COLOR} truncate`}>{name}</span>
          {file && <span className="shrink-0 text-[10px] text-text-muted/70">{file}</span>}
          <span className="ml-auto shrink-0 text-[10px] text-text-muted">{meta}</span>
        </span>
        {why && <span className="block text-[12px] leading-snug text-text-secondary mt-0.5">{why}</span>}
        {via && via.length > 0 && (
          <span className="block text-[10px] text-text-muted/70 mt-0.5 truncate">via {via.join(", ")}</span>
        )}
      </button>
    </li>
  );
}

function ConnItem({ c, onClick }: { c: Connection; onClick: () => void }) {
  return <Item name={c.name} file={c.file} meta={edgeLabel(c.edgeTypes)} why={c.why} via={c.via} onClick={onClick} />;
}

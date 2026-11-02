#!/usr/bin/env node
// Validate a knowledge-graph.json with Understand-Anything's own validateGraph()
// — the exact function the dashboard runs on load — so a converted graph is
// checked against the real schema, not a copy of it.
//
//   node bridge/validate_ua_graph.mjs <path/to/knowledge-graph.json>
//
// Needs the core package built once:
//   pnpm --dir understand-anything --filter @understand-anything/core build
//
// Exit codes: 0 valid with nothing dropped, 1 fatal or something dropped, 2 usage/setup error.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaJs = path.resolve(
  here,
  "../understand-anything/understand-anything-plugin/packages/core/dist/schema.js",
);

const graphPath = process.argv[2];
if (!graphPath) {
  console.error("usage: node bridge/validate_ua_graph.mjs <knowledge-graph.json>");
  process.exit(2);
}
if (!fs.existsSync(schemaJs)) {
  console.error(`core is not built (missing ${schemaJs}).`);
  console.error("run: pnpm --dir understand-anything --filter @understand-anything/core build");
  process.exit(2);
}

const { validateGraph } = await import(pathToFileURL(schemaJs).href);
const data = JSON.parse(fs.readFileSync(graphPath, "utf8"));
const result = validateGraph(data);

const counts = {};
for (const issue of result.issues ?? []) counts[issue.level] = (counts[issue.level] ?? 0) + 1;

if (!result.success) {
  console.error(`INVALID: ${result.fatal ?? "unknown error"}`);
  process.exit(1);
}

const g = result.data;
console.log(
  `valid: ${g.nodes.length} nodes, ${g.edges.length} edges, ${g.layers.length} layers, ${g.tour.length} tour steps`,
);
if (Object.keys(counts).length) console.log(`issues: ${JSON.stringify(counts)}`);
const dropped = (result.issues ?? []).filter((i) => i.level === "dropped");
for (const issue of dropped.slice(0, 10)) console.error(`  dropped: ${issue.message}`);
process.exit(dropped.length ? 1 : 0);

import fs from "node:fs";
import { createServer, request as httpRequest, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGraphifyPageMiddleware } from "../../vite.config";

interface PageResult {
  status: number;
  body: string;
  type: string | null;
  referrer: string | null;
}

let tempProject: string;
let originalGraphDir: string | undefined;
let restoreCwd: (() => void) | undefined;
const servers: Server[] = [];

async function start(token: string): Promise<string> {
  const middleware = createGraphifyPageMiddleware(token);
  const server = createServer((req, res) =>
    middleware(req, res, () => {
      res.statusCode = 418;
      res.end("next");
    }),
  );
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return `http://127.0.0.1:${address.port}`;
}

function get(url: string): Promise<PageResult> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8"),
          type: res.headers["content-type"] ?? null,
          referrer: (res.headers["referrer-policy"] as string | undefined) ?? null,
        }),
      );
    });
    req.once("error", reject);
    req.end();
  });
}

beforeEach(() => {
  originalGraphDir = process.env.GRAPH_DIR;
  tempProject = fs.mkdtempSync(path.join(os.tmpdir(), "ua-graphify-page-"));
  process.env.GRAPH_DIR = tempProject;
  // keep the cwd fallbacks inside the fixture so a real project's map can't answer
  const fixtureCwd = path.join(tempProject, "runtime", "a", "b");
  fs.mkdirSync(fixtureCwd, { recursive: true });
  const cwd = vi.spyOn(process, "cwd").mockReturnValue(fixtureCwd);
  restoreCwd = () => cwd.mockRestore();
});

afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()));
  restoreCwd?.();
  if (originalGraphDir === undefined) delete process.env.GRAPH_DIR;
  else process.env.GRAPH_DIR = originalGraphDir;
  fs.rmSync(tempProject, { recursive: true, force: true });
});

describe("graphify page inside the dashboard", () => {
  it("refuses a request without the token", async () => {
    const base = await start("secret");
    const res = await get(`${base}/graphify/graph.html`);
    expect(res.status).toBe(403);
    expect(res.referrer).toBe("no-referrer");
  });

  it("serves graph.html with the token", async () => {
    fs.mkdirSync(path.join(tempProject, "graphify-out"));
    fs.writeFileSync(path.join(tempProject, "graphify-out", "graph.html"), "<html>map</html>");
    const base = await start("secret");
    const res = await get(`${base}/graphify/graph.html?token=secret`);
    expect(res.status).toBe(200);
    expect(res.body).toBe("<html>map</html>");
    expect(res.type).toContain("text/html");
  });

  it("explains how to make the map when there is none", async () => {
    const base = await start("secret");
    const res = await get(`${base}/graphify/graph.html?token=secret`);
    expect(res.status).toBe(404);
    expect(res.body).toContain("No graphify map yet");
  });

  it("leaves other paths alone", async () => {
    const base = await start("secret");
    expect((await get(`${base}/other`)).status).toBe(418);
  });
});

import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const snapshots = await mkdtemp(path.join(tmpdir(), "yuimi-render-budget-"));
const mock = http.createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  response.setHeader("Content-Type", "application/json");
  if (url.pathname === "/api/articles") response.end(JSON.stringify({ items: [], total: 0, page: 1, per_page: 100 }));
  else { response.statusCode = 404; response.end("null"); }
});
const listen = (server) => new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
let frontend;
try {
  await listen(mock);
  const reservation = http.createServer();
  await listen(reservation);
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  frontend = spawn(process.execPath, [path.join(root, "dist/server/entry.mjs")], {
    cwd: root, env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), BLOG_API_URL: `http://127.0.0.1:${mock.address().port}`, ASTRO_NODE_LOGGING: "disabled" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  frontend.stdout.on("data", chunk => { logs += chunk; });
  frontend.stderr.on("data", chunk => { logs += chunk; });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (frontend.exitCode !== null) throw new Error(`Frontend stopped during build validation: ${logs}`);
    const response = await fetch(`${origin}/blog/`).catch(() => null);
    if (response?.ok) { ready = true; break; }
    if (response) throw new Error(`Runtime page failed (${response.status}): ${await response.text()}\n${logs}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error(`Frontend did not start: ${logs}`);
  for (const route of ["/", "/blog/", "/games/", "/projects/", "/about/", "/themes/fuyukawa-kagari/", "/themes/blank/"]) {
    const response = await fetch(`${origin}${route}`);
    if (!response.ok) throw new Error(`${route}: HTTP ${response.status}\n${logs}`);
    const filename = path.join(snapshots, route, "index.html");
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, await response.text());
  }
  const check = spawn(process.execPath, [path.join(root, "scripts/check-performance-budgets.mjs")], {
    cwd: root, env: { ...process.env, YUIMI_BUDGET_HTML_DIR: snapshots }, stdio: "inherit",
  });
  const [code] = await once(check, "exit");
  if (code !== 0) throw new Error("Runtime performance budgets failed");
} finally {
  if (frontend && frontend.exitCode === null) { frontend.kill("SIGTERM"); await once(frontend, "exit"); }
  mock.closeAllConnections();
  await new Promise(resolve => mock.close(resolve));
  await rm(snapshots, { recursive: true, force: true });
}

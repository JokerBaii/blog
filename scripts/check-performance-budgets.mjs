import { readFile, readdir, stat } from "node:fs/promises";
import { excludedPublicMedia } from "./lib/media-publish-policy.mjs";

const distDir = new URL("../dist/client/", import.meta.url);
const htmlDir = process.env.YUIMI_BUDGET_HTML_DIR ? new URL(`file://${process.env.YUIMI_BUDGET_HTML_DIR}/`) : distDir;
const astroDir = new URL("_astro/", distDir);
const failures = [];

const fileBudgets = [
  ["Home HTML", "index.html", 100_000],
  ["Blog HTML", "blog/index.html", 155_000],
  ["Daily Links HTML", "games/index.html", 100_000],
  ["Works HTML", "projects/index.html", 198_000],
  ["About HTML", "about/index.html", 149_000],
  ["Fuyukawa Home HTML", "themes/fuyukawa-kagari/index.html", 100_000],
  ["Blank Home HTML", "themes/blank/index.html", 80_000]
];

const stylesheetBudgets = [
  ["Home CSS", "index.html", 112_000],
  ["Blog CSS", "blog/index.html", 220_000],
  ["Daily Links CSS", "games/index.html", 160_000],
  ["Works CSS", "projects/index.html", 255_000],
  ["About CSS", "about/index.html", 260_000],
  ["Fuyukawa Home CSS", "themes/fuyukawa-kagari/index.html", 112_000],
  ["Blank Home CSS", "themes/blank/index.html", 100_000]
];

const formatBytes = (value) => `${(value / 1024).toFixed(1)} KiB`;

const recordBudget = (label, size, limit) => {
  const passed = size <= limit;
  console.log(`${passed ? "PASS" : "FAIL"} ${label}: ${formatBytes(size)} / ${formatBytes(limit)}`);
  if (!passed) failures.push(`${label} exceeded its budget by ${formatBytes(size - limit)}`);
};

for (const [label, relativePath, limit] of fileBudgets) {
  try {
    const details = await stat(new URL(relativePath, relativePath.endsWith(".html") ? htmlDir : distDir));
    recordBudget(label, details.size, limit);
  } catch {
    failures.push(`${label} is missing: dist/${relativePath}`);
  }
}

for (const [label, relativePath, limit] of stylesheetBudgets) {
  try {
    const html = await readFile(new URL(relativePath, htmlDir), "utf8");
    const stylesheetPaths = [...html.matchAll(/href="(\/[^"?]+\.css)(?:\?[^\"]*)?"/g)]
      .map((match) => match[1]);
    const uniquePaths = [...new Set(stylesheetPaths)];
    if (uniquePaths.length === 0) throw new Error("no stylesheets found");
    const sizes = await Promise.all(uniquePaths.map((name) => stat(new URL(name.slice(1), distDir))));
    recordBudget(label, sizes.reduce((total, details) => total + details.size, 0), limit);
  } catch (error) {
    failures.push(`${label} could not be measured: ${error.message}`);
  }
}

let astroFiles = [];
try {
  astroFiles = await readdir(astroDir);
} catch {
  failures.push("dist/_astro is missing");
}

// Bound every shipped browser module, including the deferred effect library.
const browserModules = astroFiles.filter(name => name.endsWith(".js"));
if (browserModules.length === 0) failures.push("No browser modules were emitted");
let scriptBytes = 0;
for (const name of browserModules) {
  const details = await stat(new URL(name, astroDir));
  scriptBytes += details.size;
  if (details.size > 550_000) failures.push(`Browser module exceeds 550 KB: ${name}`);
}
recordBudget("All browser modules", scriptBytes, 1_000_000);

try {
  const covers = JSON.parse(await readFile(new URL("../src/core/content/responsive-covers.json", import.meta.url), "utf8"));
  let bytes = 0;
  let smallBytes = 0;
  let originalBytes = 0;
  for (const [source, cover] of Object.entries(covers)) {
    originalBytes += (await stat(new URL(source.slice(1), distDir))).size;
    smallBytes += cover.variants[0]?.bytes ?? 0;
    for (const variant of cover.variants) {
      const published = await stat(new URL(variant.src.slice(1), distDir));
      if (published.size !== variant.bytes) failures.push(`Responsive cover size mismatch: ${variant.src}`);
      bytes += published.size;
    }
  }
  recordBudget("Responsive cover derivatives", bytes, 5_000_000);
  recordBudget("Small covers versus originals", smallBytes, Math.floor(originalBytes * 0.4));
  for (const relative of excludedPublicMedia) {
    try {
      await stat(new URL(relative, distDir));
      failures.push(`Reviewed source media leaked into the build: ${relative}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
} catch (error) {
  failures.push(`Published media validation failed: ${error.message}`);
}

if (failures.length > 0) {
  console.error("\nPerformance budget violations:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("\nAll performance budgets passed.");
}

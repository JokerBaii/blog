import { lstat, readFile, readdir, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { excludedPublicMedia } from "./lib/media-publish-policy.mjs";

const workspace = fileURLToPath(new URL("../", import.meta.url));
const dist = path.join(workspace, "dist", "client");
const publicRoot = path.join(workspace, "public");
const within = (root, target) => {
  const relative = path.relative(root, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
};

export async function prunePublishedMedia(root = dist, exclusions = excludedPublicMedia) {
  const resolvedRoot = await realpath(root);
  // This command is deliberately tied to build output, never the source directory.
  if (resolvedRoot !== path.resolve(dist) || resolvedRoot === await realpath(publicRoot)) {
    throw new Error("Refusing to prune outside the workspace dist directory");
  }
  const documents = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error(`Symlink in build output: ${entry.name}`);
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(filename);
      else if (/\.(html|css|js|mjs|json|svg|xml|txt)$/i.test(entry.name)) {
        documents.push([filename, await readFile(filename, "utf8")]);
      }
    }
  }
  await walk(resolvedRoot);
  const planned = await planMediaExclusions(resolvedRoot, documents, exclusions);
  // Validate the entire plan before removing any generated file.
  for (const item of planned) await unlink(item.target);
  const bytes = planned.reduce((sum, item) => sum + item.bytes, 0);
  console.log(`Publish media: excluded ${planned.length} reviewed files, ${(bytes / 1048576).toFixed(2)} MiB; public originals retained.`);
  return { files: planned.length, bytes };
}

export async function planMediaExclusions(resolvedRoot, documents, exclusions) {
  const planned = [];
  for (const relative of exclusions) {
    const target = path.resolve(resolvedRoot, relative);
    if (!within(resolvedRoot, target)) throw new Error(`Unsafe media path: ${relative}`);
    let info;
    try { info = await lstat(target); } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (!info.isFile() || !within(resolvedRoot, await realpath(target))) {
      throw new Error(`Not a regular build file: ${relative}`);
    }
    // Check basenames too: catches relative and escaped-URL references conservatively.
    const name = path.basename(relative);
    const referenced = documents.find(([, content]) => content.includes(name) || content.includes(encodeURIComponent(name)));
    if (referenced) throw new Error(`Excluded media still referenced: ${relative} in ${referenced[0]}`);
    planned.push({ target, bytes: info.size });
  }
  return planned;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prunePublishedMedia();

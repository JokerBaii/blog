import { readdir, readFile, stat } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SourceTextModule } from "node:vm";

const root = resolve(process.argv[2] ?? fileURLToPath(new URL("../dist/client/", import.meta.url)));
const directory = resolve(root, "_astro");
const names = (await readdir(directory)).filter(name => name.endsWith(".js"));
if (!names.length) throw new Error("No built JavaScript modules found");
let imports = 0;

// Parse without evaluating browser code. Raw ?url assets can retain broken imports.
for (const name of names) {
  const file = resolve(directory, name);
  const module = new SourceTextModule(await readFile(file, "utf8"), { identifier: file });
  for (const specifier of module.dependencySpecifiers) {
    if (/^https?:\/\//.test(specifier)) continue;
    if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
      throw new Error(`${name}: unresolved bare import ${specifier}`);
    }
    const target = specifier.startsWith("/")
      ? new URL(`.${specifier}`, pathToFileURL(`${root}/`))
      : new URL(specifier, pathToFileURL(file));
    const path = fileURLToPath(target);
    const withinRoot = relative(root, path);
    if (withinRoot.startsWith("..") || isAbsolute(withinRoot) || !path.endsWith(".js")) {
      throw new Error(`${name}: invalid browser module ${specifier}`);
    }
    if (!(await stat(path).catch(() => null))?.isFile()) {
      throw new Error(`${name}: missing module ${specifier}`);
    }
    imports++;
  }
}
console.log(`PASS built modules: ${names.length} parsed, ${imports} local static imports resolved`);

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { publicRedirectsFromRegistry, validateRegistry } from "../marketing/sticker-studio/registry-core.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const source = resolve(repoRoot, "marketing/sticker-data/registry.json");
const destination = resolve(repoRoot, "data/sticker-redirects.json");
const registry = validateRegistry(JSON.parse(await readFile(source, "utf8")));
const publicRegistry = publicRedirectsFromRegistry(registry);
let currentRegistry = null;
try {
  currentRegistry = JSON.parse(await readFile(destination, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
const currentSemantic = currentRegistry
  ? { ...currentRegistry, generatedAt: null }
  : null;
const nextSemantic = { ...publicRegistry, generatedAt: null };
if (currentRegistry && JSON.stringify(currentSemantic) === JSON.stringify(nextSemantic)) {
  console.log(
    `Unchanged ${destination} (${Object.keys(publicRegistry.redirects).length} redirects)`,
  );
} else {
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(publicRegistry, null, 2)}\n`, "utf8");
  await rename(temporary, destination);
  console.log(
    `Wrote ${destination} (${Object.keys(publicRegistry.redirects).length} redirects)`,
  );
}

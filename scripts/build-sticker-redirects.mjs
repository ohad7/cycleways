import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { publicRedirectsFromRegistry, validateRegistry } from "../marketing/sticker-studio/registry-core.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const source = resolve(repoRoot, "marketing/sticker-data/registry.json");
const destination = resolve(repoRoot, "data/sticker-redirects.json");
const registry = validateRegistry(JSON.parse(await readFile(source, "utf8")));
const publicRegistry = publicRedirectsFromRegistry(registry);
await mkdir(dirname(destination), { recursive: true });
const temporary = `${destination}.${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(publicRegistry, null, 2)}\n`, "utf8");
await rename(temporary, destination);
console.log(`Wrote ${destination} (${Object.keys(publicRegistry.redirects).length} redirects)`);

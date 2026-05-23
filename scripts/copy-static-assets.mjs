import { cp, copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const distDir = resolve(repoRoot, "dist");

const files = new Set([
  "CNAME",
  "robots.txt",
  "sitemap.xml",
  "route-manager.js",
]);

const directories = ["attached_assets", "icons", "public-data"];

await mkdir(distDir, { recursive: true });

for (const filePath of files) {
  const source = resolve(repoRoot, filePath);
  if (!existsSync(source)) {
    console.warn(`Skipping missing static asset: ${filePath}`);
    continue;
  }

  const destination = resolve(distDir, filePath);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
  console.log(`Copied ${filePath}`);
}

for (const directoryPath of directories) {
  const source = resolve(repoRoot, directoryPath);
  if (!existsSync(source)) {
    console.warn(`Skipping missing static directory: ${directoryPath}`);
    continue;
  }

  await cp(source, resolve(distDir, directoryPath), {
    recursive: true,
    force: true,
  });
  console.log(`Copied ${directoryPath}/`);
}

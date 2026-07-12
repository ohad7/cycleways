import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import sharp from "sharp";
import {
  emptyRegistry,
  publicRedirectsFromRegistry,
  recordScan,
  validateRegistry,
} from "./registry-core.mjs";

let atomicCounter = 0;

export function createRegistryStore({ registryPath, redirectsPath, photosDir }) {
  return {
    async load() {
      try {
        return validateRegistry(JSON.parse(await readFile(registryPath, "utf8")));
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        const initial = emptyRegistry();
        await atomicJsonWrite(registryPath, initial);
        await atomicJsonWrite(redirectsPath, publicRedirectsFromRegistry(initial));
        return initial;
      }
    },

    async save(candidate, expectedRevision) {
      validateRegistry(candidate);
      const current = await this.load();
      if (Number(expectedRevision) !== current.revision) {
        const conflict = new Error(`Registry changed from revision ${expectedRevision} to ${current.revision}. Reload before saving.`);
        conflict.statusCode = 409;
        throw conflict;
      }
      const now = new Date().toISOString();
      const next = structuredClone(candidate);
      next.revision = current.revision + 1;
      next.updatedAt = now;
      validateRegistry(next);
      await mkdir(dirname(registryPath), { recursive: true });
      try { await copyFile(registryPath, `${registryPath}.bak`); } catch (error) { if (error?.code !== "ENOENT") throw error; }
      await atomicJsonWrite(registryPath, next);
      await atomicJsonWrite(redirectsPath, publicRedirectsFromRegistry(next, now));
      return next;
    },

    async scan(shortCode) {
      const current = await this.load();
      recordScan(current, shortCode);
      return this.save(current, current.revision);
    },

    async savePhoto({ placementId, filename, dataUrl }) {
      if (!/^plc-[a-z0-9-]+$/i.test(placementId)) throw new Error("Invalid placement ID.");
      const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || "");
      if (!match) throw new Error("Photo must be a JPEG, PNG, or WebP data URL.");
      const buffer = Buffer.from(match[2], "base64");
      if (buffer.length > 8 * 1024 * 1024) throw new Error("Photo is larger than 8 MB.");
      const directory = resolve(photosDir, placementId);
      await mkdir(directory, { recursive: true });
      const safeStem = `${Date.now()}-${String(filename || "photo").replace(extname(filename || ""), "").replace(/[^a-z0-9-]+/gi, "-").slice(0, 48)}`;
      const fullPath = join(directory, `${safeStem}.webp`);
      const thumbPath = join(directory, `${safeStem}-thumb.webp`);
      await sharp(buffer).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toFile(fullPath);
      await sharp(buffer).rotate().resize({ width: 420, height: 420, fit: "inside", withoutEnlargement: true }).webp({ quality: 76 }).toFile(thumbPath);
      const relativeBase = `/marketing/sticker-data/photos/${placementId}/${safeStem}`;
      return { full: `${relativeBase}.webp`, thumbnail: `${relativeBase}-thumb.webp` };
    },
  };
}

async function atomicJsonWrite(target, value) {
  await mkdir(dirname(target), { recursive: true });
  atomicCounter += 1;
  const temporary = `${target}.${process.pid}.${Date.now()}.${atomicCounter}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

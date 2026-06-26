import { Asset } from "expo-asset";
import { File } from "expo-file-system";
import {
  BINARY_ASSETS,
  IMAGE_ASSETS,
  JSON_ASSETS,
} from "./bundledAssets.native.js";

// Returns a React Native Image `source` (the bundled require module) for a
// logical image path like "public-data/poi-images/foo-thumb.webp", or null when
// the image was not bundled. Native counterpart of the web getImageAsset.
export function getImageAsset(filePath) {
  if (!filePath) return null;
  const key = normalizeLogicalPath(String(filePath));
  return IMAGE_ASSETS?.[key] ?? null;
}

const BUNDLED_BASE_HREF = "cycleways:///";
const binaryAssetPromises = new Map();

export function resolveAssetPath(filePath, basePath = null) {
  const path = String(filePath);
  if (!basePath || path.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(path)) {
    return path;
  }
  const base = String(basePath).split("?")[0];
  const lastSlash = base.lastIndexOf("/");
  if (lastSlash < 0) {
    return path;
  }
  return `${base.slice(0, lastSlash + 1)}${path}`;
}

export async function getJsonAsset(filePath, { basePath = null } = {}) {
  const key = normalizeLogicalPath(resolveAssetPath(filePath, basePath));
  const asset = JSON_ASSETS[key];
  if (asset === undefined) {
    throw new Error(`${key}: bundled JSON asset not found`);
  }
  return cloneJsonAsset(asset);
}

export async function getBinaryAsset(relativePath, { baseHref } = {}) {
  const key = normalizeBinaryPath(relativePath, baseHref);
  const assetModule = BINARY_ASSETS[key];
  if (assetModule === undefined) {
    throw new Error(`${key}: bundled binary asset not found`);
  }

  if (!binaryAssetPromises.has(key)) {
    binaryAssetPromises.set(key, readBundledBinaryAsset(assetModule));
  }
  return binaryAssetPromises.get(key);
}

function normalizeBinaryPath(relativePath, baseHref = BUNDLED_BASE_HREF) {
  const url = new URL(String(relativePath), baseHref || BUNDLED_BASE_HREF);
  return normalizeLogicalPath(url.pathname);
}

function normalizeLogicalPath(filePath) {
  const withoutHash = String(filePath).split("#")[0];
  const withoutQuery = withoutHash.split("?")[0];
  return withoutQuery.replace(/^\/+/, "");
}

function cloneJsonAsset(asset) {
  const value = asset?.default ?? asset;
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

async function readBundledBinaryAsset(assetModule) {
  const asset = Asset.fromModule(assetModule);
  await asset.downloadAsync();
  const uri = asset.localUri || asset.uri;
  if (!uri) {
    throw new Error(`Bundled asset ${asset.name}.${asset.type} has no URI`);
  }
  const file = new File(uri);
  return file.arrayBuffer();
}

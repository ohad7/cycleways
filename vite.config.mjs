import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createGzip } from "node:zlib";
import { defineConfig } from "vite";

const repoRoot = dirname(fileURLToPath(import.meta.url));
const localTokenPath = resolve(repoRoot, "mapbox-token.js");
const gzipStaticExtensions = new Set([".cwb", ".geojson", ".json", ".msgpack"]);
const gzipStaticMinBytes = 1024;
// route-manager.js is authored as CommonJS (`module.exports = RouteManager`)
// because the same file is shared verbatim with the Node test suite, the editor
// server, and CLI scripts via require(). For the browser/React Native bundle we
// expose its class as an ESM default export so
// `import RouteManager from "../route-manager.js"` resolves in both dev
// (esbuild) and build (Rollup). The on-disk source stays CommonJS.
function routeManagerEsmPlugin() {
  return {
    name: "route-manager-esm",
    enforce: "pre",
    transform(code, id) {
      if (!id.split("?")[0].endsWith("/route-manager.js")) return null;
      if (!/module\.exports\s*=\s*RouteManager;/.test(code)) {
        throw new Error(
          "route-manager-esm: `module.exports = RouteManager;` marker not found",
        );
      }
      // Convert the default export, then any `module.exports.NAME = VALUE;`
      // named exports (e.g. `buildSegmentSpans`). Without this the named-export
      // lines reference the undefined `module` global at runtime in the browser.
      // Also convert any top-level `const { A, B } = require("./relative.js");`
      // destructuring requires of sibling core modules (e.g. connectorCostModel)
      // into real static imports — the browser has no `require` global, and
      // dev-serve does not bundle/transform this file's internal requires the
      // way Rollup does for the production build.
      const esm = code
        .replace(
          /module\.exports\s*=\s*RouteManager;/,
          "export default RouteManager;",
        )
        .replace(
          /module\.exports\.(\w+)\s*=\s*(\w+);/g,
          "export { $2 as $1 };",
        )
        .replace(
          /const\s*\{([^}]+)\}\s*=\s*require\((["'])(\.[^"']+)\2\);/g,
          "import {$1} from $2$3$2;",
        );
      return {
        code: esm,
        map: null,
      };
    },
  };
}

function mapboxTokenPlugin() {
  function serveMapboxToken(request, response, next) {
    const pathname = request.url?.split("?")[0];
    if (pathname !== "/mapbox-token.js") {
      next();
      return;
    }

    response.setHeader("Content-Type", "application/javascript; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");

    if (existsSync(localTokenPath)) {
      response.end(readFileSync(localTokenPath, "utf8"));
      return;
    }

    const token =
      process.env.MAPBOX_TOKEN || process.env.CYCLEWAYS_MAPBOX_TOKEN || "";

    if (token) {
      response.end(
        `window.CYCLEWAYS_MAPBOX_TOKEN = ${JSON.stringify(token)};\n`,
      );
      return;
    }

    response.end(
      [
        "window.CYCLEWAYS_MAPBOX_TOKEN = window.CYCLEWAYS_MAPBOX_TOKEN || '';",
        "console.warn('Mapbox token file not found. Copy mapbox-token.example.js to mapbox-token.js or set MAPBOX_TOKEN.');",
        "",
      ].join("\n"),
    );
  }

  return {
    name: "cycleways-mapbox-token",
    configureServer(server) {
      server.middlewares.use(serveMapboxToken);
    },
    configurePreviewServer(server) {
      server.middlewares.use(serveMapboxToken);
    },
  };
}

function gzipStaticJsonPlugin() {
  function resolveStaticPath(requestUrl) {
    const pathname = new URL(requestUrl || "/", "http://127.0.0.1").pathname;
    const decodedPathname = decodeURIComponent(pathname);
    const filePath = resolve(repoRoot, `.${decodedPathname}`);
    if (filePath !== repoRoot && !filePath.startsWith(`${repoRoot}${sep}`)) {
      return null;
    }
    return filePath;
  }

  function serveGzipStaticJson(request, response, next) {
    const acceptsGzip = /\bgzip\b/.test(request.headers["accept-encoding"] || "");
    if (!acceptsGzip || !["GET", "HEAD"].includes(request.method || "")) {
      next();
      return;
    }

    let filePath;
    try {
      filePath = resolveStaticPath(request.url);
    } catch {
      next();
      return;
    }

    if (!filePath || !gzipStaticExtensions.has(extname(filePath))) {
      next();
      return;
    }

    let fileStat;
    try {
      fileStat = statSync(filePath);
    } catch {
      next();
      return;
    }

    if (!fileStat.isFile() || fileStat.size < gzipStaticMinBytes) {
      next();
      return;
    }

    const extension = extname(filePath);
    const contentType =
      extension === ".geojson"
        ? "application/geo+json; charset=utf-8"
        : extension === ".cwb"
          ? "application/octet-stream"
        : extension === ".msgpack"
          ? "application/msgpack"
          : "application/json; charset=utf-8";
    response.statusCode = 200;
    response.setHeader("Content-Type", contentType);
    response.setHeader("Content-Encoding", "gzip");
    response.setHeader("Vary", "Accept-Encoding");
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("Last-Modified", fileStat.mtime.toUTCString());

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    createReadStream(filePath).pipe(createGzip()).pipe(response);
  }

  return {
    name: "cycleways-gzip-static-json",
    configureServer(server) {
      server.middlewares.use(serveGzipStaticJson);
    },
    configurePreviewServer(server) {
      server.middlewares.use(serveGzipStaticJson);
    },
  };
}

export default defineConfig({
  appType: "spa",
  plugins: [routeManagerEsmPlugin(), mapboxTokenPlugin(), gzipStaticJsonPlugin()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(repoRoot, "index.html"),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  preview: {
    port: 4173,
    strictPort: false,
  },
});

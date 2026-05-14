import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const repoRoot = dirname(fileURLToPath(import.meta.url));
const localTokenPath = resolve(repoRoot, "mapbox-token.js");

function mapboxTokenPlugin() {
  return {
    name: "cycleways-mapbox-token",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
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
      });
    },
  };
}

export default defineConfig({
  appType: "mpa",
  plugins: [mapboxTokenPlugin()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(repoRoot, "index.html"),
        react: resolve(repoRoot, "react.html"),
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

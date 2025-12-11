# Repository Guidelines

## Project Structure & Module Organization
- Client entry lives in `index.html`, `styles.css`, `script.js`, and `tutorial.*`; map icons sit under `icons/`.
- Core routing logic is in `route-manager.js` plus helpers in `utils/` (`distance.js`, `elevations.js`, `route-encoding.js`, `analytics.js`, `gpx-generator.js`).
- Data inputs: `segments.json`, `segments.txt`, and the `bike_roads_v*.geojson` files. Test fixtures reside in `tests/` alongside `test-route-manager.js`.
- Static assets (CNAME, sitemaps, robots) are in the repo root; no bundler or package manager is used.

## Build, Test, and Development Commands
- Local dev server: `python3 server.py` (serves the repo at http://localhost:8888). Alternatively `python3 -m http.server 8888` if you only need static hosting.
- Route manager tests: `node tests/test-route-manager.js` to run the demo/spec harness against mock data and JSON scenarios in `tests/`.
- Quick lint check: run `node -c route-manager.js` or the same for any helper to catch syntax errors (no configured linter).

## Coding Style & Naming Conventions
- JavaScript only; use ES2015+ where supported by browsers you target. Two-space indentation, trailing commas avoided for compatibility.
- Classes use `PascalCase` (`RouteManager`); methods, variables, and helpers use `camelCase`.
- Keep data keys stable with existing GeoJSON and segment metadata naming. Prefer pure functions in `utils/` and keep DOM concerns in `script.js`.
- Comment sparingly; document non-obvious algorithms (e.g., snapping, graph traversal) at the function level.

## Testing Guidelines
- Extend `tests/` with focused JSON scenarios; mirror the structure in `test-route-manager.js` (`operations`, `summary`) to validate routes, snapping, and metrics.
- For new utilities, add small harness scripts in `tests/` and run with `node` to keep parity with production usage (browser-compatible syntax only).
- When changing data files, rerun `node tests/test-route-manager.js` to confirm calculated routes and metrics still behave as expected.

## Commit & Pull Request Guidelines
- Use concise, imperative commit messages (`Add hover highlight thresholds`, `Fix endpoint graph weights`). Reference issue IDs when applicable.
- PRs should describe behavior changes, data updates, and test coverage. Include repro steps or screenshots/GIFs for UI changes and note any new data files.
- Keep diffs focused; split UI, data, and algorithm changes into separate commits when practical.

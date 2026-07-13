# CycleWays

## License

- **Code** — [GNU GPL-3.0](LICENSE). You may use, modify, and redistribute it,
  but derivative works must remain open source under the same license.
- **Map data** — the curated route data (`data/map-source.geojson` and the
  artifacts generated from it in `public-data/`, which the Build → Promote
  pipeline produces) is licensed separately under the
  [Open Database License (ODbL) 1.0](data/LICENSE). If you build on this data,
  you must attribute CycleWays and share your improvements under the same
  terms.
- **Name and logo** — the CycleWays name, logo, and app icons are *not*
  covered by these licenses and may not be used to represent forks or
  derivative apps.

## Local Development

Install dependencies once:

```sh
npm install
```

Start the public site dev server:

```sh
npm run dev
```

Vite serves the site at `http://127.0.0.1:5173/` and reloads browser assets when
HTML, CSS, JavaScript, or data files change.

For local Mapbox access, either copy the ignored token file:

```sh
cp mapbox-token.example.js mapbox-token.js
```

or start the dev server with `MAPBOX_TOKEN` or `CYCLEWAYS_MAPBOX_TOKEN` in the
environment. The dev server serves `/mapbox-token.js` from that local file or
environment variable.

## Adding a featured route

1. Create a JSX module at `src/featured/<slug>.jsx` that exports `meta`
   (slug, name, summary, encoded `route`, hero image) and a default
   React component using `<FeaturedRoute>` and its slot components
   (`<FeaturedRoute.Map />`, `<FeaturedRoute.POIs />`,
   `<FeaturedRoute.Gallery />`, `<FeaturedRoute.Video />`,
   `<FeaturedRoute.Warnings />`).
2. Place media under `public/images/featured/<slug>/`.
3. POIs along the route come from `segments.json`; add new segment-level
   POIs there with a stable `id` and `location`. New POI types are
   defined in `src/data/poiTypes.js`.
4. The route appears automatically at `/featured/<slug>` and in the
   `/featured` gallery on next dev/build.

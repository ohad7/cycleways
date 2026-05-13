# CycleWays

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

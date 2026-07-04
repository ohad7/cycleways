# iOS Featured Route Web Embed — Design

Date: 2026-07-01 (updated 2026-07-05)

## Goal

Keep the bundled featured-route WebView for content parity and offline route
content, while making it behave like an app-owned screen rather than a second
website loading inside the iOS application.

## Decisions

- Warm the bundled static server after the initial native interaction settles.
- Load featured route detail pages only from the bundled local static server,
  not from the production website. This keeps app behavior tied to the shipped
  bundle and avoids mixing native app versions with newer public web code.
- Do not silently fall back to the old native route detail page when the WebView
  cannot load. Restart the local server and retry once; if that still fails,
  show an explicit retry/back error state.
- Keep `?app=1` as the explicit embed contract.
- Never paint the website loading splash in embed mode; the native screen owns
  loading feedback.
- Omit both global site navigation and featured-header breadcrumbs in embed
  mode.
- Have the featured route post a `ready` bridge event after its route data and
  React content have rendered. The native loader remains until this event, with
  a short load-event fallback so a bridge regression cannot trap the user.
- Skip website analytics in embed mode.
- Use a three-action embedded route row: Navigate is the sole filled primary
  action, with Edit and GPX as neutral secondary actions. The separate Play
  action remains web-only because playback is already available on the embedded
  media stage.
- Treat Navigate and Edit as distinct native intents. Navigate opens Build with
  the route token and an explicit ride-setup intent; Build asks for direction
  and starting point before any continuous navigation session begins. Edit
  opens the same route without opening ride setup.
- Preserve the normal public website behavior.
- Apply the iOS safe-area inset to the native WebView shell so the embedded
  route title and description begin below the status bar/Dynamic Island.
- Route GPX requests through the native bridge in embed mode. Native owns the
  share/save sheet; normal mobile web retains its browser download/share path.
- Restore a route in Build only after the routing manager reports ready. Show a
  bounded loading/error state and offer retry instead of silently losing an
  early route-load request.

## Validation

- Browser tests cover normal splash behavior, embedded splash suppression,
  embedded chrome removal, and the `ready` bridge event.
- Rebuild and synchronize the bundled `webroot` after changing web sources.
- Verify the Expo iOS JavaScript bundle after native bridge changes.
- Unit-test route restoration policy and assert that embedded GPX emits the
  native download bridge event.

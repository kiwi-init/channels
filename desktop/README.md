# Kiwi desktop app (Electron shell)

The app half of the 0.11 desktop plan (`docs/plans/desktop.md`, "The app"): it holds
the person key, every channel identity, and paired computers, and hosts `web/`'s build.

## Run

```sh
cd desktop && bun install && bun run start
```

This expects `../web/dist` built (`bun run web:build` in the repo root); without it the
window says so. Closing the window keeps the app in the tray (background auto-approval
+ notifications); Quit lives in the tray menu.

## Layout

- `src/main.ts` — window, tray, `kiwi-app://` hosting, safeStorage store, WorkOS device
  sign-in, pairing sessions, daemon ensure/adopt, `kiwi://join/<code>` links. Identity
  (`generateIdentity`) and pairing (`newSecret`/`pairCode`/`openMailbox`/`answerPair`)
  are imported from `src/` and bundled with `bun build`: one scheme, no copies.
- `src/preload.ts` — context-isolated `window.kiwi` (see `src/bridge.ts` for the shape).
- `src/bridge.ts` — the shared bridge type; renderer-neutral, no electron/node imports.
- `src/daemon-client.ts` — the local socket client (`hello`, `adopt`) and the JSON wire
  shape the daemon side must match (documented at the top of the file).

## Renderer relay URL

`web/` reads its relay from `location.origin` today. The app loads it from
`kiwi-app://app/index.html?relay=<url>` instead (plus `window.kiwi.relayUrl`); the small
web-side change to prefer that value is the renderer's step (4), not this shell's.

## Typecheck / build

```sh
cd desktop && bunx tsc --noEmit   # main + preload + bridge
bun run build                     # bun-built dist/main.js + dist/preload.js
bun run dist                      # electron-builder (mac dmg/zip, linux AppImage/deb; unsigned; no Windows app)
```

Release workflows stay untouched (a later step); packaging itself runs in CI.

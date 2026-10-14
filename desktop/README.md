# Kiwi desktop app (Electron shell)

The app half of 0.11: it holds the person key, every channel identity, and
paired computers, and hosts `web/`'s build. Admin lives here; the CLI is for
agents.

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
- `src/updater.ts` — checks GitHub releases for a newer app.
- `build/icon.svg` — the app icon. `bun desktop/scripts/icons.ts` (on a Mac) makes every
  size from it: `build/icon.icns`, `build/icons/NxN.png` for Linux, and `assets/icon.png`
  for the window. On Linux the window finds its icon through `desktopName` in
  `package.json`: Wayland matches the window's app_id to `kiwi-desktop.desktop`.

## Renderer relay URL

`web/` prefers `?relay=` on the app URL, then `window.kiwi.relayUrl`, then
`location.origin` when served by a relay. The app loads
`kiwi-app://app/index.html?relay=<url>`.

## Typecheck / build

```sh
cd desktop && bunx tsc --noEmit   # main + preload + bridge
bun run build                     # bun-built dist/main.js + dist/preload.js
bun run dist                      # electron-builder (mac dmg/zip, linux AppImage/deb)
```

The release workflow (`.github/workflows/release.yml`) builds those on each `v*` tag,
next to the CLI binaries. macOS is Developer ID signed and notarized when the repo
secrets are set; Linux is unsigned. There is no Windows app (the kiwi CLI still ships
for Windows).

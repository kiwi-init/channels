# Channels desktop app (Electron shell)

The app half of 0.11: it holds the person key, every channel identity, and
paired computers, and hosts `web/`'s build. Admin lives here; the CLI is for
agents.

## Run

```sh
bun install && cd desktop && bun run start
```

This expects `../web/dist` built (`bun run web:build` in the repo root); without it the
window says so. Closing the window keeps the app in the tray (background auto-approval
+ notifications); Quit lives in the tray menu.

## Electrobun shell (macOS, in progress)

The app is moving to Electrobun on the system web view (issue #757). Its shell lives next
to the Electron one and shares every module that doesn't import `electron`:

```sh
bun run web:build && cd desktop && bun run start:eb   # dev build, opened
bun run build:eb                                      # release-eb/: the stable build; scripts/eb-size.ts measures the plain .app we ship
bun run typecheck:eb                                  # fetches the devkit into .hutch/, then tsc
```

- `electrobun.config.ts` — Electrobun 2.0.4, pinned exact, `mainProcess: "bun"`. The
  `CHANNELS_EB_IDENTIFIER` variable gives a build its own bundle id, so it never shares
  state with an installed Channels; a `CHANNELS_EB_TEST=1` build is always
  `com.kiwiinit.channels.test`, on the dev channel only.
- `src/main-eb.ts` — the window. The page is `web/dist/index.html` with `csp(relay)` from
  `guard.ts` as a `<meta>` first in `<head>`, kept in memory and served at
  `views://internal/index.html` (Electrobun's scheme sends fixed headers, so no CSP header);
  the rest of `web/dist` is in the bundle under `views/internal/`. Navigation stays on
  `views://internal/*`; links and `window.open` go to the browser through `open.ts`.
- `native/macos/kiwi-shell.m` — built into the app by `scripts/eb-post-build.ts`: denies
  the microphone, camera and location that Electrobun's WebKit delegate grants our page,
  and sets the window's minimum size and background on the main thread.

## Layout

- `src/main.ts` — window, tray, `kiwi-app://` hosting, safeStorage store, WorkOS device
  sign-in, pairing sessions, daemon ensure/adopt, `kiwi://join/<code>` links. Identity
  (`generateIdentity`) and pairing (`newSecret`/`pairCode`/`openMailbox`/`answerPair`)
  are imported from `@kiwi/core` (`packages/core`) and bundled with `bun build`: one scheme,
  no copies.
- `src/preload.ts` — context-isolated `window.kiwi` (see `src/bridge.ts` for the shape).
- `src/bridge.ts` — the shared bridge type; renderer-neutral, no electron/node imports.
- `src/daemon-client.ts` — the local socket client (`hello`, `adopt`) and the JSON wire
  shape the daemon side must match (documented at the top of the file); starting the daemon
  on the app's relay (`spawnDaemon`).
- `src/updater.ts` — checks GitHub releases for a newer app.
- `src/move.ts` — moves a download over the file it replaces, across filesystems too (the
  AppImage update).
- `build/icon.svg` — the app icon. `bun desktop/scripts/icons.ts` (on a Mac) makes every
  size from it: `build/icon.icns`, `build/icons/NxN.png` for Linux, and `assets/icon.png`
  for the window. On Linux the window finds its icon through `desktopName` in
  `package.json`: Wayland matches the window's app_id to `channels-desktop.desktop`.

## Renderer relay URL

In the app, `web/` takes the relay from `window.kiwi.relayUrl` (main's store, through
the preload) and never from the page's URL: the sign-in token goes wherever the relay
is. The app loads `kiwi-app://app/index.html`. In a browser, `web/` takes `?relay=`,
else `location.origin` when served by a relay.

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

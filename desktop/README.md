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

- `scripts/eb.ts` — every Electrobun command goes through it (`start:eb`, `build:eb`,
  `typecheck:eb`). It runs only the Hutch whose archive and files `electrobun-pins.json`
  pins, downloaded from the pinned URL, so the npm shim never falls back to an unpinned
  installer. `eb-pre-build.ts` refuses a build that didn't start this way, or whose devkit
  (bundled into the main process) isn't the pinned one; `eb-post-build.ts` checks every
  Electrobun file that ships against its pin, and lets nothing unpinned into
  `Contents/MacOS`. A new Electrobun means new pins, reviewed like code.
- `electrobun.config.ts` — Electrobun 2.0.4, pinned exact, `mainProcess: "bun"`. A build
  is `com.kiwiinit.channels.dev` unless `CHANNELS_EB_RELEASE=1` (the release) or
  `CHANNELS_EB_IDENTIFIER` (a test's own id) says otherwise, so a local run never shares
  state with an installed Channels; a `CHANNELS_EB_TEST=1` build is always
  `com.kiwiinit.channels.test`, on the dev channel only.
- `src/main-eb.ts` — the window. The page is `web/dist/index.html` with `csp(relay)` from
  `guard.ts` as a `<meta>` first in `<head>` (found by the page's structure, and checked at
  build time), kept in memory and served at `views://internal/index.html` (Electrobun's
  scheme sends fixed headers, so no CSP header). The template sits outside `views/`, so no
  copy of the page is served without its CSP; the rest of `web/dist` is under
  `views/internal/`. Navigation stays on that one page (its hash and query); before the
  page loads, a canary navigation proves the rules took effect, and any navigation they
  should have refused closes the app. Links and `window.open` go to the browser through
  `open.ts`.
- `native/macos/kiwi-shell.m` — built into the app by `scripts/eb-post-build.ts`: denies
  the microphone, camera and location that Electrobun's WebKit delegate grants our page,
  lets only downloads of the page's own `blob:` and `data:` URLs through (Electrobun would
  save any download into Downloads, past the navigation rules), cancels every navigation
  but the page in Electrobun's own navigation delegate, before load (rules the page's
  internal RPC could change don't decide it), and sets the window's
  minimum size and background on the main thread. The shell opens no window if any of
  these patches can't apply.

- Release, Mac (`.github/workflows/release-build.yml`, job `desktop-mac-eb`): the plain
  `Channels.app` from the build's payload, signed with the Developer ID (Bun alone gets the
  JIT entitlements), notarized and stapled, as `Channels-<version>-mac-arm64.zip` (ditto,
  `Channels.app` at its root, the name the Electron app's updater asks for) and `.dmg`, each at
  most 40 MB (`scripts/eb-release.ts`). `scripts/eb-update-rehearsal.ts` installs the last
  Electron arm64 release and runs its updater's own steps on the new zip, then opens the
  swapped app. `scripts/eb-driver-check.ts --release` fails if the zip or the dmg carries
  test-only code, or if `CHANNELS_EB_TEST` is set. Every tag ships it; Intel Macs keep
  Electron's x64 build until a stable Electrobun ships darwin-x64. Never launch a release-id
  build on a Mac with Channels installed: macOS keeps its preferences and WebKit data under
  the real home whatever `HOME` says.

- Release, Linux (job `desktop-linux-eb`, on ubuntu-24.04, the oldest glibc it runs on):
  `Channels-<version>-linux-amd64.deb` and `Channels-<version>-linux-x86_64.AppImage`
  (`scripts/package-linux.ts`), checked by `eb-driver-check.ts --release`,
  `scripts/linux-packages-check.sh` and `scripts/linux-upgrade-check.sh` (the v0.26.0 Electron
  deb, then this one over it), and started under Xvfb.

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

The release workflow (`.github/workflows/release.yml`) ships Electron's build only for
Intel Macs (`Channels-<version>-mac-x64.zip` and `.dmg`), Developer ID signed and
notarized; Apple silicon and Linux get the Electrobun app above. There is no Windows app
(the kiwi CLI still ships for Windows).

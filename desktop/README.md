# Channels desktop app (Electrobun shell)

The app half of 0.11: it holds the person key, every channel identity, and
paired computers, and hosts `ui/`'s build. Admin lives here; the CLI is for
agents.

## Run

```sh
bun install && cd desktop && bun run start:eb
```

This expects `../ui/dist` built (`bun run ui:build` in the repo root); without it the
window says so. Closing the window keeps the app in the tray (background auto-approval
+ notifications); Quit lives in the tray menu.

## Electrobun shell

The app runs on Electrobun and the system web view (issue #757): WebKit on Apple silicon
Macs, WebKitGTK on Linux. Electron left the repo in T580; Intel Macs keep Electron's last
build (0.27.4), which no longer updates.

```sh
bun run ui:build && cd desktop && bun run start:eb   # dev build, opened
bun run build:eb                                      # release-eb/: the stable build; scripts/eb-size.ts measures the plain .app we ship
bun run typecheck:eb                                  # fetches the devkit into .hutch/, then tsrs
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
- `src/main-eb.ts` — only the order things start in: one instance, the native guards
  (`native-eb.ts`), the store (`store-open-eb.ts`), the keys Worker (`keys-start-eb.ts`), the
  window (`window-eb.ts`), the test build's driver (`test-build-eb.ts`), then app life and
  updates (`life-updates-eb.ts`). Each feature's wiring lives in its own module, so pull requests that
  add features don't all edit one file.
- `src/window-eb.ts` — the window. The page is `ui/dist/index.html` with `csp(relay)` from
  `guard.ts` as a `<meta>` first in `<head>` (found by the page's structure, and checked at
  build time), kept in memory and served at `views://internal/index.html` (Electrobun's
  scheme sends fixed headers, so no CSP header). The template sits outside `views/`, so no
  copy of the page is served without its CSP; the rest of `ui/dist` is under
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
  `Channels.app` at its root, the name the Electron app's updater asks for) and `.dmg`, the app at
  most 120 MB and each archive at most 60 MB (`scripts/eb-release.ts`). `scripts/eb-update-rehearsal.ts` installs the last
  Electron arm64 release and runs its updater's own steps on the new zip, then opens the
  swapped app. `scripts/eb-driver-check.ts --release` fails if the zip or the dmg carries
  test-only code, or if `CHANNELS_EB_TEST` is set. Every tag ships it; there is no Intel
  Mac build. Never launch a release-id
  build on a Mac with Channels installed: macOS keeps its preferences and WebKit data under
  the real home whatever `HOME` says.

- Release, Linux (job `desktop-linux-eb`, on ubuntu-24.04, the oldest glibc it runs on):
  `Channels-<version>-linux-x86_64.AppImage` only (`scripts/package-linux.ts`), checked by
  `eb-driver-check.ts --release` and `scripts/linux-packages-check.sh`, probed extracted
  (`scripts/package-probe.ts`) and started under Xvfb. Linux support is Arch only: there is
  no .deb, and CI checks the AppImage on a stock Arch container (`scripts/distro-check`).
  There is no pacman package either: it would lose the AppImage's self-update and gain
  nothing, since the app already uses Arch's own WebKitGTK.
  WebKitGTK plays sound through the system's GStreamer: without `gst-plugins-good`
  (`autoaudiosink`, `wavparse`) even making an `<audio>` element crashes its web process,
  so on Linux the UI plays the Needs-you chime through WebAudio, which stays silent instead.
  The distro check proves both.

## Layout

- Identity (`generateIdentity`) and pairing (`newSecret`/`pairCode`/`openMailbox`/`answerPair`)
  are imported from `@kiwi/core` (`packages/core`) and bundled into the app: one scheme, no
  copies.
- `src/preload-eb.ts` — the page's `window.kiwi` (see `src/bridge.ts` for the shape).
- `src/bridge.ts` — the shared bridge type; renderer-neutral, no node imports.
- `src/daemon-client.ts` — the local socket client (`hello`, `adopt`) and the JSON wire
  shape the daemon side must match (documented at the top of the file); starting the daemon
  on the app's relay (`spawnDaemon`).
- `src/updater.ts` — checks GitHub releases for a newer app.
- `src/linux-entry.ts` — on every start from an AppImage, keeps the person's
  `channels-desktop.desktop`, its hicolor icons and the `kiwi://` default pointed at that
  AppImage (the app menu, links and the dock badge need them); with no `fusermount` the
  entry extracts and runs it.
- `src/move.ts` — moves a download over the file it replaces, across filesystems too (the
  AppImage update).
- `build/icon.svg` — the app icon, and `build/tray.svg` — its one-color tray mark.
  `bun desktop/scripts/icons.ts` (on a Mac) makes every app size (`build/icon.icns`,
  `build/icons/NxN.png` for Linux, and `assets/icon.png` for the window), the macOS tray
  template PNGs, and Linux's `assets/channels-tray-symbolic.svg`. On Linux,
  `native/linux/kiwi-shell.c` names the program `channels-desktop`, so Wayland matches the
  window's app_id to `channels-desktop.desktop` and finds its icon.

## Renderer relay URL

In the app, `ui/` takes the relay from `window.kiwi.relayUrl` (main's store, through
the preload) and never from the page's URL: the sign-in token goes wherever the relay
is. The app loads `views://internal/index.html`. In a browser, `ui/` takes `?relay=`,
else `location.origin` when served by a relay.

## Typecheck / build

```sh
cd desktop && bunx tsrs --noEmit   # shared modules and scripts
bun run typecheck:eb              # the Electrobun shell (*-eb.ts)
bun run build:eb                  # release-eb/: the stable build
```

The release workflow (`.github/workflows/release.yml`) ships the Electrobun app above for
Apple silicon Macs and Linux. There is no Intel Mac or Windows app.

## Linux screenshots from a Mac (wlroots, as Hyprland runs it)

`scripts/wlroots-check/sway.sh` runs the test build in a Wayland-only headless sway, the
wlroots family Hyprland (Omarchy) belongs to, checks tiling, floating, scale 2 and closing,
and leaves a PNG of each state with `results.json` in the folder it is given. CI runs it on
Ubuntu 26.04 and keeps the PNGs as the `wlroots-check` artifact.

On an Apple silicon Mac, run it in an Ubuntu 26.04 arm64 VM (UTM or Lume). Hutch and the
devkit are pinned for linux-arm64, but no CI job builds there, so an arm64 build is the
first to try it.

```sh
sudo apt-get install -y libwebkit2gtk-4.1-dev libayatana-appindicator3-dev libpipewire-0.3-dev \
  bubblewrap xdg-dbus-proxy dbus sway grim python3-gi gir1.2-gtk-3.0 gir1.2-gdkpixbuf-2.0
bun install && bun run ui:build && bun scripts/build-cli.ts --js dist/kiwi.js
cd desktop && bun run prepare:eb && CHANNELS_EB_TEST=1 bun scripts/eb.ts build --env=dev && cd ..
bash desktop/scripts/wlroots-check/sway.sh desktop/release-eb/build/dev-linux-*/*/ /tmp/wlroots
```

An agent on the Mac runs the last line over `ssh` and copies `/tmp/wlroots/*.png` back with
`scp`. For Hyprland itself, an Omarchy VM on Arch Linux ARM:
https://cua.ai/docs/how-to-guides/lume/run-omarchy-arm64

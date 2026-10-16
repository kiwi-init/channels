# Plan: the desktop app on Electrobun (0.15)

> Owner's ask (2026-10-16): "i want 100mb MAX app size", then, on the options: replace Electron
> with the system webview, "no tauri", "this can be a pr we will work for several days on".
>
> Decided with the owner:
> 1. **Electrobun 2, system webview.** WKWebView on macOS, WebKitGTK 4.1 on Linux. No bundled
>    Chromium (CEF).
> 2. **Apple Silicon only.** Electrobun 2 builds no Intel Mac app. Intel Macs keep the `kiwi` CLI
>    (still built for darwin-x64) and 0.14's Electron app.
> 3. **Linux ships deb and AppImage**, as today. Electrobun makes neither, so we package both from
>    its bundle ourselves.

## Why

v0.14.0's downloads are 131–164 MB. Our own code is under 1 MB of that. The rest is Chromium
(Electron: 290 MB unpacked on a Mac, 83 MB compressed) and a second runtime, the bundled `kiwi`
binary (Bun, 17–27 MB compressed). Packaging settings alone can't bring Electron under 100 MB,
and nothing brings its installed size near it.

| v0.14.0 | Size |
| --- | --- |
| mac-arm64 dmg / zip | 154 / 154 MB |
| mac-x64 dmg / zip | 164 / 163 MB |
| Linux AppImage / deb | 164 / 131 MB |

The budget, enforced by CI: **every desktop download ≤ 100 MB**.

## What changes, piece by piece

Electrobun 2.0.2, pinned, with `build.mainProcess: "bun"` (2.0.2's default is Cottontail, its own
runtime; the main process imports `src/`, which uses `bun:sqlite`, `Bun.listen` and `Bun.connect`).

| Electron today | On Electrobun |
| --- | --- |
| `BrowserWindow`, `hiddenInset`, traffic lights at 20,20 | `BrowserWindow` `titleBarStyle: "hiddenInset"`, `trafficLightOffset`. No min size and no pre-paint background: the window starts hidden and shows on the page's first paint. |
| `kiwi-app://app/` with CSP headers per response | `views://` serves `web/dist`; its headers are fixed, so the CSP is a `<meta>` tag. The relay origin is in `connect-src`, so the page is written per relay into the app's data folder and loaded from `appdata://`. |
| `will-navigate`, `setWindowOpenHandler` | `navigationRules` (only the app's own page), `new-window-open` → `Utils.openExternal` through `open.ts`. |
| preload + `contextBridge`, `sendSync` snapshot | An inline preload builds `window.kiwi` on Electroview RPC. The snapshot is written into the preload string when the window is made, so `getSnapshot()` stays synchronous. There is no context isolation: the CSP `script-src 'self'` and the navigation rules are what keep other script away from it. |
| `utilityProcess` key process, `MessagePort` to the page | A Bun `Worker` holds the channel keys (`channels.ts`, same `HostToKeys` protocol). The page reaches it through main's RPC: one `keys` request and one `keys-push` message relay `serveKeys` frames unchanged. |
| `safeStorage` | A random 256-bit key in the OS keychain (`Bun.secrets`: Keychain, libsecret), AES-256-GCM over the store, written atomically (`writePrivate`). Without a secret service the store stays plain JSON at 0600, as Electron did on Linux. |
| `Tray`, template image | Electrobun `Tray` (`template: true` on a Mac). On Linux (AppIndicator) the icon has no click, only its menu. |
| `Notification` with click | `Utils.showNotification`. A click no longer opens the window. |
| `dialog.showMessageBox` | `Utils.showMessageBox`. |
| `requestSingleInstanceLock`, `second-instance` | Our own: a socket in the data folder. A second start hands its `kiwi://` link to the first and exits. |
| `kiwi://` links | macOS: `app.urlSchemes` and the `open-url` event. Linux: our deb and AppImage's `.desktop` entry declares `x-scheme-handler/kiwi`; the link arrives as an argument and goes through the single-instance socket. |
| `nativeTheme` | The page's `prefers-color-scheme`. |
| electron-builder dmg/zip, AppImage/deb | Electrobun's `.app` and dmg on macOS, signed and notarized by its build. The updater's zip is made from that `.app` with `ditto`. Linux: `scripts/package-linux.ts` makes the deb and the AppImage from Electrobun's bundle. |
| Our updater (`updater.ts`, `signer.ts`) | Kept as is. Electrobun's updater checks no signature, so it isn't used. |

`web/` changes only where WebKit differs: `-webkit-app-region` becomes Electrobun's drag-region
class, and every surface gets a pass against `DESIGN.md` in WebKit.

## The saved keys come along

Everyone on 0.14 has their person key and every channel's in Electron's `kiwi-store.bin`. The new
app reads it once, the first time it starts with no store of its own, and writes its own.

| Where it was written | Format | Its key |
| --- | --- | --- |
| macOS | `v10` + AES-128-CBC, IV of 16 spaces | PBKDF2-SHA1(password, `saltysalt`, 1003 rounds, 16 bytes); the password is the Keychain item service `kiwi-desktop Safe Storage`, account `kiwi-desktop` |
| Linux, GNOME keyring (libsecret) | `v11` + AES-128-CBC, IV of 16 spaces | PBKDF2-SHA1(password, `saltysalt`, 1 round, 16 bytes); the password is the secret with `application = kiwi-desktop` (schema `chrome_libsecret_os_crypt_password_v2`), read through libsecret over `bun:ffi`; KDE's wallet through `kwallet-query` |
| Linux, no keyring | plain JSON | none |

The packaged 0.14 app is named `kiwi-desktop`, not `Kiwi`: electron-builder keeps `productName`
out of the app's own `package.json`, so Electron names the folder, the keyring entry and the
Keychain item after `name`. Electron 44.7.2 confirmed it under Xvfb with a real gnome-keyring:
`~/.config/kiwi-desktop`, `application = kiwi-desktop`. The reader looks under `kiwi-desktop`
first, then `Kiwi`, in Electron's folder (`~/Library/Application Support/<name>`,
`$XDG_CONFIG_HOME` or `~/.config/<name>`) whatever Electrobun's own folder is.

The Linux `v11` vectors in the tests were made by that Electron run, and the libsecret lookup
was checked against the same keyring. The macOS `v10` path is tested against Chromium's scheme
built with `node:crypto`; it still needs one vector from a real 0.14 install on a Mac. An
unreadable old store (a locked keychain, a missing key) is never replaced by an empty one: the
app says so and saves nothing, as it does today. The old file is kept, renamed, until the new
store has been written and read back.

## Phases (one PR, several days)

1. **Plan and the old store's reader.** No Electrobun needed.
2. **Spike.** An Electrobun window renders `web/dist` on Linux under Xvfb; measure the bundle.
3. **Main process.** Window, page hosting and CSP, bridge and RPC, store, key worker, tray, links,
   single instance, daemon and CLI (`cli.ts`, `daemon-client.ts` unchanged).
4. **WebKit pass.** Every surface against `DESIGN.md`, in WebKit.
5. **Packaging and release.** macOS arm64 dmg and zip, signed and notarized; Linux deb and
   AppImage; `release.yml`; the size gate.
6. **Electron goes.** Its packages, electron-builder's config, Knip's entries.

## Gates

- `desktop / size`: builds the Linux deb and AppImage and fails over 100 MB. The release checks
  the macOS dmg and zip the same way before it publishes.
- `desktop / keys` runs the old store's reader against the Electron vectors.
- `desktop / build` typechecks and bundles the Electrobun main process.

## Risks

- **WebKitGTK differs by distro.** The deb depends on `libwebkit2gtk-4.1-0`; the AppImage needs it
  on the host.
- **No context isolation** for `window.kiwi` (see the table).
- **Electrobun 2 is young.** It is pinned to an exact release; its toolchain (Hutch) downloads from
  `electrobun-artifacts.blackboard.sh`, which CI and this work need to reach.

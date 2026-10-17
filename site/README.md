# The relay's static site

The relay serves this folder in place of the old dashboard: a landing page with
the desktop app's downloads, invite pages (`/join/<code>`, which open the app
through `kiwi://join/<code>`), and the install scripts.

- `index.html`, `styles.css`, `app.js` — hand-written static files, no build
  step. `app.js` routes between the landing page and the invite page
  (`/#<code>`, which is what the renderer produces, and `/join/<code>`), fills
  in the download links and the `curl … | sh -s -- join <code>` line, and the
  copy buttons. There is no inline script, so the CSP stays `script-src 'self'`.
- `install`, `install.sh`, `install.ps1` — the install scripts served at
  `/install`, `/install.sh` and `/install.ps1`. They install the CLI and then
  run `kiwi join …` or `kiwi pair …` when given one.
- `_headers` — security headers and the text content type for the install
  scripts, for hosts that read it.
- `icon.svg` — the site icon.

## Download links

`app.js` lists the desktop app files the v0.16.2 release actually publishes:

- `Kiwi-0.16.2-mac-arm64.dmg` / `Kiwi-0.16.2-mac-x64.dmg`
- `Kiwi-0.16.2-linux-x86_64.AppImage` / `Kiwi-0.16.2-linux-amd64.deb`

Those are `desktop/package.json`'s `artifactName` (`Kiwi-${version}-${os}-${arch}.${ext}`)
with electron-builder's per-target arch strings. There is no Windows app; the
CLI is `kiwi-windows-x64.exe`, installed by `install.ps1`. Links point at
`github.com/ojowwalker77/channels/releases/latest/download/<file>`.
# The relay's static site

The relay serves this folder in place of the old dashboard: a landing page (OLED
black, full width, plain HTML) with the desktop app's downloads, invite pages
(`/join/<code>`, which open the app through `kiwi://join/<code>`), and the
install scripts.

- `index.html`, `styles.css`, `app.js` — hand-written static files, no build
  step. `app.js` routes between the landing page and the invite page
  (`/#<code>`, which is what the renderer produces, and `/join/<code>`), picks
  the header's Download for the visitor's OS and chip (client hints where the
  browser gives them; Safari can't tell a Mac's chip, so Apple silicon), fills
  in the download links and the `curl … | sh -s -- join <code>` line, and the
  copy buttons. There is no inline script, so the CSP stays `script-src 'self'`.
- `world.js` — the hero: a channel's members (agents as their harness icon and
  nick, people as a dot and a name) around the app icon's glass, with a short
  conversation playing on its own. Each message leaves its sender as ciphertext,
  lights the spectrum in the glass, and reaches every other member. Lines and
  text draw on a 2D canvas at the screen's resolution; the glass is a WebGL
  raymarch on its own canvas, redrawn only when its light changes. Without
  WebGL the room plays without the glass; with reduced motion it holds still.
- `install`, `install.sh` — the install script, served at `/install` and
  `/install.sh`. It installs the CLI and then
  run `kiwi join …` or `kiwi login` when given one.
- `_headers` — security headers and the text content type for the install
  scripts, for hosts that read it.
- `icon.svg` — the site icon.
- `fonts/` — Paper Mono (`PaperMono.woff2`, SIL OFL 1.1 in `PaperMono-OFL.txt`),
  for the page's labels and headings; body text is the system's SF Pro.
- `media/harness/` — the harness icons from `assets/harness/` (LobeHub, MIT,
  with its `LICENSE`) the hero's agents wear.
- `media/agents.jpg`, `media/tasks.jpg`, `media/channel.jpg` — the features'
  screenshots of the app, from CI's `ui-shots`.
- `media/` — the landing page's video (`hello-martha.mp4`, a cut of Century 21
  Calling, 1964, Prelinger Archives, public domain) and its poster frame. Static
  assets on Workers top out at 25 MiB a file, so a longer cut goes to the
  release or another host instead.

## Download links

`app.js` lists the desktop app files the v2026.10.18 release publishes, under the app's
name, Channels (releases up to v0.16.2 named them `Kiwi-…`):

- `Channels-2026.10.18-mac-arm64.dmg` (Apple silicon only: Intel Macs get the CLI)
- `Channels-2026.10.18-linux-x86_64.AppImage` (Linux: Arch is the supported distribution)

A tag's release stamps its version into these names (`scripts/stamp.ts`) and commits
them to main; the site deploys only from a tag, after its GitHub release exists. The names
come from `desktop/src/update-asset.ts` (Mac) and `desktop/scripts/linux-files.ts` (Linux).
There is no Windows app or Windows CLI. Links point at
`github.com/kiwi-init/channels/releases/latest/download/<file>`.
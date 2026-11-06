# The relay's static site

The relay serves this folder in place of the old dashboard: a landing page (Cinder
Peak, full width, plain HTML) with the desktop app's downloads, the docs at
`/docs/`, invite pages (`/join/<code>`, which open the app through
`kiwi://join/<code>`), and the install scripts.

## The docs

`docs/*.md` at the repo root are the source; `scripts/docs-site.ts` builds them
into `docs/` here (ignored by git). Wrangler runs it before every deploy and
`wrangler dev` (its `build` in `wrangler.jsonc`), and the Docker image runs it
too. `bun scripts/docs-site.ts --serve` builds on every page load and serves the
site on http://127.0.0.1:4400, with one figure alone at `/preview/<name>`.

- A page's front matter has `description`, `group` (its heading in the side
  list) and `order`; its `# title` names it. Links to another page (`agents.md`)
  become `/docs/agents`; links to anything else in the repo go to GitHub.
- `<!-- figure: <name> -->` on a line of its own places a figure. The build
  imports `figures/<name>/build.js` and puts its SVG inline, on the page with no
  card or caption; `figures/<name>/live.js`, when there is one, is the page's
  module that moves it.
- `figures/` holds the figures, drawn with the anatomy kit vendored in
  `anatomy/` (`iso-kit.js`, `lathe.js`, `tube.js`, `iso.css`; MIT, its
  `LICENSE` beside it). The same files load in Bun at build time and in the
  browser.
- `docs.css` and `docs.js` are the pages' style (Cinder Peak, Paper Mono for
  headings) and their copy buttons. `.iso` in `docs.css` is the figures'
  palette: every figure takes its tones from there.

- `index.html`, `styles.css`, `app.js` — hand-written static files, no build
  step. `app.js` routes between the landing page and the invite page
  (`/#<code>`, which is what the renderer produces, and `/join/<code>`), picks
  the header's Download for the visitor's OS and chip (client hints where the
  browser gives them; Safari can't tell a Mac's chip, so Apple silicon), fills
  in the download links and the `curl … | sh -s -- join <code>` line, and the
  copy buttons. There is no inline script, so the CSP stays `script-src 'self'`.
- `load-figures.js` — the landing's figures. Each `<figure data-figure>` holds an
  empty SVG at the figure's size; when it nears the screen this fetches the
  built SVG from `/docs/figures/<name>.svg`, puts it in and imports the figure's
  `live.js`. The docs build fails when a figure's size there drifts from the
  one it builds.
- `theme.css`, `theme.js` — the colours both the landing and the docs use:
  Cinder Peak in dark and Channels Light in light, through `light-dark()`, plus
  the figures' palette (`.iso`). The header's System, Light and Dark buttons
  set `data-theme` on the page and keep the choice in `localStorage`; with no
  choice the page follows the system. `?theme=light` or `?theme=dark` shows one
  page in that theme without keeping it.
- `install`, `install.sh` — the install script, served at `/install` and
  `/install.sh`. It installs the CLI and then
  run `kiwi join …` or `kiwi login` when given one.
- `_headers` — security headers and the text content type for the install
  scripts, for hosts that read it.
- `icon.svg` — the site icon.
- `fonts/` — Paper Mono (`PaperMono.woff2`, SIL OFL 1.1 in `PaperMono-OFL.txt`),
  for the pages' labels and headings; body text is the system's SF Pro.
- `media/` — the landing page's video (`hello-martha.mp4`, a cut of Century 21
  Calling, 1964, Prelinger Archives, public domain) and its poster frame. Static
  assets on Workers top out at 25 MiB a file, so a longer cut goes to the
  release or another host instead.

## Download links

`app.js` lists the desktop app files the v2026.11.11 release publishes, under the app's
name, Channels (releases up to v0.16.2 named them `Kiwi-…`):

- `Channels-2026.11.11-mac-arm64.dmg` (Apple silicon only: Intel Macs get the CLI)
- `Channels-2026.11.11-linux-x86_64.AppImage` (Linux: Arch is the supported distribution)

A tag's release stamps its version into these names (`scripts/stamp.ts`) and commits
them to main; the site deploys only from a tag, after its GitHub release exists. The names
come from `desktop/src/update-asset.ts` (Mac) and `desktop/scripts/linux-files.ts` (Linux).
There is no Windows app or Windows CLI. Links point at
`github.com/kiwi-init/channels/releases/latest/download/<file>`.
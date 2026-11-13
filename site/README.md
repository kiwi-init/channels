# The relay's static site

The relay serves this folder in place of the old dashboard: a landing page (the
AFK scene behind one line and two buttons, plain HTML), the docs at
`/docs/`, invite pages (`/join/<code>`, which open the app through
`kiwi://join/<code>`), and the install scripts.

## The docs

`docs/*.md` at the repo root are the source; `scripts/docs-site.ts` builds them
into `docs/` here (ignored by git). Wrangler runs it before every deploy and
`wrangler dev` (its `build` in `wrangler.jsonc`), and the Docker image runs it
too. `bun scripts/docs-site.ts --serve` builds on every page load and serves the
site on http://127.0.0.1:4400, with `_headers` applied per path and one figure
alone at `/preview/<name>`.

- A page's front matter has `description`, `group` (its heading in the side
  list) and `order`; its `# title` names it. Links to another page (`agents.md`)
  become `/docs/agents`; links to anything else in the repo go to GitHub.
- `<!-- demo -->` on a line of its own places the real app in demo mode, in a
  frame (the first page, `docs/index.md`). The build makes it with Vite from
  `ui/` (`VITE_KIWI_DEMO=1`, base `/demo/`) into `demo/` here (ignored by git);
  `--serve` builds it once at start, and a build without `ui/` (the Docker
  image) says where to play it instead. `docs.js` loads the frame in the page's
  theme. `_headers` gives `/demo/*` the app's own CSP, framed by this site only.
- `<!-- figure: <name> -->` on a line of its own places a figure. The build
  imports `figures/<name>/build.js` and puts its SVG inline, on the page with no
  card or caption; `figures/<name>/live.js`, when there is one, is the page's
  module that moves it.
- `figures/` holds the figures, drawn with the anatomy kit vendored in
  `anatomy/` (`iso-kit.js`, `lathe.js`, `tube.js`, `iso.css`; MIT, its
  `LICENSE` beside it). The same files load in Bun at build time and in the
  browser.
- `docs.css` and `docs.js` are the pages' style (Channels Dark, Paper Mono for
  headings) and their copy buttons. `.iso` in `docs.css` is the figures'
  palette: every figure takes its tones from there.

- `index.html`, `styles.css`, `app.js` — hand-written static files, no build
  step. `app.js` routes between the landing page and the invite page
  (`/#<code>`, which is what the renderer produces, and `/join/<code>`), points
  Download at the file for the visitor's OS and chip (client hints where the
  browser gives them; Safari can't tell a Mac's chip, so Apple silicon; anyone
  else gets the release page), fills in the `curl … | sh -s -- join <code>`
  line, and the copy buttons. There is no inline script, so the CSP stays
  `script-src 'self'`.
- The landing in pt-BR, ja, ko and zh-CN: `i18n/<dir>.json` maps each piece of
  the English `index.html` (a text between tags, or an `alt`, `title`,
  `aria-label` or description) to its translation, with the app's glossary
  words. `scripts/docs-site.ts` writes `<dir>/index.html` from them (ignored
  by git), and `test/site-langs.test.ts` fails when a
  translated landing keeps an English sentence, so new English copy needs its
  four translations. `bun scripts/docs-site.ts --landing` refreshes the
  `<!-- alternates -->` and `<!-- langs -->` marks in `index.html`. `lang.js`
  sends a first visit to `/` to the browser's language and keeps a pick in
  `localStorage` (`kiwi.site-lang`); it never redirects a docs page.
- Translated docs: `docs/<dir>/<file>.md` (the same file name as the English
  `docs/<file>.md`) is built at `/<dir>/docs/<slug>`, into `<dir>/docs/` here
  (ignored by git). Its front matter has a translated `description` and
  `group` (every page of one English group uses the same translated name) and
  the English page's `order`. It keeps every heading of the English page, in the
  same order and depth: each heading takes the English heading's `id`, so
  `#anchor` links stay English and shared, and the build fails when the outline
  differs. Links stay as the English page writes them (`cli.md`, `cli.md#x`,
  `/docs/cli`, `../SECURITY.md`): the build points them at the translation when
  there is one and at the English page when not. A page with no translation is
  not built in that language, and a language with none has no docs. The
  sidebar, pager and switcher list a language's own pages, the chrome's words
  (`chrome` in `LANGS`) are in its language, and hreflang links name the
  languages a page exists in. Without a translation the switcher sends that
  language to its landing, with a note that the docs are English for now.
- The landing's background is the AFK scene, `/afk/scene` (`afk/scene.html`, which
  `scripts/docs-site.ts` builds from `ui/src/meadow/scene.page.ts` as one inline file), in an
  `<iframe sandbox="allow-scripts">`. `app.js` paints a sky for the hour behind
  it and sends the scene `{ kiwi: "afk", type: "state", at, needs: 0, still }`
  when it loads; the frame fades in once the scene posts
  `{ kiwi: "afk", type: "ready" }`, and is taken down if that doesn't come
  within 5 seconds of loading. The sky's hour also sets `data-sky` on the body,
  so the text over it stays dark by day and light at night in either theme.
  `_headers` gives `/afk/scene*` its own CSP: inline script, no network, framed
  only by this site. The frame asks for `/afk/scene`, not `scene.html`: Cloudflare
  redirects `.html` addresses to the bare one.
- `theme.css`, `theme.js` — the colours both the landing and the docs use:
  Channels Dark in dark and Channels Light in light, through `light-dark()`, plus
  the figures' palette (`.iso`). The docs header's System, Light and Dark buttons
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

## Download links

`app.js` lists the desktop app files the v2026.11.20 release publishes, under the app's
name, Channels (releases up to v0.16.2 named them `Kiwi-…`):

- `Channels-2026.11.20-mac-arm64.dmg` (Apple silicon only: Intel Macs get the CLI)
- `Channels-2026.11.20-linux-x86_64.AppImage` (Linux: Arch is the supported distribution)

A tag's release stamps its version into these names (`scripts/stamp.ts`) and commits
them to main; the site deploys only from a tag, after its GitHub release exists. The names
come from `desktop/src/update-asset.ts` (Mac) and `desktop/scripts/linux-files.ts` (Linux).
There is no Windows app or Windows CLI. Links point at
`github.com/kiwi-init/channels/releases/latest/download/<file>`.
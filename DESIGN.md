# Channels DESIGN.md

Source of truth for how Channels looks: the `ui/` renderer, in the desktop
app (WebKit on Mac and Linux) and in a browser. Components take colours,
sizes and type from the tokens here. Never hard-code hex in a component.

Canonical sources: `ui/src/styles/tokens.css` (`:root`), `ui/src/theme/`
(`channels.ts`, `derive.ts`, `themes.ts`, `apply.ts`, `rex-themes.ts`),
`ui/src/styles/base.css` (the shared classes), `ui/src/kit/` (`bits.tsx`,
`icons.tsx`, `toasts.tsx`, `boundary.tsx`), `ui/src/chat/composer.tsx`,
`packages/app/src/accessibility.ts`.

## 1. Identity in one line

Quiet and fast. A near-black canvas, Channels Dark (Channels Light in light), ink
for what matters and greys for the rest, the system font for what people read and
Paper Mono for the machine's words (times, ids, counts, code). No glass, no
blur, no gradients for show. Colour means a state, never decoration.

## 2. Theme architecture

- CSS custom properties are the contract. `tokens.css` writes them on `:root`
  in dark, and again for light under `:root[data-theme="light"]` and
  `prefers-color-scheme: light` (unless `data-theme="dark"`).
- The colour tokens are the list in `TOKENS` (`ui/src/theme/derive.ts`):
  `bg, bg-2, bg-3, ink, ink-2, ink-3, line, line-2, line-3, wash, wash-2,
  scrim, link, on-ink, accent, accent-wash, live, doing, review, decide,
  decide-wash, alert, alert-wash` and the ten `c-*` colours. The rest of
  `:root` (fonts, type steps, radii, sizes, motion, `shadow-pop`, `h-*`) is
  the same in every theme, except `float` and `shadow-float`, which each
  side sets (§5).
- Settings → Appearance picks system / light / dark, and a theme for each
  side. Built in (`channels.ts`): Channels Dark (`channels-dark`, the default
  dark), Cinder Peak (`cinder-peak`, warm), OLED Black (`channels-oled`, true
  black) and Channels Light (the default light), then the Rex themes
  (`rex-themes.ts`, loaded only when one is picked) and the person's own.
  `system` leaves `data-theme` unset so the media query decides.
- `tokens.css` paints the two defaults, Channels Dark and Channels Light, with
  no script. Every other theme, Cinder Peak and OLED Black included, is applied by
  `applyTheme()`: every token set inline on `<html>`. A custom theme is 13 base colours (background, text,
  accent, success, warning, danger, info and six ANSI-style hues);
  `compose()` in `derive.ts` derives the whole token set from them.
- A saved Cinder Peak, the old default, moves to Channels Dark once
  (`movedDark`, flag `ui.prefs.channels-dark`), after the earlier moves
  (Channels Dark to OLED Black, `ui.prefs.oled`; OLED Black to Cinder Peak,
  `ui.prefs.cinder`). Picking any of them again sticks; every other saved
  theme is kept.

## 3. Color tokens

The defaults (`tokens.css`, `channels.ts`), with OLED Black beside them:

| Token | Dark (Channels Dark) | OLED Black | Light |
|---|---|---|---|
| `bg` (canvas, sidebar, panels) | `#111113` | `#000000` | `#ffffff` |
| `bg-2` (raised: dialogs, cards) | `#18181b` | `#0c0c0d` | `#f7f7f8` |
| `bg-3` (fills: buttons, fields, tiles, tracks) | `#212125` | `#18181a` | `#efeff1` |
| `ink` | `#ececef` | `#ececef` | `#18181b` |
| `ink-2` (secondary text, idle controls) | `#a3a3ab` | `#a3a3ab` | `#56565e` |
| `ink-3` (quiet floor: hints, placeholders, meta) | `#808089` | `#808089` | `#6c6c74` |
| `line` / `line-2` / `line-3` (hairlines, light to strong) | white 6 / 9 / 13% | white 8 / 11 / 15% | black 6 / 9 / 13% |
| `wash` / `wash-2` (hover, pressed, chosen) | white 4.5 / 8% | white 4.5 / 8% | black 3.5 / 6% |
| `scrim` (under a dialog) | black 55% | black 70% | black 22% |
| `on-ink` (text on an `ink` fill) | `#111113` | `#000000` | `#ffffff` |
| `accent`, `link` | `#8ab4ff` | `#8ab4ff` | `#1a56db` |
| `accent-wash` | accent 14% | accent 14% | accent 8% |
| `live` (online, done, passed) | `#32d074` | `#32d074` | `#1f9a55` |
| `doing` (working, running) | `#5b9bff` | `#5b9bff` | `#2f6fe4` |
| `review` (in review) | `#b48cff` | `#b48cff` | `#7a4fd6` |
| `decide` (needs you) and `decide-wash` | `#f5b041`, 12% | `#f5b041`, 12% | `#a35a00`, 10% |
| `alert` (failed, error, danger) and `alert-wash` | `#ff6259`, 12% | `#ff6259`, 12% | `#d1342a`, 8% |

- `selection` is ink at 28%. `white` is for a knob or a glyph on a coloured
  fill.
- `img-edge` rings every picture (faces, channel icons, message images,
  GIFs, attachments) with a 1px outline set 1px in: pure black at 10% in
  light, pure white at 10% in dark, never a tinted grey.
- `c-red … c-brown` are the member colours: a person's initials and the
  tint behind them (`.av[data-color]`, 18%). They never colour chrome.
- `h-claude, h-codex, h-gemini, h-opencode` colour the harness badge on an agent's face.
- Cinder Peak is the warm set on `#151011` / `#1c1718` / `#252021`, ink `#ddccc6`, accent `#ff6b4a`.

## 4. Typography

- Two roles and no others. `--sans` / `--ui`: the text font, for
  everything people read and press. It is the system font
  (`-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Segoe UI",
  Roboto, Ubuntu, Cantarell, sans-serif`) unless the person picks Inter
  (`/fonts/Inter.woff2`, variable), Lato (`/fonts/Lato-*.woff2`, 400 and
  700) or Atkinson Hyperlegible Next (`/fonts/Atkinson.woff2`, variable
  200-800) in Settings > Appearance > Font; `<html data-font>` swaps both tokens,
  with the system stack behind the pick. `--mono`: Paper Mono (`/fonts/PaperMono.woff2`, weights 100-900),
  then `ui-monospace, "SF Mono", Menlo`.
- Paper Mono carries the machine's words: times, days, counts, task and PR
  ids, roles (`lead`, `owner`), statuses (`running Bash`, `offline · 1d`),
  the composer's hint, keys (`kbd`), code and paths. The list is the `html .msg-time, html .count, …` rule and the
  `code, pre, kbd, .mono, .codebox, …` rule in `base.css`; a new
  machine-word class joins it there, with `letter-spacing: -0.01em`.
- Six steps and no sizes between them, in `rem`: `--t-stamp` 11px (times,
  counts), `--t-meta` 12px (meta lines, section heads), `--t-ui` 13px (rows,
  names, buttons, menus), `--t-body` 15px (messages, task titles; message
  text at 22px line height), `--t-title` 17px (panel and dialog titles),
  `--t-display` 24px (empty states, page headings). Sizes here are at Small,
  where 1rem is 16px.
- Text size scales the root: `:root` has `font-size: calc(var(--text-scale) *
  100%)` (Default 1.1; Small 1, Large 1.25, Larger 1.4, Largest 1.6), so
  everything in `rem` grows with it. Type, every box that holds text
  (controls, rows, chips, avatars with initials, the channel tiles), the
  columns sized for text (`--side-w`, `--col`), icons and container-query
  breakpoints are in `rem`. A breakpoint is its width at Default divided by
  17.6 (1rem at Default), so it fires where it always did there and moves
  with the text at other sizes. Hairlines, radii, spacing, shadows and dots
  stay in px. `scripts/css-units.ts` (`repo / static`) refuses px type, a px
  height on a rule that sets a font size, and a px container breakpoint.
- Weights: 400 for text, 500 for buttons and tabs, 600 for names, titles and
  what's chosen. Hierarchy comes from weight, ink level and size, not from
  new faces.
- Numbers that line up (counts, times, sizes, diff stats) use
  `font-variant-numeric: tabular-nums` (`.num`).
- Body text is antialiased with `optimizeLegibility`.
- Headings balance their lines (`text-wrap-style: balance`); paragraphs, list
  items and `dd` wrap `pretty`, so no word sits alone on the last line.

## 5. Radius, shadow, layout

- The 8px grid. Every fixed size in the shell is a multiple of 8 on screen,
  at every text size. Text size scales the root (1rem is 17.6px at Default),
  so a bare rem size lands between pixels (18rem is 316.8px); the shell's
  sizes are therefore tokens that snap, `round(<rem>, 8px)`: `--side-w`,
  `--col`, `--ctl` (32), `--ctl-sm` (24), `--row` (a
  sidebar or tracker row, 32), `--slot` (a row's icon column and a section
  head, 24), `--tile` (40), `--av` / `--av-sm` / `--av-lg` (32 / 24 / 64) and
  `--row-text` (a 24px line). Spacing between them is 8, 16 or 24. What can't
  be on the grid is what follows the window or the words: a column centred
  in an odd-width window, a label's own width, a paragraph's height. The
  blueprint (below) prints an off-grid ruler number in `decide` and says
  `off grid` in its notes.
- Rules of place:
  - One grid. The window is three columns, `--side-w | 1fr | --side-w` (320
    at Default): the sidebar, the work, the second sidebar. The top bar
    shares them. Nothing else places the big parts: no margins, no absolute
    positions, no measuring in script.
  - The window's true centre. The two sides are the same width, so the work
    is on the window's centre by construction, and the bar's title is centred
    on the window in every state. Settings and Home centre on the window too.
    A window under 1180px wide has no third column and centres the work in
    what is left.
  - The sidebar's width is yours. Its right edge drags (`shell/side-width.ts`,
    `.side-grip`): 14rem to 28rem, snapped to 8px, kept in rem so it follows
    the text size, and never so wide that the work has under 480px. Arrow
    keys step 8px (32 with Shift), a double-click puts 18rem back. It sets
    `--side-want`, which `--side-w` reads, so the second sidebar takes the
    same width and the centre holds.
  - One gutter. Every view keeps `--gutter` (40px) on each side of its
    content. The conversation has no maximum width: the gap is always 40 and
    the column is whatever the window leaves. A scrolling view reserves its
    scrollbar (`scrollbar-gutter: stable`) and takes the scrollbar's measured
    width (`--bar`, set by `kit/scrollbar.ts`) off its right padding
    (`--gutter-end`), so content ends on the same line with a classic
    scrollbar, an overlay one or none.
  - One left line, one right line. In a list view the headings, the rows'
    icons and "Show more" start on the gutter line, titles 32px after it (a
    16px icon column and a 16px gap), and a row's last column ends on the
    right line; a row's hover plate bleeds 8px past both. In the
    conversation, faces start on the composer's left edge and your own
    bubbles end on its right edge.
  - Nothing scrolls sideways. Every scroller is vertical only (`overflow:
    hidden auto`): strips wrap, long code and diff lines wrap, a diagram
    shrinks to fit. The one exception is the image annotator's zoomed
    picture.
  - Nothing you click moves. Hiding the sidebar or opening the right panel
    changes no control's position. Content may: a hidden sidebar gives its
    column to the work.
  ⌥⌘B (Ctrl+Alt+B) lays a blueprint over the app (`kit/blueprint.tsx`, loaded
  only when asked for): an 8px grid, a line on every measured column and row
  edge, a ruler with each column's width, the window's centre line with how
  far the title and the composer sit from it (`live` within a pixel, `alert`
  beyond), and under the pointer an element's size and position. It takes no
  clicks, so the app works under it. Everything it draws is also in the
  accessibility tree, one labelled element per fact, each starting `bp:`
  (`bp: span x 361 to 527 w 166`, `bp: part .main .composer x 527 …`,
  `bp: item .side .side-row 3 of 16 … gap 0`, `bp: text … starts at x 142.5`),
  so a tool that reads the tree gets the numbers along with the picture.
  ⌥-click selects what is under the pointer: it gets a `decide` outline, and
  its id is copied (`bp: pick .side-row.is-muted in .app > .chan > .side
  "#releases" x 80 y 136 w 256 h 32`: its classes, where it sits, what it
  says, its box) and published to the tree as well. ⌥⇧-click on the same spot
  steps up to its container. The click never reaches the app.
  It also audits what it measures, one `bp: issue <kind>: …` per finding and
  a `bp: audit N issues` line, each outlined in `alert`: a control under
  another, a target under 24px, text cut short, anything outside the window,
  an edge 1 or 2px off its neighbours, a boxed control off the grid, a lone
  edge near a common one, and anything that can scroll sideways. It costs
  frames while it is on, so no build turns it on by default.
  `bun scripts/ui-audit.ts --dist ui/dist` opens every demo shot with the
  overlay on, at two window sizes, and fails on any issue it reports.
  `bun scripts/ui-layout.ts --dist ui/dist` measures these rules in the built
  page (the centre, the sidebar's edges, the tracker's place, the two sides
  of the conversation, hiding and peeking the sidebar, search, a wide panel)
  at four window sizes; run it after any layout change.
- Spacing: padding, margin and gap sit on one scale: 0, 1, 2, 4, 6, 8, 10, 12,
  16, 20, 24, 32, 40, 48, 64. `test/ui-design-scale.test.ts` fails on anything
  else.
- Rhythm: a page has `--gutter` (24px) at its sides, 24px above and 48px below.
  A plate is something you act on (a thing that needs you, an agent, the Now
  line, a question): a `plate` fill (`bg-2`) with a `line` edge drawn inside,
  no border, `--r-card` and text inset `--card-pad` (16px). A list (Specs,
  GitHub) has no box: its groups sit on the page with a hairline between
  them. A list of cards has 12px between them; sections of a
  page or panel have 24px or 32px between them. A panel's text is inset 16px.
- Control heights: `--ctl` (32px at Default: buttons, fields, tracks,
  send, attach) and `--ctl-sm` (24px: small buttons);
  a sidebar row is `--row`.
  A quiet button or icon button at the end of a row is pulled out by its own
  padding so its text or glyph lines up with the row's right edge.
- Radii, only from tokens: `--r-tick 2px` (bars, ticks), `--r-tag 6px` (tags,
  inline code), `--r-row 8px` (rows, small buttons, icon buttons, segments),
  `--r-ctl 10px` (buttons, fields, segmented tracks, toasts, tiles, messages on
  hover), `--r-card 14px` (cards), `--r-win 18px` (the composer, dialogs).
  `999px` is for counts and the toggle track only, and the composer's send is a circle. Avatars of people are round;
  agents and channel tiles are rounded squares.
- Nested corners are concentric: the outer radius is the inner radius plus
  the padding between them (an `r-tag` letter 8px inside an `r-card` option).
- Two shadows. `--shadow-pop` (`0 0 0 1px line-2`, then a soft black drop)
  for what floats over the page: dialogs, menus, the palette, the stash
  list, Jump to latest. `--shadow-float` for the chrome's controls and the
  composer, which sit on the app like a Mac toolbar's buttons: a `float`
  fill (`bg-3` in dark, `bg` in light), a 1px `line-2` ring and a short
  drop; dark adds a `line` highlight along the top edge. No coloured
  shadows.
- Surfaces are told apart by a step of fill (`bg` → `bg-2` → `bg-3`) and by
  hairlines (`line`), not by shadows. Cards on the page are `bg` with a
  `line` border.
- No glass, no `backdrop-filter`, no blur anywhere, with one exception: the
  composer (§10) is frosted, so the thread scrolls under it. Nothing else
  takes a blur.
- Sizes on `:root`: `--side-w 18rem` (the sidebar and the second sidebar),
  `--panel-w` (the right panel's width once someone has dragged it wider),
  `--top-h` (`--ctl` + 16px: the top bar, which drags the window),
  `--gutter 40px` (each side of a view's content), `--col 47.5rem`
  (the reading column), `--list 2400px` (the cap for the list views Specs,
  GitHub and Needs you, which otherwise fill the content area inside
  `--gutter`), `--compose-space 8rem` (room under the last message for the
  composer).

## 6. Motion

- Things grow out of what was pressed: the search field out of the search
  button (`find-grow`, a clip, never a width), a menu out of its corner
  (`menu-grow`), the right panel in from the window's edge (`panel-in`), a
  view up into place when its row opens (`view-in`; the conversation is there
  at once). Pointing at a channel's tile drops its name under it
  (`hint-drop`), so a name never costs a click. The sidebar slides out and in
  and the work slides with it (`main-fill`, `main-yield`); the grid itself
  never animates.
- Motion moves `transform`, `translate`, `opacity` and `clip-path` only.
  Nothing animates a width, a height, a position or a grid.
- Motion answers an action: something opens, arrives or moves because someone
  did something. It is felt, never watched: short, soft, and nothing plays
  twice for the same event. Two things loop: the working dots under the
  conversation when the sidebar is hidden (`blink`) and the current
  step's mark while adding an agent (`spin`). A task's `Dot` never moves on
  its own: in progress is a whole ring with a centre, the same size as every
  other state.
- CSS first, and no animation library. Two speeds and one ease for fades and
  fills: `--fast 0.16s`, `--slow 0.28s`, `--ease cubic-bezier(0.32, 0.72, 0, 1)`.
  Two springs for things that move, written as `transition: transform var(--glide)`:
  `--glide` (0.48s, a slight overshoot: selections, panels, dialogs, cards) and
  `--pop` (0.35s, livelier: presses, marks, counts, toasts).
- The selection glides. One pill moves between segments and sidebar rows
  (`useGlide` and `Track` in `ui/src/kit/glide.tsx`) instead of each option
  lighting up on its own.
- Pressing a control dips it to 0.96 and it springs back on `--pop`. This is the
  only scale on a resting control. Rows take hover at once and let it go on
  `--fast`; nothing grows on hover.
- A change is marked once: a `Dot` pops when its status moves and rings when it
  turns done (`done-ring`), a `Count` rolls to its new number (`count-roll`),
  both through `useMoved`, so opening a view animates nothing that didn't change.
- A message that arrives lands with `land()`: 8px up, 16px for your own, and only
  for what just came in, never history or a scroll.
- A view's cards rise in a short stagger when it opens (30ms apart, 120ms at
  most). Clearing Needs you draws a tick (`tick-draw`).
- Keyframes: `rise` (6px up and in), `fade`, `panel-in` (the right panel, 12px
  from the right), `dialog-in`, `toast-in`, `pop-in`, `palette-in` (6px down),
  `jump-in` (Jump to latest),
  `msg-flash` (a message you jumped to, 1.6s).
- Scrolling content fades under the top bar (16px, `bg` to transparent).
- Reduced motion: the OS setting or Settings' own (`data-motion="reduced"` on
  `<html>`) cuts every animation and transition to 0.01ms, and `land()` does
  nothing.

## 7. Core components

The shared classes are in `base.css`; the React bits in `ui/src/kit/`.

- Buttons (`.btn`, `--ctl`, `r-ctl`, 500 `t-ui`, 12px sides): default on `bg-3`;
  `is-primary` is an `ink` fill with `on-ink` text (white on black, black on
  white), the one loud button in a view; `is-danger` is `alert` on
  `alert-wash`; `is-quiet` has no fill until hover (`wash`); `is-small` is
  `--ctl-sm`. There is no blue button.
- `IconButton` (`.icon-btn`, 28px, `r-row`): `ink-2`, `wash-2` on hover and
  while pressed.
- Chrome is flat. The channel tiles, the sidebar button, Search and
  Settings' back button cast no shadow and have no raised fill: a tile rests
  on `wash` and the open channel's tile is `ink` with `on-ink` text; the rest
  have no fill at rest, hover is `wash`, chosen is `wash-2`.
  A tile still waiting to be let in keeps its outline and no fill; + and the
  Settings gear are bare `ink-3` glyphs. What floats is what sits over the
  work: the composer, menus, dialogs.
- Fields (`.input`, `.textarea`, `Field` with label and hint): `bg-3` fill,
  `--ctl` high, `t-ui`; `.input.is-mono` for codes and paths.
- `Seg` (`.seg`): a `bg-3` track, the chosen segment on `wash-2` in `ink`
  and 600.
- `Toggle`: a 36×22 track, `live` when on with a white knob. No On/Off word
  beside it: the track already says it.
- `Modal` (`.modal`): the one modal frame. `bg-2`, `r-win`, `shadow-pop`,
  480px (`narrow` 400px, `wide` 720px), rises in. Its head is an optional
  lead (an avatar or a tile), the title, an optional sub line and close;
  tabs, when it has them, sit under the title in the head. The body scrolls
  and an optional foot holds the actions. Esc, a click outside and Back or
  Forward close it, and focus stays inside. Once something is typed in it,
  a click outside no longer closes it: only Esc, Cancel or the X do. The
  same holds from the start for a dialog that shows something to copy
  (Invite, Add an agent). Cancel
  is quiet and sits left of the action; a dialog that throws something away
  opens with the focus on Cancel. Settings-like screens (channel
  settings, profiles, Invite, Add an agent) open in it, built from Settings'
  `Group` and `Row` with real headings; the side panel is only for work: a
  thread, a task, a PR or an issue.
- `Avatar` (`.av` 32px, `av-sm` 24px, `av-lg` 56px). A person shows their
  picture or initials in their member colour, with a presence `pip` (`live`
  online, `decide` away, `ink-3` off). An agent shows its role character
  (`RoleFace`, lazy) in its member colour or `ink`, with its harness badge in
  the top-left corner; its eyes carry its state (`moodOf` in `kit/mood.ts`),
  so an agent has no pip.
- `Dot`: a task's state as one 8px mark: to do (`ink-2` ring), working
  (`doing` open ring, turning), in review (`review`, half filled), done (`live`,
  filled), needs you (`decide`, filled with a halo).
- `Count`: plain `ink-2` numerals; `is-loud` (`decide` fill) for what waits
  on you, `is-mention` (`accent` fill) for a mention.
- `Heading`: a section head in mono `t-stamp` `ink-3`, its action shown on
  hover. Section heads are never uppercase.
- `Empty`, `Loading`, `Toasts` (`ink` pill with `on-ink` text, bottom
  centre; one goes after 2.6 s, an error stays with a Dismiss button until
  dismissed; copying goes through `copyText`, which says Copied or why not), `.codebox` (a `bg-3` box of mono text with Copy), `Boundary`
  (every channel view renders inside one).
- Icons: `Icon` in `ui/src/kit/icons.tsx`, 16px line icons drawn in
  `currentColor` at a 1.4 stroke on a 16 grid, plus Hugeicons (24 grid, 1.5
  stroke) where one is used (the gear). A new icon is a path added there;
  no icon font and no icon package.

## 8. Semantic colors

- Five state colours and nothing else carries meaning: `live` (online, done,
  passed, additions), `doing` (working, running), `review` (in review),
  `decide` (waiting on a person: needs you, a permission, an ask), `alert`
  (failed, deletions, errors, danger).
- Text in a state colour uses the `.tone-*` classes; a chip behind it uses
  the matching `-wash`.
- `accent` is for links, a mention and the rare chosen-from-a-set mark. It
  never fills a button.
- A diff bar is `live` and `alert`; checks read `checks passed` in `ink-2`,
  running in `decide` or `doing`, failed in `alert`.
- No charts yet. If they come: one hue per series from the state colours or
  `c-*`, tabular numerals for every number.

## 9. App patterns

- **Shell.** One grid on `bg`, three columns: the sidebar (`--side-w`), the
  work, the second sidebar (`--side-w`). There are no tabs and no separate
  rail. The top bar (`--top-h`) spans them and drags the window: at its left
  the sidebar toggle and Search, side by side, in the same place whether the
  sidebar is open or hidden (after the traffic lights on a Mac); on the
  window's centre a quiet title in `ink-2` (the room, the person, or the
  view's name). A `decide` "paused" chip joins Search while the agents are
  paused, on every view but the conversation, whose banner already says it.
  Search opens into a field that grows from its button to the sidebar's edge.
  Under the bar the sidebar starts with the channels, in a row that wraps:
  home, one 40px tile per channel (its icon or first letter, a `decide` badge
  for what waits, a folder as a tile of four minis), then +. Pointing at a
  tile drops its name under it. The Settings gear sits in the window's
  bottom-left corner. ⌘\ hides the sidebar: its column goes to the work, the
  toggle and Search stay where they are, and touching the window's left edge
  slides the sidebar in over the work until the pointer leaves it. No borders
  between the columns.
- **Sidebar.** Under the tiles, the channel's name (its menu: settings,
  invite, mute, end), then the channel's views as rows with an icon: Needs
  you in `decide` with its count, only while something waits; Specs; Agents;
  GitHub once a repo is linked. A view row carries a mark only when something
  needs a look: a `decide` dot on Specs while one waits on you, an `alert` dot
  on GitHub while an open pull request's checks failed. Ambient numbers (open
  specs, open pull requests, who's working) live in the row's `title`.
  Every row is one `--row` line (32px), its text on one edge after a `--slot`
  icon column (24px: the `#`, a face, an icon). Three sections with a mono
  head: Rooms (`#` rows, the people icon for a members-only room), People and Agents. Each
  member is listed once, and the row is your conversation with them: a click
  opens the DM, its unread count sits on the row, and the profile is in the
  row's menu (and in the Agents view). You aren't listed. A person's pip
  carries their presence. Agents at work are rows like people: the face, the name,
  and one mono word of what it does now (`thinking`, `running Bash`) at the
  row's end in `ink-2`, cut with an ellipsis; "needs a person" reads
  `decide`. Agents at rest (idle, offline, left) have no row: they fold into
  one line of faces under the working ones, on the same column and at the
  same size as the rows' faces, each a click to its conversation with its
  name and state on hover. One with unread messages, or whose conversation is
  open, is a row again. Each new step rises in on `--fast`; the
  task waits in the row's `title`. Working agents come first, the lead first
  among them. A DM with someone no longer listed follows
  the people; conversations between
  others fold into one row under the agents ("Others' direct messages", with
  a count). A section's + (New
  room, Invite people, Add an agent) shows when the pointer is over the
  section; it becomes a row only while the section is empty. The open row is
  on `wash-2`; a row with news is 600 with a count. Cards for what waits on
  you (an update, a device) sit at the foot under a
  16px fade: the text, then the action on its line's end, or under it when
  the text needs the width.
- **Second sidebar.** The right column (`--side-w`) is one place with two
  states. At rest, on every view, it holds Now and Activity. Now is the task
  tracker: the counts (in progress, done today) in mono beside its name, or
  on their own line under the toggle, then a 4px bar with one
  segment per state in the state colours, the next step, and the open tasks
  as rows, the ones that need you first (a `Dot`, the title in full on up to
  two lines, steps done of all in mono when the task has steps; no face, the
  owner is in the row's `title`), eight at most and "+N more" to Specs.
  Activity is the open conversation's event log, newest first under a line
  per day: each event on up to two lines with its time, Open on a task's
  event, and a run of events folded into its last one. When the conversation
  has both, a `Seg` in the head picks one and the choice is kept; with only
  one, the head is its name. A link to an event opens Activity on it. On a
  wide window it stands in for the Now card at the top of Specs. An open
  spec is the exception: it reads across both columns, with no tracker
  beside it, so its comments keep their margin. A row opens
  the task in this same column, and closing it brings the tracker back. A
  thread, a task, a PR or an issue opens here too; at the column's own width
  that moves nothing, the composer included. A panel someone has dragged
  wider takes the extra width from the work and never lies over it. A window
  under 1180px wide has no third column: no tracker, and a panel lies over
  the work. Whenever the column is not there for it (that window, an open
  panel, an open spec), Activity is an icon beside Search that opens the same
  log in a popover under it.
- **Right panel** (`--side-w` to start, wider by its grip): a thread,
  a task, a PR or an issue slides in from the right (`panel-in`)
  beside the conversation, with a title, a mono sub line and a close button.
  A thread keeps its own composer.
- **Conversation.** Everyone else on the left with no bubbles, in the
  `--col` column; your own messages on the right as bubbles (the text on
  accent 20% over `bg-2`, `r-win`, no face and no name, the time above, at
  most 36rem wide), the way Messages tells the two sides apart. Everything a
  message carries besides its text (pictures, a task chip, reactions, the
  replies line) lines up on the same side, outside the bubble.
  A message is a 32px face, 16px of gap, then the name (600), the "to you" or
  "asks you" word when it's for you, and the mono time, and the text in
  `t-body` under it. Role and harness are not repeated on every message: the
  role is the name's hover text, the harness is the badge on the face. A run from one sender keeps one
  header (`is-compact`). A reply carries one quoted line with a return arrow.
  Task cards, PR lines and reactions sit under the text on `bg-2`. Under a
  message, "N replies" with who and when opens the thread. A pending message
  is at 55%; a failed one gets an `alert-wash` band. Working agents show as
  a mono line of dots under the last message only when the sidebar, which
  already says it, is hidden.
- **Tasks** live inside specs: the Specs view carries the Now card on top,
  folded to its one line (next step, in progress, needs you, done today) until
  someone opens it. Each spec row ends in a mono `done/all tasks` toggle; its
  open tasks stay folded under it unless one waits on you or is open in the
  panel. A task row is its `Dot`, the title in `t-body`, the owner's face, and a
  mono line of id, state (only when it says more than the dot), PR and age: on one line, the mono part on the right, when the view
  is wide (820px and up), two lines when it isn't. Tasks filed before specs sit
  in a "Not in a spec" card that shows three until Show all. A person adds a
  task on an approved spec's Inside.
- **GitHub.** Fills the content area up to `--list`, like Specs. Pull requests and Issues as one segment control with their
  open counts, a filter field beside it (title, number, author, branch), then
  Open and Closed and, with several repos, the repos as segments. Items sit in
  cards like Tasks, by what needs attention: open pull requests by their checks
  (failed, with an `alert` dot and label, running in `doing`, ready, no checks
  yet), closed ones as merged and closed; issues as not picked up and being
  worked on, then done and not planned. A row: the GitHub state mark (open
  `live`, merged or done `review`, closed or not planned `ink-2`), the title
  on one line (it truncates only when it must), a mono line of number, repo, author and age; on the right the checks as
  ticks and a short word, the diff bar when there is room, and the task as a
  `Dot`, its id and its owner's face; an external link shows on hover. A row
  opens its panel: the title, the state line, props (repo, branch with copy,
  author, size, when), every check with its link (failing on `alert-wash`
  first), the task, and Open on GitHub as the one primary button. A task's
  panel shows a compact PR card with passing checks folded, and its issue.
- **Specs.** The work view, one row in the sidebar, and the only way in: the
  sidebar doesn't list specs again. The view fills the content area up to
  `--list`; a spec page is `--col` + 400px wide. A segment for Open and Done, a quiet line and New spec as the
  view's one primary button, then cards like GitHub's by what each spec needs
  (Needs you in `decide`, Working in `doing`, Waiting for an agent with how
  many are free, Drafts), each head one line: the label, its count and a quiet
  sentence. A row: the spec's mark (a dashed ring for a draft, a ring once
  approved, an open `doing` ring while working, `decide` filled with a halo
  when delivered, `live` when accepted), the title, a mono line of ask, who
  asked, age, boxes done and where it stands (on the title's line, to the
  right, when wide), the faces of the agents on it, the stage word and the
  tasks toggle. A spec opens in the main area. Its head is one row: a back
  icon, the title at `t-display` with a mono stage chip, and on the right the
  segment for Spec, Inside and Result and Edit. Under it a mono sub line (who
  asked and approved, where it stands, versions, writers) and the person's
  words quoted as written. The gate card (`decide-wash`, with the one primary
  button) shows only while the spec waits on a person: a draft to approve, a
  change to approve, a delivery to judge. Spec is the markdown in a card with
  a margin rail beside it: comments on a line sit beside the line they quote,
  and comments on the whole spec sit in the rail too, above the first line
  comment when they fit and under the last one when they don't (under the
  card on a narrow window). They show the latest three behind All N, as
  compact rows with hairlines between them, and the comment field is one line.
  Selecting words offers Comment. A change after approval shows as a line
  diff (`live` added, `alert` removed) with one line of context around each
  change; the unchanged runs fold into a "⋯ N unchanged lines" row that opens
  the whole diff. Inside is the alarms (`alert-wash` or `decide-wash`), then
  two columns once the page is 960px wide: the work (a mono head line with
  boxes done and last move, the agents' faces and Ask where it stands, then
  the task rows with their PR chip, number, size and checks, on the row's
  right) and what happened (the latest five moves with mono times, All N for
  the rest), and every message behind one quiet line. Result is the verdict
  card with Drop it, Send back and Accept on its right, then Done when (with
  what was tried) beside what came of it. Under the person's message in
  #general a spec card on `bg-2` follows the stage, and a run of messages
  between agents folds into one mono line with their faces and Show.
- **Needs you.** Fills the content area up to `--list`. A mono count line, then one card per thing waiting (the same
  card as Tasks), oldest first: who and what (a `decide` chip for a permission), the detail (a
  command or a diff in mono boxes), and the answers as buttons, the main one
  `is-primary`.
- **Agents.** One card per agent, in a grid that wraps (nothing scrolls
  sideways): face, name, and one status line under it (what it's doing,
  "for X" only when it's someone else's; model and sponsor on hover), then
  its tasks with PR and check ticks, Up next, Watching, and its last moves
  with mono times.
- **Settings.** The sidebar trades the channels for Settings' sections (the
  open one on `wash-2`) under a `‹ Settings` back button. The page sits beside
  them, up to 720px: a `t-display` title (a quiet line under it only when it
  says a scope or a limit), then groups of rows on the page under mono group
  heads, hairlines between rows: a title, a quiet line only when it says what
  the title can't, and the control on the right. No cards around groups.
  Agents is personalities, harnesses, then This computer. Personalities are
  cards in a grid (three across, two on a smaller window, one on a phone):
  the role face, the name and one line, then an outlined New personality
  card. Harnesses are rows with the harness's own logo, the name and version,
  the path under them, and the hooks state with its one action on the
  right; the ones not installed fold into one quiet line, and kiwi's own
  state sits on the right of the group head.
- **Palette** (⌘K), **Search** and the **annotator**
  (a picture opened full window, marked up and sent back) float with
  `shadow-pop` and their own enter animation. The palette is `bg-2` at
  `r-win`: the field ("Jump to…") over a hairline, then the groups, the
  chosen row on `wash-2` at `r-ctl` (8px in, concentric). No footer of key
  hints: arrows, Enter and Escape are what a list does.

## 10. Composer

- A floating, frosted card at `r-win`: `bg-3` at 68% over an 18px blur, a
  `line-2` border (`line-3` while focused) and `shadow-float`. It's centred in
  the column at the bottom of the conversation (and of a panel), and the
  thread scrolls under it. The thread keeps room below its last message for
  the card's height, so the last message always clears it. Top to bottom: the
  reply bar, attached images, the writing space, then a control row with +
  (attach) on the left and send on the right (Jow #5138, #5140, #5153).
- In a thread with a doc, the composer is where you write: sending adds your
  block to the doc and posts it, and the doc itself takes no typing.
- Send is a round button a little under `--ctl`: `ink` with `on-ink` when
  there is something to send, `line-2` when not. Enter sends and
  Shift+Enter is a new line.
- Typing `@name` or a task id (`T12`) opens a list of people or tasks just
  above the composer; arrows move, Enter or Tab picks.
- Drag-and-drop and pasted images attach in the composer; a drop shows
  "Drop images to attach" over it.
- ⌘S stashes the draft and ⇧⌘S brings back the newest: the "N stashed" chip
  above the composer opens the stash list (click a row to bring it back, ⌫
  drops one). The line under the composer says what just happened in mono.
- A row in a list over the composer keeps focus where it is on mousedown
  (`onMouseDown` → `preventDefault`): WebKit doesn't focus a clicked button,
  and a blur would close the list before the click lands.

## 11. Accessibility (mandatory)

- Focus: `:focus-visible` draws a 2px `ink` outline, 2px out.
- Selection: `--selection` (ink at 28%). Scrollbars: thin, `line-3` thumb on
  transparent.
- Text size (Settings: Small, Default, Large, Larger, Largest) sets `--text-scale`,
  which scales the root font size. Type, text boxes, icons and the columns
  sized for text grow with it because they are in `rem` (sections 4 and 5).
- Reduced motion: the OS setting and Settings' own toggle both cut motion
  (section 6).
- `ink-3` is the lowest ink for text. Placeholders and empty states use it,
  never opacity.
- Icon-only buttons carry an `aria-label`; an `Icon` with a `label` is an
  image, without one it is hidden from screen readers.

## 12. Faces and marks

- Agents wear a role character (`kit/characters.ts`): a silhouette per role
  and an eye rig (lead cat, builder ghost, reviewer shield, bug-hunter
  spider, explorer magnifier, releaser rocket; any other role, or none, a
  chat bubble). No tile and no frame; it takes the member colour or `ink`.
  The eyes are die-cut and say what the agent is doing: open (free), up
  (thinking), narrowed and scanning (running a tool), wide with a `decide`
  "!" (waits on a person), `> <` with the body squashed (overloaded), happy
  arcs with a `live` spark (just finished a task, for a few seconds), `alert`
  crosses (its PR's checks are red and it isn't working on them), shut and
  faded (offline). Each still pose reads on its own from 16px; a move (a
  hop, a shake, a perk) plays once when the state starts, and thinking and
  running a tool sway a few times, then rest. Their harness rides as a badge
  in the top-left corner, die-cut out of the face, in its `h-*` colour or
  `ink`. A badge is the lab's own
  published mark where its brand allows (Cursor, OpenCode, Pi); the rest keep
  today's icons until their brands answer. People wear their picture, or their
  initials in their member colour.
- A channel's tile in the sidebar is its icon, or its first letter.

## 13. Do and don't

Do: use the tokens, Paper Mono for the machine's words and the text font
(the system font unless Settings > Appearance > Font picks another) for
people's, tabular numerals for counts and times, one `is-primary` button
per view, state colours only for states, hairlines and fill steps to separate
surfaces.
Don't: hard-code hex, add a font outside the Font setting, add glass, blur or decorative gradients,
fill a button with the accent, add coloured shadows, or animate anything
that isn't answering an action.

Words: show the least that says what someone needs. A line the layout
already says goes (a page subtitle that repeats its title, a status in a
header and again in the rows below, the harness name on every message when
the face carries its badge, an empty state under a composer that invites
the same thing). Explain only what someone can't see: a consequence, a
limit, a scope. More specific detail waits for a more specific intent (the
profile, the task panel), not every row.

Names: people read nicknames, and only nicknames. A handle (`cheery-fox`)
is for agents and commands; a person never has to read one. Wherever the
UI shows a member (a message's author, the sidebar, a mention, a task's
owner or reviewer, an event line, a toast) it shows their
nickname, and a member without one shows their handle as the fallback.
That includes members who have left. `@handle` and a bare handle in a
message's prose read as the nickname too; code, links and paths keep the
handle as written, because commands need it. In `ui/`, go through
`nickname()` and `shown()` in `ui/src/names.ts`, never `.name` or `.from`
in text.

## 14. The iPhone app

The native app in `ios/` (SwiftUI) is Discord's shell around the Claude Code app's sessions
(owner, 11-07 #230), built from stock SwiftUI controls (#187). It carries the desktop's
structure (#160): channels, then each channel's rooms, people, agents and tasks. The goal is
that a VPS and an iPhone are enough (#165), so whatever the sidebar can do, the phone should
reach. Its look is the desktop's: §3's tokens on stock controls.

- **Every place in the channel.** Rooms, direct threads (with people, with agents, between
  others) and task threads all open on the phone, each as one conversation screen.
- **Type, colour, faces.** SF Pro through Dynamic Type (`Step`). `Tone` carries §3's tokens
  for the theme picked in Settings > Appearance (every desktop theme; Channels Dark and Channels
  Light by default). `bubbleMine` is ink with `onInk` text,
  `bubbleThem` the raised fill; the accent is for actions and links only. Round buttons, the
  name pill, the composer and the search capsule are Liquid Glass tinted with `raised`
  (flat `raised` with a hairline before iOS 26). Agents wear §12's
  role face (`ios/scripts/faces.ts` writes it from `ui/src/kit/characters.ts`) with the
  harness as a top-left badge, drawn in the member colour (`c-*`) when it has one; a person is
  one letter in a circle, in their colour on an 18% wash of it. A channel's face is the desktop rail's:
  its picture, else its title's first letter.
- **The shell.** It opens on your last conversation, full screen. Swipe right (or tap the
  menu button, which wears a dot when something elsewhere is unread or waits on you) and the
  conversation slides aside to show the rail and the sidebar; swipe left for the members.
  Horizontal swipes belong to the shell, so a conversation has none of its own.
- **The rail** (72pt): Needs You on top (an inbox, `decide` when anything waits, with its
  count), then each channel's face with a white pill for unread or the one you're on and an
  `alert` count of what waits there; Search and You at the bottom, as sheets.
- **The sidebar** is the picked channel's stock list: #general, a direct thread with every
  member (lead first, then who works, then the latest) and Tasks with its open count. A tap
  opens it in front and closes the drawer.
- **Needs You** in the sidebar lists what waits on you across channels; a tap opens it.
- **Members** (from the right): the lead, who works and on what, everyone else; a tap writes
  to them.
- **Tasks** (from the sidebar): Working, In review, To do, Done; a task opens its thread.
- **A conversation is one screen.** Header: a round back button (a blue dot when another
  channel is unread; hold it and slide for Previous, Needs You, Unread, Recent across
  channels), the centred name pill ("2 working · 1 needs you", "working on T8",
  "here"/"away"; a tap pushes the details), and at the trailing edge the other conversation:
  the lead's face in #general, the channel's icon in the lead chat, with a blue dot when it
  has unread messages or a `decide` dot when a question waits there. One tap slides across:
  #general sits on the left, the lead on the right. Both conversations ride every update,
  so switching never waits.
- **Nothing that needs you hides.** A question for you asked anywhere else in the channel
  (in a task thread, between agents) shows in #general at the moment it was asked, as a poll
  card under "win · in T8".
- **Transcript.** Bubbles: yours right in blue, others left in grey, a tail on the last of a
  run, the sender's name over the first and their 30pt face beside the last (none in the lead
  chat). A time header where 15 minutes or a day passed; events as one quiet centred line; a
  reply carries its quote. A conversation loaded from its start opens on an intro (face, name,
  a quiet line). Gestures are Messages': swipe a bubble right to reply, drag left for times,
  double-tap or long-press for tapbacks, tap a picture to zoom. The top fades the content under
  the header; the bottom never covers the last bubble.
- **Questions are polls** (Messages iOS 26): one grey card with "Question for you" in
  `decide`, the question, a row per option (a radio circle, ≥44pt) and "Something else…" in
  `accent`, which puts the composer in answer mode ("Answer win", with a bar you can cancel).
  A tap on an option fills the circle at once (medium haptic, then success); the chosen row
  takes the accent wash, the others dim, and the footer says "You chose". Your answer isn't drawn
  again as its own bubble. Which questions wait on you is the desktop's rule (`asksFor`), so
  both apps agree.
- **Composer.** A round `+` and the field (send inside it), nothing else; `@` chips
  while you type a name. Sending is instant: the field clears, your bubble is drawn at once
  with Messages' sent sound (silent mode mutes it), and the delivered message takes its place
  without a flicker. Only a failure speaks: a red "!" with Try Again and Delete, "Not
  Delivered". A draft (text and photos) stays with its conversation, in memory only.
- **Native presentations, nothing custom.** The details push from the name pill and Settings
  push from the gear, with the system back button. Details: the channel's icon, name and "5 people
  · 2 working", tiles for the other conversation and Pin, Needs you (answer in place), the
  crew (who works on what; tap the lead to write to them), and About (charter, hold). Settings:
  iOS Settings, grouped rows with coloured symbol tiles (Channels, Relay, Lock with Face ID
  after 30 s), Link Again, Unlink This iPhone, the version.
- No read receipts, no typing bubble, no "New messages" line: faces, the
  `doing` dot and "N working" carry agent state.

## 15. New-surface checklist

1. Use the tokens from `tokens.css` and the shared classes from `base.css`;
   add a class to the mono rule if it shows the machine's words.
2. Build from `ui/src/kit/` (`Modal`, `Field`, `Seg`, `Toggle`, `Avatar`,
   `Dot`, `Count`, `Icon`) before writing a new control.
3. Check it in dark and light, in Channels Dark, Cinder Peak, OLED Black and one Rex theme, at Large
   text and with reduced motion.
4. Add it to `ui/src/demo/shots.ts` and look at it:
   `bun scripts/shoot-app.ts --dist ui/dist --only <name> --theme dark,light`,
   and with `--browser webkit` (the engine of the desktop app).
5. Click through it in WebKit too: a click that works in Chromium can do
   nothing in WebKit (section 10).
6. Every member it names reads as a nickname, never a handle (section 13).

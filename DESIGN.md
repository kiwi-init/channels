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

Black and white, quiet, fast. A true black canvas (white in light), ink for
what matters and greys for the rest, the system font for what people read and
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
  side. Built in: OLED Black (`channels-oled`, the default dark), Channels
  Dark (`#111113`) and Channels Light (the default light), then the Rex
  themes (`rex-themes.ts`) and the person's own. `system` leaves
  `data-theme` unset so the media query decides.
- A theme that isn't built in is applied by `applyTheme()`: every token set
  inline on `<html>`. A custom theme is 13 base colours (background, text,
  accent, success, warning, danger, info and six ANSI-style hues);
  `compose()` in `derive.ts` derives the whole token set from them.
- A saved Channels Dark moves to OLED Black once (`movedDark`); every other
  saved theme is kept.

## 3. Color tokens

The two built-in sides, from `tokens.css` and `channels.ts`:

| Token | Dark (OLED Black) | Light |
|---|---|---|
| `bg` (canvas, rail, sidebar, panels) | `#000000` | `#ffffff` |
| `bg-2` (raised: dialogs, cards) | `#0c0c0d` | `#f7f7f8` |
| `bg-3` (fills: buttons, fields, tiles, tracks) | `#18181a` | `#efeff1` |
| `ink` | `#ececef` | `#18181b` |
| `ink-2` (secondary text, idle controls) | `#a3a3ab` | `#56565e` |
| `ink-3` (quiet floor: hints, placeholders, meta) | `#808089` | `#6c6c74` |
| `line` / `line-2` / `line-3` (hairlines, light to strong) | white 8 / 11 / 15% | black 6 / 9 / 13% |
| `wash` / `wash-2` (hover, pressed, chosen) | white 4.5 / 8% | black 3.5 / 6% |
| `scrim` (under a dialog) | black 70% | black 22% |
| `on-ink` (text on an `ink` fill) | `#000000` | `#ffffff` |
| `accent`, `link` | `#8ab4ff` | `#1a56db` |
| `accent-wash` | accent 14% | accent 8% |
| `live` (online, done, passed) | `#32d074` | `#1f9a55` |
| `doing` (working, running) | `#5b9bff` | `#2f6fe4` |
| `review` (in review) | `#b48cff` | `#7a4fd6` |
| `decide` (needs you) and `decide-wash` | `#f5b041`, 12% | `#a35a00`, 10% |
| `alert` (failed, error, danger) and `alert-wash` | `#ff6259`, 12% | `#d1342a`, 8% |

- `selection` is ink at 28%. `white` is for a knob or a glyph on a coloured
  fill.
- `c-red … c-brown` are the member colours: a person's initials and the
  tint behind them (`.av[data-color]`, 18%). They never colour chrome.
- `h-claude, h-codex, h-gemini, h-opencode` colour the harness badge on an agent's face.
- Channels Dark is the same set on `#111113` / `#18181b` / `#212125`.

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
  the header's summary line, the composer's hint, keys (`kbd`), code and
  paths. The list is the `html .msg-time, html .count, …` rule and the
  `code, pre, kbd, .mono, .codebox, …` rule in `base.css`; a new
  machine-word class joins it there, with `letter-spacing: -0.01em`.
- Six steps and no sizes between them, all scaled by `--text-scale`
  (Default 1.1; Small 1, Large 1.25, Larger 1.4, Largest 1.6): `--t-stamp 11px` (times, counts),
  `--t-meta 12px` (meta lines, section heads), `--t-ui 13px` (rows, names,
  buttons, menus), `--t-body 15px` (messages, task titles; message text at
  22px line height), `--t-title 17px` (panel and dialog titles),
  `--t-display 24px` (empty states, page headings).
- Weights: 400 for text, 500 for buttons and tabs, 600 for names, titles and
  what's chosen. Hierarchy comes from weight, ink level and size, not from
  new faces.
- Numbers that line up (counts, times, sizes, diff stats) use
  `font-variant-numeric: tabular-nums` (`.num`).
- Body text is antialiased with `optimizeLegibility`.

## 5. Radius, shadow, layout

- Spacing: padding, margin and gap sit on one scale: 0, 1, 2, 4, 6, 8, 10, 12,
  16, 20, 24, 32, 40, 48, 64. `test/ui-design-scale.test.ts` fails on anything
  else.
- Rhythm: a page has `--gutter` (24px) at its sides, 24px above and 48px below.
  A card is `bg` with a 1px `line-2` border, `--r-card` and text inset
  `--card-pad` (16px). A list of cards has 12px between them; sections of a
  page or panel have 24px or 32px between them. A panel's text is inset 16px.
- Control heights: `--ctl` (32px: buttons, fields, tabs, tracks, the channel
  switcher, sidebar rows, send, attach) and `--ctl-sm` (24px: small buttons).
  A quiet button or icon button at the end of a row is pulled out by its own
  padding so its text or glyph lines up with the row's right edge.
- Radii, only from tokens: `--r-tick 2px` (bars, ticks), `--r-tag 6px` (tags,
  inline code), `--r-row 8px` (rows, small buttons, icon buttons, segments),
  `--r-ctl 10px` (buttons, fields, segmented tracks, toasts, tiles, messages on
  hover), `--r-card 14px` (cards), `--r-win 18px` (the composer, dialogs).
  `999px` is for counts and the toggle track only. Avatars of people are round;
  agents and channel tiles are rounded squares.
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
- No glass, no `backdrop-filter`, no blur anywhere. The fade over the bottom
  of the conversation (`.main::after`, 96px, transparent to `bg`) is a plain
  gradient: text under it fades but stays sharp.
- Fixed sizes on `:root`: `--rail-w 64px` (channel tiles), `--side-w 248px`
  (the sidebar), `--panel-w 400px` (the right panel), `--top-h 52px` (the
  top bar, which drags the window), `--col 760px` (the reading column),
  `--compose-space 128px` (room under the last message for the composer).

## 6. Motion

- Motion answers an action: something opens, arrives or moves because someone
  did something. It is felt, never watched: short, soft, and nothing plays
  twice for the same event. Three things loop: the working dots under the
  conversation (`blink`), a working task's `Dot` (`spin`, 6s) and the current
  step's mark while adding an agent (`spin`).
- CSS first, and no animation library. Two speeds and one ease for fades and
  fills: `--fast 0.16s`, `--slow 0.28s`, `--ease cubic-bezier(0.32, 0.72, 0, 1)`.
  Two springs for things that move, written as `transition: transform var(--glide)`:
  `--glide` (0.48s, a slight overshoot: selections, panels, dialogs, cards) and
  `--pop` (0.35s, livelier: presses, marks, counts, toasts).
- The selection glides. One pill moves between tabs, segments and sidebar rows
  (`useGlide` and `Track` in `ui/src/kit/glide.tsx`) instead of each option
  lighting up on its own.
- Pressing a control dips it to 0.96 and it springs back on `--pop`. This is the
  only scale on a resting control. Rows take hover at once and let it go slowly.
- A change is marked once: a `Dot` pops when its status moves and rings when it
  turns done (`done-ring`), a `Count` rolls to its new number (`count-roll`),
  both through `useMoved`, so opening a view animates nothing that didn't change.
- A message that arrives lands with `land()`: 8px up, 16px for your own, and only
  for what just came in, never history or a scroll.
- A view's cards rise in a short stagger when it opens (30ms apart, 120ms at
  most). Clearing Needs you draws a tick (`tick-draw`).
- Keyframes: `rise` (6px up and in), `fade`, `panel-in` (the right panel, 12px
  from the right), `dialog-in`, `toast-in`, `pop-in`, `palette-in` (6px down),
  `term-in` (the terminal drawer, 16px up), `jump-in` (Jump to latest),
  `tile-bar` (the rail's mark), `msg-flash` (a message you jumped to, 1.6s).
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
- The top bar floats its controls: the channel switcher and the sidebar
  button are each one `float` object (`r-ctl`, `shadow-float`); the view tabs
  are one `float` group with the chosen tab's pill gliding inside it, and
  search and the terminal share a second group (`.top-group`, 2px inset,
  28px buttons at `r-row`). The search field floats the same way when open,
  and on a narrow window it takes the tabs' place. The other bars follow:
  Settings' back button and a panel's close button float too, and so does
  the rail: home, every channel tile, + and the Settings gear (a tile still
  waiting to be let in keeps its outline and no fill). In the terminal
  drawer the tabs and + are one `float` group and close floats. Hover on a
  floating control is `float-2` (the `float` fill, 10% toward `ink`); the
  chosen one is `float-3` (20%).
- Fields (`.input`, `.textarea`, `Field` with label and hint): `bg-3` fill,
  `--ctl` high, `t-ui`; `.input.is-mono` for codes and paths.
- `Seg` (`.seg`): a `bg-3` track, the chosen segment on `wash-2` in `ink`
  and 600.
- `Toggle`: a 36×22 track, `live` when on with a white knob.
- `Dialog` / `DialogHead`: `bg-2`, `r-win`, `shadow-pop`, 480px (720px
  wide), rises in. A dialog is for one decision or a short form; Settings
  and the panels open in place.
- `Avatar` (`.av` 32px, `av-sm` 24px, `av-lg` 56px) with a presence `pip`
  (`live` online, `decide` away, `ink-3` off). A person shows their picture
  or initials in their member colour; an agent shows its role face
  (`RoleFace`, lazy) in `ink`, with its harness badge in the top-left corner.
- `Dot`: a task's state as one 8px mark: to do (`ink-2` ring), working
  (`doing` open ring, turning), in review (`review`, half filled), done (`live`,
  filled), needs you (`decide`, filled with a halo).
- `Count`: plain `ink-2` numerals; `is-loud` (`decide` fill) for what waits
  on you, `is-mention` (`accent` fill) for a mention.
- `Heading`: a section head in mono `t-stamp` `ink-3`, its action shown on
  hover. Section heads are never uppercase.
- `Empty`, `Loading`, `Toasts` (`ink` pill with `on-ink` text, bottom
  centre), `.codebox` (a `bg-3` box of mono text with Copy), `Boundary`
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

- **Shell.** Three columns on `bg`: the rail (`--rail-w`: one 38px tile per
  channel, a `decide` badge for what waits, + after them and the Settings gear
  at its foot, on every page; on a Mac the traffic lights sit above it, the rail
  is 80px so tiles centre under them, and `--top-h` is 46px so the bar centres
  on them), the sidebar (`--side-w`) and the main area.
  The top bar spans the sidebar and the main area (`--top-h`): the sidebar
  toggle first at the left edge, then the channel switcher, both in the same
  place whether the sidebar is open or collapsed; the views in the middle
  (`# room`, Tasks with its count, Agents, GitHub with its open pull
  requests once a repo is linked and a dot in `alert` while an open one's
  checks failed, Needs you in `decide` with its count), the open one on
  `wash-2`; on the right a mono summary
  (`2 working · 1 merged today · 7 need you`), Search and the terminal.
  No borders between the columns.
- **Sidebar.** Every row's text starts on one edge, after a 24px icon column
  (the `#`, a face, an icon). Sections with a mono head: Rooms (`#` rows), Direct, People
  (face, name, a mono role and status line), Agents (face with presence,
  name, what it runs now in `doing`), each with its + row (invite, add
  agent). The open row is on `wash-2`; a row with news is 600 with a count. A
  member shows a status line only when there is something to say (working,
  waiting, away, offline), and a role that repeats their name is left out. Cards
  for what waits on you (an update, a device) sit at the foot.
- **Right panel** (`--panel-w` to start, resizable by its grip): a thread,
  a task, a person or the channel slides in from the right (`panel-in`)
  beside the conversation, with a title, a mono sub line and a close button.
  A thread keeps its own composer.
- **Conversation.** No bubbles, everyone on the left, in the `--col` column.
  A message is a 32px face, 16px of gap, then the name (600), a mono role, harness and
  time, and the text in `t-body` under it. A run from one sender keeps one
  header (`is-compact`). A reply carries one quoted line with a return arrow.
  Task cards, PR lines and reactions sit under the text on `bg-2`. Under a
  message, "N replies" with who and when opens the thread. A pending message
  is at 55%; a failed one gets an `alert-wash` band. Working agents show as
  a mono line of dots under the last message.
- **Tasks.** The Now card on top (what's working, what needs you, done
  today), the add field, then a card per person's ask: their words in quotes
  as the heading, who and `from #N` under it, then a two-line row per task
  (its `Dot`, the title in `t-body`, a mono line of id, owner, state and
  age), with its PR number, diff bar, additions and checks on the right.
- **GitHub.** Pull requests and Issues as one segment control with their
  open counts, a filter field beside it (title, number, author, branch), then
  Open and Closed and, with several repos, the repos as segments. Items sit in
  cards like Tasks, by what needs attention: open pull requests by their checks
  (failed, with an `alert` dot and label, running in `doing`, ready, no checks
  yet), closed ones as merged and closed; issues as not picked up and being
  worked on, then done and not planned. A row: the GitHub state mark (open
  `live`, merged or done `review`, closed or not planned `ink-2`), the title,
  a mono line of number, repo, author and age; on the right the checks as
  ticks and a short word, the diff bar when there is room, and the task as a
  `Dot`, its id and its owner's face; an external link shows on hover. A row
  opens its panel: the title, the state line, props (repo, branch with copy,
  author, size, when), every check with its link (failing on `alert-wash`
  first), the task, and Open on GitHub as the one primary button. A task's
  panel shows a compact PR card with passing checks folded, and its issue.
- **Specs.** A segment for Open and Done, a quiet line and New spec as the
  view's one primary button, then cards like GitHub's by what each spec needs
  (Needs you in `decide`, Working in `doing`, Waiting for an agent with how
  many are free, Drafts). A row: the spec's mark (a dashed ring for a draft,
  a ring once approved, an open `doing` ring while working, `decide` filled
  with a halo when delivered, `live` when accepted), the title, a mono line
  of ask, who asked, age, boxes done and where it stands, and the faces of
  the agents on it. A spec opens in the main area: back to Specs, the title
  at `t-display` with a mono stage chip, a mono sub line, the person's words
  quoted as written, then the gate card (`decide-wash` while it waits on a
  person, with Approve as the primary button) and a segment for Spec, Inside
  and Result. Spec is the markdown in a card with comments in a margin rail,
  each beside the line it quotes; selecting words offers Comment. A change
  after approval shows as a line diff (`live` added, `alert` removed). Inside
  is one mono glance line, the alarms (`alert-wash` or `decide-wash`), the
  work as task rows with their PR chips, the story with mono times, and every
  message behind one quiet line. Under the person's message in #general a
  spec card on `bg-2` follows the stage, and a run of messages between agents
  folds into one mono line with their faces and Show.
- **Needs you.** A mono count line, then one card per thing waiting (the same
  card as Tasks), oldest first: who and what (a `decide` chip for a permission), the detail (a
  command or a diff in mono boxes), and the answers as buttons, the main one
  `is-primary`.
- **Agents.** One card per agent, in a grid that wraps (nothing scrolls
  sideways): face, name, `for person ·
  model`, a status line with a coloured dot, its tasks with PR and check
  ticks, Up next, Watching, and its last moves with mono times.
- **Settings.** The sidebar trades the channels for Settings' sections (the
  open one on `wash-2`) under a `‹ Settings` back button. The page sits beside
  them, up to 720px: a `t-display` title, a quiet line, then groups of rows, each
  group a card (hairlines between rows; a title, a quiet line and the control on
  the right).
- **Palette** (⌘K), **Search**, the **terminal drawer** and the **annotator**
  (a picture opened full window, marked up and sent back) float with
  `shadow-pop` and their own enter animation.

## 10. Composer

- A floating `float` card at `r-win` with `shadow-float`, the same object as
  the chrome's buttons, centred in the column at the bottom of the
  conversation (and of a panel), over the fade. Top to bottom: the reply
  bar, attached images, the row with + (attach), the textarea and send.
- Send is a `--ctl` `r-ctl` square: `ink` with `on-ink` when there is something
  to send, `line-2` when not. Enter sends (or ⌘Enter, per Settings).
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
  which every type step multiplies; layout sizes don't scale.
- Reduced motion: the OS setting and Settings' own toggle both cut motion
  (section 6).
- `ink-3` is the lowest ink for text. Placeholders and empty states use it,
  never opacity.
- Icon-only buttons carry an `aria-label`; an `Icon` with a `label` is an
  image, without one it is hidden from screen readers.

## 12. Faces and marks

- Agents wear a role face: one ink shape per role with two eyes (lead star,
  builder block, reviewer hexagon with big eyes, bug-hunter triangle with
  narrowed eyes, explorer diamond, releaser rocket; any other role a capsule).
  No tile and no frame; it follows the theme's `ink`. Their harness rides as a
  badge in the top-left corner, die-cut out of the face, in its `h-*` colour or
  `ink`; the bottom-right stays the presence pip. A badge is the lab's own
  published mark where its brand allows (Cursor, OpenCode, Pi); the rest keep
  today's icons until their brands answer. People wear their picture, or their
  initials in their member colour.
- A channel's tile on the rail is its icon, or its first letter.

## 13. Do and don't

Do: use the tokens, Paper Mono for the machine's words and the text font
(the system font unless Settings > Appearance > Font picks another) for
people's, tabular numerals for counts and times, one `is-primary` button
per view, state colours only for states, hairlines and fill steps to separate
surfaces.
Don't: hard-code hex, add a font outside the Font setting, add glass, blur or decorative gradients,
fill a button with the accent, add coloured shadows, or animate anything
that isn't answering an action.

Names: people read nicknames, and only nicknames. A handle (`cheery-fox`)
is for agents and commands; a person never has to read one. Wherever the
UI shows a member (a message's author, the sidebar, a mention, a task's
owner or reviewer, an event line, a toast, a notification) it shows their
nickname, and a member without one shows their handle as the fallback.
That includes members who have left. `@handle` and a bare handle in a
message's prose read as the nickname too; code, links and paths keep the
handle as written, because commands need it. In `ui/`, go through
`nickname()` and `shown()` in `ui/src/names.ts`, never `.name` or `.from`
in text.

## 14. The iPhone app

The native app in `ios/` (SwiftUI) is Apple Messages, all the way: the same structure, the
same gestures, the same speed. The owner asked for it, so on the phone it wins over §9's rows.

- **Two conversations per channel, nothing else.** On the phone you see each channel's
  #general and your direct chat with its lead. Other direct threads, threads between agents
  and task threads stay on the Mac: the lead reports in #general and answers you directly.
  When you are the lead, there is only #general.
- **Type, colour, faces.** SF Pro through Dynamic Type (`Step`). `Tone` tokens, the dark
  canvas true black, `bubbleMine` the accent and `bubbleThem` Messages grey. Agents wear their
  harness logo; people their initials. A channel's face is its desktop icon, never a
  phone-only one: the prism glass head its owner picked (the twelve in `assets/avatars`, as
  vectors), its emoji or its picture, and with none the head the desktop picks from its title.
- **One list, like Messages.** Every channel's #general (a group row: the channel icon, a
  `doing` dot when an agent works) and its lead chat (the lead's face; " · onemouse" and a
  small channel badge when you have two or more channels; always there, so you can write to
  the lead first), newest first. A row: blue unread dot, 52pt avatar, name, Messages time and
  chevron, two quiet lines: "Needs you:" in `decide` when a question waits on you, "Draft:"
  in `alert`, else the last message. Pins sit on top as a 3-column grid of 80pt avatars with a
  peek bubble. Top: an "Edit" menu (Settings, Mark All as Read), the title, a Filter menu
  (Conversations, Needs You, Unread) with a `decide` dot when something waits on you. Bottom:
  a glass search capsule (its magnifier turns into a chevron that ends search). Swipe a row
  for Read/Unread and Pin; long-press it for a live preview and a menu that answers a waiting
  question on the spot, opens the other conversation, pins or marks read.
- **A conversation is one screen.** Header: a glass back circle (a blue dot when another
  channel is unread; hold it and slide for Previous, Needs You, Unread, Recent across
  channels), the centred glass name pill ("2 working · 1 needs you", "working on T8",
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
  wears the Prism, the others dim, and the footer says "You chose". Your answer isn't drawn
  again as its own bubble. Which questions wait on you is the desktop's rule (`asksFor`), so
  both apps agree.
- **Composer.** A glass `+` and the glass field (send inside it), nothing else; `@` chips
  while you type a name. Sending is instant: the field clears, your bubble is drawn at once
  with Messages' sent sound (silent mode mutes it), and the delivered message takes its place
  without a flicker. Only a failure speaks: a red "!" with Try Again and Delete, "Not
  Delivered". A draft (text and photos) stays with its conversation, in memory only.
- **Native presentations, nothing custom.** The details push from the name pill and Settings
  push from Edit, with the system back button. Details: the channel's icon, name and "5 people
  · 2 working", tiles for the other conversation and Pin, Needs you (answer in place), the
  crew (who works on what; tap the lead to write to them), and About (charter, hold). Settings:
  iOS Settings, grouped rows with coloured symbol tiles (Channels, Relay, Lock with Face ID
  after 30 s), Link Again, Unlink This iPhone, the version.
- No Agents view, no read receipts, no typing bubble, no "New messages" line: faces, the
  `doing` dot and "N working" carry agent state.

## 15. New-surface checklist

1. Use the tokens from `tokens.css` and the shared classes from `base.css`;
   add a class to the mono rule if it shows the machine's words.
2. Build from `ui/src/kit/` (`Dialog`, `Field`, `Seg`, `Toggle`, `Avatar`,
   `Dot`, `Count`, `Icon`) before writing a new control.
3. Check it in dark and light, in OLED Black and one Rex theme, at Large
   text and with reduced motion.
4. Add it to `ui/src/demo/shots.ts` and look at it:
   `bun scripts/shoot-app.ts --dist ui/dist --only <name> --theme dark,light`,
   and with `--browser webkit` (the engine of the desktop app).
5. Click through it in WebKit too: a click that works in Chromium can do
   nothing in WebKit (section 10).
6. Every member it names reads as a nickname, never a handle (section 13).

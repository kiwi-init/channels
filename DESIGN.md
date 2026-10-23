# Channels DESIGN.md

Source of truth for Channels visual identity (web renderer, later the
desktop app's renderer). Implementations derive from tokens here. Never
hard-code hex in components.

Canonical sources: `web/src/index.css` (`:root`, `:root[data-theme]`,
`@theme inline`), `web/src/lib/design-tokens.ts`, `web/src/lib/fonts.ts`,
`web/src/lib/accessibility.ts`, `web/src/components/kit.tsx`,
`web/src/components/ui/*`, `web/src/components/composer.tsx`.
`scripts/ui-tokens.ts` enforces the type steps and radii below.

## 1. Identity in one line

A quiet Messages-like conversation. White `#ffffff` / near-black `#161618`
canvas, Apple system blue `#007aff` (light) / `#0a84ff` (dark), Inter only,
small purposeful motion, one pop shadow. One intentional mark: the open
channel and the chosen view wear lit prism glass, after the app icon and the
agents' heads; everything around them is plain, so it reads as meant.

## 2. Theme architecture

- CSS vars are the contract. Tailwind v4 maps them via `@theme inline`:
  `canvas, rail, raised, field, ink, ink-2, ink-3, line, wash, wash-2,
  accent, accent-ink, accent-text, accent-wash, link, ring, alert,
  alert-fill, live,
  doing, warn, overlay, bubble-me, bubble-them, pick, head-*, avatar-*,
  pop-edge, pop-shade, shadow-pop`, plus `frame, panel, edge, edge-strong`
  aliases.
- Each token is written once as `light-dark(day, night)`. The system picks
  the side, unless `lib/theme.ts` set `data-theme` because the person chose
  light or dark. `system` leaves `data-theme` unset so the media query
  decides.
- There is one accent, not a pack: Apple blue. A theme switcher (system /
  light / dark) and a text-size switcher live in Settings. No accent
  switcher.
- New surface bootstrap: copy the `index.css` `:root` + `[data-theme]` +
  `@theme inline` blocks, plus `design-tokens.ts`, `fonts.ts`,
  `accessibility.ts`, `kit.tsx`.

## 3. Color tokens

Light / dark are the two sides of each `light-dark()` in `index.css`:

| Token | Light | Dark |
|---|---|---|
| `canvas` (conversation) | `#ffffff` | `#0d0d0e` |
| `rail` (the tab bar, the channel list and a channel's sidebar, a step darker) | `#f2f2f5` | `#000000` |
| `raised` (cards, popovers) | the canvas | the canvas |
| `field` (inputs) | the canvas | the canvas |
| `ink` | `#0f0f11` | `#f3f3f5` |
| `ink-2` | `#4a4a52` | `#bcbcc3` |
| `ink-3` (quiet floor, still 4.5:1) | `#6b6b73` | `#8f8f97` |
| `accent` (Apple system blue) | `#007aff` | `#0a84ff` |
| `accent-ink` (on the accent) | `#ffffff` | `#ffffff` |
| `alert` | `#d1342a` | `#ff6259` |
| `alert-fill` (under white text) | `#d1342a` | `#d1342a` |
| `decide` (amber, someone waits) | `#a35a00` | `#f5b041` |
| `live` (3:1 on the surfaces, a dot or a word beside one, not body text) | `#1f9a55` | `#32d074` |
| `doing` (in-progress blue) | `#2f6fe4` | `#5b9bff` |

Supporting chrome: `line` (7% ink/white), `wash` (4/5%), `wash-2` (7/8%),
`accent-wash` (10/16%), `pick` (the open channel: a neutral step, never a
block of colour), `bubble-them` (Messages grey `#e9e9eb` / `#1f1f21`).

White on the light accent is ~4:1, Apple's own choice and just under AA 4.5
for small text; the owner asked to mirror Apple, so it stays. As text on the
dark canvas the dark side clears 4.5:1.

White on the dark `alert` is ~2.9:1, so a red surface under white text (the
error toast) uses `alert-fill`, the light red in both themes (~5:1).

## 4. Typography

- Sans: `"Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI",
  system-ui, sans-serif` (`@fontsource-variable/inter`). Mono:
  `ui-monospace, "SF Mono", Menlo, monospace`.
- Body: `-0.006em` letter-spacing, `calt/kern/cv05/cv08`, antialiased,
  `optimizeLegibility`. Display/title set tighter at `-0.014em`.
- Six type steps and nothing between them (`scripts/ui-tokens.ts` keeps it
  that way; 4 documented exceptions for the pairing code, wordmark and
  swatch initials): `stamp 11px` (times between messages), `meta 12px`
  (counts, dates, section heads), `ui 13px` (names, rows, menus, buttons),
  `body 15px/21px` (what people read, in bubbles too), `title 16px/21px`
  (headers, dialogs), `display 26px/32px` (panel names, empty states,
  welcomes). All six scale with the text-size setting (`--text-scale`).
- Metrics and counts always use tabular numerals (`time, .tabular-nums`).
- Chat prose wraps pretty (`bubble-text`), code blocks fade at the right
  edge (`code-more`) so cut-off lines read as "scroll for more".
- A `mermaid` code block draws as a diagram on a `raised` card in the
  bubble, in the tokens of the current theme (`field` nodes, `ink-3`
  lines, `accent-wash` notes, Inter 13px, `row`-round nodes, no shadows).
  It fits the bubble down to 70%, then scrolls with the same `code-more`
  fade. Mermaid that doesn't parse stays a code block with its error.
- No additional font families. Hierarchy comes from weight, size and
  spacing, not font swaps.

## 5. Radius, shadow, blur

- Steps: `row 8px`, `ctl 10px`, `card 16px`, `bubble 20px` (pictures in
  a message and the annotator) and `dock 26px` (the composer, soft without a pill's half-moon
  ends once it grows to several lines).
- Buttons and rows use `row`; controls and inputs `ctl`; cards `card`;
  pictures `bubble`; the composer `dock`. Arbitrary `rounded-[Npx]` fails
  `ui-tokens.ts`.
- One shadow: `pop` (`0 0 0 1px pop-edge, 0 16px 40px -12px pop-shade`).
  No other shadows, and no coloured ones.
- Two tones: the rails (the tab bar, the channel list and a channel's
  sidebar) sit on `rail`, a step darker, and the page beside them is a
  sheet of `canvas` (the `sheet` utility: right under the tab bar, 8px in
  from the window's other edges, `card` radius, a 1px `line` ring), holding
  the header, the
  conversation and the tasks. Details is a sheet of its own beside it, 8px
  apart. A thread and the tasks panel slide over the page's right side as a
  sheet lifted with the `pop` shadow (`sheet-over`): the page keeps its width
  and scroll, and its centered column (`aside-room`) slides left only as far
  as its margin allows, so nothing reflows. `raised` and `field`
  are the canvas. Inside a sheet,
  rows, cards, search, inputs and the composer have no grey fill and no
  background of their own; they are separated by spacing and a thin 1px
  `line` (the `edge` utility). Popovers and dialogs lift off the canvas
  with the `pop` shadow only. A phone has no sheet: one screen at a time,
  on the canvas.
- Liquid glass (`glass`), for what floats over the conversation (the
  header's round controls, the place pills, the composer): a translucent
  `glass-fill` over a blur, a bright `glass-rim` on top, a hairline round it.
- Prism glass (`index.css`, `@layer components`): one class, `prism-lit`, on
  what's chosen in the sidebar and nothing else: the open channel (its tab
  in the tab bar, its row in the list) and the channel sidebar's chosen view or
  conversation. A brighter fill, a lit edge bright at one corner
  (`prism-glint-lit`), and a thin spectrum band (`spectrum-1..7`) inside it
  at `--band` (70% by default), the way light splits in the heads. Search,
  the tab bar's buttons, idle tabs and counts are plain, so the one lit thing
  reads as meant. `test/prism.test.ts` keeps it that way. Under
  `prefers-contrast: more` it falls back to a solid fill with a 2px `ink`
  ring: no band, no glint.
- Fall back to solid fills under `prefers-contrast: more`.
- On a machine that draws without a GPU (WebGL's renderer is SwiftShader,
  llvmpipe or a basic render driver, or there's no WebGL: `lib/drawing.ts`
  marks `html[data-drawing=software]` once the app is idle), the scrims under
  the header and over the composer drop their blur and mask and keep only
  their fade: re-blurring them on every keystroke made typing take 128 ms
  at p95 there, 32 ms without (`PERF_GL=swiftshader bun scripts/perf-scale.ts`).

## 6. Motion

- Motion only answers an action: something opens, closes, arrives or moves
  because someone did something. Nothing animates forever: a busy agent's dot
  is steady (a running animation keeps the GPU drawing every frame).
- CSS first. Keyframes for what appears: `rise` (settings, composer lists,
  the lightbox, toasts: 0.18s), `flash` (jump landing: 1.6s), `sent` (your
  message lands: 0.24s spring), `arrived` (theirs rises: 0.22s), `leave` (a
  toast goes: 0.16s).
  Base UI popups (menus, dialogs, the palette, tooltips) enter and leave with
  `data-starting-style` / `data-ending-style` transitions, 0.1-0.12s.
- [Motion](https://motion.dev) (`motion/react`, through
  `components/motion.tsx`) only for what CSS can't do: a side panel leaving
  (`Presence`, `popLayout`, so the conversation takes the space at once). No
  hover, press or decorative motion through it, and none on rows of a long
  list: a Motion component re-renders with every relay event, and 60 of them
  on the task board cost a frame per event at 4x CPU slowdown.
- Rows moving to a new place (the task board's `Reorder`) slide with the Web
  Animations API: measured just before React commits a new order, animated
  from there with `el.animate`, only for rows near the screen, and only on a
  board of up to 24 rows: starting a slide on 60 cost one frame at 4x CPU
  slowdown however few rows moved, so bigger boards jump as before. Nothing
  runs between reorders. `bun scripts/perf-motion.ts` times the frames of
  each animation.
- Motion stays off the first load: import it only from lazy surfaces
  (`components/lazy.tsx`); the conversation reaches it through the lazy
  `Presence` (`side-presence.tsx`). A lazy import goes to a module of its own
  like that one, never to `motion.tsx` itself: importing it lazily from the
  first load split React and some 35 modules out of the entry chunk (+9 KB,
  37 more files). Wrap a surface that animates in `<Motion>` so it follows
  the reduce-motion settings.
- Eases: `cubic-bezier(0.2, 0.8, 0.2, 1)` generally, `(0.3, 1.35, 0.5, 1)`
  for sent. Moves take 0.28s. Leaving is quicker than arriving.
- Reduced motion: `html.reduce-motion` (the persisted toggle) and OS
  reduced-motion turn CSS animation off; `<Motion>` turns Motion's movement
  off for both and keeps only its fades; `Reorder` doesn't slide.

## 7. Core components

- `kit.tsx`: `Button` (primary blue, quiet variants), `IconButton`,
  `TextField`, `Monogram` (a person's picture when they published one: the
  GitHub avatar their desktop fetched when they linked GitHub, carried in the
  channel by `picture.set`, so no page loads from GitHub; else a neutral
  gradient + initials; an agent always its character), `Spinner`, `SEGMENTED` tabs, `Modal`, `Alert`, `toast` /
  `Toaster`, `Wordmark`, `Boundary` (every channel view renders inside one,
  keyed by code).
- `ui/`: `menu`, `palette` (command palette: channels, actions,
  appearance), `panel`, `popover`, `tooltip` (500ms delay).
- Rows (channels, tasks): idle transparent, hover `wash`; title `ui`
  semibold, preview `meta` quiet. In the sidebar the open channel and the
  chosen view or conversation are `prism-lit`. The header's tabs are text,
  the current one in ink with a 2px `accent` mark under it.
- A chosen option you pick from a set (role chips, personality rows, Joins
  as, an ask's options, room chips) wears `accent-wash` with an `accent`
  edge, and its label in `accent-text` or a check: it reads as chosen at a
  glance, not just as having a thin ring. Segmented controls are a `wash`
  track with the chosen segment on `segment` (white / `#3a3a3c`), so it
  rises off the track in both themes.
- Buttons: primary `accent`; secondary outlined (a 1px `edge-strong` ring,
  no fill, `wash` on hover). The kit's `Checkbox` is the one checkbox, in
  `accent`.
- Inputs: no fill, a 1px `line` edge (`edge`); focus ring is `2px ring` with `1px` offset and
  `6px` radius (base layer, so utilities can still take it off).
- Placeholders and empty states use quiet ink, never reduced-opacity text.
- A dialog is for one decision (an `Alert`, a confirm, a short form). What you
  work in opens in place: Settings and Personalities as a page in the main
  area beside the sidebar (Escape or the back button returns), Invite and join
  requests as a view of the details panel, with a back arrow to the details.

## 8. Semantic and chart colors

From `design-tokens.ts`:

- Task/member states: `open` quiet, `doing` doing-blue, `done` live-green,
  `alert` red, `decide` amber.
- Badges follow `bg-{color} wash + matching text`: one accent at a time on
  a screen; red is for alerts, amber for a decision someone waits on;
  neither decorates.
- No charts yet. If charts come, they use one blue ramp only, tabular
  numerals for every KPI.

## 9. App patterns

- Shell: the tab bar on top, then inside a channel its own sidebar (280px,
  from 768px wide), both on `rail`; ⌘\ or the toggle at the start of the
  tab bar hides the sidebar, and the page's header then takes its views (a
  conversation menu, Search, and the Tasks / Agents / Conversation tabs).
  Hidden stays hidden across reloads. The page is the round `sheet` beside
  them: the channel's name and who is here, a Search row (a tap turns it
  into the field; Escape, or leaving it empty, turns it back), one Tasks
  row (it opens Everything, with Done this week at its foot) and beside it a
  quiet dot and number for each state that waits (`alert` Needs you, `doing`
  In progress, `decide` In review, only when above zero, each opening its
  view), the agents with what each is doing now (a click opens your direct
  conversation with it; the task id beside it opens its task), and the
  conversations: the rooms, your own direct ones, one that asks for you and
  the open one stay; threads between agents fold behind an "N more" row
  carrying their unread total, which opens to "Show less". The page
  beside it has one header row: what is shown, the channel's status
  (working, merged today, needs you), and the
  Tasks / Agents / Conversation tabs. A channel opens on its conversation
  (Needs you's rows at its top while something waits); a view opens Tasks;
  a conversation opens Conversation. The approved mockups are in `docs/ui/`.
- Needs you says one line per thing: a face or icon, what it is in one
  truncated line (a permission's command in mono, a join request's code
  beside it), and its answer buttons on the right (Allow once / Deny, let in /
  Decline, an ask's options or Answer, Approve / Send back). Everything else
  (the whole command and what it replaces, the machine and tools, who asked
  when, Show in the conversation, Show in Rex) opens under it on a click of
  the line.
- Tasks: Needs you's rows first, then the
  board grouped by the person's message each task serves: the group's
  heading is their own words in quotes, under it who said it and #N, the
  ask that moved last first and Unfiled (no person's message holds these)
  at the foot; inside a group, in progress, in review, up next, then done
  this week. A view (In progress, In review, Done) keeps the same groups
  with only its own tasks. A row is two lines on the canvas,
  split from the next by `line`: the owner's face, the title in `body`, and
  under it the task id, the owner and what the agent is doing now (in
  `doing` with a steady dot while it works) or the task's state; then its PR
  (number, a 48px diff bar in `live` and `alert`, the additions), its
  checks in a word and the time, short. The PR and checks columns drop on
  narrow windows, and when no task on the board has a PR; a row without one
  leaves them blank, never "no PR yet".
- A task opens in place, under its row (a click again folds it): its
  conversation as the conversation draws it, a reply box that talks in the
  task, and Details for the Tasks panel (review, reviewer, cancel). Beside
  it from 1024px, the PR card: outlined, no fill; its branch in mono, the
  files with their additions and deletions (four, then "+n more"), each
  check by name with how it went, and See the diff and GitHub as outlined
  buttons.
- On a wide window the channels are tabs in a 52px bar across the top, as
  a browser's: the Mac traffic lights at its start (its controls start
  92px in on a Mac), the sidebar toggle, then each channel as a `ctl`-round
  tab in the order you joined them: its 20px face, its name, a blue dot or
  a count for news and questions, a lock on a channel you can't open yet,
  and `prism-lit` when open. A channel with a lead wears the lead's head
  there, in its own sidebar and in its details, the same face everywhere.
  A hover card says what the full row says: name, time, last line. Tabs
  that don't fit go under "N more" (a blue dot when one of them has news):
  Find a channel (⌘K), then those channels, news first. The open channel
  always keeps its tab. New follows the tabs; the app update and your
  account sit at the bar's end. A phone always shows the full list. The
  Mac app's window is never narrower than 768px, so it always has the tab
  bar: the phone layout's headers would sit under the traffic lights.
- Conversation: no bubbles, everyone on the left, on the shell's one
  background. A message is a row: a 32px face, then the name in `ui`
  semibold, a quiet `owner` or `lead` tag and the time in `stamp`, the
  text in `body` below (at most 760px wide). A run from one sender within
  five minutes keeps one header. The day sits between days as a `meta`
  word between two `line` rules; there are no other time marks.
- Replies: a reply sits where it was sent, never folded away. Above its
  text, one `meta` line with a 2px `edge-strong` rule on the left: the
  name in `ink-2`, the words cut short in `ink-3`; pressing it jumps to
  the message and flashes it. No quote when the answered message is the
  one right above. Under a message, "N replies" in `accent-text` opens
  them in the thread panel, except one reply that already follows it.
- Things in a message are lines, outlined with a 1px `line` ring at `row`
  radius, never filled: an ask's options (the shared AskOptions), a PR it
  links (number, title, GitHub's state and checks), a task's card (its
  owner, id, title and live state, its last line under it). Reactions are
  outlined chips. Hover actions float at the row's top right on the
  canvas, outlined.
- Events are quiet `meta` lines under the text column. A run of GitHub's
  news folds into one: "GitHub · #371 opened, 3 pushes, ci-ok passed ·
  4 updates", each PR or issue a link.
- #general reads like a group chat: people's messages and short ones at
  full size, the bookkeeping out of the way. Between two messages, every
  task event, done digest and task card folds into one `meta` line:
  "T12 done, T18 in progress, T20 cancelled and 1 more · 6 updates", each
  id opening its task and its state word in the state's colour. A click
  opens the run, one line per task (its state mark, id, title, owner,
  state and PRs). One update is just its line. A task waiting on the
  reader stays its own line, in `decide`. A done digest lives in its
  task's thread; #general only shows it in the fold. An agent's message
  past six lines is cut with a fade and Show more; a person's never is,
  nor a question.
- Needs-you: approvals, escalations and review-waiting work in one place at
  the top, as rows on the canvas, never folded behind a button: a 36px
  `row`-round outlined square with the kind's glyph in `decide` (a question,
  a decision, a review, a face for someone asking in), the question in
  `body`, a `meta` line in `ink-3` (task, who asked, when), and the answers
  on the row's right as outlined buttons (below it on a phone). Rows are
  split by `line`, not by fills. `Pause agents` in the header stops every
  agent at once.
- Agents tab: one lane per agent, side by side on the canvas, split by
  `line` (no cards, no fills; the lead's lane last). A lane: face, name,
  `@handle · for person · model`; a mono `meta` line of what it runs now
  between two `line`s (a steady `doing` dot while a tool runs, `live` while
  it thinks); its tasks in progress and in review as `card`-round outlined
  blocks (`T7 · in progress · 41 min`, the title in `ui` semibold, `PR #n`
  and a tick per check: `alert` failed, `doing` running, `live` passed);
  Up next; Watching (the lead's other open PRs); and its last three moves
  at the foot, times in tabular `meta`.
- An ask with options lists them under its words as outlined `row`-round
  lines, the letter in `ink-3`. While it waits on you it says so in
  `decide` under the bubble and its options answer it; once answered, the
  chosen line wears an `accent` border and "name chose this · time".
- Lead: `coordinator-head` (system-blue shell, pale screen, quiet
  steel trim; `robot-heads`); behind it in a round avatar a soft blue field.
- Command palette wears the same icons as the menus. Dark/light/system and
  text size live in Settings and apply at once.
- A picture in the chat opens in the annotator: a full-window dark stage
  (`.dark-stage` puts every token on its dark side, whatever the theme),
  sender and time on its top row, which in the desktop app is the window's
  own 52px `drag` row (the Mac traffic lights before the sender, its
  buttons still click), one floating tool pill (Move, Pen, Arrow, Box,
  Text, Hide; the alert, decide, accent and ink colours; undo, redo), and
  a reply bar that sends the marked-up picture back in its thread. Hide
  is an opaque block, burned into the pixels that are sent.
- In the desktop app the top 52px of every page moves the window. What
  floats over it takes it back: a dialog, its backdrop and a menu are
  `no-drag`, and a full-window stage brings its own `drag` row.

- Settings → Personalities: a roomy modal, the list on the left (presets
  for code work, then Yours, each a 36px outlined glyph tile, the name in
  `ui` semibold and one quiet line) and the editor on the right: role as
  outlined chips (the picked one `accent`-bordered), capabilities as
  checkboxes with a quiet line each, areas as mono chips with a dashed
  "+ add a path", instructions in an outlined field. A preset reads
  "edit it to make your own copy": changing it makes one.
- Picking a personality (Let in, an agent's menu, Invite → Joins as): one
  outlined row each, a 28px glyph tile, the name in `ui` semibold and its
  role and capabilities in one quiet line; the picked row `accent`-bordered,
  None last. A request whose invite pinned one says "pinned as <name>" and
  its one click lets the agent in as that.

## 10. Composer

The composer never opens a floating menu. Panels expand inline above the
textarea.

Anatomy top to bottom: reply bar, textarea row, mention notes,
actions row with send.

- Mentions are inline pills.
- Reply on a message opens the reply bar; Escape cancels it. In a thread every
  message answers the root and there is no reply bar.
- Drag-and-drop and pasted images render inside the composer; sending shows
  in place, never an external spinner.
- Disabled send and placeholders stay quiet; the send button is the one
  primary accent in the composer.

## 11. Accessibility (mandatory)

- `focus-visible`: `2px ring` with `1px` offset and `6px` radius.
- Selection: `accent-wash`. Scrollbar: thin, thumb `wash-2` on transparent.
- Text size (`small/default/large/larger`, `mc.text-size`) scales the type
  steps (`--text-scale`), never the layout. In the desktop app ⌘+, ⌘− and
  ⌘0 (Ctrl elsewhere) and the View menu step through those sizes; the page
  itself never zooms. Appearance persists per browser (`mc.appearance`).
- Persisted toggles (`kiwi:a11y:*`): `reduce-motion` (CSS durations to near
  zero, including sent/arrived; Motion keeps only fades). OS reduced-motion is
  respected too.
- `prefers-contrast: more` forces solid backgrounds with no transparency
  tricks.
- New entry points call `applyStoredAppearance()` plus
  `initAccessibility()` / `syncAccessibilityClasses()` before first render.

## 12. Brand illustration (optional)

The lead's head (`robot-heads`, blue shell) in `muted` contexts is the
only mascot. The wordmark is set in Inter, never an image. New surfaces may
omit the head; never replace it with stock art.

## 13. Do and don't

Do: use vars, tabular numerals for times and counts, one accent at a time,
a flat sidebar on `rail` beside the page's round sheet, inline composer panels, quiet placeholders, `Boundary` around
channel views.
Don't: hard-code hex, add font families, ship gradient marketing styling,
build floating composer menus, use colored shadows, put prism on anything
but what's chosen in the sidebar, spread the spectrum beyond a thin band
in it, or put hairlines
between the rails.

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
  the header; the bottom never blurs the last bubble.
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

1. Copy theme vars, `design-tokens.ts`, `fonts.ts`, `accessibility.ts`.
2. Copy `kit.tsx` plus one `ui/` primitive at a time (not a whole library).
3. Copy the composer patterns (inline panels, in-place sending states).
4. Wire theme toggle, text size, and `reduce-motion`.
5. Verify with `bun run smoke:ui` and `bun run shots:ui`: sidebar, search,
   composer with reply + mention, badge pair, tabular status bar, light and
   dark.

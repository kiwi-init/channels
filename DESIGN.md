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
small purposeful motion, one pop shadow.

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
| `canvas` (conversation) | `#ffffff` | `#161618` |
| `rail` (list and details) | `#f6f6f7` | `#1c1c1f` |
| `raised` (cards, popovers) | `#ffffff` | `#232327` |
| `field` (inputs) | `#ededf0` | `#26262a` |
| `ink` | `#18181b` | `#ededf0` |
| `ink-2` | `#4f4f57` | `#b4b4bc` |
| `ink-3` (quiet floor, still 4.5:1) | `#6b6b73` | `#8f8f98` |
| `accent` (Apple system blue) | `#007aff` | `#0a84ff` |
| `accent-ink` (on the accent) | `#ffffff` | `#ffffff` |
| `alert` | `#d1342a` | `#ff6259` |
| `alert-fill` (under white text) | `#d1342a` | `#d1342a` |
| `decide` (amber, someone waits) | `#a35a00` | `#f5b041` |
| `live` | `#1f9a55` | `#3ccf7f` |
| `doing` (in-progress blue) | `#2f6fe4` | `#5b9bff` |

Supporting chrome: `line` (7% ink/white), `wash` (4/5%), `wash-2` (7/8%),
`accent-wash` (10/16%), `pick` (the open channel: a neutral step, never a
block of colour), `bubble-them` (Messages grey `#e9e9eb` / `#262628`).

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
  `body 14px/20px` (what people read, in bubbles too), `title 15px`
  (headers, dialogs), `display 22px/28px` (panel names, empty states,
  welcomes).
- Metrics and counts always use tabular numerals (`time, .tabular-nums`).
- Chat prose wraps pretty (`bubble-text`), code blocks fade at the right
  edge (`code-more`) so cut-off lines read as "scroll for more".
- No additional font families. Hierarchy comes from weight, size and
  spacing, not font swaps.

## 5. Radius, shadow, blur

- Steps: `row 6px`, `ctl 8px`, `card 12px`, `bubble 18px` (a message
  bubble: rounder than anything else, so a conversation reads as one at a
  glance; `stack 6px` where a run stacks).
- Buttons and rows use `row`; controls and inputs `ctl`; cards `card`;
  bubbles `bubble`. Arbitrary `rounded-[Npx]` fails `ui-tokens.ts`.
- One shadow: `pop` (`0 0 0 1px pop-edge, 12px 32px -10px pop-shade`).
  No other shadows, no colored shadows.
- No blur in surfaces: surfaces are flat and opaque, separated by steps in
  tone, never hairlines between areas. (No glass/liquid treatments.)
- Fall back to solid fills under `prefers-contrast: more`.

## 6. Motion

- Keyframes only, no motion library: `rise` (dialogs, panels: 0.18s),
  `slide-in` (0.2s), `flash` (jump landing: 1.6s), `sent` (your message
  lands: 0.24s spring), `arrived` (theirs rises: 0.22s).
- Eases: `cubic-bezier(0.2, 0.8, 0.2, 1)` generally, `(0.3, 1.35, 0.5, 1)`
  for sent.
- Motion only answers an action. All animation disables under
  `html.reduce-motion`, the persisted reduce-motion toggle, or OS
  reduced-motion.

## 7. Core components

- `kit.tsx`: `Button` (primary blue, quiet variants), `IconButton`,
  `TextField`, `Monogram` (a contact without a picture: neutral gradient +
  initials), `Spinner`, `SEGMENTED` tabs, `Modal`, `Alert`, `toast` /
  `Toaster`, `Wordmark`, `Boundary` (every channel view renders inside one,
  keyed by code).
- `ui/`: `menu`, `palette` (command palette: channels, actions,
  appearance), `panel`, `popover`, `tooltip` (500ms delay).
- Rows (channels, tasks): idle transparent, hover `wash`, open `pick`;
  title `ui` semibold, preview `meta` quiet.
- Inputs: `field` fill; focus ring is `2px ring` with `1px` offset and
  `6px` radius (base layer, so utilities can still take it off).
- Placeholders and empty states use quiet ink, never reduced-opacity text.

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

- Shell: flat `rail` sidebar beside one inset `canvas` panel (edge to edge
  on a phone). No hairlines between areas.
- On a wide window the list starts as an 80px icon rail, as Grok's
  collapsed one: the Mac traffic lights on its header row, each channel
  as its 40px tile in a 56px `card`-round cell (`pick` when open), a blue
  dot or a count for news and questions, a lock on a channel you can't
  open yet. A hover card says what the full row says: name, time, last
  line. New, the app update, expand (⌘B) and your account sit at its foot.
  Expanded, it is the full 300px list; a phone always shows the full list.
- Conversation: your bubbles `accent` with white ink; theirs `bubble-them`
  with `ink`. Runs stack at `stack` radius on the joined corners.
- Needs-you: approvals, escalations and review-waiting work in one place at
  the top; `Pause agents` in the header stops every agent at once.
- Overview cards: always in the chat area from 1280px wide, never behind
  a button. Cards on the canvas itself, outlined with a 1px `edge-strong`
  ring at `card` radius, 336px wide, 24px from the window's edge and 12px
  apart, float at the top right of the conversation, each folding from its
  header: Agents, Tasks (the 5 last updated, a `SEGMENTED` filter that
  leaves out a state with no task), Pull requests (the last 5 linked in
  the channel). Rows put the time on the right. The conversation stays
  centered while it has room and moves left only as far as it must. The
  agent strip under the composer gives way to the Agents card. A thread,
  the details or a task in the side column hide the cards until it closes.
  Below 1280px the cards are hidden and the header's Tasks button stays.
- Coordinator: `coordinator-head` (system-blue shell, pale screen, quiet
  steel trim; `robot-heads`); behind it in a round avatar a soft blue field.
- Command palette wears the same icons as the menus. Dark/light/system and
  text size live in Settings and apply at once.

## 10. Composer

The composer never opens a floating menu. Panels expand inline above the
textarea.

Anatomy top to bottom: reply bar, textarea row, mention/route notes,
actions row with send.

- Mentions are inline pills; the coordinator route note says plainly where
  an `@agent` message goes.
- Reply cancels with Escape; in a thread every message answers the root and
  there is no reply bar.
- Drag-and-drop and pasted images render inside the composer; sending shows
  in place, never an external spinner.
- Disabled send and placeholders stay quiet; the send button is the one
  primary accent in the composer.

## 11. Accessibility (mandatory)

- `focus-visible`: `2px ring` with `1px` offset and `6px` radius.
- Selection: `accent-wash`. Scrollbar: thin, thumb `wash-2` on transparent.
- Text size (`small/default/large/larger`, `mc.text-size`) scales the whole
  page via `zoom`; appearance persists per browser (`mc.appearance`).
- Persisted toggles (`kiwi:a11y:*`): `reduce-motion` (all durations to near
  zero, including sent/arrived). OS reduced-motion is respected too.
- `prefers-contrast: more` forces solid backgrounds with no transparency
  tricks.
- New entry points call `applyStoredAppearance()` plus
  `initAccessibility()` / `syncAccessibilityClasses()` before first render.

## 12. Brand illustration (optional)

The coordinator head (`robot-heads`, blue shell) in `muted` contexts is the
only mascot. The wordmark is set in Inter, never an image. New surfaces may
omit the head; never replace it with stock art.

## 13. Do and don't

Do: use vars, tabular numerals for times and counts, one accent at a time,
flat sidebar, inline composer panels, quiet placeholders, `Boundary` around
channel views.
Don't: hard-code hex, add font families, ship gradient marketing styling,
build floating composer menus, use colored shadows, or put hairlines
between the list and the conversation.

## 14. New-surface checklist

1. Copy theme vars, `design-tokens.ts`, `fonts.ts`, `accessibility.ts`.
2. Copy `kit.tsx` plus one `ui/` primitive at a time (not a whole library).
3. Copy the composer patterns (inline panels, in-place sending states).
4. Wire theme toggle, text size, and `reduce-motion`.
5. Verify with `bun run smoke:ui` and `bun run shots:ui`: sidebar, search,
   composer with reply + mention, badge pair, tabular status bar, light and
   dark.

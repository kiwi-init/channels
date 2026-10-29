# Design brief: making an existing app look clean and modern

Two files go together:

- `design-tokens.css` — the real token sheet. Drop it in, keep the values.
- this brief — the rules that make those values read as a design instead of a palette.

The look doesn't come from any component. It comes from a small, enforced set of
decisions applied everywhere without exception. Clean and modern = few choices,
used consistently, nothing decorative.

The values are not invented for this brief: they are a working design system
(a Messages-like conversation app) extracted from its source of truth. Replace
the accent if the brand needs it; keep everything else.

---

## 1. Tokens are the contract — never hard-code a value

Every colour, radius, font size, shadow and duration lives in one file as a CSS
custom property. Components may only reference tokens.

Banned: raw hex in a component, `border-radius: 13px`, inline `box-shadow`,
ad-hoc font sizes, one-off greys.

Inconsistency is what makes an app look old. A single token file makes
consistency mechanical instead of a matter of discipline.

## 2. Define light and dark together, from the start

Each token is written **once** as `light-dark(day, night)`; `color-scheme`
picks the side. A user override sets `data-theme="light" | "dark"`; "system"
leaves it unset so the OS media query decides. Retrofitting dark mode later is
what forces hacks.

## 3. One accent, used sparingly

One accent colour, and it means exactly one of: *this is yours*, *this is new*,
*this is the primary action*. Nothing else uses it. Never more than about three
accent moments on a screen. Status colours (green / amber / red) are semantic
and never decorative.

One accent reads as designed. A palette reads as a template.

## 4. Separations come from tone, not lines

Flat, opaque surfaces. Separate regions with a **step in tone** from the neutral
ramp — not with borders, hairlines, dividers or shadows. Hover is a subtle wash,
selected is a soft filled pill.

This single rule gives most of the "clean" impression, and it is the one most
dated apps get wrong (borders everywhere, five different greys).

## 5. One type family, a fixed small scale

One sans (plus one mono for code). Six size steps and nothing between them.
Hierarchy comes from weight, size and spacing — never from swapping families or
inventing sizes. Tighten letter-spacing slightly (`-0.006em` body, `-0.014em` for
title/display). Use tabular numerals for every time, count and metric.

## 6. Restrained shape and elevation

A tiny radius scale mapped to roles (row 8 / control 10 / card 16 / bubble 20 /
dock 26). Exactly one shadow for floating surfaces, one for the docked composer.
No coloured shadows, no glows. Small radii, one shadow, flat surfaces.

Big radii plus gradients plus glows is the "marketing landing page" look, which
is not the same thing as modern product UI.

## 7. Motion answers an action, never decorates

Keyframes only, no motion library. Short durations (0.18–0.24s). One family of
eases: `cubic-bezier(0.2, 0.8, 0.2, 1)`, with a small overshoot
(`cubic-bezier(0.3, 1.35, 0.5, 1)`) only for something arriving.

Nothing animates on idle, on mount, or on scroll. Everything disables under the
OS reduced-motion setting **and** a persisted in-app toggle.

## 8. Accessibility is part of the look

A visible `focus-visible` ring on the accent. Quiet text still clears 4.5:1
(`--ink-3` is exactly that floor — do not go lighter). `prefers-contrast: more`
falls back to solid fills. Persist appearance (theme, text size, reduce-motion)
and apply it before first render, so there is no flash of the wrong theme.

Apps look considered partly because they are usable.

## 9. Layout: the content is the product

Flat, edge-to-edge regions; no chrome that isn't doing work; no dividers between
the important areas. Quiet placeholders and empty states at **full opacity** in
quiet ink — never `opacity: 0.5` on text (it fails contrast and looks muddy).

## 10. Enforce it so it can't drift

Add a check that fails the build on raw hex in components, arbitrary
`rounded-[Npx]` / `text-[Npx]`, and off-scale sizes. Keep a short DO / DON'T list
in the repo next to the tokens. Rules that aren't checked rot within a week, and
that rot is exactly what makes an app look inconsistent.

A working guard is ~30 lines: walk the source files, regex for
`/\b(?:text|rounded(?:-[trbl]{1,2})?)-\[\d+(?:\.\d+)?px\]/` and raw `#rrggbb`
outside the token file, print the offenders, exit non-zero, and keep a small
allow-list with a written reason per exception.

---

## The tokens

See `design-tokens.css`. The load-bearing parts:

| Group | Tokens | Rule |
|---|---|---|
| Surfaces | `canvas`, `rail`, `raised`, `field` | 4 steps, one ramp. `rail` = `canvas`: chrome is flat. |
| Ink | `ink`, `ink-2`, `ink-3` | 3 levels. `ink-3` is the contrast floor. |
| Chrome | `line`, `wash`, `wash-2`, `pick`, `overlay` | Transparent overlays, so they work on any surface. |
| Accent | `accent`, `accent-ink`, `accent-text`, `accent-wash`, `link`, `ring` | One accent, six uses, no more. |
| Status | `alert`, `decide`, `live`, `doing`, `warn` (+ washes) | Semantic only. A badge is always `wash` fill + matching text. |
| Type | `stamp 11` `meta 12` `ui 13` `body 15` `title 16` `display 26` | Six steps. All scaled by one `--text-scale` var. |
| Radius | `row 8` `ctl 10` `card 16` `bubble 20` `dock 26` | Mapped to roles, not chosen per component. |
| Elevation | `shadow-pop`, `shadow-dock` | Exactly two shadows in the whole app. |
| Glass | `glass-fill`, `glass-rim`, `glass-edge`, `glass-shade` | Only for what floats over scrolling content. |
| Motion | 5 keyframes, 2 eases | Answering an action only. |

Neutral values, for reference (light → dark):

```
canvas   #ffffff  → #0d0d0e
raised   #ffffff  → #1c1c1e
field    #f0f0f3  → #1a1a1c
ink      #0f0f11  → #f3f3f5
ink-2    #4a4a52  → #bcbcc3
ink-3    #6b6b73  → #8f8f97
accent   #007aff  → #0a84ff
alert    #d1342a  → #ff6259
live     #1f9a55  → #32d074
doing    #2f6fe4  → #5b9bff
decide   #a35a00  → #f5b041
```

## How to wire it into the target app

1. Add the token file and import it **before** any component styles, so var
   references resolve.
2. If it uses Tailwind v4: keep the `@theme inline` block at the bottom of the
   token file in the same stylesheet as the `@import "tailwindcss"`. The vars
   then appear as utilities (`bg-canvas`, `text-ink-2`, `rounded-card`,
   `shadow-pop`). Delete the block if there is no Tailwind.
3. Add one way to set the theme (`<html data-theme>` from a persisted setting,
   absent for "system") and one `--text-scale` on `:root` if you want the text
   size setting.
4. Ship Inter (`@fontsource-variable/inter` or a self-hosted subset). Keep the
   system stack in `--font-sans` as the fallback so there is no invisible text
   while it loads.
5. Import nothing else from Channels. The token file is self-contained.

## Workflow for the agent doing the modernisation

Order matters. Doing screens first guarantees inconsistency.

1. **Audit.** Grep for raw hex colours, `border-radius`, `box-shadow`, font
   sizes and spacing values. Make a list of every distinct value in use.
2. **Install the tokens.** Add `design-tokens.css`.
3. **Sweep, mechanically.** Replace raw values with tokens. No redesign yet —
   just substitution. The app already looks noticeably better at the end of
   this step.
4. **Fix the primitives.** Button, input, row, card, dialog, toast, tooltip —
   one implementation each, using tokens and the shared radius roles.
5. **Fix the screens.** Remove borders and dividers, replace with tone steps.
   Strip the accent down to primary actions and "yours / new". Delete decorative
   gradients and coloured shadows.
6. **Unify motion and focus.** One ease family, short durations, the shared
   focus ring. Wire reduced-motion.
7. **Add the guard** and the DO / DON'T list, so it can't drift back.

Give the agent the app's own screenshots and these files, and repeat the single
most important instruction: **no hard-coded values, anywhere.**

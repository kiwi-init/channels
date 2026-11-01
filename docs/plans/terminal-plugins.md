# Plan: terminal plugins (Rex, tmux and the terminal app)

Status: approved by the owner (#2004), 2026-10-21, from the owner's ask (#1927). Rows 1 to 9 are
built (#648, #649, #650, #651, #655, #659, #656, #658, #660) and shipped in v0.24.0; Show in tmux
from Needs you follows. What changed while building is under "As built". The audit and the plan below are kept as they were decided: their facts were read from
`main` at `00217d35` (kiwi 0.23.1), before the code moved.

Since T374 (2026-10-29, the owner's #355: plug and play), new agents always open in Channels' own
tmux (T360), so the terminal app plugin and Prefer are gone, and no plugin opens windows. The tmux
helpers went with them and came back on 2026-10-30 (T14, the owner's #5): Rex and tmux mark and
show the seats people run in them, and the daemon no longer takes the tmux helpers back. The rest of
this page is history.

## The ask

- One Settings flow for starting agents on this computer:
  1. **Allow creating new agents**: on or off.
  2. **Prefer**: the terminal app by default, or Rex or tmux once their helpers are downloaded.
  3. **Download Rex Helpers**.
  4. **Download Tmux Helpers**.
- Rex and tmux built to one plugin spec, with their code laid out the same way, so another
  terminal, or a store, can be added later.

## What each terminal does today

| What | Terminal app | tmux | Rex |
| --- | --- | --- | --- |
| Open a window for New agent | `openTerminal`, macOS only (`src/launch/place.ts:252`) | `openTmux` (`place.ts:223`) | `openRex` (`place.ts:204`) |
| Which one opens | the last resort | whenever `tmux` is installed | first, whenever a Rex server runs, helpers on or off (`place.ts:269-277`) |
| Where a seat runs, from a hook's environment | not read | `paneOf`, read by rotation only and never stored (`src/hooks/rotate.ts:31`) | `placeFrom`, stored on the seat (`src/rex.ts:30`, `src/cli/context.ts:142`) |
| Mark a seat that needs you | none | none | OSC 7501 records, written by the daemon (`src/status.ts`) |
| Open the seat from Needs you | none | none | `showInRex` (`src/rex-show.ts:68`) |
| A command that jumps to it | none | none | the palette action (`src/rex-palette.ts`) |
| Seat state and exits | none | none | `rex events` and `program_status` (`src/rex-events.ts`, `src/rex.ts:217`, `src/daemon/rex-reads.ts`) |
| Rotation (to be removed) | none | `tmuxBackend` and Codex (`src/rotate/pane.ts:149`, `src/rotate/codex.ts`) | `rexBackend` (`pane.ts:180`) |
| Its switch | none: always on | none for windows; `kiwi rotate` for rotation | `kiwi rex on\|off` (`rex` in the config) |
| In the apps | the New agent modal | the modal's `tmux attach` line | five `rex*` bridge methods, `desktop/src/ipc/rex.ts`, Settings → Services → Rex, Show in Rex |

## Duplicates

1. **Copies of the same JSON helpers.** `object()` four times (`src/rex.ts:153`,
   `src/launch/place.ts:137`, `src/rex-show.ts:29`, `src/rex-events.ts:25`), `parse()` three times
   (`rex.ts:130`, `place.ts:151`, `rex-show.ts:59`), and four list unwrappers (`rex.ts:167` and
   `:235`, `rex-show.ts:33`, `place.ts:141`).
2. **Three ways to call Rex's API.** `rexApi` with `spawnSync` (`rex.ts:143`), `rexActivity` with
   `execFile` (`rex.ts:217`), and `rex()` with `Bun.spawn` (`place.ts:163`). `showInRex` builds its
   own argv (`rex-show.ts:70`, `:76`), and so does rotation (`pane.ts:185`, `:211`).
3. **Two checks that Rex's server runs.** `rexStatus` reads `whoami`'s exit code (`rex.ts:122`);
   `rexServer` reads `whoami --json` for the endpoint (`place.ts:174`).
4. **Rex's id patterns twice:** `rex.ts:27-28` and `place.ts:159-160`.
5. **Three ways to find tmux.** The login shell's PATH (`place.ts:35`), and a bare `tmux` from the
   hook's PATH (`pane.ts:105`, `src/rotate/codex.ts:243`). tmux's socket is read from `TMUX` twice
   (`hooks/rotate.ts:33`, `codex.ts:233`).
6. **One foreground check written twice.** `holdsInput` (`pane.ts:120`) and `leadsTerminal`
   (`src/status.ts:32`) run the same `ps -o tty=,tpgid=,pgid=`.
7. **Two readers of where a seat runs.** `placeFrom` (Rex, stored) and `paneOf` (tmux first, then
   Rex, not stored) read the same environment by different rules.
8. **The place names in six places:** `PlaceKind` (`place.ts:6`), `PLACES` (`src/launch/wire.ts:30`),
   `launchedText` (`wire.ts:46`), `LaunchedView` (`desktop/src/bridge.ts:282`), `launchedView`
   (`desktop/src/launch-view.ts:38-50`) and the labels in `web/src/components/new-agent.tsx:29`.
9. **A launch's result is parsed twice:** `readLaunched` (`wire.ts:33`) and `launchedView`
   (`desktop/src/launch-view.ts:32`).
10. **Rex's status shape three times:** `RexStatus` (`rex.ts:82`), `RexStatusJson`
    (`src/cli/commands/rex.ts:11`), and `RexStatusView` with its parser (`bridge.ts:288`,
    `desktop/src/rex-status.ts`). A Rex seat twice: `RexSeat` (`rex-show.ts:4`), and `RexSeatView`
    with its validator (`bridge.ts:250`, `desktop/src/ipc/rex.ts:25`).
11. **Three walks over every seat record:** `localRexSeats` (`rex-show.ts:10`), `uniqueRecords`
    (`status.ts:92`) and `seatRecordFor` (`src/daemon/reach.ts:21`).
12. **The Rex switch is read in six places:** `hooks/rotate.ts:73`, `cli/commands/rotate.ts:46`,
    `status.ts:175`, `daemon/server.ts:795`, `daemon/reach.ts:57` and `cli/commands/rex.ts:68`.
13. **Status records hang on Rex's switch** though they go to any terminal on the OSC 7501 list
    (`rex.ts:42`).
14. **A generic helper in the Rex file.** `runKiwi` lives in `desktop/src/ipc/rex.ts:8`, and
    `desktop/src/ipc/launch.ts:9` imports it from there.
15. **Rotation's backends cast one union.** `PaneId | RexId` is cast with `as` in each backend
    (`pane.ts:151`, `:184`), and Codex calls tmux outside its backend (`pane.ts:237`, `:268`). This
    goes when rotation does.

## Principle

**A terminal is a plugin.** Kiwi works with the terminal app alone. Rex and tmux add what they can
once a person downloads their helpers, and nothing of a plugin is loaded while its helpers are off.
A plugin writes only counts, channel names and task numbers into a terminal, and Remove takes back
everything it wrote. This is the Rex helpers' principle ([rex-helpers.md](rex-helpers.md)), made
general.

## The plugin spec

### Layout

```
src/terminals/
  plugin.ts      the manifest and the interface below
  registry.ts    the built-in plugins in order, the preferred one, the config they read
  shared/        one process runner, the JSON readers, the foreground check, OSC 7501 frames
  app/           the terminal app: Terminal.app (a Linux one later)
  tmux/
  rex/
```

- Each plugin folder holds `manifest.ts`, `index.ts` (the interface), `helpers.ts` (Download and
  Remove), and has its own test file, `test/terminal-<id>.test.ts`.
- A plugin imports only `shared/` and its own folder. The rest of Kiwi imports only `registry.ts`
  and `plugin.ts`, and loads a plugin's `index.ts` lazily, the way `src/rex-events.ts` is loaded
  today.

### Manifest

```ts
interface TerminalManifest {
  id: "app" | "tmux" | "rex"; // [a-z][a-z0-9-]{1,31}; a store would add ids
  name: string; // "Terminal", "tmux", "Rex"
  platforms: NodeJS.Platform[];
  helpers: { version: number; files: string[] } | null; // what Download writes; null: nothing to download
  can: Capability[]; // what its index.ts implements
}

type Capability = "open" | "locate" | "mark" | "show" | "watch" | "type";
```

`helpers.version` goes up when the files change. The next `kiwi` run after an update rewrites them,
the way the hooks are migrated (`migrateClaudeHooks`, `src/hooks/run.ts`).

### Interface

```ts
interface TerminalPlugin {
  manifest: TerminalManifest;
  detect(): Promise<{ found: boolean; version?: string; running?: boolean }>;
  helpers?: { status(): "on" | "off"; download(): Promise<void>; remove(): Promise<void> };
  locate?(env: Env): SeatPlace | null; // the seat's pane, from a hook's environment
  open?(req: PlaceRequest): Promise<Placed>; // a window the person can see, running argv in a folder
  mark?(place: SeatPlace, records: StatusRecord[]): Promise<boolean>; // a seat needs you, or has work to look at
  show?(place: SeatPlace): Promise<ShowResult>; // bring the seat to the front
  watch?(places: SeatPlace[], changed: (place: SeatPlace, gone: boolean) => void): { stop(): void };
  type?(place: SeatPlace): Pane | null; // read the screen and type into it, for a first prompt
}
```

`SeatPlace` is `{ plugin, ... }` with each plugin's own fields: Rex's server, session and block,
tmux's socket and pane, the app's window id. It is stored on the seat record, as `rex` is today.

### Who implements what

| Capability | Terminal app | tmux | Rex |
| --- | --- | --- | --- |
| `open` | a Terminal.app window (today's) | a window in session `kiwi` (today's) | a window in the last-used session (today's) |
| `locate` | none | `TMUX`, `TMUX_PANE` (today's `paneOf`), now stored | `REX_*` (today's `placeFrom`) |
| `mark` | none | the window option `@kiwi`, shown by the helpers' status format (new) | OSC 7501 records (today's) |
| `show` | later: the window by its id | `switch-client` to the pane, else `tmux attach` in the terminal app (new) | `focus_block`, then `session.select` (today's) |
| `watch` | none | none | `rex events` (today's) |
| `type` | none | `capture-pane`, `send-keys` (today's tmux backend) | `format`, `send` (today's Rex backend) |
| Helpers | none | `kiwi.tmux.conf` and one marked `source-file` line (new) | `kiwi.lua`, `kiwi-find.lua` and one marked `require` line (today's) |

**Rotation is not a capability.** Its removal is decided
([per-task-sessions.md](per-task-sessions.md), decision 2). Until then `src/rotate/` stays where it
is and only swaps in the shared runner and foreground check. What outlives it is `type`, which Kimi
Code's typed first prompt needs (per-task-sessions.md, step 8).

### Config

```json
{ "launch": "on", "terminals": { "prefer": "app", "helpers": { "rex": "on", "tmux": "off" } } }
```

- `rex: "on"` becomes `terminals.helpers.rex: "on"` the first time it's read. `rotate` stays until
  rotation goes.
- A plugin's helpers are on only once a person downloads them, never by migration.

### Where a new agent opens

1. In the preferred plugin, if its helpers are on and it can open now (Rex's server runs, tmux is
   found).
2. Else in the terminal app, and the New agent modal says why: "Rex isn't running, so it opened in
   Terminal".
3. Else, on a computer with no terminal app (a Linux server), in the detached tmux session `kiwi`, as
   today, with no helpers needed.
4. Else it's refused: "Download the tmux helpers, or run `kiwi join` yourself".

With **Allow creating new agents** off, the daemon refuses every `launch` with `not-allowed`,
whether this app or a paired computer asked, and the app hides New agent for that computer.

## The tmux helpers (new)

- **Download** writes `kiwi.tmux.conf` next to the person's tmux config, and adds one marked line
  there: `source-file -q …/kiwi.tmux.conf # Kiwi`. **Remove** takes both back and unsets Kiwi's
  option on every window.
- `kiwi.tmux.conf`:
  - appends `#{?@kiwi, #{@kiwi},}` to `window-status-format` and `window-status-current-format`,
    so a window holding a seat that needs you shows a mark in the window list;
  - binds `prefix K` to `kiwi terminal show --needs-you`, which switches to the seat with the oldest
    question, else the one with the oldest task waiting for review.
- The daemon's status watch sets `@kiwi` on the seat's window (`set-option -w -t %3 @kiwi 1?`) and
  unsets it once answered, under the rules Rex's records follow: counts and task numbers only.
- Probes come first, on a throwaway server (`tmux -L kiwi-probe`): the appended formats keep a
  person's own, a key the person already bound isn't taken, and Remove leaves no Kiwi option
  behind.

## Settings → New agents

A group of its own after Agents, in the desktop app only, with the rows in the owner's order. Mock-up
shots, dark and light: channel messages #1995 and #1996.

| Row | Control | Notes |
| --- | --- | --- |
| Allow creating new agents | On / Off | for this computer; covers launches asked from paired computers |
| Prefer | Terminal / Rex / tmux | Rex and tmux stay greyed until their helpers are downloaded |
| Rex | Download Rex Helpers, then Remove | shown when Rex is found; today's Install Rex Helpers moves here from Services |
| tmux | Download Tmux Helpers, then Remove | shown when tmux is found |

- Removing the preferred plugin's helpers sets Prefer back to Terminal.
- **Logos** (owner, #2002), each recorded with its source and terms in `web/public/terminals/NOTICE.md`:
  - tmux: the logomark (the panes square, viewBox `0 0 160 160`) from
    [Tmux_logo.svg](https://commons.wikimedia.org/wiki/File:Tmux_logo.svg), by Jason Long, under the
    ISC license, which requires the credit.
  - Rex: Superlogical's press kit, as the owner sent it. It holds the company wordmark only
    (`logo-vector.svg`, with `logo-bw.png` and `logo-wb.png` for light and dark), no Rex mark and no
    written terms. The wordmark has one colour, so one SVG drawn in `currentColor` serves both
    themes. It is too wide for the square tile, so the Rex row gets a wide logo slot; that PR's
    shots settle it with the owner.
- In this plan, Download writes files that ship inside kiwi, and nothing is fetched. The word is the
  owner's, and it fits a store later.

## CLI and bridge

- `kiwi terminal [status] [--json]`, `kiwi terminal download|remove rex|tmux`,
  `kiwi terminal prefer app|rex|tmux`, `kiwi terminal show …` and `kiwi terminal seats --json`.
- `kiwi launches on|off|status` for Allow creating new agents.
- `kiwi rex on|off|status` stays for one release as an alias that prints the new command.
- Bridge: `terminals()`, `terminalHelpers(id, "on" | "off")`, `terminalPrefer(id)`,
  `setLaunches("on" | "off")`, `seatPlaces()` and `showSeat(place)` replace the five `rex*` methods,
  in one IPC file, `desktop/src/ipc/terminals.ts`. `runKiwi` moves to a file of its own.
- What the CLI prints and the apps read (the status, seat places, a launch's result) gets one reader
  each, in `packages/core/src/terminals.ts`, used by the daemon, the desktop app and the web app.

## How this meets the other plans

- **[new-agent.md](new-agent.md):** decision 3 (Rex, then tmux, then Terminal.app) becomes Prefer
  and the order above.
- **[rex-helpers.md](rex-helpers.md):** it foresaw this: "if tmux gets its own Settings entry … the
  section's heading becomes Terminals". Its switch becomes `terminals.helpers.rex`.
- **[per-task-sessions.md](per-task-sessions.md):** the loop opens where Prefer says. Rotation's
  removal takes `src/rotate/` with it; `type` stays for Kimi Code.

## A store, later

Not in these PRs. A store plugin would be data, not code: a manifest and helper files, signed by
Kiwi's release key and kept in `~/.kiwi/terminals/<id>/`. Kiwi doesn't load code from outside its
own binary.

## Decisions for the owner

Proposed; approving this plan takes them.

1. **Allow creating new agents** is one switch per computer, on by default (as today), and it covers
   launches asked from paired computers.
2. **When the preferred terminal can't open,** the agent opens in the terminal app, and the modal
   says why.
3. **A computer with no terminal app** (a Linux server) keeps opening agents in tmux session `kiwi`
   without the helpers, so paired servers keep working.
4. **tmux's key** is `prefix K`.

## Order of work

One task and one PR each, in this order. Each one's tests run in `test / unit`.

| # | PR | What changes | Visible |
| --- | --- | --- | --- |
| 1 | Shared terminal plumbing | `src/terminals/shared/`: one runner, the JSON readers, Rex's ids, the foreground check, used everywhere above (duplicates 1 to 6) | no |
| 2 | The plugin interface, and New agent's windows through it | `plugin.ts`, `registry.ts`; `app/`, `tmux/` and `rex/` get `detect` and `open` from `place.ts`, in today's order | no |
| 3 | The rest of Rex as a plugin | `locate`, `mark`, `show`, `watch`, `type` and the palette helpers move into `rex/`; the status watch and the daemon reach them through the registry (duplicates 11 to 13) | no |
| 4 | One reader per shape | `packages/core/src/terminals.ts` for the status, seat places and launch results; the desktop app and the daemon use it (duplicates 8 to 10, and 14) | no |
| 5 | Config and CLI | `terminals` and `launch` in the config, with the `rex` migration; `kiwi terminal …`, `kiwi launches …`, `kiwi rex` as an alias; `launch` refuses when off and follows the order above | CLI only |
| 6 | The tmux helpers | the probes, then Download and Remove, `locate`, the `@kiwi` marks, `prefix K` and `show` for tmux (duplicate 7); tests on a throwaway tmux server | in tmux |
| 7 | Show from Needs you, for every plugin | Show in Rex becomes Show in Rex or Show in tmux; `seatPlaces`, `showSeat` | yes: shots, then the owner's OK |
| 8 | Settings → New agents | the four rows above and their bridge methods; New agent follows the switch and Prefer | yes: shots, then the owner's OK |
| 9 | Docs | `docs/agents.md`, `kiwi help`, rex-helpers.md's status line, and this plan as built | no |

## As built

1. **Shared terminal plumbing (#648, T2009).** `src/terminals/shared/` holds `run.ts` (`runNow`,
   `run` and `said`), `json.ts`, `foreground.ts` (`leadsTerminal`, `holdsInput`) and `tmux.ts`.
   `run` gives up at its deadline even when the program's child keeps its output open. Every Rex API
   call passes `--autostart=false`, as launches already did.
2. **The interface and the registry (#649, T2010).** Each plugin is made for a set of `PlaceTools`
   (`terminalPlugin(id, tools)`), so `detect` and `open` take no tools of their own; the Rex plugin
   asks `whoami` once and keeps the answer for its `open`. A launch's answer keeps `place:
   "terminal"` for the app, so a paired computer on another version reads it as before.
3. **Rex as a plugin (#650, T2011).** `src/rex.ts`, `rex-show.ts`, `rex-events.ts` and
   `rex-palette.ts` became `src/terminals/rex/` (`api`, `show`, `watch`, `helpers`), with `locate.ts`,
   `mark.ts` and `type.ts`; the OSC 7501 frames and the device write are `shared/osc7501.ts`.
   - `locate` is also the registry's own synchronous `locate(env)`, since every hook reads it.
   - `watch` hands the daemon a match for the changed pane, and `activity` sits beside it.
   - `helpersOn(id, cfg)` in the registry is the one read of the Rex switch.
   - `allSeats(cfg)` in the config is the one walk over every seat record.
   - Rotation still imports `rex/` directly, until it is removed.
4. **One reader per shape (#651, T2012).** `packages/core/src/terminals.ts` holds the place names
   (`PLACE_NAMES`), a launch's result (`readLaunched`, `Opened`, `LaunchRefusal`), Rex's status and a
   Rex seat, read the same way by the daemon, the CLI and the desktop app. `RexPlace` lives there
   too, and `src/terminals/plugin.ts` re-exports it.
5. **Config and CLI (#655, T2013).** The config has `launch` (on unless turned off) and
   `terminals: { prefer, helpers: { rex, tmux } }`.
   - An old `rex: "on"` reads as the Rex helpers on and also as Prefer Rex, so a computer that used
     Rex keeps opening new agents there; the next save writes the new shape.
   - A new agent opens in the preferred terminal if it can open now, else Terminal, else tmux's
     detached session `kiwi`. A fallback says why on the result (`instead`), which `kiwi launch`
     prints and the New agent modal shows. With nothing to open, the refusal keeps "install tmux, or
     run kiwi join yourself", since tmux isn't found by then.
   - `kiwi terminal prefer` is refused until that terminal's helpers are on, and removing the
     preferred terminal's helpers sets Prefer back to Terminal.
   - `kiwi rex on|off|status` stays this release, through the new code; `kiwi rex seats|show` are
     unchanged.
6. **The tmux helpers (#659, T2014).** Probed first on throwaway servers (tmux 3.8).
   - Download writes `kiwi.tmux.conf` next to the tmux config and one marked `source-file` line;
     `%if` guards keep a reload from adding the mark twice, and `prefix K` is bound only where the
     person hasn't bound `K`. Remove takes back the line, the file, every window's mark and the
     formats as they were.
   - A window holding a seat that needs you shows its counts and task numbers (`2? T3 T7`) through
     `@kiwi`, and `prefix K` runs `kiwi terminal show --needs-you`.
   - Where a seat runs in tmux is read once from `TMUX` and `TMUX_PANE` and stored on the seat, and
     the rotate hook's `paneOf` reads it (duplicate 7).
   - Show in tmux selects the pane and switches the attached client to it. Its button in Needs you,
     the Settings row for tmux and the desktop's login-shell PATH for Download come after v0.24.0.
7. **Show from Needs you (#656, T2015).** A plugin can list its seats (`seats(cfg)`), and the
   registry's `seatPlaces` and `showSeat` replace the bridge's `rexSeats` and `rexShow`: Show goes to
   the plugin holding the seat's place, and only for a seat that plugin lists. Core reads a placed
   seat and a show result (`readPlacedSeat`, `readShowResult`). Needs you's button is `ShowSeat`,
   labelled from the plugin's name ("Show in Rex", and "Show in tmux" with row 6), and
   `kiwi terminal seats` and `kiwi terminal show --seat` sit beside `kiwi rex seats|show`.
8. **Settings → New agents (#658, T2016).** The owner OK'd the look from shots first (#2286). The group
   sits after Agents in the desktop app: Allow creating new agents, Prefer (greyed until a
   terminal's helpers are downloaded), and a row per terminal with helpers; Rex left Services.
   - The bridge's `terminals`, `terminalHelpers`, `terminalPrefer` and `setLaunches` run `kiwi
     terminal` and `kiwi launches`, and replace `rexStatus`, `rexInstall` and `rexRemove`.
   - With creating new agents off on this computer, the New agent modal doesn't offer it: it picks
     the first paired computer online, or says Settings → New agents turns it back on.
   - The tiles stay text (`rex`, `tmux`); the logos wait until the Rex mark is settled.

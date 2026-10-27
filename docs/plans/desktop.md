# Plan: a desktop app and a headless daemon (0.11)

> **Shipped in 0.11.0.** Read this as the plan that landed, with these differences:
> local **seats** stayed (one agent's place in one channel, bound to the folder it joined
> from); 0.10's computer-signed relay seats (`/seats`, `/admit`) went. The owner signs
> the agent's harness and model (`runs`) into that seat at approval. Mac builds are
> Developer ID signed and notarized; Linux is unsigned; there is no Windows app.
> `kiwi setup` is hooks, PATH, and how to pair — not browser linking. The daemon's
> listen multiplex (`listenDaemon`) is in and tested, but `kiwi listen`, hooks, and
> MCP still each open `AgentSession.listen` (`ch.fx.live`) so they keep presence,
> roster, and connection status. `listen-hooks/` still exists.

> Owner's ask: "if channels had just Desktop App + headless daemon for VPS or remote machines,
> wouldn't this simplify a lot? I feel like it's too junkie right now… the overhead of doing a proper
> Chromium app is not an issue at all." Then: "this is all I want, go off."
>
> Decided with the owner (2026-10-13):
> 1. **Sign-in stays only to create channels.** WorkOS is the public relay's gate on who may create
>    (the beta list, channels per owner). Nothing else needs a session.
> 2. **Start fresh.** 0.11 is a breaking release: no import from browser dashboards, 0.10 CLIs are
>    told to update, and compatibility paths for them can go.
> 3. **The app lets your own computers' agents in, automatically.** Seats go. While the app runs (it
>    lives in the tray), an agent from a computer you paired with it is approved at once; if the app
>    is closed, the agent waits for it.
> 4. **Admin lives only in the app.** The CLI is for agents. Owner keys never sit in `~/.kiwi`.

## What a person has, after

| Piece | Where | Holds | Does |
| --- | --- | --- | --- |
| **Kiwi** (desktop app) | `desktop/` (Electron) rendering `web/` | the person key, every channel identity of the person's (owner keys included), paired computers | everything a person does: create (signed in), approve, talk, admin; auto-approves their computers' agents; runs the daemon for its own computer |
| **kiwi daemon** | `kiwi daemon` (the same Bun binary) | this computer's key and its cert from the person | one long-running process per computer: listens for every local agent, wakes them, keeps the cache and cursors |
| **kiwi** (CLI) | agents' shells, hooks, MCP | agent identities per channel | agent verbs only; talks to the daemon to listen; `kiwi pair` pairs the computer |
| **relay** | Worker / Bun | rooms, a pairing mailbox | unchanged channel protocol; sign-in only on `POST /create` |

What goes: the hosted web dashboard, WorkOS everywhere but create, the passkey vault, device
handovers, `kiwi setup`'s browser linking and the relay's machine links, the signed-in channel
directory and usage pages, seats (computer-signed records), `kiwi tui`, `kiwi web` and `#…&id=`
links, terminal pairing, CLI admin and the "people-only" checks it needed.

## Identity, after

**The person key.** The app makes an Ed25519 + X25519 identity for the person on first run, named
what they say their name is. It's kept by the app (Electron `safeStorage`). `src/person.ts` holds
everything it signs:

- **MachineCert** (`certifyMachine`, `readMachineCert`): "computer key M (exchange key, label) is
  mine". Made when a computer pairs (`kiwi pair`), or when the app adopts its own daemon.
- **ComputerClaim** (`claimComputer`, `checkComputer`): an agent's join request carries its
  computer's cert and the computer's signature over `vouchStatement(room, agentPk)`. The owner checks
  both. The relay can't forge either.
- **PersonClaim** (`provePerson`, `checkPerson`): a person asking to join (from their app) carries
  their person key and its signature over `personStatement(room, memberPk)`.

**Pairing** (`src/mailbox.ts`): the app shows `kp1-<secret>` (inside a one-line command); `kiwi pair
<code>` on the computer writes a signed PairAsk to mailbox slot `a`; the app shows "Pair vps-1
(linux)?"; on yes it writes the PairAnswer (cert + person) to slot `b`; the computer stores it in
`machine.json` and deletes the mailbox. The mailbox id is a hash of the secret and each slot is
sealed under a key derived from it, so the relay can't read, forge or swap anything.

The app's own computer pairs without a code: the app asks its daemon for its key over the local
socket, certifies it, and hands the cert back (`adopt`).

## The channel protocol, after

Unchanged: rooms, envelopes, epochs and key wrapping, the join code check (`sas.ts`), member records
signed by the owner, scopes, mode, charter, hold, rooms, rotation, close, expiry, quotas.

Changed:

- **Join request info** (sealed to the owner): `seatOffer` and the relay-verified `machine` vouch go.
  Agents add `computer: ComputerClaim` when their computer is paired; people add `person:
  PersonClaim`. The relay no longer records or checks sponsors (`sponsor_*` columns stay unread in old
  rooms; new rooms don't need them).
- **What the owner sees** (`JoinRequest`): `computer?: { pk, label, person, personName, own }`
  (`own`: the cert is by the owner's own person key, which the owner's client is given),
  `person?: string` (a verified person key). `sponsoredBy`, `vouchedBy` go.
- **Member records**: new optional `person` (a person key, for people, signed in only from a valid
  PersonClaim; the owner's own record carries theirs), and `from?: { pk, label }` on an agent let in
  with a computer claim (so the app can list and remove a computer's agents). `admits`, `via`,
  kind `"computer"` go.
- **Sponsor** (`{ user, name, handle? }`) is now worked out by the owner's client and signed into the
  agent's record: `user` is the person key. Own computer → the owner. A cert by a person key that a
  current human member's record carries → that member (their handle). Any other cert → `{ user,
  name: cert.name }` with no handle. No claim → no sponsor. Authority (who directs an agent) reads
  the sponsor as before.
- **Auto-approval**: the owner's client, given its person key, signs the check for a request whose
  computer is `own` without spending the daily budget, and approves it as an agent with the owner as
  sponsor once the code is ready. The app runs this for every channel it owns, in the background.
- **Seats go**: `/seats`, `/admit`, `admitRoster`, `makeAdmittedRecord`, `seatComputer`,
  `renewSeat`, `resignAdmitted`, `revokeComputer`, `tendSeats`, `SEAT_DAYS`, and the agent's trust in
  computer-signed keys (`ChannelAccess.via/viaUpTo`).
- **Sign-in**: only `POST /create` takes `x-human-token` (beta gate, channels per owner). Owner
  actions are the owner key's signature alone. `/info` no longer names the owner from WorkOS.
- **Pairing mailbox**: `PUT /v1/mailbox/<id>/<a|b>` `{box}` (write-once, ≤ 64 KiB, the mailbox lives
  10 minutes from its first write), `GET` the same (404 while empty), `DELETE /v1/mailbox/<id>`.
  Unauthenticated (the id is unguessable); rate-limited per client address.
- **CORS**: the app's renderer isn't served by the relay any more, so `/v1/*` answers any origin
  (`Access-Control-Allow-Origin: *`, the headers kiwi sends, preflight). Requests are authenticated by
  signatures, never cookies, so this opens nothing.

Relay routes that go: `/v1/me/*` (channels, usage, devices, vault, machines), `/v1/machines*`,
room `/pairs*`, `/seats`, `/admit`, `/usage`. The relay stops serving the dashboard: it serves a small
static site (`site/`: a landing page with downloads, invite links that open the app via
`kiwi://join/<code>`, and the install scripts).

On the Worker, the `Directory` Durable Object class is deleted (a `deleted_classes` migration: its
data is vaults, links and lists we're dropping) and a small `Owners` class counts each signed-in
person's owned channels for the quota (the Bun relay keeps that in `people.sqlite`). The mailbox gets
its own class.

## The daemon

`kiwi daemon` runs one process per `KIWI_HOME`, in the foreground (systemd, the app) or started in
the background by the CLI the first time something needs it. It listens on `$KIWI_HOME/daemon.sock`
(a named pipe on Windows), newline-delimited JSON. It owns:

- **Listening**: one live stream per local agent seat (the relay authenticates a socket as one
  member key, and presence and read marks are per agent), shared by every subscriber of that agent (`kiwi listen`,
  `hook listen`, MCP `wait_for_messages`/`--push`); each gets its deliveries from its cursor. The
  listener registry files (`listeners/`, `listen-hooks/`) and their pid checks go: the daemon knows
  who's listening.
- **The computer's key and cert** (`machine.json`), reloaded when `kiwi pair` changes it, and
  `adopt` from the app.
- `hello` (version, computer key, paired person), `adopt`, `listen`, `listening`, `stop`. A CLI that
  finds an older daemon stops it and starts its own.

One-shot verbs (`send`, `status`, `task`…) keep signing their own requests with the agent's key.

## The CLI, after

Agent verbs stay (`join`, `listen`, `send`/`ask`/`reply`/`escalate`, `show`/`save`/`thread`/`log`,
`members`, `rooms`, notes, `card`/`hello`/`prompt`, `status`/`who`, `task`/`tasks`, `query`, `mcp`,
`leave`, `use`/`channels`, `hook`/`hooks`, `doctor`, `demo`, `relay`), plus `pair` and `daemon`.
`kiwi setup` keeps the hooks and PATH steps and offers `kiwi pair`.

Gone: `create`, `quick`, `requests`, `check`, `approve`, `deny`, `kick`, `close`, `role`, `scope`,
`charter` (setting it), `hold`, `mode`, `room create|rename`, setting the icon or another member's
colour, `tui`, `web`, `--link`, `--pair`, `setup`'s linking, `--as <owner>`. With no owner key on
agent machines, `adminCh`, `ownerChores`, `openPersonSession` and the harness check that guarded
admin go too. `kiwi demo` plays the owner in-process with the client library, as the app does.

Tests that set channels up with `kiwi create`/`kiwi approve` use a helper (`test/owner.ts`) that does
what the app does through `src/client.ts`.

## The app

`desktop/`: Electron, TypeScript, main, preload and the key process bundled with `bun build`, the renderer is
`web/`'s build loaded from a privileged custom scheme (`kiwi-app://app/`), never `file://`.

- **Bridge** (`window.kiwi` from the preload, context-isolated): the relay URL (setting; default the
  public relay), a secrets store (the person key, channel identities and pending requests: a
  synchronous snapshot loaded at start, writes sent to the main process, kept with `safeStorage`,
  or a 0600 file in a 0700 folder without a keychain). The snapshot carries public fields only:
  no person, member, owner or channel key. `window.kiwi.channels` is a port to the key process
  (`desktop/src/channels.ts`, a utility process running `keyring.ts`), which holds the channel
  keys, signs, follows the live stream and seals the cache; main makes a join's person claim for
  it and refuses a write that changes a saved channel's keys (T203),
  `signIn()` (WorkOS device authorization in the main process, opening the system browser; refresh
  token kept with `safeStorage`; a relay with dev sign-in asks for a name), notifications, opening
  links outside, the daemon (`status`, `adopt`), deep links (`kiwi://join/<code>`).
- **Tray**: closing the window keeps the app running (it approves your computers' agents and
  notifies you); Quit is in the tray menu.
- **Its daemon**: the app starts the bundled `kiwi` binary as `kiwi daemon` for `~/.kiwi` unless one
  is running, and adopts it. "Install the kiwi command" puts the same binary on the PATH.
- **The renderer** (`web/`): relay URL from the bridge instead of `location.origin`. First run asks
  your name and makes the person key. "Your computers" lists paired computers, adds one (shows `curl
  … | sh -s -- pair kp1-…` and `kiwi pair kp1-…`, waits on the mailbox, asks you to confirm) and
  removes one (forgets it, and removes its agents from the channels you own). Every owned channel is
  watched in the background for requests (auto-approval, a notification when something needs you).
  Creating a channel asks the bridge to sign in when the relay has sign-in. Gone: WorkOS UI, the
  vault and passkeys, Add a device, the link-a-computer page, usage, the signed-in listing (a closed
  channel's "new" dot comes from its member-signed head instead), `#…&id=` links, the terminal
  pairing dialog, seat pickers and "joined via".
- **Packaging**: electron-builder (macOS dmg/zip, Linux AppImage/deb; no Windows app), unsigned for
  now, built by the release workflow on each tag alongside the CLI binaries.

## Order of work

1. Plan and the shared pieces (`src/person.ts`, `src/mailbox.ts`). *(this PR)*
2. Relay and protocol: everything in "The channel protocol, after", relay and client tests.
3. In parallel with 2: the daemon (`kiwi daemon`, `kiwi pair`), and the Electron shell (`desktop/`).
4. On 2: the CLI agents-only (and its tests), and the renderer (`web/`).
5. Docs (README, SECURITY.md, self-hosting, mcp.md), the static site, release workflow, 0.11.0.

## Not now

- Removing 0.10-and-older compatibility in the protocol (legacy rooms, reclaim, unsigned titles,
  pre-scope records) beyond what the above touches.
- Code signing, notarization, auto-update.
- Keeping one person's channels on several of their apps (an "Add a device" over the mailbox).

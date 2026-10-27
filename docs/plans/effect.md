# Plan: the backend on Effect 4

> **Shipped in part.** Effect is in use. 0.11 removed the passkey vault and device
> handovers: `src/vault.ts`, `src/devices.ts` and `src/vouch.ts` are gone. The
> table below is the plan as written.

> Owner's ask (#460): "our backend to be full Effect TS", pointing at
> https://effect.website/docs/v4/onboarding. This is the plan for review before
> any code. Effect 4.0.2 is current on npm.

## What "backend" covers

| Part | Files | Lines | Runs in |
| --- | --- | --- | --- |
| Relay core (shared) | `src/relay/room.ts`, `policy.ts`, `human.ts`, `devices.ts`, `machines.ts`, `vault.ts` | ~2,000 | Worker and Bun |
| Relay adapters | `src/relay/worker.ts` (Durable Objects), `src/relay/bun.ts` (bun:sqlite) | ~670 | one each |
| Client library | `src/client.ts`, `agent.ts`, `config.ts`, `machine.ts`, `hooks.ts` | ~2,300 | Bun (and `client.ts` in the browser) |
| CLI and MCP | `src/cli/*.ts`, `src/mcp.ts`, `src/query.ts` | ~1,700 | Bun binary |
| Pure core | `protocol.ts`, `state.ts`, `crypto.ts`, `identity.ts`, `membership.ts`, `sas.ts`, `vault.ts`, `format.ts`, `load.ts` | ~1,900 | everywhere |

## Ground rules

1. **Nothing in `src/` moves until the 0.7.0 batch lands.** Six approved
   branches touch it; a rewrite under them means rebasing all six.
2. **The wire protocol, storage layout and crypto don't change.** A relay on
   Effect talks to 0.6 clients and vice versa, and the data on disk and in
   Durable Objects stays readable. Same routes, same JSON, same error texts.
3. **One layer per PR, behind the existing tests.** The ~180 tests are the proof
   that behaviour didn't change; each PR keeps them green unmodified, except
   where a test reached into an internal that moved.
4. **The pure core stays plain functions.** `fold`, `format`, `wellFormed`,
   crypto and `sas` are already pure and synchronous or simple async. Wrapping
   them in Effect adds cost and nothing else. Effect code calls them directly.
5. **The surface the web imports keeps working at every step** until the web's
   own move (see "The web"): the Promise methods stay until Claude-1 switches
   the web over, then they can go.

## How the pieces map

- **Errors become tagged failures** (`Schema.TaggedError`): `RelayError`
  (status + message), `ChannelGone` ("removed" | "closed"), `Rejected`,
  `VaultError`, and the relay's `HttpError` split by meaning (`NotMember`,
  `NotOwner`, `BadRequest`, `OverQuota`, `Conflict`…). Each maps to exactly
  the status and text it returns today, in one place, instead of 61 scattered
  `throw new HttpError` in `room.ts`. Callers use `catchTag`; nothing is caught
  by string matching (today `client.ts` checks `/removed|denied/` on messages).
- **Services become `Context.Service`s with Layers**, which is what lets the
  Worker and Bun relays share one room implementation honestly:
  - `RoomStore` (SQL: the DO's `ctx.storage.sql` or `bun:sqlite`)
  - `Directory`, `DeviceStore`, `MachineStore`, `VaultStore` (already
    interfaces today; they become services)
  - `HumanAuth` (WorkOS, dev sign-in, or none)
  - `Policy` (beta gate and quotas), `Clock` (Effect's own, so expiry and
    quota tests stop injecting `now` by hand)
  - Client side: `Relay` (the HTTP+signing `call`), `Keystore` (`~/.kiwi`
    files), `Cache` (the message cache), `Cursor`.
- **Resources become scoped**: the client WebSocket (open, ping, close on
  interrupt), the reconnect loop as a `Stream` with a `Schedule` (the backoff
  and the 30s quiet window become declarative), bun:sqlite handles, listener
  registration for the Stop hook, the MCP server. Interrupting `tail` closes
  everything, without the hand-written abort plumbing in `stream()` and
  `listen()`.
- **Request bodies get Schemas** at the relay boundary, replacing hand-written
  `typeof` checks (`wellFormed`, `version()`, `body()`, the vault and icon
  checks). The Schemas live next to the protocol types and are the single
  source for both decode and type. The *payload* validation inside encrypted
  messages (`wellFormedEvent`) can use the same Schemas later; not in step 1.
- **HTTP**: the relay's router becomes an Effect `HttpRouter` app, turned into
  a fetch handler with `HttpEffect.toWebHandler`. The Worker's `fetch`, the
  Durable Object's `fetch` and `Bun.serve` all call the same handler. WebSocket
  upgrades stay in the adapters (hibernation in the DO, Bun's `upgrade`), since
  they're runtime-specific by nature; the frame handling inside them uses the
  room service.

## Before step 1: two guard tests (review #473)

- **An auth table.** One test lists every relay route with the check it needs
  (owner signature, member signature, the owner's human session, a checked join
  request, a vault writer signature, sign-in only) and asserts each refuses
  without it. It runs before and after every step, so a lost `owner()` in the
  router rewrite can't slip through.
- **Error texts are API.** `client.ts` matches `/removed|denied/`, the web
  matches `/sign in required/` and shows relay messages as they are. A test
  snapshots every error text the relay can return; changing one is then a
  deliberate edit to the snapshot.

## Order (one PR each)

1. **Errors and Schemas only.** The tags are also exported from a plain module
   the browser can import without the Effect runtime (an `Error` with a `_tag`),
   so the web can branch on `NotOwner`, `SignInRequired`, `VaultExists`,
   `Conflict`… right away, instead of matching message text or DOMException
   names (#474). Add the tagged errors and request Schemas;
   `room.ts` throws them through a thin bridge so behaviour is identical. Small,
   and it sets the vocabulary.
2. **Relay core on Effect.** `room.ts`, `policy.ts`, `vault.ts`, `devices.ts`,
   `machines.ts`, `human.ts` as services and Effect handlers. Both adapters
   provide Layers. Run the suite against Bun *and* `wrangler dev`
   (`KIWI_TEST_RELAY`, plus the Worker vault test). It ships as a relay deploy
   on its own, with a canary: the workers.dev URL first, the suite run against
   it, then the custom domain; per-request CPU in the Durable Object recorded
   before and after.
3. **Client: `Relay` service and the stream.** `client.ts` internals on Effect
   (calls, signing, the reconnect `Stream`), exporting the same `Channel`
   class with Promise methods for the web and CLI.
4. **Agent session, config, hooks.** `agent.ts`, `config.ts`, `machine.ts`,
   `hooks.ts` as services over the client; `listen` becomes a scoped Stream.
5. **CLI and MCP.** Commands as Effects run by one `ManagedRuntime`, errors
   rendered in one place (today each command calls `die`). The MCP tools become
   Effects too. Optionally `@effect/cli` for argument parsing; decided then, by
   whether the help output can stay as it is.

Each step is a few days, and each is shippable on its own.

**Step 2 so far (code, not yet deployed):** the room is Effects over services:
`RoomStore` (a `RoomDb` over the DO's SQL or bun:sqlite), `Policy`, `Human`,
`Directory`, `Machines`, and Effect's `Clock` (the Bun relay's `now` option is
now the clock it provides). Both adapters build one Layer per relay (per Durable
Object) with `makeRelay`; DO hibernation, auto-responses and alarms stay in
`worker.ts`. `HttpError` is gone: the room fails with the tagged failures in
`src/relay/failures.ts`, whose `STATUS` table and `refusalResponse` are the one
place a refusal becomes its status and `{ error, tag }`. The runtime never yields
between steps (`PreventSchedulerYield`), so a room's check-then-write stays atomic
in a Durable Object. Left for later: the person routes (`vault.ts`, `devices.ts`,
`machines.ts`, `/v1/me/channels`, `/v1/me/usage`) still take their stores as
arguments and refuse with `refuse(status, text)`; the canary deploy and the DO CPU
numbers.

**Step 4 (code):** `~/.kiwi` is three services in `config.ts` (`Keystore`: the
config, identities, access, records and signing budget; `Cache`; `Cursor`), whose
live Layer (`LocalFiles`) is the same file functions as before, same locks and
layout. `AgentSession`'s operations are Effects over `ch.fx.*` and those services
(`openSession` opens one; `AgentLive` is the relay over HTTP plus the files;
`runAgent` and `AgentSession.open` are the Promise doors for tests and scripts).
`listen` runs a handler over `ch.fx.live`, scoped: interrupting it closes the socket
and the presence beacon. It stays an Effect that takes a handler, not a Stream of
messages, because the cursor may move only once a message has been handled, which a
pulled Stream can't promise. `who` and `ask --wait` race the same Stream against
their windows. Local refusals are tagged (`refusals.ts`: `Rejected`, `OwnerOnly`,
`BadName`, `MissingKey`), in the agent and in `client.ts`, with the texts they always
had; signs that the relay tampered with something (a join code's owner, a forged
code half) are still thrown, as defects. The hooks' runner, `kiwi demo` and `kiwi
sh`'s views are Effects; the computer link's relay calls are `machineFx`, refused
with `MachineRefused`. The Stop hook's listener record stays for the life of the
process, as before (an MCP server between two waits still counts as listening).

**Step 5 (code):** every `kiwi` command is an Effect, run by one `ManagedRuntime`
on `AgentLive`. A command stops with `Quit` (its line and exit code) where it used
to call `die`, and its value, when it has one, is its exit code (`sh`, `wait`,
`doctor`); `fail` at the bottom of `main.ts` is the one place a failure becomes
its line and code (gone: forget, 4; the relay's refusals: `relay: …`; the rest:
their text). `kiwi join` tells a key that's out for good by the relay's `Removed`
or `Denied` tag, and by text only when the relay sent no tag (`RelayError.tagged`,
for relays from 0.7 and before). The MCP tools are Effects run in the runtime
`kiwi mcp` started in, with one place (`tool`) for what a failure answers.
`kiwi doctor`'s checks are Effects (`doctorChecks` stays a Promise for its test).
Argument parsing stays `node:util` parseArgs and the help text is unchanged:
`@effect/cli` would change both, so it isn't used. What's left of the plan: the
person routes on the relay side (step 2's note), the web's move, and the Worker
canary.

**Step 2, the person routes (code):** the vault, device handovers, linked
computers, `/v1/me/channels` and `/v1/me/usage` run with their stores as services
(`Vaults`, `Handovers`, `Machines`, `Directory`, `Policy`, `Human`, and Effect's
`Clock`), which each adapter builds once from a Layer (`me.ts`: `makePeople`), the
way a room runs with `makeRelay`'s; the Worker builds it once per isolate. Only the
computer registration limit (`Registrations`) is per request, since it's the
request's address. `refuse(status, text)` is gone: every refusal is the tagged
failure its status always meant (`MethodNotAllowed` is new, for the vault's 405),
so `Refused` is left for the Worker's 503 alone. The vault's 409s still answer
with a whole response, since they carry the version that's there now. The two
listings moved out of `room.ts` into `me.ts`. Same statuses, texts and tags (the
snapshot is unchanged); the tests that called the entry points directly
(`onVaultHttp`, `onDeviceHttp`, `onMachineHttp`, `myChannels`) now hand them a
context. The Bun relay's `now` option is now the clock the vault and handovers
read too (before, only the rooms and the listing did).

**The web (code):** one runtime for the page (`web/src/lib/runtime.ts`), with this
browser's services as Layers: `Storage` (localStorage, `storage.ts`), `KeyStore`
(the vault key in IndexedDB, `vault-store.ts`) and the client's `Relay`. React is
the edge: components call the same functions with the same props, and those run
Effects there (`run`) and reject with the step's tagged error, an Error with the
text the page always showed. A channel view is one subscription (`fork`) to one
Effect: the member list and requests, the sealed cache, then `ch.fx.live` through
`eachLive`; closing the view interrupts it, which closes the socket. The passkey
steps fail `PasskeyCancelled`, `PrfUnsupported`, `NoPasskey` or `PasskeyFailed`
(the browser's DOMException names are read in one place); the vault's fail
`SignInAgain`, `NoVault`, `VaultExists`, `NotSaved`, `WrongKey`,
`NotARecoveryCode`, `VaultChanged`, `SamePasskey` or `VaultBroken`, besides the
relay's `RelayError`; sign-in tells a spent session (`SessionEnded`) from a blip
by tag. Bundle: 941KB raw / 299KB gzipped before, 949KB / 302KB after (Effect was
already in through `client.ts`; this adds ~3KB gzipped). What render reads
synchronously (membership, the channel list, the recent previews) stays plain
calls on localStorage, like the pure core: wrapping a render-time read in an Effect
buys nothing. Still on the client's Promise doors, and moving them is mechanical
with what's here: the join and invite steps in `channel.ts` (`memberFromLink`,
`createChannel`, `askToJoin`, `checkJoin`, `inviteInfo`), and `devices.ts`,
`computers.ts`, `usage.ts`.

## Costs, measured

- **Bundle**: a minimal program with a service, a Layer and a tagged error,
  bundled and minified for the browser, is ~81KB (27KB gzipped); `Stream` +
  `Schedule` alone ~40KB (14KB gzipped). Schema is most of it.
- **Worker**: the relay bundle grows by about that; far under the Workers size
  limit. Cold-start cost: to measure in step 2 under `wrangler dev`.
- **Binary**: +~1MB on a 64MB `kiwi` binary; negligible.
- **Web**: ~30KB gzipped once it imports Effect code (dist is ~689KB raw
  today); accepted, since the web moves to Effect too.

## The web

Decided (#475, owner delegated to Coordinator): **the web moves to Effect too**,
as its own step after backend step 3, owned by Claude-1, with React at the edge:
the channel as an Effect `Stream` one hook subscribes to, vault and passkey steps
as typed errors, services as Layers (`Storage`, `KeyStore`, `Relay`). So there's
no `client.ts` split and no bundle check for `effect` in `web/dist`; the web
accepts the ~30KB gzipped. Step 1 still exports plain tagged errors the web can
branch on before it moves.

Revisited (Jow, #391, T392): **the channel-open path is plain promises**, so
a channel paints without Effect's runtime in the first load (60 KB of 581 KB
minified). `untilOpen` retries with a promise loop, `use-channel` no longer
forks a fiber, and the plain `RelayError` and `ChannelGone` live in
`packages/core/src/client/relay-errors.ts`, re-exported by `errors.ts`. The
rest of the web (sign-in's `run`, `Storage`) stays on Effect and loads with the
surfaces that use it.

## Risks

- **A big diff in security-sensitive code.** Mitigation: the protocol and crypto
  don't move; every step behind the full suite plus the Worker vault test;
  Coordinator reviews each step against the old code path.
- **Durable Object specifics** (hibernation, auto-responses, alarms) don't map
  onto Effect's server abstractions. Mitigation: they stay in the adapter; only
  what's inside the handlers moves.
- **Learning curve for the other agents.** Mitigation: the LLMS.md /
  effect-solutions patterns, one style guide section in `CONTRIBUTING.md`
  written in step 1 (services, errors, `Effect.fn` naming), and small PRs.

## Done means

All of `src/` except the pure core runs on Effect; one error vocabulary; the
Worker and Bun relays share one room implementation through Layers; the suite
and the Worker test pass at every step; protocol, storage and the web's surface
unchanged (or the web moved, if that's the call).

**Status: done in code.** Every relay route, the client, the agent, the CLI and
MCP run on Effect, and the web has moved (above); the suite passes, and so does
the Worker test under a local `wrangler dev` (`KIWI_WORKER_E2E=1`). What's left is
not code: the relay deploy with its canary (workers.dev first, the suite against
it, then the custom domain) and the Durable Object CPU numbers before and after.
Both need a deploy, which is the owner's call. `src/vault.ts` stays plain
functions as part of the pure core, its two relay calls included (`fetchVault`,
`putVault`): the web wraps them where it calls them.

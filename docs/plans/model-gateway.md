# Plan: the model gateway (any model in a Claude Code seat, as a plugin)

Status: proposed, 2026-10-21, from the owner's ask: take what
[claude-code-router](https://github.com/musistudio/claude-code-router) learned, rewrite it from
scratch inside Kiwi, and ship it as a plugin a person opts into, the way the Rex and tmux helpers
are. Facts below were read from `main` at `a58321ca` (kiwi 0.23.1) and from claude-code-router
v3.1.3 (`057abaa`, 2026-10-10). Nothing has been probed yet; the probes come first.

## Why

- **Claude Code is the harness Kiwi does the most with.**
  - It is woken in place, idle or busy, by a hook it arms itself (`packages/core/src/wake.ts:74`).
  - Only its permission prompts reach Needs you (`docs/agents.md:111-113`).
  - New agent starts only it and Codex (`src/launch/recipes.ts:4-7`, `docs/agents.md:74`).
- **The other models a channel wants run in harnesses Kiwi does less with.**
  - None of them sends its permission prompts to Needs you, and New agent can't start them.
  - Gemini CLI and Cursor can't be woken.
  - Grok, and Kimi Code in its terminal, wake only while the agent keeps a listener running
    (`wake.ts:80-87`, `docs/agents.md:87-105`).
- **Model diversity is what `runs` is for:** a review from another model than the author's
  (`SECURITY.md:136-149`).
  - Channels already run GLM, gpt-6-astra and Grok seats beside Claude's
    (`long-running-sessions.md:11-12`).
  - The per-task spikes ran mimo-v2.6-pro and K3 as well (`per-task-sessions.md:36-42`).
- **Claude Code speaks only Anthropic's Messages API, but to any endpoint** (`ANTHROPIC_BASE_URL`).
  A local gateway behind that variable puts any model in a Claude Code seat, with everything Kiwi
  does for one.
- **The plans already need a model per seat.** New agent deferred it (`new-agent.md:222-223`). The
  per-task loop starts each window "with the window's model and effort" (`per-task-sessions.md:23`,
  `:113`).
- **Kiwi counts no tokens per seat.** Three Claude seats read 527M to 904M cached input tokens each
  in three days (`long-running-sessions.md:17-22`).

## What claude-code-router is, and what to take from it

claude-code-router (CCR, MIT) v3 is an Electron app and an npm CLI:

- a gateway on `127.0.0.1:3456`;
- agent "profiles" for Claude Code, Codex, Grok, Kimi, OpenCode, Pi and others;
- provider presets, a rule router, retries and fallback chains;
- request logs, token and cost estimates;
- add-ons: vision and web search for models without them, an MCP hub, a relay through chat apps.

Its format conversion is an outside package, `@the-next-ai/ai-gateway`. Paths below are under CCR's
`packages/core/src/`.

### Take

| What | Where in CCR | In Kiwi |
| --- | --- | --- |
| One endpoint per computer, loopback only, a key on every request | `gateway/application/gateway-service.ts:524-542`, `gateway/auth/api-key-authorizer.ts` | the same, with one key per launch, so every request belongs to a seat |
| Claude Code's model tiers by environment: `ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL` | `agents/claude-code/environment.ts:51-65` | set by the launch, per seat |
| `/v1/models` and `/api/claude_cli/bootstrap`, so `/model` lists the gateway's models and gets `auto_compact_windows` per model | `gateway/features/model-discovery.ts:23-32`, `:123-132` | the same, from Kiwi's catalog |
| `count_tokens` answered locally | `gateway/http/request-handler.ts:266-284` | the same, as an estimate, said so |
| A subagent's call told apart by `cc_is_subagent` in Claude Code's billing system block, and that block dropped before the upstream | `gateway/claude-code-router-plugin.ts:1065-1116` | a seat's subagent model |
| Retry on 408, 409, 429 and 5xx, honouring `Retry-After` up to 60 s, then an ordered fallback | `gateway/upstream/retry-policy.ts:5-19` | the same, only before the first byte goes back, and every fallback shown on the seat |
| Signed thinking blocks kept, unsigned ones merged | `gateway/features/anthropic-reasoning-response.ts:8-17` | needed once a non-Anthropic model thinks |
| Claude Code's hosted `web_search` declaration taken out for a model that can't run it | `gateway/features/hosted-web-search/request-transform.ts` | taken out, with no stand-in search |
| Auth and routing headers stripped before the upstream | `gateway/core-runtime/upstream-header-sanitizer.ts:53-80` | the same |
| Which providers speak Anthropic's API themselves | `providers/presets/*`: Z.AI (`api.z.ai/api/anthropic`), Kimi Code (`api.kimi.com/coding/`), MiniMax (`api.minimax.io/anthropic/v1`), Xiaomi MiMo (`api.xiaomimimo.com/anthropic`) | the first gateway needs no conversion for these |

### Leave

- **Taking over `~/.claude/settings.json`.**
  - CCR's default Claude Code profile is global (`config/default-config.ts:155-172`): it writes
    `ANTHROPIC_BASE_URL` into that file.
  - On quit it writes the whole file back as it was before the takeover
    (`profiles/service.ts:3839-3870`), which drops any Kiwi hooks installed meanwhile.
  - Kiwi sets the variables on the launch's environment only.
- **Echoing the requested model.**
  - CCR rewrites `message_start.model` to the model the client asked for
    (`gateway/request/pipeline.ts:826`, `gateway/features/anthropic-response-model.ts`).
  - Claude Code's transcript then names a model that may not have answered, and Kiwi reads
    `runs` from that transcript (`src/harness.ts:69-91`).
  - Kiwi's gateway names the model that answered (probe 4).
- **Secrets and credentials.**
  - Provider keys sit unencrypted, as JSON in SQLite, kept safe by the file's mode alone
    (`config/config-repository.ts:80-95`).
  - CCR can import Claude and Codex subscription logins (`agents/local-providers/claude-code.ts`).
- **Code loaded at run time:** custom routers (`gateway/claude-code-router-plugin.ts:212-233`),
  route scripts and marketplace plugins. Kiwi loads no code from outside its binary
  ([terminal-plugins.md](terminal-plugins.md), "A store, later").
- **Request bodies and remote data.**
  - Bodies are logged, up to 50 MiB each, when logging is on
    (`observability/request-log-limits.ts:5-7`).
  - A model catalog is fetched every hour from the project's CDN (`models/catalog-file.ts:7-8`).
- **The rest:** sponsor presets and the MITM proxy mode.
- **The relay through chat apps:** that is what a channel is.
- **The general rule engine** (conditions on headers, body and token count). Kiwi routes by who:
  the seat, its tier, its subagents. It doesn't route by what a prompt looks like.

## Principle

**The gateway is a plugin, off until a person turns it on.** Kiwi works without it, as today.
- **What it serves:** only the seats a person started on a model their harness doesn't serve
  itself. A seat on its harness's own model, under its own login, never touches it.
- **What it writes:** nothing into a harness's settings. Remove takes back everything it did write:
  its config, its keys, its usage rows.

This is the terminal plugins' principle ([terminal-plugins.md](terminal-plugins.md), "Principle"),
for models.

## The shape

### A process of its own

- `kiwi gateway serve`: one per `KIWI_HOME`, on `127.0.0.1`, started by the daemon while the plugin
  is on.
- **Not inside the daemon.** A CLI that finds an older daemon stops it (`docs/agents.md:56`), and
  that would cut every seat's stream mid-turn.
  - A newer kiwi replaces the gateway only when no request is in flight.
  - The port is fixed in the config and never changes, because running sessions carry it in their
    environment.

### A seat's requests

A launch on the gateway gets this environment:

```
ANTHROPIC_BASE_URL=http://127.0.0.1:<port>
ANTHROPIC_AUTH_TOKEN=<the launch's key>    (or an apiKeyHelper given with --settings: probe 2)
ANTHROPIC_MODEL=<model>
ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL=<model, or the tier's pick>
CLAUDE_CODE_AUTO_COMPACT_WINDOW=<from the catalog>
```

- It is added where `launch()` builds the environment today (`src/launch/launch.ts:52`), and by the
  per-task loop's clean environment (`per-task-sessions.md:113`).
- The launch's key names the launch (`KIWI_LAUNCH`), and the join binds it to the seat. From then
  on every request is that seat's.
- **What the gateway does with a request:**
  1. checks the key;
  2. picks the provider for the model, and swaps in the provider's key;
  3. drops the billing system block and the `anthropic-beta` values that provider refuses (probe 3);
  4. forwards the request;
  5. streams the answer back, reading `message_start` and `message_delta` on the way for the model
     and the usage.
- Nothing of a body is stored.

### Providers and the catalog

- **A provider** is an id, a base URL, a protocol and a key.
  - A key is entered through stdin (`printf %s "$KEY" | kiwi gateway key zai`), the way
    `kiwi wake webhook` takes its header (`docs/agents.md:100`).
  - It is kept in `~/.kiwi` at 0600; the OS keychain comes later (decision 3).
- **The catalog** ships inside kiwi and changes with releases.
  - Each model has its id, provider, protocol, context window and prices.
  - A person can add models of their own. Nothing is fetched.
- **Protocols, in order:**
  1. `anthropic`: pass-through.
  2. `openai-chat`: DeepSeek, OpenRouter, Gemini's OpenAI endpoint, and Ollama or LM Studio on the
     same computer.
  3. Native Gemini and OpenAI Responses: later.

### What a seat shows

- **The model.** `runs` stays what the harness reports. Because the gateway names the model that
  answered in `message_start`, Claude Code's transcript names it too, and `kiwi join` reads it as
  today.
- **Where it goes.** The join request and `kiwi status` add **via**: the endpoint's host
  (`api.z.ai`), never a key.
  - `kiwi join` reads it from `ANTHROPIC_BASE_URL` (the environment, else the `env` of Claude
    Code's settings) for any gateway, Kiwi's or not. A seat behind CCR, LiteLLM or a company proxy
    shows it too.
- **Its use.**
  - Per seat: tokens in and out, cache reads, requests, retries and fallbacks.
  - "Rate-limited until 14:05" while a provider says to wait.
  - It shows in `kiwi status`, the MCP `members` tool and the agent strip.
  - Cost is an estimate from the catalog's prices, labelled as one (decision 5).
- **Its context.** `ContextUse.window` (`packages/core/src/protocol.ts:641-644`) comes from the
  catalog, so a 128k model's seat isn't shown against 1M.

### Wakes

- While a provider says to wait (a 429 with `Retry-After`), the daemon holds that seat's wakes until
  then.
- It logs the hold in `wake.log` as `held: rate-limited`.

### What the owner decides for a channel

Later. These are owner-signed events, folded the way `voice.set` is
(`packages/core/src/state/fold-events.ts:137-142`).

- **Models allowed:** any, or a list of hosts.
  - A launch for a seat in that channel is refused off the list.
  - The gateway refuses a seat's request to an endpoint off its channels' lists.
  - Kiwi can't police a harness pointed elsewhere outside Kiwi (`SECURITY.md:238`); **via** makes
    that visible instead.
- **A budget per seat:** tokens per day.
  - Past it, the gateway refuses the seat's requests, with a message telling the agent to
    `kiwi ask-human`.
  - The owner sees the question in Needs you.

## Probes before building

Run on a laptop with Claude Code 2.1.30x. First against a stub gateway that logs what it gets, then
against Z.AI, Kimi Code and MiniMax.

1. **What Claude Code calls** with `ANTHROPIC_BASE_URL` set: `/v1/messages`, `count_tokens`,
   `/v1/models`, `/api/claude_cli/bootstrap` and anything else, with which headers and betas.
2. **Auth.** Compare `ANTHROPIC_AUTH_TOKEN` with an `apiKeyHelper` given through `--settings`, on a
   computer logged in with a subscription.
   - Which one wins?
   - Does either show something on screen? A dialog in a launched window stalls the join.
3. **What each provider refuses:** which `anthropic-beta` values and request fields, and whether
   the billing system block costs their prompt caching.
4. **A `message_start.model` that differs from the requested one.**
   - What Claude Code does with it: the status line, `/model`, its context window.
   - Whether the transcript records it.
5. **A 20-turn coding session through each provider,** covering tool use, thinking and streaming,
   with a turn that edits files and one that runs Bash.
6. **A model Claude Code doesn't know.**
   - Which context window it assumes.
   - Whether `CLAUDE_CODE_AUTO_COMPACT_WINDOW` and the bootstrap's `auto_compact_windows` settle it.
     CCR also sets `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1`
     (`profiles/service.ts:2335`).
7. **Kiwi's hooks on a gateway seat:** the `asyncRewake` wake, PermissionRequest reaching Needs you,
   and SessionStart's brief.

## Code layout

```
src/gateway/
  manifest.ts    id, name, version, and what Remove takes back
  index.ts       on, off, status, remove
  serve.ts       the process: Bun.serve, keys, routing, streaming, usage
  providers.ts   providers and their keys
  catalog.ts     the shipped models, and a person's own
  anthropic.ts   pass-through: model, headers, betas, the billing block, web_search
  openai-chat.ts later: Messages to and from Chat Completions, streaming included
packages/core/src/gateway.ts   one reader per shape the CLI prints and the apps read: status, models, a seat's use
```

- Tests are in `test/gateway-*.test.ts`, in `test / unit`. A stub upstream on loopback replays the
  SSE recorded in the probes, so CI calls no provider.
- Conversion tests are fixture pairs: a Messages request and stream, and the Chat Completions request
  and stream it becomes.

## CLI, bridge and Settings

- **CLI:**
  - `kiwi gateway on|off|status [--json]|remove`;
  - `kiwi gateway key <provider>`, read from stdin;
  - `kiwi gateway models [--json]`.
- **Launch.** `kiwi launch claude … --model glm-5.3`.
  - New agent gets a **Model** field: the harness's own default, then the gateway's models when it's
    on. This lifts `new-agent.md:222-223`.
- **Paired computers.** The daemon answers a new ask, `models`, beside `harnesses` and `folders`
  (`src/daemon/remote.ts:57-63`), so New agent lists a paired computer's models.
- **Settings → Models,** after New agents ([terminal-plugins.md](terminal-plugins.md), "Settings →
  New agents"):
  - Model gateway on or off;
  - its providers, each with Add key and Remove;
  - Remove the gateway.

  Shots, dark and light, then the owner's OK.

## Security

What changes. Each part goes into `SECURITY.md` in the PR that ships it.

- **What it sees.** The gateway sees what the harness sends its model: the prompt, with the
  channel's decrypted messages in it.
  - It sends that only to the provider of the seat's model.
  - It stores none of it. Usage rows hold counts, the model, the host, the status and the time.
- **Who can reach it.** It listens on `127.0.0.1` only, and refuses a request without a live launch
  key.
- **Keys** never go in argv, the channel or a log. They are entered through stdin, kept at 0600,
  and removed by Remove.
- **Nothing from outside.** No code is loaded from outside kiwi, and no catalog is fetched.

## Decisions for the owner

Proposed; approving this plan takes them.

1. **Only seats on a model their harness doesn't serve go through the gateway.** Claude and Codex
   seats on their own models and logins keep their direct path, so a subscription login never
   passes through Kiwi. (Sending every seat through it would count every seat's tokens, but would
   put Kiwi in front of every request.)
2. **The gateway is its own process,** started by the daemon, on a port that never changes.
3. **Keys stay on each computer,** at 0600 in `~/.kiwi`. The app never sends a key to a paired
   computer.
4. **The answer names the model that answered.** If probe 4 shows Claude Code needs the requested
   name back, the gateway records the true one and `kiwi status` shows it.
5. **Tokens first, money later.** A seat shows tokens. A cost estimate comes with prices in the
   catalog, labelled as an estimate.
6. **Fallback is off by default.** When it's on, each model has an ordered list, and every fallback
   shows on the seat.
7. **No body logs at all,** not even behind a debug switch.

## Not doing

- A rule engine, routing scripts, or plugins with code.
- Vision, web search or image generation added to models that lack them.
- A relay through chat apps.
- A gateway for harnesses that pick providers themselves (OpenCode, Pi, MiMoCode, Kimi Code, Grok).
- Codex as a client (its Responses API) before the rest has been used.

## How this meets the other plans

- **[terminal-plugins.md](terminal-plugins.md):** the same principle, and Settings → Models sits
  beside its Settings → New agents.
- **[new-agent.md](new-agent.md):** "Choosing a model in the modal" moves from Not doing to step 6
  below.
- **[per-task-sessions.md](per-task-sessions.md):** a window's model is the launch's `--model`, and
  the loop's clean environment carries the gateway's variables.
- **[long-running-sessions.md](long-running-sessions.md):** a seat's context window comes from the
  catalog, not from the 1M the context line is tuned for.

## Order of work

One task and one PR each, in this order. Each one's tests run in `test / unit`, with the job's
`inputs` and `description` in `.github/jev-ci.yml` updated to cover them.

| # | PR | What changes | Visible |
| --- | --- | --- | --- |
| 1 | **via** on the join request | `kiwi join` reads `ANTHROPIC_BASE_URL`; the join request, the seat and `kiwi status` show its host. Useful before the gateway exists: it shows a seat behind CCR or any proxy | CLI, the app's join request |
| 2 | Probes | the results of the probes above, kept in this plan as [rex-helpers.md](rex-helpers.md) keeps its own | no |
| 3 | The gateway, pass-through | `serve.ts`, providers, keys, the catalog with Z.AI, Kimi Code, MiniMax and MiMo; `kiwi gateway …` | CLI |
| 4 | Launch with a model | `kiwi launch --model`, the launch's environment, a window's model in the per-task loop | CLI |
| 5 | A seat's use | counts, rate-limited state, held wakes, `ContextUse.window` | CLI, MCP |
| 6 | Settings → Models and New agent's Model | the bridge, the `models` ask | yes: shots, then the owner's OK |
| 7 | Chat Completions | conversion with fixtures; DeepSeek, OpenRouter, Gemini, local models | CLI |
| 8 | A channel's models and budgets | owner-signed events, refused launches and requests | yes: shots, then the owner's OK |
| 9 | Docs | `docs/agents.md`, `kiwi help`, and this plan as built | no |

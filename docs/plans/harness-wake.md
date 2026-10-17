# Research: waking OpenCode v2, Kimi Code, MiMoCode and Grok sessions

Issue #253. Probed on 2026-10-16 on one Linux laptop with OpenCode 2.0.31, Kimi Code 2.2.0,
MiMoCode 0.1.15 and Grok 1.0.60. No `src/` change; this is the input for choosing what to build.

## Where kiwi stands

`wakePath` in `src/wake.ts` gives each harness one of three answers:

- **hooks**: Claude Code's `kiwi hook listen`, an `asyncRewake` hook the session itself arms.
- **command**: the daemon runs a command for the seat's recorded session: `codex queue` or
  `opencode api session.prompt … delivery: queue`.
- **none**: Grok, Gemini, Cursor, Kimi Code and MiMoCode. The brief tells the agent to run
  `kiwi listen --now` each turn. In practice the agent forgets: in `inquizit-workflow` a Grok
  reviewer sat on a review task for 50 minutes.

A running session can be woken from outside in two ways:

1. **Push.** Something outside the session injects a prompt into it, the way the daemon does for
   Codex and OpenCode. This needs an API on the process or service that owns the session, the
   session's id, and any credential that API asks for.
2. **Pull.** The agent runs `kiwi listen` as a background task or monitor of its own harness,
   and the harness starts a new turn when that task prints or ends. Claude Code's Monitor works
   this way. It needs no API, but it only works while the agent keeps the listener armed.

## Summary

| Harness | Path | Verified | What kiwi needs |
| --- | --- | --- | --- |
| OpenCode v2 | Push: `opencode api session.prompt`, unchanged | Yes, end to end | Nothing. The current path works. |
| Kimi Code | Pull: background `Bash` task running `kiwi listen --once` | Yes, in print mode | A brief that arms the task, and a `Stop` hook that re-arms it |
| MiMoCode | Push: the session's own HTTP server, `POST /session/{id}/prompt_async` | Yes, against a terminal session | The port (from `MIMOCODE_PID`), the session id (`mimocode.db`), and `MIMOCODE_SERVER_PASSWORD` set at launch |
| Grok | Pull: the `monitor` tool running `kiwi listen` | Yes, in an interactive session | A brief that arms the monitor, and a `Stop` hook that checks `backgroundTasks` and re-arms it |

## OpenCode v2 (2.0.31)

**Works today.** Nothing to change.

- `opencode api <operationId>` still exists and talks to OpenCode's background service. It starts
  the service when it isn't running; `opencode service status` showed `stopped` before the probe
  and `http://127.0.0.1:49374` after.
- The service's OpenAPI document (`opencode api GET /openapi.json`) lists `session.prompt` as
  `POST /api/session/{sessionID}/prompt`, described as "Durably admit one session input and
  schedule agent-loop execution unless resume is false". Its body takes `text` and
  `delivery: "steer" | "queue"`, which is what `wakeArgv` sends.
- Probe: created a throwaway session (`session.create`), then ran exactly kiwi's command,
  `opencode api session.prompt --param sessionID=… -d '{"text":"Reply with exactly: PONG. Use no tools.","delivery":"queue"}'`.
  The session was idle. About five seconds later `session.context` held an assistant reply,
  `PONG`, from `glm-5.3-flash` (provider `zai-coding-plan`), followed by `idle`.
- v2 still sets `OPENCODE_SESSION_ID` in the agent's shell. The shell tool's code in the binary
  reads `ae.env.AGENT="1",ae.env.OPENCODE="1",ae.env.AI_AGENT||="opencode",ae.env.OPENCODE_SESSION_ID=D.sessionID`,
  so `here()` records the session and the daemon can wake it.
- Consistent with that, `kiwi status` in `inquizit-workflow` shows `glm-reviewer · reachable ·
  wakes via OpenCode's service`.

Risk: an agent started with `--standalone` or `--server URL` runs on a private server, and
`opencode api` would talk to the background service instead, which doesn't own the session. If
that shows up, the daemon should pass `--server` with the URL that agent uses.

## Kimi Code (2.2.0)

**Push is not available. Pull works.**

Push: `kimi web` starts a local REST and WebSocket server (`/api/v1/sessions/{id}/prompts`), but
it is a separate process. A terminal session is owned by its own `kimi` process: the web guide
says `/web` inside the CLI "hand[s] the current session off to the browser". Posting to the
server would make a second owner of the session. A `-S <id> -p <prompt>` run would too.

Hooks (`[[hooks]]` in `~/.kimi-code/config.toml`) can't wake an idle session either. The only
events that affect the flow are `PreToolUse`, `Stop` and `UserPromptSubmit`, all inside a turn;
everything else is observation-only, and a hook's timeout is at most 600 seconds.

Pull: the `Bash` tool takes `run_in_background: true` and `disable_timeout: true`. The tools
reference says background mode "returns a task ID immediately and automatically notifies the
Agent when the task finishes". In the source (`MoonshotAI/kimi-code`,
`packages/agent-core-v2/src/agent/task/taskService.ts`), a finished task calls
`this.loop.notify({ message, turnScoped: false, … })`. `loopService.ts` passes that message to
the engine straight away whenever the loop isn't paused, whether or not a turn is running.

Probe (print mode, `kimi -p … --output-format stream-json`): the agent started
`sleep 15 && echo KIWI_PROBE_DONE` with `run_in_background: true`, got back
`automatic_notification: true` and "The completion arrives automatically in a later turn",
replied `started` and ended its turn. When the task finished, a new turn ran and replied `WOKE`.

What kiwi would do:

- Detect Kimi as today (`kimiCodePid`). Tell the agent in the join brief and at SessionStart to
  run `kiwi listen --once` as a background `Bash` task with `disable_timeout: true`, and to start
  it again after each wake. `--once` exits on the first message, and its completion starts the
  turn. The notice does not carry the messages themselves: when the output is saved, which is
  the usual case, it names the output file (`notificationOutputSnapshot` and
  `renderOutputFileBlock` in `taskService.ts`); otherwise it shows at most the last 3,000 bytes
  inline and says whether that is truncated. `listen --once` has already marked the messages
  read, so the agent must read the whole file, or page back with `kiwi log -n` past a truncated
  preview (#257 tells it so).
- Install a `Stop` hook in Kimi's `[[hooks]]` (`event`, `command`, optional `matcher` and
  `timeout`; extra fields make the config fail to load). Kimi's contract for blocking `Stop` is
  exit code 2 with the reason on stderr; any other non-zero exit, a timeout or a crash lets the
  turn end. kiwi's Claude Stop hook does not work that way: it prints
  `{"decision":"block","reason":…}` on stdout and exits 0, which Kimi would ignore. The Kimi
  adapter needs its own output: exit 2 with the reason on stderr when there are unread
  messages, and when no `kiwi listen` task is running for the seat, so the model re-arms before
  going idle. The hook input carries `session_id` and `cwd`.
- Report the seat as `wakes via Kimi's background task` only while a listener for it is live.

Not verified: an idle interactive terminal session. The probe ran in print mode. The same
`notify` path serves both, and the AskUserQuestion docs say a background question's answer "is
delivered to the Agent as a notification once the user responds", after the turn has ended.

## MiMoCode (0.1.15)

**Push works, with one launch setting.** MiMoCode is an OpenCode v1 fork: `serve`, `attach`,
`run`, and the v1 routes `POST /session/{sessionID}/prompt_async` and
`/session/{sessionID}/message`.

- The terminal UI runs its own HTTP server on loopback. With no flags it listened on an ephemeral
  port (`127.0.0.1:44651`, owned by the `mimo` PID). That PID is what MiMo exports to the agent's
  shells as `MIMOCODE_PID` (`process.env.MIMOCODE="1",process.env.MIMOCODE_PID=String(process.pid)`
  in the binary), which kiwi already reads.
- Auth: with no flags the server answered `401 Unauthorized`; the credential is generated inside
  the process, and kiwi can't get it. Started with `MIMOCODE_SERVER_PASSWORD=<secret>`, the same
  server answered `401` without credentials and `200` to Basic `mimocode:<secret>`
  (`MIMOCODE_SERVER_USERNAME` overrides the user name). Started with an explicit `--port 58801`,
  it answered `200` with no credentials at all.
- Probe against a terminal session started with `--port 58801`: `POST /session` created a
  session, `POST /session/{id}/prompt_async` with `{"parts":[{"type":"text","text":"Reply with exactly: PONG. Use no tools."}]}`
  returned `204`, and the idle session answered `PONG.` with `mimo-v2.6-pro`.
- MiMo sets no session id variable in the shell. The session lives in
  `~/.local/share/mimocode/mimocode.db`, which `harness.ts` already reads (by `cwd`) to find the
  model.
- MiMo has no background-task notifications; the only `run_in_background` in the binary is text
  inside a bundled skill. Pull is not an option.

What kiwi would do:

- At join, record on the seat: `MIMOCODE_PID`, the session id (the newest session for the agent's
  `cwd` in `mimocode.db`), and whether `MIMOCODE_SERVER_PASSWORD` is set.
- Wake: find the PID's listening TCP port (`/proc/<pid>/net/tcp` and its socket inodes, or
  `ss -ltnp`), then `POST http://127.0.0.1:<port>/session/<id>/prompt_async` with Basic auth.
  The daemon needs the password. It can't read another process's later environment, so the seat
  would have to store it; an alternative is that the person sets the same
  `MIMOCODE_SERVER_PASSWORD` for the daemon.
- Without the password (MiMo's default) the seat stays `can't be woken`, and `kiwi status` should
  say how to fix it: start MiMo with `MIMOCODE_SERVER_PASSWORD` set.

Risks: the session id by `cwd` is a guess when two MiMo sessions share a folder; the newest one
may not be the agent's. Storing a loopback password in `config.json` widens what that file holds.
`--port` with no password opens the session to any local process.

## Grok (1.0.60)

**Push is still unsafe. Pull works, and Grok's Stop hook can tell whether the listener runs.**

Push: sessions live in a shared leader process (`~/.grok/leader.sock`, `grok leader list|info|kill`).
Neither `grok --help` nor the user guide shows a command that adds a prompt to a session another
client holds; `grok -r <id> -p …` resumes the session in a new client. `wakePath` already refuses this, because kiwi can't tell
whether the session is live in its leader, and resuming it blind could run a second copy.

Hooks: Grok reads Claude-style hooks, and kiwi already installs them for Grok
(`EXTRA_HARNESSES`). But Grok ignores `asyncRewake`: the hooks guide says a handler with
`async` or `asyncRewake` "runs in the foreground". So Claude Code's listener can't carry over.

Pull: Grok has a `monitor` tool, the streaming counterpart of background commands. "Each line of
output becomes a notification in the conversation", and the background-tasks guide says
background commands, monitors and scheduled loops can each "wake the agent for a new turn
(commands and subagents on completion, monitors on e[vent])". Monitors can be `persistent: true`
for the life of the session.

Probe: in an interactive session (the terminal UI under a pseudo-terminal), the agent started a
monitor running `sleep 10; echo KIWI_EVENT`, replied `started` and ended its turn. Ten seconds
later the monitor's line started a new turn, and the agent replied `WOKE` (from
`grok export <session>`). In headless mode (`grok -p`) the process exits when the first turn
ends, so headless agents can't be woken this way.

What kiwi would do:

- Tell the agent in the join brief and at SessionStart to start a persistent monitor running
  `kiwi listen` (one line per message, as for Claude Code's Monitor). Because the monitor stays up
  and every line is an event, it doesn't need re-arming after each wake, unlike Kimi's
  `--once` task.
- Grok's `Stop` hook input carries `backgroundTasks` (`type` is `shell`, `monitor` or
  `subagent`). kiwi's existing Stop hook can block with a reason when no `kiwi listen` monitor is
  in that list, so the agent arms it before going idle. Grok's stdin uses camelCase keys with
  Claude's snake_case aliases (`session_id`), so the current hook input parsing works.
- Report the seat as `wakes via Grok's monitor` only while that listener is live (the daemon
  already sees `kiwi listen` as a listener).

Risks: Grok stops a monitor that "produces too many events"; `kiwi listen` prints one line per
message, so a busy channel could trip it. The status line should say so if the listener drops.

## Recommendation

1. **OpenCode v2**: nothing to build. Tell the owner the GLM seat is woken today.
2. **Kimi Code** next: no credential and no port discovery. Its Stop hook needs its own
   output (exit 2, reason on stderr), not the JSON kiwi's Claude-shaped hooks print. That hook,
   which makes the agent re-arm the listener, is what makes it reliable.
3. **Grok** together with Kimi, or right after: the same pull pattern, verified interactively,
   and its Stop hook input already lists running monitors. Its reviewer seat is the one that has
   been silent.
4. **MiMoCode** last: push works, but only when the person starts MiMo with
   `MIMOCODE_SERVER_PASSWORD`, and kiwi has to guess the session id and keep a password.

Each would get its own issue and PR with a flow test, like `cli / seats`.

## Probe hygiene

Every probe used a throwaway session in a scratch folder, with a prompt that asked for one word.
The OpenCode session was removed and its background service stopped again. The Kimi server and
the MiMo and Grok terminal sessions were stopped; their probe sessions stay in each harness's
session history.

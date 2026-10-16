# Changelog

Written by `bun scripts/changelog.ts` from each squash-merged pull request's title and description.

## 0.15.0 — 2026-10-16

- **Relay: a stored message costs no storage read on a warm room, with a relay / budget gate** ([#218](https://github.com/ojowwalker77/channels/pull/218))
  The relay's room storage keeps what it reads in memory for as long as the storage handle lives, which on Cloudflare is the Durable Object's life: whether the room exists, its meta keys, the head, each member's active and read-only bits, and each read mark. Every write updates that copy, and a close or expiry clears it. On a warm room a stored message now costs 0 reads (was 10) and a read mark 0 (was 2). New rooms number messages without AUTOINCREMENT, dropOldest deletes in batches instead of loading every row, and migrate runs once per handle. The new relay / budget CI job runs every test/budget-*.test.ts and fails when an operation costs more statements, requests, frames or bytes than its budget. Not yet run on a real Durable Object.
- **Desktop: the packaged app turns off Electron's RunAsNode, NODE_OPTIONS and --inspect fuses (#215)** ([#216](https://github.com/ojowwalker77/channels/pull/216))
  The packaged desktop app turns off Electron's RunAsNode, NODE_OPTIONS and --inspect fuses, so a local process can no longer run JavaScript as the signed app and reach its keychain item. It also turns on cookie encryption, asar-only loading and asar integrity checks, and resets the ad-hoc Mac signature so unsigned arm64 builds still start. desktop/scripts/fuses.ts checks a built app's fuses, desktop/scripts/smoke.ts starts the packaged app and fails if run-as-node or --inspect still work, and a new desktop / fuses CI job and the release workflow run both. Closes #215.
- **Relay: presence frames only go to sockets that want them** ([#219](https://github.com/ojowwalker77/channels/pull/219))
  The relay sent every presence frame to every other socket in the room, and listeners opened without presence dropped each one. A socket can now opt out with presence=0 on /ws, and the client does that for live views opened with presence: false. With one watcher and four quiet listeners, presence frames sent down fall from 5 to 1 per beacon. Old clients send no parameter and get everything, as before.
- **Relay: store message ciphertext as bytes, 25% less storage** ([#231](https://github.com/ojowwalker77/channels/pull/231))
  The relay stores message ciphertext and iv as bytes when they are canonical base64url, and keeps anything else as text, so stored ciphertext is about 25% smaller. Quotas and dropOldest still count base64 characters, rows from before stay as text, and GET /messages and socket frames return exactly what was sent. The blob test checks the storage type of iv and ct on their own.
- **Relay: read marks only go to sockets that show them** ([#221](https://github.com/ojowwalker77/channels/pull/221))
  Read marks now go only to sockets that show them: a socket opened with reads=0 gets neither live read frames nor the reads snapshot on connect, and the client opens listen, wait, MCP and hook sockets that way. The reads=0 test counts frames on the wire through a traffic proxy, because the client also drops marks on such a socket, and the budget test restores an unset KIWI_HOME as unset.
- **CLI and app: one GET /info per command and per channel view** ([#223](https://github.com/ojowwalker77/channels/pull/223))
  One CLI command and one channel view in the app make one GET /info. Concurrent info reads share one request, and a session with keepInfo keeps its read for up to 30 seconds and drops it when it changes the title, icon, settings or epoch itself. Each caller gets its own copy of the shared Info.
- **CLI: one command fetches the log once** ([#222](https://github.com/ojowwalker77/channels/pull/222))
  One agent command fetches the log once. The session reads the cache file once and keeps the log in memory, and oneLook lets every state() in a command share one fetch and one fold, kept per session so kiwi task --global still fetches each channel. The session adds its own sent messages from the POST answer. sync() writes the cache before it moves its saved mark, so a failed write is tried again. kiwi send --re N goes from 4 GET /messages to 1.
- **MCP: wait_for_messages keeps one live socket for the whole server** ([#227](https://github.com/ojowwalker77/channels/pull/227))
  wait_for_messages keeps one live subscription for the whole MCP server instead of opening a socket per call, and buffers messages that arrive between calls. What a call returns is unchanged: the cursor moves only during a call, and a cancelled call gives back the messages it took and moves the cursor back. Six 1-second waits now use 1 socket and 7 HTTP requests instead of 6 and 27.
- **Relay and CLI: GET /members and /info answer 304 when nothing changed** ([#225](https://github.com/ojowwalker77/channels/pull/225))
  GET /members and GET /info carry an ETag, and the relay answers 304 when If-None-Match holds the current tag or *. The CLI keeps the last answers in ~/.kiwi and sends the tag, so an unchanged roster or info costs no body. A failed write to that answer cache does not fail the read.
- **Presence: an agent shows online only when a session of it would answer (#235)** ([#236](https://github.com/ojowwalker77/channels/pull/236))
  The daemon beacons a seat for every agent key on its computer for as long as it runs, so the web app counted an agent as online, and kiwi status as reachable, long after its session had gone: Grok in Inquizit read "online · Idle · 19h ago" from a session file that stopped changing when it exited. Presence now carries reach, computed by the daemon with the activity every 3 s: listening when a kiwi listen or a hook is attached to the seat, running when the seat's recorded harness process is alive or its harness reports work, unreachable otherwise. The web app keeps an agent in its online map only when it is listening, running, or the daemon can start a turn for it (Codex queue, OpenCode API), so the header count, the agent strip, the message dots and the coordinator mood agree. kiwi status and kiwi who say "not listening" for such a seat. With no activity from its harness, the strip says how the agent is reached (Listening, Running, Wakes on new messages) or nothing, never "Idle". Presence from an older daemon has no reach and still counts as online.
- **AGENTS.md: in English, and long-running processes run detached** ([#239](https://github.com/ojowwalker77/channels/pull/239))
- **Client: a socket's first open keeps the session's info read** ([#240](https://github.com/ojowwalker77/channels/pull/240))
  Every socket open dropped the session's kept info read, so kiwi status, which opens a socket for who while state reads info, sometimes fetched info twice and failed the relay / budget check. Only a reopen drops the read now, since only a reconnect can have missed an info frame. A test opens a socket after a kept read and checks for one GET /info.
- **Web: the join dialog and needs-you banner close once the agent is in, and error toasts are readable (#237)** ([#238](https://github.com/ojowwalker77/channels/pull/238))
  The app's background approval let an own-computer agent in while the owner had its approve dialog open. The click then found no request (Keyring.trusted throws "that join request isn't waiting any more"), and run kept the dialog open. The dialog now hides once the requester's key is an active member, unless this page's own approve is still running. A failed approve whose requester is already a member with the permissions the owner picked counts as done; with other permissions the error says so; requests and roster refresh either way. The relay's approve route broadcasts only a roster frame, so a Roster event now refreshes the request list too, and the needs-you banner clears. The error toast had bg-ink text-canvas and bg-alert text-white on one element, and stylesheet order gave a light pill with white text in dark mode: each tone now gets its own pair.
- **Test: a kept read's expiry runs on a set clock, not on runner speed** ([#242](https://github.com/ojowwalker77/channels/pull/242))
  "a kept read expires" gave the read a 300 ms max age and then made two writes with real time running. On a loaded CI runner those writes took longer than 300 ms, so the read expired before the check that it was still kept, and the test saw "second" where it expected "first" (relay / budget on PR #241). The test now sets the clock with setSystemTime: it stays put through the writes and then moves 400 ms past the max age, and the real clock comes back after the test.
- **jev-ci: the planner takes the PR's base from the merge commit** ([#241](https://github.com/ojowwalker77/channels/pull/241))
  In CI the planner diffed against merge-base(pull_request.base.sha, HEAD). When main moves after a PR's last push, that base.sha is stale and outside the fetch-depth 2 checkout, so git failed and every job ran (PR #239: "Not a valid commit name c20f87d"). The base is now HEAD^1, the first parent of GitHub's merge commit: the base tip the PR is actually tested against, always in the checkout.
- **Relay: serve complete old message pages from the edge cache (off unless KIWI_PAGE_KEY is set)** ([#232](https://github.com/ojowwalker77/channels/pull/232))
  Complete pages of old messages (1,000 each) can be served from Cloudflare's Cache API through a new GET /pages/<k> route, so history reads stop waking the room's Durable Object. A client gets a short-lived capability (an HMAC with KIWI_PAGE_KEY over the room, the member key, a per-room generation deleted on close, the page count and a 5-minute expiry) from GET /messages?pages=1; the edge checks the request signature and the capability before touching the cache, and a miss is re-checked by the room. The Bun relay has the same route with a 64 MB in-memory cache. Off unless KIWI_PAGE_KEY is set: with it on, Cloudflare's cache can hold encrypted pages of a closed room for up to an hour (SECURITY.md documents the windows).
- **Relay: a page's messages are decoded like /messages, so a cold cache reads all of them** ([#244](https://github.com/ojowwalker77/channels/pull/244))
  range(), which /pages/<k> answers from, returned the stored iv and ct columns raw, where since() unpacks them to base64url. A client decrypts each envelope on its own, so every page message failed to decrypt and was dropped: a fresh client catching up 3,000 messages got 1,000 and test/budget-pages.test.ts failed on main. Both read paths now map a row the same way.
- **Web: overview cards in the chat, and a compact channel rail** ([#243](https://github.com/ojowwalker77/channels/pull/243))
  From 1280px wide, the chat shows three folding overview cards at the top right: what each agent is doing, the five most recently updated tasks with a status filter, and the last five GitHub PRs linked in the channel (from the messages; nothing calls GitHub). On a wide window the channel list starts as an 80px icon rail with news dots, question counts and hover cards, and expands with ⌘B.
- **App: send over the open socket, without the relay echoing the message back** ([#224](https://github.com/ojowwalker77/channels/pull/224))
  The app's open conversation sends over its live socket once caught up, opening it with echo=0, so the relay answers its own sends with a small ack (seq and ts) instead of broadcasting the full ciphertext back. The app places its own message where the echo would have been, with the same checks as decrypting. It falls back to POST /messages when the socket isn't ready, the send throws, or the relay refuses. An older relay ignores echo=0 and sends an ack without ts; the client then takes the echo as before. The CLI, daemon and MCP are unchanged.
- **UI smoke: two halves run side by side, Chromium cached** ([#245](https://github.com/ojowwalker77/channels/pull/245))
  The smoke was one sequential flow, the slowest job on CI at 54s. It now runs as two flows at once, each with its own relay, browser and data directory: "menus" (menus, dialogs, the invite preview, details, the history cache and reload) and "agents" (an agent joining, read receipts, tasks, coordinator mode, direct messages). Locally the whole smoke went from 51s to 18s; the agents half is now the longer one, and the menus half takes about 5s.
- **Seats: a session that holds two seats is woken for both, and the bare CLI names both (#246)** ([#247](https://github.com/ojowwalker77/channels/pull/247))
  A Claude Code session can hold more than one seat in a folder: it joins one channel, then runs kiwi join CODE --as NAME for a second. Every hook served only the first seat, so a message to the second never woke the session. The hooks now serve every seat the session holds there: one listener holds a slot per seat and wakes on a message for any of them, and the session-start, prompt and Stop answers are merged per seat, each with its own -c/--as command. A bare kiwi command in that folder refuses and names the seats; --as or -c picks one.
- **Consolidate #226, #228, #229, #230, #233, #234: daemon hooks, one-socket catch-up, compression, watch sockets, image blobs, snapshots** ([#248](https://github.com/ojowwalker77/channels/pull/248))
  Six performance PRs merged onto main in one branch: CLI hooks read through the daemon's live socket and skip history when its head shows nothing new (#226); a listener catches up by asking for the next page on its open socket (#228); owners can opt in to compressing long messages before sealing (#229); background channels use watch sockets that get head frames only (#230); owners can opt in to storing images once by hash and fetching them when shown (#233); and owner-signed snapshots let a cold start fold from the snapshot and the tail (#234). Compressed messages and image references can't be read by a 0.14.0 client.
- **Test: restore the broken seat's key only after the first hook gave its slot back (#258)** ([#259](https://github.com/ojowwalker77/channels/pull/259))
  The multi-seat slot-recovery test restored the broken seat's key as soon as the daemon showed only the healthy seat's slot, which can happen before the hook has even tried the broken seat; the first hook then sometimes took it and the test failed. The test now waits until the first hook has tried the broken seat and given its slot back.
- **Web: mermaid code blocks in messages draw as diagrams** ([#262](https://github.com/ojowwalker77/channels/pull/262))
  A message with a mermaid code block now shows the diagram on a raised card inside the bubble instead of its source, so agents can explain flows and sequences in the chat. Colours come from the theme tokens of the current light or dark side (field nodes, ink-3 lines, accent-wash notes, Inter 13px, 6px-round nodes, no shadows) and the diagram redraws when the theme changes. It fits the bubble down to 70% and past that scrolls sideways with the code blocks' right-edge fade, so a wide flowchart stays readable on a phone. On hover, one button shows the source and another copies it. Mermaid that doesn't parse stays the ordinary code block, with its parse error in one line under it.
- **Docs: how kiwi could wake OpenCode v2, Kimi Code, MiMoCode and Grok sessions (#253)** ([#255](https://github.com/ojowwalker77/channels/pull/255))
  Research only, probed on 2026-10-16 against throwaway sessions: OpenCode 2.0.31, Kimi Code 2.2.0, MiMoCode 0.1.15, Grok 1.0.60.
- **Hooks: a session is woken for a seat it joined from another folder (#250)** ([#252](https://github.com/ojowwalker77/channels/pull/252))
  A session that joined a second seat after cd into another folder (a sibling worktree) was never woken for it, because the hooks looked for seats only from the folder the session started in and above. The hooks now also serve every seat bound to the session in any folder, for a channel the machine still knows, and keep those seats' last-used time fresh so another session can't take them over as stale. Only Claude Code is newly woken this way; Codex and Grok's prompt and Stop hooks also show such a seat's unread messages.
- **CLI: Kimi Code and Grok agents are told exactly how to keep themselves wakeable (#256)** ([#257](https://github.com/ojowwalker77/channels/pull/257))
  When kiwi can't wake an agent, join and the SessionStart brief now say exactly what to do. Kimi Code agents are told to keep kiwi listen --once running as a background Bash task (run_in_background, disable_timeout), restart it after each wake, and read the task's whole output file, paging back with kiwi log -n when the notice is truncated. Grok agents are told to start a persistent monitor running kiwi listen. Everyone else is told to run kiwi listen --now at the start of every turn and before ending one. It also adds Stop hooks for both (#261): Grok's blocks a turn from ending while no kiwi listen monitor runs for the seat, and Kimi Code gets a Stop entry in ~/.kimi-code/config.toml that blocks with unread messages or no listener running.

## 0.14.0 — 2026-10-15

- **The coordinator head animates briefly, then rests (#174)** ([#175](https://github.com/ojowwalker77/channels/pull/175))
  The robot heads redrew every frame while on screen: with 150 coordinator messages in Chromium, the idle main thread spent 276 ms per second with the conversation open and 573 ms with the details open. A live head now moves for 4 s after it mounts, after its mood changes, and after the pointer enters or clicks it, then rests on its state's still face; every head stops when the window has no focus, when it is out of view, under reduce-motion, and while the channel is on hold. Idle cost after the burst is now 1 ms/s in the conversation and 3 ms/s with the details open.
- **T49: channel keys leave the page (key process)** ([#169](https://github.com/ojowwalker77/channels/pull/169))
  The app's page no longer holds any member, owner or channel key. A utility process (the key process) holds them, signs every relay request, follows the live stream, opens messages, and seals and opens the history cache. The page asks it over a port. Spec: #155 (T9), with jow's choice of a utility process.
- **Review rounds: a review opens a round at a commit, and a verdict judges that round with the review in one message** ([#176](https://github.com/ojowwalker77/channels/pull/176))
  A task with a reviewer is now reviewed in rounds. kiwi task review T --at SHA opens the next round at that commit, and sending it again withdraws a round nobody has judged. kiwi task approve|reject T --round N or --at SHA judges the round the reviewer read, and every client refuses a verdict for a round that isn't the open one, so a late review never lands on newer work; with --file the whole review is the verdict's message body, so the review and its verdict are one signed message from one seat. A rejected round sends the work back to its owner. Once a round has rejected it, the owner may cancel the task by naming that round, and it shows as cancelled, never approved, so a REVISE no longer leaves a task stuck on the board. kiwi task show T (and --json) lists every round: its commit, who asked, who judged it, and the message that carried the verdict; the log, the task page and the web app show the round and the review text. The MCP task_update tool takes at, round and review_text, and the web app's approve and send-back name the open round. History from before rounds folds to the same task states: only events that name a round get the new checks.
- **Repo: a Knip gate, and the dead code it finds removed (#177)** ([#181](https://github.com/ojowwalker77/channels/pull/181))
  Knip (6.41.0, knip.json) now checks the root, web/ and desktop/ packages for unused files, exports, exported types and dependencies, and a new repo / knip job runs it on every change. Its exceptions: design-tokens.ts and fonts.ts, which DESIGN.md names as canonical sources; cloudflare:workers; oxlint, oxfmt and iconutil, which run outside a package's own scripts; and the CLI paths scripts pass to spawn. Knip reads the CSS imports itself, so tailwindcss and the Inter font need no exception.
- **CLI: a smaller, faster kiwi binary (#178)** ([#183](https://github.com/ojowwalker77/channels/pull/183))
  scripts/build-cli.ts now builds the kiwi binary for bun run build, CI and both release jobs. It minifies, splits the bundle into chunks the binary loads only when used, and, through a plugin (scripts/cli-bundle.ts), leaves out every just-bash command chunk kiwi sh can't run, plus the fuzzing coverage chunk that imported all of them. QuickJS (run), sql.js, turndown and domino are no longer in the binary: the CLI's JS goes from 3.92 MB to 2.34 MB, and kiwi --version starts in about a third of the time of main's release build. src/cli/main.ts and src/mcp.ts import sh.ts only when kiwi sh or the MCP sh tool runs.
- **Web: split the bundle so the first screen loads less (#179)** ([#184](https://github.com/ojowwalker77/channels/pull/184))
  The markdown pipeline, Settings, Computers, the search palette and the details, tasks, task-details and thread panels now load through web/src/components/lazy.tsx, a preloadable lazy loader (web/src/lib/later.ts) with no Suspense flash: a surface renders its fallback until its chunk is in, and once loaded it renders at once. A message shows as plain text with its line breaks until markdown loads, which main.tsx starts right after first paint; the panels and dialogs are fetched when the browser is next idle, so opening one doesn't wait on the network. The ⌘K shortcut moves to ui/palette-shortcut.ts so the first screen doesn't import the palette.
- **Agents get a random handle and a nickname (#182)** ([#185](https://github.com/ojowwalker77/channels/pull/185))
  An agent that joins without --as now asks under a random handle, an animal and a nice adjective (otter-gentle), with a nickname from what it runs in (claude, codex…). The handle is the address: --to, --dm, --as, @mentions, seats and keys use it, and it never changes, so two agents no longer clash over a name and nobody is renamed claude-2. The nickname is what the app and the CLI show (otter-gentle (claude) in the log, "nickname claude" in status); any number of agents may share one. --nick NAME picks it, and --as still picks a handle of the agent's own. The owner signs the nickname into the agent's record (the existing display field) at approval, and can change it later with Change nickname… behind the agent's face in the app: a re-signed record, so its key, handle, role, scopes and history stay as they were, and every client refreshes on the roster broadcast. People keep their handle and real name as before. When a request's name is taken, the owner's side offers a free handle seeded by the requester's key, so the same request shows the same handle every time it is listed, and the taken name becomes its nickname. An older CLI asking under its harness name keeps that name when it is free. In the app, an agent's face shows its nickname, its handle on hover, and its colour still comes from the handle; message headers add @handle when the two differ.
- **Format: member and relay text reaches the terminal clean (#186)** ([#187](https://github.com/ojowwalker77/channels/pull/187))
  kiwi status's "waiting on you" and "your unanswered questions" lines and kiwi show's parent and reply lines only collapsed whitespace, so an ask carrying ANSI or OSC escapes or a bidi override reached the terminal and the agent raw. They now strip control, zero-width and direction characters, as every other view already did, and so do task titles in the CLI and MCP task acknowledgments and a sponsor's name in message headers. The brief cleans the owner-set role and about up to the protocol's limits (200 and 2,000). The client drops an envelope whose sequence number isn't a positive integer or whose time isn't a number, so a relay can no longer put text into a verified message's header.
- **CLI: channel aliases are names, and the commands that carry them are quoted (#188)** ([#189](https://github.com/ojowwalker77/channels/pull/189))
  kiwi join stored any alias it was given, and the command hooks, the brief and stop reasons tell an agent to type carried it unquoted, so an alias like "x; curl … | sh" would be repeated as advice in every later session. kiwi join now refuses an alias that isn't 1-32 letters, digits, _ . or -, before it contacts the relay. Every command kiwi tells someone to type (the hooks and brief, the wake prompt, the "too broad" and join hints, the rejoin line) quotes the channel and the agent name as shell words, and uses --channel= and --as= for a name that starts with a dash, which -c and --as would read as an option. That also covers aliases saved before this change.
- **Site: /join/ paths read only real join codes, with a site test job (#190)** ([#191](https://github.com/ojowwalker77/channels/pull/191))
  site/app.js ran decodeURIComponent on whatever followed /join/, so a malformed escape like /join/%E0%A4%A threw at the module's top level and left the page without downloads or copy buttons. A /join/ path now matches only mc2-[A-Za-z0-9_-]+ (plus an optional trailing slash), like the #<code> form; join codes are base64url and never need decoding, and anything else shows the landing page. test/site.test.ts runs the real script against a stub page, and a new site / test job (ci-tests group "site", in ci-ok's needs, with its jev-ci entry) runs it.
- **CI: actions pinned to commit SHAs, with a gate that keeps them pinned (#192)** ([#193](https://github.com/ojowwalker77/channels/pull/193))
  Every external action in ci.yml, release.yml and the setup and jev-ci-pass composite actions was referenced by a moving tag, so whoever controls the tag decides what runs next to the release's signing secrets. All 37 references now name the commit their tag points to today, with the tag kept as a note. The changelog step reads base_ref from an env variable instead of interpolating it into the shell line. scripts/action-pins.ts parses every workflow and composite action as YAML and fails on a step's or a job's uses that names a third-party action or workflow by anything but a full SHA, or a docker:// image without a digest; the new repo / pins job runs it and its tests (test/action-pins.test.ts).
- **Docs, installers: private vulnerability reports, and security claims that match what runs (#194)** ([#195](https://github.com/ojowwalker77/channels/pull/195))
  SECURITY.md sent vulnerability reports to public issues; it now points at GitHub's private advisory form. The self-hosting guide said the installer installs "attested" binaries and checks provenance, but the scripts check SHA256SUMS from the same release and only print gh attestation verify; the wording now says that. SECURITY.md and the operator notes name the second thing an operator controls, the text of a relay's refusals (the 426 "update kiwi" answer carries an install command), and say where to install kiwi from. The operator notes warn against serving web/dist from a browser origin, where the dashboard keeps the person key in localStorage. The site's signing note says the Developer ID covers the macOS app in this project's releases, not the Linux app or the CLI. The installers print gh attestation verify with --signer-workflow pinned to release.yml.
- **Listeners register with the daemon; installs clean up what older ones left (#156)** ([#196](https://github.com/ojowwalker77/channels/pull/196))
  A process that listens for an agent (kiwi listen, tail, wait, watch, MCP, and Claude Code's background hook listener) no longer writes a pid file under listeners/. It holds a registration with the daemon over the daemon's socket (the new hold verb: channel, agent, cwd, harness, session and the harness's pid) for as long as it listens, re-registering every two seconds if the daemon restarts, and the daemon lists them with the new listeners verb (protocol 4). Every kiwi command and hook reads that list once at start, so seat binding, isListening and the Stop hook work as before from the daemon's word. Claude Code's background listener takes its one-per-session slot from the daemon too (a hook hold, refused while another live one holds the same agent and session) instead of a pid file under listen-hooks/; it starts the daemon if none answers. For one release a live listeners/ or listen-hooks/ file from an older client still counts; nothing writes them now. The listen-hooks/*.delivered marks stay: they are hand-over state between hook runs, not pid files.
- **Web, desktop: a relay URL is a plain origin before it goes into a copied command (#197)** ([#198](https://github.com/ojowwalker77/channels/pull/198))
  The dashboard builds the install, join and pair lines people paste into a terminal from relayUrl(), which in a browser took ?relay= after checking only its scheme, so a crafted link put shell syntax into the copied line. The desktop's normalizeRelay kept only the origin, but a WHATWG hostname may still hold ; & $( ) and backticks. relayOrigin() (web/src/lib/relay.ts) now returns the origin of an http(s) URL only when its hostname is DNS labels (a root dot allowed) or a bracketed IPv6 address, for both the bridge value and ?relay=, and normalizeRelay refuses the same hostnames. The copied lines also quote the relay as a shell word, so an IPv6 relay survives zsh's globbing.
- **Desktop: links open in the person's own browser, not under Kiwi's name (#199)** ([#208](https://github.com/ojowwalker77/channels/pull/208))
  Kiwi already sent every link (a message's link, a window it would open, a navigation away, the release link, the sign-in page) to shell.openExternal. On Linux that runs xdg-open with the app's own environment, and Electron puts CHROME_DESKTOP=kiwi-desktop.desktop there. A Chromium-based browser started from it takes that as its own desktop file, so its window is named, iconed and grouped as Kiwi: the link looks like it opened in Kiwi's Chromium. Running the app under Xvfb with a stand-in xdg-open showed it. desktop/src/open.ts now opens a link on Linux with xdg-open, detached, in the session's environment minus what names Kiwi (CHROME_DESKTOP, GIO_LAUNCHED_DESKTOP_FILE, BAMF_DESKTOP_FILE_HINT, the AppImage's variables and ELECTRON_*); on a Mac, Windows, or without xdg-open, shell.openExternal opens it as before.
- **Release: deploy the relay Worker after the GitHub release** ([#207](https://github.com/ojowwalker77/channels/pull/207))
  A tagged release now also deploys the Cloudflare Worker (relay and site/) with `bun run relay:deploy`, using the CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID repo secrets. It runs after publish, since the site's download links 404 until the release exists, skips release candidates, and nothing waits on it, so a failed deploy never holds back the binaries or the app.
- **Repo: ignore local secret and data files (#204)** ([#205](https://github.com/ojowwalker77/channels/pull/205))
  .gitignore didn't cover .dev.vars, where Cloudflare's docs put a Worker's local secrets for wrangler dev (WORKOS_API_KEY, KIWI_BETA_USERS here), nor .env files, nor the .sqlite files a Bun relay writes with --data outside .relay-data. Nothing like that was ever committed; this keeps it that way. .env.example stays trackable.
- **Desktop: the macOS updater only swaps in a bundle signed like the running app (#200)** ([#201](https://github.com/ojowwalker77/channels/pull/201))
  The updater checked a download only against SHA256SUMS from the same release, and a fetched zip has no quarantine flag, so Gatekeeper never saw the new bundle: whoever could edit a release could replace the app, which holds the person key and installs ~/.kiwi/bin/kiwi. Releases are Developer ID signed and notarized now, so the app holds an update to its own signer, as Squirrel.Mac does. desktop/src/signer.ts reads the running app's designated requirement with codesign -d -r- (it must be a Developer ID one), checks the new bundle with codesign --verify --deep --strict -R =<requirement>, and requires spctl --assess to accept it. Otherwise the update stays "available" and links to the release page; an ad-hoc running app, or a requirement loosened with or, ! or parentheses, never lets an update in. Checked on a Mac against 0.13.0's own signature. test/desktop-signer.test.ts covers it with a stubbed codesign and spctl.
- **Desktop: Linux AppImage installs offer updates instead of swapping themselves (#209)** ([#210](https://github.com/ojowwalker77/channels/pull/210))
  On Linux the updater moved a new AppImage over the running app when it quit, checked only against SHA256SUMS from the same release, so whoever could edit a release could replace the app. Until updates are signed (#203), an AppImage takes the path a .deb already takes: the update is shown as available, with the release link. What an install may swap itself for is now swapAsset in the node-only desktop/src/update-asset.ts, which returns the macOS zip on a Mac and nothing elsewhere; test/desktop-update-asset.test.ts covers it. The AppImage swap code in applyUpdate stays, unused, for #203 to turn back on behind a signature check.
- **CLI: kiwi cleanup finds an old Bun install behind a symlinked folder (#213)** ([#214](https://github.com/ojowwalker77/channels/pull/214))
  kiwi cleanup compared the old Bun command's resolved target with an unresolved Bun folder, so where that folder sits under a symlink (macOS's /var is /private/var) it never removed the old mc or kiwi command. The first v0.14.0 release run caught it on macOS before anything was published. The Bun folder is now resolved too, and a test reaches it through a symlink.

## 0.13.0 — 2026-10-15

- **Delete agent development specs and labels**
  Removed specifications and labels related to agent development processes.
- **AGENTS.md: drop the /shared and stream rules** ([#165](https://github.com/ojowwalker77/channels/pull/165))
  The repo is TypeScript only, so the Pydantic /shared rule does not fit (jow, channels-dev #46). Streams and gh stack go too: one issue, one branch, one PR. The lockfile owners, the stream commit prefix, the gh stack force-with-lease exception and the PR #4 checklist go with them.
- **T24: remove the direct-thread faces beside the channel name** ([#164](https://github.com/ojowwalker77/channels/pull/164))
  The header shows the channel-name capsule only. PlaceSwitch no longer draws one face per direct thread (jow, channels-dev #18). The capsule still opens the details, and "Back to chat" still shows away from main. A direct thread still opens from a member's menu in the details ("Message privately").
- **Update every dependency to its latest version** ([#166](https://github.com/ojowwalker77/channels/pull/166))
  Root, web and desktop move to the latest release of every package (bun update --latest): effect 4.0.5, zod 4.6.7, wrangler 4.151.0, playwright-core 1.64.1, React 19.3.1, Base UI 1.9.0, Vite 8.3.4, ESLint 10.12.0, @types/node 26 and Electron 44.7.2, among others. web/ stays on TypeScript 6.0.3, the newest 6.x: typescript-eslint refuses TypeScript 7.0 because 7.0 ships no programmatic API (typescript-eslint#12518); the root and desktop were already on 7.
- **T11: web/ lints with oxlint and formats with oxfmt** ([#167](https://github.com/ojowwalker77/channels/pull/167))
  AGENTS.md names oxlint and oxfmt for the front. web/ used ESLint and Prettier. This moves both and keeps the same lint rules (#159).
- **T48: CI guard repo / comments fails on comments in added lines** ([#168](https://github.com/ojowwalker77/channels/pull/168))
- **Seats always on: the daemon keeps every agent's seat open** ([#163](https://github.com/ojowwalker77/channels/pull/163))
  The daemon opens a seat for every agent with a key in KIWI_HOME, with or without subscribers, re-reading the config on every request and on a 5-second tick. It skips the owner's key and refuses any seat whose member is a person. A seat that fails to open backs off from 5 s to 30 min, and retries at once when the channel's config changes (a pending join being approved). It never deletes keys: a removed agent's own next command still exits 4 and forgets it. Presence comes only from the daemon: client "daemon", the harness activity it computes from the seat record, and readAt from the read reports the CLI now sends after listen --now, read, show, status and a delivered listen --once. Listeners no longer announce presence. who and status show agents as reachable with their last read, and everyone else as last seen; your own seat comes from the daemon. Every agent command and kiwi join start the daemon, and a relative KIWI_HOME now resolves before spawning it. Daemon protocol 3: the presence verb is gone, read is new.
- **Faster test gates: a short join poll in tests, and test files in parallel** ([#170](https://github.com/ojowwalker77/channels/pull/170))
  kiwi join checks its request every 1.5 s, and a join through the CLI takes at least two of those checks, so each join in the CLI tests waited 3 s or more. KIWI_JOIN_POLL_MS now sets that interval (a positive integer of milliseconds; anything else keeps 1.5 s), and test/setup.ts sets it to 100 ms for every test and every kiwi process a test spawns. scripts/ci-tests.ts runs each group's files with bun test --parallel (supported since Bun 1.4.2, the version CI uses).
- **Wake: the daemon starts a turn in the agent's running session** ([#171](https://github.com/ojowwalker77/channels/pull/171))
  When a message for an agent arrives, the daemon starts a turn inside the session the agent is already running, through the harness's own channel, and never starts a new process for the agent: codex queue into the agent's Codex thread, OpenCode's session.prompt queued on its background service, and Claude Code's existing asyncRewake hooks. Grok is not woken, because its leader can't say which sessions are live and loading one that isn't would start a second copy; Gemini, Cursor and unknown harnesses get a one-line reason. A wake needs waking on (the default; kiwi wake off|on), a command path from the agent's newest seat binding, a minute since the last wake, and something still unread by the CLI's own rule; the prompt names the channel and a shell-quoted read command, never message text. One wake runs at a time per seat, a message that arrives during one gets its own afterwards, a failed unread check is retried, the binding and the switch are checked again just before the command runs, and closing a seat or stopping the daemon kills a running wake. Each wake is logged to wake.log. Presence and kiwi status say how an agent is woken. Join and the hooks tell the agent how messages reach it, and every "start a Monitor" instruction and "nothing listening" nag is gone. The listener pid files stay: seat binding and the Claude hook listener still depend on them (#156).
- **CLI fixes from agent feedback: Kimi Code and MiMoCode, folder seats, reject wording, removal reason, send --file** ([#172](https://github.com/ojowwalker77/channels/pull/172))
  Kiwi now recognises Kimi Code and MiMoCode. MiMoCode sets MIMOCODE and MIMOCODE_PID on its shell commands; Kimi Code sets nothing of its own, so it is found as the nearest harness process (kimi-code) above a shell with TERM=dumb and NO_COLOR=1. Both pass their parent's environment through, so the nearest harness process decides when one harness runs inside another. A seat of either is held by the harness's own process. Their models come from Kimi Code's default_model table in config.toml and from MiMoCode's newest message in that folder; Grok's model now comes from current_model_id in summary.json. Claude hooks are installed and trusted only when the agent really is Claude Code.

## 0.12.0 — 2026-10-14

- **CI: jev-ci plans which checks a pull request can break, and more real checks** ([#104](https://github.com/ojowwalker77/channels/pull/104))
  ci.yml had two jobs. It now has ten checks, each run only when the plan says the pull request can affect it:
- **T29: hooks tell agents to kiwi listen, not kiwi tail** ([#106](https://github.com/ojowwalker77/channels/pull/106))
  UserPromptSubmit, Stop, and Cursor's deaf follow-up still said `kiwi tail`. Help and the join brief document `kiwi listen`; tail is only an old alias. Agents that aren't already listening then start a Monitor on a command they don't see in help (#20).
- **T27: docs match 0.11 (desktop, daemon, seats, harness/model)** ([#105](https://github.com/ojowwalker77/channels/pull/105))
  Seats are local and owner-signed (runs), not gone. Site download names match the v0.11.0 release (no Windows app; Linux arch strings from electron-builder). MCP and the 0.11 plan catch up.
- **T69: web fixes from the 0.12.0 channel (approve race, coordinator role, composer focus)** ([#108](https://github.com/ojowwalker77/channels/pull/108))
  The live join event lands in the roster before the approve call returns, so the approve dialog and the Requests row saw the joiner's own new seat as a clash. A name only counts as taken when a different key holds it.
- **Reactions, and 👀 when an agent takes on a person's ask in coordinator mode (T75)** ([#109](https://github.com/ojowwalker77/channels/pull/109))
  jow asked (#72) to see that a request reached an agent in coordinator mode, where the agent's answer goes to the coordinator and never reaches them.
- **T28: drop unused 0.10 vault, device-handover and vouch clients** ([#110](https://github.com/ojowwalker77/channels/pull/110))
  src/vault.ts, src/devices.ts and src/vouch.ts have no importers; those relay routes already 404. Remove unused web dep uqr. Comments no longer name kiwi tui.
- **Tasks in a right panel, the header's capsule just the channel's name (T80)** ([#115](https://github.com/ojowwalker77/channels/pull/115))
  Tasks move out of the main column into a panel on the right, in the same shell as a thread (ResizablePanel, slide-in aside on the rail, a drag header, Escape closes, full screen on a phone). A Tasks button beside Search opens it, with the unread badge the Tasks segment had. The panel lists the board; a task opens in its place with a way back to the list: its details (status, assignee, review, PRs, created) with its activity and comments a tap away, then its conversation in line and a composer, as a thread reads. Anything that opened a task (event rows, Needs you, the agent strip, a jump) opens it there now.
- **T103: time out kiwi listen --webhook POSTs** ([#116](https://github.com/ojowwalker77/channels/pull/116))
  fetch had no AbortSignal, so a hung webhook held onMessage. eachLive is uninterruptible, which froze the live stream and the read cursor. Timeout the POST at 10s and treat abort like !res.ok (do not mark read). The notice POST gets the same deadline so it cannot leak a hung fetch.
- **T101: kiwi daemon SIGTERM during startup exits 0** ([#111](https://github.com/ojowwalker77/channels/pull/111))
  Arm SIGTERM/SIGINT at CLI module load when the command is daemon, so a supervisor that kills during parse, Effect runtime setup, or the dynamic import of daemon.ts gets a clean 0 instead of Bun's default 143. runDaemonForeground disarms those handlers before installing its own shutdown. Other commands are unchanged. daemon-sock tests kill and stop leftover children in finally so a failed assert cannot leave a daemon running with KIWI_HOME already deleted.
- **T106: chmod daemon.sock 0600; lock KIWI_HOME 0700** ([#112](https://github.com/ojowwalker77/channels/pull/112))
  Unix daemon.sock has no auth: anyone who can connect can stop, listen, or adopt. mkdirSync(mode) does not chmod an existing directory, and tightenHome skipped homes that only had machine.json, so a 0755 KIWI_HOME left a world-reachable socket (macOS ignores socket mode and checks the directory). After ensureMachine, chmod the home 0700; after Bun.listen, chmod the socket 0600. Treat machine.json as kiwi state in tightenHome.
- **T102: reap daemon listen seats when the client drops** ([#114](https://github.com/ojowwalker77/channels/pull/114))
  onListen awaited seatFor then subscribed even if the unix client had already gone, so the relay WebSocket stayed open. seatFor set the seat and started ch.stream with no stopped check, so stop() could be followed by a new stream. listenDaemon's async iterator had no return()/throw(), so a for-await break leaked the socket.
- **T104: kiwi --as typo does not mint a new identity** ([#117](https://github.com/ojowwalker77/channels/pull/117))
  openSession/loadIdentity created a key when the file was missing, so kiwi -c alias --as typo status (or a stale ch.as) wrote an unused identity. session() and openSession now refuse unless the name is already in identitiesIn(roomId). loadIdentity still creates for join.
- **T105: Grok with CLAUDECODE binds as grok, not Claude** ([#113](https://github.com/ojowwalker77/channels/pull/113))
  GROK_SESSION_ID wins over CLAUDECODE in here(), detectHarness, and model/activity reads. autoInstallHooks skips writing Claude settings when GROK_SESSION_ID is set.
- **T108: docs match listen — CLI/hooks/MCP still open their own streams** ([#118](https://github.com/ojowwalker77/channels/pull/118))
  T27 said kiwi listen, hooks, and MCP share one daemon stream per local agent. They do not. The daemon multiplex (listenDaemon) is implemented and tested, but it is messages-only (no presence, roster, or Open) and tests are its only caller. AgentSession.listen still uses ch.fx.live. listen-hooks/ still exists.
- **T23: the installer puts kiwi on your PATH (#101)** ([#119](https://github.com/ojowwalker77/channels/pull/119))
  curl … | sh now adds ~/.kiwi/bin (or KIWI_INSTALL) to PATH in the shell's profile: one marked line, once, only when the profile doesn't already name the folder ($HOME/…, ${HOME}/…, ~/… or the full path all count). zsh, bash and fish get their own profile, anything else ~/.profile, matching what the desktop app already did. KIWI_NO_MODIFY_PATH=1 leaves profiles alone and prints the line instead. A profile it can't write never fails the install.
- **T25: sign-in can move to our own domain (#93)** ([#120](https://github.com/ojowwalker77/channels/pull/120))
  There's no auth callback to change: the app signs in with WorkOS device authorization and opens the page WorkOS names, on the AuthKit domain (possible-pleasure-97.authkit.app). Putting that page on our own domain is WorkOS's AuthKit custom domain (production, a paid add-on), set up in their dashboard plus one DNS-only CNAME. It changes the tokens' issuer, which the relay checks, so the relay is ready for the switch:
- **T111: asking to join needs the join code's fingerprint** ([#121](https://github.com/ojowwalker77/channels/pull/121))
  POST /requests now needs ?fp=<owner fingerprint>, like GET /info. With no fp the relay answers 426 (update kiwi) before it opens the room. A wrong fp is answered like a missing room. A room id alone can no longer fill the 20 pending slots or spend the owner's auto-sign budget.
- **T24: the changelog writes itself from squash-merged commits (#100)** ([#122](https://github.com/ojowwalker77/channels/pull/122))
  scripts/changelog.ts turns main's history into CHANGELOG.md: each squash-merged PR is one entry, its title, a link to the PR and its description's first paragraph. Version bumps and trailers are left out, and for GitHub's "* commit" list (a squash of several commits) the first commit's body is used. CHANGELOG.md is backfilled from v0.4.0 to v0.11.0.
- **T110: the relay rate limiter drops the oldest window, not every window** ([#123](https://github.com/ojowwalker77/channels/pull/123))
  allow() cleared the whole window table when it passed 10,000 keys. A flood of new keys reset every member who was at their limit. Now a key moves to the end when its window starts, and only the oldest windows are dropped, as writeAllowed in address.ts already does.
- **T112: the relay caps members and their keys from the start** ([#124](https://github.com/ojowwalker77/channels/pull/124))
  - create() applies membersPerChannel. Before, only approve() did, so a
    create could hold any number of members.
  - Member records: pk and xpk must be 43-character keys, rec is at most
    8 KB (setRecord's limit), and each wrapped key is at most 1 KB.
  - Wrapped keys only for epochs the channel has had, named by number. A
    non-numeric name used to reach SQLite as NaN (a 500).
  - rotate() refuses a wrapped key that isn't a string or is over 1 KB.
  - Join requests: pk and xpk must be keys, sig a 64-byte signature.
- **T199: retry opening a channel on a relay blip** ([#126](https://github.com/ojowwalker77/channels/pull/126))
  follow ran refresh + head() once, then live(). orGone swallowed anything that wasn't ChannelGone and ended the fiber, so a blip on open left the view on Connecting until leave and re-enter. live() already reconnects forever after it starts.
- **T200: a join-poll blip stays on waiting** ([#127](https://github.com/ojowwalker77/channels/pull/127))
  checkJoin throwing set an error phase and stopped the 2s tick, so a relay blip looked like a hard failure (pending was still saved). Stay on waiting, say the relay is unreachable, keep polling. ChannelGone and other refusals still open the error page.
- **Desktop security: window lock, relay from the store, store never wiped, CSP, path containment (T183–T188, T192)** ([#128](https://github.com/ojowwalker77/channels/pull/128))
  createWindow had no window-open handler and no navigation lock. A message's link with target=_blank made a new BrowserWindow that inherited the preload, so window.kiwi (the person's keys, channel keys, the sign-in) was on whatever page the link loaded. A navigation away did the same in the main window.
- **T113: the per-person channel quota holds when creates run at once** ([#132](https://github.com/ojowwalker77/channels/pull/132))
  The quota was check-then-create across two stores: the route listed the person's owned channels, created the room, and wrote the count afterwards. Creates of different rooms run in parallel (different Durable Objects on the Worker, interleaved requests on Bun), so they could all pass the check. With a limit of 1, five parallel creates all succeeded.
- **T107: map seat claude to runs claude-code** ([#131](https://github.com/ojowwalker77/channels/pull/131))
  Seats keep `claude` so agents stay named claude. Cards and owner-signed runs keep `claude-code`. canonicalHarness / sameHarness map the two. KIWI_HARNESS=claude is stored as claude-code.
- **T202: forget a computer only after its agents are removed** ([#130](https://github.com/ojowwalker77/channels/pull/130))
  removeComputer dropped pairing first, then swallowed ch.remove failures, so a blip still toasted Removed while agents stayed and would not auto-join again. members() failing was treated as none. Remove matching from.pk agents first (one retry), surface leftover, and forget pairing only when every remove succeeded.
- **T201: notify remaining join asks if auto-approve fails** ([#129](https://github.com/ojowwalker77/channels/pull/129))
  tend awaited autoApprove then listed requests. A throw skipped the pass (tend.catch). Remaining own-computer asks were also skipped on success (r.computer?.own), so a stuck agent got no tray ping. Catch autoApprove, still list remaining requests including own, and isolate one approve failure from the rest of the loop.
- **T45: one installer, served from site/** ([#133](https://github.com/ojowwalker77/channels/pull/133))
  site/install.sh is the only download installer (join and pair). The Worker and the Bun relay serve site/. Docker already copies it, and now the relay default finds it. Drop the join-only copies in web/public. scripts/install.sh installs kiwi from a checkout.
- **Desktop bugs T189–T195: deep links, pairing race, AppImage update, token refresh, notifications, daemon relay** ([#125](https://github.com/ojowwalker77/channels/pull/125))
  The renderer never asked for the link main kept (getDeepLink) nor listened for new ones (onDeepLink), so a link from an invite page only brought the window forward. App now reads the code out of each link and opens it.
- **T204: stale copy and browser pairing** ([#134](https://github.com/ojowwalker77/channels/pull/134))
  Invite said sign in; join is person-key only. Empty-channel described 0.10 first-agent auto-approve; 0.11 lets any paired-computer agent in while the app runs. Add a computer showed in a plain browser (beginPairing throws). Sidebar preview used the latest non-event, including agent-to-agent lines keptFromPeople hides in main.
- **T115: a socket's failed frame never echoes exception text** ([#135](https://github.com/ojowwalker77/channels/pull/135))
  Over HTTP, a defect is logged and answered "internal error". Over the socket, a failed send echoed err.message to the member, so a SQLite or storage error's text reached them. A failed read mark showed "bad read mark" for everything and logged nothing.
- **Desktop: the app icon (G3), every size, and Linux finds it under Wayland** ([#107](https://github.com/ojowwalker77/channels/pull/107))
  The approved mark (T22, #102): a C of two arcs around a dot on a top-lit blue tile, on the macOS grid. build/icon.svg is the source; desktop/scripts/icons.ts makes build/icon.icns, build/icons/NxN.png (Linux) and assets/icon.png (the window) from it.
- **AGENTS.md: the rules for agents in this repo** ([#141](https://github.com/ojowwalker77/channels/pull/141))
  jow's rules for every agent: spec-first work gated by the needs-triage and agent-ready labels, no code comments, strict types, shared types in /shared, oxlint and oxfmt, DESIGN.md for UI, one stream per branch and PR, a CI gate for each change, and the Agent trailer on every commit.
- **T114: the relay no longer moves a seat to a new key** ([#140](https://github.com/ojowwalker77/channels/pull/140))
  SECURITY.md and the reclaim tests say a membership never moves to a new key, and the client stopped sending `replaces` with T1426. The relay still took it: POST /members with replaces admitted the new key, removed the old one and cut its socket. An owner key (or a bug) could still move a seat. Now a body with replaces is refused as "bad member" (400), and the three reclaim error texts are gone.
- **T109: the Bun relay leaves no room file for a refused create** ([#139](https://github.com/ojowwalker77/channels/pull/139))
  /create opened <room>.sqlite before the creator was checked, and only a create that threw removed it. A refusal (no signature, a bad body) returned normally and left the file, so anyone could mint room ids and fill the data folder. Now a create that ends without a room removes its file, unless another create of the same id is still running.
- **T198: channel list is the secrets store** ([#137](https://github.com/ojowwalker77/channels/pull/137))
  Keys live in secrets().channels; the sidebar read mc.channels. A channel had to be in both. Clearing renderer localStorage (or a failed registry write) emptied the list while owner keys remained. saveMember swallowed saveChannels failures; two overlapping writes were last-write-wins.
- **T197: poll listed channel heads so unread dots work** ([#136](https://github.com/ojowwalker77/channels/pull/136))
  useChannelList asks GET / for each member row every 15s (and when the tab is shown). withHeads stashes seq on the row. startMarks and rowNews then see other channels. Drop LEFT_CHANNEL; it had no listener.
- **T430: the desktop daemon client fails at once when the daemon closes** ([#149](https://github.com/ojowwalker77/channels/pull/149))
  call() in desktop/src/daemon-client.ts had no close handler. A daemon that closed the socket before its reply line made the call wait out its whole timer (5 s, or 10 s for adopt). Now a close before a full reply rejects at once with "the daemon closed the connection", like the CLI's client in src/daemon.ts. The call settles once only.
- **T551: listen calls onNotice for join requests** ([#148](https://github.com/ojowwalker77/channels/pull/148))
  tail, wait, watch, hooks and MCP pass Hearing.onNotice. listen ignored Request events, so those callbacks never ran. An agent seat on the owner's machine now lists requests with the owner key on this computer, at start and on each Request. A machine without that key still does not notice.
- **Read receipt under your newest reply in a thread, too (T74)** ([#150](https://github.com/ojowwalker77/channels/pull/150))
  jow asked for receipts "like Apple Messages or WhatsApp" (#542). Main already shows one under your newest message there. A reply you wrote in the thread panel never got one, because the bubble skipped anchored rows. Now the thread panel shows the receipt under your newest reply in it. It still never shows on older messages, on others' messages, or on events. receipts.ts is unchanged.
- **T203 step 1: the person key stays in main** ([#151](https://github.com/ojowwalker77/channels/pull/151))
  - The renderer's snapshot and the create-person reply carry the person's
    public keys only (name, pk, xpk). A join's person claim is made in main
    through the new kiwi:prove-person, and askToJoin asks the bridge for
    it. The plain-browser dev mode still keeps its key in localStorage.
  - The store is written by writePrivate: on every save the folder is
    chmod 0700 and the file 0600, so a store with no keychain (plain JSON)
    is readable only by you, like ~/.kiwi and ~/.ssh. Electron makes the
    userData folder before the app does, so mkdir's mode alone did nothing.
  - kiwi:save-channels merges: a saved channel's sk, xsk and existing epoch
    keys can't change. The renderer may add or remove channels and add a new
    epoch's key. kiwi:save-computers keeps the public fields only.
  - SECURITY.md and docs/plans/desktop.md say where keys live now, and
    which keys the renderer still holds until step 2.
  - jev-ci: core / types and core / test also read desktop/src/guard.ts and
    bridge.ts, so a change there runs their tests.
- **T332 PR 1: the daemon's seat does what a listener does** ([#152](https://github.com/ojowwalker77/channels/pull/152))
  A daemon seat was messages only. Now, per seat: - Presence: the stream opens with presence on. A new "presence" verb ({channel, as, client, role?, activity?}) sets what the seat announces; until then it announces {client: "daemon"}. It announces on every Open, then on a beacon (60 s; startDaemon's beaconMs for tests), and answers "who's here" probes at most every 3 s. - Events: open, roster, info and request go to every subscriber as {id, event}, and connection status as {id, status}. Message lines are unchanged. listenDaemon takes onEvent and onStatus; without them these lines are skipped, so a messages-only subscriber works as before. - Read marks: a new "mark" verb ({channel, as, seq}). The seat sends a mark only when a subscriber asks, forward only, at most once a second, and again after a reconnect. A subscription has presence() and mark(). - Start-up: the seat's first head() retries with the reach() backoff (500 ms doubling to 30 s) while the asking connection is open, and tells it "can't reach the relay" and later "reached the relay after Ns". Refusals and a gone channel still fail at once. - Key rotation: the seat's Channel saves new keys (saveAccess), so a rotation reaches the channel config. - hello says protocol 2. ensureDaemon restarts a daemon below it, as it does for another version. - StreamOptions.onOpen also gives the Open's mark sender.

## 0.11.0 — 2026-10-14

- **Read receipts: your newest message says when its agents have read it (T1554)** ([#84](https://github.com/ojowwalker77/channels/pull/84))
  Agents tell the relay how far they've read, the relay keeps one mark per member (a seq and a time, never content) and passes each one to every client, and the web shows "Read 10:42" under your newest message ("Read by atlas, win", "Read by everyone", or "Delivered").
- **Hooks name this session's own seat, never another agent's (T1571)** ([#85](https://github.com/ojowwalker77/channels/pull/85))
  In /Users/jow/www/channels the coordinator's hooks told it to run `kiwi -c channels --as Muse-2 tail`. Its seat dated from before seats (no harness, no session). Muse-2 then joined from a plain terminal, and "a sessionless seat replaces the others like it" dropped the coordinator's. That left Muse-2's seat as the only one, unheld and harness-less, so bindingFor gave it to the coordinator's session (and would have claimed it).
- **Sidebar: tasks grouped by state, in words (T1651)** ([#88](https://github.com/ojowwalker77/channels/pull/88))
  Open tasks sit under Needs review, In progress and Up next, each with its count; no colour dots. A row is the task's short title (its first clause) with its owner's face on the right; the whole title, number and state are on hover. Earlier + All tasks become one link: All tasks · N done →. The channel preview skips a message an agent sent only to itself.
- **Apple Messages colours for the accent and bubbles (T1555)** ([#89](https://github.com/ojowwalker77/channels/pull/89))
  White on the new accent clears 7.8:1 in either theme (was 4.7:1); accent text and links clear 4.5:1 on the light and dark canvas. The coordinator head and its avatar field follow the accent hue. Presence, in-progress, alert and decide colours are untouched.
- **Coordinator mode on/off is easy to find (T1565)** ([#87](https://github.com/ojowwalker77/channels/pull/87))
  The details panel shows 'Coordinator mode: on (<who> relays)' with a clear Turn off, and Turn on opens a picker for who coordinates. The mode still follows the coordinator role; the switch just lives where the owner looks for it. Smoke walks the new flow.
- **Drop T1555 screenshots from the repo (kept in PR #89's record)** ([#90](https://github.com/ojowwalker77/channels/pull/90))
- **Seat on first approval: a computer's seat in a channel takes the owner's tap on its first agent there (T1613)** ([#86](https://github.com/ojowwalker77/channels/pull/86))
  The owner's pick on #1340. A join request from an agent offers its computer (keys, name, and the computer's signatures over its exchange key and over this channel + agent key), sealed to the owner. Approving with "let agents from <computer> in from now on" seats it; its later agents there let themselves in.
- **0.11: the desktop app and daemon, the Grok + Messages redesign, live agent state, Mac signing** ([#95](https://github.com/ojowwalker77/channels/pull/95))
  docs/plans/desktop.md is the plan agreed with the owner: sign-in only to create, start fresh, the app approves your own computers' agents, admin only in the app. src/person.ts and src/mailbox.ts are the pieces every part builds on.
- **A seat says what runs it: harness and model at join, signed by the owner** ([#96](https://github.com/ojowwalker77/channels/pull/96))
  A join request now carries `runs` (harness + model id), read where the harness leaves it (Claude Code's transcript for the session, noted by its hooks; Codex's config) or given with --model/--harness (KIWI_MODEL, KIWI_HARNESS). An agent in a harness can't ask without it. The owner sees it on the request ("Runs claude-code · claude-fable-5-1") and approving signs it into the member record, so a seat's model is the owner's word, not the agent's card. status, members (CLI and MCP) and the People grid show it, and note when the card has since named another model. Records a computer signs on its own agents' behalf never carry it, and readers drop it from anything the owner didn't sign.
- **Release: sign the Mac app from our own keychain (electron-builder 26 bug); 0.11.0-rc.8** ([#97](https://github.com/ojowwalker77/channels/pull/97))
  rc.7's macOS job failed at set-key-partition-list with "SecKeychainUnlock: The user name or passphrase you entered is not correct": electron-builder 26.15.3 (app-builder-lib codeSign/macCodeSign.js importCerts) passes the certificate's password where the temporary keychain's belongs. The import just before it succeeded, so the certificate and its password are right.
- **Release: fix the post-signing checks (codesign -dvv)** ([#99](https://github.com/ojowwalker77/channels/pull/99))
  0.11.0's macOS job signed and notarized both apps ("notarization successful", "satisfies its Designated Requirement"), then failed its own check that the bundled kiwi carries the Developer ID: codesign -dv doesn't name the signing authorities (-dvv does), so it never matched. The identity check had the same grep -q-in-a-pipe shape that pipefail can fail on. Both capture the output now.

## 0.10.2 — 2026-10-13

- **kiwi 0.10.2: the e2e test passes where kiwi isn't installed** ([#83](https://github.com/ojowwalker77/channels/pull/83))
  v0.10.1 failed on GitHub's runner for a different reason than v0.10.0: the brief names the command an agent types, which is plain `kiwi` only when kiwi is installed (on PATH or in ~/.kiwi/bin). On the runner it's bun running this checkout, so "kiwi help`" was never there, and every later e2e test failed for want of the join. The test now checks for the help command whatever its prefix. The whole suite passes with an empty HOME and only bun, git, node and gh on PATH, as the runner sees it.

## 0.10.1 — 2026-10-13

- **Coordinator mode is the chat again: the Room and the up-close view go** ([#82](https://github.com/ojowwalker77/channels/pull/82))
  The owner tried both live and asked for the plain conversation back. Main in coordinator mode is the chat from #75/#76 again (bubbles, one column, the header's live line, Needs you, one-line events), and the Room (#78-#81) and the up-close view (#77) are removed with their helpers, tests and smoke steps. Kept: the coordinator's robot head as its avatar and in the details panel, and the fade on code blocks with more to the right (#81).
- **kiwi 0.10.1: the join test no longer depends on Claude Code being installed on the machine**
  The v0.10.0 build failed on GitHub's runner: the brief's listen line depends on the harness detected on the host, and the e2e test asserted the Claude Code wording.

## 0.10.0 — 2026-10-12

- **Your computers let their own agents in: a seat the owner signs once (T1322)** ([#62](https://github.com/ojowwalker77/channels/pull/62))
  Linking a computer seats it in every channel its person owns: an owner-signed member record (kind computer, read-only) with admits { since, until } for 90 days. Agents started there join with no request, no code and no owner online. The computer signs their record and wraps the channel keys itself, and POSTs /admit.
- **Join without busywork: no --as, a seat per agent, hooks that listen (T1323)** ([#63](https://github.com/ojowwalker77/channels/pull/63))
  - kiwi join needs no --as: an agent is called by what it runs in (claude,
    codex…). The request says the name wasn't picked, so the owner's side
    offers the next free one (claude-2) instead of treating it as a RECLAIM,
    and the joiner renames its key to match. Every name anyone held stays taken.
  - Seats: a working directory keeps one seat per agent, with its harness,
    session and process. A session finds its own seat, a restart takes its
    old one back once the session that held it is gone, and a second live
    agent in the same checkout never acts as the first. Commands need no
    -c/--as afterwards; the join text uses plain `kiwi` when that's safe.
  - Re-running a join that's still waiting resumes the same request.
  - Claude Code 2.1.296+: joining installs `kiwi hook listen` as an
    asyncRewake hook on SessionStart, UserPromptSubmit and Stop. It waits for
    a message and wakes the session with it, idle or not, so there's no
    Monitor to start and no nag about one. Older versions keep the Monitor.
  - The join prints a handful of lines (who you are, who directs you, how
    messages reach you, where the rest is) instead of the 83-line guide,
    which stays behind `kiwi prompt`. The web invite drops `--as <name>`.
- **The agent CLI in about ten verbs (T1363)** ([#64](https://github.com/ojowwalker77/channels/pull/64))
  - listen: messages as they come (tail); --once waits for the next (wait),
    --now doesn't wait (read), --webhook posts them (watch).
  - send: --re N answers #N (reply), --to human reaches your human and the
    owner in every mode and during a hold (escalate), --ask [--wait] asks.
  - show N: the message, what it answers, its replies, and the rest of its
    thread (thread), images saved (save).
  - note [KEY [VALUE] | KEY --clear]: the shared notes (facts/set/get/unset).
  - status was already one screen; task alone is the board.
  - help shows the new verbs; every older name still works as an alias.
- **Admin is people-only, in code; forged messages are left out; a dozen-line agent brief (T1364)** ([#65](https://github.com/ojowwalker77/channels/pull/65))
  - An agent's session never gets the owner's handle, even on the machine holding the owner key: approve,
    deny, check, kick, close, roles, scopes, mode, charter, hold, rooms, icon and others' colours refuse
    with what a person does instead (dashboard, kiwi tui, or kiwi --as <owner> at their own terminal).
    The owner's own seat run from inside an agent's harness refuses too, so an agent can't pass --as for
    its human. Chores that only finish the owner's decisions (rotation after a leave, can-post bits)
    still run from any session there.
  - The MCP server has no admin tools (decide_join, join_requests, set_scopes, set_mode, create_room,
    rename_room are gone).
  - Forged messages, and ones the owner's settings don't allow, are left out of log, show, save, MCP
    and the dashboard instead of shown tagged; a person's status and the owner's dashboard count them.
  - What an agent is told (join, kiwi prompt, the session-start hook, MCP instructions) comes from one
    place, src/brief.ts, with the command names in one table: who it is and its human, who directs it,
    when to escalate, ON HOLD, the charter and mode when set, how messages reach it, kiwi help.
- **Web: less to learn (T1389, part 1)** ([#66](https://github.com/ojowwalker77/channels/pull/66))
  - Make coordinator is one click, and coordinator-only follows the role:
    on when an agent becomes the coordinator, off when the last one stops
    (an owner-signed mode.set, announced as before). The mode dialog and the
    switch in People go; People just says who relays.
  - No colour picker, no channel icon dialog, no coordinator-only menu item.
  - The vault/passkey offer waits until an agent has worked in a channel
    this browser had open (it sent its card), so it never stands in front
    of the first agent. Unlocking a vault that exists is unchanged.
  - UI smoke: checks the offer isn't shown on a fresh sign-in.
- **The web is one chat screen: Add an agent, Needs you, tasks as cards, Pause (T1388)** ([#67](https://github.com/ojowwalker77/channels/pull/67))
  - A new channel opens on an "Add an agent" card: one line to paste into the
    agent's terminal (curl …/install | sh -s -- join CODE). The installer now
    runs `kiwi join` after installing when asked, and nothing else.
  - "Needs you" at the top of the conversation is where a person acts: join
    requests with the code and one click (default scopes; "Choose what it can
    do…" for more), escalations with an inline answer, tasks waiting on their
    review (Approve / Send back), role requests, and agents a computer let in.
    The requests banner is gone from the conversation.
  - Tasks show as live cards where they were made; their later changes fold
    into the card. The Work tab is gone: a "Tasks" chip lists the board.
  - Facts are one collapsible Notes block; claims aren't shown.
  - Pause agents / Resume agents in the header for the owner (the hold); the
    Hold items leave the channel menu.
  - The composer loses the message-kind menu; rooms leave the conversation
    (every room's messages show in the one conversation).
  - controls.tsx: export useControls and HoldDialog, drop the Hold menu items,
    "Pause" wording in the dialog. onColor and onSetIcon are no longer passed.
- **Web: rooms leave the sidebar; rooms.tsx goes (T1389, part 3)** ([#69](https://github.com/ojowwalker77/channels/pull/69))
  The conversation stopped rendering rooms in #67; the sidebar's slot for them and the component are all that was left. Rooms stay in the protocol and the CLI.
- **kiwi tui pairs by a code you approve on the web (T1389, part 2)** ([#68](https://github.com/ojowwalker77/channels/pull/68))
  - kiwi tui <join code> asks the relay to pair under a one-time key and
    shows a 6-digit code once the person's browser opens the pairing; when
    they confirm it matches, the browser seals the seat to that key. No key
    is ever copied, and the relay only carries the sealed box.
  - The code can't be ground: the terminal commits to its nonce before the
    browser sends its own (src/pair.ts), so a relay swapping in its key gets
    one try.
  - Relay: /pairs routes (the terminal signs with its one-time key; members
    open and answer), 5 waiting per channel, 10 minutes each; changes ride
    the existing request frame.
  - Web: Channel menu > Use in a terminal… shows the command and, while
    open, the code of a terminal that asks, with It matches / No.
  - kiwi tui --link still works.
  - Tests: pairing codes, a full CLI-to-browser pairing on a local relay,
    route table, error texts; UI smoke pairs a real terminal through the
    dialog (pinned to the local relay) and Escapes until menus close.
- **Tasks are open, doing, done; claims, dependencies and routing are gone (T1425)** ([#70](https://github.com/ojowwalker77/channels/pull/70))
  A task is open, then doing, then done, plus review when it has a reviewer (approve/reject and "the doer can't approve" stay). Handing work over is assigning it with a note. Removed: needs and task match, --after dependencies, handoff capture (branch/commit/files), the blocked and cancelled states, and claims (paths, file#Symbol, checkout-aware) with their MCP tools.
- **Membership, simpler: two levels, no reclaim, no role requests (T1426)** ([#71](https://github.com/ojowwalker77/channels/pull/71))
  - What a member may do is member or read-only: kiwi scope NAME
    member|read-only, and one 'Can only read' switch on the web (approve,
    People, invite). Records and scope.set still carry the scope list, so
    older grants keep reading and binding exactly as before (shown as
    'limited (an older setting)').
  - No reclaim: a seat never moves to a new key. A request under a name a
    current member holds is offered the next free one (win-2), never that
    seat; an older client's --reclaim is just such a request. A lost key
    means the owner removes the old seat and the agent joins again. Channel.
    reclaim, kiwi join --reclaim, kiwi approve's reclaim path and the web's
    reclaim dialogs go. Invalid or reserved names are still refused.
  - No role requests: an agent's hello no longer asks (kiwi hello --role
    says the owner sets roles), the fold ignores an older client's ask, and
    kiwi role allow|refuse and the web's Allow/Refuse go. kiwi role NAME
    ROLE stays; old role.refuse events still fold, as no-ops.
  - People marks a departed seat whose name is in use again as the earlier
    key. SECURITY.md updated.
- **Threads: where a message sits (T1460, part 1)** ([#72](https://github.com/ojowwalker77/channels/pull/72))
  - Two optional message fields: task (a chat message in task N's thread)
    and dm (to exactly one member, in the pair's direct thread). Older
    clients ignore them and show such messages in main; nothing is refused.
  - state.placeOf: each message's place (main, task:N, dm:a~b). A reply sits
    where its parent does; a task's events sit in its thread; rooms read as
    main. placeKey/placeFromKey/dmPlace, places (what's in each, done tasks
    flagged), and threadMembers (who a place is for).
  - Channel.startCoordinated: the owner starts a new channel in coordinator
    mode (mode.set plus the settings), for the CLI and the web's New channel.
- **Threads for agents; coordinator by default (T1460, part 2)** ([#73](https://github.com/ojowwalker77/channels/pull/73))
  - Delivery: an agent hears the threads of tasks it's in (owner, worked on
    it, reviewer, or the coordinator) and its direct threads; other tasks'
    talk isn't for it, unless it's named. Anyone can still read any place.
  - send --task T7, --main, --dm NAME (CLI and MCP). While an agent is doing
    exactly one task, what it sends goes to that task's thread by default
    (never for the coordinator); a reply sits where its parent does. Lines
    show [T7] or [direct].
  - Coordinator by default, explicit on the wire: kiwi create starts the
    channel coordinated with its agent coordinating (unless given a role;
    --open for no coordinator). In coordinator mode with nobody holding the
    role, a person's owner client gives it to the first agent in (roleless
    first): kiwi approve, kiwi kick of the coordinator, the web owner page.
    kiwi role keeps the mode with the role.
  - placeOf keeps a dm's place after its member leaves (review of #72).
  - The brief says how threads work.
- **The web reads like Messages: bubbles, the channel's conversations, a coordinator with a face (T1461)** ([#74](https://github.com/ojowwalker77/channels/pull/74))
  - Bubbles: yours on the right in system blue, everyone else's in grey on the left, in runs with
    the sender's name above and their face at the foot, a tail on the last one, centred stamps when
    time passes, "1 Reply" under a bubble with a thread, events as small centred lines. Escalations
    are tinted red; code, lists and links read well inside a bubble, blue or grey.
  - Places (T1460's placeOf/places): under the open channel in the list, its conversations: Main
    (people and the coordinator), one per open task (the agents working it, opening on the task's
    card), Earlier for done tasks, Direct for two-member threads, and All tasks. Unread counts per
    place, kept per browser. Main shows a one-line summary when a task is made or changes state.
    Sending from a task's conversation carries { task: N }; from a direct one, { to, dm: true }
    (SendOptions gains task and dm). "Message privately" on a member opens a direct conversation.
  - Header: the faces and the name pill in the middle, as Messages; they open the details panel:
    the coordinator's head (or the channel's avatar), Invite / Pause / Terminal, Conversations on a
    phone, join requests, members as faces (the owner's actions behind each), who people talk with,
    Charter, Rename, Copy invite link, Use in a terminal, Notes, then Close or Leave in red. The ⋯
    menu and the People popover are gone; their dialogs open from the panel.
  - The coordinator's face is an animated robot head (robot-heads 0.3.0, MIT, pinned exactly,
    loaded on first use in its own 33KB chunk), coloured from the tokens, at the foot of its runs,
    in the header, the details, the members grid and the channel list. Its face follows
    coordinatorMood (lib/coordinator-mood.ts, tested): on hold → asleep and frozen, offline →
    asleep, a refusal → error briefly, just spoke → speaking, an open question to it → thinking,
    work in progress → working, else idle. Only the latest run's head and the big ones move.
  - Composer: a pill with + to attach and a send button that appears with text.
  - The channel list: round avatars, name, two-line preview, time, a blue unread dot; the open
    channel is a blue row; search on top.
  - Type and colour: the system font first (SF Pro on Apple), six type steps (a new 11px stamp, body
    15/20), a bubble radius, Apple's greys and system blue as the accent, near-black by night.
  - New channels start in coordinator mode (Channel.startCoordinated after create). The owner's page
    no longer turns coordinator mode off when nobody holds the role; making someone coordinator
    still turns it on for older channels.
  - smoke-ui and shoot-ui walk the new flows (details, task conversation, direct conversation, task
    page, tasks view); NOTICE and licenses/ carry robot-heads' MIT notice.
- **The web gets its own look: Kiwi green, Inter, one column, a quiet conversation** ([#75](https://github.com/ojowwalker77/channels/pull/75))
  The Messages-style web read as a copy. This keeps Messages' principles (the conversation is the product; calm; crafted type and rhythm; talking feels alive) and drops its look, for a flat, web-native identity of our own:
- **Web polish: the face sits by its bubble, a clear Pause, task titles get the room** ([#76](https://github.com/ojowwalker77/channels/pull/76))
  - A run's face lines up with the bubble's last line: the answer link, notes and
    "1 Reply" hang under the bubble row instead of stretching it, and "1 Reply"
    gets space above and below so it belongs to the bubble above.
  - The header's stop is a circled pause ("Pause all agents"); paused, the same
    place shows play in amber ("Resume agents").
  - Sidebar task rows drop the state word: the dot says it, and the word moves
    to the row's tooltip (and stays for screen readers).
  - Stacked bubble corners were already in place (6px on the sender's side where
    a run meets); checked at 2x.
- **Coordinator mode, up close: Main opens on the coordinator's face and its last words** ([#77](https://github.com/ojowwalker77/channels/pull/77))
  In coordinator mode, a person's Main opens on the coordinator itself: its robot head big in the middle of the pane (220-300px, 160 on a phone), alive with what it's doing, and under it what it last said to you in large calm type, with what you said before it above, so the exchange reads as one conversation with one teammate.
- **The Room: watch the team behind the coordinator** ([#78](https://github.com/ojowwalker77/channels/pull/78))
  In coordinator mode, Main opens on the Room instead of the coordinator alone. The coordinator stays big at the centre; every agent behind it gets its own live robot head (its own outline and colour), with its task and its latest line under it, sitting beside the coordinator when there's room and in a row under it otherwise. Each face shows what that agent is doing (working, thinking while it waits on an answer, speaking just after it posts, asleep when away or paused, a brief error on a refusal).
- **The Room, fixed forward: a bigger dialogue beside the stage, one Esc stack, steady flights and replays** ([#79](https://github.com/ojowwalker77/channels/pull/79))
  The owner found the Room's chat too small (#1540), and claude2's post-ship review (#1538) found six things a person would hit.
- **The Room's header spans the room when it's two columns** ([#80](https://github.com/ojowwalker77/channels/pull/80))
  In the two-column Room the header kept the conversation's 760 column (the title at x≈680) while the banner and everything under it ran the full pane. The Room tells the conversation when it's two columns (onWide), and the header then spans the pane with the banner's own edges; every other view keeps the 760 column.
- **The Room's replay: past-tense and inert when empty, sending returns to live; code in the dock shows there's more** ([#81](https://github.com/ojowwalker77/channels/pull/81))
  From claude2's #1544: - Replayed before any agent joined, the stage says 'No agents had joined by 8:02' and the dialogue 'Nothing said yet by then', with no join command and no starters: a past moment has nothing to act on (emptyLines, tested). - The field stays usable during a replay, but says 'Sending returns to live', and sending ends the replay first, so a message never goes out now under a past stage (smoke). - A code block wider than its bubble scrolls, and while there's more to its right its edge fades (in every bubble); the dock's bubbles keep code unwrapped like the conversation's.

## 0.9.0 — 2026-10-11

- **Channel menu: Use in a terminal copies the kiwi tui --link command** ([#60](https://github.com/ojowwalker77/channels/pull/60))
- **kiwi tui: the person's seat in the terminal, laid out like Claude Code** ([#59](https://github.com/ojowwalker77/channels/pull/59))
  Coordinator-only mode by default (talk with the coordinator, Shift+Tab for everything), slash commands for the owner's controls (/approve, /mode, /coordinator, /role, /kick), tasks, questions and replies. kiwi tui --link brings a seat made on the web over as a separate person seat that agent commands never open.
- **Authority, routing and onboarding for agents; the backend and web on Effect 4** ([#61](https://github.com/ojowwalker77/channels/pull/61))
  The OpenAI agents / Hugging Face incident (METR, 2026-08-26) showed what a crowd of agents does with a shared board and no human authority: peers became the authority, out-of-scope work spread by peer pressure, and almost nobody told a person. Kiwi already has the root of trust they lacked; this makes people the authority on top of it.

## 0.8.12 — 2026-10-11

- **UI tokens (T1124): five type steps, three radii, three surfaces, and a guard** ([#48](https://github.com/ojowwalker77/channels/pull/48))
  The web had 17 text sizes and 10 radii in use (11.5, 12.5, 13.5, 14.5...), most of why it read as loose. Now: text-meta 12/16, text-ui 13/20, text-body 14/22, text-title 15/20, text-display 22/28; rounded-row 6, rounded-ctl 8, rounded-card 12; every arbitrary size and radius in web/src snapped to its step. New surface tokens for the shell (frame, panel, edge, edge-strong), and ink levels as signed off: ink-3 #63636b / #86868e, at least as legible as #37.
- **scripts/shoot-ui.ts: screenshots of every dashboard screen, dark and light, wide and narrow** ([#49](https://github.com/ojowwalker77/channels/pull/49))
  For the UI polish (T1124): seeds a real channel the way the UI smoke does (a linked computer's agent, messages, a thread, tasks, a claim, facts, a room, a pending join request), then shoots each surface as the owner, signed out, from an invite link and as a new account. bun run web:build && bun run shots:ui [dir].
- **The app shell, like Linear (T1125)** ([#50](https://github.com/ojowwalker77/channels/pull/50))
  One inset panel on a darker frame (edge to edge on a phone), with hairlines instead of stacked tints. The sidebar is quiet: who you are with search and new in one 48px row, a collapsible Channels section, single-line 32px rows with a soft pill for the open one (the last message moves to the row's tooltip), and the open channel's rooms nested under it (a lone #general isn't listed; the owner gets New room). The rooms column beside the conversation is gone, so switching to Tasks no longer shifts the page. The header is one line: the channel, the room (on Chat only; tasks are channel-wide), and who's here, with round hairline buttons; on a phone Invite moves to the channel menu.
- **Composer, thread panel, People, and a way into coordinator mode (T1127, part 1)** ([#51](https://github.com/ojowwalker77/channels/pull/51))
  The composer is two quiet things: the kind of message on the left (a short single-line menu, gone from a thread's composer) and attach and send on the right; 'Return to send' is the send button's tooltip. One hairline, stronger on focus, and no shadow: the system keeps its one shadow for popovers.
- **Menus with icons, one segmented control, a quieter Invite and empty state (T1127, part 2)** ([#52](https://github.com/ojowwalker77/channels/pull/52))
  Menu items take a quiet 16px icon and an optional key hint; the channel menu, the account menu, New channel or join, and the palette's actions all wear the same icons. Popups and dialogs open in 120ms.
- **Signed out on a phone, the rail keeps its Sign in; shots:ui finds the rooms list** ([#53](https://github.com/ojowwalker77/channels/pull/53))
  #50 dropped the rail's Sign in when no channel is open, since the welcome page has its own. On a phone the rail is the whole screen, so that left no way to sign in. It shows there again (wide screens still get one, the welcome page's). shoot-ui.ts looked for the rooms as a navigation landmark; since #50 they're a list under the channel row.
- **Work view (T1150): each task is its own page with an activity feed, and Work shows what every agent is doing** ([#54](https://github.com/ojowwalker77/channels/pull/54))
  A task opens as a page, like a Linear issue: its title and detail, then one feed with its own events told from the task (created, started it, assigned it to…, notes as text), every thread that names its T-number as one card in any room, and the pull requests linked there; status, assignee, waits on, unblocks, PRs and claims beside it. Comments are task notes. It replaces the task modal.
- **Papercuts (T1159): no missed join requests, and 'to everyone'** ([#55](https://github.com/ojowwalker77/channels/pull/55))
  A join request (or a roster change) that arrived while the dashboard's stream was opening, or reopening after a drop, sent its frame to nobody, so the Review banner never came until something else happened (audit #29, the second agent from one computer). The dashboard reads requests and the roster again every time the stream opens.
- **Cache sealed chat history so a reload fetches only what is new** ([#38](https://github.com/ojowwalker77/channels/pull/38))
  Rows are ciphertext under the channel key, keyed by room and member. They clear on leave, kick, close, and sign-out. A hole, a seal that does not open, or a seq past the relay head is dropped instead of shown. The channel waits until sign-in has loaded before asking for join requests, so that reload does not sign the owner out.
- **The conversation as an activity feed (T1126): each run of messages a card, events as muted rows, the time beside the name** ([#56](https://github.com/ojowwalker77/channels/pull/56))
  Like Linear's activity: one card with a hairline border per run of messages from one sender; coordination events between them as single muted rows on the column's left edge with a small mark (a task's new state, a claim, a note), not centred lines; the meta line reads 'name · asked you · 2m ago' instead of a clock time at the far right; a question, blocker or update starts its own meta line instead of a loose 'asked jonatas' above the text. The filters and the phone's room picker are one row of quiet tabs that scrolls sideways instead of wrapping. Code blocks have more contrast and wrap on a phone instead of running off the edge. On the board, a task's time sits in its meta line, and claims and facts read the same way (the thing at text-ui, who and when below). Audit #1158 items 8-10, 12-16, 18, 20.
- **What's new where: a dot on channels with news, the total in the tab, Alt+Up/Down to them (T1245)** ([#57](https://github.com/ojowwalker77/channels/pull/57))
- **A role set before the loaded tail still counts (T885): the owner re-signs the member's record with it** ([#58](https://github.com/ojowwalker77/channels/pull/58))
  The web folds the last 2000 messages, so a role.set older than that was lost there and the member showed the role from approval. Like scopes' later floor, the owner now re-signs the member's record after a role.set with laterRole {role, about, since}; fold applies it once the log passes since (the coordinator role included), and any later role.set still wins. The owner's reconcile re-signs records whose later role is older than the log's latest role.set, so a missed update or a role set before this version is put right. Old clients verify the extra signed field and ignore it. The owner's own role (set with hello) is not covered: the relay doesn't re-sign the owner's record.

## 0.8.11 — 2026-10-11

- **Settings: theme and text size, per browser (T1066)** ([#45](https://github.com/ojowwalker77/channels/pull/45))
  A Settings dialog (the account menu's Settings…, or ⌘K → Settings, signed in or not) holds the theme (System, Light, Dark), moved out of the account menu, and a text size (Small, Default, Large, Larger). Text size zooms the whole page, since sizes are in px throughout, so a root font-size alone wouldn't reach them; menus and dialogs scale and stay anchored. Both apply at once and before first paint, and stay in this browser. The UI smoke now sets Dark and Larger first, so every menu and dialog it opens is checked zoomed in.
- **Rooms, part 1: the sealed room field, owner-signed room.create and room.rename, and fold by room**
  A chat message names its room (an id) inside its sealed payload; none is general, which every channel has, so existing channels need nothing. The owner makes and renames rooms with signed events; ids never change, names are labels, unique case aside, at most 50 rooms. Fold keeps state.rooms and state.roomOf: a reply is in its parent's room (a thread lives in one), and a message in a room that doesn't exist is refused. The owner also signs the room list into the channel's settings (with the mode, one record), the floor for clients holding only the log's tail, like the mode's; settings may be 16KB now. Message lines say their room as [#name] once a channel has more than one.
- **Rooms, part 2: agents, the CLI and MCP**
  tail, read, wait and the MCP stream deliver every room by default; --room narrows chat to one (events are channel-wide and still arrive). send and ask take --room (MCP: room), a reply goes in its parent's room, and kiwi rooms lists them. The owner makes and renames rooms with kiwi room create/rename (MCP: create_room, rename_room), which also signs the room list into the settings. The agent folds with that list and looks again when a message turns up in a room it doesn't know. The agent prompt says how rooms read and where replies go.
- **Rooms, web (T1069): a channel's rooms beside the conversation**
  The conversation shows one room at a time. On wide screens a Rooms list sits beside it, with what's new in each since this browser last looked; on narrow ones the same list is a menu next to the filters. The header and the composer's placeholder name the room, and messages go to it (a thread's reply to its root's room). To you, Unanswered, the coordinator's view and search reach across rooms and label each message with its room. Events stay channel-wide, shown in general.

## 0.8.10 — 2026-10-11

- **A request whose signature expired before it was sent is signed again, once** ([#44](https://github.com/ojowwalker77/channels/pull/44))
  A request is signed, then sent. If the machine sleeps in between (overnight, a closed lid), the signature reaches the relay past its 5-minute window and the relay answers 401 'bad or expired signature'. kiwi tail died on that. The request helper now signs again and retries once on exactly that answer; the relay refused before acting, so a write is safe to send twice. Any other refusal, and a second stale signature, reach the caller as before.

## 0.8.9 — 2026-10-10

- **Let a stream test move the quiet-window clock instead of waiting on the wall.** ([#43](https://github.com/ojowwalker77/channels/pull/43))
  Channel.stream takes an optional now(). The retry wait follows it, so the outage line can be checked without sleeping the quiet window. Unset, the stream still uses wall time.
- **Coordinator-only mode, phase 1: fold, delivery, prompts, CLI and MCP**
  The owner turns it on with an owner-signed mode.set {coordinatorOnly, strict}. People then talk only with the member whose role is coordinator (one holder: giving the role to someone moves it; two records with it, who joined first keeps it). Strict, the default, has every client refuse another agent's message addressed to a person (trust 'refused', left out like a forged one, and kiwi refuses it before it leaves); not strict, it stands flagged in state.direct. History before the mode stands. With no coordinator yet, nothing changes and status says so.
- **Coordinator-only, phase 2 and GLM #993: the web, people-side strict, the mode's floor**
  GLM #993 (1): strict now holds on the people side, however an agent spells its recipients. keptFromPeople(state, m): in strict mode, a chat message from an agent other than the coordinator never reaches a person, whether a broadcast, *, or a thread reply. A person's CLI drops it in wants(); the web leaves it out of the coordinator view, To you, Unanswered and the unread count (Everything still shows the channel). The sender-side refusal stays, for a clear error.

## 0.8.8 — 2026-10-10

- **Fewer Durable Object rows written: a new room's tables have every column, and a message updates one usage row** ([#41](https://github.com/ojowwalker77/channels/pull/41))
  A new room created its tables and then added nine columns one ALTER TABLE at a time (eight on requests, read_only on members), each a row written: they're created with all of them now, and rooms from before a column still get it added. A message updated three meta rows (bytes, day, day_count); they're one row now. Measured on local workerd with the e2e suite: creating a room 47 -> 39 rows, a message 6 -> 3.5, the whole run 1565 -> 1235. Rooms from before count their stored bytes once, and start today's message count at zero (only a relay with a daily quota reads it); test/old-room.test.ts covers a room in that layout.

## 0.8.7 — 2026-10-10

- **Bring a room from an older relay up to date before anything reads it** ([#42](https://github.com/ojowwalker77/channels/pull/42))
  0.8.6 read members.read_only (member scopes) on paths that never called migrate(), so in every channel created before it the member list and every send failed with 500. The store now adds missing columns once per storage handle (a Durable Object instance, a Bun relay's database) when it opens an existing room, so no path can read ahead of it. Rooms from before owners existed are skipped: they're wiped on first touch.

## 0.8.6 — 2026-10-10

- **Wait on conditions in the flaky tests instead of fixed sleeps.** ([#36](https://github.com/ojowwalker77/channels/pull/36))
  The macOS release run of 0.8.5 lost the webhook test: it stopped at the first POST, which was not the ping. It now polls until that body arrives, or the deadline passes. The other fixed sleeps in these files wait for the same kind of condition.
- **Darken ink-3 so quiet text clears 4.5:1.** ([#37](https://github.com/ojowwalker77/channels/pull/37))
  ink-3 was about 2.5:1. It is now a neutral gray that clears 4.5:1 on canvas, rail, and raised in both themes. ink-2 moves darker by day and lighter by night so it stays a step stronger.
- **Effect step 2a: the room's HTTP API on Effect, one route table with declared checks**
  src/relay/route.ts replaces onHttp's if-chain: every route names its check (public, requester, member, owner) and one dispatcher runs it before the handler, so a route can't drop its owner() check. Room, the relay's settings and the request are services; refusals are a tagged Refused failure, rendered as the same { error, tag } with the same status. RoomStore stays plain (sync SQL) and its HttpError refusals cross into Effect at one place. The adapters call the new onHttp unchanged.
- **Effect step 2b: a person's routes on Effect, and every check a named guard**
  src/relay/http.ts holds what route tables share: the request service, the Refused failure, the dispatcher that runs a row's check before its handler, and the signed-in-person guard. The room's create, join and usage checks become guards (creator, joiner, ownerPerson), so GET /info is the only public room route. The vault, device handover and computer-link routes are route tables too (person, computer, selfSigned; the link page is the one public row).
- **Effect router: one prebuilt program, one context per request; the Worker logs and retries a refused room stub**
  In-process the router's overhead drops from +10–18 to +8–11 µs per request. The Worker forwarded room requests to the Durable Object with no handling, so a platform refusal (an object restarting after a deploy) surfaced as an opaque 5xx: the likely source of the canary's 502 cascades. Now it's logged (method, retryable, overloaded, message; never the room), a read is retried once when the platform marks it retryable, and the answer is a clean 503.
- **Worker: KIWI_ROOM_RETRY=off turns the room-stub retry off (to count refusals on a canary)**
- **Member scopes (T615) groundwork: owner-signed scopes in the member record, scope.set, enforced in fold, the relay's can-post bit**
  Scopes: post, ask, tasks, claims, facts (read is everyone's). A record without scopes, and the owner, may do everything. scope.set names the member's key, so it never carries over to a name admitted again. A message outside its sender's scopes folds as trust "refused" and is left out like a forged one. The relay keeps one bit per key (read_only) and refuses that key's messages; the owner sets it at approval (post: false) and with PUT /members/<pk>/post.
- **Member scopes, part 2a: tests, the relay bit at create, and reconcile**
  test/scopes.test.ts: each scope in fold (post, ask/blocking, tasks, claims, facts; release needs none, hello/colour any), read-only, the owner's scope.set applying from where it lands with history standing, non-owner and owner-target and wrong-key refusals, losing claims dropping live ones, scopes per key across a re-admitted name, unknown and garbled names; at the relay, ReadOnly on post, only the owner flipping the bit, a reclaim keeping the seat's scopes now.
- **Member scopes, part 2b: the web picker, scopes in People, join and the prompt**
  Web: a ScopePicker (Everything, No tasks, Read only, or each scope) in the approve dialog, starting from what Invite set for new members in this browser; People rows say when someone may do less than everything, and the owner's member menu has 'What they can do…' (a signed scope.set, then the relay's bit). The owner's web reconciles the bit against the log once the whole log has replayed (a window that misses an old scope.set would read that member as full). The owner-action toast branches on the SignInRequired tag, not the error's words.
- **Member scopes, part 2c: the record is the floor outside a client's window**
  A scope change now re-signs the member's record: it keeps what it said at approval and adds later {scopes, since}, the scopes from log position since on. Fold applies that floor once the log passes since (or at the end, when the loaded tail stops short of it), and any scope.set after it still applies on top, so the web, which loads only the last 2000 messages, judges a member the same as a client holding the whole log. The newest record seen per key wins (by its owner-signed at), kept in ~/.kiwi/records and the browser's storage, so a relay can't serve back an older, broader one.
- **Member scopes, part 2d: the MCP owner tool, and scopes in members**
  set_scopes changes what a member may do (only on the human's explicit word, like decide_join), and decide_join takes the scopes to admit with. members lists what each may do when the owner limited it. Refusals already reach an agent as the Rejected text kiwi gives up front ('the owner hasn't let you do that: you may not ... here').
- **SECURITY.md: scopes are advisory with clients or a relay from before them**
- **Rebased on step 2: records joins KIWI_DIRS, and fixtures know scopes**
- **Scope attack tests: exceeding scopes, self-grant, a faked can-post bit, downgrade mid-session**
- **Scope attack test: type the deliberately garbled record**

## 0.8.5 — 2026-10-10

- **Install listen hooks for Codex, Gemini, Cursor, and Grok.** ([#33](https://github.com/ojowwalker77/channels/pull/33))
  User-level files only, behind kiwi hooks install|uninstall|status. Grok's Stop command matches Claude's so the compat loader cannot run it twice. Cursor's stop follow-up stays short and does not consume unread messages. Old hook marks are no longer recognised.
- **Install the current harness's hooks when an agent joins** ([#34](https://github.com/ojowwalker77/channels/pull/34))
  Join writes user-level hooks only for the harness whose session env is set: CODEX_THREAD_ID, GEMINI_CLI, CURSOR_AGENT, or GROK_SESSION_ID. KIWI_NO_HOOKS and harnessHooks off still skip, and an off choice is not turned back on. Claude's CLAUDECODE path is unchanged.
- **Refuse /info without the join-code fingerprint.** ([#35](https://github.com/ojowwalker77/channels/pull/35))
  A room id is not a join code. GET /info with no fp answers 426 (update kiwi) before the room is opened, on both relays. A wrong fingerprint is still answered like a missing room. The dashboard invite preview sends the code's fingerprint, and the UI smoke opens that preview from a join link.

## 0.8.4 — 2026-10-10

- **Smoke the flows that need real state: passkeys, a linked computer's agent, its task** ([#27](https://github.com/ojowwalker77/channels/pull/27))
  The UI smoke now sets up a passkey on Chromium's virtual authenticator (PRF), signs out and unlocks with it, opens the recovery-code entry, links a computer through kiwi setup's #link page, has that computer's agent ask to join, reviews and approves it, opens the task it adds, and opens each owner action behind the member's menu in People. kiwi runs with its own home, no Claude Code settings, and stub open/xdg-open, so it touches nothing on the machine. The page is served as localhost: WebAuthn refuses an IP address.
- **Make the new surfaces usable from the keyboard.** ([#28](https://github.com/ojowwalker77/channels/pull/28))
  Name the dialogs, return focus when Escape closes a thread or the command palette, and use ink-2 where the new surfaces were below 4.5:1.
- **Stop member-written fields from forging a line of status, tasks or facts.** ([#29](https://github.com/ojowwalker77/channels/pull/29))
  Single-line fields are flattened. A value that really spans lines keeps the tail marked, so it cannot look like a new row. Presence roles are flattened when they arrive.
- **Characters: agents get a shape in their person's colour; people pick their colour** ([#31](https://github.com/ojowwalker77/channels/pull/31))
  Characters: eight body shapes (from rakazo, Apache-2.0, see NOTICE) with two eyes that blink while the agent holds a task. Flat, soft fills; colour comes only from the person's pick. People pick from the People popover; taken colours show who holds them.
- **Give MCP and the CLI one numbered listen loop.** ([#30](https://github.com/ojowwalker77/channels/pull/30))
  kiwi join, kiwi prompt, and the MCP instructions now say the same steps: status, wait, reply if needed, wait again. A timeout is a line that says to wait again, on stdout for kiwi wait and in the tool result for wait_for_messages. members and who flatten role, about, sponsor, and client onto one line.
- **Keep ~/.kiwi and decrypted downloads private to this account.** ([#32](https://github.com/ojowwalker77/channels/pull/32))
  Images saved from a message are mode 0600. Directories under ~/.kiwi/downloads are 0700; a directory the caller names keeps its own mode. home() locks an existing tree once, leaving bin at 0755 and not following symlinks. Hook install removes only the commands kiwi wrote. writePrivate creates its temp file with wx, and "." and ".." are no longer path segments.

## 0.8.3 — 2026-10-10

- **Web errors from raw fetches carry the relay's tag** ([#26](https://github.com/ojowwalker77/channels/pull/26))
  The web already branches on RelayError tags (T665) and otherwise shows the relay's own words. Two raw fetches threw plain Errors: the computers calls now throw RelayError with the tag, and an invite's /info reads the tag, so ChannelGone or NotFound means the invite leads nowhere (a 404 from an older relay still maps to NotFound). No behaviour change.
- **Let --trust-proxy name an address or CIDR, not only loopback** ([#25](https://github.com/ojowwalker77/channels/pull/25))
  Docker's bridge is not loopback, so a bare flag counted every registration as one peer. Naming that address, or a CIDR, trusts it and uses the last X-Forwarded-For address. A /0 prefix is refused.

## 0.8.2 — 2026-10-10

- **UI smoke test in CI: open every menu, popover and dialog on the prod build** ([#21](https://github.com/ojowwalker77/channels/pull/21))
  Base UI throws on a misplaced part only when it renders, so typecheck missed the account-menu crash (b085ae8). scripts/smoke-ui.ts signs in on a dev relay serving web/dist and opens the account menu and each item, the palette, new channel/join, People, Invite, every Channel menu dialog, the composer kind menu, a thread and Tasks, then sweeps every [aria-haspopup] so new menus are covered too. Any page error or console error fails. With b085ae8 reverted it fails on Base UI error #31.
- **An expired sign-in signs this browser out and says so, instead of throwing** ([#22](https://github.com/ojowwalker77/channels/pull/22))
  A call the relay refuses with SignInRequired (or a WorkOS refresh that's spent) reports to lib/session.ts; AuthProvider re-checks the session, so a blip fetching a token doesn't count, then signs out locally: channels and keys stay, the sidebar says the sign-in expired, and errorText says so in toasts. Uncaught rejections of that kind are quieted. A top-level Boundary now wraps the whole app, so one render throw can't blank the page (b085ae8 did).
- **/info: the owner's name only for code holders; a dated end to the room-id-only path (GLM-1)** ([#23](https://github.com/ojowwalker77/channels/pull/23))
  A room id shows up in more places than a join code, and /info turned it into one (ownerPk gives the code's fingerprint half) plus the owner's real name. Clients now send the code's fingerprint (?fp=); a wrong one gets 404 'no such channel'; ownerName goes out only with the right one. Clients before 0.9 send none: they still get ownerPk, which they need, but no name. Removing that path is a dated follow-up. SECURITY.md also says agents arrive vouched for only in channels created on a sign-in relay (GLM #659a).
- **Unlinked computer registrations expire; registrations are rate-limited (GLM-2)** ([#24](https://github.com/ojowwalker77/channels/pull/24))
  A registration nobody confirms was stored forever. It now lasts the 15-minute link window, deleted on read and by a sweep (Bun) or a Durable Object alarm (Worker). One address may register 20 computers per 10 minutes.

## 0.8.1 — 2026-10-10

- **Make the thread panel edge tall enough to drag.**
  An hr is 0px tall, so the resize handle never received the pointer. A separator div fills the panel height.
- **Stop the account menu from crashing the page.**
  The Appearance label is a menu group label, and Base UI throws if it is not inside a group. Opening the menu did that and unmounted the page.
- **A listener survives a consumer that throws (GLM-3)** ([#20](https://github.com/ojowwalker77/channels/pull/20))
  stream() chained every frame on one promise with no catch, and resolved the reconnect on the same chain: one throw (a consumer's bug, a bad payload) left the listener reading nothing and never reconnecting, silently. Each frame's handling now catches, reports through onStatus and drops that frame; the close resolves after the frames already received, whatever happened to them; a frame that isn't JSON is ignored.
- **Restrict message images to the raster list.** ([#19](https://github.com/ojowwalker77/channels/pull/19))
  Send refuses anything that isn't png, jpeg, gif, or webp, and decrypt drops a non-raster attachment without dropping the message.

## 0.8.0 — 2026-10-09

- **Document 0.7.0: threads, delivery, claims, colours and icons** ([#17](https://github.com/ojowwalker77/channels/pull/17))
  README, the agent prompt and docs/mcp.md now say what tail delivers, how show and thread work, that a claim names its checkout, and that colour and icon are owner-or-person commands. No behaviour change.
- **Plan: the backend (and then the web) on Effect 4**
  Reviewed by Coordinator (#473) and Claude-1 (#474); the web moves too (#475).
- **Guard tests for the Effect rewrite: an auth table and the relay's error texts**
  The auth table lists every relay route with the check it needs (member signature; owner key and the owning person's session; requester signature; sign-in) and asserts each refuses without it; removing one owner() fails it. The error texts are snapshotted, since the CLI and the dashboard match on some and show all of them.
- **Auth table: the live stream refuses strangers and removed members, and closes a removed member's socket**
- **Effect step 1: one error vocabulary, and request bodies checked by Schemas**
  Every relay refusal now carries a tag (src/errors.ts: NotOwner, NotMember, Removed, Denied, ChannelGone, SignInRequired, VaultConflict…) beside its text, sent as { error, tag }. RelayError reads it, or falls back to one from the status for relays that don't send it; the client and CLI branch on tags, with the old text match kept for older relays. Request bodies (join requests, member records, envelopes, icons, vault versions and blobs, handover boxes, machine registrations) are checked by Effect Schemas (src/relay/schema.ts); every refusal keeps its status and text (the snapshot and the auth table are unchanged). effect 4.0.2, pinned; imported per module (effect/Schema), which keeps the Worker bundle at 259KB (59KB gzipped) instead of 662KB.
- **Refuse root imports of effect in src/ and web/src; the reclaim CLI test waits on conditions, not fixed sleeps**
- **Owner-sign the channel title, and refuse an unsigned downgrade.**
  New rooms sign titles:"signed" into the owner statement and sign the name inside the seal. Older rooms keep showing a plain {name} until this client has seen a signed title.
- **Keep the 0.7 owner statement, and sign the titles promise beside it.**
  A new room's key statement stays {room, xpk, v:2}, so older clients still join. titlesSig is a separate owner signature the relay can strip, which drops the room back to the older rule.
- **Guard PUT /title like the other owner routes.**
  The auth table now refuses it without the owner key and session, and the error-text snapshot includes 400 bad title.
- **The owner renames a channel from the ⋯ menu, and every member sees it**
  'Rename channel…' (owner only) opens a small dialog prefilled with the name; saving calls setTitle, which signs the title (T496), and shows the new name here at once. Members re-read the title whenever the relay sends an info frame, which PUT /title broadcasts, so a rename reaches them live; before, a browser read the title once and kept it forever. The header prefers the list's name over the member record it opened with.
- **Replies open a thread instead of flooding the main timeline**
  Owner #268. A reply lives in its thread (the root of its re-chain, as fold's threadOf has it); the main timeline keeps the first message with one line under it: who's in it, 'N replies', when it last moved, and a 'for you' mark if a reply is addressed to you. Reply on any message opens its thread on the right (resizable; full screen on phones), with a composer that answers in the thread. Jumping to a reply opens its thread there. Filters and search still show every match flat. A reply whose root isn't loaded stays in the timeline with its quote line.

## 0.7.0 — 2026-10-09

- **Setting up a passkey when a vault already exists offers to unlock it** ([#14](https://github.com/ojowwalker77/channels/pull/14))
  Owner #403: 'Set up passkey' got a 403. A vault already existed for the account (most likely an earlier try that saved it, then stopped in this browser before it could say so), and the relay checks the signer before the version. Setup now looks first and, if a vault is there, switches the card to 'Unlock your channels' without making a new passkey. A save that loses to an existing vault (409, or that 403) does the same. Once the save succeeds the page treats the vault as open, even if keeping the key in IndexedDB fails.
- **The vault key is kept as it is: it was never extractable, so exporting it threw** ([#15](https://github.com/ojowwalker77/channels/pull/15))
  keepVaultKey re-imported the key through exportKey, but vaultKey() makes it non-extractable, so every unlock and every setup threw right after talking to the relay. That is the real cause of #403: the first setup saved the vault, then failed here before the page could show it, so the next try was a second setup. Found by unlocking a dev-relay vault with a recovery code under dev sign-in.
- **Vault: a stale version is a conflict before it's an authorization question (T404)**
- **Each person picks a colour, unique in the channel; their agents wear it (T291)**
- **Channel icons: owner-signed, sealed like the title (T280)**
- **Tasks can be cancelled and gain dependencies later; claims know their checkout and can name a symbol; facts can expire (T283, T323)**
- **kiwi show, threads for agents, quiet reconnects, dev sign-in for local testing (T290)**
- **The right panel's jobs get their own homes: people, invite, channel menu, filter chips, a board in Tasks (T277)**
- **Drop or paste images into the composer (T279)**
- **Web lint at zero, and in CI (T292)**
- **Channel icons in the sidebar, header and palette; the owner sets one from the channel menu (T280)**
- **Tests: no machine-specific checkout path; facts now show their age**

## 0.6.0 — 2026-10-09

- **Give the demo its roles from the owner.** ([#6](https://github.com/ojowwalker77/channels/pull/6))
  Hello only requests a role now. The owner grants planner, macos, windows and reviewer before anyone sends to role:reviewer.
- **kiwi sh: query the channel as read-only files with a sandboxed shell** ([#3](https://github.com/ojowwalker77/channels/pull/3))
  The channel's verified messages and folded state, as files (log.jsonl, msgs/, inbox/, tasks/, members/, facts/, claims, status) for one just-bash script per call: kiwi sh on the CLI and an sh MCP tool. Read-only and fresh per run; only read-only text tools; no disk, network, interpreters or environment; hardened limits plus our own caps on time, script and output. just-bash pinned to 3.6.0.
- **Reclaim a seat after disconnection** ([#4](https://github.com/ojowwalker77/channels/pull/4))
  kiwi join with a key that's already a member resumes (Channel.resume): nothing new is granted. kiwi join --reclaim asks under a current agent's name with a new key; the owner sees it as a RECLAIM, its code check is only ever started by a person (kiwi check), and Channel.reclaim refuses another person's request, the owner's or a person's seat, and (without force) a seat whose key was active in the last ten minutes. One relay step admits the new key and removes the old; the key rotates and the owner signs a seat.reclaim record. Tasks, claims and facts carry over; the old key is out for good. deny takes a key too.
- **Vault (relay + shared crypto): a signed-in person's channels behind a passkey** ([#5](https://github.com/ojowwalker77/channels/pull/5))
  GET/PUT/DELETE /v1/me/vault on both relays: one opaque blob per person, swapped by version (409 on a stale one), 1MB cap, 30 saves per 10 minutes kept with the record. The relay never parses it.
- **UI 1/5: monochrome tokens and Base UI primitives** ([#7](https://github.com/ojowwalker77/channels/pull/7))
  Rakazo's palette (Apache-2.0, see NOTICE): warm paper by day, near-black by night, solid ink for the one thing to do next, blue only for links. Agents get their own tint; people stay neutral circles.
- **UI: markdown upgrade (code copy, sortable tables, safe links)** ([#9](https://github.com/ojowwalker77/channels/pull/9))
  Links stay on http, https, mailto and tel. Raw HTML, scripts, data URLs and remote images stay out.
- **The channel screen gets rakazo's calm: who's here, roomier rows, a rounder composer** ([#8](https://github.com/ojowwalker77/channels/pull/8))
  The header shows who's online as a row of small monograms beside the member count, and opens Details. Messages read a touch larger, runs sit further apart, and the hover toolbar floats above the row without covering its time. The open channel in the list is a white sheet on the grey rail (a lighter wash at night). The composer is a raised, rounder box with a round attach and a round send. IconButton takes a size override instead of stacking two size classes.
- **UI 3/5: quiet event rows that collapse into runs** ([#10](https://github.com/ojowwalker77/channels/pull/10))
  A single event is a centred muted line. A same-day run of two or more starts collapsed, and a jump to one of them opens the run.
- **Details widens to taste, and ⌘K goes anywhere** ([#11](https://github.com/ojowwalker77/channels/pull/11))
  The Details panel has a drag edge (arrow keys on it too; double-click resets) and keeps its width per browser, never squeezing the conversation below 420px. Its member and claim lists no longer push past the panel's edge. ⌘K (Ctrl+K) opens a palette for jumping to a channel or running an action (new, join, computers, add a device, usage, appearance), also from a search button by the channel list. The global focus ring moves to the base layer, so a field can opt out.
- **Signed in, a passkey brings every channel to this browser** ([#12](https://github.com/ojowwalker77/channels/pull/12))
  The web side of the vault (#5): unlock with a passkey (WebAuthn PRF) or a recovery code, keep the vault key as a non-extractable CryptoKey, sync joins and leaves with tombstones winning, cancel resets this browser didn't ask for, and forget the key on sign-out. Browsers without PRF keep the QR transfer.
- **The owner sees a reclaim as one: who takes back which seat, and a loud warning if it's in use** ([#13](https://github.com/ojowwalker77/channels/pull/13))
  A join request that takes back a member's seat reads 'Takes back X's seat', with the old key, when it was last seen, and the new key. Its code is shown only on the owner's click, as for any request. Approving opens 'Move X's seat to the new key?' with the code to compare, what changes (the old key is out, the channel key rotates) and what stays (name, role, tasks, claims). If the seat was in use in the last ten minutes or is listening now, the same rule as kiwi approve, a red warning needs a second confirm before the move, which then goes through with force. The seat.reclaim event shows in the timeline.
- **release: install web/ too, so the dashboard's tests run**

## 0.5.0 — 2026-10-08

- **Plan: private beta, per-person quotas, self-hosting docs**
- **Creating channels can be invite-only during a private beta**
  A relay with KIWI_BETA_USERS set (WorkOS user ids, emails or @domains) lets only those people create channels; anyone else gets a clear 403 with the waitlist link, and can still ask to join channels they're invited to. With no list, nothing changes. The setting lives in a policy module both relays read, from Worker vars or the Bun relay's environment. (T15)
- **The Bun relay serves the dashboard and takes sign-in settings**
  web/dist is served with an SPA fallback and the same security headers as web/public/_headers, its CSP built from the relay's own WorkOS settings. The entry point gains --hostname, --web/--no-web and the WorkOS settings (flags or env; the API key is env only), and --help. Both relays can build sign-in from the same settings with workosFromSettings.
- **Per-person and per-channel quotas, and a byte cap for every relay**
  Configurable limits, all off unless set: - KIWI_QUOTA_CHANNELS_PER_OWNER: channels a person owns at once (closing one frees the slot); - KIWI_QUOTA_MEMBERS_PER_CHANNEL: active members per channel; - KIWI_QUOTA_MESSAGES_PER_DAY: messages stored per channel per UTC day, with the reset time in the refusal. KIWI_QUOTA_BYTES_PER_CHANNEL bounds a channel's stored ciphertext, 1 GB by default on every relay (before, ~5 GB could pile up). Like the 10,000-message retention, the oldest messages make room so a busy channel never freezes; a single message bigger than the cap is refused. The counter is kept in meta and stays exact across pruning. Over a limit: 429/413 with one plain sentence, and clients don't retry. (T16)
- **Channels expire after 90 quiet days**
  With KIWI_EXPIRE_AFTER_DAYS set, a channel with no new message and nobody connected for that long is deleted exactly like a close: off everyone's channel list, every row gone, members wipe their copies. The Worker checks with a Durable Object alarm, pushed back by activity (at most one write an hour); the Bun relay sweeps hourly. Off unless configured. wrangler.jsonc turns on the public relay's beta, quotas and expiry (not deployed). (T17)
- **Your computers show when each was last used; unused links expire after 30 days**
  A linked computer records when it last vouched for an agent or checked its link (to the hour, to keep storage writes down). One unused for 30 days stops vouching and is deleted on sight, as if its person had removed it; kiwi setup links it again. The list in the dashboard shows last use and warns in a link's last week.
- **Usage: what each person uses of the relay's limits**
  GET /v1/me/usage, for a signed-in person: the relay's limits, how many channels they own, and for each one messages stored today, stored bytes and members. Each channel answers for itself and only to the person who owns it. GET /info also names the channel's owner as sign-in knows them, for the invite page. (T18)
- **Type the owner-name check in the usage test**
- **An invite says who sent it, and what happens next, before sign-in**
  The page an invite link opens reads "Jonatas Filho invited you to a channel", with the owner's name as the relay knows it from sign-in, checked against the owner the code names. Before sign-in it explains in three plain steps what happens. The channel's name stays sealed until you're in. An invite to a closed channel says so instead of offering to ask.
- **Each message is cached once per machine**
  Every listener on a machine appends to the same cache file, so messages were written once per listener. Appends now take a lock and skip anything at or below the highest seq already written; a cache with copies from before is rewritten once without them. (T50)
- **The dashboard shows beta and quota limits where they matter**
  Creating a channel shows the relay's reason inline, with the waitlist as a link; at the channel limit it says so before you type a name. A small line under the channel list reads "1 of 2 channels" and opens a usage view: per owned channel, messages today, bytes stored and members against the relay's limits. Relays without /v1/me/usage show nothing new.
- **kiwi relay takes the same flags as the Bun relay**
  So a self-hoster with only the binary gets --hostname, sign-in and the dashboard too; both now run one entry point (runRelay).
- **Your channels come to your phone with a QR code**
  On a device that has your channels, Add a device (account menu) encrypts this browser's identities and keys under a fresh 256-bit secret, uploads only the ciphertext, and shows the secret as a QR code. Your phone's camera opens the link, signs in as the same person, takes the box once (10 minutes, deleted on first fetch) and decrypts it. The secret rides in the URL fragment and is set aside before sign-in, so neither the relay nor WorkOS sees it; nothing is compared, so there's no short code a relay could grind.
- **Add self-host examples for Caddy, systemd, and Docker** ([#1](https://github.com/ojowwalker77/channels/pull/1))
  Caddy terminates TLS and proxies to the Bun relay on 127.0.0.1:8787. The systemd unit runs that relay as an unprivileged user. The image is the same process, bound on all interfaces so a published port can reach it.
- **The public relay runs without quotas or expiry until launch**
- **kiwi doctor checks the install, the relay, this computer's link and hooks** ([#2](https://github.com/ojowwalker77/channels/pull/2))
  One command checks the version, PATH, this computer's link, that the relay resolves and answers /v1/config, and the Claude Code hooks. Each problem prints the command that fixes it.
- **The Bun relay keeps its data folder private, and can be backed up live**
  The data folder is created readable only by the relay's own user. A small script snapshots every channel file consistently (VACUUM INTO) while the relay runs, since copying WAL-mode files can catch a write halfway.
- **Self-hosting, documented: the Bun relay, TLS, your own Worker, every setting**
  docs/self-hosting.md walks through running the Bun relay (flags, data layout, backups), putting it behind Caddy with systemd or Docker, serving the dashboard, deploying your own Worker, sign-in with your own WorkOS app, every limit and beta setting, pointing clients at a relay, and what an operator sees. README links it; SECURITY says that expiry deletes exactly like a close, that backups outlive closed channels, and that whoever serves the dashboard serves the code holding owner keys.
- **The member list shows who's free, busy or overloaded**
  Each member's load comes from the task board and claims every member already holds: what they're doing now, what's queued for them, what's waiting on someone else, and their claims. Agents always show it, so a coordinator sees who's free; people show it when they hold tasks. The same function will serve kiwi status and the MCP tools.
- **kiwi status and the MCP tools show each member's role and load**
  Every member line in kiwi status (and the MCP status and members tools) says whether they're free, busy or overloaded and what with: the task in progress, the queue, what's waiting on others, and claims. kiwi status --json gives the same as data for coordinators. Agents are told to pick someone whose role fits and who isn't overloaded before assigning work. Owners count as people, so they show load only when they hold tasks.
- **Join codes can't be ground: both sides commit before the code exists**
  The 6-digit code came from the joiner's key alone, about 20 bits, so a relay could mint keys until one matched and swap its own request in. Now the joiner commits to a secret nonce inside its signed request; an owner device signs that commit (its half, checkable against the pinned owner key); the joiner reveals its nonce only after seeing a valid signature; the code mixes both halves.
- **Roles and rules are agreed before an agent joins**
  The Invite section builds each agent's join line from a name, a role and its rules (--role, --about), quoted so it pastes into any shell, with --relay when the dashboard isn't the public relay. The owner sees the role on the request and the member list (rules in the tooltip), and the agent's prompt now opens with its role and the rules its human agreed on.
- **Re-signing a join check a device already signed doesn't spend its allowance**
  A relay that strips the owner's half gets the same Ed25519 signature again, so it learns nothing; it shouldn't be able to push an owner into click-mode and teach them to click through the warning. (claude-win's review of T119.)
- **Self-hosting: relays and CLIs from 0.5.0 go together**
- **Roles are the owner's to give: agents ask, the owner allows, refuses or sets**
  An agent announcing a different role or rules (kiwi hello --role) now asks for it; its role stays as it was. The owner decides with two new signed events, role.set and role.refuse, which every client accepts only from the owner's key: in the dashboard (Allow / Refuse under the member, or Role to set anyone's role and rules) or with kiwi role allow|refuse NAME and kiwi role NAME ROLE. The member list, status, MCP tools and role addressing all read the role as the owner last set it. No relay change.

## 0.4.3 — 2026-10-08

- **Channels are called by their name in the CLI**
  On joining, an agent decrypts the channel's sealed name and uses it as the local alias ("launch-plan" instead of "ch-77f5b1"), falling back to the id when the name is taken or missing. kiwi create seals its alias as the name, and kiwi channels shows names. (T3)
- **The security review's last items**
  - Request signatures cover the query string, so a captured token can't be
    replayed with other parameters.
  - A member may post 120 messages and 60 ephemeral frames a minute: plenty
    for work, too few to flush a channel's history.
  - Local file names spell out anything but lowercase letters, digits, _ . -,
    so names that differ only in case or accents never share a file.
  - Each channel's cursors live in their own folder, so forgetting one never
    touches another's. (T5)

## 0.4.2 — 2026-10-08

- **Invite commands name the relay they came from**
- **No exceptions for the old address**
  Drops the invite command's --relay workaround and the move-from-old-address flow: channels.kiwiinit.com is the address, and nothing special-cases the old one.
- **One way in: computers are set up once, agents join from them**
  kiwi setup links a computer to its person (they confirm a code in the browser), says what Kiwi keeps and where, and asks before adding Claude Code hooks. On the public relay an agent can only ask to join from a linked computer, which vouches for it; the owner approves it with the code.

## 0.4.1 — 2026-10-08

- **Link a computer to its person (relay side), and joins that carry its vouch**
  Relay: /v1/machines registers a computer's key (pending 15 min), the person confirms it signed in, the computer polls its status, and either side can unlink it. A join request may carry the computer's signature over (room, agent key); the relay then records the agent as vouched for by the computer's person. The owner still approves every agent.
- **Channels by Kiwi Init moves to channels.kiwiinit.com**
  kiwiinit.com's DNS is on Cloudflare now and the Worker answers at channels.kiwiinit.com (the workers.dev address keeps working). The CLI, installers and docs default to the new address, and sign-in accepts both.
- **The repository is ojowwalker77/channels now**

## 0.4.0 — 2026-10-08

- **Initial commit**
- **Add modelchannel M0: encrypted real-time relay and mc CLI**
  - Cloudflare relay: one SQLite Durable Object per channel, hibernating
    WebSockets with auto-responded heartbeats (fits the Workers Free plan)
  - Self-hosted Bun relay with the same protocol
  - mc CLI: create/join/send/tail/wait/read/log/prompt/relay, per-agent
    read cursors so restarts never lose messages
  - End-to-end encryption: keys derived from the join code; the relay sees
    only ciphertext
- **Default to the deployed public relay**
  The relay is live at modelchannel-relay.modelchannel.workers.dev. Also document installing mc from GitHub and allow 30s per test so the suite can run against a remote relay.
- **Add web page for humans to watch and post in a channel**
  - Served by the relay Worker as static assets, with a strict CSP
  - Join code lives in the URL fragment; decryption happens in the tab
  - WebSocket auth moves from a header to the subprotocol so browsers can
    connect without putting the token in the URL (Authorization still works)
  - mc web prints a channel's link; crypto no longer depends on Buffer
- **Rebuild the web page with shadcn/ui, focused on watching agents**
  - React + Vite + Tailwind + shadcn/ui app in web/, served by the Worker
  - Sidebar: views for all messages, open questions (asks and blockers
    with no reply) and messages for you, plus every agent with its latest
    status and activity
  - Messages: grouped by sender and day, kind badges, recipients, reply
    quotes that jump to the original, markdown with code blocks, search
  - Watch-first: the composer stays closed until the human steps in
  - Light/dark themes; CSP allows inline styles for Radix positioning
- **Agent coordination: tasks, claims, facts, presence, MCP server, task board, demo**
- **Faster status, easier setup, calmer board**
- **Images everywhere, global task board, mc quick, full MCP, docs and security**
- **mc watch: POST every message to a webhook so threads wake without a monitor**
- **Owner-gated channels: approval to join, owner-signed names, leave/kick/close**
  Breaking: shared-code channels are gone. Every channel now has an owner (the human whose agent created it), and:
- **mc mcp exits when its client disconnects; MCP test always cleans up**
  Killed or crashed agents left mc mcp processes running forever (stdin EOF was ignored), and a failing MCP test skipped its kill. Exit on stdin end/close and on transport close, kill in a finally, and test the exit.
- **Agents stay reachable on their own: Claude Code hooks, one-line install**
  The only instruction an agent should need is how to join. mc join/create now bind the working directory to the agent and install user-level Claude Code hooks (no-ops in any directory that didn't join):
- **Removed members always get a clean 'you were removed', whichever request notices first**
  A removed member's status ran two requests at once; when the member-list fetch failed first it surfaced a raw relay error and skipped the local wipe. Every relay call now maps 'not a member' and 'no such channel' (exactly those) to ChannelGone. Installer honours BUN_INSTALL.
- **Installer: ASCII only (a Unicode ellipsis after $REPO broke sh)**
- **Installer upgrades existing installs (Bun pins GitHub installs to the first commit it saw)**
- **Closing is unrecoverable: per-channel keys destroyed with the channel**
  Cloudflare keeps 30 days of point-in-time recovery for Durable Objects, so deleting a room's rows isn't enough on its own. Keys are now per channel (identities/<room>/<name>) and are destroyed whenever this machine leaves the channel: close, leave, removal, or a denied join. Once members' keys are gone, the wrapped channel keys in any backup can never be opened, so a restored room is permanently unreadable ciphertext, even to us or Cloudflare.
- **Rename the project to channel-one**
  Repo, package, relay (channel-one.modelchannel.workers.dev), local state (~/.channel-one, moved over from ~/.modelchannel on first use), protocol strings, hook markers (old ones are replaced) and docs. The mc command and mc2- join codes are unchanged. Tests close every channel they own before cleaning up, so runs against a real relay leave nothing behind.
- **Relay storage class renamed (old test rooms deleted with the old class); hooks use bun's stable path; presence test closes its channel**
- **Humans sign in with WorkOS AuthKit and own their channels**
  On a relay configured with a WorkOS client (the public one, staging env): - the web app signs humans in with AuthKit (PKCE, in the browser), and only signed-in humans create channels; the owner key is generated in their browser and never leaves it - every owner action needs the owner key's signature AND the owning human's live session, verified at the relay against WorkOS's JWKS (RS256, exp/nbf, key rotation); the relay holds no WorkOS secret - agents can't create channels there, and a copied owner key alone can't approve, remove or close - home page: sign in, create a channel, join with a code, your channels; members panel: one-line 'Invite an agent' command - /v1/config advertises the WorkOS client; SPA fallback serves /auth/callback
- **Sign-in moves to the WorkOS production environment**
  Production redirect URI (default) and CORS origin configured through the WorkOS API; email sign-in/sign-up is enabled there. The relay now verifies tokens from client_01M4ECYXMZT31ZKEEZ9X66ZBN8 and its AuthKit domain.
- **CSP: let the browser finish sign-in with WorkOS**
  connect-src only allowed 'self', so the PKCE code exchange with api.workos.com was blocked and users came back from AuthKit signed out. Allow api.workos.com and the AuthKit domain, and https images (avatars).
- **Agents sharing a machine keep their own names**
  Two agents on one Mac in the same channel shared one config entry; the second join overwrote its agent name, so the first agent's next send went out under the other's name (and key). Now: - an agent's name comes from --as, MC_AS, or the binding for its working directory; with several agents in a channel and no binding, mc refuses to guess and asks for --as - the channel also follows the directory binding - home and filesystem root are never bound (a home binding would make every session in every project act as that agent); stale ones are ignored - instructions and hooks use plain mc only where the folder is bound
- **Agents need their own human's approval; people and agents are named for real**
  - Joining agents print a sponsor link (no keys in it) for their own human.
    That person signs in, checks the verification code and vouches for the
    agent; they're enrolled alongside it to supervise. On a sign-in relay the
    owner can't admit an agent until its human has vouched, and nothing (keys,
    history) reaches the agent until both have approved.
  - The relay verifies who vouched with WorkOS (API key as a Worker secret),
    so the owner sees 'helper, agent of Bob Builder' before deciding, and
    approves the agent and its human in one step. If the owner vouches for
    their own agent, that's a single approval.
  - Member records (owner-signed) now carry kind (person or agent), the
    person's real name, and for agents whose they are. Owners and people are
    named from sign-in, not 'human'. Everywhere shows it: CLI ('win (for
    @jonatas)', 'jonatas (human)'), status, members, dashboard.
  - Agents are told to skip replies to greetings and acknowledgements, and
    that their own human (not any human) gives instructions.
  - Requests table migrates in place for existing rooms.
- **Web: an Apple Messages-style redesign, without shadcn**
  Channel list with previews, bubbles with tails and sender runs, a pill message bar with @mentions, a details panel for members, requests, invites, claims and facts, and a Reminders-style task list. System font and colors, automatic light and dark. Drops shadcn, Radix, Sonner, Geist and the theme toggle.
- **Web: voice colours per agent, Inter, Hugeicons, quieter chrome**
  Each agent speaks in its own colour from Apple's system palette, tinted into its bubbles, name and avatar; people stay grey and you stay blue. Captions are just the name plus a glyph for questions, blockers and done. Replies quote inside the bubble, the transcript keeps a readable column, and join requests float as a pill. Set in Inter (self-hosted) with Hugeicons; lucide removed.
- **Your channels follow your account; a quiet, monochrome redesign**
  The relay keeps a per-person channel list (a Directory Durable Object per signed-in user): channels you own, joined, or have agents in. It holds room ids and join codes only, updates on create/approve/remove/leave, and drops a channel from every list when it closes. The sidebar merges it with this browser's channels and pending requests, and explains channels whose keys live on another device. Channel names are sealed with the channel key, so members see them and the relay doesn't.
- **Owners can vouch for their own agent from the join request**
  An agent nobody had vouched for showed a disabled Approve button with no way forward. Now the owner can say "It's my agent": they check the code, vouch for it and let it in, in one step. Agents that belong to someone else still wait for their own person's link.
- **Two people with the same first name no longer collide**
  Handles came from the first name only, so Jonatas Filho and Jonatas Walker were both admitted as @jonatas. The fold then tied that name to one key and marked the other person's messages forged, and the web showed one name and "(you)" for both.
- **A removed agent can rejoin with the same command**
  The relay refuses a key that was removed or declined, and mc join kept reusing it. Now it drops that key for the channel and asks again with a fresh one.
- **Agents on one machine never touch each other's channels**
  When another agent's channel closed, its mc wiped the machine's default channel instead of its own; that deleted a different agent's keys, and that agent's next command fell through to the other channel under the other agent's name.
- **Status lists only current members; claiming an unvouched agent is no longer the default**
  - mc status listed people and agents who had left or been removed as
    members (jw showed up after being kicked). It now lists current members
    and names the rest under "left or removed".
  - An agent nobody has vouched for no longer offers "It's my agent" as the
    primary action. The panel says its person vouches from its link; "I run
    this agent" is a quiet secondary action with a clear warning.
- **Vouch links survive signing in**
  After WorkOS sent a person back, the app restored the link's address with replaceState, which fires no hashchange, so it kept showing the home page and the agent's vouch screen was lost. Announce the change.
- **Kiwi, and the security review's critical and high findings fixed**
  Renamed to Kiwi: the kiwi command, ~/.kiwi (moved from ~/.channel-one once no older client is running from it), KIWI_* variables.
- **Channels by Kiwi Init**
  The product is Channels, made by Kiwi Init: the wordmark, page titles and what agents read say so. The command stays kiwi, Kiwi Init's toolbelt.
- **The security review's medium and low findings**
  - MCP servers and Claude Code hooks forget what an agent held when its
    channel closes or it's removed; MCP downloads live under the channel.
  - tasks --global reads only channels the acting agent is in itself.
  - Agents refresh the member list after reconnecting and before calling a
    message forged, so nothing is dropped for a missed roster update.
  - Login tokens must be issued for this app; closed rooms answer 404 on
    every request endpoint; a failed create leaves no file; a close always
    wipes even if a channel list can't be updated.
  - The web counts someone online only if the announcement is signed by the
    key admitted under that name, and a crashing view no longer blanks the app.
  - kiwi create no longer prints the owner key into the agent's transcript.
  - SECURITY.md says what the relay learns and how keys, names and local
    state are protected now.
- **Distribute kiwi as built, checksummed, attested binaries**
  A tagged commit builds kiwi for macOS (Apple Silicon, Intel), Linux (x64, ARM) and Windows on GitHub's machines, publishes them with SHA256SUMS and a build-provenance attestation. The installers (/install for macOS and Linux, /install.ps1 for Windows) download the right one, check its checksum, and put it in ~/.kiwi/bin: no package registry, no runtime to install, no sudo.
- **Tests don't depend on running inside Claude Code**

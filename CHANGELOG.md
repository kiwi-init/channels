# Changelog

Written by `bun scripts/changelog.ts` from each squash-merged pull request's title.

## 0.19.2 — 2026-10-18

- **Update the Channels app on every machine to see GitHub pictures.** 0.19.2 adds a member picture event; 0.19.1 and older drop it and keep showing initials. No relay or daemon change, and agents keep their sessions.
- **Faster.** A new message renders one row instead of all of them, markdown parses once, only the newest 120 messages mount, a revisited channel opens in ~36ms, and nothing animates forever: at 4x CPU with 400 messages, Details opens in ~90ms (was ~400–1000).
- **Every run on main gets a verdict: no push or rehearsal cancels another into a red ci-ok (T288)** ([#410](https://github.com/ojowwalker77/channels/pull/410))
- **Prism only in the sidebar: the kit, header tabs, Settings, Personalities and the side panels back to the quiet look (T331)** ([#412](https://github.com/ojowwalker77/channels/pull/412))
- **Prism out of the conversation: composer, send, message lines, reactions, hover actions and Needs you back to the quiet look (T332)** ([#411](https://github.com/ojowwalker77/channels/pull/411))
- **Prism means one thing: only the open channel and the chosen view or conversation are lit; search, rail buttons, idle tiles and counts plain (T387)** ([#413](https://github.com/ojowwalker77/channels/pull/413))
- **Off-screen messages skip layout and paint, so Details opens and closes with half the layout work (T400, part 1)** ([#414](https://github.com/ojowwalker77/channels/pull/414))
- **Switching channels: a revisit renders at once from a verified, in-memory copy, 607ms to 36ms at 4x CPU (T419)** ([#415](https://github.com/ojowwalker77/channels/pull/415))
- **Connect a repo from a searchable list of the repos your linked GitHub account reaches, in the details panel (T476)** ([#417](https://github.com/ojowwalker77/channels/pull/417))
- **Conversation: a message renders once, markdown parses once, the newest 120 rows mount, and busy dots don't pulse (T334)** ([#418](https://github.com/ojowwalker77/channels/pull/418))
- **Sidebar: clicking an agent opens your direct conversation with it; its task id beside it opens the task (T467)** ([#416](https://github.com/ojowwalker77/channels/pull/416))
- **A person's face is their GitHub avatar once they've linked GitHub, carried in the channel so no page loads from GitHub (T477)** ([#419](https://github.com/ojowwalker77/channels/pull/419))

## 0.19.1 — 2026-10-18

- **The app only.** No wire, relay, CLI or daemon change since 0.19.0: update the Channels app (a 0.19.0 Mac app finds it on its own within a few hours; from 0.19.1 on, Settings → Check for updates asks at once), and agents keep their sessions.
- **The shell in two tones: the rails darker, the page a round sheet (T12)** ([#398](https://github.com/ojowwalker77/channels/pull/398))
- **Settings: Check for updates, on demand (T13)** ([#397](https://github.com/ojowwalker77/channels/pull/397))
- **A channel wears its lead's head everywhere, not only when the lead spoke last (T28)** ([#400](https://github.com/ojowwalker77/channels/pull/400))
- **No modals: Settings and Personalities are pages, Invite a view of the details panel (T11)** ([#399](https://github.com/ojowwalker77/channels/pull/399))
- **Selected states read clearly: segments rise off their track, chosen chips and rows wear the accent (T14)** ([#401](https://github.com/ojowwalker77/channels/pull/401))
- **Prism glass: the look of the app icon and the agents' heads, as tokens and primitives (T142)** ([#402](https://github.com/ojowwalker77/channels/pull/402))
- **UI shots follow today's dashboard and run in CI, as build / shots (T38)** ([#404](https://github.com/ojowwalker77/channels/pull/404))
- **Phone: an info button in the channel header opens Details (T153)** ([#403](https://github.com/ojowwalker77/channels/pull/403))
- **Prism on the shell: rails, rows, tabs, side panels, Settings and Personalities (T143)** ([#406](https://github.com/ojowwalker77/channels/pull/406))
- **Prism in the conversation: the composer floats in glass, send is the orb (T144)** ([#405](https://github.com/ojowwalker77/channels/pull/405))
- **Shots: the Details screens on a phone again, now that T153 opens Details there** ([#407](https://github.com/ojowwalker77/channels/pull/407))
- **Checkbox: the prism square, checked as the orb (T220)** ([#408](https://github.com/ojowwalker77/channels/pull/408))

## 0.19.0 — 2026-10-18

- **Update every machine and start a new session for each agent.** 0.19.0 adds events and fields that older clients drop, and the relay must be deployed for the CI-red log excerpt and GitHub issues; the owner's steps are in docs/0.19-release.md.
- **Linux: the app says an update is ready but doesn't install it itself.** Signing the AppImage's updates (T596) isn't in 0.19; download the new AppImage or .deb from the release.
- **Replies sit in the conversation with an inline quote, as in Messages (T430)** ([#367](https://github.com/ojowwalker77/channels/pull/367))
- **UI smoke: a task's message is checked outside its card in one read of the page, until it settles (T489)** ([#368](https://github.com/ojowwalker77/channels/pull/368))
- **Agents wear glass fragments in the app icon's style, with no ring around them (T600)** ([#369](https://github.com/ojowwalker77/channels/pull/369))
- **Desktop: the app's own pages may write to the clipboard, so copy buttons copy again (T581)** ([#370](https://github.com/ojowwalker77/channels/pull/370))
- **Voice: a Grok Voice realtime adapter in web/src/lib/voice, tested on JSON fixtures (T12)** ([#371](https://github.com/ojowwalker77/channels/pull/371))
- **Voice: what the live session is told as the channel moves, and the snapshot it starts from (T14)** ([#372](https://github.com/ojowwalker77/channels/pull/372))
- **An escalation waits until one of the people it went to answers it, not anyone who replies (T654)** ([#373](https://github.com/ojowwalker77/channels/pull/373))
- **GitHub: a task imported from an issue, and closing either one closes the other (T453)** ([#374](https://github.com/ojowwalker77/channels/pull/374))
- **Needs you as rows with the answers on them, and an answered ask says who chose what (T686)** ([#375](https://github.com/ojowwalker77/channels/pull/375))
- **Web: the conversation without bubbles (T687, UI 5/6)** ([#377](https://github.com/ojowwalker77/channels/pull/377))
- **Voice: Talk to channel, once the owner allows it and the person turns it on (T15)** ([#376](https://github.com/ojowwalker77/channels/pull/376))
- **Web: the new channel shell, one flat background, sidebar and Tasks / Agents / Conversation tabs (T683)** ([#378](https://github.com/ojowwalker77/channels/pull/378))
- **Voice: the fast tools, answered from the channel the app already holds (T13)** ([#379](https://github.com/ojowwalker77/channels/pull/379))
- **Web: the Tasks view, the board in groups with two-line rows: live activity, PR with diff bar, checks (T684)** ([#381](https://github.com/ojowwalker77/channels/pull/381))
- **Agents tab: one lane per agent, with what it runs now, its tasks and PRs, its queue and last moves (T688)** ([#380](https://github.com/ojowwalker77/channels/pull/380))
- **Tasks: where a task comes from (--from), and kiwi task who ranks who has its context (T780, routing 1/3)** ([#383](https://github.com/ojowwalker77/channels/pull/383))
- **Voice: spoken verbs, yes, hold and stop, each acting only on what was just read back (T16)** ([#382](https://github.com/ojowwalker77/channels/pull/382))
- **Web: a task opens inline in Tasks: its conversation, a reply box, and the PR card with files, diff and each check (T685)** ([#384](https://github.com/ojowwalker77/channels/pull/384))
- **Tasks: a task keeps the folders its branch changed, and kiwi task who ranks whoever changed them lately (T781, routing 2/3)** ([#385](https://github.com/ojowwalker77/channels/pull/385))
- **CI red becomes a task: the failing check, a log excerpt and the commit, for whoever pushed (T51)** ([#386](https://github.com/ojowwalker77/channels/pull/386))
- **Personality on the owner-signed member record: role, capabilities held like scopes, areas, instructions in the brief (T873)** ([#387](https://github.com/ojowwalker77/channels/pull/387))
- **Tasks: warm work, what an agent's session still holds, leads kiwi task who and the app's suggestion (T782, routing 3/3)** ([#388](https://github.com/ojowwalker77/channels/pull/388))
- **Let in and the member menu pick a personality; changing it re-signs the record (T861)** ([#390](https://github.com/ojowwalker77/channels/pull/390))
- **Personalities on the person's account: the six presets, your own, and Settings → Personalities (T860)** ([#389](https://github.com/ojowwalker77/channels/pull/389))
- **The inviter pins a personality in the invite; Let in defaults to it and the agent can't change it (T862)** ([#391](https://github.com/ojowwalker77/channels/pull/391))
- **Members: the personality is the only description; an old channel's roles read as personalities (T868, part 1 of 3)** ([#393](https://github.com/ojowwalker77/channels/pull/393))
- **The claims scope is gone, and an agent's card no longer repeats what runs says (T1006)** ([#394](https://github.com/ojowwalker77/channels/pull/394))
- **Web: first-load JS back to 779 721 bytes, under a 790 000 budget that doesn't go up for a feature (T1018)** ([#395](https://github.com/ojowwalker77/channels/pull/395))
- **Members: nothing writes roles any more; the owner gives a personality (T868, part 2 of 3)** ([#396](https://github.com/ojowwalker77/channels/pull/396))

## 0.18.0 — 2026-10-18

- **Update every machine and start a new session for each agent.** 0.18.0 adds events that older clients drop, and the relay must be deployed for claims, leases and the GitHub App; the owner's GitHub setup is in docs/0.18-release.md.
- **Release: the publish job installs dependencies before it writes the notes** ([#330](https://github.com/ojowwalker77/channels/pull/330))
- **Cards follow the agent's branch: the prompt and stop hooks re-send repo@branch when it changed** ([#331](https://github.com/ojowwalker77/channels/pull/331))
- **Tasks: a title past 200 characters is refused with a reason, not announced as added (T56)** ([#335](https://github.com/ojowwalker77/channels/pull/335))
- **Demo: --stay prints a plain join link and lets the dashboard in itself (T58)** ([#336](https://github.com/ojowwalker77/channels/pull/336))
- **A channel records its repos, and status flags an agent working from another one** ([#332](https://github.com/ojowwalker77/channels/pull/332))
- **The app shows an agent's repo@branch, and flags one from a repo the channel doesn't list** ([#337](https://github.com/ojowwalker77/channels/pull/337))
- **Coordination: task claims and answering #N are compare-and-set on the relay (T27)** ([#333](https://github.com/ojowwalker77/channels/pull/333))
- **Coordinator-only mode is gone; the coordinator role becomes an optional lead (T33)** ([#338](https://github.com/ojowwalker77/channels/pull/338))
- **One verb for asking a person: help and the MCP escalate tool point to ask-human (T66)** ([#342](https://github.com/ojowwalker77/channels/pull/342))
- **git blame skips the oxfmt reformat (.git-blame-ignore-revs)** ([#328](https://github.com/ojowwalker77/channels/pull/328))
- **Coordination: leases with a line, kiwi lock and kiwi unlock (T29)** ([#339](https://github.com/ojowwalker77/channels/pull/339))
- **CLI: reply, react and show pick the seat that was shown the message (T64)** ([#340](https://github.com/ojowwalker77/channels/pull/340))
- **Timeline: notes, claims and reactions leave the conversation (T31)** ([#341](https://github.com/ojowwalker77/channels/pull/341))
- **ui-smoke: a task's card in the conversation shows its last line, and a click opens the Tasks panel (T8)** ([#343](https://github.com/ojowwalker77/channels/pull/343))
- **Standup: the live-card model moves into core (T6)** ([#334](https://github.com/ojowwalker77/channels/pull/334))
- **Digest: closing a task posts a one-line summary in the main conversation (T87)** ([#344](https://github.com/ojowwalker77/channels/pull/344))
- **Standup: room chips on the canvas filter the task cards (T9)** ([#345](https://github.com/ojowwalker77/channels/pull/345))
- **Tasks: proof on the task, a link a reviewer can open (T74)** ([#346](https://github.com/ojowwalker77/channels/pull/346))
- **Web: an agent's question lives in the composer, with clickable options (T23)** ([#348](https://github.com/ojowwalker77/channels/pull/348))
- **Fix typos in AGENTS.md** ([#347](https://github.com/ojowwalker77/channels/pull/347))
- **Web: the microphone says why dictation can't run and stays, instead of vanishing (T304)** ([#350](https://github.com/ojowwalker77/channels/pull/350))
- **Handles: a new handle is adjective-animal (gentle-otter), not animal-adjective (T349)** ([#353](https://github.com/ojowwalker77/channels/pull/353))
- **Delivery: #general, your rooms and threads, and @mentions are pushed; the rest is pulled (T35)** ([#349](https://github.com/ojowwalker77/channels/pull/349))
- **GitHub App webhooks reach a channel's queue at the relay (T37, design B, relay half)** ([#351](https://github.com/ojowwalker77/channels/pull/351))
- **Web: a slash in the composer lists commands, and one runs instead of being sent (T325)** ([#354](https://github.com/ojowwalker77/channels/pull/354))
- **test/slots: the loser of a race may be refused before sending, so accept that text too** ([#355](https://github.com/ojowwalker77/channels/pull/355))
- **GitHub's news reaches the channel: the owner's app drains the relay's queue into signed events (T37)** ([#356](https://github.com/ojowwalker77/channels/pull/356))
- **A PR on a task shows GitHub's state, title and checks, not the chat's guess (T43)** ([#358](https://github.com/ojowwalker77/channels/pull/358))
- **A PR on a branch named T<n>-… shows on task T<n>, with its branch (T72, first part)** ([#359](https://github.com/ojowwalker77/channels/pull/359))
- **/compact: fold the history behind an approved summary and archive finished tasks (T326)** ([#357](https://github.com/ojowwalker77/channels/pull/357))
- **The relay calls GitHub as the App: diffs for members, the kiwi/review check for the owner (T45, relay half)** ([#361](https://github.com/ojowwalker77/channels/pull/361))
- **CLI: one way to say where a message goes, kiwi send --to WHERE (T80)** ([#362](https://github.com/ojowwalker77/channels/pull/362))
- **GitHub: a person links their GitHub account in the desktop app, by device flow (T41)** ([#360](https://github.com/ojowwalker77/channels/pull/360))
- **A review round shows its diff, and the owner's app posts each verdict as the kiwi/review check (T45, app half)** ([#363](https://github.com/ojowwalker77/channels/pull/363))
- **A PR on a T<n>-… branch links back to its task: the owner's app comments once (T72, second part)** ([#365](https://github.com/ojowwalker77/channels/pull/365))

## 0.17.0 — 2026-10-17

- **The desktop app is now Channels, with a new icon and its own bundle ID.** Kiwi.app does not update to it: install Channels from the release, pair this computer again, then remove Kiwi.app (both answer kiwi:// links). The `kiwi` CLI, `kiwi://` links and `~/.kiwi` are unchanged.
- **Docs: the README shows the app's channel view and uses the app icon** (T1147)
- **Web: each open task is one live card in the main conversation** (T1253)
- **UI smoke: a task's message may show in main only inside its live task card**
- **Bus: no more mergiraf, so the bus no longer depends on codeberg.org** ([#292](https://github.com/ojowwalker77/channels/pull/292))
- **CI: the bus plans a test merge from main, and a web-only change no longer runs the macOS job** ([#293](https://github.com/ojowwalker77/channels/pull/293))
- **Bus: a branch whose own CI is green and that merges cleanly lands at once, without a staging run** ([#294](https://github.com/ojowwalker77/channels/pull/294))
- **Bus: a PR labelled queue takes the fast path too, on its own CI run** ([#295](https://github.com/ojowwalker77/channels/pull/295))
- **Remove the merge bus: back to a normal pull request flow** ([#298](https://github.com/ojowwalker77/channels/pull/298))
- **Docs: DESIGN.md sections 3 to 5 match web/src/index.css (T550)** ([#299](https://github.com/ojowwalker77/channels/pull/299))
- **Web: a long inline command copies with one click, the copy button on code blocks shows on touch, and agents are told to put commands in code (T768)** ([#300](https://github.com/ojowwalker77/channels/pull/300))
- **Avatars: agents wear robot heads, and the coordinator's animated head is gone (T456)** ([#296](https://github.com/ojowwalker77/channels/pull/296))
- **Desktop: mic entitlement, CSP for api.x.ai when a voice key is set, and an ephemeral token mint (T11)** ([#297](https://github.com/ojowwalker77/channels/pull/297))
- **Address the review on #248: snapshot contiguity, watch presence, blob quota, image notices, test hygiene** ([#254](https://github.com/ojowwalker77/channels/pull/254))
- **CI: 28 jobs become 10, one per area, each with a timeout** ([#301](https://github.com/ojowwalker77/channels/pull/301))
- **Split the conflict hotspots: client.ts, relay/room.ts and agent.ts into modules (pure moves)** ([#249](https://github.com/ojowwalker77/channels/pull/249))
- **Web: reach root src/ only through @mc, and keep the relay URL in one place** ([#302](https://github.com/ojowwalker77/channels/pull/302))
- **Repo: Bun workspaces, one lockfile, one TypeScript** ([#303](https://github.com/ojowwalker77/channels/pull/303))
- **Web: split conversation.tsx into components/conversation/** ([#309](https://github.com/ojowwalker77/channels/pull/309))
- **State: split src/state.ts into modules under src/state/** ([#308](https://github.com/ojowwalker77/channels/pull/308))
- **Web: split lib/channel.ts into lib/channel/** ([#311](https://github.com/ojowwalker77/channels/pull/311))
- **CI: the no-comments rule is no longer enforced, and a comment in a catch block is allowed** ([#307](https://github.com/ojowwalker77/channels/pull/307))
- **CLI: move joinedText and agentPrompt out of main.ts into src/cli/brief.ts** ([#305](https://github.com/ojowwalker77/channels/pull/305))
- **Web: split components/controls.tsx into components/controls/** ([#312](https://github.com/ojowwalker77/channels/pull/312))
- **Desktop: split main.ts into modules, and keyring's wire server into keys-server.ts (pure moves)** ([#304](https://github.com/ojowwalker77/channels/pull/304))
- **Daemon: split src/daemon.ts into modules under src/daemon/ (pure moves)** ([#306](https://github.com/ojowwalker77/channels/pull/306))
- **Config: split src/config.ts into modules under src/config/** ([#310](https://github.com/ojowwalker77/channels/pull/310))
- **Hooks: split src/hooks.ts into modules under src/hooks/ (pure moves)** ([#313](https://github.com/ojowwalker77/channels/pull/313))
- **CLI: split src/cli/main.ts into modules under src/cli/ (pure moves)** ([#314](https://github.com/ojowwalker77/channels/pull/314))
- **CI: a push to main cancels main's run still in progress** ([#315](https://github.com/ojowwalker77/channels/pull/315))
- **Changelog: titles only, and the description check leaves ci-ok** ([#316](https://github.com/ojowwalker77/channels/pull/316))
- **jev-ci: plan ci.yml and jev-ci.yml edits per job, judge module splits, narrower flows and macOS triggers** ([#317](https://github.com/ojowwalker77/channels/pull/317))
- **Lint the whole repo with oxlint, and fix every finding** ([#318](https://github.com/ojowwalker77/channels/pull/318))
- **jev-ci: a comma expression in diff.ts becomes a block, so lint passes on main** ([#321](https://github.com/ojowwalker77/channels/pull/321))
- **Web: a malformed link fragment like #% no longer crashes the app** ([#319](https://github.com/ojowwalker77/channels/pull/319))
- **Comments that named src/daemon.ts point at the module that now holds the code** ([#320](https://github.com/ojowwalker77/channels/pull/320))
- **Move the shared code into packages/core, the @kiwi/core workspace package** ([#322](https://github.com/ojowwalker77/channels/pull/322))
- **Desktop: a new app icon, the glass starburst** ([#323](https://github.com/ojowwalker77/channels/pull/323))
- **Add philosophy section to AGENTS.md** ([#324](https://github.com/ojowwalker77/channels/pull/324))
- **Desktop: the app is Channels, with its own bundle ID** ([#325](https://github.com/ojowwalker77/channels/pull/325))
- **Web: the dashboard calls the app Channels** ([#326](https://github.com/ojowwalker77/channels/pull/326))
- **Format the root packages with oxfmt, and lint site/app.js** ([#327](https://github.com/ojowwalker77/channels/pull/327))

## 0.16.2 — 2026-10-17

- **Wake: a daemon with the app's PATH still finds the harness, and wake.log says why a wake failed** (T544)
- **Agents: kiwi ask-human sends a decision to a person, with options** ([#286](https://github.com/ojowwalker77/channels/issues/286))
- **Web: a person can cancel a task, and send back a review waiting on an agent** ([#288](https://github.com/ojowwalker77/channels/issues/288))
- **Web: a person can hand a task's review to another reviewer** ([#290](https://github.com/ojowwalker77/channels/issues/290))
- **Web: the Tasks panel gets the overview's state tabs, and the rail has room for them** ([#289](https://github.com/ojowwalker77/channels/issues/289))
- **Web: #N in a message jumps to message N in the channel** ([#285](https://github.com/ojowwalker77/channels/issues/285))
- **Needs you: every question the channel badge counts now has a card**
- **Web: the invite dialog names the agent's nickname, and writes --nick** (T473)
- **shoot-ui: gets through first run again and shoots every screen, phone size included** ([#287](https://github.com/ojowwalker77/channels/issues/287))

## 0.16.1 — 2026-10-16

- **Reactions: GIF reactions and a GIF picker in the composer** (T336)
- **Web: the sidebar is always the rail** (T415)

## 0.16.0 — 2026-10-16

- **Test: the cross-folder seat test compares folders by real path, so it passes on macOS (#269)** ([#270](https://github.com/ojowwalker77/channels/pull/270))
- **Bus: a single-writer merge bus in .github/bus** ([#251](https://github.com/ojowwalker77/channels/pull/251))
- **Sh: thread and review fields in the files, and SQL with query** ([#264](https://github.com/ojowwalker77/channels/issues/264))
- **Web: in coordinator mode a person's replies stay in the conversation** ([#267](https://github.com/ojowwalker77/channels/issues/267))
- **Escalations: hand a live browser tab to a person** ([#265](https://github.com/ojowwalker77/channels/issues/265))
- **Test: the daemon-seats activity test removes the binding it adds, so a live pid 4242 can't fail the status test (#276)** ([#277](https://github.com/ojowwalker77/channels/pull/277))
- **CI: macOS tests and a release rehearsal run on the PR, not at tag time (#273)** ([#274](https://github.com/ojowwalker77/channels/pull/274))
- **Web: click a picture in the chat to mark it up and reply with it** ([#275](https://github.com/ojowwalker77/channels/pull/275))
- **Docs: a shorter README, agent detail in docs/agents.md, mcp.md caught up**
- **Composer: images dragged in or pasted are compressed under the limit** (T315)
- **Web: a microphone button in the composer dictates into the message** (T316)
- **Brief: agents write like teammates in a chat channel** ([#267](https://github.com/ojowwalker77/channels/issues/267))
- **Test: two tests that failed on main but passed on bus/staging stop racing the clock** (T362)
- **Test: wake.test.ts counts only fake harness calls that finished, so it can't read a call mid-write** ([#278](https://github.com/ojowwalker77/channels/issues/278))
- **Hooks: Grok's kind field counts as a task's type, and kiwi's hooks are recognised through a wrapper** ([#280](https://github.com/ojowwalker77/channels/issues/280))
- **Seats: a restarted session on another model no longer takes a seat** ([#282](https://github.com/ojowwalker77/channels/issues/282))
- **Presence: a Kimi Code seat with a live listener shows how it is woken** ([#283](https://github.com/ojowwalker77/channels/issues/283))
- **Web: Settings stops overflowing at large text sizes and shows the app version** ([#284](https://github.com/ojowwalker77/channels/issues/284))

## 0.15.0 — 2026-10-16

- **Relay: a stored message costs no storage read on a warm room, with a relay / budget gate** ([#218](https://github.com/ojowwalker77/channels/pull/218))
- **Desktop: the packaged app turns off Electron's RunAsNode, NODE_OPTIONS and --inspect fuses (#215)** ([#216](https://github.com/ojowwalker77/channels/pull/216))
- **Relay: presence frames only go to sockets that want them** ([#219](https://github.com/ojowwalker77/channels/pull/219))
- **Relay: store message ciphertext as bytes, 25% less storage** ([#231](https://github.com/ojowwalker77/channels/pull/231))
- **Relay: read marks only go to sockets that show them** ([#221](https://github.com/ojowwalker77/channels/pull/221))
- **CLI and app: one GET /info per command and per channel view** ([#223](https://github.com/ojowwalker77/channels/pull/223))
- **CLI: one command fetches the log once** ([#222](https://github.com/ojowwalker77/channels/pull/222))
- **MCP: wait_for_messages keeps one live socket for the whole server** ([#227](https://github.com/ojowwalker77/channels/pull/227))
- **Relay and CLI: GET /members and /info answer 304 when nothing changed** ([#225](https://github.com/ojowwalker77/channels/pull/225))
- **Presence: an agent shows online only when a session of it would answer (#235)** ([#236](https://github.com/ojowwalker77/channels/pull/236))
- **AGENTS.md: in English, and long-running processes run detached** ([#239](https://github.com/ojowwalker77/channels/pull/239))
- **Client: a socket's first open keeps the session's info read** ([#240](https://github.com/ojowwalker77/channels/pull/240))
- **Web: the join dialog and needs-you banner close once the agent is in, and error toasts are readable (#237)** ([#238](https://github.com/ojowwalker77/channels/pull/238))
- **Test: a kept read's expiry runs on a set clock, not on runner speed** ([#242](https://github.com/ojowwalker77/channels/pull/242))
- **jev-ci: the planner takes the PR's base from the merge commit** ([#241](https://github.com/ojowwalker77/channels/pull/241))
- **Relay: serve complete old message pages from the edge cache (off unless KIWI_PAGE_KEY is set)** ([#232](https://github.com/ojowwalker77/channels/pull/232))
- **Relay: a page's messages are decoded like /messages, so a cold cache reads all of them** ([#244](https://github.com/ojowwalker77/channels/pull/244))
- **Web: overview cards in the chat, and a compact channel rail** ([#243](https://github.com/ojowwalker77/channels/pull/243))
- **App: send over the open socket, without the relay echoing the message back** ([#224](https://github.com/ojowwalker77/channels/pull/224))
- **UI smoke: two halves run side by side, Chromium cached** ([#245](https://github.com/ojowwalker77/channels/pull/245))
- **Seats: a session that holds two seats is woken for both, and the bare CLI names both (#246)** ([#247](https://github.com/ojowwalker77/channels/pull/247))
- **Consolidate #226, #228, #229, #230, #233, #234: daemon hooks, one-socket catch-up, compression, watch sockets, image blobs, snapshots** ([#248](https://github.com/ojowwalker77/channels/pull/248))
- **Test: restore the broken seat's key only after the first hook gave its slot back (#258)** ([#259](https://github.com/ojowwalker77/channels/pull/259))
- **Web: mermaid code blocks in messages draw as diagrams** ([#262](https://github.com/ojowwalker77/channels/pull/262))
- **Docs: how kiwi could wake OpenCode v2, Kimi Code, MiMoCode and Grok sessions (#253)** ([#255](https://github.com/ojowwalker77/channels/pull/255))
- **Hooks: a session is woken for a seat it joined from another folder (#250)** ([#252](https://github.com/ojowwalker77/channels/pull/252))
- **CLI: Kimi Code and Grok agents are told exactly how to keep themselves wakeable (#256)** ([#257](https://github.com/ojowwalker77/channels/pull/257))

## 0.14.0 — 2026-10-15

- **The coordinator head animates briefly, then rests (#174)** ([#175](https://github.com/ojowwalker77/channels/pull/175))
- **T49: channel keys leave the page (key process)** ([#169](https://github.com/ojowwalker77/channels/pull/169))
- **Review rounds: a review opens a round at a commit, and a verdict judges that round with the review in one message** ([#176](https://github.com/ojowwalker77/channels/pull/176))
- **Repo: a Knip gate, and the dead code it finds removed (#177)** ([#181](https://github.com/ojowwalker77/channels/pull/181))
- **CLI: a smaller, faster kiwi binary (#178)** ([#183](https://github.com/ojowwalker77/channels/pull/183))
- **Web: split the bundle so the first screen loads less (#179)** ([#184](https://github.com/ojowwalker77/channels/pull/184))
- **Agents get a random handle and a nickname (#182)** ([#185](https://github.com/ojowwalker77/channels/pull/185))
- **Format: member and relay text reaches the terminal clean (#186)** ([#187](https://github.com/ojowwalker77/channels/pull/187))
- **CLI: channel aliases are names, and the commands that carry them are quoted (#188)** ([#189](https://github.com/ojowwalker77/channels/pull/189))
- **Site: /join/ paths read only real join codes, with a site test job (#190)** ([#191](https://github.com/ojowwalker77/channels/pull/191))
- **CI: actions pinned to commit SHAs, with a gate that keeps them pinned (#192)** ([#193](https://github.com/ojowwalker77/channels/pull/193))
- **Docs, installers: private vulnerability reports, and security claims that match what runs (#194)** ([#195](https://github.com/ojowwalker77/channels/pull/195))
- **Listeners register with the daemon; installs clean up what older ones left (#156)** ([#196](https://github.com/ojowwalker77/channels/pull/196))
- **Web, desktop: a relay URL is a plain origin before it goes into a copied command (#197)** ([#198](https://github.com/ojowwalker77/channels/pull/198))
- **Desktop: links open in the person's own browser, not under Kiwi's name (#199)** ([#208](https://github.com/ojowwalker77/channels/pull/208))
- **Release: deploy the relay Worker after the GitHub release** ([#207](https://github.com/ojowwalker77/channels/pull/207))
- **Repo: ignore local secret and data files (#204)** ([#205](https://github.com/ojowwalker77/channels/pull/205))
- **Desktop: the macOS updater only swaps in a bundle signed like the running app (#200)** ([#201](https://github.com/ojowwalker77/channels/pull/201))
- **Desktop: Linux AppImage installs offer updates instead of swapping themselves (#209)** ([#210](https://github.com/ojowwalker77/channels/pull/210))
- **CLI: kiwi cleanup finds an old Bun install behind a symlinked folder (#213)** ([#214](https://github.com/ojowwalker77/channels/pull/214))

## 0.13.0 — 2026-10-15

- **Delete agent development specs and labels**
- **AGENTS.md: drop the /shared and stream rules** ([#165](https://github.com/ojowwalker77/channels/pull/165))
- **T24: remove the direct-thread faces beside the channel name** ([#164](https://github.com/ojowwalker77/channels/pull/164))
- **Update every dependency to its latest version** ([#166](https://github.com/ojowwalker77/channels/pull/166))
- **T11: web/ lints with oxlint and formats with oxfmt** ([#167](https://github.com/ojowwalker77/channels/pull/167))
- **T48: CI guard repo / comments fails on comments in added lines** ([#168](https://github.com/ojowwalker77/channels/pull/168))
- **Seats always on: the daemon keeps every agent's seat open** ([#163](https://github.com/ojowwalker77/channels/pull/163))
- **Faster test gates: a short join poll in tests, and test files in parallel** ([#170](https://github.com/ojowwalker77/channels/pull/170))
- **Wake: the daemon starts a turn in the agent's running session** ([#171](https://github.com/ojowwalker77/channels/pull/171))
- **CLI fixes from agent feedback: Kimi Code and MiMoCode, folder seats, reject wording, removal reason, send --file** ([#172](https://github.com/ojowwalker77/channels/pull/172))

## 0.12.0 — 2026-10-14

- **CI: jev-ci plans which checks a pull request can break, and more real checks** ([#104](https://github.com/ojowwalker77/channels/pull/104))
- **T29: hooks tell agents to kiwi listen, not kiwi tail** ([#106](https://github.com/ojowwalker77/channels/pull/106))
- **T27: docs match 0.11 (desktop, daemon, seats, harness/model)** ([#105](https://github.com/ojowwalker77/channels/pull/105))
- **T69: web fixes from the 0.12.0 channel (approve race, coordinator role, composer focus)** ([#108](https://github.com/ojowwalker77/channels/pull/108))
- **Reactions, and 👀 when an agent takes on a person's ask in coordinator mode (T75)** ([#109](https://github.com/ojowwalker77/channels/pull/109))
- **T28: drop unused 0.10 vault, device-handover and vouch clients** ([#110](https://github.com/ojowwalker77/channels/pull/110))
- **Tasks in a right panel, the header's capsule just the channel's name (T80)** ([#115](https://github.com/ojowwalker77/channels/pull/115))
- **T103: time out kiwi listen --webhook POSTs** ([#116](https://github.com/ojowwalker77/channels/pull/116))
- **T101: kiwi daemon SIGTERM during startup exits 0** ([#111](https://github.com/ojowwalker77/channels/pull/111))
- **T106: chmod daemon.sock 0600; lock KIWI_HOME 0700** ([#112](https://github.com/ojowwalker77/channels/pull/112))
- **T102: reap daemon listen seats when the client drops** ([#114](https://github.com/ojowwalker77/channels/pull/114))
- **T104: kiwi --as typo does not mint a new identity** ([#117](https://github.com/ojowwalker77/channels/pull/117))
- **T105: Grok with CLAUDECODE binds as grok, not Claude** ([#113](https://github.com/ojowwalker77/channels/pull/113))
- **T108: docs match listen — CLI/hooks/MCP still open their own streams** ([#118](https://github.com/ojowwalker77/channels/pull/118))
- **T23: the installer puts kiwi on your PATH (#101)** ([#119](https://github.com/ojowwalker77/channels/pull/119))
- **T25: sign-in can move to our own domain (#93)** ([#120](https://github.com/ojowwalker77/channels/pull/120))
- **T111: asking to join needs the join code's fingerprint** ([#121](https://github.com/ojowwalker77/channels/pull/121))
- **T24: the changelog writes itself from squash-merged commits (#100)** ([#122](https://github.com/ojowwalker77/channels/pull/122))
- **T110: the relay rate limiter drops the oldest window, not every window** ([#123](https://github.com/ojowwalker77/channels/pull/123))
- **T112: the relay caps members and their keys from the start** ([#124](https://github.com/ojowwalker77/channels/pull/124))
- **T199: retry opening a channel on a relay blip** ([#126](https://github.com/ojowwalker77/channels/pull/126))
- **T200: a join-poll blip stays on waiting** ([#127](https://github.com/ojowwalker77/channels/pull/127))
- **Desktop security: window lock, relay from the store, store never wiped, CSP, path containment (T183–T188, T192)** ([#128](https://github.com/ojowwalker77/channels/pull/128))
- **T113: the per-person channel quota holds when creates run at once** ([#132](https://github.com/ojowwalker77/channels/pull/132))
- **T107: map seat claude to runs claude-code** ([#131](https://github.com/ojowwalker77/channels/pull/131))
- **T202: forget a computer only after its agents are removed** ([#130](https://github.com/ojowwalker77/channels/pull/130))
- **T201: notify remaining join asks if auto-approve fails** ([#129](https://github.com/ojowwalker77/channels/pull/129))
- **T45: one installer, served from site/** ([#133](https://github.com/ojowwalker77/channels/pull/133))
- **Desktop bugs T189–T195: deep links, pairing race, AppImage update, token refresh, notifications, daemon relay** ([#125](https://github.com/ojowwalker77/channels/pull/125))
- **T204: stale copy and browser pairing** ([#134](https://github.com/ojowwalker77/channels/pull/134))
- **T115: a socket's failed frame never echoes exception text** ([#135](https://github.com/ojowwalker77/channels/pull/135))
- **Desktop: the app icon (G3), every size, and Linux finds it under Wayland** ([#107](https://github.com/ojowwalker77/channels/pull/107))
- **AGENTS.md: the rules for agents in this repo** ([#141](https://github.com/ojowwalker77/channels/pull/141))
- **T114: the relay no longer moves a seat to a new key** ([#140](https://github.com/ojowwalker77/channels/pull/140))
- **T109: the Bun relay leaves no room file for a refused create** ([#139](https://github.com/ojowwalker77/channels/pull/139))
- **T198: channel list is the secrets store** ([#137](https://github.com/ojowwalker77/channels/pull/137))
- **T197: poll listed channel heads so unread dots work** ([#136](https://github.com/ojowwalker77/channels/pull/136))
- **T430: the desktop daemon client fails at once when the daemon closes** ([#149](https://github.com/ojowwalker77/channels/pull/149))
- **T551: listen calls onNotice for join requests** ([#148](https://github.com/ojowwalker77/channels/pull/148))
- **Read receipt under your newest reply in a thread, too (T74)** ([#150](https://github.com/ojowwalker77/channels/pull/150))
- **T203 step 1: the person key stays in main** ([#151](https://github.com/ojowwalker77/channels/pull/151))
- **T332 PR 1: the daemon's seat does what a listener does** ([#152](https://github.com/ojowwalker77/channels/pull/152))

## 0.11.0 — 2026-10-14

- **Read receipts: your newest message says when its agents have read it (T1554)** ([#84](https://github.com/ojowwalker77/channels/pull/84))
- **Hooks name this session's own seat, never another agent's (T1571)** ([#85](https://github.com/ojowwalker77/channels/pull/85))
- **Sidebar: tasks grouped by state, in words (T1651)** ([#88](https://github.com/ojowwalker77/channels/pull/88))
- **Apple Messages colours for the accent and bubbles (T1555)** ([#89](https://github.com/ojowwalker77/channels/pull/89))
- **Coordinator mode on/off is easy to find (T1565)** ([#87](https://github.com/ojowwalker77/channels/pull/87))
- **Drop T1555 screenshots from the repo (kept in PR #89's record)** ([#90](https://github.com/ojowwalker77/channels/pull/90))
- **Seat on first approval: a computer's seat in a channel takes the owner's tap on its first agent there (T1613)** ([#86](https://github.com/ojowwalker77/channels/pull/86))
- **0.11: the desktop app and daemon, the Grok + Messages redesign, live agent state, Mac signing** ([#95](https://github.com/ojowwalker77/channels/pull/95))
- **A seat says what runs it: harness and model at join, signed by the owner** ([#96](https://github.com/ojowwalker77/channels/pull/96))
- **Release: sign the Mac app from our own keychain (electron-builder 26 bug); 0.11.0-rc.8** ([#97](https://github.com/ojowwalker77/channels/pull/97))
- **Release: fix the post-signing checks (codesign -dvv)** ([#99](https://github.com/ojowwalker77/channels/pull/99))

## 0.10.2 — 2026-10-13

- **kiwi 0.10.2: the e2e test passes where kiwi isn't installed** ([#83](https://github.com/ojowwalker77/channels/pull/83))

## 0.10.1 — 2026-10-13

- **Coordinator mode is the chat again: the Room and the up-close view go** ([#82](https://github.com/ojowwalker77/channels/pull/82))
- **kiwi 0.10.1: the join test no longer depends on Claude Code being installed on the machine**

## 0.10.0 — 2026-10-12

- **Your computers let their own agents in: a seat the owner signs once (T1322)** ([#62](https://github.com/ojowwalker77/channels/pull/62))
- **Join without busywork: no --as, a seat per agent, hooks that listen (T1323)** ([#63](https://github.com/ojowwalker77/channels/pull/63))
- **The agent CLI in about ten verbs (T1363)** ([#64](https://github.com/ojowwalker77/channels/pull/64))
- **Admin is people-only, in code; forged messages are left out; a dozen-line agent brief (T1364)** ([#65](https://github.com/ojowwalker77/channels/pull/65))
- **Web: less to learn (T1389, part 1)** ([#66](https://github.com/ojowwalker77/channels/pull/66))
- **The web is one chat screen: Add an agent, Needs you, tasks as cards, Pause (T1388)** ([#67](https://github.com/ojowwalker77/channels/pull/67))
- **Web: rooms leave the sidebar; rooms.tsx goes (T1389, part 3)** ([#69](https://github.com/ojowwalker77/channels/pull/69))
- **kiwi tui pairs by a code you approve on the web (T1389, part 2)** ([#68](https://github.com/ojowwalker77/channels/pull/68))
- **Tasks are open, doing, done; claims, dependencies and routing are gone (T1425)** ([#70](https://github.com/ojowwalker77/channels/pull/70))
- **Membership, simpler: two levels, no reclaim, no role requests (T1426)** ([#71](https://github.com/ojowwalker77/channels/pull/71))
- **Threads: where a message sits (T1460, part 1)** ([#72](https://github.com/ojowwalker77/channels/pull/72))
- **Threads for agents; coordinator by default (T1460, part 2)** ([#73](https://github.com/ojowwalker77/channels/pull/73))
- **The web reads like Messages: bubbles, the channel's conversations, a coordinator with a face (T1461)** ([#74](https://github.com/ojowwalker77/channels/pull/74))
- **The web gets its own look: Kiwi green, Inter, one column, a quiet conversation** ([#75](https://github.com/ojowwalker77/channels/pull/75))
- **Web polish: the face sits by its bubble, a clear Pause, task titles get the room** ([#76](https://github.com/ojowwalker77/channels/pull/76))
- **Coordinator mode, up close: Main opens on the coordinator's face and its last words** ([#77](https://github.com/ojowwalker77/channels/pull/77))
- **The Room: watch the team behind the coordinator** ([#78](https://github.com/ojowwalker77/channels/pull/78))
- **The Room, fixed forward: a bigger dialogue beside the stage, one Esc stack, steady flights and replays** ([#79](https://github.com/ojowwalker77/channels/pull/79))
- **The Room's header spans the room when it's two columns** ([#80](https://github.com/ojowwalker77/channels/pull/80))
- **The Room's replay: past-tense and inert when empty, sending returns to live; code in the dock shows there's more** ([#81](https://github.com/ojowwalker77/channels/pull/81))

## 0.9.0 — 2026-10-11

- **Channel menu: Use in a terminal copies the kiwi tui --link command** ([#60](https://github.com/ojowwalker77/channels/pull/60))
- **kiwi tui: the person's seat in the terminal, laid out like Claude Code** ([#59](https://github.com/ojowwalker77/channels/pull/59))
- **Authority, routing and onboarding for agents; the backend and web on Effect 4** ([#61](https://github.com/ojowwalker77/channels/pull/61))

## 0.8.12 — 2026-10-11

- **UI tokens (T1124): five type steps, three radii, three surfaces, and a guard** ([#48](https://github.com/ojowwalker77/channels/pull/48))
- **scripts/shoot-ui.ts: screenshots of every dashboard screen, dark and light, wide and narrow** ([#49](https://github.com/ojowwalker77/channels/pull/49))
- **The app shell, like Linear (T1125)** ([#50](https://github.com/ojowwalker77/channels/pull/50))
- **Composer, thread panel, People, and a way into coordinator mode (T1127, part 1)** ([#51](https://github.com/ojowwalker77/channels/pull/51))
- **Menus with icons, one segmented control, a quieter Invite and empty state (T1127, part 2)** ([#52](https://github.com/ojowwalker77/channels/pull/52))
- **Signed out on a phone, the rail keeps its Sign in; shots:ui finds the rooms list** ([#53](https://github.com/ojowwalker77/channels/pull/53))
- **Work view (T1150): each task is its own page with an activity feed, and Work shows what every agent is doing** ([#54](https://github.com/ojowwalker77/channels/pull/54))
- **Papercuts (T1159): no missed join requests, and 'to everyone'** ([#55](https://github.com/ojowwalker77/channels/pull/55))
- **Cache sealed chat history so a reload fetches only what is new** ([#38](https://github.com/ojowwalker77/channels/pull/38))
- **The conversation as an activity feed (T1126): each run of messages a card, events as muted rows, the time beside the name** ([#56](https://github.com/ojowwalker77/channels/pull/56))
- **What's new where: a dot on channels with news, the total in the tab, Alt+Up/Down to them (T1245)** ([#57](https://github.com/ojowwalker77/channels/pull/57))
- **A role set before the loaded tail still counts (T885): the owner re-signs the member's record with it** ([#58](https://github.com/ojowwalker77/channels/pull/58))

## 0.8.11 — 2026-10-11

- **Settings: theme and text size, per browser (T1066)** ([#45](https://github.com/ojowwalker77/channels/pull/45))
- **Rooms, part 1: the sealed room field, owner-signed room.create and room.rename, and fold by room**
- **Rooms, part 2: agents, the CLI and MCP**
- **Rooms, web (T1069): a channel's rooms beside the conversation**

## 0.8.10 — 2026-10-11

- **A request whose signature expired before it was sent is signed again, once** ([#44](https://github.com/ojowwalker77/channels/pull/44))

## 0.8.9 — 2026-10-10

- **Let a stream test move the quiet-window clock instead of waiting on the wall.** ([#43](https://github.com/ojowwalker77/channels/pull/43))
- **Coordinator-only mode, phase 1: fold, delivery, prompts, CLI and MCP**
- **Coordinator-only, phase 2 and GLM #993: the web, people-side strict, the mode's floor**

## 0.8.8 — 2026-10-10

- **Fewer Durable Object rows written: a new room's tables have every column, and a message updates one usage row** ([#41](https://github.com/ojowwalker77/channels/pull/41))

## 0.8.7 — 2026-10-10

- **Bring a room from an older relay up to date before anything reads it** ([#42](https://github.com/ojowwalker77/channels/pull/42))

## 0.8.6 — 2026-10-10

- **Wait on conditions in the flaky tests instead of fixed sleeps.** ([#36](https://github.com/ojowwalker77/channels/pull/36))
- **Darken ink-3 so quiet text clears 4.5:1.** ([#37](https://github.com/ojowwalker77/channels/pull/37))
- **Effect step 2a: the room's HTTP API on Effect, one route table with declared checks**
- **Effect step 2b: a person's routes on Effect, and every check a named guard**
- **Effect router: one prebuilt program, one context per request; the Worker logs and retries a refused room stub**
- **Worker: KIWI_ROOM_RETRY=off turns the room-stub retry off (to count refusals on a canary)**
- **Member scopes (T615) groundwork: owner-signed scopes in the member record, scope.set, enforced in fold, the relay's can-post bit**
- **Member scopes, part 2a: tests, the relay bit at create, and reconcile**
- **Member scopes, part 2b: the web picker, scopes in People, join and the prompt**
- **Member scopes, part 2c: the record is the floor outside a client's window**
- **Member scopes, part 2d: the MCP owner tool, and scopes in members**
- **SECURITY.md: scopes are advisory with clients or a relay from before them**
- **Rebased on step 2: records joins KIWI_DIRS, and fixtures know scopes**
- **Scope attack tests: exceeding scopes, self-grant, a faked can-post bit, downgrade mid-session**
- **Scope attack test: type the deliberately garbled record**

## 0.8.5 — 2026-10-10

- **Install listen hooks for Codex, Gemini, Cursor, and Grok.** ([#33](https://github.com/ojowwalker77/channels/pull/33))
- **Install the current harness's hooks when an agent joins** ([#34](https://github.com/ojowwalker77/channels/pull/34))
- **Refuse /info without the join-code fingerprint.** ([#35](https://github.com/ojowwalker77/channels/pull/35))

## 0.8.4 — 2026-10-10

- **Smoke the flows that need real state: passkeys, a linked computer's agent, its task** ([#27](https://github.com/ojowwalker77/channels/pull/27))
- **Make the new surfaces usable from the keyboard.** ([#28](https://github.com/ojowwalker77/channels/pull/28))
- **Stop member-written fields from forging a line of status, tasks or facts.** ([#29](https://github.com/ojowwalker77/channels/pull/29))
- **Characters: agents get a shape in their person's colour; people pick their colour** ([#31](https://github.com/ojowwalker77/channels/pull/31))
- **Give MCP and the CLI one numbered listen loop.** ([#30](https://github.com/ojowwalker77/channels/pull/30))
- **Keep ~/.kiwi and decrypted downloads private to this account.** ([#32](https://github.com/ojowwalker77/channels/pull/32))

## 0.8.3 — 2026-10-10

- **Web errors from raw fetches carry the relay's tag** ([#26](https://github.com/ojowwalker77/channels/pull/26))
- **Let --trust-proxy name an address or CIDR, not only loopback** ([#25](https://github.com/ojowwalker77/channels/pull/25))

## 0.8.2 — 2026-10-10

- **UI smoke test in CI: open every menu, popover and dialog on the prod build** ([#21](https://github.com/ojowwalker77/channels/pull/21))
- **An expired sign-in signs this browser out and says so, instead of throwing** ([#22](https://github.com/ojowwalker77/channels/pull/22))
- **/info: the owner's name only for code holders; a dated end to the room-id-only path (GLM-1)** ([#23](https://github.com/ojowwalker77/channels/pull/23))
- **Unlinked computer registrations expire; registrations are rate-limited (GLM-2)** ([#24](https://github.com/ojowwalker77/channels/pull/24))

## 0.8.1 — 2026-10-10

- **Make the thread panel edge tall enough to drag.**
- **Stop the account menu from crashing the page.**
- **A listener survives a consumer that throws (GLM-3)** ([#20](https://github.com/ojowwalker77/channels/pull/20))
- **Restrict message images to the raster list.** ([#19](https://github.com/ojowwalker77/channels/pull/19))

## 0.8.0 — 2026-10-09

- **Document 0.7.0: threads, delivery, claims, colours and icons** ([#17](https://github.com/ojowwalker77/channels/pull/17))
- **Plan: the backend (and then the web) on Effect 4**
- **Guard tests for the Effect rewrite: an auth table and the relay's error texts**
- **Auth table: the live stream refuses strangers and removed members, and closes a removed member's socket**
- **Effect step 1: one error vocabulary, and request bodies checked by Schemas**
- **Refuse root imports of effect in src/ and web/src; the reclaim CLI test waits on conditions, not fixed sleeps**
- **Owner-sign the channel title, and refuse an unsigned downgrade.**
- **Keep the 0.7 owner statement, and sign the titles promise beside it.**
- **Guard PUT /title like the other owner routes.**
- **The owner renames a channel from the ⋯ menu, and every member sees it**
- **Replies open a thread instead of flooding the main timeline**

## 0.7.0 — 2026-10-09

- **Setting up a passkey when a vault already exists offers to unlock it** ([#14](https://github.com/ojowwalker77/channels/pull/14))
- **The vault key is kept as it is: it was never extractable, so exporting it threw** ([#15](https://github.com/ojowwalker77/channels/pull/15))
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
- **kiwi sh: query the channel as read-only files with a sandboxed shell** ([#3](https://github.com/ojowwalker77/channels/pull/3))
- **Reclaim a seat after disconnection** ([#4](https://github.com/ojowwalker77/channels/pull/4))
- **Vault (relay + shared crypto): a signed-in person's channels behind a passkey** ([#5](https://github.com/ojowwalker77/channels/pull/5))
- **UI 1/5: monochrome tokens and Base UI primitives** ([#7](https://github.com/ojowwalker77/channels/pull/7))
- **UI: markdown upgrade (code copy, sortable tables, safe links)** ([#9](https://github.com/ojowwalker77/channels/pull/9))
- **The channel screen gets rakazo's calm: who's here, roomier rows, a rounder composer** ([#8](https://github.com/ojowwalker77/channels/pull/8))
- **UI 3/5: quiet event rows that collapse into runs** ([#10](https://github.com/ojowwalker77/channels/pull/10))
- **Details widens to taste, and ⌘K goes anywhere** ([#11](https://github.com/ojowwalker77/channels/pull/11))
- **Signed in, a passkey brings every channel to this browser** ([#12](https://github.com/ojowwalker77/channels/pull/12))
- **The owner sees a reclaim as one: who takes back which seat, and a loud warning if it's in use** ([#13](https://github.com/ojowwalker77/channels/pull/13))
- **release: install web/ too, so the dashboard's tests run**

## 0.5.0 — 2026-10-08

- **Plan: private beta, per-person quotas, self-hosting docs**
- **Creating channels can be invite-only during a private beta**
- **The Bun relay serves the dashboard and takes sign-in settings**
- **Per-person and per-channel quotas, and a byte cap for every relay**
- **Channels expire after 90 quiet days**
- **Your computers show when each was last used; unused links expire after 30 days**
- **Usage: what each person uses of the relay's limits**
- **Type the owner-name check in the usage test**
- **An invite says who sent it, and what happens next, before sign-in**
- **Each message is cached once per machine**
- **The dashboard shows beta and quota limits where they matter**
- **kiwi relay takes the same flags as the Bun relay**
- **Your channels come to your phone with a QR code**
- **Add self-host examples for Caddy, systemd, and Docker** ([#1](https://github.com/ojowwalker77/channels/pull/1))
- **The public relay runs without quotas or expiry until launch**
- **kiwi doctor checks the install, the relay, this computer's link and hooks** ([#2](https://github.com/ojowwalker77/channels/pull/2))
- **The Bun relay keeps its data folder private, and can be backed up live**
- **Self-hosting, documented: the Bun relay, TLS, your own Worker, every setting**
- **The member list shows who's free, busy or overloaded**
- **kiwi status and the MCP tools show each member's role and load**
- **Join codes can't be ground: both sides commit before the code exists**
- **Roles and rules are agreed before an agent joins**
- **Re-signing a join check a device already signed doesn't spend its allowance**
- **Self-hosting: relays and CLIs from 0.5.0 go together**
- **Roles are the owner's to give: agents ask, the owner allows, refuses or sets**

## 0.4.3 — 2026-10-08

- **Channels are called by their name in the CLI**
- **The security review's last items**

## 0.4.2 — 2026-10-08

- **Invite commands name the relay they came from**
- **No exceptions for the old address**
- **One way in: computers are set up once, agents join from them**

## 0.4.1 — 2026-10-08

- **Link a computer to its person (relay side), and joins that carry its vouch**
- **Channels by Kiwi Init moves to channels.kiwiinit.com**
- **The repository is ojowwalker77/channels now**

## 0.4.0 — 2026-10-08

- **Initial commit**
- **Add modelchannel M0: encrypted real-time relay and mc CLI**
- **Default to the deployed public relay**
- **Add web page for humans to watch and post in a channel**
- **Rebuild the web page with shadcn/ui, focused on watching agents**
- **Agent coordination: tasks, claims, facts, presence, MCP server, task board, demo**
- **Faster status, easier setup, calmer board**
- **Images everywhere, global task board, mc quick, full MCP, docs and security**
- **mc watch: POST every message to a webhook so threads wake without a monitor**
- **Owner-gated channels: approval to join, owner-signed names, leave/kick/close**
- **mc mcp exits when its client disconnects; MCP test always cleans up**
- **Agents stay reachable on their own: Claude Code hooks, one-line install**
- **Removed members always get a clean 'you were removed', whichever request notices first**
- **Installer: ASCII only (a Unicode ellipsis after $REPO broke sh)**
- **Installer upgrades existing installs (Bun pins GitHub installs to the first commit it saw)**
- **Closing is unrecoverable: per-channel keys destroyed with the channel**
- **Rename the project to channel-one**
- **Relay storage class renamed (old test rooms deleted with the old class); hooks use bun's stable path; presence test closes its channel**
- **Humans sign in with WorkOS AuthKit and own their channels**
- **Sign-in moves to the WorkOS production environment**
- **CSP: let the browser finish sign-in with WorkOS**
- **Agents sharing a machine keep their own names**
- **Agents need their own human's approval; people and agents are named for real**
- **Web: an Apple Messages-style redesign, without shadcn**
- **Web: voice colours per agent, Inter, Hugeicons, quieter chrome**
- **Your channels follow your account; a quiet, monochrome redesign**
- **Owners can vouch for their own agent from the join request**
- **Two people with the same first name no longer collide**
- **A removed agent can rejoin with the same command**
- **Agents on one machine never touch each other's channels**
- **Status lists only current members; claiming an unvouched agent is no longer the default**
- **Vouch links survive signing in**
- **Kiwi, and the security review's critical and high findings fixed**
- **Channels by Kiwi Init**
- **The security review's medium and low findings**
- **Distribute kiwi as built, checksummed, attested binaries**
- **Tests don't depend on running inside Claude Code**

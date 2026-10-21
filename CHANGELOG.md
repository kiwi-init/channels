# Changelog

Written by `bun scripts/changelog.ts` from each squash-merged pull request's title.

## 0.24.0 — 2026-10-21

- **The permission hook asks the relay for an answer the daemon hasn't caught up to, checks for a newer prompt last, and closes two lock races (T1651)** ([#631](https://github.com/ojowwalker77/channels/pull/631))
- **Permission prompts: the row clears only on an answer that counts, more secret shapes, and edits show what they replace (T1588)** ([#628](https://github.com/ojowwalker77/channels/pull/628))
- **The permission row shows what an edit replaces and with what, and says when it replaces every occurrence (T1615)** ([#632](https://github.com/ojowwalker77/channels/pull/632))
- **The permission prompt docs say folder and file paths count as secret only for known shapes, and that an answer names the ask's id, agent and signature (T1608)** ([#629](https://github.com/ojowwalker77/channels/pull/629))
- **A permission answer is built only on a verified ask and counted only as the fold's own message at its seq (T1594)** ([#634](https://github.com/ojowwalker77/channels/pull/634))
- **Plan: one fresh agent session per task** ([#635](https://github.com/ojowwalker77/channels/pull/635))
- **The conversation stays at its newest message when content above it grows after it opens (T1679)** ([#633](https://github.com/ojowwalker77/channels/pull/633))
- **The fold refuses every message at a seq it was handed twice, so neither copy opens an ask or counts as an answer (T1725)** ([#636](https://github.com/ojowwalker77/channels/pull/636))
- **The conversation's own scrolls to the bottom record where they left it, so content growing before the first scroll event after a channel switch keeps it at the newest message (T1720)** ([#637](https://github.com/ojowwalker77/channels/pull/637))
- **The permission hook's last check runs after its wait has closed, and letting go of a session leaves another hook's lock and newer-prompt mark alone (T1661)** ([#640](https://github.com/ojowwalker77/channels/pull/640))
- **Dictation's model, recorder and transcriber load on the first mic press, out of the first-load JS (T1859)** ([#641](https://github.com/ojowwalker77/channels/pull/641))
- **The bundle check fails when dictation's model code is in the first load, a failed engine load says to reload, and the engine warms on mic hover or focus (T1887)** ([#642](https://github.com/ojowwalker77/channels/pull/642))
- **Plan: terminal plugins, from an audit of the Rex and tmux code (T1928)** ([#645](https://github.com/ojowwalker77/channels/pull/645))
- **Channel sidebar: a Search row, one Tasks row with quiet dots, threads between agents folded (T1763)** ([#638](https://github.com/ojowwalker77/channels/pull/638))
- **Kiwi's terminal code runs programs, reads JSON and checks the foreground one way each, in src/terminals/shared (T2009)** ([#648](https://github.com/ojowwalker77/channels/pull/648))
- **New agent's windows open through terminal plugins: a manifest and interface, a registry, and Rex, tmux and the terminal app each in src/terminals (T2010)** ([#649](https://github.com/ojowwalker77/channels/pull/649))
- **A stale permission lock is taken over by moving it aside first, and a signal after the wait has closed closes the ask instead of killing the hook (T1894)** ([#646](https://github.com/ojowwalker77/channels/pull/646))
- **A lazy view that fails to load says "Part of Channels couldn't load. Reload to try again." instead of failing in silence (T1960)** ([#644](https://github.com/ojowwalker77/channels/pull/644))
- **The picture viewer's top row is the window's title row: its buttons click, and it clears the Mac traffic lights (T1841)** ([#643](https://github.com/ojowwalker77/channels/pull/643))
- **One reader per terminal shape in packages/core/src/terminals.ts: place names, a launch's result, Rex's status and a Rex seat (T2012)** ([#651](https://github.com/ojowwalker77/channels/pull/651))
- **The secret filter lets field-name keys and whole-value switches through, and catches lowercase _key/_auth, ?code=, ?access_key= and sudo -S passwords (T1621)** ([#639](https://github.com/ojowwalker77/channels/pull/639))
- **The secret filter checks YAML list items and flow maps, and lets type annotations and S3/object keys through (T1923)** ([#652](https://github.com/ojowwalker77/channels/pull/652))
- **Rex is a terminal plugin: where a seat runs, its marks, Show in Rex, its events, typing into its pane and its palette helpers, in src/terminals/rex (T2011)** ([#650](https://github.com/ojowwalker77/channels/pull/650))
- **#general reads like a group chat: task bookkeeping folds into one line, digests go to the task's thread (T1939)** ([#647](https://github.com/ojowwalker77/channels/pull/647))
- **kiwi send and reply tell an agent when its #general message ran long** ([#653](https://github.com/ojowwalker77/channels/pull/653))
- **Terminal plugins 5/9: the terminals and launch config, kiwi terminal, kiwi launches, new agents open where Prefer says (T2013)** ([#655](https://github.com/ojowwalker77/channels/pull/655))
- **Terminal plugins 8/9: Settings → New agents, and New agent follows the switch (T2016)** ([#658](https://github.com/ojowwalker77/channels/pull/658))
- **Terminal plugins 9/9: docs, the plan as built, and how a new agent's terminal is picked (T2017)** ([#660](https://github.com/ojowwalker77/channels/pull/660))
- **tmux gets helpers: Download and Remove, the @kiwi window marks, prefix K to the seat that needs you, and Show in tmux (T2014)** ([#659](https://github.com/ojowwalker77/channels/pull/659))
- **Show from Needs you and New agent goes through the terminal plugins: Show in Rex now, Show in tmux next (T2015)** ([#656](https://github.com/ojowwalker77/channels/pull/656))

## 0.23.1 — 2026-10-21

- **The relay streams a dictation download through its hash into the store instead of holding the whole model in memory (T908)** ([#608](https://github.com/ojowwalker77/channels/pull/608))
- **The open conversation no longer re-renders for other channels' news, search is deferred and windowed, Mermaid drawings are cached and capped, and task rows share one PR index (T154)** ([#607](https://github.com/ojowwalker77/channels/pull/607))
- **A paired computer's daemon takes its person's asks from the relay inbox: claimed, checked, run within limits, answered and logged (T788)** ([#611](https://github.com/ojowwalker77/channels/pull/611))
- **local-relay: no relay left running when its port can't be read, plus the #565 review nits (T997)** ([#610](https://github.com/ojowwalker77/channels/pull/610))
- **A replayed older title, settings or icon is ignored (T722, A5)** ([#613](https://github.com/ojowwalker77/channels/pull/613))
- **The paired computer's inbox survives a box that breaks its reader, trusts only the relay's id shape, launches in the realpath'd folder and keeps its launch cap across restarts (T1122)** ([#615](https://github.com/ojowwalker77/channels/pull/615))
- **A signature check never throws, so one crafted message can't stop a channel loading (T1123)** ([#614](https://github.com/ojowwalker77/channels/pull/614))
- **Composer and conversation: options answer once, drafts survive switches, honest counts, working jumps, keyboard actions (T155)** ([#609](https://github.com/ojowwalker77/channels/pull/609))
- **main's unit tests pass again: a box signed with a key that isn't base64 is refused as unsigned, now that verify() can't throw (T1211)** ([#619](https://github.com/ojowwalker77/channels/pull/619))
- **The board keeps finished tasks: no fold base from a short roster, a gap between base and log refetched, a poisoned base rebuilt (T1004)** ([#612](https://github.com/ojowwalker77/channels/pull/612))
- **The owner's fold base stays bounded and a replay is still refused after it's pruned, so snapshots seal again past 512 KB (T586, T1089, T1219, T1272)** ([#602](https://github.com/ojowwalker77/channels/pull/602))
- **New agent on another computer: pick a paired one, see who's online, launch through the relay (T789)** ([#617](https://github.com/ojowwalker77/channels/pull/617))
- **The docs say how an agent is started from the app, here or on a paired computer, and the New agent plan's item 4 is as built (T790)** ([#616](https://github.com/ojowwalker77/channels/pull/616))
- **The dashboard's first load drops about 9 KB: the Tasks view, image compression and log export load when used (T1224)** ([#618](https://github.com/ojowwalker77/channels/pull/618))
- **main builds again: lazy.tsx declares TasksView once, not twice (#618 and #602 both added it)** ([#620](https://github.com/ojowwalker77/channels/pull/620))
- **Tests stop leaking the answer cache, and a local run never writes into the real ~/.kiwi (T1249)** ([#621](https://github.com/ojowwalker77/channels/pull/621))
- **docs/agents.md and SECURITY.md say how a permission prompt is answered from the app: who can answer, what's shown and what never is (T1457)** ([#622](https://github.com/ojowwalker77/channels/pull/622))
- **The permission prompt docs match the core as built: Allow only from the agent's human, what's shown per tool and its caps, Deny-only rows, what stays in the terminal (T1457)** ([#626](https://github.com/ojowwalker77/channels/pull/626))
- **A red CI check no longer opens a task: the owner's app's CI-red automation is gone, main included (T1515)** ([#625](https://github.com/ojowwalker77/channels/pull/625))
- **Permission prompts core: the permission field and its check, the secret filter, and the answer check, bound to the ask's id, sender and signature (T1454)** ([#623](https://github.com/ojowwalker77/channels/pull/623))
- **Claude Code's permission prompts reach the agent's human in Kiwi, and their signed Allow or Deny answers Claude Code (T1455)** ([#627](https://github.com/ojowwalker77/channels/pull/627))
- **The permission hook retries an answer the fold doesn't have yet, stays quiet once a newer prompt started, and the installer refreshes a stale entry (T1605)** ([#630](https://github.com/ojowwalker77/channels/pull/630))
- **Permission prompts in the app: the Needs you row with the signed answer, who can allow, settled states (T1456)** ([#624](https://github.com/ojowwalker77/channels/pull/624))

## 0.23.0 — 2026-10-20

- **kiwi rotate on gives Codex seats in tmux a fresh thread, and the seat follows it** ([#564](https://github.com/ojowwalker77/channels/pull/564))
- **Plan: New agent, started from the Channels app** ([#566](https://github.com/ojowwalker77/channels/pull/566))
- **The composer shows a picked mention as the member's nickname, as sent messages do (T33)** ([#567](https://github.com/ojowwalker77/channels/pull/567))
- **kiwi harnesses and the daemon's harnesses verb: each harness on the login shell's PATH, its version, and whether Kiwi can wake it (T38)** ([#568](https://github.com/ojowwalker77/channels/pull/568))
- **Auto-approval keeps the personality an invite pinned, and the owner reads a launch id from the join claims (T40)** ([#569](https://github.com/ojowwalker77/channels/pull/569))
- **The daemon reads a seat's activity from Rex only with the Rex helpers on, and never blocks on it (T138)** ([#571](https://github.com/ojowwalker77/channels/pull/571))
- **A message dated past what a date can hold no longer crashes the app (T136)** ([#570](https://github.com/ojowwalker77/channels/pull/570))
- **A launch opens its terminal: a Rex window, else a tmux window in kiwi, else Terminal.app (T39)** ([#572](https://github.com/ojowwalker77/channels/pull/572))
- **The dashboard's first load is back under its budget, with 6.6 KB to spare (T201)** ([#577](https://github.com/ojowwalker77/channels/pull/577))
- **The login shell falls back to the account's own when SHELL is unset, and pi, kimi and agent count only when they look like their harness (T170)** ([#573](https://github.com/ojowwalker77/channels/pull/573))
- **A filtered read no longer marks the rest of the channel read (T137)** ([#578](https://github.com/ojowwalker77/channels/pull/578))
- **Past 2,000 messages the owner's app keeps its GitHub automation running: a fold on the snapshot counts as the whole log (T139)** ([#574](https://github.com/ojowwalker77/channels/pull/574))
- **Changing the relay in Settings keeps every saved channel (T135)** ([#575](https://github.com/ojowwalker77/channels/pull/575))
- **A voice call ends when you leave its channel, and never takes another channel's news or tools (T140)** ([#576](https://github.com/ojowwalker77/channels/pull/576))
- **kiwi launch and the daemon's launch verb start Claude Code or Codex in a terminal you can open, and kiwi join carries KIWI_LAUNCH to the owner (T41)** ([#580](https://github.com/ojowwalker77/channels/pull/580))
- **CI red opens a task only for a failed check on main: a PR branch's red is its PR's to fix (T531)** ([#584](https://github.com/ojowwalker77/channels/pull/584))
- **A release refuses a tag whose commit isn't on main, and bump-main pushes only the stamp's files (T142)** ([#582](https://github.com/ojowwalker77/channels/pull/582))
- **A shell profile outside a temp folder never gets a PATH line into one (T61)** ([#581](https://github.com/ojowwalker77/channels/pull/581))
- **A removed member can no longer read the channel's name, charter, hold, rooms or repos: they follow the key's epoch (T141)** ([#579](https://github.com/ojowwalker77/channels/pull/579))
- **Voice acts only on the person's spoken yes, channel text reaches it as content not instructions, and dictation never leaves the mic on (T153)** ([#585](https://github.com/ojowwalker77/channels/pull/585))
- **Codex hooks go where CODEX_HOME points** ([#589](https://github.com/ojowwalker77/channels/pull/589))
- **One unreadable message no longer stops the owner's snapshots, filtered messages stay authentic after a reload, and GitHub automation keeps failed items (T152)** ([#586](https://github.com/ojowwalker77/channels/pull/586))
- **New agent: start an agent on this computer from the Channels app, and watch it join (T42)** ([#587](https://github.com/ojowwalker77/channels/pull/587))
- **kiwi join inside Claude Code waits a moment for its transcript to name the model (T360)** ([#583](https://github.com/ojowwalker77/channels/pull/583))
- **A key the relay lists without an owner-signed record is not a member (T143, A3)** ([#592](https://github.com/ojowwalker77/channels/pull/592))
- **An agent given a personality mid-session is told it at its next hook, once (T269)** ([#588](https://github.com/ojowwalker77/channels/pull/588))
- **A name, settings or icon change during a pending rotation rotates first, and the icon follows the newest key like the rest (T414)** ([#590](https://github.com/ojowwalker77/channels/pull/590))
- **The installer takes the Apple Silicon build under Rosetta, and a relay behind an untrusted proxy says how to trust it (T156)** ([#595](https://github.com/ojowwalker77/channels/pull/595))
- **The daemon's CPU and memory: rex backoff holds, transcripts and folds reused while unchanged, fewer syncs, no git per hook, one home walk per version (T149)** ([#591](https://github.com/ojowwalker77/channels/pull/591))
- **kiwi reply N answers where the session heard #N, dash-led text is text, unused options are refused or reported, and 1.5h means 90 minutes (T151)** ([#596](https://github.com/ojowwalker77/channels/pull/596))
- **Presence can't be spoofed under another name or replayed (T674, A4)** ([#594](https://github.com/ojowwalker77/channels/pull/594))
- **Signing secrets in the release environment, the app's own entitlements, and jev-ci trusting no fork's pass markers (T148)** ([#593](https://github.com/ojowwalker77/channels/pull/593))
- **Daemon and hook reliability: no killing a reused pid, no daemon pile-up, wakes and kiwi sh queries bounded, init.lua written in one rename (T150)** ([#597](https://github.com/ojowwalker77/channels/pull/597))
- **The person's ask to a paired computer and that computer's answer: made, sealed, signed and read (T786)** ([#599](https://github.com/ojowwalker77/channels/pull/599))
- **The linked GitHub token goes only to the relay it was linked on, while that relay names the same App (T147)** ([#604](https://github.com/ojowwalker77/channels/pull/604))
- **The relay reads bodies within a cap, bounds its signature-key cache, rate-limits join requests, history reads and GitHub lookups, and streams GitHub diffs and logs (T145)** ([#605](https://github.com/ojowwalker77/channels/pull/605))
- **The new key never reaches a removed member, and the epoch never goes down (T721, A1+A2)** ([#603](https://github.com/ojowwalker77/channels/pull/603))
- **Relay correctness: JWKS refetch, all-or-nothing create, push-checked repos without the App key, idle days from the last close, a warm store on Bun (T146)** ([#600](https://github.com/ojowwalker77/channels/pull/600))
- **Harden against untrusted messages: refused events, future re:, handoff from anyone, diagram links, history loop (T144)** ([#606](https://github.com/ojowwalker77/channels/pull/606))
- **Channel settings as a page, and Settings in sections (T69)** ([#598](https://github.com/ojowwalker77/channels/pull/598))
- **The relay keeps a sealed inbox per paired computer: registered by its cert, written only by its person, read on its socket (T787)** ([#601](https://github.com/ojowwalker77/channels/pull/601))
- **The local relay in perf, shots, smoke and dictation runs takes a port the system picks** ([#565](https://github.com/ojowwalker77/channels/pull/565))

## 0.22.0 — 2026-10-20

- **A release is a tag on main: the workflow stamps the version and changelog, and commits them to main** ([#550](https://github.com/ojowwalker77/channels/pull/550))
- **The tmux-restart test waits for the old server to exit before starting a new one (#552)** ([#553](https://github.com/ojowwalker77/channels/pull/553))
- **On a Mac the traffic lights no longer touch the page: the rail is 92px there, so the sheet starts 12px after them** ([#555](https://github.com/ojowwalker77/channels/pull/555))
- **A Mac window is never narrower than 768px, so its headers never sit under the traffic lights** ([#556](https://github.com/ojowwalker77/channels/pull/556))
- **The desktop app never zooms the page: ⌘+, ⌘− and ⌘0 step the text size, the layout stays put** ([#559](https://github.com/ojowwalker77/channels/pull/559))
- **kiwi rotate logs why a seat stays, and a question on a finished task no longer holds it** ([#561](https://github.com/ojowwalker77/channels/pull/561))
- **Seats say where they run, and Kiwi marks them in terminals that take OSC 7501** ([#554](https://github.com/ojowwalker77/channels/pull/554))
- **A lead past the context line writes a lead checkpoint, and rotates only after it** ([#562](https://github.com/ojowwalker77/channels/pull/562))
- **Seats follow Rex events, rotation clears a Rex pane, and Needs you and Rex's palette open the seat** ([#557](https://github.com/ojowwalker77/channels/pull/557))
- **The Rex helpers plan, built, with what probes on a live Rex found** ([#551](https://github.com/ojowwalker77/channels/pull/551))
- **Settings → Rex: Install Rex Helpers, from the app** ([#563](https://github.com/ojowwalker77/channels/pull/563))

## 0.21.0 — 2026-10-20

- **A MiMoCode session whose lookups race keeps one listener, and the plugin is updated before any seat joins** ([#536](https://github.com/ojowwalker77/channels/pull/536))
- **Hooks from an older kiwi are rewritten with --harness, and a hook with no session never takes another harness's seat** ([#534](https://github.com/ojowwalker77/channels/pull/534))
- **resign test: a stale signature comes from a door in front of the relay, not a patched Date.now (T1045)** ([#539](https://github.com/ojowwalker77/channels/pull/539))
- **A new MiMoCode session can be woken before it runs its first shell command** ([#533](https://github.com/ojowwalker77/channels/pull/533))
- **SessionStart's unread heading and Cursor's stop follow-up name their channel** ([#540](https://github.com/ojowwalker77/channels/pull/540))
- **A MiMoCode or Pi seat counts as woken only while its listener runs, and the plugin's wakes and refusals land in wake.log** ([#542](https://github.com/ojowwalker77/channels/pull/542))
- **Joining a second channel from a folder says which -c ALIAS --as NAME picks each seat** ([#544](https://github.com/ojowwalker77/channels/pull/544))
- **After a Claude Code /clear, the new session commits what the earlier session's listener handed over** ([#541](https://github.com/ojowwalker77/channels/pull/541))
- **Closing a channel offers its whole signed log as a download first** ([#545](https://github.com/ojowwalker77/channels/pull/545))
- **One wake outstanding per seat: no second wake until the agent has read the first** ([#543](https://github.com/ojowwalker77/channels/pull/543))
- **The Linux app appears in seconds again: the AppImage is gzip in 128 KiB blocks, not xz in 1 MiB (#546)** ([#547](https://github.com/ojowwalker77/channels/pull/547))
- **kiwi rotate on gives this computer's Claude Code seats in tmux a fresh session between tasks** ([#548](https://github.com/ojowwalker77/channels/pull/548))

## 0.20.5 — 2026-10-19

- **Grok Bot's VM is seated as Grok Bot, not Cursor, though its shell has CURSOR_AGENT (T508)** ([#491](https://github.com/ojowwalker77/channels/pull/491))
- **Mentions read as the person's nickname in the app, while the message keeps the @handle (T547)** ([#494](https://github.com/ojowwalker77/channels/pull/494))
- **A fresh session starts from its checkpoint, and every hook fits Claude Code's inline limit** ([#488](https://github.com/ojowwalker77/channels/pull/488))
- **Tests leave the real MiMoCode folder alone: the preload redirects it and drops its session markers** ([#489](https://github.com/ojowwalker77/channels/pull/489))
- **Tasks board: a PR's diff numbers stay inside their column instead of running into the checks (T615)** ([#495](https://github.com/ojowwalker77/channels/pull/495))
- **Opening a conversation lands at its newest message, and stays there as it fills in (T534)** ([#493](https://github.com/ojowwalker77/channels/pull/493))
- **Needs you is one list with one count, and a question waiting for you shows once (T587)** ([#496](https://github.com/ojowwalker77/channels/pull/496))
- **MiMoCode's plugin sends a refused wake again instead of dropping its messages** ([#492](https://github.com/ojowwalker77/channels/pull/492))
- **A seat's context shows on its lane, and past 250k the Stop hook asks once for a checkpoint** ([#499](https://github.com/ojowwalker77/channels/pull/499))
- **Tasks: one board, one way to open a task, one set of labels (T588)** ([#500](https://github.com/ojowwalker77/channels/pull/500))
- **MiMoCode's wake counts as delivered only once the plugin says it landed, so a restart can't lose it** ([#497](https://github.com/ojowwalker77/channels/pull/497))
- **On a phone too, opening a conversation lands at its newest message (T718)** ([#502](https://github.com/ojowwalker77/channels/pull/502))
- **An agent's status reads the same everywhere, and the agent strip shows only on phones (T589)** ([#501](https://github.com/ojowwalker77/channels/pull/501))
- **Channel details: one invite, one notes, one way to let someone in, one add-agent command (T590)** ([#516](https://github.com/ojowwalker77/channels/pull/516))
- **kiwi help lists log --json and says it prints JSON Lines** ([#517](https://github.com/ojowwalker77/channels/pull/517))
- **A MiMoCode seat is woken even when the plugin can't look up its session** ([#521](https://github.com/ojowwalker77/channels/pull/521))
- **Navigation: the sidebar on desktop, tabs on phones; search is a real field; no title repeated (T591)** ([#525](https://github.com/ojowwalker77/channels/pull/525))
- **Needs you on Tasks shows a decision as the composer's card (#498)** ([#514](https://github.com/ojowwalker77/channels/pull/514))
- **A Codex wake no longer reads as empty: listen --now says when nothing is unread** ([#524](https://github.com/ojowwalker77/channels/pull/524))
- **With seats in two channels in one folder, kiwi names both channels, and the Stop hook says which channel each batch is from** ([#523](https://github.com/ojowwalker77/channels/pull/523))
- **Claude Code keeps being woken after an upgrade: kiwi rewrites its own stale listen hook** ([#518](https://github.com/ojowwalker77/channels/pull/518))
- **Handing a review to someone else keeps the open round and its commit** ([#522](https://github.com/ojowwalker77/channels/pull/522))
- **The 'looks like T…' hint no longer matches tasks that only share a suffix like 'stage 6'** ([#519](https://github.com/ojowwalker77/channels/pull/519))
- **A Codex session started from Claude Code is no longer served the Claude session's seat** ([#530](https://github.com/ojowwalker77/channels/pull/530))
- **A MiMoCode session keeps one listener, and an older kiwi's plugin is brought up to date by itself** ([#531](https://github.com/ojowwalker77/channels/pull/531))
- **A Grok seat with a live kiwi listen shows it wakes via its listener** ([#532](https://github.com/ojowwalker77/channels/pull/532))
- **Dictation runs Whisper on this computer: the model comes pinned through the relay, and speech never leaves (T176)** ([#529](https://github.com/ojowwalker77/channels/pull/529))
- **wake.log records the read cursor each wake's unread count was taken from** ([#535](https://github.com/ojowwalker77/channels/pull/535))
- **Dictation works on Linux, checked on the packaged Linux app (T848)** ([#527](https://github.com/ojowwalker77/channels/pull/527))
- **kiwi 0.20.5 (T984)**
- **Merge main into T984-release-0.20.5: #538 (dictation's .wasm out of the app)**

## 0.20.4 — 2026-10-19

- **Grok Bot wears its own mark, the round head with two eyes, not Grok's (T424)** ([#486](https://github.com/ojowwalker77/channels/pull/486))

## 0.20.3 — 2026-10-19

- **Kimi Code sessions in Kimi's server are woken in place by the daemon (T150)** ([#480](https://github.com/ojowwalker77/channels/pull/480))
- **Cursor keeps its own listener running, so it's woken in place in its session (T152)** ([#483](https://github.com/ojowwalker77/channels/pull/483))
- **Pi is a known harness: detected, its model read, woken in place by Kiwi's Pi extension, with its logo (T146)** ([#481](https://github.com/ojowwalker77/channels/pull/481))
- **MiMoCode is woken in place through Kiwi's plugin, and names its own session (T151)** ([#484](https://github.com/ojowwalker77/channels/pull/484))

## 0.20.2 — 2026-10-19

- **Grok Bot is a first-class agent: recognised on its VM, its model recorded, woken through its routine's webhook (T153)** ([#478](https://github.com/ojowwalker77/channels/pull/478))

## 0.20.1 — 2026-10-19

- **perf-scale: reload to first screen timed inside the page; CHANGELOG 0.20.0 speed line: every budget met (T1795)** ([#471](https://github.com/ojowwalker77/channels/pull/471))
- **Mac downloads under 150 MiB: kiwi bundled zstd-packed (Developer ID signed before packing), maximum compression, release gate at the budget (T1851)** ([#472](https://github.com/ojowwalker77/channels/pull/472))
- **Desktop on Linux knows when its keys aren't in a keyring, and moves them into one once it's installed (T1744, part 1, no UI)** ([#473](https://github.com/ojowwalker77/channels/pull/473))
- **Landing page: OLED black, monospace, plain HTML, opening on Jow's Century 21 Calling cut (T30)** ([#474](https://github.com/ojowwalker77/channels/pull/474))
- **Robot heads become channel icons: picked when creating a channel and from its details (T6)** ([#475](https://github.com/ojowwalker77/channels/pull/475))
- **Agents wear their harness's logo instead of a robot head (T7)** ([#476](https://github.com/ojowwalker77/channels/pull/476))

## 0.20.0 — 2026-10-19

- **The first stable release: smaller, faster, sturdier.** What "stable" means is in docs/0.20-stable.md. Every one of its 27 must-fix tasks is in.
- **Update the Channels app and the kiwi CLI on every machine, then start a new session for each agent**, so its hooks run the fixed CLI (no more double wakes, lost read marks or 15-second stalls on a hung relay). The relay is deployed with this release.
- **Windows is no longer supported:** there is no Windows CLI, and install.ps1 is gone. The CLI downloads compressed (.xz/.gz), 30 MB at most.
- **Speed against the 0.20 budgets** (jow's Mac at 4x CPU, with 10 agents, 100 tasks and 2000 messages): desktop cold start about 600ms to first paint (was 2.2–2.9s), revisiting a channel 30ms, Tasks 80ms, Agents 49ms, Conversation 98ms, Details 48/62ms, typing p95 32ms, idle 0.6% CPU, a prompt hook p95 102ms, and a hung relay 1.6s per prompt. Reload to first screen is 361ms (≤ 400ms; median of 5 on main after #467). Every speed budget is met.
- **Security:** a message can no longer be replayed to take effect again (T690). Connecting a GitHub repo needs push access to it (T691). Large messages can't crash a channel's history reads (T694).
- **Fold: a signed message counts once, near when it was signed (T690)** ([#421](https://github.com/ojowwalker77/channels/pull/421))
- **Web first load imports @kiwi/core's client submodules, not the client.ts barrel: first-load JS 789,931 to 735,589 bytes (T752)** ([#423](https://github.com/ojowwalker77/channels/pull/423))
- **docs/0.20-stable.md: what "stable" means for 0.20.0 (T671)** ([#425](https://github.com/ojowwalker77/channels/pull/425))
- **A message a prompt or stop hook hands over no longer wakes the session a second time from the listener started with it (T761)** ([#424](https://github.com/ojowwalker77/channels/pull/424))
- **A dead socket is noticed: no pong in 10s, or no upgrade in 15s, drops it and reconnects (T712)** ([#422](https://github.com/ojowwalker77/channels/pull/422))
- **The app folds its window on the channel's snapshot, so older tasks, scopes and facts survive a reload (T788)** ([#426](https://github.com/ojowwalker77/channels/pull/426))
- **Reconnect at once when the network or the Mac comes back: online, a visible page and wake nudge every connection (T713)** ([#427](https://github.com/ojowwalker77/channels/pull/427))
- **Daemon socket writes queue what the socket didn't take and flush it on drain, so lines over 8 KB arrive whole (T703)** ([#429](https://github.com/ojowwalker77/channels/pull/429))
- **Desktop cold start: scripts cached, window before the keychain read, CLI copy off the main thread (T821)** ([#428](https://github.com/ojowwalker77/channels/pull/428))
- **A message this build can't read no longer empties the history cache: it's kept as a sealed unread row, so the window has no hole (T705)** ([#431](https://github.com/ojowwalker77/channels/pull/431))
- **A message that lands while a daemon subscriber catches up waits until the catch-up is sent, so the rest isn't skipped (T763)** ([#432](https://github.com/ojowwalker77/channels/pull/432))
- **Relay: history reads stop at 4 MB, and a body over 100 000 characters is refused at send (T694)** ([#430](https://github.com/ojowwalker77/channels/pull/430))
- **Creating a channel saves the owner key before the relay hears of it, and the next start finishes or forgets a create that didn't (T709)** ([#433](https://github.com/ojowwalker77/channels/pull/433))
- **A hook moves the cursor and marks messages read only after it has printed them, so a cut-off hook leaves them unread (T762)** ([#435](https://github.com/ojowwalker77/channels/pull/435))
- **A crashed window page reloads by itself, a hung one asks Wait or Reload, and main-process errors go to main.log (T706)** ([#434](https://github.com/ojowwalker77/channels/pull/434))
- **Desktop size: no node_modules in app.asar, English locales only, a size check in CI (T823)** ([#436](https://github.com/ojowwalker77/channels/pull/436))
- **A Mac that can't replace itself offers the release with the reason, instead of looping on Restart to update (T714)** ([#437](https://github.com/ojowwalker77/channels/pull/437))
- **A hung relay costs a prompt or stop hook 1.6s, not 14s, and every relay request gives up after 30s (T764)** ([#438](https://github.com/ojowwalker77/channels/pull/438))
- **A tag release without the Mac signing secrets fails instead of publishing an unsigned app that Macs would never update to (T711)** ([#440](https://github.com/ojowwalker77/channels/pull/440))
- **Updater failures end at available, with the reason in main.log and a retry in 30 minutes; a vanished staged update doesn't throw at quit (T708)** ([#439](https://github.com/ojowwalker77/channels/pull/439))
- **The app keeps its daemon alive: it checks every 30s and starts it again when it stops answering, and the daemon's output goes to KIWI_HOME/daemon.log (T704)** ([#443](https://github.com/ojowwalker77/channels/pull/443))
- **A hand-over cut at its 6,000-character limit marks only the messages it showed as read, so the rest comes next (T765)** ([#442](https://github.com/ojowwalker77/channels/pull/442))
- **A stalled update download no longer blocks checks: the check returns once the release is known, the zip streams with a 60s idle limit, and a newer release replaces a staged one (T717)** ([#444](https://github.com/ojowwalker77/channels/pull/444))
- **An older kiwi keeps a newer daemon running instead of replacing it, as the app already does (T710)** ([#441](https://github.com/ojowwalker77/channels/pull/441))
- **The channel clock holds still within its interval: a re-render doesn't refold, one timer per interval (T822)** ([#446](https://github.com/ojowwalker77/channels/pull/446))
- **Rate limits: 429 says Retry-After, refused attempts aren't counted, and clients wait it out instead of failing or re-posting (T695)** ([#445](https://github.com/ojowwalker77/channels/pull/445))
- **Tasks and Agents at scale: lanes' PRs and unread counts in one pass per state; timeline only on Conversation (T831)** ([#449](https://github.com/ojowwalker77/channels/pull/449))
- **One daemon per KIWI_HOME: a lifetime lock, a daemon that loses it exits, and stopping never deletes another daemon's socket (T715)** ([#447](https://github.com/ojowwalker77/channels/pull/447))
- **A daemon whose only relays are local ones that stopped answering, with nobody connected, stops by itself (T702)** ([#448](https://github.com/ojowwalker77/channels/pull/448))
- **Conversation: mounted rows stay bounded in a long session, and the view keeps following new messages (T826)** ([#450](https://github.com/ojowwalker77/channels/pull/450))
- **Conversation per incoming message: live cards in one pass, cheaper row memo, stable pictures context (T1182)** ([#451](https://github.com/ojowwalker77/channels/pull/451))
- **A broken config.json no longer fails every hook: hooks exit 0 and say which file to fix (T766)** ([#453](https://github.com/ojowwalker77/channels/pull/453))
- **Per-message storage: one IndexedDB connection and transaction per batch, localStorage once per burst (T1252)** ([#456](https://github.com/ojowwalker77/channels/pull/456))
- **First load: Base UI's menu, tooltip and dialog load lazily, after first paint; budget 590,000 (T829)** ([#455](https://github.com/ojowwalker77/channels/pull/455))
- **Repos picker: relay config and repo list held for minutes, status and repos asked at once (T827)** ([#457](https://github.com/ojowwalker77/channels/pull/457))
- **CLI downloads compressed (.xz/.gz, ≤ 30 MB) and no Windows CLI (T776)** ([#452](https://github.com/ojowwalker77/channels/pull/452))
- **A Claude session's listener that can't reach the daemon keeps trying, so the session isn't left deaf (T768)** ([#458](https://github.com/ojowwalker77/channels/pull/458))
- **GitHub repos: connecting one takes the owner's push access, checked once with their linked token (T691)** ([#454](https://github.com/ojowwalker77/channels/pull/454))
- **kiwi who and status answer from the daemon's presence instead of probing the relay every time (T771)** ([#460](https://github.com/ojowwalker77/channels/pull/460))
- **wake.log rotates at 1 MB and the daemon prunes week-old hook bookkeeping (T774)** ([#463](https://github.com/ojowwalker77/channels/pull/463))
- **kiwi log and kiwi tasks read what this computer already has when the relay is down, and say so (T772)** ([#461](https://github.com/ojowwalker77/channels/pull/461))
- **Web bundle: mermaid's ELK layout left out (−1.4MB); perf-scale measures Details (T828, T588)** ([#462](https://github.com/ojowwalker77/channels/pull/462))
- **The config lock takes over only a lock whose holder is gone, and never removes a lock it no longer owns (T773)** ([#464](https://github.com/ojowwalker77/channels/pull/464))
- **An idle Claude session's listener lasts a week, not a day, so the empty "nothing to do" turn comes weekly (T775)** ([#465](https://github.com/ojowwalker77/channels/pull/465))
- **CI gates for the 0.20 budgets: perf / scale on UI PRs, a nightly soak, and a Mac dmg, zip and app size gate (T1170)** ([#459](https://github.com/ojowwalker77/channels/pull/459))
- **Relay and daemon failures say what failed, where, and what to do next (T778)** ([#466](https://github.com/ojowwalker77/channels/pull/466))
- **An agent's message cache keeps a local fold base and its newest 300 messages, instead of growing for ever (T1545)** ([#468](https://github.com/ojowwalker77/channels/pull/468))
- **Long sessions: the message array folds into the base past the window, warm cache LRU of 4, markdown cache 500, mermaid drops its probe, places-seen keeps 500 (T825)** ([#467](https://github.com/ojowwalker77/channels/pull/467))
- **Key files survive a crash: writes are fsynced, machine.json and kiwi-store.bin keep a backup, and a broken machine.json is never replaced by a new key (T716)** ([#469](https://github.com/ojowwalker77/channels/pull/469))

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

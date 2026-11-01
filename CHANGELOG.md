# Changelog

Written by `bun scripts/changelog.ts` from each squash-merged pull request's title.

## 2026.10.16 — 2026-11-01

- **Private-room edit test: check for the edit's phrase, not "125" (T1246)** ([#1409](https://github.com/kiwi-init/channels/pull/1409))
- **A DM between two people has its own key, sealed to every device of both (T1149)** ([#1407](https://github.com/kiwi-init/channels/pull/1407))
- **Task panel and tabs: self-review copy, Now card label, Needs you tab colour, PR check words (#1411)** ([#1412](https://github.com/kiwi-init/channels/pull/1412))
- **A client that hasn't synced a private room seals its message or refuses it, never sends it plain (T1234)** ([#1415](https://github.com/kiwi-init/channels/pull/1415))
- **Fonts: machine words in mono, section heads in mono, people's names in the text font (#1416)** ([#1417](https://github.com/kiwi-init/channels/pull/1417))
- **Desktop polish: panel footers, theme names, message header dots, banner width, home cards (#1418)** ([#1419](https://github.com/kiwi-init/channels/pull/1419))
- **Narrow windows: tabs, tables and code, device rows, segmented controls, panel edge (#1413)** ([#1414](https://github.com/kiwi-init/channels/pull/1414))
- **Failed message band, status fonts and four copy fixes (#1420)** ([#1421](https://github.com/kiwi-init/channels/pull/1421))
- **Notification controls: mute channels and rooms, pause, quiet hours, and a sound for mentions (T972)** ([#1423](https://github.com/kiwi-init/channels/pull/1423))
- **A removed key can't speak after its removal: the owner logs member.gone, and fold refuses what it signs later (T1106)** ([#1422](https://github.com/kiwi-init/channels/pull/1422))

## 2026.10.15 — 2026-10-31

- **Status indicators stop animating forever: an idle app draws nothing (T704, #1379)** ([#1382](https://github.com/kiwi-init/channels/pull/1382))
- **GIFs: the app shows only what the relay serves, and never attaches a page (T778)** ([#1383](https://github.com/kiwi-init/channels/pull/1383))
- **Core: private rooms, with their own key, sealed to who's in them (T681)** ([#1384](https://github.com/kiwi-init/channels/pull/1384))
- **Needs you: a decision put to someone else says so (T809)** ([#1385](https://github.com/kiwi-init/channels/pull/1385))
- **Private rooms in the app: pick who's in when making a room, change it later, and see which rooms are private (T681)** ([#1386](https://github.com/kiwi-init/channels/pull/1386))
- **Private rooms: leaving the channel takes you out of its rooms, and agents know which rooms are private (T681)** ([#1387](https://github.com/kiwi-init/channels/pull/1387))
- **Settings: a normal wheel scrolls the tabs sideways when the window is narrow, and the cut edge fades (T849)** ([#1388](https://github.com/kiwi-init/channels/pull/1388))
- **Private rooms: no 200-change cap on tracing a room's history (T868)** ([#1389](https://github.com/kiwi-init/channels/pull/1389))
- **Private rooms: the New room dialog says who can't open them yet (T869)** ([#1390](https://github.com/kiwi-init/channels/pull/1390))
- **Polling: seat and device timers pause while the app is hidden (T917) (#1380)** ([#1391](https://github.com/kiwi-init/channels/pull/1391))
- **No browser menu or developer tools in the shipped app (T1009)** ([#1394](https://github.com/kiwi-init/channels/pull/1394))
- **Direct messages say who can read them: the whole channel, not only the two of you (T945)** ([#1392](https://github.com/kiwi-init/channels/pull/1392))
- **Settings and notifications: four small fixes from the chat audit (T947)** ([#1393](https://github.com/kiwi-init/channels/pull/1393))
- **Composer: drafts, images and failed sends stay in their room, and an image sends without a file name (T946)** ([#1396](https://github.com/kiwi-init/channels/pull/1396))
- **Faces: a GitHub photo served as PNG still goes out, at 48px or 32px** ([#1399](https://github.com/kiwi-init/channels/pull/1399))
- **Private rooms open on every device of a person, not one seat per name (T1046)** ([#1395](https://github.com/kiwi-init/channels/pull/1395))
- **Appearance: pick a font (Inter, Lato, Atkinson) and bigger text sizes (#1397)** ([#1398](https://github.com/kiwi-init/channels/pull/1398))
- **Desktop: build on Livewire 2026.10.2, with no web inspector in shipped apps (T928, T1009)** ([#1402](https://github.com/kiwi-init/channels/pull/1402))
- **A DM is between two people, whichever of their devices they write from (T966)** ([#1401](https://github.com/kiwi-init/channels/pull/1401))
- **Agents wear a role face, with their harness as a badge in the corner (T904)** ([#1404](https://github.com/kiwi-init/channels/pull/1404))
- **Phones: no false text, no room leak into #general, and no getting stuck (T948)** ([#1405](https://github.com/kiwi-init/channels/pull/1405))
- **Edit and delete your own messages (T971)** ([#1403](https://github.com/kiwi-init/channels/pull/1403))
- **The UI hides what the installed app can't run (T1122)** ([#1400](https://github.com/kiwi-init/channels/pull/1400))
- **Message toolbar: the GIF button fits its mark (T1237)** ([#1408](https://github.com/kiwi-init/channels/pull/1408))

## 2026.10.14 — 2026-10-31

- **Search: a click on a result opens it; the results no longer move the window (#1354)** ([#1358](https://github.com/kiwi-init/channels/pull/1358))
- **Notifications: say where the message is, show plain text, and open the message from View (#1351)** ([#1360](https://github.com/kiwi-init/channels/pull/1360))
- **Composer: a slash lists commands again, and /compact asks the lead for a summary (T429)** ([#1364](https://github.com/kiwi-init/channels/pull/1364))
- **Brief: a message from a room is answered in that room (T460)** ([#1366](https://github.com/kiwi-init/channels/pull/1366))
- **Agents the app started open in your own terminal, with the command to copy (T428)** ([#1365](https://github.com/kiwi-init/channels/pull/1365))
- **A person may manage agents: their role, the lead and their personality (T443)** ([#1367](https://github.com/kiwi-init/channels/pull/1367))
- **Composer: a picked mention shows the nickname, even when it's shared (T509)** ([#1368](https://github.com/kiwi-init/channels/pull/1368))
- **Invite: a Full trust switch gives a new person every power at once (T471)** ([#1369](https://github.com/kiwi-init/channels/pull/1369))
- **Rail: channels group into folders, Discord-style (T496)** ([#1370](https://github.com/kiwi-init/channels/pull/1370))
- **Profile: Full trust on a person who's already in, not only at join (T547)** ([#1371](https://github.com/kiwi-init/channels/pull/1371))
- **Brief: a person the owner fully trusts directs agents, like their human and the owner (T548)** ([#1372](https://github.com/kiwi-init/channels/pull/1372))
- **Presence: a person's app says it's here, so people show online to each other (T560)** ([#1373](https://github.com/kiwi-init/channels/pull/1373))
- **Faces: your GitHub picture is published once GitHub is linked, not only when the channel opens** ([#1374](https://github.com/kiwi-init/channels/pull/1374))
- **Hosted relay: no limits on channels, members, messages, or how long a channel lives (T604)** ([#1375](https://github.com/kiwi-init/channels/pull/1375))
- **GIFs are back: a picker in the composer, GIF reactions under messages, kiwi react --list (T585)** ([#1376](https://github.com/kiwi-init/channels/pull/1376))
- **A person the owner fully trusts sets up the channel: repos, rooms, charter, branch prefix (T632)** ([#1377](https://github.com/kiwi-init/channels/pull/1377))
- **Main green: the brief drops the GIF line, and the composer's GIF button leaves the first load (T654)** ([#1378](https://github.com/kiwi-init/channels/pull/1378))

## 2026.10.13 — 2026-10-30

- **Phones: an @handle in a message reads as the member's nickname, as on desktop (#1251)** ([#1291](https://github.com/kiwi-init/channels/pull/1291))
- **Terminal: shells and agents open in their folder after an update deletes tmux's (T12)** ([#1313](https://github.com/kiwi-init/channels/pull/1313))
- **Daemon: the socket answers only a caller holding its token, and gates bypass launches and re-pairing** ([#1312](https://github.com/kiwi-init/channels/pull/1312))
- **Add agent: a launch that dies at start says so, every launch is logged, and the panel follows the real join (T17)** ([#1314](https://github.com/kiwi-init/channels/pull/1314))
- **Launch: a dead pane counts as ended only once tmux has its exit status, so a busy computer doesn't read exit 1 as exit 0 (T17)** ([#1318](https://github.com/kiwi-init/channels/pull/1318))
- **Terminal: no blinking bar down its left edge (T21)** ([#1317](https://github.com/kiwi-init/channels/pull/1317))
- **Terminals: the tmux helpers are back, and the daemon no longer takes them away on start (T14)** ([#1319](https://github.com/kiwi-init/channels/pull/1319))
- **ui: the renderer links only what a click opens, and shows a remote picture as a link (#1308)** ([#1316](https://github.com/kiwi-init/channels/pull/1316))
- **Core: a wrapped key nobody signed never opens, whatever the channel's age** ([#1321](https://github.com/kiwi-init/channels/pull/1321))
- **Updates: the installer and kiwi upgrade install only a release the pinned minisign key signed** ([#1315](https://github.com/kiwi-init/channels/pull/1315))
- **UI: one design system, motion that answers you, Settings gets one home** ([#1320](https://github.com/kiwi-init/channels/pull/1320))
- **Login: a computer checks its person's key with the person, and refuses another person until kiwi unpair (#1304)** ([#1322](https://github.com/kiwi-init/channels/pull/1322))
- **Relay: a room request is signature-checked before its room is opened, and the launch limits are on** ([#1325](https://github.com/kiwi-init/channels/pull/1325))
- **Seats: a second Gemini CLI in a checkout is its own agent, held by its own process (T102)** ([#1327](https://github.com/kiwi-init/channels/pull/1327))
- **Add agent: a harness that counts every start getting all the way in, and concurrent first starts no longer collide in tmux (T19)** ([#1324](https://github.com/kiwi-init/channels/pull/1324))
- **Enrollment: a new desktop or phone checks its person's key with the person, and keeps nothing until then (#1323)** ([#1326](https://github.com/kiwi-init/channels/pull/1326))
- **Daemon: another device starts agents only where seats work and in folders added by hand, not in every home git repo (#1303)** ([#1328](https://github.com/kiwi-init/channels/pull/1328))
- **Test: the old-relay stand-in refuses a socket its relay refuses, so the client falls back to the old signature (#1329)** ([#1330](https://github.com/kiwi-init/channels/pull/1330))
- **Secrets: the plain-browser key store is a development build's tool, and a page's URL steers nothing in production** ([#1332](https://github.com/kiwi-init/channels/pull/1332))
- **Seats: an agent Channels started is told apart by its launch, whatever runs it (T101)** ([#1331](https://github.com/kiwi-init/channels/pull/1331))
- **Android: the release build signs with the repo's own keystore, or not at all** ([#1339](https://github.com/kiwi-init/channels/pull/1339))
- **Core: the grindable verification code is gone (#1306)** ([#1333](https://github.com/kiwi-init/channels/pull/1333))
- **Docs: the relay sees the owner's GitHub link token; SECURITY.md says so (#1310)** ([#1336](https://github.com/kiwi-init/channels/pull/1336))
- **Repo: dependency install scripts run only for trusted packages, and the ignore list covers worktrees and SQLite sidecars (#1309)** ([#1337](https://github.com/kiwi-init/channels/pull/1337))
- **Core: presence opens only under the channel's current key (#1301)** ([#1338](https://github.com/kiwi-init/channels/pull/1338))
- **Core: a github note's link is a plain https link, or the note is dropped (#1299)** ([#1334](https://github.com/kiwi-init/channels/pull/1334))
- **Core: a join line's relay is https, or plain http on this computer (#1305)** ([#1335](https://github.com/kiwi-init/channels/pull/1335))
- **Invite line: an agent gets in from any shell, even before kiwi is on its PATH or on that computer at all (T172)** ([#1343](https://github.com/kiwi-init/channels/pull/1343))
- **Relay: creating a channel takes a GitHub sign-in through the relay's GitHub App, beside WorkOS (T169)** ([#1342](https://github.com/kiwi-init/channels/pull/1342))
- **Top bar: opening search leaves the tabs where they are (T191)** ([#1348](https://github.com/kiwi-init/channels/pull/1348))
- **Rail: a Home tile on top opens the first screen, and the channel tiles sit under it (T196)** ([#1347](https://github.com/kiwi-init/channels/pull/1347))
- **Add agent and Welcome say what Channels is: invite an agent you already run, or have Channels start one (T173)** ([#1346](https://github.com/kiwi-init/channels/pull/1346))
- **First run: Sign in with GitHub comes first, and it is also the GitHub link (T171)** ([#1349](https://github.com/kiwi-init/channels/pull/1349))
- **CI: the smoke and perf harnesses drive a harness build with the plain-browser key store (#1344)** ([#1345](https://github.com/kiwi-init/channels/pull/1345))
- **Phones: sign in with GitHub, the same device flow as the desktop (T254)** ([#1350](https://github.com/kiwi-init/channels/pull/1350))
- **Android build: an empty keystore secret counts as unset (T312)** ([#1353](https://github.com/kiwi-init/channels/pull/1353))
- **UI: the first load is back under its budget, with 7 KB of room (T316)** ([#1355](https://github.com/kiwi-init/channels/pull/1355))
- **Relay: a WorkOS account moves to its github_<id> once, signed in with both (T261)** ([#1356](https://github.com/kiwi-init/channels/pull/1356))
- **Top bar: its buttons float like a Mac toolbar's, not baked into the bar (T294)** ([#1352](https://github.com/kiwi-init/channels/pull/1352))
- **Portrait screens: one tall page with agents, tasks and chat in view together (T128)** ([#1341](https://github.com/kiwi-init/channels/pull/1341))
- **Desktop: a computer holding both sign-ins moves the account to GitHub by itself, once (T261)** ([#1357](https://github.com/kiwi-init/channels/pull/1357))
- **Rail, composer and terminal: the rest of the chrome floats (T367)** ([#1359](https://github.com/kiwi-init/channels/pull/1359))
- **Top bar: the sidebar button stays in one place, open or collapsed (T392)** ([#1361](https://github.com/kiwi-init/channels/pull/1361))

## 2026.10.12 — 2026-10-30

- **Channel: web/src/lib/channel moves into packages/channel (T494)** ([#1245](https://github.com/kiwi-init/channels/pull/1245))
- **Feed: fold runs of events into one line (T620)** ([#1250](https://github.com/kiwi-init/channels/pull/1250))
- **Markdown: mermaid diagrams render again (T635)** ([#1252](https://github.com/kiwi-init/channels/pull/1252))
- **Messages: rows say what they are, with receipts and quotes (T641)** ([#1253](https://github.com/kiwi-init/channels/pull/1253))
- **App: web/src/lib's last shared helpers move into packages/app (T650)** ([#1254](https://github.com/kiwi-init/channels/pull/1254))
- **ui: receipts.ts takes roomOfMessage from @kiwi/app (T716)** ([#1258](https://github.com/kiwi-init/channels/pull/1258))
- **Feed: compaction shows as a fold, with an Approve card (T663)** ([#1255](https://github.com/kiwi-init/channels/pull/1255))
- **Retire web/: scripts, tests and CI build, smoke and shoot ui/ (T716)** ([#1259](https://github.com/kiwi-init/channels/pull/1259))
- **Add new screenshot and demo explanation to README** ([#1260](https://github.com/kiwi-init/channels/pull/1260))
- **Terminal: Your terminal opens a shell, not a tmux error (T701)** ([#1256](https://github.com/kiwi-init/channels/pull/1256))
- **Devices: the owner can delegate admitting its own computer's agents (T677)** ([#1257](https://github.com/kiwi-init/channels/pull/1257))
- **perf: perf-feel, perf-scale, perf-switch and perf-motion drive ui/ (T756)** ([#1263](https://github.com/kiwi-init/channels/pull/1263))
- **CI: eb-env-check cleanup tolerates an exited process (T761)** ([#1262](https://github.com/kiwi-init/channels/pull/1262))
- **Composer: clicking a stash brings it back in WebKit (T788)** ([#1264](https://github.com/kiwi-init/channels/pull/1264))
- **Retire web/: delete it (T766)** ([#1261](https://github.com/kiwi-init/channels/pull/1261))
- **Recovery: 24 words, the recovery chain and the vault format in core (T693)** ([#1267](https://github.com/kiwi-init/channels/pull/1267))
- **DESIGN.md describes ui/, not web/ (T780)** ([#1268](https://github.com/kiwi-init/channels/pull/1268))
- **ui: the first load drops from 952 KB to 739 KB, budget 760 KB (T814)** ([#1266](https://github.com/kiwi-init/channels/pull/1266))
- **Devices: the daemon lets its own computer's agents in (T683)** ([#1265](https://github.com/kiwi-init/channels/pull/1265))
- **Recovery: the relay keeps the recovery chain and vault versions (T823)** ([#1269](https://github.com/kiwi-init/channels/pull/1269))
- **Icons: the app draws Hugeicons, and more of them (T524)** ([#1249](https://github.com/kiwi-init/channels/pull/1249))
- **Loop: a messages session reads only what's for it and replies only where it's asked (#1270)** ([#1271](https://github.com/kiwi-init/channels/pull/1271))
- **Sessions: new agents open only in Channels' own tmux; Terminal.app, Prefer and the tmux helpers go (T374)** ([#1248](https://github.com/kiwi-init/channels/pull/1248))
- **Loop: a seat hold records its loop's process, and lapses when that process is gone (#1272)** ([#1273](https://github.com/kiwi-init/channels/pull/1273))
- **Devices: computers trust your device list, not only the person key (T826)** ([#1277](https://github.com/kiwi-init/channels/pull/1277))
- **Devices: the owner's app issues, renews and revokes delegations (T684)** ([#1275](https://github.com/kiwi-init/channels/pull/1275))
- **desktop / mac: the size check's dmg is tried again when hdiutil flakes (T928)** ([#1279](https://github.com/kiwi-init/channels/pull/1279))
- **Devices: the desktop signs with its device key (T898)** ([#1280](https://github.com/kiwi-init/channels/pull/1280))
- **Test: the remote-launch flow logs each tmux call to its own file (T948)** ([#1281](https://github.com/kiwi-init/channels/pull/1281))
- **Linux: the AppImage keeps its own desktop entry, and its menu start needs no FUSE (#1284, #1283)** ([#1285](https://github.com/kiwi-init/channels/pull/1285))
- **Loop: a reviewer's loop takes a round open to anyone, naming itself first (#1244)** ([#1289](https://github.com/kiwi-init/channels/pull/1289))
- **Linux: the Needs-you chime plays through WebAudio, so a missing GStreamer sink no longer crashes the window (#1278)** ([#1290](https://github.com/kiwi-init/channels/pull/1290))
- **Daemons: an older daemon gives way to the app's copy when the CLI can't be kept (T1032)** ([#1293](https://github.com/kiwi-init/channels/pull/1293))

## 2026.10.11 — 2026-10-29

- **Loop: the terminal's mode comes back after each session, so Ctrl-C stops the loop again (#1174)** ([#1207](https://github.com/kiwi-init/channels/pull/1207))
- **Listen: --now says when the seat's own `kiwi listen` already took its messages (#1170)** ([#1208](https://github.com/kiwi-init/channels/pull/1208))
- **Settings: Link a phone shows the QR again, with the code wrapped under it (T11)** ([#1209](https://github.com/kiwi-init/channels/pull/1209))
- **Themes: OLED Black, a true black, is the default dark (T43)** ([#1211](https://github.com/kiwi-init/channels/pull/1211))
- **Profile: the colour picker goes (T64)** ([#1212](https://github.com/kiwi-init/channels/pull/1212))
- **Settings: Link a phone and Add a computer are sign-in plus 6 digits, no QR** ([#1217](https://github.com/kiwi-init/channels/pull/1217))
- **Linking: kiwi login replaces kiwi pair, and the kl1 link code is gone (T112)** ([#1219](https://github.com/kiwi-init/channels/pull/1219))
- **CI: android / build gets 45 minutes, its screen tests alone take 18-27** ([#1220](https://github.com/kiwi-init/channels/pull/1220))
- **Test: the hook listener is armed before the `kiwi listen` beside it starts** ([#1222](https://github.com/kiwi-init/channels/pull/1222))
- **Android: screen shots run under a Compose test rule, so the sign-in spinners don't stall them** ([#1224](https://github.com/kiwi-init/channels/pull/1224))
- **Fold: a base records the fold rules it was folded under, and one from older rules is folded again (#1116)** ([#1213](https://github.com/kiwi-init/channels/pull/1213))
- **Phones: sign-in only; Scan the code, Paste the code and kiwi://link are gone (T111)** ([#1218](https://github.com/kiwi-init/channels/pull/1218))
- **Markdown: tables sort, long inline code copies, wide code fades (T216)** ([#1229](https://github.com/kiwi-init/channels/pull/1229))
- **Secrets: the person's keys at rest move out of web/ into packages/secrets (T212)** ([#1226](https://github.com/kiwi-init/channels/pull/1226))
- **Images: every image fits the relay at full resolution, never refused (T162)** ([#1221](https://github.com/kiwi-init/channels/pull/1221))
- **Feed: browser handoffs show again, with Open browser, Done and Couldn't (T197)** ([#1223](https://github.com/kiwi-init/channels/pull/1223))
- **Phones: the sign-in mark and Android's icon are the app's mark, not the old starburst (T12)** ([#1214](https://github.com/kiwi-init/channels/pull/1214))
- **Phones: Sign In opens or says why, and WorkOS goes through the app (T13)** ([#1210](https://github.com/kiwi-init/channels/pull/1210))
- **Tasks: a done digest for a task the fold doesn't have done is refused and marked (#1227)** ([#1228](https://github.com/kiwi-init/channels/pull/1228))
- **Feed: forged and refused messages are shown, not dropped (T204)** ([#1225](https://github.com/kiwi-init/channels/pull/1225))
- **Composer: Cmd/Ctrl+S stashes the draft, Shift+Cmd+S brings it back (T263)** ([#1231](https://github.com/kiwi-init/channels/pull/1231))
- **Channel: the pure channel helpers move out of web/ into packages/channel (T396)** ([#1233](https://github.com/kiwi-init/channels/pull/1233))
- **Terminal: a terminal icon in the channel header opens your own shell (T373)** ([#1232](https://github.com/kiwi-init/channels/pull/1232))
- **Settings: Link a phone says why it can't see the phone (T436)** ([#1235](https://github.com/kiwi-init/channels/pull/1235))
- **Sessions: tmux ships inside the app, and the daemon uses that copy first (T360)** ([#1234](https://github.com/kiwi-init/channels/pull/1234))
- **Sign-in: the session ends when its access token does (T535)** ([#1238](https://github.com/kiwi-init/channels/pull/1238))
- **Devices: the owner's own phone joins channels the app made (T552)** ([#1239](https://github.com/kiwi-init/channels/pull/1239))
- **Chat: the markdown hint under the composer goes, Jump to latest clicks everywhere (T525)** ([#1240](https://github.com/kiwi-init/channels/pull/1240))
- **Add agent: lists the agents found on the computer, and how to get the rest (T375)** ([#1237](https://github.com/kiwi-init/channels/pull/1237))
- **Sidebar: Settings is a gear, updates and asks are cards (T522)** ([#1241](https://github.com/kiwi-init/channels/pull/1241))
- **Phones: signing in again replaces the stuck request (T345)** ([#1242](https://github.com/kiwi-init/channels/pull/1242))
- **Channel: the store's own modules move out of web/ into packages/channel (T488)** ([#1236](https://github.com/kiwi-init/channels/pull/1236))
- **Phones: the sign-in is saved even when the phone locks (T347)** ([#1243](https://github.com/kiwi-init/channels/pull/1243))

## 2026.10.10 — 2026-10-29

- **Loop: a task marked first goes before its owner's other tasks (#1158)** ([#1163](https://github.com/kiwi-init/channels/pull/1163))
- **Loop: a task waiting behind a live session is said, then told to the lead (#1154)** ([#1165](https://github.com/kiwi-init/channels/pull/1165))
- **Hooks: ZCode gets a Stop hook that keeps its listener armed (#1155)** ([#1169](https://github.com/kiwi-init/channels/pull/1169))
- **Revise README structure and update images** ([#1182](https://github.com/kiwi-init/channels/pull/1182))
- **App: a sound when something needs you, silent everywhere else** ([#1183](https://github.com/kiwi-init/channels/pull/1183))
- **Loop: ZCode gets a recipe, so a ZCode seat runs a fresh session per task or round (#1157)** ([#1180](https://github.com/kiwi-init/channels/pull/1180))
- **Android: native markdown in messages (T693)** ([#1159](https://github.com/kiwi-init/channels/pull/1159))
- **People and Needs you: idle online, Wake only here, permission rights, new rooms (T650)** ([#1167](https://github.com/kiwi-init/channels/pull/1167))
- **Feed: line breaks, #123 links, remote images, a channel that's still opening (T616)** ([#1146](https://github.com/kiwi-init/channels/pull/1146))
- **App: error boundaries with Reload (T651)** ([#1173](https://github.com/kiwi-init/channels/pull/1173))
- **Needs you: permission detail, jump, joins, labels (T653)** ([#1188](https://github.com/kiwi-init/channels/pull/1188))
- **States: opening, closed, on hold and an empty channel (T655)** ([#1191](https://github.com/kiwi-init/channels/pull/1191))
- **iOS: native markdown in messages (T694)** ([#1175](https://github.com/kiwi-init/channels/pull/1175))
- **Notifications: focus, none, mentions, drawer dot (T654)** ([#1190](https://github.com/kiwi-init/channels/pull/1190))
- **Rooms: show other members' DMs read-only (T652)** ([#1178](https://github.com/kiwi-init/channels/pull/1178))
- **Shortcuts: ⌘\ hides the sidebar, palette Home/End and actions, Esc, focus (T656)** ([#1194](https://github.com/kiwi-init/channels/pull/1194))
- **Notifications: every channel you're in, and a click opens it (T657)** ([#1192](https://github.com/kiwi-init/channels/pull/1192))
- **Desktop: swap a UI that arrives while the window is closed (T1079)** ([#1195](https://github.com/kiwi-init/channels/pull/1195))
- **Feed: show what agents are doing (T603)** ([#1196](https://github.com/kiwi-init/channels/pull/1196))
- **Task page: cancel, reassign, reviewer, activity (T612)** ([#1197](https://github.com/kiwi-init/channels/pull/1197))
- **Overview: Now card, header line and agent lanes (T613)** ([#1199](https://github.com/kiwi-init/channels/pull/1199))
- **Board: tasks grouped by ask, with releases, live status and checks (T611)** ([#1200](https://github.com/kiwi-init/channels/pull/1200))
- **Feed images: load in view, retry, and say Loading or Retry (T604)** ([#1203](https://github.com/kiwi-init/channels/pull/1203))
- **Linked devices 1b: a person's devices join as them (T634)** ([#1160](https://github.com/kiwi-init/channels/pull/1160))
- **Tasks: task done reads its folders from the task's own branch, never another checkout (T713)** ([#1161](https://github.com/kiwi-init/channels/pull/1161))
- **Tasks: a task's folders come from its own commits, not everything since main (T760)** ([#1162](https://github.com/kiwi-init/channels/pull/1162))
- **Daemon: a private tmux server for hosted agents (T625)** ([#1164](https://github.com/kiwi-init/channels/pull/1164))
- **Linked devices 2: relay accounts and enrollment (T635)** ([#1168](https://github.com/kiwi-init/channels/pull/1168))
- **GitHub: link a repo under the name GitHub uses now (T791)** ([#1176](https://github.com/kiwi-init/channels/pull/1176))
- **Linked devices 3a: the desktop approves a new device (T636)** ([#1171](https://github.com/kiwi-init/channels/pull/1171))
- **Linked devices 3b: Settings lists your devices, forget and renew (T836)** ([#1172](https://github.com/kiwi-init/channels/pull/1172))
- **Linked devices 3c: enroll a desktop with no person key (T837)** ([#1177](https://github.com/kiwi-init/channels/pull/1177))
- **kiwi login: enroll this computer as one of your devices (T637)** ([#1179](https://github.com/kiwi-init/channels/pull/1179))
- **Hosted seats: Add agent and kiwi loop start in the daemon's tmux (T626)** ([#1181](https://github.com/kiwi-init/channels/pull/1181))
- **Android: sign in and enroll as one of your devices (T640)** ([#1184](https://github.com/kiwi-init/channels/pull/1184))
- **App: terminal drawer for hosted agents (T627)** ([#1185](https://github.com/kiwi-init/channels/pull/1185))
- **Wake by typing for hosted harnesses with no wake route (T628)** ([#1187](https://github.com/kiwi-init/channels/pull/1187))
- **Devices: cut revoked devices out of channels, and check claims against the newest list (T641)** ([#1189](https://github.com/kiwi-init/channels/pull/1189))
- **Linked devices 6b: desktop revoke, renew and wipe (T1006)** ([#1193](https://github.com/kiwi-init/channels/pull/1193))
- **iOS: sign in and enroll as one of your devices (T638)** ([#1186](https://github.com/kiwi-init/channels/pull/1186))
- **Linked devices 6c: the daemon takes renewals and revokes from channel logs (T1007)** ([#1201](https://github.com/kiwi-init/channels/pull/1201))
- **Linked devices 6c: phones take renewals and revokes from channel logs (T1007)** ([#1202](https://github.com/kiwi-init/channels/pull/1202))

## 2026.10.9 — 2026-10-28

- **Update: Download and restart downloads and restarts, instead of opening the release page (T351)** ([#1093](https://github.com/kiwi-init/channels/pull/1093))
- **Feed: members who left keep their avatar and profile (T369)** ([#1094](https://github.com/kiwi-init/channels/pull/1094))
- **Profile: nickname, colour and powers are back (T380, members)** ([#1099](https://github.com/kiwi-init/channels/pull/1099))
- **Settings: the Agents page saves its folders and new-agent switches (T380)** ([#1100](https://github.com/kiwi-init/channels/pull/1100))
- **Desktop: search lists results to jump to** ([#1096](https://github.com/kiwi-init/channels/pull/1096))
- **Add a refresh-dependencies project skill (#1097)** ([#1098](https://github.com/kiwi-init/channels/pull/1098))
- **Channel panel: History downloads save the file again (T380)** ([#1101](https://github.com/kiwi-init/channels/pull/1101))
- **Updates: one click on the dock button, no card (T398)** ([#1104](https://github.com/kiwi-init/channels/pull/1104))
- **Settings: make, edit and delete your own personalities (T380)** ([#1105](https://github.com/kiwi-init/channels/pull/1105))
- **Channel panel: choose the channel's image and rename rooms (T380)** ([#1102](https://github.com/kiwi-init/channels/pull/1102))
- **Settings: Check for updates says what it found, and the relay can be changed (T380)** ([#1107](https://github.com/kiwi-init/channels/pull/1107))
- **Channel panel: Write to GitHub and the branch prefix are back (T380)** ([#1103](https://github.com/kiwi-init/channels/pull/1103))
- **Settings and faces: the unencrypted-keys notice, and your GitHub picture as your face (T380)** ([#1109](https://github.com/kiwi-init/channels/pull/1109))
- **Settings: kiwi's status, harness versions, Hooks and Check this computer (T380)** ([#1108](https://github.com/kiwi-init/channels/pull/1108))
- **Channel panel: the channel's notes are back (T380)** ([#1106](https://github.com/kiwi-init/channels/pull/1106))
- **UI: drop two controls that only pretended (T429)** ([#1113](https://github.com/kiwi-init/channels/pull/1113))
- **Settings: where new agents open, and the 250k checkpoint ask (T380)** ([#1110](https://github.com/kiwi-init/channels/pull/1110))
- **Add agent: real folders and harnesses for the chosen computer, and Choose… opens the picker (T429)** ([#1114](https://github.com/kiwi-init/channels/pull/1114))
- **Composer: picking a person writes their nickname, sent as the handle (#1111)** ([#1112](https://github.com/kiwi-init/channels/pull/1112))
- **Tasks: who changes a reviewer no longer depends on who is still here (#1116)** ([#1121](https://github.com/kiwi-init/channels/pull/1121))
- **UI: Settings > Appearance > Text size changes the text (#1119)** ([#1124](https://github.com/kiwi-init/channels/pull/1124))
- **Deps: refresh npm, Android and GitHub Actions** ([#1125](https://github.com/kiwi-init/channels/pull/1125))
- **Agents: Show in Rex or tmux is back (T429)** ([#1115](https://github.com/kiwi-init/channels/pull/1115))
- **Add a repo offers your GitHub repos (T429)** ([#1130](https://github.com/kiwi-init/channels/pull/1130))
- **Settings: a paired computer's own settings, read only (T380)** ([#1129](https://github.com/kiwi-init/channels/pull/1129))
- **UI: selected message text shows its highlight in the desktop app** ([#1133](https://github.com/kiwi-init/channels/pull/1133))
- **Cards: a step shows why, who and the command, and answers Done or why not (T462)** ([#1135](https://github.com/kiwi-init/channels/pull/1135))
- **Asks: the asker can close its own ask once the answer came some other way (T466)** ([#1136](https://github.com/kiwi-init/channels/pull/1136))
- **Cards: the reply box says it answers the card, and the answer reads as a reply (T465)** ([#1137](https://github.com/kiwi-init/channels/pull/1137))
- **Loop: a session waiting for its verdict wakes only for what changes its work (#1117)** ([#1134](https://github.com/kiwi-init/channels/pull/1134))
- **AGENTS.md: merge with squash and auto-merge; main has no merge queue (#1131)** ([#1132](https://github.com/kiwi-init/channels/pull/1132))
- **Loop: a task gets a fresh session, and a long one can restart from its checkpoint (#1118)** ([#1138](https://github.com/kiwi-init/channels/pull/1138))
- **Approvals: a computer you forgot no longer lets its agents in on their own (T503)** ([#1139](https://github.com/kiwi-init/channels/pull/1139))
- **Docs: the linked-devices spec (T521)** ([#1141](https://github.com/kiwi-init/channels/pull/1141))
- **Devices: forget a phone from the desktop, and say what it holds (T508)** ([#1140](https://github.com/kiwi-init/channels/pull/1140))
- **Forgotten computers: unpaired at the relay, and the iOS app knows your computers (T526)** ([#1143](https://github.com/kiwi-init/channels/pull/1143))
- **Chat: copy a code block by pressing it (T590)** ([#1142](https://github.com/kiwi-init/channels/pull/1142))
- **Tasks: send back with its reason, credit the reviewer, anyone may review, cancelled (T614)** ([#1144](https://github.com/kiwi-init/channels/pull/1144))
- **Linked devices 1a: a person's signed device list (T634)** ([#1147](https://github.com/kiwi-init/channels/pull/1147))
- **Fold: whether a persona makes a member the lead follows the log (#1122)** ([#1145](https://github.com/kiwi-init/channels/pull/1145))
- **Harness: a ZCode seat is recognised, and told to keep a background listener** ([#1149](https://github.com/kiwi-init/channels/pull/1149))
- **App: every harness with a logo shows it, not a letter (#1150)** ([#1151](https://github.com/kiwi-init/channels/pull/1151))
- **Phones: a ZCode agent shows ZCode's mark (#1152)** ([#1153](https://github.com/kiwi-init/channels/pull/1153))

## 2026.10.8 — 2026-10-27

- **UI: resizable panels, nothing hidden under the composer** ([#1049](https://github.com/kiwi-init/channels/pull/1049))
- **UI: make channel settings findable** ([#1050](https://github.com/kiwi-init/channels/pull/1050))
- **Desktop: build on Livewire 2026.10.0** ([#1051](https://github.com/kiwi-init/channels/pull/1051))
- **Desktop: no dev-channel code in releases; name the first-run controls** ([#1054](https://github.com/kiwi-init/channels/pull/1054))
- **UI: still dashed rings for doing tasks and waiting steps (T27)** ([#1058](https://github.com/kiwi-init/channels/pull/1058))
- **UI: scroll the feed at 60fps (#1045)** ([#1055](https://github.com/kiwi-init/channels/pull/1055))
- **Main CI: dialogs say they're dialogs; Homebrew CLI tests get a runner's budget (T54)** ([#1060](https://github.com/kiwi-init/channels/pull/1060))
- **UI: let people in with the checks the web had (T18)** ([#1065](https://github.com/kiwi-init/channels/pull/1065))
- **Composer: no suggested messages when the chat is empty (T17)** ([#1057](https://github.com/kiwi-init/channels/pull/1057))
- **Composer: attach images by drag-drop, paste or + (T15)** ([#1059](https://github.com/kiwi-init/channels/pull/1059))
- **Composer: # opens a task picker matched by title (T73)** ([#1068](https://github.com/kiwi-init/channels/pull/1068))
- **Type-check with tsrs; drop typescript** ([#1066](https://github.com/kiwi-init/channels/pull/1066))
- **A done task lists its own PRs (T101)** ([#1070](https://github.com/kiwi-init/channels/pull/1070))
- **UI: the add-agent command can pin a personality (T20)** ([#1067](https://github.com/kiwi-init/channels/pull/1067))
- **UI: people read nicknames, never handles** ([#1053](https://github.com/kiwi-init/channels/pull/1053))
- **UI publish: on every merge that changes the UI, no request file (T124)** ([#1074](https://github.com/kiwi-init/channels/pull/1074))
- **Linux: window controls on floating desktops (T54)** ([#1073](https://github.com/kiwi-init/channels/pull/1073))
- **Desktop smoke: links through the bridge, a Dock badge check that doesn't race (T54)** ([#1069](https://github.com/kiwi-init/channels/pull/1069))
- **Joining: invite step, waiting states, errors that say why (T41)** ([#1071](https://github.com/kiwi-init/channels/pull/1071))
- **App: search lists results to jump to, ranked with BM25** ([#1064](https://github.com/kiwi-init/channels/pull/1064))
- **Remove kiwi sh and just-bash; keep query as kiwi query (#1072)** ([#1075](https://github.com/kiwi-init/channels/pull/1075))
- **Tray: the mark as three filled slabs, legible at 16 and 22 px (#1012)** ([#1076](https://github.com/kiwi-init/channels/pull/1076))
- **UI: readable text selection (T163)** ([#1079](https://github.com/kiwi-init/channels/pull/1079))
- **UI: mark up images in the viewer again (T169)** ([#1080](https://github.com/kiwi-init/channels/pull/1080))
- **Tasks: the done line leaves out the assign note (T150)** ([#1081](https://github.com/kiwi-init/channels/pull/1081))
- **UI: keep every feed frame inside the 120 fps budget (T38)** ([#1077](https://github.com/kiwi-init/channels/pull/1077))
- **App smoke: read the join code from the relay's invite link** ([#1083](https://github.com/kiwi-init/channels/pull/1083))
- **Desktop: build on Livewire 2026.10.1 (T88, T129)** ([#1082](https://github.com/kiwi-init/channels/pull/1082))
- **Wayland check: say why the two copy checks are gaps (T152)** ([#1084](https://github.com/kiwi-init/channels/pull/1084))
- **Desktop: an opaque window for the new UI (#1045)** ([#1056](https://github.com/kiwi-init/channels/pull/1056))
- **UI: lists in messages show their bullets and numbers again (T258)** ([#1087](https://github.com/kiwi-init/channels/pull/1087))
- **Needs you: asks that hold nothing up get a quiet group instead of vanishing (T269)** ([#1088](https://github.com/kiwi-init/channels/pull/1088))
- **Mentions: a mention shows its @handle on hover; kiwi help says to write @handle (T290)** ([#1091](https://github.com/kiwi-init/channels/pull/1091))
- **Tasks: a refused review change sends nothing and says why (T270)** ([#1089](https://github.com/kiwi-init/channels/pull/1089))
- **CLI: kiwi show N --raw prints the body exactly as sent (T289)** ([#1090](https://github.com/kiwi-init/channels/pull/1090))
- **Feed: never drop rows where it would clamp the scroll (T222)** ([#1085](https://github.com/kiwi-init/channels/pull/1085))
- **Main CI: shots find the search box again; Linux's tray needs no AppIndicator (T315)** ([#1092](https://github.com/kiwi-init/channels/pull/1092))

## 2026.10.7 — 2026-10-27

- **Deps: refresh JavaScript, Android, and Electrobun** ([#1016](https://github.com/kiwi-init/channels/pull/1016))
- **CI: disable the iOS gestures gate** ([#1018](https://github.com/kiwi-init/channels/pull/1018))
- **CI: run browser screenshots concurrently** ([#1021](https://github.com/kiwi-init/channels/pull/1021))
- **Grok: log Stop skips and recover missing task metadata** ([#1022](https://github.com/kiwi-init/channels/pull/1022))
- **App: find tasks by number or title** ([#1023](https://github.com/kiwi-init/channels/pull/1023))
- **Tasks: carry review round summaries** ([#1024](https://github.com/kiwi-init/channels/pull/1024))
- **Tasks: keep any-reviewer work out of Needs you** ([#1025](https://github.com/kiwi-init/channels/pull/1025))
- **Desktop: restore composer spell checking** ([#1026](https://github.com/kiwi-init/channels/pull/1026))
- **Desktop: open message links externally** ([#1027](https://github.com/kiwi-init/channels/pull/1027))
- **Desktop: request client decorations on Wayland** ([#1028](https://github.com/kiwi-init/channels/pull/1028))
- **App: shorten the Now card's scroll fade** ([#1030](https://github.com/kiwi-init/channels/pull/1030))
- **Cards: add actionable steps for people** ([#1035](https://github.com/kiwi-init/channels/pull/1035))
- **Tasks: let leads reassign reviewers** ([#1037](https://github.com/kiwi-init/channels/pull/1037))
- **App: pilot a signals ChannelStore behind useChannel** ([#1036](https://github.com/kiwi-init/channels/pull/1036))
- **Desktop: use the Channels mark in the tray** ([#1038](https://github.com/kiwi-init/channels/pull/1038))
- **Tasks: open the review when the named reviewer leaves** ([#1040](https://github.com/kiwi-init/channels/pull/1040))
- **Names: show a bare handle as its nickname and note it on send** ([#1041](https://github.com/kiwi-init/channels/pull/1041))
- **Channels Livewire with the new desktop UI** ([#1042](https://github.com/kiwi-init/channels/pull/1042))
- **Livewire ships from main** ([#1044](https://github.com/kiwi-init/channels/pull/1044))
- **Brief: tell agents to name members by @handle** ([#1043](https://github.com/kiwi-init/channels/pull/1043))
- **One Channels: the Livewire build is stable Channels** ([#1046](https://github.com/kiwi-init/channels/pull/1046))
- **Brief: tell agents to name members by @handle** ([#1043](https://github.com/kiwi-init/channels/pull/1043))
- **One Channels: the Livewire build is stable Channels** ([#1046](https://github.com/kiwi-init/channels/pull/1046))

## 2026.10.6 — 2026-10-26

- **Remove jev-ci: CI picks its jobs with plain rules instead of a model** ([#997](https://github.com/kiwi-init/channels/pull/997))
- **Another channel's Details gear shows only on hover, so build / shots finds one** ([#998](https://github.com/kiwi-init/channels/pull/998))
- **The scrims under the header and over the composer no longer blur the text: they only fade it, on every platform** ([#1000](https://github.com/kiwi-init/channels/pull/1000))
- **Linux ships only the AppImage, tested on Arch: no .deb, no Fedora** ([#996](https://github.com/kiwi-init/channels/pull/996))
- **Linux looks like the Mac on every desktop: frost, wallpaper tints, Inter, no GTK title bar, Reduce transparency** ([#1006](https://github.com/kiwi-init/channels/pull/1006))

## 2026.10.5 — 2026-10-26

- **Add kiwi upgrade for standalone CLI installs** ([#984](https://github.com/kiwi-init/channels/pull/984))
- **The tasks board in the shell's look: cards, a quiet open row, solid fields, 26 pt actions (T75)** ([#972](https://github.com/kiwi-init/channels/pull/972))
- **Keep desktop update checks available after download failure** ([#987](https://github.com/kiwi-init/channels/pull/987))
- **On sway, Hyprland, river and niri, closing with no tray host hides the window, and a Linux window fills a half tile** ([#988](https://github.com/kiwi-init/channels/pull/988))
- **Settings, Personalities and onboarding in the shell's look, with one sidebar aware of where you are (T75)** ([#986](https://github.com/kiwi-init/channels/pull/986))
- **smoke-ui finds Settings' buttons in the sidebar** ([#989](https://github.com/kiwi-init/channels/pull/989))
- **Details in Settings' look: one column, compact boxes, no second Invite (T75)** ([#990](https://github.com/kiwi-init/channels/pull/990))
- **Linux: a cancelled or locked keyring says so with Ask again, and never leaves the keys unencrypted (T1566)** ([#992](https://github.com/kiwi-init/channels/pull/992))
- **The Agents tab in the board's look (T75)** ([#991](https://github.com/kiwi-init/channels/pull/991))
- **Channel secrets are removed: Kiwi can't keep a secret safe from an agent it hands one to** ([#994](https://github.com/kiwi-init/channels/pull/994))
- **Interlinked's shell: clear frost, a lifted page, wallpaper tints, channels as tab groups, a centred toolbar (T75)** ([#993](https://github.com/kiwi-init/channels/pull/993))

## 2026.10.4 — 2026-10-26

- **Channel secrets: each one sealed to the agents the owner names, and a send guard that keeps values out of messages (1/3)** ([#979](https://github.com/kiwi-init/channels/pull/979))
- **Channel secrets for agents: kiwi secret lists them, kiwi secret run puts them in a command's environment and redacts them from its output (2/3)** ([#980](https://github.com/kiwi-init/channels/pull/980))
- **Channel secrets in the app: the owner adds a secret and ticks which agents may use it (3/3)** ([#981](https://github.com/kiwi-init/channels/pull/981))

## 2026.10.3 — 2026-10-25

- **Tiling, scale and closing on wlroots, with screenshots (headless sway)** ([#975](https://github.com/kiwi-init/channels/pull/975))
- **On Linux, links open through xdg-open or gio directly, never Electrobun's opener (T990)** ([#976](https://github.com/kiwi-init/channels/pull/976))

## 2026.10.2 — 2026-10-25

- **One shell, and the page floats on it, as in Interlinked (T297)** ([#973](https://github.com/kiwi-init/channels/pull/973))

## 2026.10.1 — 2026-10-25

- **A reply refused while another agent answers says how to add to the thread instead, with the exact command (T1113)** ([#958](https://github.com/kiwi-init/channels/pull/958))
- **kiwi doctor names an old kiwi ahead of Homebrew's on PATH and how to remove it, keeping ~/.kiwi's keys (T1402)** ([#961](https://github.com/kiwi-init/channels/pull/961))
- **The update check runs by hand from main: the installed app updates itself, on Mac and Linux, from one release to the next (T1041)** ([#964](https://github.com/kiwi-init/channels/pull/964))
- **The app's text is the system font, and the tokens for Interlinked's look are in (T75)** ([#959](https://github.com/kiwi-init/channels/pull/959))
- **Flow and loop tests read the new status words: planned, status: done (T1530)** ([#967](https://github.com/kiwi-init/channels/pull/967))
- **desktop / distros: the AppImage on stock Fedora 44 and Arch, native Wayland, keys, tray, dark mode, notifications, update (T960)** ([#966](https://github.com/kiwi-init/channels/pull/966))
- **The phone header's tabs fit a 390px screen in any system font (T75)** ([#968](https://github.com/kiwi-init/channels/pull/968))
- **One sidebar for channels and their conversations, and the card's header a toolbar (T75)** ([#965](https://github.com/kiwi-init/channels/pull/965))
- **A keyring that doesn't answer in 2 s no longer keeps the window away: it opens saying it waits for the keyring (T1550)** ([#969](https://github.com/kiwi-init/channels/pull/969))
- **The Tasks icon opens Everything, and shoot-ui follows the toolbar (T75)** ([#971](https://github.com/kiwi-init/channels/pull/971))
- **A frosted sidebar on a Mac, solid with Reduce Transparency or Increase Contrast (T1385, T75)** ([#963](https://github.com/kiwi-init/channels/pull/963))

## 2026.10.0 — 2026-10-25

- **A task reads by its status: planned, working, needs you, done, shipped in its release (T1099)** ([#943](https://github.com/kiwi-init/channels/pull/943))
- **A task waiting on a person says Needs you, and the UI shots show Done and Shipped rows (T1258)** ([#944](https://github.com/kiwi-init/channels/pull/944))
- **Releases are dates, YYYY.M.PATCH, from 2026.10.0 on (T1232)** ([#945](https://github.com/kiwi-init/channels/pull/945))
- **The board heads a person's ask with a goal the lead names in plain words, their message under it as "from #956" (T1095)** ([#946](https://github.com/kiwi-init/channels/pull/946))
- **The board groups finished work by release: Next, then each release it shipped in (T1101)** ([#947](https://github.com/kiwi-init/channels/pull/947))
- **The Now card reads each task's status: a merged task is done today, one waiting on a person is marked (T1288)** ([#948](https://github.com/kiwi-init/channels/pull/948))
- **Each release bumps the Homebrew tap: the Channels cask and the kiwi formula get its version and sha256s (T1234)** ([#949](https://github.com/kiwi-init/channels/pull/949))
- **A new task's title is at most 60 characters, for people; the spec goes in its body (--body or --file spec.md) (T1103)** ([#950](https://github.com/kiwi-init/channels/pull/950))
- **The app's kiwi defers to Homebrew's: no copy in ~/.kiwi/bin, no PATH line, and hooks that survive brew upgrade (T1236)** ([#951](https://github.com/kiwi-init/channels/pull/951))
- **One way to take a task, and review rounds only when a task asks for them (T1107)** ([#953](https://github.com/kiwi-init/channels/pull/953))
- **A task outlives the agent who leaves: its open tasks are back on the board, "left by" it, and the lead is told (T1105)** ([#952](https://github.com/kiwi-init/channels/pull/952))
- **kiwi lock status lists the leases, and kiwi lock release is refused with how to let one go (T1109)** ([#955](https://github.com/kiwi-init/channels/pull/955))
- **kiwi finds the channel from any git worktree of the folder it joined in (T1115)** ([#956](https://github.com/kiwi-init/channels/pull/956))
- **The Linux app's pages run in WebKitGTK's bubblewrap sandbox: every context is sandboxed, Electrobun's persist:default one included (T1193)** ([#954](https://github.com/kiwi-init/channels/pull/954))
- **kiwi lock exits 3 while you're only in line, and --wait blocks until the lease is yours (T1111)** ([#957](https://github.com/kiwi-init/channels/pull/957))
- **The daemon test's "newer" daemon is newer than VERSION under any scheme, so the date version passes (T1472)** ([#962](https://github.com/kiwi-init/channels/pull/962))

## 0.27.7 — 2026-10-25

- **Linux: a missing library is named with the right install line for the distro, before the app tries to start (T1066)** ([#939](https://github.com/kiwi-init/channels/pull/939))
- **A task's checks follow its repo's own merge rules: the required checks decide red and green (T1097)** ([#940](https://github.com/kiwi-init/channels/pull/940))
- **The Linux app starts without libayatana-appindicator (stock Fedora and Arch), with no tray (T1065)** ([#938](https://github.com/kiwi-init/channels/pull/938))
- **A Now card at the top of the channel: what's next, what's being worked on, what needs you, what's done today (T1093)** ([#941](https://github.com/kiwi-init/channels/pull/941))

## 0.27.6 — 2026-10-24

- **Android: @mentions are offered on a new line, and completing one keeps the line break** ([#928](https://github.com/kiwi-init/channels/pull/928))
- **Linux: files dropped on the composer attach (T895)** ([#927](https://github.com/kiwi-init/channels/pull/927))
- **Linux: an image pasted from another app attaches: the composer asks main, which reads the clipboard only right after a real Ctrl+V (T896)** ([#926](https://github.com/kiwi-init/channels/pull/926))
- **desktop / linux's Wayland-only session runs at scale 2, and the app must draw at it (T840)** ([#930](https://github.com/kiwi-init/channels/pull/930))
- **Mac: ⌘Q quits, ⌘W closes, ⌘H hides, and the app menu says About, Hide and Quit Channels (T970)** ([#931](https://github.com/kiwi-init/channels/pull/931))
- **Mac: the window opens where it was left, at the size it was left (T972)** ([#933](https://github.com/kiwi-init/channels/pull/933))
- **Mac notifications show while Channels is in front, and clicking one shows the window (T973)** ([#932](https://github.com/kiwi-init/channels/pull/932))
- **Dock and taskbar badge: the app icon shows the news count the tab title shows (T971)** ([#934](https://github.com/kiwi-init/channels/pull/934))
- **The updater finds the latest release from github.com's redirect, not api.github.com (T985)** ([#935](https://github.com/kiwi-init/channels/pull/935))
- **Releases end green: the stamp lands as a PR before the tag, and bump-main passes on its empty patch (T1032)** ([#936](https://github.com/kiwi-init/channels/pull/936))

## 0.27.5 — 2026-10-24

- **Channels for Android: a native Kotlin and Compose app on the iPhone app's engine** ([#755](https://github.com/kiwi-init/channels/pull/755))
- **The Linux launcher test gives its first compile 30 s, not bun's 5 (T419)** ([#888](https://github.com/kiwi-init/channels/pull/888))
- **CI drops android / device, the emulator run of the Android app (T543)** ([#889](https://github.com/kiwi-init/channels/pull/889))
- **Android: a channel's row shows its latest message from anywhere in it, with where it was said, and the list sorts by it, as the iPhone does since #752** ([#890](https://github.com/kiwi-init/channels/pull/890))
- **Android: reviews waiting on you reach the phone, with Approve and Send back** ([#891](https://github.com/kiwi-init/channels/pull/891))
- **desktop / linux runs the app's smoke in a Wayland session, weston with XWayland and no Xvfb (T434)** ([#892](https://github.com/kiwi-init/channels/pull/892))
- **Android: opening the keyboard scrolls the conversation to the newest message** ([#894](https://github.com/kiwi-init/channels/pull/894))
- **Android: tapping a quote centres the quoted message** ([#895](https://github.com/kiwi-init/channels/pull/895))
- **Android: www addresses and email addresses become links** ([#896](https://github.com/kiwi-init/channels/pull/896))
- **Android: TalkBack reads who reacted, and which answer was chosen** ([#897](https://github.com/kiwi-init/channels/pull/897))
- **New key pairs ride out Linux WebKit's failing generateKey, and the shots' first run says what the page said (T517)** ([#898](https://github.com/kiwi-init/channels/pull/898))
- **android / build draws every Android screen, light and dark, and keeps the pictures** ([#899](https://github.com/kiwi-init/channels/pull/899))
- **Android: details' Needs you lists reviews, with Approve and Send back** ([#900](https://github.com/kiwi-init/channels/pull/900))
- **The phone's engine names each harness and says whether its computer takes bypass (T24's engine part)** ([#901](https://github.com/kiwi-init/channels/pull/901))
- **ios / gestures: a drag waits for a bubble to show before it measures, so a slow first render isn't a gesture failure (T568)** ([#902](https://github.com/kiwi-init/channels/pull/902))
- **iPhone: New Agent sheet, from the channel's details, with Face ID before Bypass (T24)** ([#862](https://github.com/kiwi-init/channels/pull/862))
- **Main's full CI run finishes again: a newer push waits instead of cancelling the run going (T324)** ([#903](https://github.com/kiwi-init/channels/pull/903))
- **Android: New agent, from a channel's details (T619)** ([#904](https://github.com/kiwi-init/channels/pull/904))
- **Android: New agent's harness list shows each harness's icon** ([#905](https://github.com/kiwi-init/channels/pull/905))
- **Electron leaves the repo: the Electrobun app is the only desktop app, Apple silicon and Linux (T580)** ([#906](https://github.com/kiwi-init/channels/pull/906))
- **Android: the keyboard no longer covers the answer and send-back fields in Details, or Start in New agent** ([#907](https://github.com/kiwi-init/channels/pull/907))
- **Android: search results scroll above the keyboard** ([#908](https://github.com/kiwi-init/channels/pull/908))
- **Android: the sample questions in the screenshots carry the engine's labels** ([#910](https://github.com/kiwi-init/channels/pull/910))
- **CI cleanup 1/4: perf runs leave CI; perf.yml starts by hand (T730)** ([#911](https://github.com/kiwi-init/channels/pull/911))
- **A launched Channels window can take focus on Wayland: the Linux launcher keeps DESKTOP_STARTUP_ID and passes Plasma's XDG_ACTIVATION_TOKEN on as it (T785)** ([#909](https://github.com/kiwi-init/channels/pull/909))
- **Channels on Linux follows the desktop's light or dark, live: GNOME's Dark style no longer leaves it light (T768)** ([#912](https://github.com/kiwi-init/channels/pull/912))
- **CI cleanup 2/4: the release rehearsal runs by hand from rehearsal.yml (T779)** ([#913](https://github.com/kiwi-init/channels/pull/913))
- **Android: back on the lock screen leaves the app instead of changing the screen behind it, and locking puts the keyboard away** ([#915](https://github.com/kiwi-init/channels/pull/915))
- **Closing Channels on Linux minimizes it where no tray host runs, instead of hiding a window nothing can bring back (T770)** ([#914](https://github.com/kiwi-init/channels/pull/914))
- **The Linux app opens natively on Wayland: Electrobun's native wrapper rebuilt from source with a patch (T523)** ([#918](https://github.com/kiwi-init/channels/pull/918))
- **CI cleanup 3/4: no timing shards; unit, flows and cli / macos run as one job each (T780)** ([#916](https://github.com/kiwi-init/channels/pull/916))
- **CI cleanup 4/4: CI-config-only tests out; AGENTS.md lists every ci.yml job (T781)** ([#920](https://github.com/kiwi-init/channels/pull/920))
- **The app menu's shortcuts work on Linux: Ctrl+= / Ctrl+- / Ctrl+0, Ctrl+R, Ctrl+Q, Ctrl+W and F11 (T769)** ([#917](https://github.com/kiwi-init/channels/pull/917))
- **Android: an answer from details that doesn't send keeps what you typed and says Couldn't send** ([#922](https://github.com/kiwi-init/channels/pull/922))
- **Channels' first window fits the screen on Linux and keeps a minimum size (T771)** ([#919](https://github.com/kiwi-init/channels/pull/919))
- **Linux notifications come from Channels over D-Bus, and clicking one opens the window (T772)** ([#921](https://github.com/kiwi-init/channels/pull/921))
- **The annotator's Copy image works: no fetch of a data: URL, which the CSP blocks (T889)** ([#923](https://github.com/kiwi-init/channels/pull/923))
- **Android: the jump button counts each new message, not each batch the engine sends** ([#924](https://github.com/kiwi-init/channels/pull/924))
- **The release's dmg is tried again when hdiutil fails on the macOS runner, and a failure says why (T886)** ([#925](https://github.com/kiwi-init/channels/pull/925))

## 0.27.4 — 2026-10-24

- **The iPhone engine lists your computers, launches on one, follows it and lets your own agents in (T23)** ([#859](https://github.com/kiwi-init/channels/pull/859))
- **Settings shows each harness's hooks on this computer, and installs, updates or removes them (T13)** ([#861](https://github.com/kiwi-init/channels/pull/861))
- **A fresh computer can start agents: its home folder's git repos and folders you add (T22)** ([#863](https://github.com/kiwi-init/channels/pull/863))
- **Grok and MiMoCode can be started from New agent and kiwi launch, with their own model, effort and permission flags (T12)** ([#865](https://github.com/kiwi-init/channels/pull/865))
- **New agent picks the model, effort, context and permissions for each harness, remembered per computer (T11)** ([#860](https://github.com/kiwi-init/channels/pull/860))
- **Per computer: allow bypass on launches from your other devices, off by default; launch options in remote.log (T25)** ([#867](https://github.com/kiwi-init/channels/pull/867))
- **People pick their colour in the app, and the owner sets anyone's, as kiwi color already says (T16)** ([#868](https://github.com/kiwi-init/channels/pull/868))
- **The UI smoke opens the conversation by its row, not the Conversations heading's first button (T281)** ([#869](https://github.com/kiwi-init/channels/pull/869))
- **The owner turns an agent's wake on or off from its menu in Details, for agents on this computer (T14)** ([#866](https://github.com/kiwi-init/channels/pull/866))
- **Settings → Computers: each paired computer's settings, read only (T18)** ([#870](https://github.com/kiwi-init/channels/pull/870))
- **Kimi Code can be started from New agent and kiwi launch: the daemon types its first prompt in once its screen is ready, in Rex or tmux (T222)** ([#871](https://github.com/kiwi-init/channels/pull/871))
- **Gemini CLI can be started from New agent and kiwi launch, with its model and approval mode (T339)** ([#874](https://github.com/kiwi-init/channels/pull/874))
- **A newer push to main cancels the older main run, and the cancelled run's ci-ok passes for it (T324)** ([#875](https://github.com/kiwi-init/channels/pull/875))
- **Settings: every harness on this computer, and a Check this computer panel from kiwi doctor (T17)** ([#873](https://github.com/kiwi-init/channels/pull/873))
- **Pi can be started from New agent and kiwi launch, with its model and thinking level (T347)** ([#876](https://github.com/kiwi-init/channels/pull/876))
- **Settings lists the folders agents can start in on this computer, with Add a folder… and Remove (T237)** ([#872](https://github.com/kiwi-init/channels/pull/872))
- **OpenCode can be started from New agent and kiwi launch, with model and permission choices checked on the real CLI (T346)** ([#877](https://github.com/kiwi-init/channels/pull/877))
- **kiwi pair rides out the relay's hiccups, starts this computer's daemon, and the app says what to do when it never came online (T358)** ([#878](https://github.com/kiwi-init/channels/pull/878))
- **Grok's Stop hook counts a monitor named by its [monitor] display line as the listener, and logs the monitors it saw when none is (T386)** ([#879](https://github.com/kiwi-init/channels/pull/879))
- **A send is stored once however often it arrives: a send id the room remembers (T376)** ([#880](https://github.com/kiwi-init/channels/pull/880))
- **A flow test starts an agent on a paired computer from another device, on a local relay, with model, effort and permission, and bypass only when that computer allows it (T394)** ([#881](https://github.com/kiwi-init/channels/pull/881))
- **A rehearsal dispatched by hand keeps its packages for 3 days, so they can be unpacked before a tag (T413)** ([#883](https://github.com/kiwi-init/channels/pull/883))
- **The app carries a minisign check and Jow's pinned release key, and a hand-run workflow proves the release secret pairs with it (T406)** ([#884](https://github.com/kiwi-init/channels/pull/884))
- **The rehearsal tries each package with its own parts: a channel made, a message sent and read back (T413)** ([#885](https://github.com/kiwi-init/channels/pull/885))
- **Linux AppImage updates are checked against the release key pinned in the app: the release signs SHA256SUMS with minisign, the updater verifies it (T406)** ([#882](https://github.com/kiwi-init/channels/pull/882))
- **The landing page is a channel: agents and people around the app's glass** ([#845](https://github.com/kiwi-init/channels/pull/845))
- **On KDE, Channels finds the old Electron app's key in the wallet, under every name it could have used, and the dialog names the right file (T472)** ([#886](https://github.com/kiwi-init/channels/pull/886))
- **The Mac app names its version where Finder and About read it: CFBundleShortVersionString (T496)** ([#887](https://github.com/kiwi-init/channels/pull/887))

## 0.27.3 — 2026-10-24

- **CI no longer times the desktop app's cold start; smoke-eb keeps the first-run channel and message (T50)** ([#850](https://github.com/kiwi-init/channels/pull/850))
- **Sidebar folds conversations with members who left the channel (T20)** ([#851](https://github.com/kiwi-init/channels/pull/851))
- **smoke-eb reports the first-run channel on Linux instead of failing on it, until T92** ([#853](https://github.com/kiwi-init/channels/pull/853))
- **New agent is a few short steps with Start always in view, and says how a launch is going (T9)** ([#855](https://github.com/kiwi-init/channels/pull/855))
- **The relay lists a person's paired computers: GET /v1/person/:pk/machines (T21)** ([#854](https://github.com/kiwi-init/channels/pull/854))
- **kiwi launch takes --model, --effort, --permission and --context, carried to claude and codex as their own flags (T10)** ([#856](https://github.com/kiwi-init/channels/pull/856))
- **Sidebar: a + on Conversations makes a new room, for the owner (T19)** ([#857](https://github.com/kiwi-init/channels/pull/857))
- **The Linux app carries its keys worker again, so Create channel works there (T92)** ([#858](https://github.com/kiwi-init/channels/pull/858))

## 0.27.2 — 2026-10-24

- **The window gets its preload when it's made again, right after a full collection (T50, #847)** ([#849](https://github.com/kiwi-init/channels/pull/849))
- **The window no longer fails to start on "Failed to parse webview secret key byte" (T50, #847)** ([#848](https://github.com/kiwi-init/channels/pull/848))

## 0.27.0 — 2026-10-24

- **WebKit pass: the conversation opens on its newest message in WebKit too, and build / shots shoots every screen in WebKit (T441)** ([#761](https://github.com/kiwi-init/channels/pull/761))
- **Desktop IPC behind a host seam: ipc/*.ts serve one typed table, the preload is only a transport (T484)** ([#765](https://github.com/kiwi-init/channels/pull/765))
- **Store v2 for the Electrobun app: sealed with a keychain key, and Electron's store imported once (T435)** ([#764](https://github.com/kiwi-init/channels/pull/764))
- **Desktop app seam: the store, updater, daemon bundling, deep links and main log import no electron; each shell registers its Host (T643)** ([#767](https://github.com/kiwi-init/channels/pull/767))
- **kiwi loop: a fresh Claude Code session per task, review round or message (T531)** ([#760](https://github.com/kiwi-init/channels/pull/760))
- **kiwi loop --harness codex: the new thread found by its launch nonce (T532)** ([#763](https://github.com/kiwi-init/channels/pull/763))
- **Store: a vault load that throws partway leaves the store broken, so no later save writes defaults over either copy (T758)** ([#771](https://github.com/kiwi-init/channels/pull/771))
- **Store v2 fails closed on a plain copy over a sealed store and on a plain import of an encrypted Electron store (T692)** ([#768](https://github.com/kiwi-init/channels/pull/768))
- **kiwi loop: a task in review isn't told to start it, and five fixes from #760's review (T789)** ([#770](https://github.com/kiwi-init/channels/pull/770))
- **Electrobun shell on the Mac: the window opens web/dist with today's CSP; desktop / mac builds it and checks its size (T434)** ([#758](https://github.com/kiwi-init/channels/pull/758))
- **Electrobun: our launcher in front of Electrobun's keeps BUN_OPTIONS, BUN_INSPECT, NODE_*, DYLD_* and JSC_* out of the app (T632)** ([#766](https://github.com/kiwi-init/channels/pull/766))
- **Make a room: the owner makes and renames rooms from channel settings in the app (T987)** ([#790](https://github.com/kiwi-init/channels/pull/790))
- **A missing kiwi-store.bin with a .bak that can't be read is unreadable, never a first run that saves defaults over the .bak (T855)** ([#779](https://github.com/kiwi-init/channels/pull/779))
- **On a Mac, a store key with both copies gone is a deleted store, refused and never imported over; the key is made only after the import decision (T907)** ([#782](https://github.com/kiwi-init/channels/pull/782))
- **kiwi loop --harness grok: a fresh Grok session per task, found by its nonce (T533)** ([#778](https://github.com/kiwi-init/channels/pull/778))
- **desktop / mac caches Electrobun's toolchain and retries its download, so a blip can't turn ci-ok red (T887)** ([#774](https://github.com/kiwi-init/channels/pull/774))
- **A room is its own conversation in the app: opening it shows only its messages, and the composer posts into it (T1030)** ([#795](https://github.com/kiwi-init/channels/pull/795))
- **Rooms: each room counts its own unread and keeps its own read mark, jumps open the message's room, a room shows its task cards, #general stays in the signed list (T1236)** ([#800](https://github.com/kiwi-init/channels/pull/800))
- **Channel settings: download the channel any time, as a transcript to read or the signed log, named with the date and time (T967)** ([#796](https://github.com/kiwi-init/channels/pull/796))
- **The signed launcher holds the store key: Keychain there, the key to bun on fd 3, and every app file checked against a seal in Info.plist (T544)** ([#772](https://github.com/kiwi-init/channels/pull/772))
- **Transcript download: Markdown links, link definitions, references and images are inert (T1374)** ([#806](https://github.com/kiwi-init/channels/pull/806))
- **main type-checks again: the launcher's store key fails closed on drop, finished and finish until the launcher keeps the ready mark (T1076)** ([#807](https://github.com/kiwi-init/channels/pull/807))
- **The kiwi CLI is compiled with bunfig.toml and .env autoload off, so a project folder kiwi starts in can't preload code into it (T1365)** ([#805](https://github.com/kiwi-init/channels/pull/805))
- **Key channel hygiene: bun moves off fd 3 at once, the launcher serves one session, and its C runs under ASan and UBSan (T873)** ([#775](https://github.com/kiwi-init/channels/pull/775))
- **Electrobun: window.kiwi on Electrobun's RPC, main's handler table served to our page only, internal RPC locked (T436)** ([#791](https://github.com/kiwi-init/channels/pull/791))
- **Electrobun on Linux: desktop / linux builds the shell on ubuntu, and package-linux makes the deb and AppImage under today's names (T444)** ([#803](https://github.com/kiwi-init/channels/pull/803))
- **The launcher keeps store v2's ready mark: finished, finish and drop (drop only for a key made in that session), the mark tied to its key (T1076)** ([#808](https://github.com/kiwi-init/channels/pull/808))
- **kiwi loop --harness mimo: a fresh MiMoCode session per task, stopped with SIGINT (T534)** ([#787](https://github.com/kiwi-init/channels/pull/787))
- **Electrobun's keys on a Bun Worker: channels.ts unchanged, the page's KeysPort over main's RPC, restart backoff and the 1 s quit flush (T437)** ([#789](https://github.com/kiwi-init/channels/pull/789))
- **ios / build and ios / gestures wait only on what the iPhone app is built from (T1598)** ([#810](https://github.com/kiwi-init/channels/pull/810))
- **Electrobun app life: one instance per data folder, close hides, Quit flushes, Dock reopen, kiwi:// links, the tray and app menus, the wake nudge (T438)** ([#780](https://github.com/kiwi-init/channels/pull/780))
- **Electrobun bridge: sessions are main's, an old load's reply never leaves main, the preload runs only in the top frame, and a quit answers what waited for a restarting Worker (T1230)** ([#812](https://github.com/kiwi-init/channels/pull/812))
- **kiwi loop --harness kimi: the first prompt typed into Kimi's window, stray listeners stopped (T535)** ([#793](https://github.com/kiwi-init/channels/pull/793))
- **Electrobun bridge: each document is its own session, load() retires the old one at once, and a page that joins a running GitHub link gets its code again (T1741)** ([#813](https://github.com/kiwi-init/channels/pull/813))
- **The Electrobun app updates itself, and a Linux AppImage swaps itself in place; a deb install is offered its .deb (T1554)** ([#815](https://github.com/kiwi-init/channels/pull/815))
- **On Linux our launcher keeps the app's environment to an allowlist before Electrobun's starts (T1548)** ([#817](https://github.com/kiwi-init/channels/pull/817))
- **Electrobun bridge vs script in our page: trust from the native committed URL, ids and frames out of the page's hooks (T1855)** ([#816](https://github.com/kiwi-init/channels/pull/816))
- **Electrobun on Linux starts: libkiwi-shell for WebKitGTK denies permission requests, watches the page and its commits, names the app and turns WebKitGTK's sandbox on (T1545)** ([#809](https://github.com/kiwi-init/channels/pull/809))
- **CI drives the Electrobun app without CDP: a test-only driver, smoke-eb, and perf-desktop's cold start with its own gates (T442)** ([#769](https://github.com/kiwi-init/channels/pull/769))
- **CI answers the merge queue: ci.yml runs on merge_group, each group in its own concurrency group (T2034)** ([#819](https://github.com/kiwi-init/channels/pull/819))
- **jev-ci plans a merge group on its combined change, trusts the queue's pass markers, and main skips commits the queue tested (T2034)** ([#821](https://github.com/kiwi-init/channels/pull/821))
- **A pull request runs only repo / static and test / unit; the merge queue's group runs the rest of the plan (T2134)** ([#826](https://github.com/kiwi-init/channels/pull/826))
- **desktop / linux runs on ubuntu-26.04, not ubuntu-latest while that label moves** ([#825](https://github.com/kiwi-init/channels/pull/825))
- **Electrobun in-app checks on the driver: the bridge against Electrobun's internals and script in our page (T1240)** ([#820](https://github.com/kiwi-init/channels/pull/820))
- **The keys Worker test keeps keys-eb's real 1 s flush timeout, so a slow runner's Worker isn't killed before it writes and answers (T2147)** ([#827](https://github.com/kiwi-init/channels/pull/827))
- **Electrobun test builds: data and lock under a temp home, the .test id on dev only, a private driver socket (T1820)** ([#824](https://github.com/kiwi-init/channels/pull/824))
- **Channels starts on Ubuntu 24.04: the deb's AppArmor profile lets WebKitGTK's sandbox run, and the app falls back with a log line when bwrap can't build it (T2119)** ([#829](https://github.com/kiwi-init/channels/pull/829))
- **Electrobun shell hardening: no CSP-less copy of the page, rules that fail closed, a parsed <head>, a pinned toolchain, own downloads only (T804)** ([#776](https://github.com/kiwi-init/channels/pull/776))
- **The browser action's caches stay on their runner image: WebKit no longer closes at launch in build / shots (T2249)** ([#832](https://github.com/kiwi-init/channels/pull/832))
- **The app icon is the prism on the black square, every size for Mac, Linux and iOS, and the favicons (T2140)** ([#828](https://github.com/kiwi-init/channels/pull/828))
- **Linux libkiwi-shell guards downloads and allows only the page, checked at start like on the Mac (T2071)** ([#823](https://github.com/kiwi-init/channels/pull/823))
- **Electrobun: the bundled kiwi CLI, the daemon keeper, main.log, and a stopped page reloaded (T439)** ([#797](https://github.com/kiwi-init/channels/pull/797))
- **The repo is kiwi-init/channels: every ojowwalker77/channels in code, site, docs and tests moves, the updater's release URL check included (T2037)** ([#822](https://github.com/kiwi-init/channels/pull/822))
- **smoke-eb proves the navigation canary on the built app; one strict notion of our page; post-build reads the app id; the linux-arm64 pins checked (T1067)** ([#833](https://github.com/kiwi-init/channels/pull/833))
- **Electrobun cold start, part 1: startup marks per launch, a leftover check and loop-scaled numbers in perf-desktop (T798)** ([#831](https://github.com/kiwi-init/channels/pull/831))
- **The Mac Electrobun app keeps its keys in store v2 through the launcher, imports Electron's store once, and reports a refused mark (T1582)** ([#811](https://github.com/kiwi-init/channels/pull/811))
- **Release gates from #811: the key channel stays the first code in the main bundle, delete-by-reference on the real Security framework, a pinned data folder and per-cause store dialogs (T1710)** ([#837](https://github.com/kiwi-init/channels/pull/837))
- **The Linux store is checked on a real Secret Service: Electron's v11 store through a throwaway GNOME keyring, and plain JSON at 0600 logged when none runs (T1550)** ([#838](https://github.com/kiwi-init/channels/pull/838))
- **The stopped-page watch works on the Mac: kiwi-shell adds the delegate method Electrobun doesn't have, before the window exists (T2386)** ([#839](https://github.com/kiwi-init/channels/pull/839))
- **jev-ci.yml and main-eb.ts stop being every Electrobun PR's conflict: lists one item per line, descriptions one sentence per line, each startup feature in its own module (T2212)** ([#834](https://github.com/kiwi-init/channels/pull/834))
- **Merge pull request #841 from kiwi-init/T2071b-guard-test**
- **A manual CI run can pick its jobs: workflow_dispatch takes a jobs input** ([#842](https://github.com/kiwi-init/channels/pull/842))
- **desktop / linux drives the Electrobun app like the Mac: a test build, the driver check, smoke-eb and perf-desktop under Xvfb, and a purge that leaves nothing (T1552)** ([#830](https://github.com/kiwi-init/channels/pull/830))
- **The Linux Electrobun app bundles kiwi.js, so its daemon keeper starts kiwi and it installs the CLI, and the release build makes dist/kiwi.js before eb-post-build needs it (T2317)** ([#835](https://github.com/kiwi-init/channels/pull/835))
- **Electrobun cold start: the tray after the first screen, and marks for the navigation, the keys path and the page's cache (T2190)** ([#836](https://github.com/kiwi-init/channels/pull/836))
- **Releases ship the Electrobun app on Apple silicon and Linux; Electron builds only the Intel Mac app (T445)** ([#840](https://github.com/kiwi-init/channels/pull/840))
- **The update rehearsal gives its temp HOME its own keychain, and shows where the updated app waits** ([#843](https://github.com/kiwi-init/channels/pull/843))

## 0.26.0 — 2026-10-23

- **perf-feel.ts times what a person feels behind a relay far away: send to bubble, opening a task, layout shifts, filmstrips (T11)** ([#728](https://github.com/kiwi-init/channels/pull/728))
- **A channel opens after one round trip, not three: board in 375 ms instead of 768 at 150 ms RTT (T30)** ([#729](https://github.com/kiwi-init/channels/pull/729))
- **A channel that's still opening shows nothing it doesn't know: no Add an agent / No tasks yet / Connecting… flash on reload (T31)** ([#731](https://github.com/kiwi-init/channels/pull/731))
- **Panels, menus and dialogs leave instead of vanishing, and tasks slide to their new place: Motion only where CSS can't (T10)** ([#730](https://github.com/kiwi-init/channels/pull/730))
- **The rows a conversation opens on are laid out at once, so they don't grow from a 64 px guess after they're painted (T33)** ([#732](https://github.com/kiwi-init/channels/pull/732))
- **A re-run of perf / scale measures again: every artifact upload overwrites the attempt before it (T79)** ([#733](https://github.com/kiwi-init/channels/pull/733))
- **Typing on machines without a GPU: the scrims drop their blur there, and perf-scale's typing gate measures the app, not its own CLI start-ups (T34)** ([#734](https://github.com/kiwi-init/channels/pull/734))
- **A channel opens on its conversation, not the Tasks board (T180)** ([#737](https://github.com/kiwi-init/channels/pull/737))
- **Needs you says one line per thing, details on a click; the board drops its empty PR columns (T182)** ([#739](https://github.com/kiwi-init/channels/pull/739))
- **Optimistic send: the box empties on Enter and your message shows at once (T32)** ([#741](https://github.com/kiwi-init/channels/pull/741))
- **A task or a thread slides over the page instead of squeezing it: the page keeps its width and scroll (T181)** ([#738](https://github.com/kiwi-init/channels/pull/738))
- **perf / scale runs perf-feel at 150 ms RTT and gates what a person feels (T54)** ([#735](https://github.com/kiwi-init/channels/pull/735))
- **A channel paints from what this device kept, before the relay answers: reload 375 → 265 ms at 150 ms RTT (T71)** ([#744](https://github.com/kiwi-init/channels/pull/744))
- **The relay's answer replaces what the early paint showed: an island the relay's head turns down is gone, not left above a gap (T300)** ([#746](https://github.com/kiwi-init/channels/pull/746))
- **SECURITY.md says what the kept state can and can't do, and a floor the relay already answered isn't replaced by the kept one (T302)** ([#748](https://github.com/kiwi-init/channels/pull/748))
- **A reply right after a send keeps its quote: fixes the smoke-ui 'send and reply' flake (T330)** ([#750](https://github.com/kiwi-init/channels/pull/750))
- **The app reopens the channel you had open: a launch lands in your last channel, not "Nothing open" (T287)** ([#745](https://github.com/kiwi-init/channels/pull/745))
- **A kept fold base is checked like a snapshot before it's used: version, shape, outgrown, ≤ the relay's head (T301)** ([#747](https://github.com/kiwi-init/channels/pull/747))
- **Optimistic send edges: messages go out in the order typed, a failed message never takes a reply with it, the reply bar clears on Enter (T369)** ([#751](https://github.com/kiwi-init/channels/pull/751))
- **What a channel doesn't need before it paints loads when it runs: first-load JS 586,793 -> 581,635 bytes (T379)** ([#753](https://github.com/kiwi-init/channels/pull/753))
- **A channel paints without Effect's runtime: the open path is plain promises, first-load JS 581,635 -> 515,538 bytes (T392)** ([#754](https://github.com/kiwi-init/channels/pull/754))
- **iPhone: reviews waiting on you reach the phone, and a channel's row shows its latest message (#743)** ([#752](https://github.com/kiwi-init/channels/pull/752))
- **Desktop cold start, measured: launch to window, first paint, first cached message and live, in desktop / package (T53)** ([#742](https://github.com/kiwi-init/channels/pull/742))
- **iPhone: a drag that starts on a message bubble scrolls the conversation (#749)** ([#756](https://github.com/kiwi-init/channels/pull/756))

## 0.25.3 — 2026-10-22

- **The invite box keeps the whole join command inside it: a pinned personality's --persona token wraps (T12)** ([#691](https://github.com/kiwi-init/channels/pull/691))
- **perf / scale runs its three runs side by side on three runners, then takes the medians (T13)** ([#692](https://github.com/kiwi-init/channels/pull/692))
- **cli / macos: a hung cache save can't hold the job (T15)** ([#693](https://github.com/kiwi-init/channels/pull/693))
- **Chromium's apt packages install from cached .deb files, so a slow mirror no longer stalls build / shots (T39)** ([#690](https://github.com/kiwi-init/channels/pull/690))
- **perf / scale's gates fail CI again: perf-check's exit code no longer dies in tee (T53)** ([#695](https://github.com/kiwi-init/channels/pull/695))
- **perf-scale seeds the channel in-process and lets the ten agents in at once (T106)** ([#697](https://github.com/kiwi-init/channels/pull/697))
- **perf-scale's local relay runs without per-minute caps: --dev-no-rate-limits (T133)** ([#698](https://github.com/kiwi-init/channels/pull/698))
- **--dev-no-rate-limits lifts the caps only for requests made on this machine directly, like dev sign-in (T171)** ([#701](https://github.com/kiwi-init/channels/pull/701))
- **build / shots takes its phone shots in the same run, on the channel it already seeded (T151)** ([#699](https://github.com/kiwi-init/channels/pull/699))
- **cli / macos runs every test file: a test's SIGINT no longer ends the run early with exit 0 (T163)** ([#700](https://github.com/kiwi-init/channels/pull/700))
- **shoot-ui's phone pass skips the blocks that shoot nothing at that size (T205)** ([#703](https://github.com/kiwi-init/channels/pull/703))
- **perf gates compare timings scaled to a reference runner, so a slow runner can't fail them (T101)** ([#696](https://github.com/kiwi-init/channels/pull/696))
- **Neither dev flag starts with a trusted proxy, and a proxied socket upgrade keeps the cap, tested (T192)** ([#702](https://github.com/kiwi-init/channels/pull/702))
- **perf-check bounds each run's calibration and scales only Reload's in-page part (T257)** ([#706](https://github.com/kiwi-init/channels/pull/706))
- **Base64 decoding builds its bytes in a plain loop: a reload with 2000 messages takes 13% less (T67)** ([#707](https://github.com/kiwi-init/channels/pull/707))
- **The Conversation tab mounts a first screen of rows, not 120: its switch at 4x takes half the time (T66)** ([#705](https://github.com/kiwi-init/channels/pull/705))
- **ci-tests.ts reads bun's last summary and doesn't wait on a leftover process; the demo's stay lets go of SIGINT (T214)** ([#704](https://github.com/kiwi-init/channels/pull/704))
- **shoot-ui opens the add-agent screen only when it shoots it (T236)** ([#709](https://github.com/kiwi-init/channels/pull/709))
- **The relay refuses --flag=value instead of ignoring it (T241)** ([#708](https://github.com/kiwi-init/channels/pull/708))
- **Reload's gate goes back to 820: main measures it at 706 since #707 (T301)** ([#711](https://github.com/kiwi-init/channels/pull/711))
- **cli / macos splits its tests across three macOS runners, dealt by measured times (T91)** ([#694](https://github.com/kiwi-init/channels/pull/694))
- **test / unit, flows-a and flows-b each split across two runners (T152)** ([#713](https://github.com/kiwi-init/channels/pull/713))
- **CI's perf runs measure only what the gates read: about 16 s less per run (T356)** ([#716](https://github.com/kiwi-init/channels/pull/716))
- **The daemon's wake tests run in three files side by side: 73 s in one file becomes about 27 s (T359)** ([#717](https://github.com/kiwi-init/channels/pull/717))
- **pack-cli compresses on every core: desktop / package's packing goes from 44 to 16 s (T355)** ([#715](https://github.com/kiwi-init/channels/pull/715))
- **A key that waited for approval gets its daemon seat when its join writes its cursor, not at its backed-off retry (T407)** ([#720](https://github.com/kiwi-init/channels/pull/720))
- **A newer prompt is judged by the time its mark holds, not the file's: Linux dates files by a coarser clock (T386)** ([#719](https://github.com/kiwi-init/channels/pull/719))
- **The desktop app never spawns a kiwi binary still being written: places of one file share one write (T369)** ([#722](https://github.com/kiwi-init/channels/pull/722))
- **perf-check names a run left out of one timing; the blank-page calibration was measured and stays out (T292)** ([#710](https://github.com/kiwi-init/channels/pull/710))
- **join-seats.test.ts runs in three files side by side: 63 s in one file becomes about 25 s (T442)** ([#724](https://github.com/kiwi-init/channels/pull/724))
- **Channels no longer has voice or dictation: the app, the desktop app, the relay, CI and the docs (T404)** ([#721](https://github.com/kiwi-init/channels/pull/721))
- **The app's Pair leaves its answer for the computer, and a dropped pairing mailbox reads 404 (#714)** ([#718](https://github.com/kiwi-init/channels/pull/718))
- **Link a phone: the Mac app hands an iPhone its person and channel keys by QR** ([#725](https://github.com/kiwi-init/channels/pull/725))
- **link.ts's X25519 deriveBits typechecks again on main** ([#727](https://github.com/kiwi-init/channels/pull/727))
- **Channels for iPhone: a native SwiftUI app that reads and answers your channels like Messages** ([#726](https://github.com/kiwi-init/channels/pull/726))

## 0.25.2 — 2026-10-22

- **The Tasks board's rows size to the board, not the window: with a task open beside it, titles show again and nothing runs over them** ([#688](https://github.com/kiwi-init/channels/pull/688))
- **A person can be let in with Can answer decisions: agents' decisions show in their Needs you, and their answer counts** ([#689](https://github.com/kiwi-init/channels/pull/689))

## 0.25.1 — 2026-10-22

- **A person can be let in with Can add agents: the agents on their paired computers join on their own, as theirs** ([#687](https://github.com/kiwi-init/channels/pull/687))

## 0.25.0 — 2026-10-21

- **A loop holds a seat between sessions with its own token, then binds it to the session it names** ([#654](https://github.com/kiwi-init/channels/pull/654))
- **Docs: terminal plugins rows 6 and 7 as built, and tmux's marks and prefix K in agents.md (T2017)** ([#661](https://github.com/kiwi-init/channels/pull/661))
- **Show in tmux from Needs you: a seat running in tmux is listed while tmux's helpers are on, and Show brings its pane to the front (T2378)** ([#662](https://github.com/kiwi-init/channels/pull/662))
- **Neutral presets: New agent starts with no personality, and no preset carries this repo's rules (T263)** ([#667](https://github.com/kiwi-init/channels/pull/667))
- **GIF reactions are gone: no picker, no GIF rendering, no kiwi react --list (T280)** ([#668](https://github.com/kiwi-init/channels/pull/668))
- **Tasks v2 step 1: tasks are filed under the ask they serve (T223)** ([#665](https://github.com/kiwi-init/channels/pull/665))
- **The 250k checkpoint never blocks Stop: one line on the next prompt, in any mode (T266)** ([#670](https://github.com/kiwi-init/channels/pull/670))
- **Kiwi's PR comment waits for a per-channel Write to GitHub switch, off by default, and no longer carries the task's title (T264)** ([#669](https://github.com/kiwi-init/channels/pull/669))
- **Docs: the Tasks v2 plan, asks, work and decisions (T212)** ([#664](https://github.com/kiwi-init/channels/pull/664))
- **Clients keep events with an op they don't know instead of dropping the message (T224)** ([#666](https://github.com/kiwi-init/channels/pull/666))
- **main typechecks again: newer-ops lists github.write.set, and version 1's ops are a literal list** ([#674](https://github.com/kiwi-init/channels/pull/674))
- **A task's GitHub issue is only linked by default: Kiwi comments on it and closes it only while Write to GitHub is on (T267)** ([#672](https://github.com/kiwi-init/channels/pull/672))
- **The context line is opt-in: nothing at 250k unless kiwi context-line is on (T430)** ([#675](https://github.com/kiwi-init/channels/pull/675))
- **The owner picks the branch prefix that links PRs to tasks; with none, no branch name links one (T265)** ([#676](https://github.com/kiwi-init/channels/pull/676))
- **Channels are tabs in a bar across the top, and ⌘\ hides the channel's sidebar (T285)** ([#671](https://github.com/kiwi-init/channels/pull/671))
- **Room in the web first load: 591,122 → 582,464 bytes, with no visible change (T482)** ([#681](https://github.com/kiwi-init/channels/pull/681))
- **The 250k context line is back exactly as it was before #670, only behind kiwi context-line on (T469)** ([#678](https://github.com/kiwi-init/channels/pull/678))
- **Tasks v2 step 2: a decision names the work it holds, and Needs you lists only decisions that hold something (T226)** ([#680](https://github.com/kiwi-init/channels/pull/680))
- **Every sheet keeps 8px from the window's left edge, and the sidebar toggle shows only where there's a sidebar (T513)** ([#682](https://github.com/kiwi-init/channels/pull/682))
- **The Tasks board groups work under the person's message it serves (T256)** ([#677](https://github.com/kiwi-init/channels/pull/677))
- **Settings: "Ask agents for a checkpoint past 250k context", the kiwi context-line switch in the app (T552)** ([#683](https://github.com/kiwi-init/channels/pull/683))
- **The CLI bundle leaves out the MCP SDK's JSON Schema validator: 2,699,958 → 2,566,380 bytes, with no behaviour change (T598)** ([#684](https://github.com/kiwi-init/channels/pull/684))
- **Running checks reach the channel as state: queued and in progress on a PR, quiet in the conversation (T225)** ([#679](https://github.com/kiwi-init/channels/pull/679))
- **A task's stage is read off the log, never typed: kiwi task show says it, and the board when there's evidence (T227)** ([#685](https://github.com/kiwi-init/channels/pull/685))
- **A verdict counts only at the head it judged, and kiwi task show lists a task's evidence as refs (T609)** ([#686](https://github.com/kiwi-init/channels/pull/686))

## 0.24.0 — 2026-10-21

- **The permission hook asks the relay for an answer the daemon hasn't caught up to, checks for a newer prompt last, and closes two lock races (T1651)** ([#631](https://github.com/kiwi-init/channels/pull/631))
- **Permission prompts: the row clears only on an answer that counts, more secret shapes, and edits show what they replace (T1588)** ([#628](https://github.com/kiwi-init/channels/pull/628))
- **The permission row shows what an edit replaces and with what, and says when it replaces every occurrence (T1615)** ([#632](https://github.com/kiwi-init/channels/pull/632))
- **The permission prompt docs say folder and file paths count as secret only for known shapes, and that an answer names the ask's id, agent and signature (T1608)** ([#629](https://github.com/kiwi-init/channels/pull/629))
- **A permission answer is built only on a verified ask and counted only as the fold's own message at its seq (T1594)** ([#634](https://github.com/kiwi-init/channels/pull/634))
- **Plan: one fresh agent session per task** ([#635](https://github.com/kiwi-init/channels/pull/635))
- **The conversation stays at its newest message when content above it grows after it opens (T1679)** ([#633](https://github.com/kiwi-init/channels/pull/633))
- **The fold refuses every message at a seq it was handed twice, so neither copy opens an ask or counts as an answer (T1725)** ([#636](https://github.com/kiwi-init/channels/pull/636))
- **The conversation's own scrolls to the bottom record where they left it, so content growing before the first scroll event after a channel switch keeps it at the newest message (T1720)** ([#637](https://github.com/kiwi-init/channels/pull/637))
- **The permission hook's last check runs after its wait has closed, and letting go of a session leaves another hook's lock and newer-prompt mark alone (T1661)** ([#640](https://github.com/kiwi-init/channels/pull/640))
- **Dictation's model, recorder and transcriber load on the first mic press, out of the first-load JS (T1859)** ([#641](https://github.com/kiwi-init/channels/pull/641))
- **The bundle check fails when dictation's model code is in the first load, a failed engine load says to reload, and the engine warms on mic hover or focus (T1887)** ([#642](https://github.com/kiwi-init/channels/pull/642))
- **Plan: terminal plugins, from an audit of the Rex and tmux code (T1928)** ([#645](https://github.com/kiwi-init/channels/pull/645))
- **Channel sidebar: a Search row, one Tasks row with quiet dots, threads between agents folded (T1763)** ([#638](https://github.com/kiwi-init/channels/pull/638))
- **Kiwi's terminal code runs programs, reads JSON and checks the foreground one way each, in src/terminals/shared (T2009)** ([#648](https://github.com/kiwi-init/channels/pull/648))
- **New agent's windows open through terminal plugins: a manifest and interface, a registry, and Rex, tmux and the terminal app each in src/terminals (T2010)** ([#649](https://github.com/kiwi-init/channels/pull/649))
- **A stale permission lock is taken over by moving it aside first, and a signal after the wait has closed closes the ask instead of killing the hook (T1894)** ([#646](https://github.com/kiwi-init/channels/pull/646))
- **A lazy view that fails to load says "Part of Channels couldn't load. Reload to try again." instead of failing in silence (T1960)** ([#644](https://github.com/kiwi-init/channels/pull/644))
- **The picture viewer's top row is the window's title row: its buttons click, and it clears the Mac traffic lights (T1841)** ([#643](https://github.com/kiwi-init/channels/pull/643))
- **One reader per terminal shape in packages/core/src/terminals.ts: place names, a launch's result, Rex's status and a Rex seat (T2012)** ([#651](https://github.com/kiwi-init/channels/pull/651))
- **The secret filter lets field-name keys and whole-value switches through, and catches lowercase _key/_auth, ?code=, ?access_key= and sudo -S passwords (T1621)** ([#639](https://github.com/kiwi-init/channels/pull/639))
- **The secret filter checks YAML list items and flow maps, and lets type annotations and S3/object keys through (T1923)** ([#652](https://github.com/kiwi-init/channels/pull/652))
- **Rex is a terminal plugin: where a seat runs, its marks, Show in Rex, its events, typing into its pane and its palette helpers, in src/terminals/rex (T2011)** ([#650](https://github.com/kiwi-init/channels/pull/650))
- **#general reads like a group chat: task bookkeeping folds into one line, digests go to the task's thread (T1939)** ([#647](https://github.com/kiwi-init/channels/pull/647))
- **kiwi send and reply tell an agent when its #general message ran long** ([#653](https://github.com/kiwi-init/channels/pull/653))
- **Terminal plugins 5/9: the terminals and launch config, kiwi terminal, kiwi launches, new agents open where Prefer says (T2013)** ([#655](https://github.com/kiwi-init/channels/pull/655))
- **Terminal plugins 8/9: Settings → New agents, and New agent follows the switch (T2016)** ([#658](https://github.com/kiwi-init/channels/pull/658))
- **Terminal plugins 9/9: docs, the plan as built, and how a new agent's terminal is picked (T2017)** ([#660](https://github.com/kiwi-init/channels/pull/660))
- **tmux gets helpers: Download and Remove, the @kiwi window marks, prefix K to the seat that needs you, and Show in tmux (T2014)** ([#659](https://github.com/kiwi-init/channels/pull/659))
- **Show from Needs you and New agent goes through the terminal plugins: Show in Rex now, Show in tmux next (T2015)** ([#656](https://github.com/kiwi-init/channels/pull/656))

## 0.23.1 — 2026-10-21

- **The relay streams a dictation download through its hash into the store instead of holding the whole model in memory (T908)** ([#608](https://github.com/kiwi-init/channels/pull/608))
- **The open conversation no longer re-renders for other channels' news, search is deferred and windowed, Mermaid drawings are cached and capped, and task rows share one PR index (T154)** ([#607](https://github.com/kiwi-init/channels/pull/607))
- **A paired computer's daemon takes its person's asks from the relay inbox: claimed, checked, run within limits, answered and logged (T788)** ([#611](https://github.com/kiwi-init/channels/pull/611))
- **local-relay: no relay left running when its port can't be read, plus the #565 review nits (T997)** ([#610](https://github.com/kiwi-init/channels/pull/610))
- **A replayed older title, settings or icon is ignored (T722, A5)** ([#613](https://github.com/kiwi-init/channels/pull/613))
- **The paired computer's inbox survives a box that breaks its reader, trusts only the relay's id shape, launches in the realpath'd folder and keeps its launch cap across restarts (T1122)** ([#615](https://github.com/kiwi-init/channels/pull/615))
- **A signature check never throws, so one crafted message can't stop a channel loading (T1123)** ([#614](https://github.com/kiwi-init/channels/pull/614))
- **Composer and conversation: options answer once, drafts survive switches, honest counts, working jumps, keyboard actions (T155)** ([#609](https://github.com/kiwi-init/channels/pull/609))
- **main's unit tests pass again: a box signed with a key that isn't base64 is refused as unsigned, now that verify() can't throw (T1211)** ([#619](https://github.com/kiwi-init/channels/pull/619))
- **The board keeps finished tasks: no fold base from a short roster, a gap between base and log refetched, a poisoned base rebuilt (T1004)** ([#612](https://github.com/kiwi-init/channels/pull/612))
- **The owner's fold base stays bounded and a replay is still refused after it's pruned, so snapshots seal again past 512 KB (T586, T1089, T1219, T1272)** ([#602](https://github.com/kiwi-init/channels/pull/602))
- **New agent on another computer: pick a paired one, see who's online, launch through the relay (T789)** ([#617](https://github.com/kiwi-init/channels/pull/617))
- **The docs say how an agent is started from the app, here or on a paired computer, and the New agent plan's item 4 is as built (T790)** ([#616](https://github.com/kiwi-init/channels/pull/616))
- **The dashboard's first load drops about 9 KB: the Tasks view, image compression and log export load when used (T1224)** ([#618](https://github.com/kiwi-init/channels/pull/618))
- **main builds again: lazy.tsx declares TasksView once, not twice (#618 and #602 both added it)** ([#620](https://github.com/kiwi-init/channels/pull/620))
- **Tests stop leaking the answer cache, and a local run never writes into the real ~/.kiwi (T1249)** ([#621](https://github.com/kiwi-init/channels/pull/621))
- **docs/agents.md and SECURITY.md say how a permission prompt is answered from the app: who can answer, what's shown and what never is (T1457)** ([#622](https://github.com/kiwi-init/channels/pull/622))
- **The permission prompt docs match the core as built: Allow only from the agent's human, what's shown per tool and its caps, Deny-only rows, what stays in the terminal (T1457)** ([#626](https://github.com/kiwi-init/channels/pull/626))
- **A red CI check no longer opens a task: the owner's app's CI-red automation is gone, main included (T1515)** ([#625](https://github.com/kiwi-init/channels/pull/625))
- **Permission prompts core: the permission field and its check, the secret filter, and the answer check, bound to the ask's id, sender and signature (T1454)** ([#623](https://github.com/kiwi-init/channels/pull/623))
- **Claude Code's permission prompts reach the agent's human in Kiwi, and their signed Allow or Deny answers Claude Code (T1455)** ([#627](https://github.com/kiwi-init/channels/pull/627))
- **The permission hook retries an answer the fold doesn't have yet, stays quiet once a newer prompt started, and the installer refreshes a stale entry (T1605)** ([#630](https://github.com/kiwi-init/channels/pull/630))
- **Permission prompts in the app: the Needs you row with the signed answer, who can allow, settled states (T1456)** ([#624](https://github.com/kiwi-init/channels/pull/624))

## 0.23.0 — 2026-10-20

- **kiwi rotate on gives Codex seats in tmux a fresh thread, and the seat follows it** ([#564](https://github.com/kiwi-init/channels/pull/564))
- **Plan: New agent, started from the Channels app** ([#566](https://github.com/kiwi-init/channels/pull/566))
- **The composer shows a picked mention as the member's nickname, as sent messages do (T33)** ([#567](https://github.com/kiwi-init/channels/pull/567))
- **kiwi harnesses and the daemon's harnesses verb: each harness on the login shell's PATH, its version, and whether Kiwi can wake it (T38)** ([#568](https://github.com/kiwi-init/channels/pull/568))
- **Auto-approval keeps the personality an invite pinned, and the owner reads a launch id from the join claims (T40)** ([#569](https://github.com/kiwi-init/channels/pull/569))
- **The daemon reads a seat's activity from Rex only with the Rex helpers on, and never blocks on it (T138)** ([#571](https://github.com/kiwi-init/channels/pull/571))
- **A message dated past what a date can hold no longer crashes the app (T136)** ([#570](https://github.com/kiwi-init/channels/pull/570))
- **A launch opens its terminal: a Rex window, else a tmux window in kiwi, else Terminal.app (T39)** ([#572](https://github.com/kiwi-init/channels/pull/572))
- **The dashboard's first load is back under its budget, with 6.6 KB to spare (T201)** ([#577](https://github.com/kiwi-init/channels/pull/577))
- **The login shell falls back to the account's own when SHELL is unset, and pi, kimi and agent count only when they look like their harness (T170)** ([#573](https://github.com/kiwi-init/channels/pull/573))
- **A filtered read no longer marks the rest of the channel read (T137)** ([#578](https://github.com/kiwi-init/channels/pull/578))
- **Past 2,000 messages the owner's app keeps its GitHub automation running: a fold on the snapshot counts as the whole log (T139)** ([#574](https://github.com/kiwi-init/channels/pull/574))
- **Changing the relay in Settings keeps every saved channel (T135)** ([#575](https://github.com/kiwi-init/channels/pull/575))
- **A voice call ends when you leave its channel, and never takes another channel's news or tools (T140)** ([#576](https://github.com/kiwi-init/channels/pull/576))
- **kiwi launch and the daemon's launch verb start Claude Code or Codex in a terminal you can open, and kiwi join carries KIWI_LAUNCH to the owner (T41)** ([#580](https://github.com/kiwi-init/channels/pull/580))
- **CI red opens a task only for a failed check on main: a PR branch's red is its PR's to fix (T531)** ([#584](https://github.com/kiwi-init/channels/pull/584))
- **A release refuses a tag whose commit isn't on main, and bump-main pushes only the stamp's files (T142)** ([#582](https://github.com/kiwi-init/channels/pull/582))
- **A shell profile outside a temp folder never gets a PATH line into one (T61)** ([#581](https://github.com/kiwi-init/channels/pull/581))
- **A removed member can no longer read the channel's name, charter, hold, rooms or repos: they follow the key's epoch (T141)** ([#579](https://github.com/kiwi-init/channels/pull/579))
- **Voice acts only on the person's spoken yes, channel text reaches it as content not instructions, and dictation never leaves the mic on (T153)** ([#585](https://github.com/kiwi-init/channels/pull/585))
- **Codex hooks go where CODEX_HOME points** ([#589](https://github.com/kiwi-init/channels/pull/589))
- **One unreadable message no longer stops the owner's snapshots, filtered messages stay authentic after a reload, and GitHub automation keeps failed items (T152)** ([#586](https://github.com/kiwi-init/channels/pull/586))
- **New agent: start an agent on this computer from the Channels app, and watch it join (T42)** ([#587](https://github.com/kiwi-init/channels/pull/587))
- **kiwi join inside Claude Code waits a moment for its transcript to name the model (T360)** ([#583](https://github.com/kiwi-init/channels/pull/583))
- **A key the relay lists without an owner-signed record is not a member (T143, A3)** ([#592](https://github.com/kiwi-init/channels/pull/592))
- **An agent given a personality mid-session is told it at its next hook, once (T269)** ([#588](https://github.com/kiwi-init/channels/pull/588))
- **A name, settings or icon change during a pending rotation rotates first, and the icon follows the newest key like the rest (T414)** ([#590](https://github.com/kiwi-init/channels/pull/590))
- **The installer takes the Apple Silicon build under Rosetta, and a relay behind an untrusted proxy says how to trust it (T156)** ([#595](https://github.com/kiwi-init/channels/pull/595))
- **The daemon's CPU and memory: rex backoff holds, transcripts and folds reused while unchanged, fewer syncs, no git per hook, one home walk per version (T149)** ([#591](https://github.com/kiwi-init/channels/pull/591))
- **kiwi reply N answers where the session heard #N, dash-led text is text, unused options are refused or reported, and 1.5h means 90 minutes (T151)** ([#596](https://github.com/kiwi-init/channels/pull/596))
- **Presence can't be spoofed under another name or replayed (T674, A4)** ([#594](https://github.com/kiwi-init/channels/pull/594))
- **Signing secrets in the release environment, the app's own entitlements, and jev-ci trusting no fork's pass markers (T148)** ([#593](https://github.com/kiwi-init/channels/pull/593))
- **Daemon and hook reliability: no killing a reused pid, no daemon pile-up, wakes and kiwi sh queries bounded, init.lua written in one rename (T150)** ([#597](https://github.com/kiwi-init/channels/pull/597))
- **The person's ask to a paired computer and that computer's answer: made, sealed, signed and read (T786)** ([#599](https://github.com/kiwi-init/channels/pull/599))
- **The linked GitHub token goes only to the relay it was linked on, while that relay names the same App (T147)** ([#604](https://github.com/kiwi-init/channels/pull/604))
- **The relay reads bodies within a cap, bounds its signature-key cache, rate-limits join requests, history reads and GitHub lookups, and streams GitHub diffs and logs (T145)** ([#605](https://github.com/kiwi-init/channels/pull/605))
- **The new key never reaches a removed member, and the epoch never goes down (T721, A1+A2)** ([#603](https://github.com/kiwi-init/channels/pull/603))
- **Relay correctness: JWKS refetch, all-or-nothing create, push-checked repos without the App key, idle days from the last close, a warm store on Bun (T146)** ([#600](https://github.com/kiwi-init/channels/pull/600))
- **Harden against untrusted messages: refused events, future re:, handoff from anyone, diagram links, history loop (T144)** ([#606](https://github.com/kiwi-init/channels/pull/606))
- **Channel settings as a page, and Settings in sections (T69)** ([#598](https://github.com/kiwi-init/channels/pull/598))
- **The relay keeps a sealed inbox per paired computer: registered by its cert, written only by its person, read on its socket (T787)** ([#601](https://github.com/kiwi-init/channels/pull/601))
- **The local relay in perf, shots, smoke and dictation runs takes a port the system picks** ([#565](https://github.com/kiwi-init/channels/pull/565))

## 0.22.0 — 2026-10-20

- **A release is a tag on main: the workflow stamps the version and changelog, and commits them to main** ([#550](https://github.com/kiwi-init/channels/pull/550))
- **The tmux-restart test waits for the old server to exit before starting a new one (#552)** ([#553](https://github.com/kiwi-init/channels/pull/553))
- **On a Mac the traffic lights no longer touch the page: the rail is 92px there, so the sheet starts 12px after them** ([#555](https://github.com/kiwi-init/channels/pull/555))
- **A Mac window is never narrower than 768px, so its headers never sit under the traffic lights** ([#556](https://github.com/kiwi-init/channels/pull/556))
- **The desktop app never zooms the page: ⌘+, ⌘− and ⌘0 step the text size, the layout stays put** ([#559](https://github.com/kiwi-init/channels/pull/559))
- **kiwi rotate logs why a seat stays, and a question on a finished task no longer holds it** ([#561](https://github.com/kiwi-init/channels/pull/561))
- **Seats say where they run, and Kiwi marks them in terminals that take OSC 7501** ([#554](https://github.com/kiwi-init/channels/pull/554))
- **A lead past the context line writes a lead checkpoint, and rotates only after it** ([#562](https://github.com/kiwi-init/channels/pull/562))
- **Seats follow Rex events, rotation clears a Rex pane, and Needs you and Rex's palette open the seat** ([#557](https://github.com/kiwi-init/channels/pull/557))
- **The Rex helpers plan, built, with what probes on a live Rex found** ([#551](https://github.com/kiwi-init/channels/pull/551))
- **Settings → Rex: Install Rex Helpers, from the app** ([#563](https://github.com/kiwi-init/channels/pull/563))

## 0.21.0 — 2026-10-20

- **A MiMoCode session whose lookups race keeps one listener, and the plugin is updated before any seat joins** ([#536](https://github.com/kiwi-init/channels/pull/536))
- **Hooks from an older kiwi are rewritten with --harness, and a hook with no session never takes another harness's seat** ([#534](https://github.com/kiwi-init/channels/pull/534))
- **resign test: a stale signature comes from a door in front of the relay, not a patched Date.now (T1045)** ([#539](https://github.com/kiwi-init/channels/pull/539))
- **A new MiMoCode session can be woken before it runs its first shell command** ([#533](https://github.com/kiwi-init/channels/pull/533))
- **SessionStart's unread heading and Cursor's stop follow-up name their channel** ([#540](https://github.com/kiwi-init/channels/pull/540))
- **A MiMoCode or Pi seat counts as woken only while its listener runs, and the plugin's wakes and refusals land in wake.log** ([#542](https://github.com/kiwi-init/channels/pull/542))
- **Joining a second channel from a folder says which -c ALIAS --as NAME picks each seat** ([#544](https://github.com/kiwi-init/channels/pull/544))
- **After a Claude Code /clear, the new session commits what the earlier session's listener handed over** ([#541](https://github.com/kiwi-init/channels/pull/541))
- **Closing a channel offers its whole signed log as a download first** ([#545](https://github.com/kiwi-init/channels/pull/545))
- **One wake outstanding per seat: no second wake until the agent has read the first** ([#543](https://github.com/kiwi-init/channels/pull/543))
- **The Linux app appears in seconds again: the AppImage is gzip in 128 KiB blocks, not xz in 1 MiB (#546)** ([#547](https://github.com/kiwi-init/channels/pull/547))
- **kiwi rotate on gives this computer's Claude Code seats in tmux a fresh session between tasks** ([#548](https://github.com/kiwi-init/channels/pull/548))

## 0.20.5 — 2026-10-19

- **Grok Bot's VM is seated as Grok Bot, not Cursor, though its shell has CURSOR_AGENT (T508)** ([#491](https://github.com/kiwi-init/channels/pull/491))
- **Mentions read as the person's nickname in the app, while the message keeps the @handle (T547)** ([#494](https://github.com/kiwi-init/channels/pull/494))
- **A fresh session starts from its checkpoint, and every hook fits Claude Code's inline limit** ([#488](https://github.com/kiwi-init/channels/pull/488))
- **Tests leave the real MiMoCode folder alone: the preload redirects it and drops its session markers** ([#489](https://github.com/kiwi-init/channels/pull/489))
- **Tasks board: a PR's diff numbers stay inside their column instead of running into the checks (T615)** ([#495](https://github.com/kiwi-init/channels/pull/495))
- **Opening a conversation lands at its newest message, and stays there as it fills in (T534)** ([#493](https://github.com/kiwi-init/channels/pull/493))
- **Needs you is one list with one count, and a question waiting for you shows once (T587)** ([#496](https://github.com/kiwi-init/channels/pull/496))
- **MiMoCode's plugin sends a refused wake again instead of dropping its messages** ([#492](https://github.com/kiwi-init/channels/pull/492))
- **A seat's context shows on its lane, and past 250k the Stop hook asks once for a checkpoint** ([#499](https://github.com/kiwi-init/channels/pull/499))
- **Tasks: one board, one way to open a task, one set of labels (T588)** ([#500](https://github.com/kiwi-init/channels/pull/500))
- **MiMoCode's wake counts as delivered only once the plugin says it landed, so a restart can't lose it** ([#497](https://github.com/kiwi-init/channels/pull/497))
- **On a phone too, opening a conversation lands at its newest message (T718)** ([#502](https://github.com/kiwi-init/channels/pull/502))
- **An agent's status reads the same everywhere, and the agent strip shows only on phones (T589)** ([#501](https://github.com/kiwi-init/channels/pull/501))
- **Channel details: one invite, one notes, one way to let someone in, one add-agent command (T590)** ([#516](https://github.com/kiwi-init/channels/pull/516))
- **kiwi help lists log --json and says it prints JSON Lines** ([#517](https://github.com/kiwi-init/channels/pull/517))
- **A MiMoCode seat is woken even when the plugin can't look up its session** ([#521](https://github.com/kiwi-init/channels/pull/521))
- **Navigation: the sidebar on desktop, tabs on phones; search is a real field; no title repeated (T591)** ([#525](https://github.com/kiwi-init/channels/pull/525))
- **Needs you on Tasks shows a decision as the composer's card (#498)** ([#514](https://github.com/kiwi-init/channels/pull/514))
- **A Codex wake no longer reads as empty: listen --now says when nothing is unread** ([#524](https://github.com/kiwi-init/channels/pull/524))
- **With seats in two channels in one folder, kiwi names both channels, and the Stop hook says which channel each batch is from** ([#523](https://github.com/kiwi-init/channels/pull/523))
- **Claude Code keeps being woken after an upgrade: kiwi rewrites its own stale listen hook** ([#518](https://github.com/kiwi-init/channels/pull/518))
- **Handing a review to someone else keeps the open round and its commit** ([#522](https://github.com/kiwi-init/channels/pull/522))
- **The 'looks like T…' hint no longer matches tasks that only share a suffix like 'stage 6'** ([#519](https://github.com/kiwi-init/channels/pull/519))
- **A Codex session started from Claude Code is no longer served the Claude session's seat** ([#530](https://github.com/kiwi-init/channels/pull/530))
- **A MiMoCode session keeps one listener, and an older kiwi's plugin is brought up to date by itself** ([#531](https://github.com/kiwi-init/channels/pull/531))
- **A Grok seat with a live kiwi listen shows it wakes via its listener** ([#532](https://github.com/kiwi-init/channels/pull/532))
- **Dictation runs Whisper on this computer: the model comes pinned through the relay, and speech never leaves (T176)** ([#529](https://github.com/kiwi-init/channels/pull/529))
- **wake.log records the read cursor each wake's unread count was taken from** ([#535](https://github.com/kiwi-init/channels/pull/535))
- **Dictation works on Linux, checked on the packaged Linux app (T848)** ([#527](https://github.com/kiwi-init/channels/pull/527))
- **kiwi 0.20.5 (T984)**
- **Merge main into T984-release-0.20.5: #538 (dictation's .wasm out of the app)**

## 0.20.4 — 2026-10-19

- **Grok Bot wears its own mark, the round head with two eyes, not Grok's (T424)** ([#486](https://github.com/kiwi-init/channels/pull/486))

## 0.20.3 — 2026-10-19

- **Kimi Code sessions in Kimi's server are woken in place by the daemon (T150)** ([#480](https://github.com/kiwi-init/channels/pull/480))
- **Cursor keeps its own listener running, so it's woken in place in its session (T152)** ([#483](https://github.com/kiwi-init/channels/pull/483))
- **Pi is a known harness: detected, its model read, woken in place by Kiwi's Pi extension, with its logo (T146)** ([#481](https://github.com/kiwi-init/channels/pull/481))
- **MiMoCode is woken in place through Kiwi's plugin, and names its own session (T151)** ([#484](https://github.com/kiwi-init/channels/pull/484))

## 0.20.2 — 2026-10-19

- **Grok Bot is a first-class agent: recognised on its VM, its model recorded, woken through its routine's webhook (T153)** ([#478](https://github.com/kiwi-init/channels/pull/478))

## 0.20.1 — 2026-10-19

- **perf-scale: reload to first screen timed inside the page; CHANGELOG 0.20.0 speed line: every budget met (T1795)** ([#471](https://github.com/kiwi-init/channels/pull/471))
- **Mac downloads under 150 MiB: kiwi bundled zstd-packed (Developer ID signed before packing), maximum compression, release gate at the budget (T1851)** ([#472](https://github.com/kiwi-init/channels/pull/472))
- **Desktop on Linux knows when its keys aren't in a keyring, and moves them into one once it's installed (T1744, part 1, no UI)** ([#473](https://github.com/kiwi-init/channels/pull/473))
- **Landing page: OLED black, monospace, plain HTML, opening on Jow's Century 21 Calling cut (T30)** ([#474](https://github.com/kiwi-init/channels/pull/474))
- **Robot heads become channel icons: picked when creating a channel and from its details (T6)** ([#475](https://github.com/kiwi-init/channels/pull/475))
- **Agents wear their harness's logo instead of a robot head (T7)** ([#476](https://github.com/kiwi-init/channels/pull/476))

## 0.20.0 — 2026-10-19

- **The first stable release: smaller, faster, sturdier.** What "stable" means is in docs/0.20-stable.md. Every one of its 27 must-fix tasks is in.
- **Update the Channels app and the kiwi CLI on every machine, then start a new session for each agent**, so its hooks run the fixed CLI (no more double wakes, lost read marks or 15-second stalls on a hung relay). The relay is deployed with this release.
- **Windows is no longer supported:** there is no Windows CLI, and install.ps1 is gone. The CLI downloads compressed (.xz/.gz), 30 MB at most.
- **Speed against the 0.20 budgets** (jow's Mac at 4x CPU, with 10 agents, 100 tasks and 2000 messages): desktop cold start about 600ms to first paint (was 2.2–2.9s), revisiting a channel 30ms, Tasks 80ms, Agents 49ms, Conversation 98ms, Details 48/62ms, typing p95 32ms, idle 0.6% CPU, a prompt hook p95 102ms, and a hung relay 1.6s per prompt. Reload to first screen is 361ms (≤ 400ms; median of 5 on main after #467). Every speed budget is met.
- **Security:** a message can no longer be replayed to take effect again (T690). Connecting a GitHub repo needs push access to it (T691). Large messages can't crash a channel's history reads (T694).
- **Fold: a signed message counts once, near when it was signed (T690)** ([#421](https://github.com/kiwi-init/channels/pull/421))
- **Web first load imports @kiwi/core's client submodules, not the client.ts barrel: first-load JS 789,931 to 735,589 bytes (T752)** ([#423](https://github.com/kiwi-init/channels/pull/423))
- **docs/0.20-stable.md: what "stable" means for 0.20.0 (T671)** ([#425](https://github.com/kiwi-init/channels/pull/425))
- **A message a prompt or stop hook hands over no longer wakes the session a second time from the listener started with it (T761)** ([#424](https://github.com/kiwi-init/channels/pull/424))
- **A dead socket is noticed: no pong in 10s, or no upgrade in 15s, drops it and reconnects (T712)** ([#422](https://github.com/kiwi-init/channels/pull/422))
- **The app folds its window on the channel's snapshot, so older tasks, scopes and facts survive a reload (T788)** ([#426](https://github.com/kiwi-init/channels/pull/426))
- **Reconnect at once when the network or the Mac comes back: online, a visible page and wake nudge every connection (T713)** ([#427](https://github.com/kiwi-init/channels/pull/427))
- **Daemon socket writes queue what the socket didn't take and flush it on drain, so lines over 8 KB arrive whole (T703)** ([#429](https://github.com/kiwi-init/channels/pull/429))
- **Desktop cold start: scripts cached, window before the keychain read, CLI copy off the main thread (T821)** ([#428](https://github.com/kiwi-init/channels/pull/428))
- **A message this build can't read no longer empties the history cache: it's kept as a sealed unread row, so the window has no hole (T705)** ([#431](https://github.com/kiwi-init/channels/pull/431))
- **A message that lands while a daemon subscriber catches up waits until the catch-up is sent, so the rest isn't skipped (T763)** ([#432](https://github.com/kiwi-init/channels/pull/432))
- **Relay: history reads stop at 4 MB, and a body over 100 000 characters is refused at send (T694)** ([#430](https://github.com/kiwi-init/channels/pull/430))
- **Creating a channel saves the owner key before the relay hears of it, and the next start finishes or forgets a create that didn't (T709)** ([#433](https://github.com/kiwi-init/channels/pull/433))
- **A hook moves the cursor and marks messages read only after it has printed them, so a cut-off hook leaves them unread (T762)** ([#435](https://github.com/kiwi-init/channels/pull/435))
- **A crashed window page reloads by itself, a hung one asks Wait or Reload, and main-process errors go to main.log (T706)** ([#434](https://github.com/kiwi-init/channels/pull/434))
- **Desktop size: no node_modules in app.asar, English locales only, a size check in CI (T823)** ([#436](https://github.com/kiwi-init/channels/pull/436))
- **A Mac that can't replace itself offers the release with the reason, instead of looping on Restart to update (T714)** ([#437](https://github.com/kiwi-init/channels/pull/437))
- **A hung relay costs a prompt or stop hook 1.6s, not 14s, and every relay request gives up after 30s (T764)** ([#438](https://github.com/kiwi-init/channels/pull/438))
- **A tag release without the Mac signing secrets fails instead of publishing an unsigned app that Macs would never update to (T711)** ([#440](https://github.com/kiwi-init/channels/pull/440))
- **Updater failures end at available, with the reason in main.log and a retry in 30 minutes; a vanished staged update doesn't throw at quit (T708)** ([#439](https://github.com/kiwi-init/channels/pull/439))
- **The app keeps its daemon alive: it checks every 30s and starts it again when it stops answering, and the daemon's output goes to KIWI_HOME/daemon.log (T704)** ([#443](https://github.com/kiwi-init/channels/pull/443))
- **A hand-over cut at its 6,000-character limit marks only the messages it showed as read, so the rest comes next (T765)** ([#442](https://github.com/kiwi-init/channels/pull/442))
- **A stalled update download no longer blocks checks: the check returns once the release is known, the zip streams with a 60s idle limit, and a newer release replaces a staged one (T717)** ([#444](https://github.com/kiwi-init/channels/pull/444))
- **An older kiwi keeps a newer daemon running instead of replacing it, as the app already does (T710)** ([#441](https://github.com/kiwi-init/channels/pull/441))
- **The channel clock holds still within its interval: a re-render doesn't refold, one timer per interval (T822)** ([#446](https://github.com/kiwi-init/channels/pull/446))
- **Rate limits: 429 says Retry-After, refused attempts aren't counted, and clients wait it out instead of failing or re-posting (T695)** ([#445](https://github.com/kiwi-init/channels/pull/445))
- **Tasks and Agents at scale: lanes' PRs and unread counts in one pass per state; timeline only on Conversation (T831)** ([#449](https://github.com/kiwi-init/channels/pull/449))
- **One daemon per KIWI_HOME: a lifetime lock, a daemon that loses it exits, and stopping never deletes another daemon's socket (T715)** ([#447](https://github.com/kiwi-init/channels/pull/447))
- **A daemon whose only relays are local ones that stopped answering, with nobody connected, stops by itself (T702)** ([#448](https://github.com/kiwi-init/channels/pull/448))
- **Conversation: mounted rows stay bounded in a long session, and the view keeps following new messages (T826)** ([#450](https://github.com/kiwi-init/channels/pull/450))
- **Conversation per incoming message: live cards in one pass, cheaper row memo, stable pictures context (T1182)** ([#451](https://github.com/kiwi-init/channels/pull/451))
- **A broken config.json no longer fails every hook: hooks exit 0 and say which file to fix (T766)** ([#453](https://github.com/kiwi-init/channels/pull/453))
- **Per-message storage: one IndexedDB connection and transaction per batch, localStorage once per burst (T1252)** ([#456](https://github.com/kiwi-init/channels/pull/456))
- **First load: Base UI's menu, tooltip and dialog load lazily, after first paint; budget 590,000 (T829)** ([#455](https://github.com/kiwi-init/channels/pull/455))
- **Repos picker: relay config and repo list held for minutes, status and repos asked at once (T827)** ([#457](https://github.com/kiwi-init/channels/pull/457))
- **CLI downloads compressed (.xz/.gz, ≤ 30 MB) and no Windows CLI (T776)** ([#452](https://github.com/kiwi-init/channels/pull/452))
- **A Claude session's listener that can't reach the daemon keeps trying, so the session isn't left deaf (T768)** ([#458](https://github.com/kiwi-init/channels/pull/458))
- **GitHub repos: connecting one takes the owner's push access, checked once with their linked token (T691)** ([#454](https://github.com/kiwi-init/channels/pull/454))
- **kiwi who and status answer from the daemon's presence instead of probing the relay every time (T771)** ([#460](https://github.com/kiwi-init/channels/pull/460))
- **wake.log rotates at 1 MB and the daemon prunes week-old hook bookkeeping (T774)** ([#463](https://github.com/kiwi-init/channels/pull/463))
- **kiwi log and kiwi tasks read what this computer already has when the relay is down, and say so (T772)** ([#461](https://github.com/kiwi-init/channels/pull/461))
- **Web bundle: mermaid's ELK layout left out (−1.4MB); perf-scale measures Details (T828, T588)** ([#462](https://github.com/kiwi-init/channels/pull/462))
- **The config lock takes over only a lock whose holder is gone, and never removes a lock it no longer owns (T773)** ([#464](https://github.com/kiwi-init/channels/pull/464))
- **An idle Claude session's listener lasts a week, not a day, so the empty "nothing to do" turn comes weekly (T775)** ([#465](https://github.com/kiwi-init/channels/pull/465))
- **CI gates for the 0.20 budgets: perf / scale on UI PRs, a nightly soak, and a Mac dmg, zip and app size gate (T1170)** ([#459](https://github.com/kiwi-init/channels/pull/459))
- **Relay and daemon failures say what failed, where, and what to do next (T778)** ([#466](https://github.com/kiwi-init/channels/pull/466))
- **An agent's message cache keeps a local fold base and its newest 300 messages, instead of growing for ever (T1545)** ([#468](https://github.com/kiwi-init/channels/pull/468))
- **Long sessions: the message array folds into the base past the window, warm cache LRU of 4, markdown cache 500, mermaid drops its probe, places-seen keeps 500 (T825)** ([#467](https://github.com/kiwi-init/channels/pull/467))
- **Key files survive a crash: writes are fsynced, machine.json and kiwi-store.bin keep a backup, and a broken machine.json is never replaced by a new key (T716)** ([#469](https://github.com/kiwi-init/channels/pull/469))

## 0.19.2 — 2026-10-18

- **Update the Channels app on every machine to see GitHub pictures.** 0.19.2 adds a member picture event; 0.19.1 and older drop it and keep showing initials. No relay or daemon change, and agents keep their sessions.
- **Faster.** A new message renders one row instead of all of them, markdown parses once, only the newest 120 messages mount, a revisited channel opens in ~36ms, and nothing animates forever: at 4x CPU with 400 messages, Details opens in ~90ms (was ~400–1000).
- **Every run on main gets a verdict: no push or rehearsal cancels another into a red ci-ok (T288)** ([#410](https://github.com/kiwi-init/channels/pull/410))
- **Prism only in the sidebar: the kit, header tabs, Settings, Personalities and the side panels back to the quiet look (T331)** ([#412](https://github.com/kiwi-init/channels/pull/412))
- **Prism out of the conversation: composer, send, message lines, reactions, hover actions and Needs you back to the quiet look (T332)** ([#411](https://github.com/kiwi-init/channels/pull/411))
- **Prism means one thing: only the open channel and the chosen view or conversation are lit; search, rail buttons, idle tiles and counts plain (T387)** ([#413](https://github.com/kiwi-init/channels/pull/413))
- **Off-screen messages skip layout and paint, so Details opens and closes with half the layout work (T400, part 1)** ([#414](https://github.com/kiwi-init/channels/pull/414))
- **Switching channels: a revisit renders at once from a verified, in-memory copy, 607ms to 36ms at 4x CPU (T419)** ([#415](https://github.com/kiwi-init/channels/pull/415))
- **Connect a repo from a searchable list of the repos your linked GitHub account reaches, in the details panel (T476)** ([#417](https://github.com/kiwi-init/channels/pull/417))
- **Conversation: a message renders once, markdown parses once, the newest 120 rows mount, and busy dots don't pulse (T334)** ([#418](https://github.com/kiwi-init/channels/pull/418))
- **Sidebar: clicking an agent opens your direct conversation with it; its task id beside it opens the task (T467)** ([#416](https://github.com/kiwi-init/channels/pull/416))
- **A person's face is their GitHub avatar once they've linked GitHub, carried in the channel so no page loads from GitHub (T477)** ([#419](https://github.com/kiwi-init/channels/pull/419))

## 0.19.1 — 2026-10-18

- **The app only.** No wire, relay, CLI or daemon change since 0.19.0: update the Channels app (a 0.19.0 Mac app finds it on its own within a few hours; from 0.19.1 on, Settings → Check for updates asks at once), and agents keep their sessions.
- **The shell in two tones: the rails darker, the page a round sheet (T12)** ([#398](https://github.com/kiwi-init/channels/pull/398))
- **Settings: Check for updates, on demand (T13)** ([#397](https://github.com/kiwi-init/channels/pull/397))
- **A channel wears its lead's head everywhere, not only when the lead spoke last (T28)** ([#400](https://github.com/kiwi-init/channels/pull/400))
- **No modals: Settings and Personalities are pages, Invite a view of the details panel (T11)** ([#399](https://github.com/kiwi-init/channels/pull/399))
- **Selected states read clearly: segments rise off their track, chosen chips and rows wear the accent (T14)** ([#401](https://github.com/kiwi-init/channels/pull/401))
- **Prism glass: the look of the app icon and the agents' heads, as tokens and primitives (T142)** ([#402](https://github.com/kiwi-init/channels/pull/402))
- **UI shots follow today's dashboard and run in CI, as build / shots (T38)** ([#404](https://github.com/kiwi-init/channels/pull/404))
- **Phone: an info button in the channel header opens Details (T153)** ([#403](https://github.com/kiwi-init/channels/pull/403))
- **Prism on the shell: rails, rows, tabs, side panels, Settings and Personalities (T143)** ([#406](https://github.com/kiwi-init/channels/pull/406))
- **Prism in the conversation: the composer floats in glass, send is the orb (T144)** ([#405](https://github.com/kiwi-init/channels/pull/405))
- **Shots: the Details screens on a phone again, now that T153 opens Details there** ([#407](https://github.com/kiwi-init/channels/pull/407))
- **Checkbox: the prism square, checked as the orb (T220)** ([#408](https://github.com/kiwi-init/channels/pull/408))

## 0.19.0 — 2026-10-18

- **Update every machine and start a new session for each agent.** 0.19.0 adds events and fields that older clients drop, and the relay must be deployed for the CI-red log excerpt and GitHub issues; the owner's steps are in docs/0.19-release.md.
- **Linux: the app says an update is ready but doesn't install it itself.** Signing the AppImage's updates (T596) isn't in 0.19; download the new AppImage or .deb from the release.
- **Replies sit in the conversation with an inline quote, as in Messages (T430)** ([#367](https://github.com/kiwi-init/channels/pull/367))
- **UI smoke: a task's message is checked outside its card in one read of the page, until it settles (T489)** ([#368](https://github.com/kiwi-init/channels/pull/368))
- **Agents wear glass fragments in the app icon's style, with no ring around them (T600)** ([#369](https://github.com/kiwi-init/channels/pull/369))
- **Desktop: the app's own pages may write to the clipboard, so copy buttons copy again (T581)** ([#370](https://github.com/kiwi-init/channels/pull/370))
- **Voice: a Grok Voice realtime adapter in web/src/lib/voice, tested on JSON fixtures (T12)** ([#371](https://github.com/kiwi-init/channels/pull/371))
- **Voice: what the live session is told as the channel moves, and the snapshot it starts from (T14)** ([#372](https://github.com/kiwi-init/channels/pull/372))
- **An escalation waits until one of the people it went to answers it, not anyone who replies (T654)** ([#373](https://github.com/kiwi-init/channels/pull/373))
- **GitHub: a task imported from an issue, and closing either one closes the other (T453)** ([#374](https://github.com/kiwi-init/channels/pull/374))
- **Needs you as rows with the answers on them, and an answered ask says who chose what (T686)** ([#375](https://github.com/kiwi-init/channels/pull/375))
- **Web: the conversation without bubbles (T687, UI 5/6)** ([#377](https://github.com/kiwi-init/channels/pull/377))
- **Voice: Talk to channel, once the owner allows it and the person turns it on (T15)** ([#376](https://github.com/kiwi-init/channels/pull/376))
- **Web: the new channel shell, one flat background, sidebar and Tasks / Agents / Conversation tabs (T683)** ([#378](https://github.com/kiwi-init/channels/pull/378))
- **Voice: the fast tools, answered from the channel the app already holds (T13)** ([#379](https://github.com/kiwi-init/channels/pull/379))
- **Web: the Tasks view, the board in groups with two-line rows: live activity, PR with diff bar, checks (T684)** ([#381](https://github.com/kiwi-init/channels/pull/381))
- **Agents tab: one lane per agent, with what it runs now, its tasks and PRs, its queue and last moves (T688)** ([#380](https://github.com/kiwi-init/channels/pull/380))
- **Tasks: where a task comes from (--from), and kiwi task who ranks who has its context (T780, routing 1/3)** ([#383](https://github.com/kiwi-init/channels/pull/383))
- **Voice: spoken verbs, yes, hold and stop, each acting only on what was just read back (T16)** ([#382](https://github.com/kiwi-init/channels/pull/382))
- **Web: a task opens inline in Tasks: its conversation, a reply box, and the PR card with files, diff and each check (T685)** ([#384](https://github.com/kiwi-init/channels/pull/384))
- **Tasks: a task keeps the folders its branch changed, and kiwi task who ranks whoever changed them lately (T781, routing 2/3)** ([#385](https://github.com/kiwi-init/channels/pull/385))
- **CI red becomes a task: the failing check, a log excerpt and the commit, for whoever pushed (T51)** ([#386](https://github.com/kiwi-init/channels/pull/386))
- **Personality on the owner-signed member record: role, capabilities held like scopes, areas, instructions in the brief (T873)** ([#387](https://github.com/kiwi-init/channels/pull/387))
- **Tasks: warm work, what an agent's session still holds, leads kiwi task who and the app's suggestion (T782, routing 3/3)** ([#388](https://github.com/kiwi-init/channels/pull/388))
- **Let in and the member menu pick a personality; changing it re-signs the record (T861)** ([#390](https://github.com/kiwi-init/channels/pull/390))
- **Personalities on the person's account: the six presets, your own, and Settings → Personalities (T860)** ([#389](https://github.com/kiwi-init/channels/pull/389))
- **The inviter pins a personality in the invite; Let in defaults to it and the agent can't change it (T862)** ([#391](https://github.com/kiwi-init/channels/pull/391))
- **Members: the personality is the only description; an old channel's roles read as personalities (T868, part 1 of 3)** ([#393](https://github.com/kiwi-init/channels/pull/393))
- **The claims scope is gone, and an agent's card no longer repeats what runs says (T1006)** ([#394](https://github.com/kiwi-init/channels/pull/394))
- **Web: first-load JS back to 779 721 bytes, under a 790 000 budget that doesn't go up for a feature (T1018)** ([#395](https://github.com/kiwi-init/channels/pull/395))
- **Members: nothing writes roles any more; the owner gives a personality (T868, part 2 of 3)** ([#396](https://github.com/kiwi-init/channels/pull/396))

## 0.18.0 — 2026-10-18

- **Update every machine and start a new session for each agent.** 0.18.0 adds events that older clients drop, and the relay must be deployed for claims, leases and the GitHub App; the owner's GitHub setup is in docs/0.18-release.md.
- **Release: the publish job installs dependencies before it writes the notes** ([#330](https://github.com/kiwi-init/channels/pull/330))
- **Cards follow the agent's branch: the prompt and stop hooks re-send repo@branch when it changed** ([#331](https://github.com/kiwi-init/channels/pull/331))
- **Tasks: a title past 200 characters is refused with a reason, not announced as added (T56)** ([#335](https://github.com/kiwi-init/channels/pull/335))
- **Demo: --stay prints a plain join link and lets the dashboard in itself (T58)** ([#336](https://github.com/kiwi-init/channels/pull/336))
- **A channel records its repos, and status flags an agent working from another one** ([#332](https://github.com/kiwi-init/channels/pull/332))
- **The app shows an agent's repo@branch, and flags one from a repo the channel doesn't list** ([#337](https://github.com/kiwi-init/channels/pull/337))
- **Coordination: task claims and answering #N are compare-and-set on the relay (T27)** ([#333](https://github.com/kiwi-init/channels/pull/333))
- **Coordinator-only mode is gone; the coordinator role becomes an optional lead (T33)** ([#338](https://github.com/kiwi-init/channels/pull/338))
- **One verb for asking a person: help and the MCP escalate tool point to ask-human (T66)** ([#342](https://github.com/kiwi-init/channels/pull/342))
- **git blame skips the oxfmt reformat (.git-blame-ignore-revs)** ([#328](https://github.com/kiwi-init/channels/pull/328))
- **Coordination: leases with a line, kiwi lock and kiwi unlock (T29)** ([#339](https://github.com/kiwi-init/channels/pull/339))
- **CLI: reply, react and show pick the seat that was shown the message (T64)** ([#340](https://github.com/kiwi-init/channels/pull/340))
- **Timeline: notes, claims and reactions leave the conversation (T31)** ([#341](https://github.com/kiwi-init/channels/pull/341))
- **ui-smoke: a task's card in the conversation shows its last line, and a click opens the Tasks panel (T8)** ([#343](https://github.com/kiwi-init/channels/pull/343))
- **Standup: the live-card model moves into core (T6)** ([#334](https://github.com/kiwi-init/channels/pull/334))
- **Digest: closing a task posts a one-line summary in the main conversation (T87)** ([#344](https://github.com/kiwi-init/channels/pull/344))
- **Standup: room chips on the canvas filter the task cards (T9)** ([#345](https://github.com/kiwi-init/channels/pull/345))
- **Tasks: proof on the task, a link a reviewer can open (T74)** ([#346](https://github.com/kiwi-init/channels/pull/346))
- **Web: an agent's question lives in the composer, with clickable options (T23)** ([#348](https://github.com/kiwi-init/channels/pull/348))
- **Fix typos in AGENTS.md** ([#347](https://github.com/kiwi-init/channels/pull/347))
- **Web: the microphone says why dictation can't run and stays, instead of vanishing (T304)** ([#350](https://github.com/kiwi-init/channels/pull/350))
- **Handles: a new handle is adjective-animal (gentle-otter), not animal-adjective (T349)** ([#353](https://github.com/kiwi-init/channels/pull/353))
- **Delivery: #general, your rooms and threads, and @mentions are pushed; the rest is pulled (T35)** ([#349](https://github.com/kiwi-init/channels/pull/349))
- **GitHub App webhooks reach a channel's queue at the relay (T37, design B, relay half)** ([#351](https://github.com/kiwi-init/channels/pull/351))
- **Web: a slash in the composer lists commands, and one runs instead of being sent (T325)** ([#354](https://github.com/kiwi-init/channels/pull/354))
- **test/slots: the loser of a race may be refused before sending, so accept that text too** ([#355](https://github.com/kiwi-init/channels/pull/355))
- **GitHub's news reaches the channel: the owner's app drains the relay's queue into signed events (T37)** ([#356](https://github.com/kiwi-init/channels/pull/356))
- **A PR on a task shows GitHub's state, title and checks, not the chat's guess (T43)** ([#358](https://github.com/kiwi-init/channels/pull/358))
- **A PR on a branch named T<n>-… shows on task T<n>, with its branch (T72, first part)** ([#359](https://github.com/kiwi-init/channels/pull/359))
- **/compact: fold the history behind an approved summary and archive finished tasks (T326)** ([#357](https://github.com/kiwi-init/channels/pull/357))
- **The relay calls GitHub as the App: diffs for members, the kiwi/review check for the owner (T45, relay half)** ([#361](https://github.com/kiwi-init/channels/pull/361))
- **CLI: one way to say where a message goes, kiwi send --to WHERE (T80)** ([#362](https://github.com/kiwi-init/channels/pull/362))
- **GitHub: a person links their GitHub account in the desktop app, by device flow (T41)** ([#360](https://github.com/kiwi-init/channels/pull/360))
- **A review round shows its diff, and the owner's app posts each verdict as the kiwi/review check (T45, app half)** ([#363](https://github.com/kiwi-init/channels/pull/363))
- **A PR on a T<n>-… branch links back to its task: the owner's app comments once (T72, second part)** ([#365](https://github.com/kiwi-init/channels/pull/365))

## 0.17.0 — 2026-10-17

- **The desktop app is now Channels, with a new icon and its own bundle ID.** Kiwi.app does not update to it: install Channels from the release, pair this computer again, then remove Kiwi.app (both answer kiwi:// links). The `kiwi` CLI, `kiwi://` links and `~/.kiwi` are unchanged.
- **Docs: the README shows the app's channel view and uses the app icon** (T1147)
- **Web: each open task is one live card in the main conversation** (T1253)
- **UI smoke: a task's message may show in main only inside its live task card**
- **Bus: no more mergiraf, so the bus no longer depends on codeberg.org** ([#292](https://github.com/kiwi-init/channels/pull/292))
- **CI: the bus plans a test merge from main, and a web-only change no longer runs the macOS job** ([#293](https://github.com/kiwi-init/channels/pull/293))
- **Bus: a branch whose own CI is green and that merges cleanly lands at once, without a staging run** ([#294](https://github.com/kiwi-init/channels/pull/294))
- **Bus: a PR labelled queue takes the fast path too, on its own CI run** ([#295](https://github.com/kiwi-init/channels/pull/295))
- **Remove the merge bus: back to a normal pull request flow** ([#298](https://github.com/kiwi-init/channels/pull/298))
- **Docs: DESIGN.md sections 3 to 5 match web/src/index.css (T550)** ([#299](https://github.com/kiwi-init/channels/pull/299))
- **Web: a long inline command copies with one click, the copy button on code blocks shows on touch, and agents are told to put commands in code (T768)** ([#300](https://github.com/kiwi-init/channels/pull/300))
- **Avatars: agents wear robot heads, and the coordinator's animated head is gone (T456)** ([#296](https://github.com/kiwi-init/channels/pull/296))
- **Desktop: mic entitlement, CSP for api.x.ai when a voice key is set, and an ephemeral token mint (T11)** ([#297](https://github.com/kiwi-init/channels/pull/297))
- **Address the review on #248: snapshot contiguity, watch presence, blob quota, image notices, test hygiene** ([#254](https://github.com/kiwi-init/channels/pull/254))
- **CI: 28 jobs become 10, one per area, each with a timeout** ([#301](https://github.com/kiwi-init/channels/pull/301))
- **Split the conflict hotspots: client.ts, relay/room.ts and agent.ts into modules (pure moves)** ([#249](https://github.com/kiwi-init/channels/pull/249))
- **Web: reach root src/ only through @mc, and keep the relay URL in one place** ([#302](https://github.com/kiwi-init/channels/pull/302))
- **Repo: Bun workspaces, one lockfile, one TypeScript** ([#303](https://github.com/kiwi-init/channels/pull/303))
- **Web: split conversation.tsx into components/conversation/** ([#309](https://github.com/kiwi-init/channels/pull/309))
- **State: split src/state.ts into modules under src/state/** ([#308](https://github.com/kiwi-init/channels/pull/308))
- **Web: split lib/channel.ts into lib/channel/** ([#311](https://github.com/kiwi-init/channels/pull/311))
- **CI: the no-comments rule is no longer enforced, and a comment in a catch block is allowed** ([#307](https://github.com/kiwi-init/channels/pull/307))
- **CLI: move joinedText and agentPrompt out of main.ts into src/cli/brief.ts** ([#305](https://github.com/kiwi-init/channels/pull/305))
- **Web: split components/controls.tsx into components/controls/** ([#312](https://github.com/kiwi-init/channels/pull/312))
- **Desktop: split main.ts into modules, and keyring's wire server into keys-server.ts (pure moves)** ([#304](https://github.com/kiwi-init/channels/pull/304))
- **Daemon: split src/daemon.ts into modules under src/daemon/ (pure moves)** ([#306](https://github.com/kiwi-init/channels/pull/306))
- **Config: split src/config.ts into modules under src/config/** ([#310](https://github.com/kiwi-init/channels/pull/310))
- **Hooks: split src/hooks.ts into modules under src/hooks/ (pure moves)** ([#313](https://github.com/kiwi-init/channels/pull/313))
- **CLI: split src/cli/main.ts into modules under src/cli/ (pure moves)** ([#314](https://github.com/kiwi-init/channels/pull/314))
- **CI: a push to main cancels main's run still in progress** ([#315](https://github.com/kiwi-init/channels/pull/315))
- **Changelog: titles only, and the description check leaves ci-ok** ([#316](https://github.com/kiwi-init/channels/pull/316))
- **jev-ci: plan ci.yml and jev-ci.yml edits per job, judge module splits, narrower flows and macOS triggers** ([#317](https://github.com/kiwi-init/channels/pull/317))
- **Lint the whole repo with oxlint, and fix every finding** ([#318](https://github.com/kiwi-init/channels/pull/318))
- **jev-ci: a comma expression in diff.ts becomes a block, so lint passes on main** ([#321](https://github.com/kiwi-init/channels/pull/321))
- **Web: a malformed link fragment like #% no longer crashes the app** ([#319](https://github.com/kiwi-init/channels/pull/319))
- **Comments that named src/daemon.ts point at the module that now holds the code** ([#320](https://github.com/kiwi-init/channels/pull/320))
- **Move the shared code into packages/core, the @kiwi/core workspace package** ([#322](https://github.com/kiwi-init/channels/pull/322))
- **Desktop: a new app icon, the glass starburst** ([#323](https://github.com/kiwi-init/channels/pull/323))
- **Add philosophy section to AGENTS.md** ([#324](https://github.com/kiwi-init/channels/pull/324))
- **Desktop: the app is Channels, with its own bundle ID** ([#325](https://github.com/kiwi-init/channels/pull/325))
- **Web: the dashboard calls the app Channels** ([#326](https://github.com/kiwi-init/channels/pull/326))
- **Format the root packages with oxfmt, and lint site/app.js** ([#327](https://github.com/kiwi-init/channels/pull/327))

## 0.16.2 — 2026-10-17

- **Wake: a daemon with the app's PATH still finds the harness, and wake.log says why a wake failed** (T544)
- **Agents: kiwi ask-human sends a decision to a person, with options** ([#286](https://github.com/kiwi-init/channels/issues/286))
- **Web: a person can cancel a task, and send back a review waiting on an agent** ([#288](https://github.com/kiwi-init/channels/issues/288))
- **Web: a person can hand a task's review to another reviewer** ([#290](https://github.com/kiwi-init/channels/issues/290))
- **Web: the Tasks panel gets the overview's state tabs, and the rail has room for them** ([#289](https://github.com/kiwi-init/channels/issues/289))
- **Web: #N in a message jumps to message N in the channel** ([#285](https://github.com/kiwi-init/channels/issues/285))
- **Needs you: every question the channel badge counts now has a card**
- **Web: the invite dialog names the agent's nickname, and writes --nick** (T473)
- **shoot-ui: gets through first run again and shoots every screen, phone size included** ([#287](https://github.com/kiwi-init/channels/issues/287))

## 0.16.1 — 2026-10-16

- **Reactions: GIF reactions and a GIF picker in the composer** (T336)
- **Web: the sidebar is always the rail** (T415)

## 0.16.0 — 2026-10-16

- **Test: the cross-folder seat test compares folders by real path, so it passes on macOS (#269)** ([#270](https://github.com/kiwi-init/channels/pull/270))
- **Bus: a single-writer merge bus in .github/bus** ([#251](https://github.com/kiwi-init/channels/pull/251))
- **Sh: thread and review fields in the files, and SQL with query** ([#264](https://github.com/kiwi-init/channels/issues/264))
- **Web: in coordinator mode a person's replies stay in the conversation** ([#267](https://github.com/kiwi-init/channels/issues/267))
- **Escalations: hand a live browser tab to a person** ([#265](https://github.com/kiwi-init/channels/issues/265))
- **Test: the daemon-seats activity test removes the binding it adds, so a live pid 4242 can't fail the status test (#276)** ([#277](https://github.com/kiwi-init/channels/pull/277))
- **CI: macOS tests and a release rehearsal run on the PR, not at tag time (#273)** ([#274](https://github.com/kiwi-init/channels/pull/274))
- **Web: click a picture in the chat to mark it up and reply with it** ([#275](https://github.com/kiwi-init/channels/pull/275))
- **Docs: a shorter README, agent detail in docs/agents.md, mcp.md caught up**
- **Composer: images dragged in or pasted are compressed under the limit** (T315)
- **Web: a microphone button in the composer dictates into the message** (T316)
- **Brief: agents write like teammates in a chat channel** ([#267](https://github.com/kiwi-init/channels/issues/267))
- **Test: two tests that failed on main but passed on bus/staging stop racing the clock** (T362)
- **Test: wake.test.ts counts only fake harness calls that finished, so it can't read a call mid-write** ([#278](https://github.com/kiwi-init/channels/issues/278))
- **Hooks: Grok's kind field counts as a task's type, and kiwi's hooks are recognised through a wrapper** ([#280](https://github.com/kiwi-init/channels/issues/280))
- **Seats: a restarted session on another model no longer takes a seat** ([#282](https://github.com/kiwi-init/channels/issues/282))
- **Presence: a Kimi Code seat with a live listener shows how it is woken** ([#283](https://github.com/kiwi-init/channels/issues/283))
- **Web: Settings stops overflowing at large text sizes and shows the app version** ([#284](https://github.com/kiwi-init/channels/issues/284))

## 0.15.0 — 2026-10-16

- **Relay: a stored message costs no storage read on a warm room, with a relay / budget gate** ([#218](https://github.com/kiwi-init/channels/pull/218))
- **Desktop: the packaged app turns off Electron's RunAsNode, NODE_OPTIONS and --inspect fuses (#215)** ([#216](https://github.com/kiwi-init/channels/pull/216))
- **Relay: presence frames only go to sockets that want them** ([#219](https://github.com/kiwi-init/channels/pull/219))
- **Relay: store message ciphertext as bytes, 25% less storage** ([#231](https://github.com/kiwi-init/channels/pull/231))
- **Relay: read marks only go to sockets that show them** ([#221](https://github.com/kiwi-init/channels/pull/221))
- **CLI and app: one GET /info per command and per channel view** ([#223](https://github.com/kiwi-init/channels/pull/223))
- **CLI: one command fetches the log once** ([#222](https://github.com/kiwi-init/channels/pull/222))
- **MCP: wait_for_messages keeps one live socket for the whole server** ([#227](https://github.com/kiwi-init/channels/pull/227))
- **Relay and CLI: GET /members and /info answer 304 when nothing changed** ([#225](https://github.com/kiwi-init/channels/pull/225))
- **Presence: an agent shows online only when a session of it would answer (#235)** ([#236](https://github.com/kiwi-init/channels/pull/236))
- **AGENTS.md: in English, and long-running processes run detached** ([#239](https://github.com/kiwi-init/channels/pull/239))
- **Client: a socket's first open keeps the session's info read** ([#240](https://github.com/kiwi-init/channels/pull/240))
- **Web: the join dialog and needs-you banner close once the agent is in, and error toasts are readable (#237)** ([#238](https://github.com/kiwi-init/channels/pull/238))
- **Test: a kept read's expiry runs on a set clock, not on runner speed** ([#242](https://github.com/kiwi-init/channels/pull/242))
- **jev-ci: the planner takes the PR's base from the merge commit** ([#241](https://github.com/kiwi-init/channels/pull/241))
- **Relay: serve complete old message pages from the edge cache (off unless KIWI_PAGE_KEY is set)** ([#232](https://github.com/kiwi-init/channels/pull/232))
- **Relay: a page's messages are decoded like /messages, so a cold cache reads all of them** ([#244](https://github.com/kiwi-init/channels/pull/244))
- **Web: overview cards in the chat, and a compact channel rail** ([#243](https://github.com/kiwi-init/channels/pull/243))
- **App: send over the open socket, without the relay echoing the message back** ([#224](https://github.com/kiwi-init/channels/pull/224))
- **UI smoke: two halves run side by side, Chromium cached** ([#245](https://github.com/kiwi-init/channels/pull/245))
- **Seats: a session that holds two seats is woken for both, and the bare CLI names both (#246)** ([#247](https://github.com/kiwi-init/channels/pull/247))
- **Consolidate #226, #228, #229, #230, #233, #234: daemon hooks, one-socket catch-up, compression, watch sockets, image blobs, snapshots** ([#248](https://github.com/kiwi-init/channels/pull/248))
- **Test: restore the broken seat's key only after the first hook gave its slot back (#258)** ([#259](https://github.com/kiwi-init/channels/pull/259))
- **Web: mermaid code blocks in messages draw as diagrams** ([#262](https://github.com/kiwi-init/channels/pull/262))
- **Docs: how kiwi could wake OpenCode v2, Kimi Code, MiMoCode and Grok sessions (#253)** ([#255](https://github.com/kiwi-init/channels/pull/255))
- **Hooks: a session is woken for a seat it joined from another folder (#250)** ([#252](https://github.com/kiwi-init/channels/pull/252))
- **CLI: Kimi Code and Grok agents are told exactly how to keep themselves wakeable (#256)** ([#257](https://github.com/kiwi-init/channels/pull/257))

## 0.14.0 — 2026-10-15

- **The coordinator head animates briefly, then rests (#174)** ([#175](https://github.com/kiwi-init/channels/pull/175))
- **T49: channel keys leave the page (key process)** ([#169](https://github.com/kiwi-init/channels/pull/169))
- **Review rounds: a review opens a round at a commit, and a verdict judges that round with the review in one message** ([#176](https://github.com/kiwi-init/channels/pull/176))
- **Repo: a Knip gate, and the dead code it finds removed (#177)** ([#181](https://github.com/kiwi-init/channels/pull/181))
- **CLI: a smaller, faster kiwi binary (#178)** ([#183](https://github.com/kiwi-init/channels/pull/183))
- **Web: split the bundle so the first screen loads less (#179)** ([#184](https://github.com/kiwi-init/channels/pull/184))
- **Agents get a random handle and a nickname (#182)** ([#185](https://github.com/kiwi-init/channels/pull/185))
- **Format: member and relay text reaches the terminal clean (#186)** ([#187](https://github.com/kiwi-init/channels/pull/187))
- **CLI: channel aliases are names, and the commands that carry them are quoted (#188)** ([#189](https://github.com/kiwi-init/channels/pull/189))
- **Site: /join/ paths read only real join codes, with a site test job (#190)** ([#191](https://github.com/kiwi-init/channels/pull/191))
- **CI: actions pinned to commit SHAs, with a gate that keeps them pinned (#192)** ([#193](https://github.com/kiwi-init/channels/pull/193))
- **Docs, installers: private vulnerability reports, and security claims that match what runs (#194)** ([#195](https://github.com/kiwi-init/channels/pull/195))
- **Listeners register with the daemon; installs clean up what older ones left (#156)** ([#196](https://github.com/kiwi-init/channels/pull/196))
- **Web, desktop: a relay URL is a plain origin before it goes into a copied command (#197)** ([#198](https://github.com/kiwi-init/channels/pull/198))
- **Desktop: links open in the person's own browser, not under Kiwi's name (#199)** ([#208](https://github.com/kiwi-init/channels/pull/208))
- **Release: deploy the relay Worker after the GitHub release** ([#207](https://github.com/kiwi-init/channels/pull/207))
- **Repo: ignore local secret and data files (#204)** ([#205](https://github.com/kiwi-init/channels/pull/205))
- **Desktop: the macOS updater only swaps in a bundle signed like the running app (#200)** ([#201](https://github.com/kiwi-init/channels/pull/201))
- **Desktop: Linux AppImage installs offer updates instead of swapping themselves (#209)** ([#210](https://github.com/kiwi-init/channels/pull/210))
- **CLI: kiwi cleanup finds an old Bun install behind a symlinked folder (#213)** ([#214](https://github.com/kiwi-init/channels/pull/214))

## 0.13.0 — 2026-10-15

- **Delete agent development specs and labels**
- **AGENTS.md: drop the /shared and stream rules** ([#165](https://github.com/kiwi-init/channels/pull/165))
- **T24: remove the direct-thread faces beside the channel name** ([#164](https://github.com/kiwi-init/channels/pull/164))
- **Update every dependency to its latest version** ([#166](https://github.com/kiwi-init/channels/pull/166))
- **T11: web/ lints with oxlint and formats with oxfmt** ([#167](https://github.com/kiwi-init/channels/pull/167))
- **T48: CI guard repo / comments fails on comments in added lines** ([#168](https://github.com/kiwi-init/channels/pull/168))
- **Seats always on: the daemon keeps every agent's seat open** ([#163](https://github.com/kiwi-init/channels/pull/163))
- **Faster test gates: a short join poll in tests, and test files in parallel** ([#170](https://github.com/kiwi-init/channels/pull/170))
- **Wake: the daemon starts a turn in the agent's running session** ([#171](https://github.com/kiwi-init/channels/pull/171))
- **CLI fixes from agent feedback: Kimi Code and MiMoCode, folder seats, reject wording, removal reason, send --file** ([#172](https://github.com/kiwi-init/channels/pull/172))

## 0.12.0 — 2026-10-14

- **CI: jev-ci plans which checks a pull request can break, and more real checks** ([#104](https://github.com/kiwi-init/channels/pull/104))
- **T29: hooks tell agents to kiwi listen, not kiwi tail** ([#106](https://github.com/kiwi-init/channels/pull/106))
- **T27: docs match 0.11 (desktop, daemon, seats, harness/model)** ([#105](https://github.com/kiwi-init/channels/pull/105))
- **T69: web fixes from the 0.12.0 channel (approve race, coordinator role, composer focus)** ([#108](https://github.com/kiwi-init/channels/pull/108))
- **Reactions, and 👀 when an agent takes on a person's ask in coordinator mode (T75)** ([#109](https://github.com/kiwi-init/channels/pull/109))
- **T28: drop unused 0.10 vault, device-handover and vouch clients** ([#110](https://github.com/kiwi-init/channels/pull/110))
- **Tasks in a right panel, the header's capsule just the channel's name (T80)** ([#115](https://github.com/kiwi-init/channels/pull/115))
- **T103: time out kiwi listen --webhook POSTs** ([#116](https://github.com/kiwi-init/channels/pull/116))
- **T101: kiwi daemon SIGTERM during startup exits 0** ([#111](https://github.com/kiwi-init/channels/pull/111))
- **T106: chmod daemon.sock 0600; lock KIWI_HOME 0700** ([#112](https://github.com/kiwi-init/channels/pull/112))
- **T102: reap daemon listen seats when the client drops** ([#114](https://github.com/kiwi-init/channels/pull/114))
- **T104: kiwi --as typo does not mint a new identity** ([#117](https://github.com/kiwi-init/channels/pull/117))
- **T105: Grok with CLAUDECODE binds as grok, not Claude** ([#113](https://github.com/kiwi-init/channels/pull/113))
- **T108: docs match listen — CLI/hooks/MCP still open their own streams** ([#118](https://github.com/kiwi-init/channels/pull/118))
- **T23: the installer puts kiwi on your PATH (#101)** ([#119](https://github.com/kiwi-init/channels/pull/119))
- **T25: sign-in can move to our own domain (#93)** ([#120](https://github.com/kiwi-init/channels/pull/120))
- **T111: asking to join needs the join code's fingerprint** ([#121](https://github.com/kiwi-init/channels/pull/121))
- **T24: the changelog writes itself from squash-merged commits (#100)** ([#122](https://github.com/kiwi-init/channels/pull/122))
- **T110: the relay rate limiter drops the oldest window, not every window** ([#123](https://github.com/kiwi-init/channels/pull/123))
- **T112: the relay caps members and their keys from the start** ([#124](https://github.com/kiwi-init/channels/pull/124))
- **T199: retry opening a channel on a relay blip** ([#126](https://github.com/kiwi-init/channels/pull/126))
- **T200: a join-poll blip stays on waiting** ([#127](https://github.com/kiwi-init/channels/pull/127))
- **Desktop security: window lock, relay from the store, store never wiped, CSP, path containment (T183–T188, T192)** ([#128](https://github.com/kiwi-init/channels/pull/128))
- **T113: the per-person channel quota holds when creates run at once** ([#132](https://github.com/kiwi-init/channels/pull/132))
- **T107: map seat claude to runs claude-code** ([#131](https://github.com/kiwi-init/channels/pull/131))
- **T202: forget a computer only after its agents are removed** ([#130](https://github.com/kiwi-init/channels/pull/130))
- **T201: notify remaining join asks if auto-approve fails** ([#129](https://github.com/kiwi-init/channels/pull/129))
- **T45: one installer, served from site/** ([#133](https://github.com/kiwi-init/channels/pull/133))
- **Desktop bugs T189–T195: deep links, pairing race, AppImage update, token refresh, notifications, daemon relay** ([#125](https://github.com/kiwi-init/channels/pull/125))
- **T204: stale copy and browser pairing** ([#134](https://github.com/kiwi-init/channels/pull/134))
- **T115: a socket's failed frame never echoes exception text** ([#135](https://github.com/kiwi-init/channels/pull/135))
- **Desktop: the app icon (G3), every size, and Linux finds it under Wayland** ([#107](https://github.com/kiwi-init/channels/pull/107))
- **AGENTS.md: the rules for agents in this repo** ([#141](https://github.com/kiwi-init/channels/pull/141))
- **T114: the relay no longer moves a seat to a new key** ([#140](https://github.com/kiwi-init/channels/pull/140))
- **T109: the Bun relay leaves no room file for a refused create** ([#139](https://github.com/kiwi-init/channels/pull/139))
- **T198: channel list is the secrets store** ([#137](https://github.com/kiwi-init/channels/pull/137))
- **T197: poll listed channel heads so unread dots work** ([#136](https://github.com/kiwi-init/channels/pull/136))
- **T430: the desktop daemon client fails at once when the daemon closes** ([#149](https://github.com/kiwi-init/channels/pull/149))
- **T551: listen calls onNotice for join requests** ([#148](https://github.com/kiwi-init/channels/pull/148))
- **Read receipt under your newest reply in a thread, too (T74)** ([#150](https://github.com/kiwi-init/channels/pull/150))
- **T203 step 1: the person key stays in main** ([#151](https://github.com/kiwi-init/channels/pull/151))
- **T332 PR 1: the daemon's seat does what a listener does** ([#152](https://github.com/kiwi-init/channels/pull/152))

## 0.11.0 — 2026-10-14

- **Read receipts: your newest message says when its agents have read it (T1554)** ([#84](https://github.com/kiwi-init/channels/pull/84))
- **Hooks name this session's own seat, never another agent's (T1571)** ([#85](https://github.com/kiwi-init/channels/pull/85))
- **Sidebar: tasks grouped by state, in words (T1651)** ([#88](https://github.com/kiwi-init/channels/pull/88))
- **Apple Messages colours for the accent and bubbles (T1555)** ([#89](https://github.com/kiwi-init/channels/pull/89))
- **Coordinator mode on/off is easy to find (T1565)** ([#87](https://github.com/kiwi-init/channels/pull/87))
- **Drop T1555 screenshots from the repo (kept in PR #89's record)** ([#90](https://github.com/kiwi-init/channels/pull/90))
- **Seat on first approval: a computer's seat in a channel takes the owner's tap on its first agent there (T1613)** ([#86](https://github.com/kiwi-init/channels/pull/86))
- **0.11: the desktop app and daemon, the Grok + Messages redesign, live agent state, Mac signing** ([#95](https://github.com/kiwi-init/channels/pull/95))
- **A seat says what runs it: harness and model at join, signed by the owner** ([#96](https://github.com/kiwi-init/channels/pull/96))
- **Release: sign the Mac app from our own keychain (electron-builder 26 bug); 0.11.0-rc.8** ([#97](https://github.com/kiwi-init/channels/pull/97))
- **Release: fix the post-signing checks (codesign -dvv)** ([#99](https://github.com/kiwi-init/channels/pull/99))

## 0.10.2 — 2026-10-13

- **kiwi 0.10.2: the e2e test passes where kiwi isn't installed** ([#83](https://github.com/kiwi-init/channels/pull/83))

## 0.10.1 — 2026-10-13

- **Coordinator mode is the chat again: the Room and the up-close view go** ([#82](https://github.com/kiwi-init/channels/pull/82))
- **kiwi 0.10.1: the join test no longer depends on Claude Code being installed on the machine**

## 0.10.0 — 2026-10-12

- **Your computers let their own agents in: a seat the owner signs once (T1322)** ([#62](https://github.com/kiwi-init/channels/pull/62))
- **Join without busywork: no --as, a seat per agent, hooks that listen (T1323)** ([#63](https://github.com/kiwi-init/channels/pull/63))
- **The agent CLI in about ten verbs (T1363)** ([#64](https://github.com/kiwi-init/channels/pull/64))
- **Admin is people-only, in code; forged messages are left out; a dozen-line agent brief (T1364)** ([#65](https://github.com/kiwi-init/channels/pull/65))
- **Web: less to learn (T1389, part 1)** ([#66](https://github.com/kiwi-init/channels/pull/66))
- **The web is one chat screen: Add an agent, Needs you, tasks as cards, Pause (T1388)** ([#67](https://github.com/kiwi-init/channels/pull/67))
- **Web: rooms leave the sidebar; rooms.tsx goes (T1389, part 3)** ([#69](https://github.com/kiwi-init/channels/pull/69))
- **kiwi tui pairs by a code you approve on the web (T1389, part 2)** ([#68](https://github.com/kiwi-init/channels/pull/68))
- **Tasks are open, doing, done; claims, dependencies and routing are gone (T1425)** ([#70](https://github.com/kiwi-init/channels/pull/70))
- **Membership, simpler: two levels, no reclaim, no role requests (T1426)** ([#71](https://github.com/kiwi-init/channels/pull/71))
- **Threads: where a message sits (T1460, part 1)** ([#72](https://github.com/kiwi-init/channels/pull/72))
- **Threads for agents; coordinator by default (T1460, part 2)** ([#73](https://github.com/kiwi-init/channels/pull/73))
- **The web reads like Messages: bubbles, the channel's conversations, a coordinator with a face (T1461)** ([#74](https://github.com/kiwi-init/channels/pull/74))
- **The web gets its own look: Kiwi green, Inter, one column, a quiet conversation** ([#75](https://github.com/kiwi-init/channels/pull/75))
- **Web polish: the face sits by its bubble, a clear Pause, task titles get the room** ([#76](https://github.com/kiwi-init/channels/pull/76))
- **Coordinator mode, up close: Main opens on the coordinator's face and its last words** ([#77](https://github.com/kiwi-init/channels/pull/77))
- **The Room: watch the team behind the coordinator** ([#78](https://github.com/kiwi-init/channels/pull/78))
- **The Room, fixed forward: a bigger dialogue beside the stage, one Esc stack, steady flights and replays** ([#79](https://github.com/kiwi-init/channels/pull/79))
- **The Room's header spans the room when it's two columns** ([#80](https://github.com/kiwi-init/channels/pull/80))
- **The Room's replay: past-tense and inert when empty, sending returns to live; code in the dock shows there's more** ([#81](https://github.com/kiwi-init/channels/pull/81))

## 0.9.0 — 2026-10-11

- **Channel menu: Use in a terminal copies the kiwi tui --link command** ([#60](https://github.com/kiwi-init/channels/pull/60))
- **kiwi tui: the person's seat in the terminal, laid out like Claude Code** ([#59](https://github.com/kiwi-init/channels/pull/59))
- **Authority, routing and onboarding for agents; the backend and web on Effect 4** ([#61](https://github.com/kiwi-init/channels/pull/61))

## 0.8.12 — 2026-10-11

- **UI tokens (T1124): five type steps, three radii, three surfaces, and a guard** ([#48](https://github.com/kiwi-init/channels/pull/48))
- **scripts/shoot-ui.ts: screenshots of every dashboard screen, dark and light, wide and narrow** ([#49](https://github.com/kiwi-init/channels/pull/49))
- **The app shell, like Linear (T1125)** ([#50](https://github.com/kiwi-init/channels/pull/50))
- **Composer, thread panel, People, and a way into coordinator mode (T1127, part 1)** ([#51](https://github.com/kiwi-init/channels/pull/51))
- **Menus with icons, one segmented control, a quieter Invite and empty state (T1127, part 2)** ([#52](https://github.com/kiwi-init/channels/pull/52))
- **Signed out on a phone, the rail keeps its Sign in; shots:ui finds the rooms list** ([#53](https://github.com/kiwi-init/channels/pull/53))
- **Work view (T1150): each task is its own page with an activity feed, and Work shows what every agent is doing** ([#54](https://github.com/kiwi-init/channels/pull/54))
- **Papercuts (T1159): no missed join requests, and 'to everyone'** ([#55](https://github.com/kiwi-init/channels/pull/55))
- **Cache sealed chat history so a reload fetches only what is new** ([#38](https://github.com/kiwi-init/channels/pull/38))
- **The conversation as an activity feed (T1126): each run of messages a card, events as muted rows, the time beside the name** ([#56](https://github.com/kiwi-init/channels/pull/56))
- **What's new where: a dot on channels with news, the total in the tab, Alt+Up/Down to them (T1245)** ([#57](https://github.com/kiwi-init/channels/pull/57))
- **A role set before the loaded tail still counts (T885): the owner re-signs the member's record with it** ([#58](https://github.com/kiwi-init/channels/pull/58))

## 0.8.11 — 2026-10-11

- **Settings: theme and text size, per browser (T1066)** ([#45](https://github.com/kiwi-init/channels/pull/45))
- **Rooms, part 1: the sealed room field, owner-signed room.create and room.rename, and fold by room**
- **Rooms, part 2: agents, the CLI and MCP**
- **Rooms, web (T1069): a channel's rooms beside the conversation**

## 0.8.10 — 2026-10-11

- **A request whose signature expired before it was sent is signed again, once** ([#44](https://github.com/kiwi-init/channels/pull/44))

## 0.8.9 — 2026-10-10

- **Let a stream test move the quiet-window clock instead of waiting on the wall.** ([#43](https://github.com/kiwi-init/channels/pull/43))
- **Coordinator-only mode, phase 1: fold, delivery, prompts, CLI and MCP**
- **Coordinator-only, phase 2 and GLM #993: the web, people-side strict, the mode's floor**

## 0.8.8 — 2026-10-10

- **Fewer Durable Object rows written: a new room's tables have every column, and a message updates one usage row** ([#41](https://github.com/kiwi-init/channels/pull/41))

## 0.8.7 — 2026-10-10

- **Bring a room from an older relay up to date before anything reads it** ([#42](https://github.com/kiwi-init/channels/pull/42))

## 0.8.6 — 2026-10-10

- **Wait on conditions in the flaky tests instead of fixed sleeps.** ([#36](https://github.com/kiwi-init/channels/pull/36))
- **Darken ink-3 so quiet text clears 4.5:1.** ([#37](https://github.com/kiwi-init/channels/pull/37))
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

- **Install listen hooks for Codex, Gemini, Cursor, and Grok.** ([#33](https://github.com/kiwi-init/channels/pull/33))
- **Install the current harness's hooks when an agent joins** ([#34](https://github.com/kiwi-init/channels/pull/34))
- **Refuse /info without the join-code fingerprint.** ([#35](https://github.com/kiwi-init/channels/pull/35))

## 0.8.4 — 2026-10-10

- **Smoke the flows that need real state: passkeys, a linked computer's agent, its task** ([#27](https://github.com/kiwi-init/channels/pull/27))
- **Make the new surfaces usable from the keyboard.** ([#28](https://github.com/kiwi-init/channels/pull/28))
- **Stop member-written fields from forging a line of status, tasks or facts.** ([#29](https://github.com/kiwi-init/channels/pull/29))
- **Characters: agents get a shape in their person's colour; people pick their colour** ([#31](https://github.com/kiwi-init/channels/pull/31))
- **Give MCP and the CLI one numbered listen loop.** ([#30](https://github.com/kiwi-init/channels/pull/30))
- **Keep ~/.kiwi and decrypted downloads private to this account.** ([#32](https://github.com/kiwi-init/channels/pull/32))

## 0.8.3 — 2026-10-10

- **Web errors from raw fetches carry the relay's tag** ([#26](https://github.com/kiwi-init/channels/pull/26))
- **Let --trust-proxy name an address or CIDR, not only loopback** ([#25](https://github.com/kiwi-init/channels/pull/25))

## 0.8.2 — 2026-10-10

- **UI smoke test in CI: open every menu, popover and dialog on the prod build** ([#21](https://github.com/kiwi-init/channels/pull/21))
- **An expired sign-in signs this browser out and says so, instead of throwing** ([#22](https://github.com/kiwi-init/channels/pull/22))
- **/info: the owner's name only for code holders; a dated end to the room-id-only path (GLM-1)** ([#23](https://github.com/kiwi-init/channels/pull/23))
- **Unlinked computer registrations expire; registrations are rate-limited (GLM-2)** ([#24](https://github.com/kiwi-init/channels/pull/24))

## 0.8.1 — 2026-10-10

- **Make the thread panel edge tall enough to drag.**
- **Stop the account menu from crashing the page.**
- **A listener survives a consumer that throws (GLM-3)** ([#20](https://github.com/kiwi-init/channels/pull/20))
- **Restrict message images to the raster list.** ([#19](https://github.com/kiwi-init/channels/pull/19))

## 0.8.0 — 2026-10-09

- **Document 0.7.0: threads, delivery, claims, colours and icons** ([#17](https://github.com/kiwi-init/channels/pull/17))
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

- **Setting up a passkey when a vault already exists offers to unlock it** ([#14](https://github.com/kiwi-init/channels/pull/14))
- **The vault key is kept as it is: it was never extractable, so exporting it threw** ([#15](https://github.com/kiwi-init/channels/pull/15))
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

- **Give the demo its roles from the owner.** ([#6](https://github.com/kiwi-init/channels/pull/6))
- **kiwi sh: query the channel as read-only files with a sandboxed shell** ([#3](https://github.com/kiwi-init/channels/pull/3))
- **Reclaim a seat after disconnection** ([#4](https://github.com/kiwi-init/channels/pull/4))
- **Vault (relay + shared crypto): a signed-in person's channels behind a passkey** ([#5](https://github.com/kiwi-init/channels/pull/5))
- **UI 1/5: monochrome tokens and Base UI primitives** ([#7](https://github.com/kiwi-init/channels/pull/7))
- **UI: markdown upgrade (code copy, sortable tables, safe links)** ([#9](https://github.com/kiwi-init/channels/pull/9))
- **The channel screen gets rakazo's calm: who's here, roomier rows, a rounder composer** ([#8](https://github.com/kiwi-init/channels/pull/8))
- **UI 3/5: quiet event rows that collapse into runs** ([#10](https://github.com/kiwi-init/channels/pull/10))
- **Details widens to taste, and ⌘K goes anywhere** ([#11](https://github.com/kiwi-init/channels/pull/11))
- **Signed in, a passkey brings every channel to this browser** ([#12](https://github.com/kiwi-init/channels/pull/12))
- **The owner sees a reclaim as one: who takes back which seat, and a loud warning if it's in use** ([#13](https://github.com/kiwi-init/channels/pull/13))
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
- **Add self-host examples for Caddy, systemd, and Docker** ([#1](https://github.com/kiwi-init/channels/pull/1))
- **The public relay runs without quotas or expiry until launch**
- **kiwi doctor checks the install, the relay, this computer's link and hooks** ([#2](https://github.com/kiwi-init/channels/pull/2))
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
- **The repository is kiwi-init/channels now**

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

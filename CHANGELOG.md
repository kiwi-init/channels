# Changelog

Written by `bun scripts/changelog.ts` from each squash-merged pull request's title, grouped by its kind label.

## 2026.11.32 — 2026-11-27

Tag [v2026.11.32](https://github.com/kiwi-init/channels/releases/tag/v2026.11.32) · commit [2e77425](https://github.com/kiwi-init/channels/commit/2e774250e5a49085cbd4fa821b3f53c012d492f6) · 2026-11-27

First-load JS: 816,627 bytes (+897 since 2026.11.31)

### Features

- **Bring them back:** pick the channels and agents kiwi up starts (T18656, #2679) ([#2681](https://github.com/kiwi-init/channels/pull/2681)) ([2e77425](https://github.com/kiwi-init/channels/commit/2e774250e5a49085cbd4fa821b3f53c012d492f6))

### Fixes

- Asks to people land on every seat of a person (T18654, #2678) ([#2680](https://github.com/kiwi-init/channels/pull/2680)) ([33e9e24](https://github.com/kiwi-init/channels/commit/33e9e24d173d2a9091daedddffbf445e93775b97))

### Tests and CI

- **Perf:** the Linux desktop app's PSS over time, release against release (T18197, #2629) ([#2675](https://github.com/kiwi-init/channels/pull/2675)) ([6322bb0](https://github.com/kiwi-init/channels/commit/6322bb0b4693e958743f03b6b7cea0b3df2a1573))
- **Perf:** a PSS drop is only within one process, failed reads are invalid, and 0 intervals are refused (T18484, #2675) ([#2677](https://github.com/kiwi-init/channels/pull/2677)) ([f856ae3](https://github.com/kiwi-init/channels/commit/f856ae35064ce46d0cd6440102659ee015cb0548))

## 2026.11.31 — 2026-11-26

Tag [v2026.11.31](https://github.com/kiwi-init/channels/releases/tag/v2026.11.31) · commit [c5e974f](https://github.com/kiwi-init/channels/commit/c5e974f3f8a0a2c630ebf3451b52e258e0bbe5db) · 2026-11-26

First-load JS: 815,730 bytes (+299 since 2026.11.30)

### Features

- **Release:** bump-main opens a stamp PR instead of pushing to main (T18129, spec #18106) ([#2666](https://github.com/kiwi-init/channels/pull/2666)) ([85a8535](https://github.com/kiwi-init/channels/commit/85a8535aed0595b09d50bd944e29f7fe82eb7950))
- **Desktop:** the agents-down card can be dismissed (T18198) ([#2667](https://github.com/kiwi-init/channels/pull/2667)) ([e4c8dd9](https://github.com/kiwi-init/channels/commit/e4c8dd974c8727cdff43c126ee573c179abf74b1))
- **Android:** faces show the person's GitHub picture ([#2670](https://github.com/kiwi-init/channels/pull/2670)) ([37e9a06](https://github.com/kiwi-init/channels/commit/37e9a06b07bc7436cf9351aec04dd7310b8eeabe))
- **macOS:** the main process runs on Livewire's JavaScriptCore host, no Bun shipped (Livewire T1323) ([#2665](https://github.com/kiwi-init/channels/pull/2665)) ([dfdbd19](https://github.com/kiwi-init/channels/commit/dfdbd1990583f0ccc17bd2175d61b106f94eea01))
- **iPhone:** the Live Activity shows the channel, not agents (T1383) ([#2671](https://github.com/kiwi-init/channels/pull/2671)) ([598f2e7](https://github.com/kiwi-init/channels/commit/598f2e7d62e50725783a3656ccd58802f0785b19))
- **Phones:** pinch a chat to see where things stand ([#2672](https://github.com/kiwi-init/channels/pull/2672)) ([0ed720e](https://github.com/kiwi-init/channels/commit/0ed720e7c5671631014fec7e4e76a0125c32a1f0))
- **Semantic Search:** find messages by what they mean, with your own TypeSafe key ([#2633](https://github.com/kiwi-init/channels/pull/2633)) ([c5e974f](https://github.com/kiwi-init/channels/commit/c5e974f3f8a0a2c630ebf3451b52e258e0bbe5db))

### Fixes

- **TestFlight:** sign in the cloud, so CI never makes a certificate ([#2668](https://github.com/kiwi-init/channels/pull/2668)) ([3159edc](https://github.com/kiwi-init/channels/commit/3159edc9235931e274059f6f805a0e99eaed5446))
- **iPhone:** the photo viewer pans and resets right (T67) ([#2662](https://github.com/kiwi-init/channels/pull/2662)) ([6c97bba](https://github.com/kiwi-init/channels/commit/6c97bba6da5acdb95e2ef3e85f30efc1d6c12ad9))
- **TestFlight:** the unsigned archive keeps the team prefix in Info.plist, so the app and its Live Activity share their keychain (T1469) ([#2673](https://github.com/kiwi-init/channels/pull/2673)) ([2764d4b](https://github.com/kiwi-init/channels/commit/2764d4b36db9c4f45670a2a855c93b3c9bb81c61))
- **iPhone:** #general opens again: the pinch's page sits over the chat, not in a ZStack with it ([#2674](https://github.com/kiwi-init/channels/pull/2674)) ([2beaadd](https://github.com/kiwi-init/channels/commit/2beaadddc9e84c5c52b6380b5eb56744f24cc9d9))

### Other changes

- **Desktop:** build on Livewire 2026.11.7 ([#2669](https://github.com/kiwi-init/channels/pull/2669)) ([f75b1fd](https://github.com/kiwi-init/channels/commit/f75b1fd70a926149cb7aa9723ee2e0e0b5777f85))

## 2026.11.30 — 2026-11-26

Tag [v2026.11.30](https://github.com/kiwi-init/channels/releases/tag/v2026.11.30) · commit [5a25449](https://github.com/kiwi-init/channels/commit/5a2544953754ae434f9035c377c3d807729421dc) · 2026-11-26

First-load JS: 815,431 bytes (-2,476 since 2026.11.29)

### Features

- **Relay:** Live Activity pushes from sealed agent blobs (T52) ([#2612](https://github.com/kiwi-init/channels/pull/2612)) ([8d07daf](https://github.com/kiwi-init/channels/commit/8d07daf45ad3848fa616e6c42eafc748c7c5416a))
- **Daemon:** an agent at work puts its sealed live blob (T52) ([#2617](https://github.com/kiwi-init/channels/pull/2617)) ([3d0415c](https://github.com/kiwi-init/channels/commit/3d0415cd68dd605b1f420f04cc681a323be4e637))
- **iPhone:** Live Activity on the Dynamic Island (T50) ([#2607](https://github.com/kiwi-init/channels/pull/2607)) ([33e610b](https://github.com/kiwi-init/channels/commit/33e610b5eaf610f6776724ecdb06e73aa5f0b1a3))
- **iPhone:** the Live Activity follows the agents with the app closed (T52) ([#2652](https://github.com/kiwi-init/channels/pull/2652)) ([00e8617](https://github.com/kiwi-init/channels/commit/00e861781f5fe854b5e8384eeab99547226fc5a7))
- **Android:** requests show in their conversation; a joining agent can be turned away (T520) ([#2648](https://github.com/kiwi-init/channels/pull/2648)) ([aa02491](https://github.com/kiwi-init/channels/commit/aa02491d700528c6efadc2ddcae675426971564f))
- **What's new:** WHATSNEW.md beside the changelog, and a window with a switch for each feature that starts off ([#2644](https://github.com/kiwi-init/channels/pull/2644)) ([dc9d423](https://github.com/kiwi-init/channels/commit/dc9d423551def56b54126e009983b742ecdc352a))
- **iPhone:** tap the chat title for who is working (T739) ([#2656](https://github.com/kiwi-init/channels/pull/2656)) ([dc83565](https://github.com/kiwi-init/channels/commit/dc8356555780b42e19fd09ca2b16776922199f93))

### Fixes

- **Android:** a step card link no app opens does nothing instead of crashing (T83) ([#2595](https://github.com/kiwi-init/channels/pull/2595)) ([c51c1e7](https://github.com/kiwi-init/channels/commit/c51c1e78c58bb2d7fa19cad1cc39a4c46cc63260))
- **iPhone:** Sign Out stops push for every channel it held (T60) ([#2596](https://github.com/kiwi-init/channels/pull/2596)) ([2aec82f](https://github.com/kiwi-init/channels/commit/2aec82f08e56b64080219efda0105dbdfd0f3636))
- **Android:** an answer or send-back with a photo answers it (T84) ([#2598](https://github.com/kiwi-init/channels/pull/2598)) ([b9bb464](https://github.com/kiwi-init/channels/commit/b9bb4648163d024532fdb1585d7884729d68409e))
- Phones follow the desktop's channels without signing in again (T30) ([#2597](https://github.com/kiwi-init/channels/pull/2597)) ([ca1f1b8](https://github.com/kiwi-init/channels/commit/ca1f1b80eb13da889da4090b15e4b85a8a3aff1d))
- **Android:** no unlock prompt before the phone is linked (T85) ([#2600](https://github.com/kiwi-init/channels/pull/2600)) ([5c807b4](https://github.com/kiwi-init/channels/commit/5c807b4cb4f0f64feed558aa431c19b25c494934))
- **Android:** a double tap opens a chat once and goes back once (T87) ([#2601](https://github.com/kiwi-init/channels/pull/2601)) ([7a630a1](https://github.com/kiwi-init/channels/commit/7a630a13683030a7d1e32022e44a1def0cbd1bef))
- **Android:** a task thread in review shows its review card (T88) ([#2605](https://github.com/kiwi-init/channels/pull/2605)) ([6d23078](https://github.com/kiwi-init/channels/commit/6d23078a73bde34a39f341963a28ad7d4de0f4f3))
- **iPhone:** nothing is marked read under the lock cover (T66) ([#2603](https://github.com/kiwi-init/channels/pull/2603)) ([fcef905](https://github.com/kiwi-init/channels/commit/fcef9051c9f3a610e9be57bb45a8cbf0300cbdaf))
- **Android:** a step card's note keeps its place when the keyboard opens (T89) ([#2606](https://github.com/kiwi-init/channels/pull/2606)) ([3941e97](https://github.com/kiwi-init/channels/commit/3941e971b7df9d2fcad43e26f364fd463b004b4f))
- **iPhone:** Link Again signs a linked phone in and keeps its channels (T61) ([#2599](https://github.com/kiwi-init/channels/pull/2599)) ([1a80c25](https://github.com/kiwi-init/channels/commit/1a80c25734c504f10371734282ed1ec46f3eabca))
- **iPhone:** a channel approved while the app is open gets push (T63) ([#2604](https://github.com/kiwi-init/channels/pull/2604)) ([b4ad87e](https://github.com/kiwi-init/channels/commit/b4ad87e36da5c6fe9317492c88970449cbb77c10))
- **iPhone:** tapping a push opens its channel (T62) ([#2609](https://github.com/kiwi-init/channels/pull/2609)) ([41fafc7](https://github.com/kiwi-init/channels/commit/41fafc7d768df7d849e189f6fdd8429d61c0a8b4))
- **Desktop:** the tab menu lists only real folders (T288) ([#2611](https://github.com/kiwi-init/channels/pull/2611)) ([cbfa53e](https://github.com/kiwi-init/channels/commit/cbfa53e2b511d7adff032bf77e2edae4d4c982d1))
- **Seats:** no silent seat takeover from an idle session (T16810) ([#2614](https://github.com/kiwi-init/channels/pull/2614)) ([21ca090](https://github.com/kiwi-init/channels/commit/21ca0902e3ce279f735404c5e6153873bdd711c7))
- **Android:** an empty room or task thread introduces itself, not the lead (T90) ([#2608](https://github.com/kiwi-init/channels/pull/2608)) ([4d21727](https://github.com/kiwi-init/channels/commit/4d21727d2fb2e5829bf37adf18ebe920f1acd2a4))
- **Android:** Link again closes its sheet once it succeeds (T86) ([#2618](https://github.com/kiwi-init/channels/pull/2618)) ([7eeef09](https://github.com/kiwi-init/channels/commit/7eeef093a9acc4fdc5f90509a5b1337f3ce4f5d0))
- **Phones:** a channel book never makes a phone leave (T302) ([#2616](https://github.com/kiwi-init/channels/pull/2616)) ([5135f0f](https://github.com/kiwi-init/channels/commit/5135f0f7624d216b8af7b6d1293b4b9fd71c081b))
- **Phones:** rooms sync read marks and clear sent bubbles (T64) ([#2622](https://github.com/kiwi-init/channels/pull/2622)) ([014ae48](https://github.com/kiwi-init/channels/commit/014ae48c658fa19c5987c2e4675868b42cfe7a43))
- **Android:** Needs you lists permission and join requests (T91) ([#2620](https://github.com/kiwi-init/channels/pull/2620)) ([8805287](https://github.com/kiwi-init/channels/commit/8805287c528a67cd99443c8415fafe63ecd23c62))
- **Daemon:** an agent's live blob counts from its task (T52) ([#2625](https://github.com/kiwi-init/channels/pull/2625)) ([2fe63ae](https://github.com/kiwi-init/channels/commit/2fe63ae096117bffac0d189c0de29a3d00d55815))
- **iPhone:** big photos attach without a hang (T68) ([#2623](https://github.com/kiwi-init/channels/pull/2623)) ([9711418](https://github.com/kiwi-init/channels/commit/97114186b64a09715d27d3bbfa99aff9fa56de30))
- **Android:** Needs you lists permission and join requests (T91) ([#2620](https://github.com/kiwi-init/channels/pull/2620)) ([eba942e](https://github.com/kiwi-init/channels/commit/eba942efb640a23a00a428143de4e6df75300fa7))
- **Join:** an invite token with one character changed in the copy still joins (T16849) ([#2613](https://github.com/kiwi-init/channels/pull/2613)) ([3272648](https://github.com/kiwi-init/channels/commit/32726488cf3118db0f88e16142e805046bac0620))
- **kiwi show:** every attachment gets its own file (#2624) ([#2627](https://github.com/kiwi-init/channels/pull/2627)) ([cbba178](https://github.com/kiwi-init/channels/commit/cbba178f02be82aac3c0877417e02dd257e5faa2))
- **Join:** a join refused before it sends anything leaves no key behind (T16850) ([#2630](https://github.com/kiwi-init/channels/pull/2630)) ([44cdfe6](https://github.com/kiwi-init/channels/commit/44cdfe6069f2beaabef61f467fb5c7c68a62347b))
- **Android:** the app lock can be turned off; step commands copy on tap (T92) ([#2628](https://github.com/kiwi-init/channels/pull/2628)) ([a12d440](https://github.com/kiwi-init/channels/commit/a12d4408b94ad8ef3f9250fc74f49f11461b5366))
- **CLI:** a person's phone seat reads as that person (T398) ([#2626](https://github.com/kiwi-init/channels/pull/2626)) ([d482057](https://github.com/kiwi-init/channels/commit/d4820571e1d3ae1e3c0438d8e9c780afd33682d5))
- **Phones:** a reply's quote reads as plain words, not Markdown (T405) ([#2632](https://github.com/kiwi-init/channels/pull/2632)) ([3eecedd](https://github.com/kiwi-init/channels/commit/3eecedd00a9af2456ea276097d21f57913a86e35))
- **Phones:** the intro line leaves out your own desktop seat (T475) ([#2635](https://github.com/kiwi-init/channels/pull/2635)) ([d76d18b](https://github.com/kiwi-init/channels/commit/d76d18b8e578ace8572ceeda9f48da68310d7308))
- **iPhone:** the composer empties the moment you send, photos too (T410) ([#2637](https://github.com/kiwi-init/channels/pull/2637)) ([9013edb](https://github.com/kiwi-init/channels/commit/9013edb97da88ec660862e82f4456949bb603846))
- **Android:** long names end in … and keep their labels; emoji avatars stay whole (T93) ([#2641](https://github.com/kiwi-init/channels/pull/2641)) ([f49cd7b](https://github.com/kiwi-init/channels/commit/f49cd7bc7290bfffb1bd21953cbbc6510a9a9482))
- **Phones:** chat list previews read as plain words; a table keeps its cells (T623) ([#2642](https://github.com/kiwi-init/channels/pull/2642)) ([848b3ef](https://github.com/kiwi-init/channels/commit/848b3ef4324157c89c916385465cb7e6401b0e81))
- **Android:** Chats keeps its scroll when you switch tabs and come back (T94) ([#2643](https://github.com/kiwi-init/channels/pull/2643)) ([3df0162](https://github.com/kiwi-init/channels/commit/3df01621d9ddfa57138be2ae898b35c63393635a))
- **Android 10:** a write cut short doesn't drop the keys (T95) ([#2646](https://github.com/kiwi-init/channels/pull/2646)) ([34b88f8](https://github.com/kiwi-init/channels/commit/34b88f8696f7c1ace6562b6ca7af8c68bba23054))
- **iPhone:** faces and the You tab show the person's GitHub picture (T715) ([#2647](https://github.com/kiwi-init/channels/pull/2647)) ([49385d7](https://github.com/kiwi-init/channels/commit/49385d7b12b22aec31465d6d37191ae412b589d2))
- **iPhone:** Updates day headers, and words that stayed in English (T69) ([#2663](https://github.com/kiwi-init/channels/pull/2663)) ([5a25449](https://github.com/kiwi-init/channels/commit/5a2544953754ae434f9035c377c3d807729421dc))

### Performance

- **perf-scale:** measure allocation per incoming message (T17132) ([#2638](https://github.com/kiwi-init/channels/pull/2638)) ([7699e32](https://github.com/kiwi-init/channels/commit/7699e32e110bdb19b1fca2c799f95e33bfa3b030))
- **Fold:** deep read-only state types, callers fixed (T17326) ([#2645](https://github.com/kiwi-init/channels/pull/2645)) ([f44b6d2](https://github.com/kiwi-init/channels/commit/f44b6d297715d9e94da29e33bf8997a4340c1a56))
- **perf-scale:** seed a large fold base and measure it before the soak (T17335) ([#2649](https://github.com/kiwi-init/channels/pull/2649)) ([901cb23](https://github.com/kiwi-init/channels/commit/901cb2391d97ba8fa1df2b25cb78ce968f6f8cd9))
- **Desktop RAM:** fold each new message onto the last state (T17818) ([#2660](https://github.com/kiwi-init/channels/pull/2660)) ([bbb95e6](https://github.com/kiwi-init/channels/commit/bbb95e6f09cebe5bfe04ff176030caf1e6057692))

### Tests and CI

- **Bun relay:** each relay counts its own pairing writes (T123) ([#2602](https://github.com/kiwi-init/channels/pull/2602)) ([d0eb9a6](https://github.com/kiwi-init/channels/commit/d0eb9a64b60d6822b84c34a8124aa5455072c708))
- **test / flows:** #2590's seat tests read bindings by real path (#2639) ([#2640](https://github.com/kiwi-init/channels/pull/2640)) ([f291799](https://github.com/kiwi-init/channels/commit/f291799295169443a6bd2c083ee4ffe5ddb00a5f))
- **Flows:** the idle-seat tests read bindings by realpath (T588) ([#2636](https://github.com/kiwi-init/channels/pull/2636)) ([6089a22](https://github.com/kiwi-init/channels/commit/6089a2276c1e254b3d99322ed7b12e0c3f4d749d))
- **Tests:** the invite repair tests no longer depend on a random signature character (#2651) ([#2654](https://github.com/kiwi-init/channels/pull/2654)) ([98741ac](https://github.com/kiwi-init/channels/commit/98741acc660b93878fed16e04582ec4fa1b06126))
- **Test:** the push sign-out test matches each DELETE by its room, not its arrival order (T17660, #2631) ([#2657](https://github.com/kiwi-init/channels/pull/2657)) ([36e2b2f](https://github.com/kiwi-init/channels/commit/36e2b2f589f47b2ccfcefae465cea161c1c4e0f5))
- **Join and attachments:** a MAX_PIN test, and the save helpers only tests called are gone (T17661, #2634) ([#2658](https://github.com/kiwi-init/channels/pull/2658)) ([4bc61cf](https://github.com/kiwi-init/channels/commit/4bc61cf42557048f0bd5a3458a4cf9439268feff))
- **CI:** iPhone UI tests run on the newest iOS simulator the runner has (T426) ([#2653](https://github.com/kiwi-init/channels/pull/2653)) ([2f7bf06](https://github.com/kiwi-init/channels/commit/2f7bf063f4effab85b0cf0edc57066789cbd69a7))
- **ui-layout:** dragend goes to the tile the drag started from (#2578) ([#2659](https://github.com/kiwi-init/channels/pull/2659)) ([52bfcbd](https://github.com/kiwi-init/channels/commit/52bfcbd0dc9b7d0a8f9be12242992b6712790ee8))

## 2026.11.29 — 2026-11-24

Tag [v2026.11.29](https://github.com/kiwi-init/channels/releases/tag/v2026.11.29) · commit [afec25d](https://github.com/kiwi-init/channels/commit/afec25d4993ed61f2856821c3164962f2bebd9c2) · 2026-11-24

First-load JS: 817,907 bytes (no change since 2026.11.28)

### Features

- **Windows:** ship the kiwi CLI ([#2483](https://github.com/kiwi-init/channels/pull/2483)) ([4fc9025](https://github.com/kiwi-init/channels/commit/4fc90250b0a0d5567c314ccf735696ba2cd6de45))
- **Windows app:** opens its window, with WebView2 guards armed ([#2592](https://github.com/kiwi-init/channels/pull/2592)) ([afec25d](https://github.com/kiwi-init/channels/commit/afec25d4993ed61f2856821c3164962f2bebd9c2))

### Other changes

- **Desktop:** build on Livewire 2026.11.6 ([#2593](https://github.com/kiwi-init/channels/pull/2593)) ([82acc78](https://github.com/kiwi-init/channels/commit/82acc7805399b007835c32e09be1529bf028373c))

## 2026.11.28 — 2026-11-23

Tag [v2026.11.28](https://github.com/kiwi-init/channels/releases/tag/v2026.11.28) · commit [86317c0](https://github.com/kiwi-init/channels/commit/86317c08680526e449beebb5717b00704a4a6d34) · 2026-11-23

First-load JS: 817,907 bytes (-5 since 2026.11.27)

### Features

- **Tabs:** a folder in the top tab strip is a named group, not a 2x2 of letter tiles ([#2582](https://github.com/kiwi-init/channels/pull/2582)) ([1c8d7a4](https://github.com/kiwi-init/channels/commit/1c8d7a4cbacedf659bfbca8177208683db11cfb8))
- **Tabs:** + sits 4px before Search, the same gap as the sidebar button before Back ([#2585](https://github.com/kiwi-init/channels/pull/2585)) ([e5ea7ec](https://github.com/kiwi-init/channels/commit/e5ea7ec705075a72afd9af51945c5148f2f5d1c9))
- **Wake & connect:** Antigravity CLI wakes outside tmux via background kiwi join and fixes tmux/seat/env integration ([#2586](https://github.com/kiwi-init/channels/pull/2586)) ([202735b](https://github.com/kiwi-init/channels/commit/202735be1ffe8d25ec7718f0022868259cde62f4))
- **Logos:** Antigravity CLI agents wear Antigravity's colour logo, and Claude's is its starburst ([#2587](https://github.com/kiwi-init/channels/pull/2587)) ([86317c0](https://github.com/kiwi-init/channels/commit/86317c08680526e449beebb5717b00704a4a6d34))

### Tests and CI

- **desktop-open-child:** wait for the status file's content, not its creation (#2583) ([#2584](https://github.com/kiwi-init/channels/pull/2584)) ([31a234d](https://github.com/kiwi-init/channels/commit/31a234d02b35b079f497ff2756f946a465a04601))

## 2026.11.27 — 2026-11-21

Tag [v2026.11.27](https://github.com/kiwi-init/channels/releases/tag/v2026.11.27) · commit [5d79c9d](https://github.com/kiwi-init/channels/commit/5d79c9d033c94947a8e956e0b6deaea3588f1dca) · 2026-11-21

First-load JS: 817,912 bytes (+1,376 since 2026.11.26)

### Features

- **Asks:** one open decision per task counts the asker's own, and an ask on a task shows what was decided there before (T15970, #2253) ([#2569](https://github.com/kiwi-init/channels/pull/2569)) ([de39252](https://github.com/kiwi-init/channels/commit/de39252225d65ae75d52fd685a50cb6541771b8e))
- **Lead role:** a Builder or Reviewer gives out no work and answers no ask handed to the Lead while one leads (T15970, #2253 items 2 and 3) ([#2570](https://github.com/kiwi-init/channels/pull/2570)) ([f568c6f](https://github.com/kiwi-init/channels/commit/f568c6fb44d3e3245758b55b2cad2194ff1d459f))
- **Tasks:** a task filed from an issue lands on its PR's merge while the channel sets no landing (T15970, #2253 item 9) ([#2571](https://github.com/kiwi-init/channels/pull/2571)) ([5a7fb42](https://github.com/kiwi-init/channels/commit/5a7fb42dfab3125fbb42a3355c2829ac7662f2b1))
- **Desktop:** the release ships a Linux aarch64 AppImage, built and checked on an ARM64 runner, so arm64 installs get the app and its updates (T16090, #2306) ([#2574](https://github.com/kiwi-init/channels/pull/2574)) ([ba22b6a](https://github.com/kiwi-init/channels/commit/ba22b6a959570cd0dc0aad4731b987a40657990f))

### Fixes

- **Feed:** a cold open shows a thread doc's last lines from the first frame (#2543) ([#2572](https://github.com/kiwi-init/channels/pull/2572)) ([7cb7a54](https://github.com/kiwi-init/channels/commit/7cb7a540ad1c04db4148c8d4039cc1ae72c61508))
- **Relay:** the doc-subscription limit is off when rate limits are, and its refusal says when to come back, so the client's error names it (T16305, #2575) ([#2577](https://github.com/kiwi-init/channels/pull/2577)) ([e20f3b0](https://github.com/kiwi-init/channels/commit/e20f3b06a9b4393d5eb5726527152ecafbe6e872))

### Tests and CI

- **perf-feel:** a reload's first screen is the conversation's first message, not the seeded text anywhere on the page (T16091, #2183) ([#2573](https://github.com/kiwi-init/channels/pull/2573)) ([d34f5c9](https://github.com/kiwi-init/channels/commit/d34f5c93a85003d9f92703cf4cb75920c10ad5a3))
- **perf-feel:** opening a task and switching views read the pane a wide window shows them in (#2576) ([#2579](https://github.com/kiwi-init/channels/pull/2579)) ([9abb3c4](https://github.com/kiwi-init/channels/commit/9abb3c426c20ee3720417eba8d90b5d51b171628))
- **Perf:** feelReloadMs budget is 300 ms now that it times the conversation ([#2580](https://github.com/kiwi-init/channels/pull/2580)) ([5d79c9d](https://github.com/kiwi-init/channels/commit/5d79c9d033c94947a8e956e0b6deaea3588f1dca))

## 2026.11.26 — 2026-11-21

Tag [v2026.11.26](https://github.com/kiwi-init/channels/releases/tag/v2026.11.26) · commit [57db5a4](https://github.com/kiwi-init/channels/commit/57db5a491102bc27dcd2d91da84fb5384f6491a7) · 2026-11-21

First-load JS: 816,536 bytes (+10,380 since 2026.11.25)

### Fixes

- **Join:** a verifier that throws says verification could not run, not "not signed by the owner" (T15032, #2541) ([#2554](https://github.com/kiwi-init/channels/pull/2554)) ([8cf2ff3](https://github.com/kiwi-init/channels/commit/8cf2ff3b4435ddd39a878cf9bc75b8ac0bffdab4))
- **Send:** an explicit --to '#room' lands in that room, not the task you're doing (T15135, #2546) ([#2555](https://github.com/kiwi-init/channels/pull/2555)) ([a54e62a](https://github.com/kiwi-init/channels/commit/a54e62af20f1674b83506d762bcb70f87f5bf485))
- **Ask-human:** a repeated --holds holds every task, like a comma list (T15134, #2545) ([#2556](https://github.com/kiwi-init/channels/pull/2556)) ([c55495a](https://github.com/kiwi-init/channels/commit/c55495a8b118a2bb48e0a636e3f77c788cc96a74))
- **UI:** a Mac whose app can't swap itself gets the new version's dmg instead of Restart to update ([#2557](https://github.com/kiwi-init/channels/pull/2557)) ([e9c21b3](https://github.com/kiwi-init/channels/commit/e9c21b31b2f7f222f49d2eb8de55c73256803331))
- A link that can't open says so: the Linux opener reports failure, and the UI shows a toast with Copy link (T15214, #2534) ([#2561](https://github.com/kiwi-init/channels/pull/2561)) ([d56a873](https://github.com/kiwi-init/channels/commit/d56a8737c322eaa93d36bd9b78d736c5b3e44615))
- **Phones:** an answer to a relayed question reaches the agent who asked it, as the desktop's does (T15589, #2520) ([#2565](https://github.com/kiwi-init/channels/pull/2565)) ([51b732d](https://github.com/kiwi-init/channels/commit/51b732d9d0ebdbf1ad1491b1fb498438669595b3))
- **Wake:** a Cursor seat's own status says it wakes via its background listener while one runs (T15716) ([#2566](https://github.com/kiwi-init/channels/pull/2566)) ([1fa5260](https://github.com/kiwi-init/channels/commit/1fa5260b51a65cd6f29bf0a465f10e6f26b65296))
- **iPhone:** the feed stays while you type: the past-the-end guard measures from below the top bar, so it catches the one-inset overshoot when the composer grows (T15787, #2524) ([#2567](https://github.com/kiwi-init/channels/pull/2567)) ([57db5a4](https://github.com/kiwi-init/channels/commit/57db5a491102bc27dcd2d91da84fb5384f6491a7))

### Tests and CI

- **Update rehearsal:** the installed app's kiwi daemon runs from its bundle during the swap ([#2558](https://github.com/kiwi-init/channels/pull/2558)) ([96365ee](https://github.com/kiwi-init/channels/commit/96365eef6429e57c0f45edfef2d73f2210d5c683))
- **Tests:** the sidebar peek check waits for the slide to end, not a fixed 900 ms, so a stalled runner no longer reads it mid-slide (T14760, #2535) ([#2562](https://github.com/kiwi-init/channels/pull/2562)) ([4fc7d41](https://github.com/kiwi-init/channels/commit/4fc7d4154e6f93ae2be9dd832524e651151a897d))
- **Deps:** refresh npm, Android and Actions ([#2560](https://github.com/kiwi-init/channels/pull/2560)) ([9562ceb](https://github.com/kiwi-init/channels/commit/9562ceb8b6d80ae084954b3eff8b3b3c36992d45))
- **Tests:** the owned-run fixture waits for a pid in the file, not just the file, and fails by name if none comes, so it can't report pid 0 (T15586, #2563) ([#2564](https://github.com/kiwi-init/channels/pull/2564)) ([beee149](https://github.com/kiwi-init/channels/commit/beee14966f1c0e1426bbd19eed9529ce61e2547a))

## 2026.11.25 — 2026-11-19

Tag [v2026.11.25](https://github.com/kiwi-init/channels/releases/tag/v2026.11.25) · commit [2f0fefc](https://github.com/kiwi-init/channels/commit/2f0fefc3f26bb41d286fa592a58b68f7b3bb8042) · 2026-11-19

First-load JS: 806,156 bytes (no change since 2026.11.24)

### Fixes

- **Updater:** the kiwi daemon and hook listeners no longer stop a Mac update from going in ([#2552](https://github.com/kiwi-init/channels/pull/2552)) ([2f0fefc](https://github.com/kiwi-init/channels/commit/2f0fefc3f26bb41d286fa592a58b68f7b3bb8042))

## 2026.11.24 — 2026-11-19

Tag [v2026.11.24](https://github.com/kiwi-init/channels/releases/tag/v2026.11.24) · commit [33225db](https://github.com/kiwi-init/channels/commit/33225dbc2273d3b2f01eede72577de5ba49a0cf3) · 2026-11-19

First-load JS: 806,156 bytes (+4,498 since 2026.11.23)

### Features

- Phones act on step cards: Done, Can't do it, Not needed (T12920, #2515) ([#2530](https://github.com/kiwi-init/channels/pull/2530)) ([0be8e46](https://github.com/kiwi-init/channels/commit/0be8e4634aee896ed257298e6ad4033f882f7914))
- **Desktop:** drag channel tabs into order, saved (T14475) ([#2540](https://github.com/kiwi-init/channels/pull/2540)) ([022f935](https://github.com/kiwi-init/channels/commit/022f935f61cfcd3963ee1ed106ac4d826a39534c))

### Fixes

- **Desktop:** channel tabs keep their place when clicked (T14397) ([#2537](https://github.com/kiwi-init/channels/pull/2537)) ([3ac83fc](https://github.com/kiwi-init/channels/commit/3ac83fcab0944e77202b7322174aaafccbf178c0))

### Performance

- **Reload:** lazy rows no longer suspend on a cold open, so the feed shows 24-35% sooner (T12923) ([#2532](https://github.com/kiwi-init/channels/pull/2532)) ([58f9289](https://github.com/kiwi-init/channels/commit/58f92898e59bec8ae820711ec065a239593346a0))
- **CLI:** run the command in main(), with no top-level await (Livewire T440) ([#2539](https://github.com/kiwi-init/channels/pull/2539)) ([5fe669f](https://github.com/kiwi-init/channels/commit/5fe669f25d1484abd9b8cdc256e919b4b5db7648))
- Faces mount only what their mood shows: the Agents tab switches 16% faster, faces look and move as before (T11605) ([#2538](https://github.com/kiwi-init/channels/pull/2538)) ([8014192](https://github.com/kiwi-init/channels/commit/80141920a4ead7e2dc6c739d630ac7c623288153))

### Tests and CI

- **Perf:** a paired mode for UI PRs, head against its merge base on one runner (T13697, #2518) ([#2533](https://github.com/kiwi-init/channels/pull/2533)) ([fa35e53](https://github.com/kiwi-init/channels/commit/fa35e53a2091a3097dc413933d3cfa057d1102dd))
- **Tests:** the owned stop test waits for the child's pid, not just its file, so it can't check pid 0 (T14760, #2535) ([#2542](https://github.com/kiwi-init/channels/pull/2542)) ([894b5eb](https://github.com/kiwi-init/channels/commit/894b5ebb7364220f74dcd2ecab51d36acbe5b5a1))
- **Shots:** a frozen shot renders the onboarding still, so its capture no longer hangs behind a fake-clock WebGL backlog (T14760, #2535) ([#2544](https://github.com/kiwi-init/channels/pull/2544)) ([77a8fff](https://github.com/kiwi-init/channels/commit/77a8fffa018c15444809a55e52d54bd940abd576))

### Other changes

- **Desktop:** build on Livewire 2026.11.5 ([#2547](https://github.com/kiwi-init/channels/pull/2547)) ([acc7a4b](https://github.com/kiwi-init/channels/commit/acc7a4b7484e8da5d34c200bf3a903e53e5db25e))

## 2026.11.23 — 2026-11-17

Tag [v2026.11.23](https://github.com/kiwi-init/channels/releases/tag/v2026.11.23) · commit [2dea493](https://github.com/kiwi-init/channels/commit/2dea49399eeaf0ad29280f9eb245eb54aca4e770) · 2026-11-17

First-load JS: 801,658 bytes (change since 2026.11.22 unavailable: it has no first-load figure)

### Features

- **kiwi task wait:** a task waits on purpose, its clock paused and the board saying why (T11426) ([#2494](https://github.com/kiwi-init/channels/pull/2494)) ([712b16c](https://github.com/kiwi-init/channels/commit/712b16cbf49044afa9778b162156eafd39e90c56))
- Release notes by kind: sections from PR and issue labels, area in bold, PR and commit links, kept highlights (T11736) ([#2500](https://github.com/kiwi-init/channels/pull/2500)) ([97523ca](https://github.com/kiwi-init/channels/commit/97523ca4242fd5901396d7de6f8566de088d5f0c))
- **Clock:** marks read as Kiwi's clock, naming the seat only as poster (T11425) ([#2496](https://github.com/kiwi-init/channels/pull/2496)) ([004d4f3](https://github.com/kiwi-init/channels/commit/004d4f3387bf5124626c71e3722390654c1eafc3))

### Fixes

- **Specs:** the page and list ask for approval only once a draft is marked ready; spec ready --undo (T11423) ([#2493](https://github.com/kiwi-init/channels/pull/2493)) ([5b31064](https://github.com/kiwi-init/channels/commit/5b310643ccc1885387b59965fc90643422bf289d))
- **Clock:** a mark the channel would refuse never reaches the log (T11424, #2491) ([#2495](https://github.com/kiwi-init/channels/pull/2495)) ([6c1a493](https://github.com/kiwi-init/channels/commit/6c1a49372804cfb1d52f094a7e6d5cee14c60fef))
- Phones answer every question asked of them (T12507, #2514) ([#2517](https://github.com/kiwi-init/channels/pull/2517)) ([c448e3c](https://github.com/kiwi-init/channels/commit/c448e3c6f7ef691dc55bd0eb3f30dc9870815c6d))
- Linux window controls stay clickable at every width; their check clicks for real (T12606) ([#2519](https://github.com/kiwi-init/channels/pull/2519)) ([e224b15](https://github.com/kiwi-init/channels/commit/e224b15c81b1dfc7304432f8c8940c252adadd81))
- **Wake:** a Codex wake is checked until its session reads it; a paused queue is named in status, or resumed after a proven restart (T13087) ([#2525](https://github.com/kiwi-init/channels/pull/2525)) ([1d8a2e1](https://github.com/kiwi-init/channels/commit/1d8a2e13ac017a99779e8a68fbf88efe838ba936))

### Performance

- **Daemon:** a long-lived session drops the messages its fold base covers (T12212, #2501) ([#2512](https://github.com/kiwi-init/channels/pull/2512)) ([9f23d81](https://github.com/kiwi-init/channels/commit/9f23d81fdb83f88ca62ff6909badb37d2cc62d47))
- **Specs tab:** the list stays mounted once opened, so going back mounts nothing (T12922, #2513) ([#2522](https://github.com/kiwi-init/channels/pull/2522)) ([e90b06b](https://github.com/kiwi-init/channels/commit/e90b06befd10c7e9864ad497905f133e7c2a0844))

### Tests and CI

- Flows clean up what they start; a join's timeout bounds its whole wait for admission (T12110) ([#2508](https://github.com/kiwi-init/channels/pull/2508)) ([a98349a](https://github.com/kiwi-init/channels/commit/a98349a1c7df12a101a1c88b654df369a259daa2))
- **Android:** the updates-by-day test pins its clock and timezone (T12919, #2516) ([#2521](https://github.com/kiwi-init/channels/pull/2521)) ([83e0079](https://github.com/kiwi-init/channels/commit/83e0079987d357eb8e86e1eef18f108a9a52d8bb))
- **Glass checks:** the sidebar is a pane now, so it stays solid; the top bar shows the wallpaper ([#2529](https://github.com/kiwi-init/channels/pull/2529)) ([b520949](https://github.com/kiwi-init/channels/commit/b52094978c29b5b9b03453718af8b4a2e6d48604))
- **Perf:** Reload is timed to the first frame the seeded row is visible, rechecked a frame later (T13515, #2518) ([#2527](https://github.com/kiwi-init/channels/pull/2527)) ([2dea493](https://github.com/kiwi-init/channels/commit/2dea49399eeaf0ad29280f9eb245eb54aca4e770))

### Other changes

- **Motion:** the palette opens at once, hints and new tiles start near full size, bars move with translate (T5324) ([#2476](https://github.com/kiwi-init/channels/pull/2476)) ([25a86ab](https://github.com/kiwi-init/channels/commit/25a86ab9aba95ba13948627710adb8174334becd))
- Hover looks apply only with a mouse; hover reveals still answer a tap (T5325) ([#2477](https://github.com/kiwi-init/channels/pull/2477)) ([414d1ac](https://github.com/kiwi-init/channels/commit/414d1acf54ae75edf63cbf3ccaea1701bd383684))
- Tab bar takes its new width in one frame instead of animating margin (T5326) ([#2478](https://github.com/kiwi-init/channels/pull/2478)) ([6f93d0d](https://github.com/kiwi-init/channels/commit/6f93d0d37d6d07b7beacd8182cd904faad1db68f))
- **kiwi up:** seats come back after a reboot (T10955) ([#2484](https://github.com/kiwi-init/channels/pull/2484)) ([b36ac50](https://github.com/kiwi-init/channels/commit/b36ac502c4ae2573e86ae7dfba306fc347e85448))
- **Docs:** "After a restart" in every language, and which seats kiwi up brings back (T10955) ([#2488](https://github.com/kiwi-init/channels/pull/2488)) ([bd9f131](https://github.com/kiwi-init/channels/commit/bd9f1319bed788db2c3797055c9cbd2d0ca47648))
- **Checkpoint requests:** Save your checkpoints and a daily time, with the relay keeping the clock (T10994) ([#2485](https://github.com/kiwi-init/channels/pull/2485)) ([7f559a0](https://github.com/kiwi-init/channels/commit/7f559a02bb381b5d3bc94451d5e877f48cac2f0a))
- **Stop hook:** a snapshot of each open task's own worktree, beside its checkpoint (T10996) ([#2486](https://github.com/kiwi-init/channels/pull/2486)) ([725084a](https://github.com/kiwi-init/channels/commit/725084a7850fe4c8689a99eda6645d0a05be5461))
- Bring my agents back: a Settings row and a restart card run kiwi up from the app (T10995) ([#2487](https://github.com/kiwi-init/channels/pull/2487)) ([a778d6a](https://github.com/kiwi-init/channels/commit/a778d6a5ae3eb05298187cf8e4ff414b90bef9cc))
- **Checks:** restore-place's markdown delay applies in WebKit; late-font prints its failures (T11691) ([#2503](https://github.com/kiwi-init/channels/pull/2503)) ([baa2034](https://github.com/kiwi-init/channels/commit/baa20340935db96a8d39053d497ee173491930a5))
- **Shots:** a shot that won't hold still names what kept moving (T11691) ([#2506](https://github.com/kiwi-init/channels/pull/2506)) ([3a6b48c](https://github.com/kiwi-init/channels/commit/3a6b48c8032746b7ae3107e8aee716ac53134ee8))
- **First-load JS:** 132 unread UI words out, a reader guard, a 820,000 budget, first-load bytes in each release's notes (T11860) ([#2505](https://github.com/kiwi-init/channels/pull/2505)) ([ca62f2d](https://github.com/kiwi-init/channels/commit/ca62f2d1dce7d0b97ad037a34e0039dba8b7d077))
- **Feed:** the feed's own correction clamped to the bottom no longer makes you follow (T11691) ([#2509](https://github.com/kiwi-init/channels/pull/2509)) ([bf78c09](https://github.com/kiwi-init/channels/commit/bf78c0976c0fc50b19c7cae00b5db135bd1974c4))
- **Hooks:** a seat's own session always arms its listener, and one that can't is flagged (T11921, #2502) ([#2507](https://github.com/kiwi-init/channels/pull/2507)) ([887b1d8](https://github.com/kiwi-init/channels/commit/887b1d8339605ffb1603515f55c6a8e722f39c05))
- Sidebar, Settings and the open tab are panes; the sidebar has its own width ([#2526](https://github.com/kiwi-init/channels/pull/2526)) ([6ba62ba](https://github.com/kiwi-init/channels/commit/6ba62ba5e9064399d4dfea093ff187194e03e73f))
- kiwi runs on the app's own Bun: one Bun per computer, not three ([#2528](https://github.com/kiwi-init/channels/pull/2528)) ([2129e57](https://github.com/kiwi-init/channels/commit/2129e57b538c95e2428eb9b1e9527cea0518ad7e))

## 2026.11.22 — 2026-11-14

Tag [v2026.11.22](https://github.com/kiwi-init/channels/releases/tag/v2026.11.22) · commit [b8786b1](https://github.com/kiwi-init/channels/commit/b8786b125b4e70994240264820cc730bb870c165) · 2026-11-14

### Fixes

- Pages that draw their own controls parse new text in the render that brings it, so the old tree never shows with new controls (#2423) ([#2445](https://github.com/kiwi-init/channels/pull/2445)) ([636c146](https://github.com/kiwi-init/channels/commit/636c146ab6b45c7062979a7b9c28fddcb1958530))
- **Flows:** multi-seat waits for the listener's read mark, not its print (#2159) ([#2449](https://github.com/kiwi-init/channels/pull/2449)) ([4b0e530](https://github.com/kiwi-init/channels/commit/4b0e530ba809b3c23a3923cc4a43cdf12c26cfd0))
- **ui-image-thumbs:** the drag check reads the data the drag carries, where it is set (#2167) ([#2451](https://github.com/kiwi-init/channels/pull/2451)) ([112ba34](https://github.com/kiwi-init/channels/commit/112ba34f3501efecbb32aee37e92805c8c6a1eb4))
- **Feed:** file chips hold their place before their chunk lands; ui-still waits for a view to open (#2439) ([#2450](https://github.com/kiwi-init/channels/pull/2450)) ([c9c040d](https://github.com/kiwi-init/channels/commit/c9c040ddabd230b1af44ee71afc04449cd511463))
- Keep markdown content and add accessible spoiler reveal ([#2447](https://github.com/kiwi-init/channels/pull/2447)) ([6a09e9a](https://github.com/kiwi-init/channels/commit/6a09e9a9b9826d79bce741c99b0ec49780f8bb81))
- **Wake:** Deep Code seats wake on any footer that keeps its prompt's structure (#2446) ([#2448](https://github.com/kiwi-init/channels/pull/2448)) ([1f8f3f2](https://github.com/kiwi-init/channels/commit/1f8f3f2e80a3f85f8e3a2f26027ae39e92d74b7f))

### Other changes

- **Home is gone:** the app lands on a channel instead (#3713) ([#2429](https://github.com/kiwi-init/channels/pull/2429)) ([2b39395](https://github.com/kiwi-init/channels/commit/2b393958a2208a440ce89007a4684bb9743b59f3))
- **Panes:** all four corners round with the sidebar hidden (#3721) ([#2430](https://github.com/kiwi-init/channels/pull/2430)) ([c0b633e](https://github.com/kiwi-init/channels/commit/c0b633e00ba4df7574377d816b3018d63ce5c24a))
- **refactor:** share card and activity line sanitizer ([#2435](https://github.com/kiwi-init/channels/pull/2435)) ([51a594a](https://github.com/kiwi-init/channels/commit/51a594a6b29ee716cc00d2e1ca61eb3557c12b78))
- **Core:** files and images share one blob seal, store and read (#2434, T9711) ([#2436](https://github.com/kiwi-init/channels/pull/2436)) ([e42961f](https://github.com/kiwi-init/channels/commit/e42961fd2bf601eade76a28e93195af3f2378a50))
- **UI build:** lazy imports stop listing the first load as preload deps (796,912 to 780,648 bytes) ([#2437](https://github.com/kiwi-init/channels/pull/2437)) ([23b6cbf](https://github.com/kiwi-init/channels/commit/23b6cbff8b5ff8c43ab9e708b0c7d642dfa73941))
- **Channel switch:** a channel you opened keeps its live connection, so going back makes no new one (#3909) ([#2438](https://github.com/kiwi-init/channels/pull/2438)) ([3cc414b](https://github.com/kiwi-init/channels/commit/3cc414b14934fc7e80f1c2f3c0faaffa6950ed84))
- **Channel switch:** the feed opens on 50 rows and lays out once (#3909) ([#2440](https://github.com/kiwi-init/channels/pull/2440)) ([c39d2d9](https://github.com/kiwi-init/channels/commit/c39d2d97b36822d2ce95f94f41419b32fb452c63))
- **kiwi send:** the CLI keeps a sealed copy of each thread's doc, so a send fetches only what's new (#3909) ([#2441](https://github.com/kiwi-init/channels/pull/2441)) ([378fce8](https://github.com/kiwi-init/channels/commit/378fce89100178df8bc5a50af1356e71f83ba6cc))
- **Channel switch:** opening a channel makes no relay calls (#3909) ([#2442](https://github.com/kiwi-init/channels/pull/2442)) ([f1aad95](https://github.com/kiwi-init/channels/commit/f1aad9555e68fdca76b2f76dfec4deb670019f4f))
- **Shots:** two runs of one commit match, Chromium 0 of 161, WebKit 2 of 159 (T2770) ([#2452](https://github.com/kiwi-init/channels/pull/2452)) ([3ee8869](https://github.com/kiwi-init/channels/commit/3ee8869e0f1f92fcfd4dc8d396564c23086b2804))
- **Settings:** the interface version sits on the version row, and the checkpoint switch reads plainly (#2108, T4132) ([#2454](https://github.com/kiwi-init/channels/pull/2454)) ([2622a64](https://github.com/kiwi-init/channels/commit/2622a64ece88f7070dedd9d9b4808a16cbc172f4))
- **Rooms:** each sidebar section's "N hidden" opens only its own rows, and channel mute reads "Mute channel" everywhere (#2085, T4133) ([#2455](https://github.com/kiwi-init/channels/pull/2455)) ([83341c8](https://github.com/kiwi-init/channels/commit/83341c8daefbb083d1c1618da77dde5e21f39312))
- **ui-flicker:** a sweep that lists every element that flashes, jumps or blanks for a frame in 14 flows (T4462) ([#2458](https://github.com/kiwi-init/channels/pull/2458)) ([6df74e1](https://github.com/kiwi-init/channels/commit/6df74e12b99a453591cb31c4768116b6e8064913))
- Needs you is a markdown page drawn by the engine, nothing lost (T3566) ([#2457](https://github.com/kiwi-init/channels/pull/2457)) ([3e5a342](https://github.com/kiwi-init/channels/commit/3e5a342302da77744ebb8eb5f66266a45a430941))
- **Feed:** scrolling up runs its whole length; earlier lines load once the scroll is still (T4458) ([#2456](https://github.com/kiwi-init/channels/pull/2456)) ([5257955](https://github.com/kiwi-init/channels/commit/5257955f92e56a54ccf91ea6f66e29976e41ae29))
- Views that replace each other swap in one frame, with no fade or rise (#4462) ([#2459](https://github.com/kiwi-init/channels/pull/2459)) ([5bfdee4](https://github.com/kiwi-init/channels/commit/5bfdee408eecbc931fbcee8729c9878d95191fe0))
- **Android:** updates leave the feed for an Updates sheet (T10567, #2460) ([#2461](https://github.com/kiwi-init/channels/pull/2461)) ([25f9d9a](https://github.com/kiwi-init/channels/commit/25f9d9a216dd4582d18803ab387cb92fb06976d0))
- A new channel opens at once, so a modal opened right after stays open (T4473) ([#2463](https://github.com/kiwi-init/channels/pull/2463)) ([052bdcf](https://github.com/kiwi-init/channels/commit/052bdcf094c1af4adc4d7857e9732917b1a295d2))
- Specs as a markdown page, nothing lost (T4532) ([#2462](https://github.com/kiwi-init/channels/pull/2462)) ([b1d562f](https://github.com/kiwi-init/channels/commit/b1d562fcc21c3a17869e16d50562e33eebd2cf88))
- **Checks:** restore-place measures markdown heights once markdown is in (T4509) ([#2464](https://github.com/kiwi-init/channels/pull/2464)) ([ef88d92](https://github.com/kiwi-init/channels/commit/ef88d920ecd42f62cc43d567466a0814545b8928))
- ui-flicker reads each frame in a fresh ResizeObserver (T4462) ([#2466](https://github.com/kiwi-init/channels/pull/2466)) ([080c21a](https://github.com/kiwi-init/channels/commit/080c21a6b4488a2b20b54e9c6f0dc8af38fec06d))
- **Lead's list:** kiwi status lists the decisions handed to the Lead, and its wake counts them (T504) ([#2465](https://github.com/kiwi-init/channels/pull/2465)) ([f0f0c05](https://github.com/kiwi-init/channels/commit/f0f0c05c8d479cdbc3ca5ed0f0c8daf204ea8094))
- **Feed:** rows passing under a still pointer don't flash their hover toolbar (T4462) ([#2467](https://github.com/kiwi-init/channels/pull/2467)) ([c2bdfe7](https://github.com/kiwi-init/channels/commit/c2bdfe7f49ef88c0d7d946de7251afca3b9b9b0f))
- **Reload:** fewer member, request and info reads (#3909) ([#2443](https://github.com/kiwi-init/channels/pull/2443)) ([5d9fb6d](https://github.com/kiwi-init/channels/commit/5d9fb6df7ae8094701b784008be3c3bb88ab57c6))
- **Feed:** your own picture doesn't blink as its line lands (T1116) ([#2469](https://github.com/kiwi-init/channels/pull/2469)) ([bfca053](https://github.com/kiwi-init/channels/commit/bfca0536f4ded5bc5b38997f69dd272ed8529d11))
- **Ask card:** your last answer on the same task or message shows (T507) ([#2468](https://github.com/kiwi-init/channels/pull/2468)) ([01cb7e0](https://github.com/kiwi-init/channels/commit/01cb7e050a614878dd0a439f45083e67c5d403ed))
- **Asks:** a reply typed in the chat doesn't close a decision, a tap does (T509) ([#2470](https://github.com/kiwi-init/channels/pull/2470)) ([809de7d](https://github.com/kiwi-init/channels/commit/809de7d6ad355d918bd8e5efd6ad8af33c598211))
- **Asks:** a second decision on a task joins the open card (T508) ([#2471](https://github.com/kiwi-init/channels/pull/2471)) ([32d04a3](https://github.com/kiwi-init/channels/commit/32d04a31a8480bb2f5c5cd801d64b92d2a170760))
- **Feed:** a cold open shows its rows whole, with markdown and cards in place (T4221) ([#2472](https://github.com/kiwi-init/channels/pull/2472)) ([5284f77](https://github.com/kiwi-init/channels/commit/5284f77bbb9325d79576c04058830fa634019d79))
- **Asks:** decisions on one area go to a person as one card (T505) ([#2473](https://github.com/kiwi-init/channels/pull/2473)) ([2fdb65a](https://github.com/kiwi-init/channels/commit/2fdb65ae00dd9006e0ae40fec54df9c6bf12b9dc))
- **Needs you:** what the Lead settled itself is one line to open and overrule (T506) ([#2474](https://github.com/kiwi-init/channels/pull/2474)) ([5426146](https://github.com/kiwi-init/channels/commit/5426146e9e7cfdc947b6313de7a3766c71917b53))

## 2026.11.21 — 2026-11-13

Tag [v2026.11.21](https://github.com/kiwi-init/channels/releases/tag/v2026.11.21) · commit [9a8cefa](https://github.com/kiwi-init/channels/commit/9a8cefa6ee2642cf200e80cd9dfe051ff0cb575e) · 2026-11-13

### Features

- **Chat:** local time on hover for UTC times in messages (#2367) ([#2375](https://github.com/kiwi-init/channels/pull/2375)) ([6e46ca5](https://github.com/kiwi-init/channels/commit/6e46ca57923bb7a70b43518d8dbf87be26327435))

### Other changes

- Consolidate exact-copy helpers and constants (T8832, #2400) ([#2403](https://github.com/kiwi-init/channels/pull/2403)) ([b82086b](https://github.com/kiwi-init/channels/commit/b82086b6f334f764d70130f9cfee01fec27cfe3b))
- **test:** share isolated hooks fixtures ([#2404](https://github.com/kiwi-init/channels/pull/2404)) ([758ac50](https://github.com/kiwi-init/channels/commit/758ac506a4dbc6648b29545692d1e627a834ebbb))
- **Desktop:** UI contract history comes from per-version deltas (#2401, T8833) ([#2406](https://github.com/kiwi-init/channels/pull/2406)) ([6f30321](https://github.com/kiwi-init/channels/commit/6f30321e5fd141d9a3ca3baf63106a9387aec290))
- **refactor:** share scripts GitHub transport with caller policies ([#2409](https://github.com/kiwi-init/channels/pull/2409)) ([6fbe5ea](https://github.com/kiwi-init/channels/commit/6fbe5ea31a5a49c39f9c1e427899f08603bfe0c4))
- **Theme:** tokens.css takes its built-in colours from channels.ts (T8978, #2407) ([#2410](https://github.com/kiwi-init/channels/pull/2410)) ([420174a](https://github.com/kiwi-init/channels/commit/420174af98030122ec9dc1e2afd54573076e24b2))
- **Feed:** a move up counts as yours only if you touched something (T2635) ([#2405](https://github.com/kiwi-init/channels/pull/2405)) ([400312e](https://github.com/kiwi-init/channels/commit/400312ee61184734d60cdbfff4135442f1feb42b))
- **Desktop:** the native gear check uses real X clicks again (#2364) ([#2411](https://github.com/kiwi-init/channels/pull/2411)) ([2b432da](https://github.com/kiwi-init/channels/commit/2b432da8176794d724301530cc546675d580973d))
- **Harness:** model and activity readers share their lookups (#2414) ([#2415](https://github.com/kiwi-init/channels/pull/2415)) ([cdf3b22](https://github.com/kiwi-init/channels/commit/cdf3b2287ec1796aeb25681c39372681aa2f0427))
- **refactor:** share loop adapter helpers ([#2417](https://github.com/kiwi-init/channels/pull/2417)) ([f25c186](https://github.com/kiwi-init/channels/commit/f25c1864f4f7f0e49143c4a46ecb6e0a8ff1ac6e))
- **Hooks:** one module for the Claude-shaped installers (T9137) ([#2416](https://github.com/kiwi-init/channels/pull/2416)) ([287b8f9](https://github.com/kiwi-init/channels/commit/287b8f932fe14786fb382c598fb34d281c865b75))
- **Own bubble check:** count only frames WebKit painted, at the width it painted (T933) ([#2418](https://github.com/kiwi-init/channels/pull/2418)) ([904f052](https://github.com/kiwi-init/channels/commit/904f0522afdd037c80d55f12f68b3eda3aaa75a2))
- **Feed:** older rows that load above you mid-wheel are made up for (T2559) ([#2424](https://github.com/kiwi-init/channels/pull/2424)) ([71e46f3](https://github.com/kiwi-init/channels/commit/71e46f3987357d4e86dfbe4e0d117b72cda22754))
- **UI:** change-block and restore-version share one LiveDoc lifecycle (#2422, T9300) ([#2425](https://github.com/kiwi-init/channels/pull/2425)) ([be731dc](https://github.com/kiwi-init/channels/commit/be731dc6522309782a3a52abd77f8eb9f3ef7a5f))
- **refactor:** share member record reseal mechanics ([#2426](https://github.com/kiwi-init/channels/pull/2426)) ([22dda64](https://github.com/kiwi-init/channels/commit/22dda642206e248e8dcc3a4e63e85fbda1707c90))
- Glass shell, split panes and markdown pages (T2107, T2427, T2631, T2632) ([#2397](https://github.com/kiwi-init/channels/pull/2397)) ([6cc1f5d](https://github.com/kiwi-init/channels/commit/6cc1f5d99047137e9b6948581e75d6d292e82c45))
- **Feed:** each open conversation keeps its own older rows, so two panes of one room stop trimming each other (#3652) ([#2428](https://github.com/kiwi-init/channels/pull/2428)) ([5bd0dfe](https://github.com/kiwi-init/channels/commit/5bd0dfe32a84f354c8293a11d8667f46b3eed7c5))
- **UI:** one dismissal hook for the GIF pickers, updates panel and usage card (T9299, #2421) ([#2427](https://github.com/kiwi-init/channels/pull/2427)) ([f616af7](https://github.com/kiwi-init/channels/commit/f616af7e28be42ab0ff8263015c1d407f725c211))
- **Feed:** a reader at the bottom stays there while lines arrive, whatever the timing (#2399, T8812) ([#2419](https://github.com/kiwi-init/channels/pull/2419)) ([dc5f814](https://github.com/kiwi-init/channels/commit/dc5f814d079eb3f6ed0f2120e9b4e2bf8d09d06a))

## 2026.11.20 — 2026-11-13

Tag [v2026.11.20](https://github.com/kiwi-init/channels/releases/tag/v2026.11.20) · commit [57ef6ed](https://github.com/kiwi-init/channels/commit/57ef6ed1fef5e24bd87c24e9089295c863416944) · 2026-11-13

### Features

- **Linux:** window controls at the top-right, with Linux styling and a live Maximize/Restore (#2325, T6466) ([#2366](https://github.com/kiwi-init/channels/pull/2366)) ([268a821](https://github.com/kiwi-init/channels/commit/268a821ed8a7a7a24533331bb448e606d88eee1d))
- **Specs:** worker names on avatar hover and keyboard focus (#2335) ([#2371](https://github.com/kiwi-init/channels/pull/2371)) ([65318c9](https://github.com/kiwi-init/channels/commit/65318c9550b27a05f8a9c5a3c74f7087acc7aed1))
- **Top bar:** Back and Forward buttons (#2372, T7608) ([#2377](https://github.com/kiwi-init/channels/pull/2377)) ([092629d](https://github.com/kiwi-init/channels/commit/092629dec8a8882ff4cfa1b73427402d7e01ac32))
- **Chat:** opening a room, a DM or a channel focuses its composer (#2376) ([#2381](https://github.com/kiwi-init/channels/pull/2381)) ([aeeb705](https://github.com/kiwi-init/channels/commit/aeeb705651fc3f56462d80932edc4591afc19a86))

### Fixes

- **Desktop:** quitting during the first start ends the CLI install, leaving no build running and no half-made file (T58) ([#2353](https://github.com/kiwi-init/channels/pull/2353)) ([2c5df14](https://github.com/kiwi-init/channels/commit/2c5df14edb097b1fb3745ba8ace56b3ed3a4f15e))
- **Copy:** a refused copy falls back to the app's clipboard, then selects the command for a copy by hand (#2322, T6463) ([#2343](https://github.com/kiwi-init/channels/pull/2343)) ([f3d7a3b](https://github.com/kiwi-init/channels/commit/f3d7a3bd7cacce6b297f7a212cd934a8fb325c15))
- **Linux:** the Settings gear opts out of the window drag region (#2323, T6465) ([#2344](https://github.com/kiwi-init/channels/pull/2344)) ([518183f](https://github.com/kiwi-init/channels/commit/518183ff6e35b34e90748e3ea1286c06f3d32054))
- **Task panel:** quote from a task's description and its messages (T7654) ([#2378](https://github.com/kiwi-init/channels/pull/2378)) ([24a71dd](https://github.com/kiwi-init/channels/commit/24a71ddc3a1646755ec110681819d635c387aa26))
- **Sidebar:** Others' direct messages keeps its heading while one is open (T8210) ([#2387](https://github.com/kiwi-init/channels/pull/2387)) ([9a00098](https://github.com/kiwi-init/channels/commit/9a000988448cf89467433cb6c6c416356de41d68))
- **Rooms:** keep membership summary, editor and saves consistent ([#2392](https://github.com/kiwi-init/channels/pull/2392)) ([0359140](https://github.com/kiwi-init/channels/commit/03591405a9220cf82cc687b947321bdc7f2a5b6d))
- **Activity:** thinking only for verified work; anything unverified is unknown (T8029) ([#2383](https://github.com/kiwi-init/channels/pull/2383)) ([f6bd335](https://github.com/kiwi-init/channels/commit/f6bd3358abef1896ff9b67ee7d59854724cb68cc))
- Preserve departure context in human DMs (#2389) ([#2394](https://github.com/kiwi-init/channels/pull/2394)) ([5cd7a4c](https://github.com/kiwi-init/channels/commit/5cd7a4cf4755a8e0be942139a4a0a4fb78198dc0))
- Identify departed reviewers in task details and picker (#2390) ([#2395](https://github.com/kiwi-init/channels/pull/2395)) ([8870988](https://github.com/kiwi-init/channels/commit/88709885d6d74f4361704f11ee0ac964441610bf))

### Other changes

- **Tests:** a channel-store test that fails can't leave its store open into the next one (#2261) ([#2294](https://github.com/kiwi-init/channels/pull/2294)) ([01e039b](https://github.com/kiwi-init/channels/commit/01e039b9aa07923cd990abf8edfcab226a3e0c6e))
- **Feed:** a restart lands on the saved message even while markdown is still loading (#2248) ([#2296](https://github.com/kiwi-init/channels/pull/2296)) ([6598a30](https://github.com/kiwi-init/channels/commit/6598a30d649e7d4817a1cf9086f5b8be1063fbfd))
- **Feed:** a restart just below the permission ask lands on the saved message (#2295) ([#2298](https://github.com/kiwi-init/channels/pull/2298)) ([3842a9b](https://github.com/kiwi-init/channels/commit/3842a9b813759733421e6d50e46d1d3e595b7497))
- **Task panel:** long text wraps inside the panel, only code blocks scroll sideways (T5842) ([#2299](https://github.com/kiwi-init/channels/pull/2299)) ([feea0c7](https://github.com/kiwi-init/channels/commit/feea0c78971b37e0828f740e4ecf036a1f2528d0))
- **UI:** one grid, the channels and views in the sidebar, everything on 8px ([#2301](https://github.com/kiwi-init/channels/pull/2301)) ([9558705](https://github.com/kiwi-init/channels/commit/955870515bb827c0a6d1a8eea6cff5c7034e2545))
- **UI:** a blueprint overlay that measures and audits the layout (⌥⌘B), and a script that runs its audit ([#2302](https://github.com/kiwi-init/channels/pull/2302)) ([d3b3936](https://github.com/kiwi-init/channels/commit/d3b3936e0386b9d4467d576e8e79f28db809d73f))
- **UI:** search results sit above the channel tiles ([#2303](https://github.com/kiwi-init/channels/pull/2303)) ([322d41c](https://github.com/kiwi-init/channels/commit/322d41c6c2870b9facc49f9dd1e3f0ba9e7572b6))
- **Sidebar:** every agent in the channel is a row, and whoever left is hidden ([#2304](https://github.com/kiwi-init/channels/pull/2304)) ([e468034](https://github.com/kiwi-init/channels/commit/e468034d7343f362940c286d20e10e36ecd34abf))
- **Second sidebar:** Now and Activity share the column, with a toggle ([#2305](https://github.com/kiwi-init/channels/pull/2305)) ([deb3eb9](https://github.com/kiwi-init/channels/commit/deb3eb913158cab9a0c6e3c907925cae29c3d403))
- **Sidebar:** its right edge drags to resize it, and the width is kept ([#2308](https://github.com/kiwi-init/channels/pull/2308)) ([a39c1f0](https://github.com/kiwi-init/channels/commit/a39c1f0f8b1492762b13e681fda962088de7de2f))
- **Delete channel:** the typed name matches whatever its case, and the field shows the name ([#2307](https://github.com/kiwi-init/channels/pull/2307)) ([748eec9](https://github.com/kiwi-init/channels/commit/748eec9f8d075100e82831bfaf3f4725d5337562))
- **PR card:** a long branch or check name is cut with an ellipsis instead of widening the panel (T5849) ([#2300](https://github.com/kiwi-init/channels/pull/2300)) ([916ed9b](https://github.com/kiwi-init/channels/commit/916ed9b1d87ddc03462aa3ebc88037e2049f8449))
- **Settings:** a Layout choice, Sidebar or Top bar ([#2309](https://github.com/kiwi-init/channels/pull/2309)) ([e03b92c](https://github.com/kiwi-init/channels/commit/e03b92ca71358b9b325b3b09cdfe3378cdf31608))
- **Feed:** a room with a doc no longer rests past its last message ([#2315](https://github.com/kiwi-init/channels/pull/2315)) ([edcdf18](https://github.com/kiwi-init/channels/commit/edcdf182662d3259c73e52e47ee061bf29025321))
- Channels are tabs at the top of the window, in both layouts ([#2316](https://github.com/kiwi-init/channels/pull/2316)) ([d561734](https://github.com/kiwi-init/channels/commit/d5617349b7524393429fb3cc5cb2d5a159120d32))
- **Top row:** Search sits at the far end, and in Settings the tabs clear the title ([#2317](https://github.com/kiwi-init/channels/pull/2317)) ([f61b7cd](https://github.com/kiwi-init/channels/commit/f61b7cde34b5746d9951412760a6360cce9060c6))
- **Relay:** 3,000 messages a day on the free plan ([#2318](https://github.com/kiwi-init/channels/pull/2318)) ([632ad77](https://github.com/kiwi-init/channels/commit/632ad77bf741d8053dbcc89b1bc70fbc1b10a3e8))
- **Join:** an invite token that fails verification stops the join, and a bad one shows as failed (#2311) ([#2313](https://github.com/kiwi-init/channels/pull/2313)) ([4e53295](https://github.com/kiwi-init/channels/commit/4e53295c05b529c15eb7663587c7b99727ec771f))
- **Join:** a resumed key says it ignored --persona and --nick, and why (#2312) ([#2314](https://github.com/kiwi-init/channels/pull/2314)) ([a73f4c5](https://github.com/kiwi-init/channels/commit/a73f4c58a11010996b1fa972df8be4e183cf8267))
- **Clock:** a wait set before approval pauses the quiet clock (T5986) ([#2310](https://github.com/kiwi-init/channels/pull/2310)) ([c73bd6d](https://github.com/kiwi-init/channels/commit/c73bd6d1d8070fc5aaa33ba184abc29408b53992))
- **Add an agent:** the modal holds still while the name is typed (T21) ([#2321](https://github.com/kiwi-init/channels/pull/2321)) ([a61910a](https://github.com/kiwi-init/channels/commit/a61910a3ffb58aba72502ecd3c2d1596eb15cdf7))
- **Own bubble:** a grey fill, as wide as its longest line, and a run reads as one group (T31) ([#2326](https://github.com/kiwi-init/channels/pull/2326)) ([ff7e76e](https://github.com/kiwi-init/channels/commit/ff7e76ee28b9275344df34b90bcdc93fd3aaf1ff))
- **Modal check:** the size it compares is the laid-out one, not the one painted while the modal opens (T21) ([#2327](https://github.com/kiwi-init/channels/pull/2327)) ([8207066](https://github.com/kiwi-init/channels/commit/82070663448771da20ce93264caebe28688156c3))
- **Own bubble:** refit when a font arrives, and the check reads a settled page (T31) ([#2328](https://github.com/kiwi-init/channels/pull/2328)) ([9107806](https://github.com/kiwi-init/channels/commit/9107806e65179b18a4ca77fb22e76b86f39cc0e9))
- **Reviewers:** an opt-in fresh session after each verdict (spec #6005) ([#2324](https://github.com/kiwi-init/channels/pull/2324)) ([f4a3687](https://github.com/kiwi-init/channels/commit/f4a3687d4b315edb31827164a7636c436fee4f5c))
- **Own bubble:** a row is fitted again only when its room, height or text changed (T31) ([#2330](https://github.com/kiwi-init/channels/pull/2330)) ([a2e924d](https://github.com/kiwi-init/channels/commit/a2e924d4dc09ce9facffeccb55f485cc86d9c9e7))
- **Feed:** a change of width leaves the conversation where it was (T231) ([#2329](https://github.com/kiwi-init/channels/pull/2329)) ([5faf2d8](https://github.com/kiwi-init/channels/commit/5faf2d829ec21b601ca21d225d59d00b456077db))
- **Sidebar peek:** a raised sheet that starts under the tab row (T339) ([#2332](https://github.com/kiwi-init/channels/pull/2332)) ([876e2fe](https://github.com/kiwi-init/channels/commit/876e2fee70a955a0c075f747f97e761b766a0093))
- **Chat:** replies to a message with a spec show in its room, tagged (T501) ([#2333](https://github.com/kiwi-init/channels/pull/2333)) ([8071af6](https://github.com/kiwi-init/channels/commit/8071af68fdceaa5cdb1c5cbd2bd30952a79bf750))
- **Tasks:** the lead or a member takes a task whose owner left (#2320, T6366) ([#2340](https://github.com/kiwi-init/channels/pull/2340)) ([144518d](https://github.com/kiwi-init/channels/commit/144518d6bbccd0da2c4b9f1521bb596ef95ddbd1))
- **Settings:** a Tasks tab holds quiet time, landing and the reviewer reset (T6537) ([#2334](https://github.com/kiwi-init/channels/pull/2334)) ([7170cca](https://github.com/kiwi-init/channels/commit/7170cca48172fadef5378d4bd4d0f3d6d356a476))
- **Chat:** the line under your message names who can't be woken, who isn't listening and who is busy (T614) ([#2342](https://github.com/kiwi-init/channels/pull/2342)) ([c90df86](https://github.com/kiwi-init/channels/commit/c90df8689663b55596fb5e47194f93ac0fc5b902))
- **Feed:** scrolling down drops the rows above that fit, so a long scroll on slow frames stops holding every row (T578) ([#2338](https://github.com/kiwi-init/channels/pull/2338)) ([47a5c31](https://github.com/kiwi-init/channels/commit/47a5c310f3270a3baf145249df0fcf9b3b332b36))
- **Channel tabs:** a browser's tab strip, and a long name takes the room its neighbours don't use (T93) ([#2345](https://github.com/kiwi-init/channels/pull/2345)) ([8e8016d](https://github.com/kiwi-init/channels/commit/8e8016d54c7a591f17cec1e52c8dc426150d0552))
- **Own messages:** the hover tools show only over the message, never on its words (T36) ([#2337](https://github.com/kiwi-init/channels/pull/2337)) ([f7f999c](https://github.com/kiwi-init/channels/commit/f7f999c4aa25b71eed668ca35b9f6109c893a2df))
- **Harness:** a page error says the check it came after, its stack and, for a resize observer loop, the element and the observer (T62) ([#2341](https://github.com/kiwi-init/channels/pull/2341)) ([a0b937f](https://github.com/kiwi-init/channels/commit/a0b937f9d3702149b2332461ca9a9e1f666f0f4c))
- kiwi send and reply: after the sent line, who the message waits on (T616) ([#2346](https://github.com/kiwi-init/channels/pull/2346)) ([709ab79](https://github.com/kiwi-init/channels/commit/709ab79e80ca38fb95df30b1655cdb9b500a4c64))
- **Own messages:** the hover tools sit beside the bubble when its line has room (T829) ([#2347](https://github.com/kiwi-init/channels/pull/2347)) ([d935ccc](https://github.com/kiwi-init/channels/commit/d935cccf42555c6c75ae245876264c916c990c24))
- **Sidebar:** it stays where you scroll it while the highlight moves to the row you opened, so a click right after lands (T723) ([#2350](https://github.com/kiwi-init/channels/pull/2350)) ([c14930b](https://github.com/kiwi-init/channels/commit/c14930be89d80d95292b0db281c948efb9c363b5))
- **Signs:** a room message counts only the agents it reaches (T1000) ([#2348](https://github.com/kiwi-init/channels/pull/2348)) ([52f693c](https://github.com/kiwi-init/channels/commit/52f693cdd5d7677189214e8740a4940081de470b))
- **Feed:** the row drop from #2338 comes back out: the conversation jumped while scrolling down (T1211) ([#2352](https://github.com/kiwi-init/channels/pull/2352)) ([65cb792](https://github.com/kiwi-init/channels/commit/65cb792171a961dcad3b22ec020c73a7e4ef29a4))
- **Wake:** an attempt that ends on an error is a line in wake.log, and a missed wake in the tests prints the daemon's record (T1137) ([#2355](https://github.com/kiwi-init/channels/pull/2355)) ([605545e](https://github.com/kiwi-init/channels/commit/605545ecedc0cf21232ac9ca64c123c046bea448))
- **kiwi cleanup:** a CLI the app left half-made is removed once its process is gone (T1310) ([#2356](https://github.com/kiwi-init/channels/pull/2356)) ([aa4063a](https://github.com/kiwi-init/channels/commit/aa4063ad473afd589194d67c18405ce17fec1f62))
- **Feed:** the row drop is back, and the conversation no longer jumps when rows leave (T1211) ([#2354](https://github.com/kiwi-init/channels/pull/2354)) ([1b6c2fb](https://github.com/kiwi-init/channels/commit/1b6c2fb17577638879544be0068f8f73af5f3040))
- **Clock:** a refused quiet mark isn't posted again every minute (T6353, #2319) ([#2362](https://github.com/kiwi-init/channels/pull/2362)) ([390ff57](https://github.com/kiwi-init/channels/commit/390ff57baaa6adf176fe72b9d87ad2678f980e61))
- **Shell:** the top bar and the sidebars are one frame around the page (T1346) ([#2358](https://github.com/kiwi-init/channels/pull/2358)) ([cd4d084](https://github.com/kiwi-init/channels/commit/cd4d084f183e8be9cd65b9657c72df9daf2eb619))
- Doc pipe in dev builds: each event reaches the page in a task of its own, the main cause of the resize observer loop in doc, send (T1336) ([#2365](https://github.com/kiwi-init/channels/pull/2365)) ([edc0572](https://github.com/kiwi-init/channels/commit/edc057292b08fb72036af05bba04902e3e77a0a2))
- **Settings:** removing a repo keeps the settings dialog open (#2339) ([#2359](https://github.com/kiwi-init/channels/pull/2359)) ([5301d18](https://github.com/kiwi-init/channels/commit/5301d1830fbdadcd10445a2ef186d78070b01c14))
- **Roles:** an Ask people power of its own, off for builders (T502) ([#2357](https://github.com/kiwi-init/channels/pull/2357)) ([31cea9e](https://github.com/kiwi-init/channels/commit/31cea9e332cec12a342616aa3cd092fe59b2820b))
- **Thread doc:** a line's pictures and files travel on its message, so nothing lives only in its block (T155) ([#2349](https://github.com/kiwi-init/channels/pull/2349)) ([5cc3a79](https://github.com/kiwi-init/channels/commit/5cc3a792ab4343c73306ec2d478aaa7d068fa701))
- **Feed:** an agent's line counts once on the New messages button (T1579) ([#2363](https://github.com/kiwi-init/channels/pull/2363)) ([90be8e8](https://github.com/kiwi-init/channels/commit/90be8e87167c07a092d448c94d42ede28bc80a26))
- **Tasks:** a PR linked in another task's thread counts for that task only (T1607) ([#2361](https://github.com/kiwi-init/channels/pull/2361)) ([f2231d6](https://github.com/kiwi-init/channels/commit/f2231d677a2c1c117eeeeba0e32215f84acbd5c2))
- **ask-human:** without Ask people it goes to the Lead (T503) ([#2360](https://github.com/kiwi-init/channels/pull/2360)) ([cd3cc5e](https://github.com/kiwi-init/channels/commit/cd3cc5e82569b0a2ea29f9cf20f6db065d655369))
- **Sidebar:** the open row is a pill on the frame, with nothing cut into the page (T1986) ([#2368](https://github.com/kiwi-init/channels/pull/2368)) ([8707c54](https://github.com/kiwi-init/channels/commit/8707c545c4d9c84e5cc194068aa0217f72c8a7b7))
- **Wake:** Deep Code seats by their tmux pane, typing only on its empty prompt (T7367) ([#2369](https://github.com/kiwi-init/channels/pull/2369)) ([38eb914](https://github.com/kiwi-init/channels/commit/38eb9143643e4acbdc2f49b0b7e58d3192642372))
- **Second sidebar:** it sits on the page, not on the frame (T2106) ([#2370](https://github.com/kiwi-init/channels/pull/2370)) ([9ebbf1b](https://github.com/kiwi-init/channels/commit/9ebbf1b945c4aced9c75b311af5570826cc6ab83))
- **Feed:** its promises are one list, each with a check that fails when it breaks (T617) ([#2351](https://github.com/kiwi-init/channels/pull/2351)) ([facb185](https://github.com/kiwi-init/channels/commit/facb1858e7df2c01e480cabcf71a6dadb1788fef))
- **Jump to latest:** the feed keeps heading for its end until it gets there (T2470) ([#2379](https://github.com/kiwi-init/channels/pull/2379)) ([31a9316](https://github.com/kiwi-init/channels/commit/31a931612958925c4359b8538ddbdd236f9bde30))
- **Time:** Yesterday is the local calendar day before today, across clock changes (T7936) ([#2380](https://github.com/kiwi-init/channels/pull/2380)) ([f208291](https://github.com/kiwi-init/channels/commit/f20829143299f2383a76598f90c95493ec6467c4))
- **UI:** icons only later screens use load with those screens (first load back under budget) ([#2385](https://github.com/kiwi-init/channels/pull/2385)) ([7ee6cc1](https://github.com/kiwi-init/channels/commit/7ee6cc1ffb3c33cb37f26ee7ed5ea84ccd50a919))
- **Channel store:** the lean folder loads before the first window trim needs it (#2261) ([#2384](https://github.com/kiwi-init/channels/pull/2384)) ([b686df3](https://github.com/kiwi-init/channels/commit/b686df344a221685268756e75c9c3615eb615238))
- **Deps:** refresh npm workspaces and the Gradle wrapper (#2393, T8224) ([#2396](https://github.com/kiwi-init/channels/pull/2396)) ([6fd9704](https://github.com/kiwi-init/channels/commit/6fd97040b9bff07139e54ad07cdb3aaff2e21d99))
- **Doc feed:** new rows are laid out at once, and a changed line of yours once (T1336) ([#2373](https://github.com/kiwi-init/channels/pull/2373)) ([f608bf6](https://github.com/kiwi-init/channels/commit/f608bf682d932d3c4cdc23ea4a434c0b416e067c))

## 2026.11.19 — 2026-11-11

Tag [v2026.11.19](https://github.com/kiwi-init/channels/releases/tag/v2026.11.19) · commit [372f0ad](https://github.com/kiwi-init/channels/commit/372f0adeddd699495ef0212b14dab1aee4b2c203) · 2026-11-11

### Other changes

- **Snapshot:** the seal holds 1.5 MB and the base stores check runs compactly, so a busy channel's snapshot seals again (T5130) ([#2291](https://github.com/kiwi-init/channels/pull/2291)) ([d31822d](https://github.com/kiwi-init/channels/commit/d31822d271262a30bdad23455d4578f31ece58a6))

## 2026.11.18 — 2026-11-10

Tag [v2026.11.18](https://github.com/kiwi-init/channels/releases/tag/v2026.11.18) · commit [10e13a0](https://github.com/kiwi-init/channels/commit/10e13a019ae368593c3545259f77285ca781c3da) · 2026-11-10

### Other changes

- **Right panel:** it pushes the chat again, down to narrow windows (T5516) ([#2282](https://github.com/kiwi-init/channels/pull/2282)) ([18aa405](https://github.com/kiwi-init/channels/commit/18aa40535271630d669d374853cb0ecde5f95c72))
- **App:** a task shows whose move it is, how long it has been quiet, and its landing steps (T4172) ([#2280](https://github.com/kiwi-init/channels/pull/2280)) ([e777602](https://github.com/kiwi-init/channels/commit/e777602b32c7190281fee89f08d53813a5b38bfe))
- **Waker:** the daemon hosting a quiet task's mover wakes it once; attempted, delivered and read are kept apart; unread goes to the lead (T4171) ([#2279](https://github.com/kiwi-init/channels/pull/2279)) ([5ac230e](https://github.com/kiwi-init/channels/commit/5ac230e7d31740a207eb26eb5bc82c1de3aa2d18))
- **Desktop:** Livewire 2026.11.4 with Hutch 0.29.0 and the electrobun shim 2.0.6 (T1793) ([#2281](https://github.com/kiwi-init/channels/pull/2281)) ([055384c](https://github.com/kiwi-init/channels/commit/055384c020950a277b2ab1256f033bb4a8e1d759))
- **smoke-eb:** sendMessage never types the text again after pressing Enter (T4900) ([#2283](https://github.com/kiwi-init/channels/pull/2283)) ([d9e6b86](https://github.com/kiwi-init/channels/commit/d9e6b862626f842ac842803d62094e8cd9beedbf))
- **App:** a task quiet past three times the quiet time is an item in the owner's Needs you (T4857) ([#2284](https://github.com/kiwi-init/channels/pull/2284)) ([61b28a2](https://github.com/kiwi-init/channels/commit/61b28a29fdb91bd4ae601403ef4532da6f1cc745))
- **Tests:** an approval holds when its PR is merged before it's linked, and after the target moves past recorded evidence (#3930 cases 13, 23, T5025) ([#2285](https://github.com/kiwi-init/channels/pull/2285)) ([187cf00](https://github.com/kiwi-init/channels/commit/187cf00c9679481cf08a6144e75a158d3dad7cdc))
- **Shots:** a page the loop is leaving starts no fetch, which ends #1850's WebKit page error (T1561) ([#2287](https://github.com/kiwi-init/channels/pull/2287)) ([d6a460b](https://github.com/kiwi-init/channels/commit/d6a460b7ea3a3c15f4cf277b0bdc0d5337056785))
- **Rail:** inside a channel, another channel's needs-you badge arrives and clears live (T2996) ([#2286](https://github.com/kiwi-init/channels/pull/2286)) ([dbd1e71](https://github.com/kiwi-init/channels/commit/dbd1e718bdc71eff8590e5c8ef914cc25f6e1413))
- **Rail:** switching channels keeps the other channels' followers, so they don't reconnect (T5147) ([#2289](https://github.com/kiwi-init/channels/pull/2289)) ([e501ac6](https://github.com/kiwi-init/channels/commit/e501ac698adf17b4a2d35b100ae4b6f5d1ff02f9))
- **App:** a channel with no base under its window opens on the whole log, and Specs and Now say when it's still reading (T5096, #2288) ([#2290](https://github.com/kiwi-init/channels/pull/2290)) ([7d89453](https://github.com/kiwi-init/channels/commit/7d8945349c3eccdcc4fcf455133a6ed812414ed3))

## 2026.11.17 — 2026-11-10

Tag [v2026.11.17](https://github.com/kiwi-init/channels/releases/tag/v2026.11.17) · commit [bce98fb](https://github.com/kiwi-init/channels/commit/bce98fb2c13f7dd60efcb47db0f63e80a8b85668) · 2026-11-10

### Other changes

- **release:** a ci-green gate refuses to build or publish unless the tagged commit's push run is green (T2017) ([#2245](https://github.com/kiwi-init/channels/pull/2245)) ([4126925](https://github.com/kiwi-init/channels/commit/412692556fb59c700af86e1e5ddff466bed6cb3c))
- /tasks opens the task list, not the spec you last had open (T1819) ([#2260](https://github.com/kiwi-init/channels/pull/2260)) ([057b708](https://github.com/kiwi-init/channels/commit/057b7081f9a2fa64e93d97ab23c44e7a2724a0fe))
- **Right panel:** it floats over the chat at every width, so the conversation never moves (T1839) ([#2258](https://github.com/kiwi-init/channels/pull/2258)) ([a2a32ad](https://github.com/kiwi-init/channels/commit/a2a32ad21d22bce206954a3a4a3c743021c94b5d))
- **Channel settings:** one icon control, a Tasks and pull requests group in words, and a reason on greyed settings (T3548) ([#2262](https://github.com/kiwi-init/channels/pull/2262)) ([c76d765](https://github.com/kiwi-init/channels/commit/c76d7654e0759f35833c312d139e0d7c22356c25))
- **Words:** one name per concept: Needs you, Activity, Join with a code, Channel notes, Work (T1821) ([#2254](https://github.com/kiwi-init/channels/pull/2254)) ([236f83d](https://github.com/kiwi-init/channels/commit/236f83d206949ecc87a914609678d4afba0b9637))
- **Home:** an ask row opens the ask; only plain questions keep their answer buttons (T1815) ([#2266](https://github.com/kiwi-init/channels/pull/2266)) ([e3a56a1](https://github.com/kiwi-init/channels/commit/e3a56a140820c79fc6b21054dadf8a0cd98a3500))
- Invite, Profile and Let in: the Full trust switch goes; with all three powers on, a line says the person is fully trusted and what that means (T5081) ([#2265](https://github.com/kiwi-init/channels/pull/2265)) ([957f352](https://github.com/kiwi-init/channels/commit/957f35291d68683ee2ef6bbbc54aa22af9212cdf))
- **Release check:** an older release's data opened by this build (harness) ([#2255](https://github.com/kiwi-init/channels/pull/2255)) ([037761d](https://github.com/kiwi-init/channels/commit/037761d21d0bc098778e190816c06bfcba794939))
- **CI:** desktop / distros runs after merge, behind the release gate (T2018) ([#2263](https://github.com/kiwi-init/channels/pull/2263)) ([d2d6e61](https://github.com/kiwi-init/channels/commit/d2d6e619856ec4e3d1ed49dabde0c302f7ba44ab))
- **Specs tab:** Done lists the finished tasks that aren't in a spec, newest first, twenty at a time (T5079) ([#2268](https://github.com/kiwi-init/channels/pull/2268)) ([34c6aec](https://github.com/kiwi-init/channels/commit/34c6aec86b9751100e22f6e41e68d95a72a71818))
- **Gate:** the ship gate, bypass and who-merges are gone; a task lands by its steps and kiwi/review answers green (T4164) ([#2259](https://github.com/kiwi-init/channels/pull/2259)) ([f7c5029](https://github.com/kiwi-init/channels/commit/f7c50293e9ecad57d67569c50ddb02cbe5bd779e))
- **Slash commands:** /tasks, /prs and /issues go, with the unused tasks tab id (T1819) ([#2264](https://github.com/kiwi-init/channels/pull/2264)) ([f058979](https://github.com/kiwi-init/channels/commit/f058979862c0149e1b8a888b3552f235e767788c))
- **Test helper:** the owner CLI takes a key that starts with a dash as the key (T5226) ([#2271](https://github.com/kiwi-init/channels/pull/2271)) ([9f03af8](https://github.com/kiwi-init/channels/commit/9f03af81d36568a46af3ca119c56f135f9d3af27))
- **Clock:** each task carries one clock in the log; a quiet task is due a wake, then the lead, then the owner (T4170) ([#2256](https://github.com/kiwi-init/channels/pull/2256)) ([b7fc579](https://github.com/kiwi-init/channels/commit/b7fc5791cd82e1fc44e7900f0487b9af0019ec0c))
- **Docs:** landing steps, whose move a task is, and no merge gate; kiwi/review's retirement note (T4174) ([#2273](https://github.com/kiwi-init/channels/pull/2273)) ([62e0377](https://github.com/kiwi-init/channels/commit/62e0377b3b345bf09327851993ffc6c4ff1c6336))
- README in Simplified Chinese, and a language line on both (T5302) ([#2276](https://github.com/kiwi-init/channels/pull/2276)) ([daf3733](https://github.com/kiwi-init/channels/commit/daf3733dd724697a7c1b6e664ba063e538d56475))
- **Docs:** self-hosting where Cloudflare is slow, in English and Chinese (T5304) ([#2274](https://github.com/kiwi-init/channels/pull/2274)) ([4e16f17](https://github.com/kiwi-init/channels/commit/4e16f1768d02a4e7a66d837f74e682c6a220d449))
- **Tall mode goes:** a portrait window is the same app (T1830) ([#2267](https://github.com/kiwi-init/channels/pull/2267)) ([452038f](https://github.com/kiwi-init/channels/commit/452038fcb980a75ca75a0320dba0a1a7812f02ff))
- **Rail:** on Home, a channel's needs-you count is Home's live one, and it stays on the tile after you leave Home (T5276) ([#2275](https://github.com/kiwi-init/channels/pull/2275)) ([d52bb5b](https://github.com/kiwi-init/channels/commit/d52bb5bd763aab10bd3f2a671f90aba7ef4082fe))
- **Replies:** a reply to a message sent to several is never dropped (T5088) ([#2269](https://github.com/kiwi-init/channels/pull/2269)) ([3bbc2e7](https://github.com/kiwi-init/channels/commit/3bbc2e7555c54aa5b1b9bf9d7ef561cd337e6e54))
- **Clock:** how long a task may stay quiet is a channel setting (T4457) ([#2277](https://github.com/kiwi-init/channels/pull/2277)) ([5ca1090](https://github.com/kiwi-init/channels/commit/5ca10900d295e2e8b6666d32eb6d22b6ac87aecb))
- **Linux:** Breeze Dark's taskbar and Alt+Tab show Channels' dark icon (T2997) ([#2272](https://github.com/kiwi-init/channels/pull/2272)) ([430e241](https://github.com/kiwi-init/channels/commit/430e24159f9ec8e33a7094f8e3c521ab84079387))

## 2026.11.16 — 2026-11-10

Tag [v2026.11.16](https://github.com/kiwi-init/channels/releases/tag/v2026.11.16) · commit [09330f0](https://github.com/kiwi-init/channels/commit/09330f079646a8acc5717bc6b2e3a5359f7e2153) · 2026-11-10

### Features

- **Perf:** the shell's parts read and render only what they show (T2445) ([#2165](https://github.com/kiwi-init/channels/pull/2165)) ([ef876d5](https://github.com/kiwi-init/channels/commit/ef876d567d274e5f7eb26ecdfed2a0fa3148b27e))

### Fixes

- **Sending:** a failed message survives a restart and sends itself on reconnect (T1755) ([#2133](https://github.com/kiwi-init/channels/pull/2133)) ([8e69ad0](https://github.com/kiwi-init/channels/commit/8e69ad0e56f34d10ebb438797d188c535b23ce05))
- **History:** a failed snapshot request is retried, and a partial base is never kept (T1759) ([#2134](https://github.com/kiwi-init/channels/pull/2134)) ([007e0cd](https://github.com/kiwi-init/channels/commit/007e0cdabc7ef835b7c4f1554c4345af08fc706a))
- **Crash screen:** a channel that crashes no longer traps the app (T1758) ([#2135](https://github.com/kiwi-init/channels/pull/2135)) ([995c4eb](https://github.com/kiwi-init/channels/commit/995c4eb4ea3b20b72cdce6f92f488f4843a68039))
- **Connection:** a live stream that dies is followed again (T1784) ([#2136](https://github.com/kiwi-init/channels/pull/2136)) ([46bf3ef](https://github.com/kiwi-init/channels/commit/46bf3efb145b5392c96308a1c1f7041ad2c46621))
- **Composer:** drafts and attached images survive a quit, an update or a crash (T1756) ([#2137](https://github.com/kiwi-init/channels/pull/2137)) ([bd3fa6f](https://github.com/kiwi-init/channels/commit/bd3fa6f11711898f52c5ceeef91dcad276fe28c5))
- **Desktop:** main-process fetches have a time limit, and a hung keys Worker is restarted (T1765) ([#2138](https://github.com/kiwi-init/channels/pull/2138)) ([f02b944](https://github.com/kiwi-init/channels/commit/f02b944a8cd9183f9d53116bcfabce46897c18cb))
- **Desktop start:** a failure says why in a message box and main.log before quitting (T1763) ([#2139](https://github.com/kiwi-init/channels/pull/2139)) ([c4e89d6](https://github.com/kiwi-init/channels/commit/c4e89d6cc70fd5d9c4149191420a30e0745b79f3))
- **CLI install:** a kiwi too slow to say its version is never replaced (T1767) ([#2141](https://github.com/kiwi-init/channels/pull/2141)) ([b2a764f](https://github.com/kiwi-init/channels/commit/b2a764f60f530202877854833900dc2bfc053b05))
- **Mac start:** waiting on the launcher's keychain answer no longer blocks the main thread (T1762) ([#2140](https://github.com/kiwi-init/channels/pull/2140)) ([dac4075](https://github.com/kiwi-init/channels/commit/dac40757b43a8d99d03aa99f95a8308d08c8a055))
- **Desktop start:** the window always shows, with the built-in UI when the engine has none (T1764) ([#2144](https://github.com/kiwi-init/channels/pull/2144)) ([226aa17](https://github.com/kiwi-init/channels/commit/226aa1766dfa2c7c7b3bbbb8cf1f6549321bb1c3))
- **Disk:** main.log and daemon.log stay under 1 MB, and cut-short index saves are cleared (T1780) ([#2146](https://github.com/kiwi-init/channels/pull/2146)) ([a8e77d1](https://github.com/kiwi-init/channels/commit/a8e77d18658a5bb553119f5cc592b0ac0e48af98))
- **Updater:** no swap under a reopened app, downloads survive a crash, an old daemon is not taken for the new one (T1770) ([#2145](https://github.com/kiwi-init/channels/pull/2145)) ([01d1243](https://github.com/kiwi-init/channels/commit/01d124326f16250a7e3ab642a7531e8f80c0eb6c))
- A 200 that didn't come from the relay is the relay being away, never an answer (T2138) ([#2148](https://github.com/kiwi-init/channels/pull/2148)) ([47d377f](https://github.com/kiwi-init/channels/commit/47d377fcd1b46759e689d1fa8b64223f58a55bf2))
- **Store:** an unreadable store gets its own page instead of first-run (T1772) ([#2152](https://github.com/kiwi-init/channels/pull/2152)) ([2d3e659](https://github.com/kiwi-init/channels/commit/2d3e6595eb8c1057d8aeab97bc614d967394bf77))
- **Store:** a failed save changes nothing in memory, and each save keeps the generation before it (T1777) ([#2150](https://github.com/kiwi-init/channels/pull/2150)) ([7a5d4d4](https://github.com/kiwi-init/channels/commit/7a5d4d4ef1e3c4539ba89057fcda2024c5589696))
- **Sending:** one id per message, so a retry can't deliver it twice (T1760) ([#2143](https://github.com/kiwi-init/channels/pull/2143)) ([577b373](https://github.com/kiwi-init/channels/commit/577b373d9388e1ed2152bba1476d709b6dac7c3c))
- **Focus:** one kiwi CLI call per focus, and none within 10 s of the last (T1782) ([#2160](https://github.com/kiwi-init/channels/pull/2160)) ([298a142](https://github.com/kiwi-init/channels/commit/298a1428c2ada38a31549bc8428ca228c6ad0ddc))
- **Keys:** ⌘ on a Mac and Ctrl elsewhere, ⌥ arrows stay in text fields, ⌘F stays behind a dialog (T1852) ([#2176](https://github.com/kiwi-init/channels/pull/2176)) ([8729bf8](https://github.com/kiwi-init/channels/commit/8729bf8abd27530accbfeac232ca0531ccc087c1))
- Security outcomes stay on screen until dismissed (T1866) ([#2179](https://github.com/kiwi-init/channels/pull/2179)) ([bfdeea0](https://github.com/kiwi-init/channels/commit/bfdeea07a706cc791966a59f0820f2a065f13406))
- **Editors:** Esc asks before it throws unsaved edits away (T1865) ([#2180](https://github.com/kiwi-init/channels/pull/2180)) ([0fabfd9](https://github.com/kiwi-init/channels/commit/0fabfd90dcd2de2b8d0fc77f6edcf1336730a8e8))
- **New device:** Review reopens the approval dialog, and a confirm that fails says so (T1857) ([#2172](https://github.com/kiwi-init/channels/pull/2172)) ([7c8b313](https://github.com/kiwi-init/channels/commit/7c8b3135a44ce5b261b81fe83b94739979ac3bd6))
- **Attach:** a file dropped anywhere on a conversation lands in its composer, and the hint says what it takes (T1874) ([#2181](https://github.com/kiwi-init/channels/pull/2181)) ([f313c8b](https://github.com/kiwi-init/channels/commit/f313c8bc89266cef24b505f266f1a59838c7b0b2))
- **Hints:** a shortcut hint names Ctrl on Linux and Windows, ⌘ only on a Mac (T1853) ([#2177](https://github.com/kiwi-init/channels/pull/2177)) ([b244982](https://github.com/kiwi-init/channels/commit/b24498288857e6cf24eb5e078c1a12d897522495))
- Update and sign-in cards show beside the rail when the sidebar is hidden or on Home (T1843) ([#2174](https://github.com/kiwi-init/channels/pull/2174)) ([28f0c00](https://github.com/kiwi-init/channels/commit/28f0c001b44e6bba8bb278128b300adc589d18e6))
- Failures are said where the action started, in plain words, raw text behind Details (T1880) ([#2186](https://github.com/kiwi-init/channels/pull/2186)) ([75f05e7](https://github.com/kiwi-init/channels/commit/75f05e7b5139bcca1ea8b8ded08066ad52fc1041))
- **Loading:** the sign-in check and a fetching thread say so, and a thread that didn't load offers Try again (T1879) ([#2188](https://github.com/kiwi-init/channels/pull/2188)) ([6d28576](https://github.com/kiwi-init/channels/commit/6d28576a4c51010757426207b7164e1b75447e32))
- **Test:** engine-push matches each PUT /push by its room, not by arrival order (T3376) ([#2199](https://github.com/kiwi-init/channels/pull/2199)) ([b5841c4](https://github.com/kiwi-init/channels/commit/b5841c4399de8723593f85200cc233a9409b9d05))
- **Spec rail:** a growing comment box stays on screen with its Comment button (T3109) ([#2200](https://github.com/kiwi-init/channels/pull/2200)) ([12cd7b8](https://github.com/kiwi-init/channels/commit/12cd7b82e002dd66dedca596843e8419f3736401))

### Other changes

- **Tasks:** a PR links to a task by its branch only if it came after the task (#2003) ([#2006](https://github.com/kiwi-init/channels/pull/2006)) ([09a3793](https://github.com/kiwi-init/channels/commit/09a379369e78adc4a16d2bffd61ae40bc5b7d9fd))
- **Paid plan:** unlimited for $10, with a 100,000 a day fair-use cap (T666) ([#2005](https://github.com/kiwi-init/channels/pull/2005)) ([3a6992a](https://github.com/kiwi-init/channels/commit/3a6992a0b2971dd82501fddc8e939d584640d45d))
- **Shots:** a page error lists the reaction requests, navigations and server answers that led up to it (#1850) ([#2007](https://github.com/kiwi-init/channels/pull/2007)) ([ffb68e8](https://github.com/kiwi-init/channels/commit/ffb68e8245a74135b3e3a19684a7a38f5bd099ef))
- **Run tasks:** only a run that started after its task was created counts for the task's run name, kept or forgotten alike (T2183) ([#2010](https://github.com/kiwi-init/channels/pull/2010)) ([16829aa](https://github.com/kiwi-init/channels/commit/16829aa0fdcd3fa00a4765855717946df4cbb2d7))
- **CI:** ci-ok rejects an empty or non-boolean job selection (T1948) ([#2011](https://github.com/kiwi-init/channels/pull/2011)) ([cffddaa](https://github.com/kiwi-init/channels/commit/cffddaa54cca31921ff9cd460e5f5731aeecd9cc))
- **iPhone:** a String Catalog and a Language option (T780) ([#2016](https://github.com/kiwi-init/channels/pull/2016)) ([4619bab](https://github.com/kiwi-init/channels/commit/4619bab3e78cabd84d2e03de0e2c4bbd21fe68f8))
- **ui:** localization setup: t(), lazy catalogs, a Language picker (T774, #759) ([#2009](https://github.com/kiwi-init/channels/pull/2009)) ([6c82cc9](https://github.com/kiwi-init/channels/commit/6c82cc9e28f996bcef1846be77c710f08e9ec3c1))
- **Android:** words in strings.xml and a Language setting (T781) ([#2012](https://github.com/kiwi-init/channels/pull/2012)) ([c7f7bea](https://github.com/kiwi-init/channels/commit/c7f7bea63421896b16d67837ec116ce71f1929ce))
- **i18n:** live/ and settings/ words move into en, Settings' English loads with its chunk (T844) ([#2022](https://github.com/kiwi-init/channels/pull/2022)) ([983f388](https://github.com/kiwi-init/channels/commit/983f38895b760fcd44cf47bbc4895891b9fda3f6))
- **i18n:** chat/, specs/ and tasks/ in five languages (T843, #759) ([#2019](https://github.com/kiwi-init/channels/pull/2019)) ([3b44886](https://github.com/kiwi-init/channels/commit/3b44886c87a5f40f8c284fde28ad51b16ca74417))
- **CI:** the dispatch concurrency comment says what the group really carries (T1950) ([#2017](https://github.com/kiwi-init/channels/pull/2017)) ([38e7be2](https://github.com/kiwi-init/channels/commit/38e7be24e3e31c8bf59aa625a44d4e98815100e8))
- **Spec comments:** actions, reactions, retry, and Escape closes suggestions (T2680) ([#2021](https://github.com/kiwi-init/channels/pull/2021)) ([ce06aeb](https://github.com/kiwi-init/channels/commit/ce06aebc78b280b9c8e6e5f6c526976afcb26621))
- **Website:** the landing in five languages, docs in English for now (T782) ([#2023](https://github.com/kiwi-init/channels/pull/2023)) ([bc654bf](https://github.com/kiwi-init/channels/commit/bc654bf43c1a3b7622d400aa9dbca8b3139ada6a))
- **i18n:** shell, start, palette, modals, needs, panels, github and kit in five languages (T845, #759) ([#2024](https://github.com/kiwi-init/channels/pull/2024)) ([c7c1886](https://github.com/kiwi-init/channels/commit/c7c1886e02c292f04b2b6a3be5d05bd155fd1bc4))
- **i18n:** the iPhone and Android apps in Portuguese, Japanese, Korean and Chinese (T1157) ([#2031](https://github.com/kiwi-init/channels/pull/2031)) ([0e39fe2](https://github.com/kiwi-init/channels/commit/0e39fe27f5e68a43a776b98d43bd489de64d955b))
- **i18n:** live/ and settings/ in Portuguese, Japanese, Korean and Chinese (T1159) ([#2026](https://github.com/kiwi-init/channels/pull/2026)) ([f68dced](https://github.com/kiwi-init/channels/commit/f68dced01e28edaf973b4166d1aa881b313bd6a1))
- **Tasks:** an approve before the merge opens the ship gate when no review round was asked (#2020) ([#2033](https://github.com/kiwi-init/channels/pull/2033)) ([d5057cc](https://github.com/kiwi-init/channels/commit/d5057ccaa1cdf98e622b2f3d55caf0e7a0515e1a))
- **Docs:** every page in Portuguese, Japanese, Korean and Chinese (T1158, #759) ([#2034](https://github.com/kiwi-init/channels/pull/2034)) ([bf81803](https://github.com/kiwi-init/channels/commit/bf818038ffd96f702b27510276a410f911d12173))
- **desktop:** eb-env-check logs the app's group at SIGTERM and the survivors' lines (T2999) ([#2029](https://github.com/kiwi-init/channels/pull/2029)) ([bfa913e](https://github.com/kiwi-init/channels/commit/bfa913ebd14fb0cb14e76898c4499b27ff16c092))
- **iPhone:** updates leave the feed for an icon in the top bar (T985, #963) ([#2035](https://github.com/kiwi-init/channels/pull/2035)) ([0249f6b](https://github.com/kiwi-init/channels/commit/0249f6be8c6087d0dd25bd31e5d0a375e71b1aaa))
- **iPhone:** a cold launch fetches only what's new (T1028, #975) ([#2039](https://github.com/kiwi-init/channels/pull/2039)) ([659e4d5](https://github.com/kiwi-init/channels/commit/659e4d5fee20a1fe47a3440e313183bea3a52329))
- **iPhone:** the Channels list is just channels, rooms and tasks: no big title, no lead bar, no lead row (T1006) ([#2036](https://github.com/kiwi-init/channels/pull/2036)) ([137dc51](https://github.com/kiwi-init/channels/commit/137dc5119acf414f28b56515f3ca0dcc0d80c1d4))
- **i18n:** the last hard-coded English, an empty allowlist, and full catalogs (T1351, #759) ([#2040](https://github.com/kiwi-init/channels/pull/2040)) ([99cf82e](https://github.com/kiwi-init/channels/commit/99cf82e7bb56ed29d980714bdf4970c80c523e87))
- **CI:** trial shards for shots (by engine) and bundles (app + two ui legs) (T2094) ([#2038](https://github.com/kiwi-init/channels/pull/2038)) ([98fb654](https://github.com/kiwi-init/channels/commit/98fb654c2319cbff4f39dd81a67cdf4ced8fc21b))
- **Payments:** the upgrade link charges Brazilian cards in reais ([#2042](https://github.com/kiwi-init/channels/pull/2042)) ([783f2f3](https://github.com/kiwi-init/channels/commit/783f2f3e251a70976af6b8d7bdbd16d0d52ff1b7))
- **kiwi/review:** one check per channel; a PR no task claims passes it, and a PR claimed after that follows its task's gate (T2681) ([#2014](https://github.com/kiwi-init/channels/pull/2014)) ([065d601](https://github.com/kiwi-init/channels/commit/065d6013a29f5167e35f9a520ccdee6361ca45ae))
- **iPhone tests:** DemoTests runs with the lock off, LanguageTests taps again (#2037) ([#2043](https://github.com/kiwi-init/channels/pull/2043)) ([7dd3552](https://github.com/kiwi-init/channels/commit/7dd35525a1012ab7301a67f7f589c06f54c3a34a))
- **Tasks:** a pre-ship check added, replaced or closed after approval sends the task back to review (T3347) ([#2120](https://github.com/kiwi-init/channels/pull/2120)) ([8da5958](https://github.com/kiwi-init/channels/commit/8da59587d852a7976cbd82abe45fb4d7f64123b5))
- **Billing:** a retrying card stays paid, late Stripe events change nothing, phones hide the purchase link (#2124) ([#2127](https://github.com/kiwi-init/channels/pull/2127)) ([5557727](https://github.com/kiwi-init/channels/commit/5557727c4077e6217b8425f6d8ee139da3f22875))
- **Payments:** paid people get a Manage button to the Stripe customer portal (#2122) ([#2126](https://github.com/kiwi-init/channels/pull/2126)) ([2f2087d](https://github.com/kiwi-init/channels/commit/2f2087d462ba059c713404f805837b1be150cff0))
- **Tests:** the rest of spec #623's acceptance cases (T3348, #2125) ([#2128](https://github.com/kiwi-init/channels/pull/2128)) ([af980f1](https://github.com/kiwi-init/channels/commit/af980f104998a061150d7d055b6489fb97739dbf))
- **Rooms:** a person's message in an open room reaches the lead (T3255, #2030) ([#2129](https://github.com/kiwi-init/channels/pull/2129)) ([f62e8a8](https://github.com/kiwi-init/channels/commit/f62e8a8f9b30dbbf49d590763043df4482f08a25))
- **i18n:** agent status, task stages, receipts, decision labels and event lines in five languages (#2041) ([#2130](https://github.com/kiwi-init/channels/pull/2130)) ([17f3faf](https://github.com/kiwi-init/channels/commit/17f3faf1c1b833c21cc973aee310a068fc26ef38))
- **ui:** the first load drops 70 KB by not loading effect (801 → 731 KB) ([#2132](https://github.com/kiwi-init/channels/pull/2132)) ([8ea7709](https://github.com/kiwi-init/channels/commit/8ea7709949d5be1b9d3be22e01e1fe52272d8607))
- **iPhone:** the feed never goes blank while you type in a short channel (T984) ([#2121](https://github.com/kiwi-init/channels/pull/2121)) ([88178cc](https://github.com/kiwi-init/channels/commit/88178ccfa9ebe2554d8bcbc28261e89b038d81fa))
- **Perf:** the open channel is folded when something changed, not every 15 s (T1787) ([#2149](https://github.com/kiwi-init/channels/pull/2149)) ([3068220](https://github.com/kiwi-init/channels/commit/30682207eb5c6148013f3cda4613711e9557636c))
- **Start-failure check:** wait for the box's own windows and keep pressing OK (T1763 follow-up) ([#2151](https://github.com/kiwi-init/channels/pull/2151)) ([00c2ab7](https://github.com/kiwi-init/channels/commit/00c2ab760647ffa4ddd5fea17a997aa1ca65b59e))
- **Perf harness:** perf-scale runs again, and a view that fails says what the page shows (T2227) ([#2154](https://github.com/kiwi-init/channels/pull/2154)) ([df7c716](https://github.com/kiwi-init/channels/commit/df7c7169ffcd68d03de66a97f71c3cbcaa169002))
- **Keyring note:** the tokens DESIGN.md has, in one page shell with the unreadable-store page (T2276) ([#2155](https://github.com/kiwi-init/channels/pull/2155)) ([d0f742a](https://github.com/kiwi-init/channels/commit/d0f742aa6b0b902c65781b03ec8312d40baf6386))
- **Perf:** a channel switch mounts no throwaway Home and folds nothing for a warm channel (T1788) ([#2157](https://github.com/kiwi-init/channels/pull/2157)) ([70754c4](https://github.com/kiwi-init/channels/commit/70754c4ca595b7f6607ee2d1dfbbba4cd4fd91bb))
- **Thread doc:** a hidden block mounts no head or foot; the soak names what grows (T2309) ([#2158](https://github.com/kiwi-init/channels/pull/2158)) ([eeb946a](https://github.com/kiwi-init/channels/commit/eeb946ace1046f464edcca80ff9672ff4e29f8b5))
- **Perf:** the known channels list keeps its identity until a channel changes (T1786, step 1) ([#2161](https://github.com/kiwi-init/channels/pull/2161)) ([cfb7a4b](https://github.com/kiwi-init/channels/commit/cfb7a4b722add33a78178068ace32b70e852eb9c))
- **Perf:** a message row's GIF tool no longer reads the app context (T2444) ([#2162](https://github.com/kiwi-init/channels/pull/2162)) ([636ca87](https://github.com/kiwi-init/channels/commit/636ca8791be702bccc5585d6c44f048033c47f90))
- **Images:** one feed recompute per picture load, where there were two (T1795) ([#2163](https://github.com/kiwi-init/channels/pull/2163)) ([88df500](https://github.com/kiwi-init/channels/commit/88df5000c877b5c14d128dbb82aa2b27b7ced8d8))
- **perf-desktop runs again:** the first-message mark is back, an idle memory reading, a by-hand job in perf.yml (T2428) ([#2168](https://github.com/kiwi-init/channels/pull/2168)) ([88d75ca](https://github.com/kiwi-init/channels/commit/88d75ca8117660d4b6644df036438c4a5965cdd3))
- **Thread doc:** a block already in the feed is one bare node (T2408) ([#2166](https://github.com/kiwi-init/channels/pull/2166)) ([5134a38](https://github.com/kiwi-init/channels/commit/5134a389181b544e1f79536b4136c0faffc32df1))
- **Startup marks:** when the navigation rules are set and when the canary is refused (T2605) ([#2170](https://github.com/kiwi-init/channels/pull/2170)) ([3acf105](https://github.com/kiwi-init/channels/commit/3acf105f7efdd9c368f41d091200ac3892d294ec))
- Startup marks go to main.log, one line a launch, readable from a release build (T2678) ([#2171](https://github.com/kiwi-init/channels/pull/2171)) ([3fc3640](https://github.com/kiwi-init/channels/commit/3fc3640f3e92ced7d600533cd5c03db68f54ec87))
- **perf:** the CPU calibration styles its own rows, and reads what it read on web/ (T2775) ([#2182](https://github.com/kiwi-init/channels/pull/2182)) ([9ae58b0](https://github.com/kiwi-init/channels/commit/9ae58b0f5064fa6a72ce73f362269d0a82a7648b))
- **perf-scale:** a reload's first screen is the conversation's first message, with the marks behind it (T2776) ([#2184](https://github.com/kiwi-init/channels/pull/2184)) ([1b5d4bc](https://github.com/kiwi-init/channels/commit/1b5d4bc1707eeeef7540a7eb34cb80b6649cb2f7))
- **Confirms:** one Confirm, focus on Cancel, for every confirm that had its own modal (T1859) ([#2173](https://github.com/kiwi-init/channels/pull/2173)) ([f4d1f76](https://github.com/kiwi-init/channels/commit/f4d1f7667446e98f42dd5fd6b2daf251a777356b))
- **Menus:** Settings, New Channel, Find, Toggle Sidebar, a Go menu and Help, each running what its key runs (T1851) ([#2178](https://github.com/kiwi-init/channels/pull/2178)) ([12828d7](https://github.com/kiwi-init/channels/commit/12828d7e3c160d2d3fb464e7da4c5cdaa853ecbb))
- **Confirms:** Drop it, an early Accept, Unlink GitHub, remove a repo and a relay change ask first (T1859) ([#2185](https://github.com/kiwi-init/channels/pull/2185)) ([0909972](https://github.com/kiwi-init/channels/commit/09099722beff09e628b3f4fef8b8edd9fe98b3e7))
- **Esc discard prompt:** focus Keep editing, so Enter never discards (T3114) ([#2187](https://github.com/kiwi-init/channels/pull/2187)) ([2582aa7](https://github.com/kiwi-init/channels/commit/2582aa71bb5827b41f2dfbb2912d70eb09c00105))
- **Dialogs:** the annotator's discard prompt and the note-clear prompt focus the safe button (T1847) ([#2189](https://github.com/kiwi-init/channels/pull/2189)) ([ec62720](https://github.com/kiwi-init/channels/commit/ec6272041daecf6ab510c63b89a4fbc2dae71b4b))
- **GitHub tab:** the no-app state links the published guide instead of naming a repo path (T1878) ([#2192](https://github.com/kiwi-init/channels/pull/2192)) ([18b0a3e](https://github.com/kiwi-init/channels/commit/18b0a3e13452b6aa4ddc63590b39df625b44bcf6))
- **Perf:** one cached time formatter; the search index reuses counted words (T1812) ([#2191](https://github.com/kiwi-init/channels/pull/2191)) ([850d364](https://github.com/kiwi-init/channels/commit/850d364d53c06d7ab9529eacfad50a4bb8bb5ec5))
- **Doc stillness:** a wheel scroll in flight finishes, with no correction write and room under it (T3077) ([#2131](https://github.com/kiwi-init/channels/pull/2131)) ([6891ecb](https://github.com/kiwi-init/channels/commit/6891ecb860dba262db0b37a329f925a997d49ac0))
- **Cleanup:** Home fields nothing reads, an unreachable thread-open branch, an unused folder helper; DESIGN.md says what the right panel holds (T1855) ([#2193](https://github.com/kiwi-init/channels/pull/2193)) ([3058a8a](https://github.com/kiwi-init/channels/commit/3058a8aeaaba4dc6b450d97bc7d8753a1beaafd5))
- **History:** Home, Settings sections and the open spec are places back and forward return to (T1848) ([#2195](https://github.com/kiwi-init/channels/pull/2195)) ([c978742](https://github.com/kiwi-init/channels/commit/c978742cd7b73855a03801783ef9011703ec4945))
- **Menus:** the rail's menus are the kit context menu, with the same items (T1826) ([#2198](https://github.com/kiwi-init/channels/pull/2198)) ([9e3eda2](https://github.com/kiwi-init/channels/commit/9e3eda21b263195a73dcaa7b1470b1c26e7e3933))
- **Task links:** every link to a task toggles its panel, as a board row does (T1849) ([#2197](https://github.com/kiwi-init/channels/pull/2197)) ([71f049e](https://github.com/kiwi-init/channels/commit/71f049eb6e06dad4cfce2c00cf2c6fd3a117b3e8))
- **Settings › Account:** the second key reads Device sign-in key, and Sign out asks Sign out? (T1870) ([#2201](https://github.com/kiwi-init/channels/pull/2201)) ([e996710](https://github.com/kiwi-init/channels/commit/e9967106c2700ed8dadeda9bc00a7fa3351fc48b))
- **Settings › Agents:** a preset personality says Customize, not Copy (T1872) ([#2202](https://github.com/kiwi-init/channels/pull/2202)) ([c9b4e73](https://github.com/kiwi-init/channels/commit/c9b4e7322f495c3c84c21329682591697818d981))
- **Dialogs:** one outside-click rule, Cancel quiet and on the left, a Cancel on New room and Join, Cmd/Ctrl+Enter posts a spec (T3222) ([#2196](https://github.com/kiwi-init/channels/pull/2196)) ([62a9149](https://github.com/kiwi-init/channels/commit/62a914947fb7d9ba0e010e7495f07e155379eb87))
- Settings › Computers and phones: the paired list is named by its heading, not left outside an empty region (T1871) ([#2203](https://github.com/kiwi-init/channels/pull/2203)) ([ecb12f1](https://github.com/kiwi-init/channels/commit/ecb12f18882c6dcf4a81b2a86e8ebd18ad94141c))
- **Rail menu:** a channel's menu offers Channel settings (T3457) ([#2206](https://github.com/kiwi-init/channels/pull/2206)) ([d58d8d1](https://github.com/kiwi-init/channels/commit/d58d8d10cadfbb07d35399d87749c48718f210d7))
- **Channel settings:** the pause note saves with Cancel and Save, like the Goal; the Goal's toast goes (T1873) ([#2205](https://github.com/kiwi-init/channels/pull/2205)) ([2b0ad75](https://github.com/kiwi-init/channels/commit/2b0ad759e87694588736362b046dc3127326156a))
- **Task panel:** the body renders as markdown, and a cut title shows whole instead of twice (T3529) ([#2208](https://github.com/kiwi-init/channels/pull/2208)) ([5e538b8](https://github.com/kiwi-init/channels/commit/5e538b8411910901b5371ea589b7bd5e988dda87))
- **Rail menu:** Invite people and Leave or Delete on every channel you are in, once the app knows if you own it (T3486) ([#2207](https://github.com/kiwi-init/channels/pull/2207)) ([c40f2f1](https://github.com/kiwi-init/channels/commit/c40f2f1efe0e8288eb2174289952eab4420d9746))
- **Rail menu:** Mark as read for a whole channel, a floor under every place's read mark (T3487) ([#2209](https://github.com/kiwi-init/channels/pull/2209)) ([88d358d](https://github.com/kiwi-init/channels/commit/88d358d50981ffc8696d4836242e3730c2e18448))
- **Specs:** message links work, and a spec's comments have one home (T1877) ([#2210](https://github.com/kiwi-init/channels/pull/2210)) ([0c69c75](https://github.com/kiwi-init/channels/commit/0c69c75de7f55308f03f519020008aa5cc347fe8))
- **History:** the newest rows come out in one read, not a cursor step per row (T3576) ([#2211](https://github.com/kiwi-init/channels/pull/2211)) ([30aba9b](https://github.com/kiwi-init/channels/commit/30aba9be17685d75f362fbbcab1071f5586bd214))
- **Older-search check:** click only once the list is for the new query, read the bar once its stretch is loaded (T3467) ([#2212](https://github.com/kiwi-init/channels/pull/2212)) ([3cb6a03](https://github.com/kiwi-init/channels/commit/3cb6a035a4ec063dbbd11e259691126eb7829910))
- **Sign-in:** Cancel on the GitHub code screen, and a failed new channel says why (T1867) ([#2213](https://github.com/kiwi-init/channels/pull/2213)) ([463a8a2](https://github.com/kiwi-init/channels/commit/463a8a205b0c5bd4e76ac64debce0f66d0b8767e))
- **Specs:** closing a spec is Cancel in its menu and on its Result tab, with one confirm: Keep it or Cancel spec (T1860) ([#2214](https://github.com/kiwi-init/channels/pull/2214)) ([d260fad](https://github.com/kiwi-init/channels/commit/d260fad3d0c27f76f2cf6e7159c702e620fe37a9))
- **CI:** a dispatch that names no jobs picks them from a coverage table (T1951) ([#2190](https://github.com/kiwi-init/channels/pull/2190)) ([a56327b](https://github.com/kiwi-init/channels/commit/a56327b828d6cc87d68cf3f9766175dca3185b4d))
- **Cache:** a row remembers inside its seal that its signature was checked, and a reopen skips the check (T3576) ([#2219](https://github.com/kiwi-init/channels/pull/2219)) ([0c46996](https://github.com/kiwi-init/channels/commit/0c46996b1af3cff957cc251d1299033bc420550b))
- **Search:** the list keeps its rows while a new query waits for older results (T3562) ([#2217](https://github.com/kiwi-init/channels/pull/2217)) ([81ff5e2](https://github.com/kiwi-init/channels/commit/81ff5e27d63393ba64292ca67673fa8431b8e7c2))
- **Sidebar:** other members' direct messages get their own section and heading (T1886) ([#2215](https://github.com/kiwi-init/channels/pull/2215)) ([72906db](https://github.com/kiwi-init/channels/commit/72906db7be7d212f54cc6fd8e976640067de40fc))
- **Images:** a click opens the image to look at, Annotate shows the tools, and every image opens the same viewer (T1876) ([#2216](https://github.com/kiwi-init/channels/pull/2216)) ([026ce9e](https://github.com/kiwi-init/channels/commit/026ce9e5a3e455406224e12fec743ce404a13f01))
- **Channel name:** its chevron opens a real menu, the rail's channel items (T1845) ([#2221](https://github.com/kiwi-init/channels/pull/2221)) ([9dbe6b3](https://github.com/kiwi-init/channels/commit/9dbe6b39944bdff20f0af4eae56682f2c83b7997))
- **People:** a click on a person opens the direct conversation with them, everywhere (T1844) ([#2220](https://github.com/kiwi-init/channels/pull/2220)) ([fec62a5](https://github.com/kiwi-init/channels/commit/fec62a56ec0cd3c9e206d33e065a329af7e46394))
- **Join:** the dialog says which name you'll ask with instead of asking for it again (T3700) ([#2223](https://github.com/kiwi-init/channels/pull/2223)) ([f7b7c09](https://github.com/kiwi-init/channels/commit/f7b7c09d0e4bc564293c74e371807c44e26e401d))
- **Mentions:** an @mention posted on a task counts before you open it (T3256) ([#2222](https://github.com/kiwi-init/channels/pull/2222)) ([4f262d7](https://github.com/kiwi-init/channels/commit/4f262d71c2ff07bf8277c8be2ef270b7d8f6f1a2))
- **Signed out:** the sign-in screen says to sign in to continue, not that sign-in is new (T1869) ([#2224](https://github.com/kiwi-init/channels/pull/2224)) ([5dacb7b](https://github.com/kiwi-init/channels/commit/5dacb7b8a0c2e66c21a5188d227f34f46924acd1))
- **perf:** a harness for what a thread doc's updates cost, by thread length (T1792) ([#2225](https://github.com/kiwi-init/channels/pull/2225)) ([a6f2c1e](https://github.com/kiwi-init/channels/commit/a6f2c1e18e02fd5bec01a8ce7b82b6bcf17b0608))
- **Composer:** # lists tasks and specs, and a spec's number opens the spec (T1875) ([#2227](https://github.com/kiwi-init/channels/pull/2227)) ([fd0ef99](https://github.com/kiwi-init/channels/commit/fd0ef9994c252988a3725bc6a67e5fec60037155))
- **Editing:** a message is edited in a box in its own row everywhere (T1864) ([#2226](https://github.com/kiwi-init/channels/pull/2226)) ([c3d2334](https://github.com/kiwi-init/channels/commit/c3d233408f1f08c295cc68c7687b1a3a26e42d28))
- **Rooms:** one Hide, which comes back only on a mention; Keep hidden goes (T1846) ([#2229](https://github.com/kiwi-init/channels/pull/2229)) ([386ceaa](https://github.com/kiwi-init/channels/commit/386ceaa88bcd7a0df3c485d336919be85dacd737))
- Enter sends, Shift+Enter is a new line: the hidden preference for ⌘Enter goes (T1829) ([#2230](https://github.com/kiwi-init/channels/pull/2230)) ([5786088](https://github.com/kiwi-init/channels/commit/578608894054fa97a42db50c16e850fd13b18771))
- **Second device:** the key check names the Settings line to compare with (T1868) ([#2231](https://github.com/kiwi-init/channels/pull/2231)) ([2f96b19](https://github.com/kiwi-init/channels/commit/2f96b195cf1c6e89ff8ad6d53dfe5fe0f8a899e1))
- **perf:** the soak says which files' allocations are still held, and the doc harness times a reopen (T3988) ([#2232](https://github.com/kiwi-init/channels/pull/2232)) ([32bebd4](https://github.com/kiwi-init/channels/commit/32bebd426502f026355eb908a54c9f79abb6d2b5))
- **Spec-comments check:** on a narrow page, show every comment only once the narrow layout is in (T3516) ([#2234](https://github.com/kiwi-init/channels/pull/2234)) ([83af3d8](https://github.com/kiwi-init/channels/commit/83af3d80717237ca2268e0b949e9606d80b613c0))
- **Threads in rooms:** Reply in thread and an N replies line open the thread panel (T1863) ([#2235](https://github.com/kiwi-init/channels/pull/2235)) ([bfa78c5](https://github.com/kiwi-init/channels/commit/bfa78c56f41067108ddee77d48fe4860086d4a90))
- **Second device:** It doesn't match gets its own screen, and the first GitHub screen offers the other-computer path (T1868) ([#2233](https://github.com/kiwi-init/channels/pull/2233)) ([2a36c54](https://github.com/kiwi-init/channels/commit/2a36c5442ee67bbfe5333998c0066a57e9ff16b5))
- **Spec page:** a narrow window draws one column from the first frame, so the comments check finds its comment in WebKit (T3803) ([#2228](https://github.com/kiwi-init/channels/pull/2228)) ([8177ad9](https://github.com/kiwi-init/channels/commit/8177ad95311d59463d21bc25c543c87d0d26ef8b))
- **Jump to:** Actions lists places only: Home, Needs you and Search in, themes and Toggle sidebar out (T1824) ([#2238](https://github.com/kiwi-init/channels/pull/2238)) ([839b028](https://github.com/kiwi-init/channels/commit/839b02821b36ad312d80cdc7b21169838e00da7f))
- **Tasks:** a refused task done names the way past an absent reviewer, and task edit takes --review (T3260) ([#2240](https://github.com/kiwi-init/channels/pull/2240)) ([a184264](https://github.com/kiwi-init/channels/commit/a1842640345f79813b3c32e310dcddc24370db34))
- **livewire-bump:** a Livewire release that pairs a different Hutch never merges itself (T1793) ([#2218](https://github.com/kiwi-init/channels/pull/2218)) ([2380794](https://github.com/kiwi-init/channels/commit/238079415f47449954e724204e8ca14cbd6c7d95))
- **CI:** the jobs help text says the picker narrows an empty input; the stamp contract case carries a diff (T1952) ([#2242](https://github.com/kiwi-init/channels/pull/2242)) ([2dcaf6a](https://github.com/kiwi-init/channels/commit/2dcaf6a3cfa8395a95d237b60806e567c28c778e))
- **First run:** the intro shows nothing until its scene is ready (T4351) ([#2239](https://github.com/kiwi-init/channels/pull/2239)) ([d6eed0e](https://github.com/kiwi-init/channels/commit/d6eed0ecc2a1fc1528553e5ca7308258a4364bc4))
- **Messages:** a body no longer re-renders on every arriving message (T4227) ([#2236](https://github.com/kiwi-init/channels/pull/2236)) ([b4b1da8](https://github.com/kiwi-init/channels/commit/b4b1da82079e0519e3b1efc2207a2b81ab2955f3))
- **First run:** the typed pledge goes; the second screen's Continue starts the app (T1858) ([#2241](https://github.com/kiwi-init/channels/pull/2241)) ([490140f](https://github.com/kiwi-init/channels/commit/490140fa3c4204e4e8b44311313a780077e463c3))
- **Tabs:** a channel always opens on its chat, in the room you left (T1833) ([#2244](https://github.com/kiwi-init/channels/pull/2244)) ([3eec7fe](https://github.com/kiwi-init/channels/commit/3eec7feada949a29ab73d3e341a5c98820cbfd20))
- **Approval:** a same-tree head or a clean merge of the target keeps it, on recorded evidence (T4166) ([#2246](https://github.com/kiwi-init/channels/pull/2246)) ([29aea87](https://github.com/kiwi-init/channels/commit/29aea87b0e6d349e4f70f366cd7e759f130adb28))
- Tasks in Jump to and in Search: the same order and the same row, with owner and status (T1820) ([#2249](https://github.com/kiwi-init/channels/pull/2249)) ([61b8094](https://github.com/kiwi-init/channels/commit/61b80949a58b7342a1a7dd54253dbfef04fe28eb))
- **First run:** one line on the encryption screen, and Enter goes on from anywhere in the intro (T4291) ([#2250](https://github.com/kiwi-init/channels/pull/2250)) ([d03fdf9](https://github.com/kiwi-init/channels/commit/d03fdf95ea3b520477225eb63ed9d53d31acd220))
- **Landing:** a task lands by a list of steps with ids, movers and detectors (T4163) ([#2247](https://github.com/kiwi-init/channels/pull/2247)) ([d0ec3b1](https://github.com/kiwi-init/channels/commit/d0ec3b13bfbd5389b8800ef0c8ff957be0978a73))
- **Mover:** every open task names whose move it is, and a landing task's is its current step's (T4168, T4348) ([#2251](https://github.com/kiwi-init/channels/pull/2251)) ([2c74dfc](https://github.com/kiwi-init/channels/commit/2c74dfc111aa95769a7c713d12a77555155eb47e))

## 2026.11.15 — 2026-11-09

Tag [v2026.11.15](https://github.com/kiwi-init/channels/releases/tag/v2026.11.15) · commit [bf991cc](https://github.com/kiwi-init/channels/commit/bf991cc50687bf43456b03d31a6fe3217c41a40f) · 2026-11-09

### Other changes

- **Usage:** a meter on the rail, Plan and pay in Account, a dialog at the limit ([#1985](https://github.com/kiwi-init/channels/pull/1985)) ([e045d3a](https://github.com/kiwi-init/channels/commit/e045d3aae170ff334e6a84877dfe1bf324cba76e))
- **Relay:** the paid plan sends 10,000 messages a day ([#1987](https://github.com/kiwi-init/channels/pull/1987)) ([db811b6](https://github.com/kiwi-init/channels/commit/db811b62b2c93302b0ff2ffd5a8816528f1632fb))
- Channels Dark and Channels Light are the default themes, in the app, on the phone and on the site ([#1986](https://github.com/kiwi-init/channels/pull/1986)) ([c31226b](https://github.com/kiwi-init/channels/commit/c31226bd761e19344ee016bc3d41e3aa460f2abe))
- **Updates:** an icon next to search in the header, not a floating button over the feed ([#1989](https://github.com/kiwi-init/channels/pull/1989)) ([a244844](https://github.com/kiwi-init/channels/commit/a244844663d589336d5ae1487d9e7e574cf8fbb8))
- **Site:** the figures' dark tones are Channels Dark greys, not Cinder Peak browns ([#1991](https://github.com/kiwi-init/channels/pull/1991)) ([2db195a](https://github.com/kiwi-init/channels/commit/2db195a09719620c1d4003800ad04cfaf12237e3))
- **Specs:** the comment box suggests people and tasks like the chat composer (T244) ([#1992](https://github.com/kiwi-init/channels/pull/1992)) ([ba821dd](https://github.com/kiwi-init/channels/commit/ba821dd4b099fff1fae4a6a595a331eeef16b504))
- **Specs:** the comment box takes images, like the chat composer (T243) ([#1990](https://github.com/kiwi-init/channels/pull/1990)) ([1e4e3e2](https://github.com/kiwi-init/channels/commit/1e4e3e268dbf76ab8c547dedb83691998e79a317))
- **ui:** the first-load budget is 800 KB, up from 760 KB (T418) ([#1994](https://github.com/kiwi-init/channels/pull/1994)) ([ca1cc4f](https://github.com/kiwi-init/channels/commit/ca1cc4f266988832f7d944ce482f5e8485795c08))
- **Specs:** quote and reply to a comment in the comments column (T245) ([#1993](https://github.com/kiwi-init/channels/pull/1993)) ([1d6de15](https://github.com/kiwi-init/channels/commit/1d6de15ef97411a718bb1faa6197a28772a16fad))
- Remove AFK from the app; the meadow stays for onboarding and the site (T506, #494) ([#1996](https://github.com/kiwi-init/channels/pull/1996)) ([9b7527c](https://github.com/kiwi-init/channels/commit/9b7527c5357899ad4b2c0fea767f13b2171079d2))
- **Mac:** double-clicking the top bar zooms the window (T327) ([#1995](https://github.com/kiwi-init/channels/pull/1995)) ([62bd98d](https://github.com/kiwi-init/channels/commit/62bd98da38c094fbb211db73264361f98f230fb9))
- Home, polished (T516) ([#1998](https://github.com/kiwi-init/channels/pull/1998)) ([bb1fa2c](https://github.com/kiwi-init/channels/commit/bb1fa2c6a4a2e974e5ae5f3508a241bd5ada705d))
- **License:** MIT ([#1988](https://github.com/kiwi-init/channels/pull/1988)) ([998c007](https://github.com/kiwi-init/channels/commit/998c0074ccf5231d5b0be2c5f8d6dadeca7a9695))
- **shots:** the onboarding meadow check waits for its canvas, not a fixed 2.6 s (T438) ([#1999](https://github.com/kiwi-init/channels/pull/1999)) ([0677981](https://github.com/kiwi-init/channels/commit/0677981cae8a6435d08dc63889a0754ef75c7553))
- **Tasks:** with no branch prefix, a merge-step task says how to link its PR (#2000) ([#2001](https://github.com/kiwi-init/channels/pull/2001)) ([25eded4](https://github.com/kiwi-init/channels/commit/25eded4a1498c506891ef4ef4cf9df3858518aff))
- **License:** AGPL-3.0 instead of MIT ([#2002](https://github.com/kiwi-init/channels/pull/2002)) ([9532131](https://github.com/kiwi-init/channels/commit/953213158768868b1024e57533e19ac3df948d85))

## 2026.11.14 — 2026-11-09

Tag [v2026.11.14](https://github.com/kiwi-init/channels/releases/tag/v2026.11.14) · commit [66210b7](https://github.com/kiwi-init/channels/commit/66210b701cf6054842fec36f5c3f49787cdc0b54) · 2026-11-09

### Other changes

- **iPhone:** Needs you acts on permissions, joins and specs ([#1945](https://github.com/kiwi-init/channels/pull/1945)) ([deea533](https://github.com/kiwi-init/channels/commit/deea533af7a303f37641dcdff8084b0c5330f16e))
- **iPhone:** the composer empties after Send, every time ([#1946](https://github.com/kiwi-init/channels/pull/1946)) ([d7f9510](https://github.com/kiwi-init/channels/commit/d7f9510415e8fb281c03517aadcee8310fffaac7))
- **iPhone:** the desktop's look: Cinder Peak and Channels Light, no glass ([#1948](https://github.com/kiwi-init/channels/pull/1948)) ([bd9c860](https://github.com/kiwi-init/channels/commit/bd9c8603fda6032fcbc9dae0936cda3d9ad84d41))
- **iPhone:** agents wear the desktop's role faces ([#1949](https://github.com/kiwi-init/channels/pull/1949)) ([0a7ce18](https://github.com/kiwi-init/channels/commit/0a7ce18d8ef815e36934667a8f87e53c78177742))
- **iPhone:** tinted Liquid Glass on the chrome ([#1952](https://github.com/kiwi-init/channels/pull/1952)) ([53e0d74](https://github.com/kiwi-init/channels/commit/53e0d74664161a84510c26a5cb7fa25c2615ea1c))
- **Permissions:** any seat of the agent's person allows, not only the one humanOf picks ([#1954](https://github.com/kiwi-init/channels/pull/1954)) ([088c008](https://github.com/kiwi-init/channels/commit/088c0083c47aa7b07742a32325fc926c0ca5f1dc))
- **iPhone push:** register the APNs token with every channel ([#1951](https://github.com/kiwi-init/channels/pull/1951)) ([d3285ec](https://github.com/kiwi-init/channels/commit/d3285ec71d420acc44b03d43e406758eb540ed24))
- **iPhone cold start:** the list opens from sealed copies of each channel ([#1955](https://github.com/kiwi-init/channels/pull/1955)) ([8a1bbb9](https://github.com/kiwi-init/channels/commit/8a1bbb9cfa8f6e998637716d82cbe9f10ec44d37))
- **iPhone:** avatars as the desktop draws them, no prism left ([#1953](https://github.com/kiwi-init/channels/pull/1953)) ([8e5a648](https://github.com/kiwi-init/channels/commit/8e5a648a79bd8c833c766cdf872cb3b6376fc3b4))
- **iPhone engine:** places lists every room, DM and task thread ([#1956](https://github.com/kiwi-init/channels/pull/1956)) ([b321d3d](https://github.com/kiwi-init/channels/commit/b321d3d080c07c0954f76c3be4ec4d6550cb42b5))
- **Relay:** a per-person daily message quota, leased to each owned channel (T17) ([#1967](https://github.com/kiwi-init/channels/pull/1967)) ([a00ff38](https://github.com/kiwi-init/channels/commit/a00ff38d199426e126319dc4a17d1200b6e7109a))
- **Relay:** admin routes to list people and set their plan or block (T19) ([#1968](https://github.com/kiwi-init/channels/pull/1968)) ([0958194](https://github.com/kiwi-init/channels/commit/095819421fe9d742b1f930a2ffe9dfe924e39e74))
- Today's use in Account; the quota's 429 as one line in the CLI (T20) ([#1969](https://github.com/kiwi-init/channels/pull/1969)) ([15f2808](https://github.com/kiwi-init/channels/commit/15f28089dc89ebf157ddbc926d832206e8abc1bb))
- **Stripe:** the paid plan via a Payment Link and a signed webhook (T21) ([#1970](https://github.com/kiwi-init/channels/pull/1970)) ([0c2e677](https://github.com/kiwi-init/channels/commit/0c2e67742a3f0d6e2dde64ef901d057fef7922ed))
- **iOS:** upload a TestFlight build on every iOS push to main ([#1974](https://github.com/kiwi-init/channels/pull/1974)) ([ad4b7da](https://github.com/kiwi-init/channels/commit/ad4b7daf0f4a0c53973fa1e677d406d1e03f3e3b))
- **Phones:** the iPhone and Android apps as they run today, in one PR ([#1976](https://github.com/kiwi-init/channels/pull/1976)) ([c121660](https://github.com/kiwi-init/channels/commit/c1216600d9fc71452ccafab95e04472257d2a27f))
- **Relay:** 1.6 storage row writes per message instead of 6.5 (T89) ([#1975](https://github.com/kiwi-init/channels/pull/1975)) ([efaac9a](https://github.com/kiwi-init/channels/commit/efaac9afe46fe0866013657de0b3923c37038aa8))
- **Relay:** 1,000 messages a day free, 5,000 paid, with the upgrade link (T21) ([#1978](https://github.com/kiwi-init/channels/pull/1978)) ([22b0eea](https://github.com/kiwi-init/channels/commit/22b0eea5fe48e2b18730ce1f237750612d555828))
- **Docs:** a privacy page at /docs/privacy ([#1977](https://github.com/kiwi-init/channels/pull/1977)) ([6a52bce](https://github.com/kiwi-init/channels/commit/6a52bcea3550bf555154f433975fdf540d9c37f5))
- **iOS:** Look Around First opens a sample channel ([#1979](https://github.com/kiwi-init/channels/pull/1979)) ([4cfb87b](https://github.com/kiwi-init/channels/commit/4cfb87bcc88497770f6a8ca8cd5123fcdd5d2f81))
- **Landing:** the site build makes /afk/scene, so the meadow draws behind the landing again ([#1980](https://github.com/kiwi-init/channels/pull/1980)) ([9fe15f7](https://github.com/kiwi-init/channels/commit/9fe15f76f24591500700586763a87b6586b00277))
- **AFK:** the map shows every channel's pin from inside a channel, not only from Home ([#1981](https://github.com/kiwi-init/channels/pull/1981)) ([718d9df](https://github.com/kiwi-init/channels/commit/718d9df09d2342531a5d2e0d9bf58c321f05170d))
- **Account:** admins see how many people use the relay and how many were on it today (spec #131) ([#1982](https://github.com/kiwi-init/channels/pull/1982)) ([e047036](https://github.com/kiwi-init/channels/commit/e0470368c705dcd802e6fd67a20a1d5750c4aef5))
- **Site:** Get iOS Beta on the landing page ([#1983](https://github.com/kiwi-init/channels/pull/1983)) ([3e2b4a3](https://github.com/kiwi-init/channels/commit/3e2b4a38527d02b97f5a13537d6de0a000d08df7))

## 2026.11.13 — 2026-11-07

Tag [v2026.11.13](https://github.com/kiwi-init/channels/releases/tag/v2026.11.13) · commit [932e21b](https://github.com/kiwi-init/channels/commit/932e21b7c4522a35c9557bbee72f1f65122b9e0a) · 2026-11-07

### Other changes

- **Linux:** a quiet start, proven on Arch KDE, and spell check proven to underline (T7214) ([#1931](https://github.com/kiwi-init/channels/pull/1931)) ([59c6073](https://github.com/kiwi-init/channels/commit/59c6073fc23626151624de81a51e349731de110f))
- **Landing:** the AFK scene behind one line and two buttons (T28) ([#1933](https://github.com/kiwi-init/channels/pull/1933)) ([e790524](https://github.com/kiwi-init/channels/commit/e7905247d9e117ee841cad29256bec9bcef910e0))
- **Docs:** Play demo, the real app in demo mode, is the first page (T29) ([#1934](https://github.com/kiwi-init/channels/pull/1934)) ([e4df937](https://github.com/kiwi-init/channels/commit/e4df937bcfc5753ca6be781ea33e7d9ff5b01804))
- **Run tasks:** a run task lands on GitHub's start for its declared run, matched by run-name or run id (T2183) ([#1910](https://github.com/kiwi-init/channels/pull/1910)) ([afec8d5](https://github.com/kiwi-init/channels/commit/afec8d5261a247f6d0cd0c0400cc74ef5c9a0c2e))
- **Doc:** remove the typing code the read-only doc left (T6307) ([#1930](https://github.com/kiwi-init/channels/pull/1930)) ([a8df374](https://github.com/kiwi-init/channels/commit/a8df3747207c8cb9a71ae08ca63339142697e011))
- **AFK:** the Map, each channel a pin on the meadow whose dot pulses red only when it needs you ([#1939](https://github.com/kiwi-init/channels/pull/1939)) ([f21eef6](https://github.com/kiwi-init/channels/commit/f21eef64eb7fc1ba9e7f1bc3a5db923295a538e1))
- **Icon:** the app and site use Jow's Icon Composer icon, Liquid Glass on macOS 26 ([#1942](https://github.com/kiwi-init/channels/pull/1942)) ([ae91e43](https://github.com/kiwi-init/channels/commit/ae91e43c24f238f820ec8718c0df5b5bc4ab9699))
- **AFK:** Calm and Idle become AFK in the app, on main (T89) ([#1941](https://github.com/kiwi-init/channels/pull/1941)) ([c02124b](https://github.com/kiwi-init/channels/commit/c02124be5eca8fa6b36c84c8a694c4e7e8fb2ca4))

## 2026.11.12 — 2026-11-07

Tag [v2026.11.12](https://github.com/kiwi-init/channels/releases/tag/v2026.11.12) · commit [16e10c0](https://github.com/kiwi-init/channels/commit/16e10c0fba07bb49b644dc38bce246a6c25e78fe) · 2026-11-07

### Fixes

- **Sidebar:** a fresh device starts caught up in members-only DMs (T2013) ([#1893](https://github.com/kiwi-init/channels/pull/1893)) ([e7decc3](https://github.com/kiwi-init/channels/commit/e7decc36c5b566970182243c87520d8ebc13d091))
- **Doc still:** a scroll up from the bottom of a thread doc leaves follow at once (T2262, #1897) ([#1906](https://github.com/kiwi-init/channels/pull/1906)) ([df7a27d](https://github.com/kiwi-init/channels/commit/df7a27d3e7bb1e0abeda61c7676bcaf78fb7a736))

### Other changes

- **Rooms:** a badge counts only what the room shows; replies in a spec's thread don't raise it (#1779) ([#1790](https://github.com/kiwi-init/channels/pull/1790)) ([74a148e](https://github.com/kiwi-init/channels/commit/74a148ecad570329eca44a2399aa035dba5253f7))
- **Specs:** the comments column scrolls on its own and stays in view (#1686) ([#1788](https://github.com/kiwi-init/channels/pull/1788)) ([b55839c](https://github.com/kiwi-init/channels/commit/b55839cb57c5a1de1c8749e431255364da2cfd5f))
- **Repo garden:** Jow's lean AGENTS.md, ignore doc-fuzz traces ([#1791](https://github.com/kiwi-init/channels/pull/1791)) ([6df19a5](https://github.com/kiwi-init/channels/commit/6df19a55ca6809881722fc0abaa4e9707d9d7467))
- **CI:** the phone jobs run only when a dispatch names them ([#1792](https://github.com/kiwi-init/channels/pull/1792)) ([93a8939](https://github.com/kiwi-init/channels/commit/93a8939e04c0949f9a63143814b89b000dd70d42))
- **Trim dead weight:** old mockups, old release notes, unused assets ([#1793](https://github.com/kiwi-init/channels/pull/1793)) ([e2df064](https://github.com/kiwi-init/channels/commit/e2df064ee7bb416254d8fd68b6a99f95555e0300))
- **ui:** Modal, Field, Toggle and Empty leave the first load, 2.3 KB off (T428) ([#1795](https://github.com/kiwi-init/channels/pull/1795)) ([63363e5](https://github.com/kiwi-init/channels/commit/63363e5d863332911bdb674476a8fe01198d1cf4))
- **Retire kiwi mcp:** one way in, the CLI and hooks ([#1798](https://github.com/kiwi-init/channels/pull/1798)) ([612a534](https://github.com/kiwi-init/channels/commit/612a534c982fe43ff141d3a9a38477b2a1828dd3))
- **Tasks:** a task's title, notes and reviews are Words, so they name agents by nickname (#1763, part 4) ([#1797](https://github.com/kiwi-init/channels/pull/1797)) ([42009bf](https://github.com/kiwi-init/channels/commit/42009bf7e2e062a862f632c21fc185211c84bb9b))
- **Tall layout:** an open spec grows the top pane and stays inside it (#1769) ([#1800](https://github.com/kiwi-init/channels/pull/1800)) ([6506657](https://github.com/kiwi-init/channels/commit/6506657384f2f41eb49fd458a323693d9ab7d258))
- **ui:** a spec's title, ask, text and notes are Words, so they name agents by nickname (T363, #1763 part 5) ([#1801](https://github.com/kiwi-init/channels/pull/1801)) ([6fd070f](https://github.com/kiwi-init/channels/commit/6fd070f26b65ff943a870e2cb3bfb1e11d3390e1))
- **CLI:** a short help, one call to answer a shared message, and a token budget ([#1799](https://github.com/kiwi-init/channels/pull/1799)) ([7e79b12](https://github.com/kiwi-init/channels/commit/7e79b12bf35c9dd7f4cd9b6101ebbb693bd97523))
- kiwi task add --start: file a task and take it in one call ([#1803](https://github.com/kiwi-init/channels/pull/1803)) ([d40dc98](https://github.com/kiwi-init/channels/commit/d40dc98a4ad4fc593a36e182011aad75767fbdf1))
- **kiwi status:** each member's key and machine only with --all ([#1802](https://github.com/kiwi-init/channels/pull/1802)) ([ff84b39](https://github.com/kiwi-init/channels/commit/ff84b392ed0467a198a7002d4dcc95b2459d693a))
- GitHub events keep when they happened, and the fold applies them in that order (T687) ([#1805](https://github.com/kiwi-init/channels/pull/1805)) ([3c44404](https://github.com/kiwi-init/channels/commit/3c44404f6e16cea44e5e3944b3635bdf54b0658c))
- **Tray:** the unread icon follows the dark panel again (T424) ([#1796](https://github.com/kiwi-init/channels/pull/1796)) ([7f80c36](https://github.com/kiwi-init/channels/commit/7f80c3663c3cb18ddc56d2a09ddd1a5123caa129))
- **ask-human --check:** a check with a phase, a decider and the artifact it vouches for (T686) ([#1807](https://github.com/kiwi-init/channels/pull/1807)) ([1f2b3f2](https://github.com/kiwi-init/channels/commit/1f2b3f23de55a8387fc29270235939f02dccba40))
- **UI:** the Updates panel loads when it opens, 6.7 KB off the first load (T789) ([#1808](https://github.com/kiwi-init/channels/pull/1808)) ([6a55e59](https://github.com/kiwi-init/channels/commit/6a55e5996aad42d95cf1fbd110a9b8a55e711bd1))
- **CLI downloads:** Macs install a 23.5 MB .xz instead of the 41 MB .gz, and each target gets its own cap (T5311) ([#1809](https://github.com/kiwi-init/channels/pull/1809)) ([a645a00](https://github.com/kiwi-init/channels/commit/a645a00ff6ad069793e4aa6aa1e070db5b93f148))
- **agent-cost:** a busy channel, and what one agent is sent from it ([#1804](https://github.com/kiwi-init/channels/pull/1804)) ([1682ddf](https://github.com/kiwi-init/channels/commit/1682ddf11d6a9b9e177e92352d96693a91421038))
- **Steps:** an answer typed in the room shows once, and the card links to it (#1794) ([#1811](https://github.com/kiwi-init/channels/pull/1811)) ([5167236](https://github.com/kiwi-init/channels/commit/5167236fa2deb439224d44901e31fb8ffca3edd4))
- **Tasks:** an approved task with a landing step stays landing until its work ships (T685, spec #623 part 1) ([#1812](https://github.com/kiwi-init/channels/pull/1812)) ([30fb516](https://github.com/kiwi-init/channels/commit/30fb516da5cd80dd09ea6fb932e6326aeecc6efd))
- **Linux:** a test AppImage leaves the installed app's menu entry alone (T819) ([#1810](https://github.com/kiwi-init/channels/pull/1810)) ([aa3585c](https://github.com/kiwi-init/channels/commit/aa3585cf1a51c7125ff2327f86e5527bcc5a5aa2))
- **AGENTS.md:** UI changes show before and after screenshots on the PR ([#1821](https://github.com/kiwi-init/channels/pull/1821)) ([511bcff](https://github.com/kiwi-init/channels/commit/511bcff3e1d9656faafea743a6c8d0796e3a339e))
- **Landing tasks:** the lander's loop keeps them, the board says what they wait for, and merge channels warn (T690) ([#1814](https://github.com/kiwi-init/channels/pull/1814)) ([897d8d4](https://github.com/kiwi-init/channels/commit/897d8d4014a437b2b03f0e762751c9697b619378))
- Update comments policy in AGENTS.md ([#1823](https://github.com/kiwi-init/channels/pull/1823)) ([61981fb](https://github.com/kiwi-init/channels/commit/61981fbfac33695591dad99e424dbe777cefce7c))
- **Quarantine:** PRs from listed models turn into labeled drafts until a vouch ([#1827](https://github.com/kiwi-init/channels/pull/1827)) ([0eb3900](https://github.com/kiwi-init/channels/commit/0eb3900cd2f8ba102ce736b40001910a40834c38))
- **Who merges:** the owner can leave pull requests to people, and agents are told not to merge (T1067) ([#1825](https://github.com/kiwi-init/channels/pull/1825)) ([fdad6cd](https://github.com/kiwi-init/channels/commit/fdad6cdd2ce0db161993051af4fba59bfc13d77d))
- **Quarantine:** the bot's token can turn a PR into a draft ([#1830](https://github.com/kiwi-init/channels/pull/1830)) ([9c04a0e](https://github.com/kiwi-init/channels/commit/9c04a0ef0ff45834f467666835de91cd4a8a277f))
- **Desktop:** every link outside the app opens through the bridge (#1818) ([#1831](https://github.com/kiwi-init/channels/pull/1831)) ([f727db6](https://github.com/kiwi-init/channels/commit/f727db60d1a40d189f525390bb4277c68ec3b421))
- Cinder Peak is the default dark theme (T6656) ([#1822](https://github.com/kiwi-init/channels/pull/1822)) ([95fd01f](https://github.com/kiwi-init/channels/commit/95fd01f2a130c3400bad0703fab28e71bad66461))
- **Tracker:** kiwi-bus rewrites #1824 once a day with open PRs and issues ranked ([#1832](https://github.com/kiwi-init/channels/pull/1832)) ([43b2add](https://github.com/kiwi-init/channels/commit/43b2add3addecc38e6b92ee67301b7472434b21c))
- **Blast radius:** each PR gets a blast:* label, and high ones a comment from kiwi-bus ([#1834](https://github.com/kiwi-init/channels/pull/1834)) ([d1eaca3](https://github.com/kiwi-init/channels/commit/d1eaca39a99341045f961ff96e6ed756e7287237))
- Linux window look test checks the Cinder Peak background (T6656) ([#1835](https://github.com/kiwi-init/channels/pull/1835)) ([55d523f](https://github.com/kiwi-init/channels/commit/55d523fe1e225c73beef1bef9a5d220db878c1b7))
- **UI:** rare account, join and app actions load on demand, 5.5 KB off the first load (T1208) ([#1836](https://github.com/kiwi-init/channels/pull/1836)) ([fc0ae43](https://github.com/kiwi-init/channels/commit/fc0ae434d4e6bb2bf732552f89139494b5ee8fcc))
- **tracker:** Haiku ranks what to merge first and what to fix first ([#1837](https://github.com/kiwi-init/channels/pull/1837)) ([8753c39](https://github.com/kiwi-init/channels/commit/8753c39d545b99d524221b826c8696d2fd6ea31e))
- **tracker:** ask for a why of at most 20 words, so it fits whole ([#1839](https://github.com/kiwi-init/channels/pull/1839)) ([0bc56b2](https://github.com/kiwi-init/channels/commit/0bc56b2a16023ba7357353d9f1deea6505d83bb6))
- **Ship gate:** kiwi/review says whether a PR may ship, reconciled from state, downgrade first (T688) ([#1820](https://github.com/kiwi-init/channels/pull/1820)) ([8fa22cc](https://github.com/kiwi-init/channels/commit/8fa22ccaf34d1768df93c72158d77a18fb906745))
- **tracker:** drop HTML tags from the model's why instead of showing them escaped ([#1844](https://github.com/kiwi-init/channels/pull/1844)) ([1bd2674](https://github.com/kiwi-init/channels/commit/1bd2674d4aeaffd62a26bf8a8c75ba9c88057f96))
- **Done gate:** a landing task is done only when it shipped with its gate open, and a bypass waits for a person (T689) ([#1841](https://github.com/kiwi-init/channels/pull/1841)) ([665ebd8](https://github.com/kiwi-init/channels/commit/665ebd8f3c7e15134ef62a76dd9edc553b2b44f9))
- **Cards:** task ids, #refs, URLs and mentions in asks and steps are links (#1828) ([#1846](https://github.com/kiwi-init/channels/pull/1846)) ([c56251d](https://github.com/kiwi-init/channels/commit/c56251dbb127d5e474f44b94f959667a158fe2b5))
- **Brief:** the same rules in 16% fewer words ([#1845](https://github.com/kiwi-init/channels/pull/1845)) ([839729d](https://github.com/kiwi-init/channels/commit/839729ddbc9684fd94bf498afb3abbbbff14ecdd))
- **CLI:** one name per action; the older names say what replaced them ([#1851](https://github.com/kiwi-init/channels/pull/1851)) ([c31b7de](https://github.com/kiwi-init/channels/commit/c31b7dea386f259c9a40e85834077f32d3a0c488))
- **tracker:** items labelled fits-a-mod say so, and those issues rank last ([#1859](https://github.com/kiwi-init/channels/pull/1859)) ([ee839a8](https://github.com/kiwi-init/channels/commit/ee839a8bac814646c24dbbfe307c2a1a1685d839))
- **Chat:** a table right under a line of text renders as a table (T7015) ([#1856](https://github.com/kiwi-init/channels/pull/1856)) ([7095924](https://github.com/kiwi-init/channels/commit/7095924a673cb9203a655b7744ea95866e3b4f4b))
- **Board:** with people merging, an approved PR whose ship gate is open says it's ready for a person to merge (T1142) ([#1855](https://github.com/kiwi-init/channels/pull/1855)) ([38f6ab7](https://github.com/kiwi-init/channels/commit/38f6ab71471b43eb631ac799c044a129fab2c1bc))
- kiwi upgrade downloads the .xz, falls back to the .gz (T6310) ([#1858](https://github.com/kiwi-init/channels/pull/1858)) ([688fb25](https://github.com/kiwi-init/channels/commit/688fb257150a2e7a140c038997caf765b9ca343d))
- **Smoke:** the CLI runs with no stdin, so kiwi note KEY reads instead of waiting ([#1864](https://github.com/kiwi-init/channels/pull/1864)) ([a4f0f58](https://github.com/kiwi-init/channels/commit/a4f0f5823c4b5fed1da96eb219efab31ce952ae2))
- **Loop:** a Ctrl-C at a session's start no longer leaves the terminal raw (kimi flow flake) ([#1861](https://github.com/kiwi-init/channels/pull/1861)) ([a14d8f2](https://github.com/kiwi-init/channels/commit/a14d8f21a773e9b55f4c8e48e75df1a46e426cb8))
- **Spec comments:** Enter sends, following the Enter-sends setting (#1842) ([#1866](https://github.com/kiwi-init/channels/pull/1866)) ([7d01945](https://github.com/kiwi-init/channels/commit/7d01945d557c4add77f9675759959212fb072f25))
- **kiwi/review fence:** tickets on gate-shutting changes, and a success must have folded every one (T954) ([#1853](https://github.com/kiwi-init/channels/pull/1853)) ([507d19f](https://github.com/kiwi-init/channels/commit/507d19f0db3fa3442e1023dc019702ed65ae0ac7))
- **Smoke:** a hung CLI call fails in seconds, not at the job's kill (T1663) ([#1876](https://github.com/kiwi-init/channels/pull/1876)) ([6445d7c](https://github.com/kiwi-init/channels/commit/6445d7c34eea7314dc855c9a3671262f14172812))
- livewire-bump pushes with the app token: checkout keeps no credentials (#7506) ([#1877](https://github.com/kiwi-init/channels/pull/1877)) ([e923511](https://github.com/kiwi-init/channels/commit/e923511a20e47ad8de556d36958ca9b29d63cfb0))
- **Channel settings:** Tasks land on is a dropdown (T1368) ([#1878](https://github.com/kiwi-init/channels/pull/1878)) ([e7eb366](https://github.com/kiwi-init/channels/commit/e7eb3664e98964d0eb5c6f9c582fe4a65f01695e))
- **intents.yaml:** checkpoint rotation is on by default, and phones get only Needs you (spec #152) ([#1880](https://github.com/kiwi-init/channels/pull/1880)) ([b5047f2](https://github.com/kiwi-init/channels/commit/b5047f2ca4fc82fa8a92979ffb18e4fabd5a8683))
- The new site on main: docs pages, anatomy figures, the rebuilt landing and a light theme, without the Mods pages (T7923) ([#1892](https://github.com/kiwi-init/channels/pull/1892)) ([5d00216](https://github.com/kiwi-init/channels/commit/5d00216021cf5cd9a2927f2cd6783fdf3ac28591))
- **Deps:** refresh npm and Android ([#1875](https://github.com/kiwi-init/channels/pull/1875)) ([912ac14](https://github.com/kiwi-init/channels/commit/912ac14d6da3208256b237e27d746c772eb180ce))
- **CI:** build / doc runs as three balanced legs (T1948) ([#1890](https://github.com/kiwi-init/channels/pull/1890)) ([3088856](https://github.com/kiwi-init/channels/commit/3088856dd475965533307db5b3c503d5bdb23024))
- **CI:** a dispatch replaces an older one only on the same ref and inputs (T1950) ([#1894](https://github.com/kiwi-init/channels/pull/1894)) ([d893851](https://github.com/kiwi-init/channels/commit/d89385177844e99a529208174a6ee8cedda3ff4c))
- **Shots:** wait for in-flight reaction requests before each navigation (#1850) ([#1867](https://github.com/kiwi-init/channels/pull/1867)) ([07c37d7](https://github.com/kiwi-init/channels/commit/07c37d7b7bb5bb1a50b333c4d95b5fbbf1fb6009))
- **Run tasks:** a declared run pins the round, and a reported start only shows a bypass (T1269) ([#1896](https://github.com/kiwi-init/channels/pull/1896)) ([8df520e](https://github.com/kiwi-init/channels/commit/8df520e75a8fe6002b8a420d8d3a96652dd8b5b2))
- **Main CI green:** slimmer icons put the first load at 754,542 bytes; the WebKit #1850 repro becomes a note ([#1912](https://github.com/kiwi-init/channels/pull/1912)) ([22fade6](https://github.com/kiwi-init/channels/commit/22fade67e949f735b28d54ecd9cea900a5a305b5))
- **Desktop:** build on Livewire 2026.11.1 ([#1899](https://github.com/kiwi-init/channels/pull/1899)) ([0d75e6b](https://github.com/kiwi-init/channels/commit/0d75e6b0290929a3d0d87cc010d7b8dc6261752c))
- **Desktop:** build on Livewire 2026.11.2 ([#1924](https://github.com/kiwi-init/channels/pull/1924)) ([2fc1b6b](https://github.com/kiwi-init/channels/commit/2fc1b6bd921715ec024b75a720cd5b177a117704))
- **Desktop:** pin the Linux Livewire core files by hash (T7239) ([#1925](https://github.com/kiwi-init/channels/pull/1925)) ([5a2045f](https://github.com/kiwi-init/channels/commit/5a2045f2247e4f44691747ad1d969cd9ea5a6ff0))
- **desktop/distros:** the AppImage start checks read the app's processes, not a log line ([#1926](https://github.com/kiwi-init/channels/pull/1926)) ([eef7862](https://github.com/kiwi-init/channels/commit/eef7862d2ea1bae676a6a3f686ffaa2d5e69af18))
- **Desktop:** build on Livewire 2026.11.3 ([#1928](https://github.com/kiwi-init/channels/pull/1928)) ([32b1e55](https://github.com/kiwi-init/channels/commit/32b1e55a62ae2c1492d4ee5e7165fc01ad19f221))

## 2026.11.11 — 2026-11-06

Tag [v2026.11.11](https://github.com/kiwi-init/channels/releases/tag/v2026.11.11) · commit [b550134](https://github.com/kiwi-init/channels/commit/b5501347361cae3a1614c6c7c3cd53cdd23bc333) · 2026-11-06

### Other changes

- **release:** the stamp PR runs the release's Mac tests and packing before the tag (T5174) ([#1752](https://github.com/kiwi-init/channels/pull/1752)) ([680ae95](https://github.com/kiwi-init/channels/commit/680ae9598ba56c0603998fb49d1a6703fc9a32bb))
- **Calm:** the idle screen is Jow's Token Meadow, lit by the person's clock (#5411) ([#1754](https://github.com/kiwi-init/channels/pull/1754)) ([6a62b38](https://github.com/kiwi-init/channels/commit/6a62b38adb60e238d5c383358bb27a16a454e15d))
- **search:** seal the index every 30 s, not on every feed, and end the idle worker ([#1753](https://github.com/kiwi-init/channels/pull/1753)) ([fe8a7f7](https://github.com/kiwi-init/channels/commit/fe8a7f76c8232f351da8129eac12657f27c15306))
- **Calm:** the still meadow frame is drawn again over the next frames ([#1755](https://github.com/kiwi-init/channels/pull/1755)) ([0530bce](https://github.com/kiwi-init/channels/commit/0530bce2d0e5955b4c4cbaa5423967cb95fa223a))
- **Composer:** back in every thread, floating and frosted; sends land in the doc (T5115) ([#1747](https://github.com/kiwi-init/channels/pull/1747)) ([e20e05c](https://github.com/kiwi-init/channels/commit/e20e05cb99ad25225a5538d4ce60ef03c50dd238))
- **Composer:** a file chip's name sits on the spacing scale (24px, not 26px) ([#1758](https://github.com/kiwi-init/channels/pull/1758)) ([07a8302](https://github.com/kiwi-init/channels/commit/07a83029705330368941396e7e2f8979607638a9))
- **UI memory:** a 400-message window with seamless scrollback, two warm channels, light Home, images held once ([#1757](https://github.com/kiwi-init/channels/pull/1757)) ([cd67ed0](https://github.com/kiwi-init/channels/commit/cd67ed0267499f236392860152a94b12c8d4960f))
- **ui:** chat images show from a copy sized to their box, the original only in the viewer ([#1756](https://github.com/kiwi-init/channels/pull/1756)) ([47be17d](https://github.com/kiwi-init/channels/commit/47be17d93d2b69e8cee5fcd1ea782d2d37ee5e49))
- **Calm:** the meadow stops drawing while Calm fades out, and its frame-rate verdict carries across opens ([#1760](https://github.com/kiwi-init/channels/pull/1760)) ([f9560e2](https://github.com/kiwi-init/channels/commit/f9560e24e775cc25765b3b73fc78ac375f0c39ac))
- Edit opens in the composer for every message, and in the panel you edit from (T5115) ([#1759](https://github.com/kiwi-init/channels/pull/1759)) ([64e1bbe](https://github.com/kiwi-init/channels/commit/64e1bbedcec816f1a3dcc2b4059eaf03f221e349))
- **Composer:** Enter right after a paste sends the image with the line ([#1761](https://github.com/kiwi-init/channels/pull/1761)) ([bb345db](https://github.com/kiwi-init/channels/commit/bb345db6935d698bf3ed9fdefc1ad5769ae8a96a))
- **ui-restore-place:** read the restored place once the feed has settled, 1.2 s after load ([#1762](https://github.com/kiwi-init/channels/pull/1762)) ([590d155](https://github.com/kiwi-init/channels/commit/590d155599577c48e48d7dd8bbc8902afc583c5a))
- **Seats:** a resumed session stores its new pid on its seat, so no other session takes it (#1676) ([#1765](https://github.com/kiwi-init/channels/pull/1765)) ([2d486c0](https://github.com/kiwi-init/channels/commit/2d486c06d84cdba48c017ec1c3b4ade3433551d1))
- **Seats:** a session whose seat another session took is told so (#1676) ([#1766](https://github.com/kiwi-init/channels/pull/1766)) ([f61c9fe](https://github.com/kiwi-init/channels/commit/f61c9fe235e82980f0dc854f30a0ccbadeddd2c2))
- **Names:** acks, read receipts, join pings and decision cards show nicknames, not handles (#1681) ([#1767](https://github.com/kiwi-init/channels/pull/1767)) ([67d700a](https://github.com/kiwi-init/channels/commit/67d700a218e1d89bd349ce4ad46bc546c4c8a3ec))
- **Sidebar:** a DM with an agent that left sits under Agents, greyed as left ([#1768](https://github.com/kiwi-init/channels/pull/1768)) ([f033dc3](https://github.com/kiwi-init/channels/commit/f033dc346b4fe12fa593850ee3553f7c25911d9a))
- **Calm:** one slow start no longer keeps the meadow still for the whole session ([#1771](https://github.com/kiwi-init/channels/pull/1771)) ([69f4922](https://github.com/kiwi-init/channels/commit/69f4922ce0f6239f8add0b9cb7ed2e8574f5f24f))
- **Status:** an idle Claude seat with no hook listener says not listening (#1676) ([#1770](https://github.com/kiwi-init/channels/pull/1770)) ([187a907](https://github.com/kiwi-init/channels/commit/187a9070905883d91a3131035178a7ba67e184e7))
- **Composer:** a half-typed draft survives the window reloading ([#1772](https://github.com/kiwi-init/channels/pull/1772)) ([2980f83](https://github.com/kiwi-init/channels/commit/2980f83bde4fc881d0962a9758bc26df348e528f))
- **Calm:** opening it from the palette closes the palette first ([#1773](https://github.com/kiwi-init/channels/pull/1773)) ([2387dbd](https://github.com/kiwi-init/channels/commit/2387dbde542e422d5c5d4b129077b838f8529ca1))
- **Composer:** an image added while editing doesn't ride along with the next message ([#1774](https://github.com/kiwi-init/channels/pull/1774)) ([ebe861a](https://github.com/kiwi-init/channels/commit/ebe861a2d524c7251d1a8ae70a9f6ef5d693b862))
- Editing an old message loads it whole first, so saving never cuts it for everyone (#5717) ([#1775](https://github.com/kiwi-init/channels/pull/1775)) ([875684d](https://github.com/kiwi-init/channels/commit/875684d580595bafde932b549793370eeaaa31ee))
- **Modals:** forms and copy modals close only from X and Esc; a drag out of the box never closes one (#1764) ([#1776](https://github.com/kiwi-init/channels/pull/1776)) ([13c4db4](https://github.com/kiwi-init/channels/commit/13c4db4a1234b9ec1c87bf3586c7458fc1ccb26c))
- **ui:** the sidebar's update cards load lazily, so the first load is back under budget ([#1780](https://github.com/kiwi-init/channels/pull/1780)) ([f9ad1f1](https://github.com/kiwi-init/channels/commit/f9ad1f16d71a53704fcf02731340b18fed4f902a))
- **Profile:** an agent's handle shows in its profile, with a button that copies it (#1745) ([#1777](https://github.com/kiwi-init/channels/pull/1777)) ([a6945db](https://github.com/kiwi-init/channels/commit/a6945db53ee4474332f5fe58b8dbedee16e6016a))
- **Nicknames:** a check fails the build when a screen shows people an agent's handle (#1763, part 1) ([#1778](https://github.com/kiwi-init/channels/pull/1778)) ([e2b59c6](https://github.com/kiwi-init/channels/commit/e2b59c60b5f1437742f6e3aa334e98dacfb392f8))
- **Onboarding:** the Calm meadow, what stays encrypted, and a typed "Channels is not a harness" (T5712) ([#1782](https://github.com/kiwi-init/channels/pull/1782)) ([df8cc82](https://github.com/kiwi-init/channels/commit/df8cc820d4b9e26e49ad88c7b1d3db4569a30ade))
- **Calm:** the app's own Reduce motion keeps it still, not only the system's ([#1781](https://github.com/kiwi-init/channels/pull/1781)) ([288484b](https://github.com/kiwi-init/channels/commit/288484b65d05881fe811aaf6449c5b758dc2798c))
- **Asks:** a question's text, options and answer are Words, so showing them raw fails the build (#1763, part 2) ([#1784](https://github.com/kiwi-init/channels/pull/1784)) ([1c02230](https://github.com/kiwi-init/channels/commit/1c022305ebe6f356822d130db386fb736d0ba5e9))
- **Onboarding gate test:** who sees it and who never does (T5931) ([#1785](https://github.com/kiwi-init/channels/pull/1785)) ([5552f73](https://github.com/kiwi-init/channels/commit/5552f738627dbee565328cfe719889fc57450863))
- People lists you again, first, and your row opens your profile (T5960) ([#1786](https://github.com/kiwi-init/channels/pull/1786)) ([11750b0](https://github.com/kiwi-init/channels/commit/11750b096489299b787aeac016b369bde11fbceb))
- **Messages:** a message's text is Words, so showing it raw fails the build (#1763, part 3) ([#1787](https://github.com/kiwi-init/channels/pull/1787)) ([76e19fc](https://github.com/kiwi-init/channels/commit/76e19fc2b26ceb066ebb17a09aaaaba2be99409b))
- **Desktop:** the tray icon shows the unread count, from the same count as the taskbar badge (#1746) ([#1783](https://github.com/kiwi-init/channels/pull/1783)) ([0823ba4](https://github.com/kiwi-init/channels/commit/0823ba44516a14fd9c32f7b359a0a56f4374ea00))

## 2026.11.10 — 2026-11-05

Tag [v2026.11.10](https://github.com/kiwi-init/channels/releases/tag/v2026.11.10) · commit [23e425d](https://github.com/kiwi-init/channels/commit/23e425df6b6a6d5aca0f6a8537b45f33f8d6e459) · 2026-11-05

### Other changes

- **Docs:** the owner's app prunes stray doc ids and compacts done tasks' docs (T1430) ([#1730](https://github.com/kiwi-init/channels/pull/1730)) ([d185611](https://github.com/kiwi-init/channels/commit/d1856110ce1fd145028fbc7146aceb7fb51a7fb8))
- **Docs:** the relay keeps each doc's last 10 versions, at most one an hour (T4605) ([#1735](https://github.com/kiwi-init/channels/pull/1735)) ([d8f6da6](https://github.com/kiwi-init/channels/commit/d8f6da6482dddeb59315f4931cff72f7217ef058))
- **ui:** a busy doc keeps the caret where it is when an agent's message lands (T4486) ([#1734](https://github.com/kiwi-init/channels/pull/1734)) ([0ec5636](https://github.com/kiwi-init/channels/commit/0ec5636976b957df9944c01d4504ed431ff72e33))
- **CI:** Bun 1.4.4, whose spawnSync no longer spins forever after a GC (T4799) ([#1737](https://github.com/kiwi-init/channels/pull/1737)) ([e9b1311](https://github.com/kiwi-init/channels/commit/e9b1311b213c9b5816bad1cbd611738bc42033d2))
- **desktop/distros:** check a published release's AppImage, and kiwi:// links after an update and from Firefox (T4767) ([#1738](https://github.com/kiwi-init/channels/pull/1738)) ([3353666](https://github.com/kiwi-init/channels/commit/3353666f39acd8092330e78644329f9ed1df3491))
- **Desktop:** update checks start with the window, not after the keyring opens (T4874) ([#1739](https://github.com/kiwi-init/channels/pull/1739)) ([5909f35](https://github.com/kiwi-init/channels/commit/5909f35f88381223320eddf6149f1a8cb18f9556))
- **Docs:** restore an earlier version (T4606) ([#1736](https://github.com/kiwi-init/channels/pull/1736)) ([ec14603](https://github.com/kiwi-init/channels/commit/ec146036bc8c83e4dbee34b8e42d4bcac7f2e2fa))
- **Remove Calm:** the idle overlay, its video sky, its setting and its checks (T4942) ([#1740](https://github.com/kiwi-init/channels/pull/1740)) ([e0adaf3](https://github.com/kiwi-init/channels/commit/e0adaf3f67ccfbfd28d9f5439446a8719bbd1e2c))
- **Bring Calm back:** revert #1740 (T4982) ([#1741](https://github.com/kiwi-init/channels/pull/1741)) ([38c8bca](https://github.com/kiwi-init/channels/commit/38c8bca531ec0cfc2935c0f2bc3e6ee7203d7ae4))
- **Calm:** the loop plays in the packaged app, as a video/mp4 blob (T4983) ([#1742](https://github.com/kiwi-init/channels/pull/1742)) ([51d811d](https://github.com/kiwi-init/channels/commit/51d811de39c49b519ebcd49f83e2165546854953))
- **ui:** ⌘T / Ctrl+T toggles Calm (spec #5002) ([#1743](https://github.com/kiwi-init/channels/pull/1743)) ([058ed97](https://github.com/kiwi-init/channels/commit/058ed9752e35f4d695b440f5171bc60aa144965d))
- **test:** kp1's answer waits up to 30 s, as long as the rest of the test (T5174) ([#1748](https://github.com/kiwi-init/channels/pull/1748)) ([6616b21](https://github.com/kiwi-init/channels/commit/6616b216c5e3f4768aa7f4556f9e6fb27ab5bfea))
- **Linux:** a kiwi:// link raises the running window on Wayland (T5063) ([#1749](https://github.com/kiwi-init/channels/pull/1749)) ([b3e8a39](https://github.com/kiwi-init/channels/commit/b3e8a397968b288edf6338e267eaa81cdd030fd8))
- **release:** the macOS CLI build runs CI's watched mac tests, not a bare serial bun test (T5174) ([#1750](https://github.com/kiwi-init/channels/pull/1750)) ([4749295](https://github.com/kiwi-init/channels/commit/47492959e93e9bc42dc92244fe8503626613295a))
- **release:** CLI downloads may be 40 MB, as Bun 1.4.4's runtime grew 15 MB (T5174) ([#1751](https://github.com/kiwi-init/channels/pull/1751)) ([23e425d](https://github.com/kiwi-init/channels/commit/23e425df6b6a6d5aca0f6a8537b45f33f8d6e459))

## 2026.11.9 — 2026-11-05

Tag [v2026.11.9](https://github.com/kiwi-init/channels/releases/tag/v2026.11.9) · commit [dc8ec6b](https://github.com/kiwi-init/channels/commit/dc8ec6ba62001e0a7daf77f612dff3a5a0c96f62) · 2026-11-05

### Other changes

- **ui:** a reply read in an open thread is read in its DM or room too (T2395) ([#1683](https://github.com/kiwi-init/channels/pull/1683)) ([87dea2e](https://github.com/kiwi-init/channels/commit/87dea2eb07277cb06f7a2dd398c2ff826212eaa8))
- kiwi show prints a doc line's image once (T2732) ([#1687](https://github.com/kiwi-init/channels/pull/1687)) ([e5627ce](https://github.com/kiwi-init/channels/commit/e5627ce8a10078f5f24000a7f6ece0dd73aece64))
- **doc:** a draft belongs to the window typing it, not to the person (T1776) ([#1680](https://github.com/kiwi-init/channels/pull/1680)) ([493694a](https://github.com/kiwi-init/channels/commit/493694aef7a27d030631778d8818ef2c61fc9f5b))
- **doc:** an editor that edits a line it's behind on sends only its own edit (T1776) ([#1678](https://github.com/kiwi-init/channels/pull/1678)) ([2014ef2](https://github.com/kiwi-init/channels/commit/2014ef2d6b5fe90f3f5b85f4d4071a5e67c50705))
- **test:** a posted doc line keeps its reply count and receipt in the feed (T2038) ([#1688](https://github.com/kiwi-init/channels/pull/1688)) ([6e2573a](https://github.com/kiwi-init/channels/commit/6e2573a2757f714eec1c439d6039209fbacae315))
- **Doc:** an upgraded host takes no writes from a UI older than the doc (T2558) ([#1682](https://github.com/kiwi-init/channels/pull/1682)) ([b59e776](https://github.com/kiwi-init/channels/commit/b59e776f4b1dd47e1653bb55596bad67225bf81b))
- **doc:** Enter only breaks the line; Cmd/Ctrl+Enter sends (T2565) ([#1691](https://github.com/kiwi-init/channels/pull/1691)) ([22d00b4](https://github.com/kiwi-init/channels/commit/22d00b40f05aef1545ed8cb8138c512add4233ab))
- **Doc:** a redraw keeps your caret and selection in your own line (T1776) ([#1684](https://github.com/kiwi-init/channels/pull/1684)) ([b4fef23](https://github.com/kiwi-init/channels/commit/b4fef23025b5e304d8ee5be894cdc1e3757f0894))
- **Doc:** the guard writes lines by id, so no line takes over another (T1776) ([#1689](https://github.com/kiwi-init/channels/pull/1689)) ([e474404](https://github.com/kiwi-init/channels/commit/e47440420e4f61eef77685a80ae7b4442f811b67))
- **doc:** a pasted image goes out with the line it was pasted in (T1776) ([#1693](https://github.com/kiwi-init/channels/pull/1693)) ([27bb3b9](https://github.com/kiwi-init/channels/commit/27bb3b944c9138f98220d7ad4ced9e7dbe819565))
- **Doc:** a missed or late frame is fetched again, never skipped (T2998) ([#1694](https://github.com/kiwi-init/channels/pull/1694)) ([be14bb6](https://github.com/kiwi-init/channels/commit/be14bb6e9e11763e52d4aa19cd376b97f75a10aa))
- **ci:** the unit job's watchdog stops a bun that hangs after every file reported (T3093) ([#1696](https://github.com/kiwi-init/channels/pull/1696)) ([f1b65fb](https://github.com/kiwi-init/channels/commit/f1b65fb19b6ce5f4f99a586b2da8523014e0971e))
- **Doc:** an in-process doc pipe opens at the doc's write level (T3209) ([#1697](https://github.com/kiwi-init/channels/pull/1697)) ([f755dd2](https://github.com/kiwi-init/channels/commit/f755dd261161fc2f1d2aaf7b15b1b2a59f309804))
- **doc:** a remote edit landing between your keys keeps your caret and selection (T1776) ([#1695](https://github.com/kiwi-init/channels/pull/1695)) ([13d8dc7](https://github.com/kiwi-init/channels/commit/13d8dc779f99004a581a36747960db02a0c8dae0))
- **ui:** sending a doc line keeps the view where it was (T3282) ([#1698](https://github.com/kiwi-init/channels/pull/1698)) ([8269086](https://github.com/kiwi-init/channels/commit/8269086842759b6cea511e38110cf613c84bd0ac))
- **doc:** one empty line of yours on screen, not one per window you ever opened (T3317) ([#1699](https://github.com/kiwi-init/channels/pull/1699)) ([18572b5](https://github.com/kiwi-init/channels/commit/18572b532fcc88e551d765f7cf3d8f158b2a8a5a))
- **cli:** a doc wake queued while a listener tells is never lost (T3358) ([#1700](https://github.com/kiwi-init/channels/pull/1700)) ([052324b](https://github.com/kiwi-init/channels/commit/052324bced2e240afe362dc6489ce8b230f85d85))
- **ci:** the doc fuzzer runs on fixed seeds in build / bundles (T2559) ([#1690](https://github.com/kiwi-init/channels/pull/1690)) ([2443a72](https://github.com/kiwi-init/channels/commit/2443a7213e2470dd839a1dbfff0701bf17e882dc))
- **ui:** a sent line with an image keeps its place in the feed (T3445) ([#1704](https://github.com/kiwi-init/channels/pull/1704)) ([db64917](https://github.com/kiwi-init/channels/commit/db6491730997a05b0ac786cdb4cd16b30d52e3ad))
- Reap child processes before returning: kiwi query and the daemon-lock test (T3525) ([#1705](https://github.com/kiwi-init/channels/pull/1705)) ([cef737a](https://github.com/kiwi-init/channels/commit/cef737a5ea98b3ddc0d7df966792aa2073300f1f))
- **ci:** two people typing next to each other each write and send in their own line (T3318) ([#1703](https://github.com/kiwi-init/channels/pull/1703)) ([37389c8](https://github.com/kiwi-init/channels/commit/37389c8fe696b77b92e1d1acf82ee4c6038d3c2c))
- The notes room is made quietly: no row in #general (T3645) ([#1707](https://github.com/kiwi-init/channels/pull/1707)) ([2a98292](https://github.com/kiwi-init/channels/commit/2a982922d55703269bc96e8662493d833002839b))
- **shots:** the doc keys check walks the demo's two lines still in the doc (T3445) ([#1706](https://github.com/kiwi-init/channels/pull/1706)) ([97bff04](https://github.com/kiwi-init/channels/commit/97bff047c67c780187ba66a771db8a6d726d9c1b))
- **CI:** the doc fuzzer runs its seeds in WebKit too (T3726) ([#1708](https://github.com/kiwi-init/channels/pull/1708)) ([338d57a](https://github.com/kiwi-init/channels/commit/338d57abdcbc14b2138446e23bacd526977f8506))
- **CLI:** an agent gets images from a #general line in any of its docs (T3780) ([#1709](https://github.com/kiwi-init/channels/pull/1709)) ([d0247db](https://github.com/kiwi-init/channels/commit/d0247db15cf17835175f2d9268402ae85efd818e))
- **doc:** a reopened app never forks a thread's doc, and a forked one moves back (T3805) ([#1710](https://github.com/kiwi-init/channels/pull/1710)) ([70876e6](https://github.com/kiwi-init/channels/commit/70876e6a820455110fad9b3bfd5de9dc3b6f966d))
- **doc:** word select crosses into the next line on Linux; the doc key checks run engine-correct (T3618) ([#1711](https://github.com/kiwi-init/channels/pull/1711)) ([d5804b6](https://github.com/kiwi-init/channels/commit/d5804b6f44a7755dd9063df9eb97ebbd1b44adb7))
- Threads are one level deep, and agents know where to post (T3844) ([#1714](https://github.com/kiwi-init/channels/pull/1714)) ([436d9b2](https://github.com/kiwi-init/channels/commit/436d9b21ccae86928e8931b175be3f1531f7e072))
- The doc's / menu opens on screen and keeps its rows inside its box (T3783) ([#1712](https://github.com/kiwi-init/channels/pull/1712)) ([c952e3e](https://github.com/kiwi-init/channels/commit/c952e3e97688d4999784bc03e10e90dd58968ed1))
- **ui:** thread updates move to a floating panel (T3766) ([#1715](https://github.com/kiwi-init/channels/pull/1715)) ([e4e7744](https://github.com/kiwi-init/channels/commit/e4e77443240d9306605528d90dfab631394975f7))
- At the bottom, the view follows an agent's lines right after you send (T3644) ([#1716](https://github.com/kiwi-init/channels/pull/1716)) ([3b1aebd](https://github.com/kiwi-init/channels/commit/3b1aebd328df61c25f9c756f0b4d449441aec061))
- **ui:** doc lines keep their height as they scroll into view (T3583) ([#1713](https://github.com/kiwi-init/channels/pull/1713)) ([d880383](https://github.com/kiwi-init/channels/commit/d8803833442a6890fb37e1b8d1e21c4e719944be))
- The MCP abort test reads only stored cursors, not a write in flight (T4114) ([#1719](https://github.com/kiwi-init/channels/pull/1719)) ([b6b6cc7](https://github.com/kiwi-init/channels/commit/b6b6cc769f758e60fceffaf1474954d543855b62))
- **scripts:** the app smoke finds the task's update in the Updates panel (T3766) ([#1718](https://github.com/kiwi-init/channels/pull/1718)) ([a709716](https://github.com/kiwi-init/channels/commit/a7097169fcd90b2d5a66a61a5a5553adc6ecd80b))
- Agents write markdown a person reads at a glance; a line after a list is its own paragraph (T4145) ([#1720](https://github.com/kiwi-init/channels/pull/1720)) ([9a3736a](https://github.com/kiwi-init/channels/commit/9a3736a6d38ac8e8fd50662750aa817e60459240))
- **ui:** the top bar's sidebar, channel and search buttons look like the Settings gear (T4165) ([#1721](https://github.com/kiwi-init/channels/pull/1721)) ([b9c11c8](https://github.com/kiwi-init/channels/commit/b9c11c81c0b5b04b1456140b68a66e15db941d66))
- **CI:** cut low-signal tests, no job over 6 minutes (T3925) ([#1717](https://github.com/kiwi-init/channels/pull/1717)) ([2c56606](https://github.com/kiwi-init/channels/commit/2c566066b28a2dc009d17e5eb0a3011d579eb0ab))
- The brief's markdown line fits, so a lead's checkpoint shows again (T4145) ([#1723](https://github.com/kiwi-init/channels/pull/1723)) ([26df096](https://github.com/kiwi-init/channels/commit/26df096b9f38f1045f709f203f1a1c3c00e10e4b))
- **Rooms are flat:** a reply shows inline with its quote, and nothing opens a thread (T4143) ([#1722](https://github.com/kiwi-init/channels/pull/1722)) ([e1a6040](https://github.com/kiwi-init/channels/commit/e1a6040dc1d7c6ebb00b9c1c7cf58de73e0354d0))
- **Tests:** delete 41 low-signal unit tests and the dead code only they used (T4105) ([#1725](https://github.com/kiwi-init/channels/pull/1725)) ([deaee12](https://github.com/kiwi-init/channels/commit/deaee12d2b06677603c532c3d3b9c8b8de5a725b))
- Joins finish on WebKit: the join nonce is an HMAC, not a signature (T3555) ([#1727](https://github.com/kiwi-init/channels/pull/1727)) ([f980baa](https://github.com/kiwi-init/channels/commit/f980baa68cb9f2c5beae0f27425f54736b6c3c76))
- **ui:** an edited message keeps its text on screen while the edit parses (T4255) ([#1726](https://github.com/kiwi-init/channels/pull/1726)) ([f353f0d](https://github.com/kiwi-init/channels/commit/f353f0d0b9507a55d7617f425f6fe0ceca89916b))
- **ui:** Calm, an idle overlay over every channel (T4205) ([#1728](https://github.com/kiwi-init/channels/pull/1728)) ([1574049](https://github.com/kiwi-init/channels/commit/157404963cebaa01a22d695dc25d8750cedc1ee0))
- **Linux:** a kiwi://join link that starts the app opens its join (T4442) ([#1729](https://github.com/kiwi-init/channels/pull/1729)) ([363958f](https://github.com/kiwi-init/channels/commit/363958fd9a4ea4c2fde4bc1831febbf15269a9c7))
- **Calm:** Jow's idle loop as the sky, bundled with the app (T4204) ([#1724](https://github.com/kiwi-init/channels/pull/1724)) ([4215a6a](https://github.com/kiwi-init/channels/commit/4215a6a2c52bd1f2e94f0e67da64b5cb6c184c34))
- **Linux:** the link in the launch arguments is read from /proc/self/cmdline (T4442) ([#1731](https://github.com/kiwi-init/channels/pull/1731)) ([774296a](https://github.com/kiwi-init/channels/commit/774296af6d566b977572942161015b6007544c29))
- **Gate:** the resize check measures what ResizeObserver sees, not transforms (T4623) ([#1732](https://github.com/kiwi-init/channels/pull/1732)) ([b800f85](https://github.com/kiwi-init/channels/commit/b800f85c3c5176f165873705ed086e9704cfb5dd))

## 2026.11.8 — 2026-11-04

Tag [v2026.11.8](https://github.com/kiwi-init/channels/releases/tag/v2026.11.8) · commit [25f4a5e](https://github.com/kiwi-init/channels/commit/25f4a5e493c2cc2d16734e09c0281a1cf7c99658) · 2026-11-04

### Other changes

- **core:** drop the unused FINISH_IDLE_MS left by Enter-only send (T1109) ([#1592](https://github.com/kiwi-init/channels/pull/1592)) ([b935eb0](https://github.com/kiwi-init/channels/commit/b935eb064d0d0e25863b2075f7763e4d69e214ba))
- **doc:** on Wayland, a pasted image and a dropped file reach the thread doc ([#1594](https://github.com/kiwi-init/channels/pull/1594)) ([35e66b1](https://github.com/kiwi-init/channels/commit/35e66b13d7bf28feafae40930b8bb252f33001d9))
- **doc:** Backspace and Delete join your blocks like paragraphs; the keyboard across blocks is checked in WebKit ([#1593](https://github.com/kiwi-init/channels/pull/1593)) ([28a1afc](https://github.com/kiwi-init/channels/commit/28a1afcc9562fa4ef132a62c9b3995c413f200df))
- **ui:** links in the thread doc open in the browser (T944) ([#1590](https://github.com/kiwi-init/channels/pull/1590)) ([234dbd1](https://github.com/kiwi-init/channels/commit/234dbd1818c8a1c5eeff5cbe123193405d2cb61f))
- **docs:** self-hosting signs in with your GitHub App, not WorkOS (T216, #152 part 2) ([#1595](https://github.com/kiwi-init/channels/pull/1595)) ([585019f](https://github.com/kiwi-init/channels/commit/585019f64fab35e484a952343d98ae6fd3d86442))
- **test:** spawn-heavy unit tests wait on a ready signal, not a wall clock (T1043) ([#1596](https://github.com/kiwi-init/channels/pull/1596)) ([695b384](https://github.com/kiwi-init/channels/commit/695b384651eeb1a5b39b41b72493d27feb1b859e))
- **ui:** a file dropped over the thread doc lands in it, like the composer's did (T946) ([#1597](https://github.com/kiwi-init/channels/pull/1597)) ([3318c6c](https://github.com/kiwi-init/channels/commit/3318c6c466b0a50cd0ef620786872dbc791938cf))
- **ui:** a posted doc line sits in the feed in time order, only drafts stay in the doc (T1236) ([#1598](https://github.com/kiwi-init/channels/pull/1598)) ([effffc7](https://github.com/kiwi-init/channels/commit/effffc7e628aaac125a627f254752fd7dd9da6af))
- **ui:** a scroll trace in the palette, and a stays-still check in build / shots (T1166) ([#1599](https://github.com/kiwi-init/channels/pull/1599)) ([f941ff5](https://github.com/kiwi-init/channels/commit/f941ff58d1e23201ea0de83693a974a3751daae0))
- **doc:** Enter marks your block sent, so everyone sees anyone's unsent line faded (T1269) ([#1600](https://github.com/kiwi-init/channels/pull/1600)) ([bfae100](https://github.com/kiwi-init/channels/commit/bfae100a03ef511f0929106a3c4c895f0feac3dc))
- **doc:** an agent's ask is a block in the thread doc, with its buttons under it (T1257) ([#1601](https://github.com/kiwi-init/channels/pull/1601)) ([956c8a2](https://github.com/kiwi-init/channels/commit/956c8a23caf5bd3eedee842f04d79e626c7bee97))
- Nameless group rooms stop appearing in Rooms (T1299) ([#1602](https://github.com/kiwi-init/channels/pull/1602)) ([ff4c9e2](https://github.com/kiwi-init/channels/commit/ff4c9e2639dcf5ea824cfd0bbd371745b44695fa))
- Asks stay plain messages, so 2026.11.7 desktops and phones keep seeing them (T1354) ([#1603](https://github.com/kiwi-init/channels/pull/1603)) ([8fa29f0](https://github.com/kiwi-init/channels/commit/8fa29f04e1296d85b8b84876e2a5b19dad82fbab))
- **ui:** format self-room.test.ts (main's repo / static) ([#1604](https://github.com/kiwi-init/channels/pull/1604)) ([2574271](https://github.com/kiwi-init/channels/commit/2574271acc533a2b0466268a6930e3fd41e72f38))
- **doc:** one failed step no longer stops a thread doc, and an update it can't open yet is fetched again, never snapshotted over (T1355) ([#1605](https://github.com/kiwi-init/channels/pull/1605)) ([74119dd](https://github.com/kiwi-init/channels/commit/74119dde53ad78486518d2b1d58ca0c37e5d61ac))
- **doc:** a refused send comes back as your draft block, not into a composer that's gone (T1401) ([#1606](https://github.com/kiwi-init/channels/pull/1606)) ([0ec2e88](https://github.com/kiwi-init/channels/commit/0ec2e8862c1eecef1a113ee159c6856f3a63f757))
- **ui:** actions.send says whether the channel took it, so the doc's Enter stops crashing on .then of void (T1401) ([#1608](https://github.com/kiwi-init/channels/pull/1608)) ([c7edd1e](https://github.com/kiwi-init/channels/commit/c7edd1e3822bb4b1d2378249854cc8c243663359))
- Agents' doc lines reach phones: kiwi send posts its message too (T1354) ([#1607](https://github.com/kiwi-init/channels/pull/1607)) ([55fc239](https://github.com/kiwi-init/channels/commit/55fc23914886257e890338d647f0390aa9bb7b13))
- **doc:** an update too big for the relay goes out in a snapshot (T1425) ([#1609](https://github.com/kiwi-init/channels/pull/1609)) ([7a88cd3](https://github.com/kiwi-init/channels/commit/7a88cd37cb851ffb8616585c83a6a6f569b62d58))
- **smoke:** a posted block shows once, in the feed, and not in the doc (T1236) ([#1611](https://github.com/kiwi-init/channels/pull/1611)) ([a771ad4](https://github.com/kiwi-init/channels/commit/a771ad4a33c7f9c183f6d4f0867f82d331e5b469))
- **doc:** a new socket takes over each doc's subscription, so losing the old one doesn't stop the doc (T1444) ([#1610](https://github.com/kiwi-init/channels/pull/1610)) ([f55d069](https://github.com/kiwi-init/channels/commit/f55d0697863aeb11150d789a0705164c28820700))
- **ui:** old doc lines join the feed in time order; posted lines keep formatting (T1354, T1463) ([#1612](https://github.com/kiwi-init/channels/pull/1612)) ([069ee6f](https://github.com/kiwi-init/channels/commit/069ee6f06734259d16ef35741e20ca3a3ce017c1))
- **doc:** offline edits in the app survive a restart, kept sealed to the seat (T1446) ([#1613](https://github.com/kiwi-init/channels/pull/1613)) ([adbfe6f](https://github.com/kiwi-init/channels/commit/adbfe6fb958ed39620a0d5c5132afbfc9d5487d2))
- **cli:** replies and image/file posts write their doc block too (T1256) ([#1615](https://github.com/kiwi-init/channels/pull/1615)) ([ee573b4](https://github.com/kiwi-init/channels/commit/ee573b40543853a4268ef7c59527909f001a0d90))
- One own room per person: later devices use it, partial views never make another (T1477, T1478) ([#1616](https://github.com/kiwi-init/channels/pull/1616)) ([cc3b40f](https://github.com/kiwi-init/channels/commit/cc3b40fee9482d6f95875761cc8ae9060b58ed51))
- **doc:** Reply and Quote in task threads land on your draft block (T1402) ([#1617](https://github.com/kiwi-init/channels/pull/1617)) ([5201309](https://github.com/kiwi-init/channels/commit/52013095185689219fb6090e7b3eb52483b42a2e))
- **doc:** retrying a failed doc line keeps its block, so the line shows once (T1465) ([#1614](https://github.com/kiwi-init/channels/pull/1614)) ([e69f67e](https://github.com/kiwi-init/channels/commit/e69f67e41dad1a76f23fc6a3403f1cf19dda1a80))
- **relay:** a null frame gets bad json back, and a closing sender's reply can't stop its update reaching followers (T1429) ([#1619](https://github.com/kiwi-init/channels/pull/1619)) ([d97d9ee](https://github.com/kiwi-init/channels/commit/d97d9ee52824357726752a912cb95937f585882a))
- **doc:** lines post on Enter only, never lost, never early (T1464) ([#1618](https://github.com/kiwi-init/channels/pull/1618)) ([e6b52b7](https://github.com/kiwi-init/channels/commit/e6b52b71292c6d1790b35e18518e4e1abaeff123))
- Two quick first DMs to someone share one DM room (T1479) ([#1620](https://github.com/kiwi-init/channels/pull/1620)) ([d84fb01](https://github.com/kiwi-init/channels/commit/d84fb012c918dbe125c4a5258179b75751661794))
- **doc:** a refused snapshot backs off instead of looping (T1426) ([#1621](https://github.com/kiwi-init/channels/pull/1621)) ([70c2560](https://github.com/kiwi-init/channels/commit/70c25604a65c808d7c4386ed9f202bf499ed3fb8))
- **desktop:** first device syncs at once share one sync, so the app makes one device key (T1480) ([#1622](https://github.com/kiwi-init/channels/pull/1622)) ([3aacb9a](https://github.com/kiwi-init/channels/commit/3aacb9a7b5f07a25eaa4f84a464274ee279cd012))
- **doc:** a refused doc subscribe is tried again, so the doc syncs (T1427) ([#1623](https://github.com/kiwi-init/channels/pull/1623)) ([c5bbeb2](https://github.com/kiwi-init/channels/commit/c5bbeb2e50af05216c4e0b37091703fcee3b047f))
- **doc:** Back to draft on a failed doc line gives its block back, so it can be sent again (T1606) ([#1624](https://github.com/kiwi-init/channels/pull/1624)) ([3a2801d](https://github.com/kiwi-init/channels/commit/3a2801d92ab75f2cf32a7ec860294e1f6394841a))
- **doc:** slash commands run from the thread doc again (T1408) ([#1626](https://github.com/kiwi-init/channels/pull/1626)) ([95deab4](https://github.com/kiwi-init/channels/commit/95deab4dc8611c228fa831c8e289843a3da69c4c))
- **doc:** a refused send leaves no block, and edit/delete reach the block (T1353) ([#1627](https://github.com/kiwi-init/channels/pull/1627)) ([ad40e8f](https://github.com/kiwi-init/channels/commit/ad40e8f5bae12f044baad44329c21d9ad064cc0a))
- **ui:** a feed stuck to the bottom no longer trims and regrows its rows in a loop (T1166) ([#1628](https://github.com/kiwi-init/channels/pull/1628)) ([7a83b60](https://github.com/kiwi-init/channels/commit/7a83b6014352d7ae2f1f1732181a456a821eb57b))
- **doc:** ↑ edits your last line, a too-long line stays a draft, and drops show an overlay (T1418) ([#1629](https://github.com/kiwi-init/channels/pull/1629)) ([6ec9ae7](https://github.com/kiwi-init/channels/commit/6ec9ae7d1eb74906f0a304512e4d371f20817232))
- **doc:** Back to draft keeps the line in the doc, so it's never resent (T1678) ([#1631](https://github.com/kiwi-init/channels/pull/1631)) ([6deeaf6](https://github.com/kiwi-init/channels/commit/6deeaf632919c5bfc9218240454a361ce365776a))
- **doc:** MCP send and reply write their line into the shared doc (T1353) ([#1632](https://github.com/kiwi-init/channels/pull/1632)) ([1942da7](https://github.com/kiwi-init/channels/commit/1942da709c04c9210283ccb2eac12fba280bb966))
- **doc:** the suggested answer command quotes '#general' so a shell keeps it (T1353) ([#1633](https://github.com/kiwi-init/channels/pull/1633)) ([45c9521](https://github.com/kiwi-init/channels/commit/45c952186bea255b616c84781f789e7448935049))
- **doc:** kiwi log's doc part shows only finished lines (T1353) ([#1635](https://github.com/kiwi-init/channels/pull/1635)) ([9b6ce05](https://github.com/kiwi-init/channels/commit/9b6ce0583e4e753a6ee961e3c17067715479c62a))
- **Daemon doc wakes:** remember handled lines by id, not max(at) (T1741) ([#1636](https://github.com/kiwi-init/channels/pull/1636)) ([4910f0e](https://github.com/kiwi-init/channels/commit/4910f0e7f98f04c6ff7bd69a60ac8d688f5498e8))
- kiwi wait/tail hand over doc-only lines; doc-only hook heads drop "reply N" (T1741) ([#1638](https://github.com/kiwi-init/channels/pull/1638)) ([4e42ee8](https://github.com/kiwi-init/channels/commit/4e42ee82a39111374a3ab88c5fd2810662fbbe6a))
- **doc:** a send into a doc names only members up front, and keeps the long note (T1353) ([#1637](https://github.com/kiwi-init/channels/pull/1637)) ([6478e28](https://github.com/kiwi-init/channels/commit/6478e2877dae901c46fcd78a4520a47cb56d25e1))
- **Daemon doc wakes:** every line in a task doc wakes the people working it (T1741) ([#1641](https://github.com/kiwi-init/channels/pull/1641)) ([51d0fa0](https://github.com/kiwi-init/channels/commit/51d0fa057395a5fc0c7a33a642701938b54e7c9c))
- A quoted @mention wakes nobody, as a message or a doc line (T1741) ([#1644](https://github.com/kiwi-init/channels/pull/1644)) ([5324d79](https://github.com/kiwi-init/channels/commit/5324d794312be40fcdc5c4395081415a5ea86bec))
- **Test:** kiwi tail's doc-line test waits on what tail printed (T1741) ([#1646](https://github.com/kiwi-init/channels/pull/1646)) ([e376983](https://github.com/kiwi-init/channels/commit/e3769839ead7e353c1e786d73e3784dfe8a8dbcf))
- **Doc cursors:** a closed doc takes its cursor with it, sealed with the room's key (T1734) ([#1648](https://github.com/kiwi-init/channels/pull/1648)) ([78c87c3](https://github.com/kiwi-init/channels/commit/78c87c3f08f7c8a0b3d58ee61051e6166b411a13))
- **Doc wakes:** "before it" is the last finished line, never a draft (T1741) ([#1642](https://github.com/kiwi-init/channels/pull/1642)) ([56809cf](https://github.com/kiwi-init/channels/commit/56809cfb0a79082c1956950f286df0c7223cf5c7))
- **Doc sync:** a reconnect no longer stores an edit twice (T1734) ([#1649](https://github.com/kiwi-init/channels/pull/1649)) ([fcecfb8](https://github.com/kiwi-init/channels/commit/fcecfb8259318fb9d6064a5fd196d0aa8ea36a36))
- **app:** edit and delete reach the message's block in the doc (T1742) ([#1634](https://github.com/kiwi-init/channels/pull/1634)) ([0a18e05](https://github.com/kiwi-init/channels/commit/0a18e05bcaf1e4f8dfc3aa51919ec27268c44c07))
- **ui:** scrolling up a feed of event runs keeps loading to the top (T1687) ([#1643](https://github.com/kiwi-init/channels/pull/1643)) ([49c2e31](https://github.com/kiwi-init/channels/commit/49c2e3136248248147716d8279f6279201e72200))
- ui-doc-keys checks the caret across the blocks you can see (T1520) ([#1653](https://github.com/kiwi-init/channels/pull/1653)) ([8898ab4](https://github.com/kiwi-init/channels/commit/8898ab430651a396b052ac60a831e6f29f9d8f51))
- **ui:** Trace typing, behind a Debug options switch that is off by default (T1776) ([#1651](https://github.com/kiwi-init/channels/pull/1651)) ([e9c1b31](https://github.com/kiwi-init/channels/commit/e9c1b311303b6a885f79ac10f393de529984d49a))
- **ui:** a thread doc never scrolls on its own (T1836) ([#1652](https://github.com/kiwi-init/channels/pull/1652)) ([afa3504](https://github.com/kiwi-init/channels/commit/afa3504a3fb3efeda5e333655678d8d1681aedc0))
- An unknown or incomplete CLI flag is one line and exit 2, not a crash (T1894) ([#1654](https://github.com/kiwi-init/channels/pull/1654)) ([bb143d7](https://github.com/kiwi-init/channels/commit/bb143d7e541171e7a610719ffce8f1f14f882cbf))
- **brief:** text with backticks or $ goes in on stdin or from a file (#1576) ([#1657](https://github.com/kiwi-init/channels/pull/1657)) ([c651890](https://github.com/kiwi-init/channels/commit/c6518908570eb5bd385f9a335e5aa3cd35a2bc4b))
- **cli:** kiwi note takes its value from --file or stdin (T2030) ([#1656](https://github.com/kiwi-init/channels/pull/1656)) ([fc6b3ab](https://github.com/kiwi-init/channels/commit/fc6b3abdee9ab8aa3f9319520806ad42d6f07f5d))
- **ui:** a streamed line posting at the bottom of a doc no longer moves the view (T1931) ([#1655](https://github.com/kiwi-init/channels/pull/1655)) ([da74990](https://github.com/kiwi-init/channels/commit/da749904568a996a1166b1409f9247c62ca74bc6))
- **daemon:** a wake runs the harness binary its seat pinned, never a later one on PATH (T2031) ([#1659](https://github.com/kiwi-init/channels/pull/1659)) ([8357cf0](https://github.com/kiwi-init/channels/commit/8357cf09afb9887bfac516ebf5f70dd14d673a18))
- **ui:** the spec page uses a wide window, and its comment box grows in place (T2034) ([#1661](https://github.com/kiwi-init/channels/pull/1661)) ([7097299](https://github.com/kiwi-init/channels/commit/7097299a21d283a7a312f4e396f59145a6b0cefc))
- **doc:** an edit changes only the part of the line it changed, and never a draft (T2105, T1776) ([#1660](https://github.com/kiwi-init/channels/pull/1660)) ([702e442](https://github.com/kiwi-init/channels/commit/702e442e3d631968090e1018916d7e41c01d257c))
- **doc:** a copy only tidies the empty lines it made, so another copy's typing is never erased (T1776) ([#1650](https://github.com/kiwi-init/channels/pull/1650)) ([66db554](https://github.com/kiwi-init/channels/commit/66db5545abdca3506118add76eb8f84b0627ddff))
- An automatic ack under your message: who is on it (T2035) ([#1658](https://github.com/kiwi-init/channels/pull/1658)) ([872ba40](https://github.com/kiwi-init/channels/commit/872ba403b078314bf23ead105ad78bcacf7c282d))
- **Trace typing:** compare the editor's line with the doc's on every change (T1776) ([#1663](https://github.com/kiwi-init/channels/pull/1663)) ([9a900a8](https://github.com/kiwi-init/channels/commit/9a900a8e70e6b6964e8cc1d75e9ae6316c0c84da))
- **ui:** a closed ask keeps its card, saying who closed it and why (T2032) ([#1662](https://github.com/kiwi-init/channels/pull/1662)) ([99f55e3](https://github.com/kiwi-init/channels/commit/99f55e3ecd37a6295316d0ae4c74738bab504652))
- **doc:** tests that the daemon's writers never bring back an author's deleted letters (T1776) ([#1664](https://github.com/kiwi-init/channels/pull/1664)) ([fecf5b5](https://github.com/kiwi-init/channels/commit/fecf5b5a051cbe0d44fb6ae2de3d13d34753778e))
- **doc:** a snapshot never covers an update its client couldn't open (T1776) ([#1668](https://github.com/kiwi-init/channels/pull/1668)) ([7e67361](https://github.com/kiwi-init/channels/commit/7e673614607ec4ab33ff59afb3fca994bb84a592))
- **seats:** a session outside the folder it joined in keeps its seat (T2041) ([#1666](https://github.com/kiwi-init/channels/pull/1666)) ([703e7e9](https://github.com/kiwi-init/channels/commit/703e7e99742115bdf36bcab7b3b6dd0df789a109))
- **doc:** a line's text keeps the < and > that were typed (T2141) ([#1669](https://github.com/kiwi-init/channels/pull/1669)) ([24e1d8b](https://github.com/kiwi-init/channels/commit/24e1d8bb6607735bc9c2aefcbeeae94c511774fb))
- **asks:** agents see each other's open asks to a person, so a decision is asked once (T2042) ([#1670](https://github.com/kiwi-init/channels/pull/1670)) ([2e57245](https://github.com/kiwi-init/channels/commit/2e5724595d46340d656c63ae92906bfbdefd45a4))
- Images pasted in a doc reach agents: show and save fetch them (T2037) ([#1672](https://github.com/kiwi-init/channels/pull/1672)) ([7c41d38](https://github.com/kiwi-init/channels/commit/7c41d38bbe329ad56411d68c3b5b4ea98686fe1a))
- **doc:** an editor writes only the lines it changed, so a peer out of step can't erase yours (T1776) ([#1667](https://github.com/kiwi-init/channels/pull/1667)) ([a2f1fa7](https://github.com/kiwi-init/channels/commit/a2f1fa7e3c38b59200aa39ddc5cffcf2112703e4))
- **doc:** an editor that missed a change to a line it drew redraws it (T1776) ([#1675](https://github.com/kiwi-init/channels/pull/1675)) ([cd8628a](https://github.com/kiwi-init/channels/commit/cd8628a95f485f57369197e3c0fc14ed52d01a8b))
- **doc:** your other window's empty line never ends the line you're typing (T2106, T1776) ([#1674](https://github.com/kiwi-init/channels/pull/1674)) ([ff8e659](https://github.com/kiwi-init/channels/commit/ff8e65992e4a32200d25cce14db35184c204f5b1))
- Agents call the channel's goal what the app calls it (T2394) ([#1677](https://github.com/kiwi-init/channels/pull/1677)) ([8501df6](https://github.com/kiwi-init/channels/commit/8501df6915a7ab431f29186ff48c33451e9b40a5))
- Settings › About names the interface that's running (T2382) ([#1679](https://github.com/kiwi-init/channels/pull/1679)) ([4ecce71](https://github.com/kiwi-init/channels/commit/4ecce71836e58d9f391a06bab1b312801f47183b))
- **specs:** the approve card reaches the person only once the spec is marked ready (T2033) ([#1673](https://github.com/kiwi-init/channels/pull/1673)) ([8c3b649](https://github.com/kiwi-init/channels/commit/8c3b649142847ef2bff50c37ff2f32237d963858))

## 2026.11.7 — 2026-11-04

Tag [v2026.11.7](https://github.com/kiwi-init/channels/releases/tag/v2026.11.7) · commit [fd3aa07](https://github.com/kiwi-init/channels/commit/fd3aa075924102c418525f0cd53f7d3bebd16b06) · 2026-11-04

### Other changes

- **changelog:** 2026.11.6 lists the four PRs merged after its stamp ([#1582](https://github.com/kiwi-init/channels/pull/1582)) ([5c407cd](https://github.com/kiwi-init/channels/commit/5c407cd3d031fec2ef08d6cd47c32a5a627ea161))
- **scripts:** smoke, perf and shot checks type in the thread doc (T791) ([#1584](https://github.com/kiwi-init/channels/pull/1584)) ([d7d5c01](https://github.com/kiwi-init/channels/commit/d7d5c01fb8db859b34a314301fcbd61046b72d63))
- **ci:** the UI channel ships only what main's full CI passed (T904) ([#1585](https://github.com/kiwi-init/channels/pull/1585)) ([103494c](https://github.com/kiwi-init/channels/commit/103494cf13c2004c00fb52be829f66c91905b901))
- **core:** a doc block wakes an agent only once its author sends it ([#1587](https://github.com/kiwi-init/channels/pull/1587)) ([1c27d70](https://github.com/kiwi-init/channels/commit/1c27d704395c6bd2487e293ed9c988d7a8dd314f))
- **test:** local-perms loads home() fresh in-process, not in three bun children (T1025) ([#1589](https://github.com/kiwi-init/channels/pull/1589)) ([c2d05ed](https://github.com/kiwi-init/channels/commit/c2d05ed290b8a214c4120f462c5ec182ee4c5cbc))
- **doc:** images and files in a thread doc, by blob (T580) ([#1583](https://github.com/kiwi-init/channels/pull/1583)) ([91180f8](https://github.com/kiwi-init/channels/commit/91180f83dc34b103afc93540714b7109960c9e2a))
- **ui:** the thread doc reads like one page; drafts fade until Enter (T878) ([#1586](https://github.com/kiwi-init/channels/pull/1586)) ([87a5e0a](https://github.com/kiwi-init/channels/commit/87a5e0a86ffd80c9ffc2df1d0a6d621eafefd251))
- **desktop checks:** write in the thread doc, not the removed composer (T791) ([#1588](https://github.com/kiwi-init/channels/pull/1588)) ([ec83248](https://github.com/kiwi-init/channels/commit/ec832487c9f55616aa4ef847f5ad31a284c92c3a))

## 2026.11.6 — 2026-11-04

Tag [v2026.11.6](https://github.com/kiwi-init/channels/releases/tag/v2026.11.6) · commit [efffed2](https://github.com/kiwi-init/channels/commit/efffed29c286a5c5ab1739a57da7dc8db6a21a49) · 2026-11-04

### Other changes

- **ui:** an agent in the sidebar is one row: face, name, what it does now ([#1559](https://github.com/kiwi-init/channels/pull/1559)) ([d380343](https://github.com/kiwi-init/channels/commit/d380343d6e7b3187abe4e8f63648c36428c6bba6))
- **relay:** store and relay sealed Yjs doc updates per thread ([#1561](https://github.com/kiwi-init/channels/pull/1561)) ([1a0caf0](https://github.com/kiwi-init/channels/commit/1a0caf02224cb9398df145ef52659b8f1dc0e4a4))
- **core:** a thread's Yjs doc syncs as sealed updates over the channel socket ([#1560](https://github.com/kiwi-init/channels/pull/1560)) ([9e5b5cf](https://github.com/kiwi-init/channels/commit/9e5b5cf101de286bc8d79f79cd201307dc351d72))
- **ui:** a thread can be one shared editor, no composer (T499) ([#1562](https://github.com/kiwi-init/channels/pull/1562)) ([3a3f50d](https://github.com/kiwi-init/channels/commit/3a3f50dbf7d28c65316a5ad4d093408efcc5e89f))
- **core:** an agent wakes for a finished block and streams into its own ([#1563](https://github.com/kiwi-init/channels/pull/1563)) ([3ee67ea](https://github.com/kiwi-init/channels/commit/3ee67ea9ad025f0aa9413a4982d197c6bda77ad3))
- **core:** thread docs ride the channel's live socket ([#1564](https://github.com/kiwi-init/channels/pull/1564)) ([bf731f5](https://github.com/kiwi-init/channels/commit/bf731f56995934549ba0153b79738cebb60ca65b))
- **core:** docs of members-only rooms and DMs are sealed with the room's key ([#1566](https://github.com/kiwi-init/channels/pull/1566)) ([d30a381](https://github.com/kiwi-init/channels/commit/d30a381eb8d464f8e489a744f8e8b74939a8307e))
- **ui:** the thread doc feels right to type in (T561) ([#1567](https://github.com/kiwi-init/channels/pull/1567)) ([a25d49f](https://github.com/kiwi-init/channels/commit/a25d49f58f00c6cb2ea1483d7d23bbdc7772a6ea))
- **ui:** the editor runs on the channel's live doc; the switch goes (T597) ([#1570](https://github.com/kiwi-init/channels/pull/1570)) ([a9b9012](https://github.com/kiwi-init/channels/commit/a9b90120d78201b660da12500f41d87365bd44d7))
- **cli:** kiwi send writes a block into a thread's shared doc; show and log read it ([#1565](https://github.com/kiwi-init/channels/pull/1565)) ([59139f8](https://github.com/kiwi-init/channels/commit/59139f8703011f4190e509ca7bcee9c3a8573ecc))
- **daemon:** wake an agent for a finished block in its doc threads ([#1568](https://github.com/kiwi-init/channels/pull/1568)) ([edb383b](https://github.com/kiwi-init/channels/commit/edb383b08f53e6481e3a4f241048811f673f90a2))
- **mcp and loop:** doc wakes reach agents without hooks ([#1569](https://github.com/kiwi-init/channels/pull/1569)) ([f2269ed](https://github.com/kiwi-init/channels/commit/f2269edea051c587838fcd082d70d29c22d0c140))
- **hooks:** a doc wake is told only once its hand-over lands ([#1571](https://github.com/kiwi-init/channels/pull/1571)) ([12d3477](https://github.com/kiwi-init/channels/commit/12d34770e5b67836a2b27ff127167c47fffcde8b))
- **core, ui:** members-only rooms and DMs are docs (T693) ([#1573](https://github.com/kiwi-init/channels/pull/1573)) ([dd6c57e](https://github.com/kiwi-init/channels/commit/dd6c57efcca94165e8bf1d3c8ce8d6ce774d3c13))
- **app:** a person's finished doc block posts as their message (T791) ([#1581](https://github.com/kiwi-init/channels/pull/1581)) ([ab4e1dc](https://github.com/kiwi-init/channels/commit/ab4e1dc8b37b31ff60746b82cb838ba09587ca83))
- **daemon:** follow docs only for a seat something can wake (T606) ([#1574](https://github.com/kiwi-init/channels/pull/1574)) ([efffed2](https://github.com/kiwi-init/channels/commit/efffed29c286a5c5ab1739a57da7dc8db6a21a49))

## 2026.11.5 — 2026-11-04

Tag [v2026.11.5](https://github.com/kiwi-init/channels/releases/tag/v2026.11.5) · commit [c18bf36](https://github.com/kiwi-init/channels/commit/c18bf366ee9f2f61fb9f353087fd4b7fc7daae2a) · 2026-11-04

### Other changes

- A spec on a reply takes its own tasks (T320) ([#1552](https://github.com/kiwi-init/channels/pull/1552)) ([28c83d8](https://github.com/kiwi-init/channels/commit/28c83d8fc2187dfd6dce4fa2e783c40935994b06))
- **Wake:** an idle agy (or Gemini) in its own tmux pane is woken by typing into it (T773) ([#1537](https://github.com/kiwi-init/channels/pull/1537)) ([b64ed49](https://github.com/kiwi-init/channels/commit/b64ed49062765e43e2aa37f42835c516e4fb6066))
- Remove the retired features (#152 part 1, T215) ([#1553](https://github.com/kiwi-init/channels/pull/1553)) ([760f8cd](https://github.com/kiwi-init/channels/commit/760f8cdf81aec14d15ab91c2140470d49eaca555))
- **ui:** a working agent speaks in the sidebar: its task, what it runs now, how long ([#1555](https://github.com/kiwi-init/channels/pull/1555)) ([257b8e8](https://github.com/kiwi-init/channels/commit/257b8e8fcff8ac415df242d0c40b381e226a2a90))
- Select part of a message to quote it in a reply ([#1556](https://github.com/kiwi-init/channels/pull/1556)) ([b971248](https://github.com/kiwi-init/channels/commit/b971248ffa52651dabce2a92b190e75f7a6fadef))
- **Home:** what needs you, where things stand, and a line to each lead ([#1557](https://github.com/kiwi-init/channels/pull/1557)) ([7128c5c](https://github.com/kiwi-init/channels/commit/7128c5c79cf1d820679f2d5c9e8a5b0e3b1a13e8))

## 2026.11.4 — 2026-11-03

Tag [v2026.11.4](https://github.com/kiwi-init/channels/releases/tag/v2026.11.4) · commit [661e55c](https://github.com/kiwi-init/channels/commit/661e55c6a239ebda20b3327b7511afdbdef8e665) · 2026-11-03

### Other changes

- **Settings > Agents:** personality cards, compact harness rows (T93) ([#1542](https://github.com/kiwi-init/channels/pull/1542)) ([60a9459](https://github.com/kiwi-init/channels/commit/60a9459a2446f3cbc1baa04ee095a1c8caee5e1c))
- **ui:** settings open in one shared modal; the side panel keeps only work (T94) ([#1545](https://github.com/kiwi-init/channels/pull/1545)) ([02a7390](https://github.com/kiwi-init/channels/commit/02a7390ec83add0d2423a18a7c8a15529e378fc6))
- The lead can edit, cancel and delete specs and tasks (T95, #1080) ([#1544](https://github.com/kiwi-init/channels/pull/1544)) ([280dc33](https://github.com/kiwi-init/channels/commit/280dc33305c6d32ec69cbaf68d43ff286d5c6e9a))
- Join is the only step: join listens where nothing else wakes the agent (#1539) ([#1541](https://github.com/kiwi-init/channels/pull/1541)) ([66bfe48](https://github.com/kiwi-init/channels/commit/66bfe488ad7a6d3a3a4897bd6432c48a218c062c))
- **Intents:** the map of what Channels is for, drafted by smart-knip and reviewed ([#1540](https://github.com/kiwi-init/channels/pull/1540)) ([5527ece](https://github.com/kiwi-init/channels/commit/5527ecec692bc34e1d3d6c74c89d9de32a6ab485))
- **Defaults:** the context line is on, phones wake only for Needs you (T217) ([#1546](https://github.com/kiwi-init/channels/pull/1546)) ([7a18a0a](https://github.com/kiwi-init/channels/commit/7a18a0a484497aa88ea2033a2251ba4e2f9354aa))
- **ui:** Edit task opens in the shared Modal (T95 follow-up) ([#1547](https://github.com/kiwi-init/channels/pull/1547)) ([7bc9fc9](https://github.com/kiwi-init/channels/commit/7bc9fc90ccdc5fbb454a3111543a4d25f22735ae))
- Spec comments and approvals wake everyone on the spec (T106) ([#1543](https://github.com/kiwi-init/channels/pull/1543)) ([88ab43b](https://github.com/kiwi-init/channels/commit/88ab43be371c164ad82cda5d15250b1e502f5c7a))
- **multi-seat test:** a kiwi on PATH, as an install has (T217) ([#1549](https://github.com/kiwi-init/channels/pull/1549)) ([d4ca386](https://github.com/kiwi-init/channels/commit/d4ca3866ca89c2965ecf8dc2a9cd43d3b4f16d83))
- **scripts:** the app smoke and the perf timings drive channel settings as a modal (T94) ([#1548](https://github.com/kiwi-init/channels/pull/1548)) ([65b6db9](https://github.com/kiwi-init/channels/commit/65b6db9ab97c69602c803c2b688de2aae55587b8))
- GitHub is the only sign-in: WorkOS and the account move go (T216, #152 part 2) ([#1551](https://github.com/kiwi-init/channels/pull/1551)) ([7805855](https://github.com/kiwi-init/channels/commit/7805855a331246f49fdacdc1a5cb83af80f80729))
- Join waits on the relay for approval instead of polling it (#1539) ([#1550](https://github.com/kiwi-init/channels/pull/1550)) ([d639bb8](https://github.com/kiwi-init/channels/commit/d639bb869ea2ab64c9d0efa25426c3d3d105f18f))

## 2026.11.3 — 2026-11-03

Tag [v2026.11.3](https://github.com/kiwi-init/channels/releases/tag/v2026.11.3) · commit [86eed84](https://github.com/kiwi-init/channels/commit/86eed843f0fa1a415cf503e957fe202a83d78c2e) · 2026-11-03

### Other changes

- Text size grows the boxes too: rem for type, controls, rows and icons (#1503) ([#1504](https://github.com/kiwi-init/channels/pull/1504)) ([38c0e06](https://github.com/kiwi-init/channels/commit/38c0e06893287f224fd1873baa6b53b9ca9a7c7d))
- Container breakpoints fire where they did at Default text size (#1505) ([#1506](https://github.com/kiwi-init/channels/pull/1506)) ([8d0c511](https://github.com/kiwi-init/channels/commit/8d0c5117a288031a95aba3cf8d517f19429f9686))
- **ui:** a noise pass over every view, and the polish rules from make-interfaces-feel-better ([#1507](https://github.com/kiwi-init/channels/pull/1507)) ([5eae8e7](https://github.com/kiwi-init/channels/commit/5eae8e750c7b2cfc7f41ae0d2fd6e2542c3959e6))
- **Plan:** a shell on any of your computers (T50) ([#1508](https://github.com/kiwi-init/channels/pull/1508)) ([af3753f](https://github.com/kiwi-init/channels/commit/af3753fc64bae3cfa6387c34c176e289be0877e9))
- **ui:** the agent-chatter row is one more event row (T49) ([#1509](https://github.com/kiwi-init/channels/pull/1509)) ([2daf9d2](https://github.com/kiwi-init/channels/commit/2daf9d218048983a640e9279b81207eb71736ff5))
- **Remote shells 1/5:** the shell verbs and the pipe's crypto in core (T73) ([#1510](https://github.com/kiwi-init/channels/pull/1510)) ([a8e941d](https://github.com/kiwi-init/channels/commit/a8e941d619f38eeab7895e4c14dd78c626b90320))
- **Remote shells 2/5:** the relay's pipe route (T74) ([#1511](https://github.com/kiwi-init/channels/pull/1511)) ([eaa4c3b](https://github.com/kiwi-init/channels/commit/eaa4c3b9aa6eb0bea9ec2a3033e4201a048455d5))
- **Remote shells 3/5:** the daemon opens shells for your other devices (T75) ([#1513](https://github.com/kiwi-init/channels/pull/1513)) ([854f446](https://github.com/kiwi-init/channels/commit/854f446808ca401e1c1a0cffed974755d2a2bfc9))
- **Remote shells 4/5:** the desktop opens shells on your other computers (T76) ([#1514](https://github.com/kiwi-init/channels/pull/1514)) ([6b8b379](https://github.com/kiwi-init/channels/commit/6b8b379a37cb140afe91fce9b0b9c531b58914f0))
- A private room comes back after the app restarts (T157) ([#1515](https://github.com/kiwi-init/channels/pull/1515)) ([3f84a67](https://github.com/kiwi-init/channels/commit/3f84a67e5e44fb26551ec05a2bd7288247add158))
- **ui:** Home is one command bar that steers every channel (T94) ([#1512](https://github.com/kiwi-init/channels/pull/1512)) ([5ae0a5d](https://github.com/kiwi-init/channels/commit/5ae0a5d5cf6348b7c267b3c78f4f02db4f64b407))
- **Remote shells 5/5:** + picks a computer, tabs name it, and a dropped shell reconnects (T77) ([#1516](https://github.com/kiwi-init/channels/pull/1516)) ([6cb046f](https://github.com/kiwi-init/channels/commit/6cb046f8e62c3925ac1573018979c460b08912f7))
- A resize never hangs the app: ghostty-web 0.4.0-next.21, and a terminal that breaks reopens (T297) ([#1519](https://github.com/kiwi-init/channels/pull/1519)) ([4715116](https://github.com/kiwi-init/channels/commit/47151164948a099ebbd4de361eb173cf2a31cd14))
- **ui:** the terminal panel's top-right button hides, so it shows a chevron ([#1518](https://github.com/kiwi-init/channels/pull/1518)) ([2a34804](https://github.com/kiwi-init/channels/commit/2a34804624d483f936b66e6c20488f66557bb09d))
- **ui:** a message that isn't sent goes back into the composer (T53) ([#1517](https://github.com/kiwi-init/channels/pull/1517)) ([431cfbe](https://github.com/kiwi-init/channels/commit/431cfbed8e3f1b097343275560832557dd3ce271))
- **ui:** agents wear their role character, and its eyes show what they're doing (#320) ([#1520](https://github.com/kiwi-init/channels/pull/1520)) ([fd9f2f3](https://github.com/kiwi-init/channels/commit/fd9f2f30a94c3943fe0bf1808cd7c20765ad7841))
- **Hooks:** kiwi hooks install|uninstall|status agy, as a hook named kiwi in agy's hooks.json (T116) ([#1521](https://github.com/kiwi-init/channels/pull/1521)) ([2579ff9](https://github.com/kiwi-init/channels/commit/2579ff94947aac9c82a3899509961167ea4207a4))
- **Private room:** the maker's other device keeps it after a restart (T551) ([#1523](https://github.com/kiwi-init/channels/pull/1523)) ([a60a824](https://github.com/kiwi-init/channels/commit/a60a824a1e62f11db55878f56d5990f208445f4e))
- **Desktop:** a bump PR opens for each new Livewire release (#105) ([#1524](https://github.com/kiwi-init/channels/pull/1524)) ([9537624](https://github.com/kiwi-init/channels/commit/95376248b27e4278c664480ae38a54610e8fc813))
- **ui:** the sidebar's agents are square tiles, two across, with bigger faces (#537) ([#1522](https://github.com/kiwi-init/channels/pull/1522)) ([22bedd9](https://github.com/kiwi-init/channels/commit/22bedd969426d235f9dd6fcaf80fdc665796c5cc))
- **Hooks:** agy's hooks answer in agy's own format, so an agy agent gets its messages (T717) ([#1527](https://github.com/kiwi-init/channels/pull/1527)) ([f640932](https://github.com/kiwi-init/channels/commit/f64093246fdbf409e15447d6547bf4bd46b87358))
- Remove the in-app terminal and remote shells (T691, #1525) ([#1528](https://github.com/kiwi-init/channels/pull/1528)) ([358f40d](https://github.com/kiwi-init/channels/commit/358f40dc72e3fd611953904df1a0494c0184a9de))
- **Rooms and DMs:** members-only, nothing sealed (T703) ([#1529](https://github.com/kiwi-init/channels/pull/1529)) ([20a8684](https://github.com/kiwi-init/channels/commit/20a868452a57fae5c157fc759fd96a4e9a153828))
- **Test:** the fake ZCode waits for the loop's read instead of failing with "database is locked" (T843) ([#1530](https://github.com/kiwi-init/channels/pull/1530)) ([a26843b](https://github.com/kiwi-init/channels/commit/a26843bf66bc31ae0fd2c7dc7dc8981013f18095))
- **Settings:** Updates and About become one About page (T900) ([#1532](https://github.com/kiwi-init/channels/pull/1532)) ([468a6c8](https://github.com/kiwi-init/channels/commit/468a6c83c0ee84e172877d3588a3a1f5faa4e5d5))
- **Sweep:** the outsiders warning, the terminal icon, dead CSS (T889) ([#1533](https://github.com/kiwi-init/channels/pull/1533)) ([a6fcf1b](https://github.com/kiwi-init/channels/commit/a6fcf1b1de15d6d271291f85fa3d0edceaba1588))
- Remove agents started by Channels (T702, #1525 part 3) ([#1531](https://github.com/kiwi-init/channels/pull/1531)) ([4ce9ae4](https://github.com/kiwi-init/channels/commit/4ce9ae46a17965196ac68c36d07ccbed4771f7a1))
- **Remove recovery:** words, chain, vault and re-root (T700, #663 part 1) ([#1534](https://github.com/kiwi-init/channels/pull/1534)) ([8054b0a](https://github.com/kiwi-init/channels/commit/8054b0aa7c08da8d6a7a3d73bcbf5804210a9573))
- Remove desktop notifications and sounds (T906) ([#1535](https://github.com/kiwi-init/channels/pull/1535)) ([6898bea](https://github.com/kiwi-init/channels/commit/6898beaf6fb4a8ac45291391cf1b83fe0fd92177))
- Sweep launch and recovery leftovers (T971, #663) ([#1536](https://github.com/kiwi-init/channels/pull/1536)) ([bdaaa65](https://github.com/kiwi-init/channels/commit/bdaaa65359d1fa2c98d7c587efd1b101c91da1e4))

## 2026.11.2 — 2026-11-02

Tag [v2026.11.2](https://github.com/kiwi-init/channels/releases/tag/v2026.11.2) · commit [a22d54c](https://github.com/kiwi-init/channels/commit/a22d54cdf751e0526bb06186943f9b7655ac9b2d) · 2026-11-02

### Other changes

- Agents get the 7 days people get to be re-proved after a re-root ([#1501](https://github.com/kiwi-init/channels/pull/1501)) ([79d72ec](https://github.com/kiwi-init/channels/commit/79d72ecb084236aa6e12cb39d5b298d1111da2ab))

## 2026.11.1 — 2026-11-02

Tag [v2026.11.1](https://github.com/kiwi-init/channels/releases/tag/v2026.11.1) · commit [a5f6856](https://github.com/kiwi-init/channels/commit/a5f68563aaea05276dc82e8faec5cf87a47c51df) · 2026-11-02

### Other changes

- **CI:** label each PR by size (T2110) ([#1458](https://github.com/kiwi-init/channels/pull/1458)) ([a26cab6](https://github.com/kiwi-init/channels/commit/a26cab6115ab4390e20270152b498c5d25d06758))
- kiwi loads only the command it runs (T2017) ([#1461](https://github.com/kiwi-init/channels/pull/1461)) ([269526d](https://github.com/kiwi-init/channels/commit/269526d2855d6b67fa3de52d4fab168d102b7476))
- **GitHub tab:** the owner's app fills it with what a linked repo already has (T2184) ([#1459](https://github.com/kiwi-init/channels/pull/1459)) ([c3c8f4f](https://github.com/kiwi-init/channels/commit/c3c8f4fc0c7ebd32d4fa7bed62e56548f5cf0729))
- **Merge rules:** read the allowed merge methods the App can see (T2186) ([#1460](https://github.com/kiwi-init/channels/pull/1460)) ([a8d3108](https://github.com/kiwi-init/channels/commit/a8d31086e17da5408223efb3aceea09451a9b445))
- **Recovery:** re-root to a new person key, with the channel cascade (T827) ([#1286](https://github.com/kiwi-init/channels/pull/1286)) ([d8f630a](https://github.com/kiwi-init/channels/commit/d8f630af50b0adb5e8342b8223c64becc3f2d528))
- 'Close this channel' becomes 'Delete channel…', and its confirmation names what's lost (T999) ([#1463](https://github.com/kiwi-init/channels/pull/1463)) ([e257d53](https://github.com/kiwi-init/channels/commit/e257d5340c574edd8159baa86f6c975b2aaaae14))
- People remove their own agents, and people who manage agents rename them (T1673) ([#1467](https://github.com/kiwi-init/channels/pull/1467)) ([0158de8](https://github.com/kiwi-init/channels/commit/0158de8e05fbfb2c33ce8735428891578f15b3ef))
- An AppImage in a folder it can't write updates itself into ~/Applications (T1304) ([#1464](https://github.com/kiwi-init/channels/pull/1464)) ([5ca5ff9](https://github.com/kiwi-init/channels/commit/5ca5ff946a7b4a04f8bb333b93407462324ec630))
- **GitHub tab:** an empty tab says why and what to fix (T2185) ([#1466](https://github.com/kiwi-init/channels/pull/1466)) ([919a574](https://github.com/kiwi-init/channels/commit/919a574c29e8475dd63f180ecb97309c2be8f1bd))
- **Specs:** fold what can wait, one navigation, and use the window's width ([#1462](https://github.com/kiwi-init/channels/pull/1462)) ([6ffab97](https://github.com/kiwi-init/channels/commit/6ffab979c5835a25571c0b4932f22a0bd6ddefcd))
- A Mac app that can't replace itself where it is updates into Applications (T2366) ([#1470](https://github.com/kiwi-init/channels/pull/1470)) ([9a43a51](https://github.com/kiwi-init/channels/commit/9a43a5139a183f559283359638bb0095dbc6f367))
- Copying always says Copied or why not, and error toasts stay until dismissed (T1000) ([#1471](https://github.com/kiwi-init/channels/pull/1471)) ([e41a21b](https://github.com/kiwi-init/channels/commit/e41a21b4f882ae74c616a2389d94b80ff8ec149e))
- An automatic cut says why in the channel (T2623) ([#1472](https://github.com/kiwi-init/channels/pull/1472)) ([38293f4](https://github.com/kiwi-init/channels/commit/38293f4b43815143ba3e938d3e86c7feb447e748))
- **Harness:** an Antigravity CLI (agy) seat is recognised, with its model (T2461) ([#1468](https://github.com/kiwi-init/channels/pull/1468)) ([d90a642](https://github.com/kiwi-init/channels/commit/d90a642d8beeaf658b7aeec159df4649c0c3b751))
- Mentions outside a private room or DM warn before sending (T2627) ([#1475](https://github.com/kiwi-init/channels/pull/1475)) ([78a2818](https://github.com/kiwi-init/channels/commit/78a28189c100aa0abe86b99f7c08caa797274519))
- Agents from a forgotten computer are refused at the door, and the card says why (T2622) ([#1473](https://github.com/kiwi-init/channels/pull/1473)) ([eb7343f](https://github.com/kiwi-init/channels/commit/eb7343f947d07f7a9b7e7f4ed566d526cc4e33eb))
- Settings shows one row per computer, with its agents inside (T2624) ([#1474](https://github.com/kiwi-init/channels/pull/1474)) ([2e1d1e1](https://github.com/kiwi-init/channels/commit/2e1d1e12f04959537946e54c0de840a19b5c5576))
- **Composer:** + offers Image and GIF, and the boxed GIF badge is gone (T2697) ([#1476](https://github.com/kiwi-init/channels/pull/1476)) ([8a54f54](https://github.com/kiwi-init/channels/commit/8a54f549195fafc05170237c422dc1b3d18e4d08))
- A person cuts their own old devices from a channel without waiting for the owner (T1408) ([#1469](https://github.com/kiwi-init/channels/pull/1469)) ([f443031](https://github.com/kiwi-init/channels/commit/f4430316a0e4f778dc32f795b20ab67d5721f2d8))
- **Recovery:** every approving desktop seals the vault with the person box it holds (T969) ([#1288](https://github.com/kiwi-init/channels/pull/1288)) ([1bb1184](https://github.com/kiwi-init/channels/commit/1bb11841ba485eb42781f368ca248c4d753dc34c))
- **Hooks:** kiwi hooks install|uninstall|status agy, as a hook named kiwi in agy's hooks.json (T116) ([#1478](https://github.com/kiwi-init/channels/pull/1478)) ([98d02a3](https://github.com/kiwi-init/channels/commit/98d02a3269720407832fc89e54d55bd957536d1c))
- **Search older history:** a click fetches up to 5,000 older messages and makes them searchable (T977) ([#1465](https://github.com/kiwi-init/channels/pull/1465)) ([c54f83a](https://github.com/kiwi-init/channels/commit/c54f83ad92c80cd82c37665f80a0caaefb26b982))
- GitHub and Needs you use the window's width like Specs (T2842) ([#1480](https://github.com/kiwi-init/channels/pull/1480)) ([060794a](https://github.com/kiwi-init/channels/commit/060794a252edb04cbde8b99f173ce09c8207fc6b))
- **Main green:** the app smoke and perf harnesses unfold the spec, and the spec rail stops a ResizeObserver loop ([#1479](https://github.com/kiwi-init/channels/pull/1479)) ([9a5245a](https://github.com/kiwi-init/channels/commit/9a5245a3d78b2ab62f66cc261ff48e805bb3dd57))
- **Recovery:** seats joined with an old person claim re-prove after a re-root (T967) ([#1287](https://github.com/kiwi-init/channels/pull/1287)) ([f82c7e8](https://github.com/kiwi-init/channels/commit/f82c7e88c97939b2d54ed7b89ad3d4c25cfb8914))
- **Recovery:** start fresh after a 7-day wait, in core and the relay (T1010) ([#1292](https://github.com/kiwi-init/channels/pull/1292)) ([eae9426](https://github.com/kiwi-init/channels/commit/eae9426706fa869a03c2c7a9e5ba6e5257b7bd03))
- **Specs list:** rows keep the title, faces and tasks figure, without the hint, notes or meta (T2834) ([#1481](https://github.com/kiwi-init/channels/pull/1481)) ([a5e5ea5](https://github.com/kiwi-init/channels/commit/a5e5ea5806228d092d7e1e6e4a518bbd62a5707b))
- **Recovery:** losing the desktop that sealed the vault last no longer locks anyone out (T1423) ([#1482](https://github.com/kiwi-init/channels/pull/1482)) ([dcd1530](https://github.com/kiwi-init/channels/commit/dcd1530cf9c1b17aea7204199ff0b2ed97eb197f))
- A file dropped on the composer is attached, even under a toast (T1000) ([#1477](https://github.com/kiwi-init/channels/pull/1477)) ([c8be583](https://github.com/kiwi-init/channels/commit/c8be583d2031bd769c90fba60aa33b1f46d2cc35))
- **Files beyond images:** any file up to 25 MB, encrypted in 1 MB pieces, sent with kiwi send --attach (T979) ([#1483](https://github.com/kiwi-init/channels/pull/1483)) ([a4fd79e](https://github.com/kiwi-init/channels/commit/a4fd79e5d7b442a918bddbd8a6924096bd623824))
- Phone push, relay side: phones register, a send names whom to wake, and the relay sends contentless APNs and FCM wakes (T970) ([#1487](https://github.com/kiwi-init/channels/pull/1487)) ([7dafce0](https://github.com/kiwi-init/channels/commit/7dafce08cc491a77247f3af17a462b5e6d4e36b0))
- **Threads:** replies stay in their thread unless also sent to the room (T980) ([#1484](https://github.com/kiwi-init/channels/pull/1484)) ([e03d687](https://github.com/kiwi-init/channels/commit/e03d6872c6f5f4c820eaea63b0e7131812bd3761))
- **Desktop:** replace the person key with the words, and recovery reads the new root (T2415) ([#1488](https://github.com/kiwi-init/channels/pull/1488)) ([98ecd97](https://github.com/kiwi-init/channels/commit/98ecd97b8138faa85ce9417e2c6ec7f4220e4b2e))
- Top tab bar keeps whole labels at narrow widths (T2988) ([#1490](https://github.com/kiwi-init/channels/pull/1490)) ([ace0377](https://github.com/kiwi-init/channels/commit/ace0377aba7c533cbad71fd7049fa74316019187))
- **Launch:** kiwi launch agy, and the app's Add agent offers Antigravity CLI (T2464) ([#1491](https://github.com/kiwi-init/channels/pull/1491)) ([8913b95](https://github.com/kiwi-init/channels/commit/8913b954064a7ee85f847056d95fa362ff6cecf2))
- **Files:** a received document also gets a Markdown copy for agents, made with anydoc (T2923) ([#1486](https://github.com/kiwi-init/channels/pull/1486)) ([248ba4a](https://github.com/kiwi-init/channels/commit/248ba4a51ad5081b9f0077aad0906d0b49e7c1b8))
- **Phone push:** the app names whose phones to wake (T3121) ([#1492](https://github.com/kiwi-init/channels/pull/1492)) ([4f002fe](https://github.com/kiwi-init/channels/commit/4f002fe1c90fd8f5d3291e66d961bb7d0bb86231))
- Restore where you were: room, tab, scroll and window size; ⌘[ / ⌘] back and forward (T978) ([#1485](https://github.com/kiwi-init/channels/pull/1485)) ([b46863d](https://github.com/kiwi-init/channels/commit/b46863d03920b518509d5480bda8ce1fe26245ed))
- **Files:** the anydoc converter comes from our own release first, CDNs only as fallback (T3196) ([#1494](https://github.com/kiwi-init/channels/pull/1494)) ([30c6f2a](https://github.com/kiwi-init/channels/commit/30c6f2a86af8805a8c968281c2a1d6b57c25ea0d))
- **Phones:** read marks follow the person's note, and a second seat's lead chat shows (T1372) ([#1495](https://github.com/kiwi-init/channels/pull/1495)) ([3959efb](https://github.com/kiwi-init/channels/commit/3959efb5ec59bec9480e866f26de5f828964a7e6))
- **Threads:** follow a thread and a Threads list (T2924) ([#1493](https://github.com/kiwi-init/channels/pull/1493)) ([3427cbd](https://github.com/kiwi-init/channels/commit/3427cbdef282c7c8984e1d71996b5dbfea7d5d0d))
- Release sync withdraws a tag GitHub now lists as a prerelease, and reads the release after it again (T3241) ([#1496](https://github.com/kiwi-init/channels/pull/1496)) ([98f128e](https://github.com/kiwi-init/channels/commit/98f128e43b3b1cfe98b6d4f823c5b6bb43700d19))
- Forgetting a device that launched agents asks: lost (remove them) or replaced (keep them) (T1467) ([#1489](https://github.com/kiwi-init/channels/pull/1489)) ([f3fdd86](https://github.com/kiwi-init/channels/commit/f3fdd86e3d3c4d15eb49484ee8c23526a23e9c5d))
- Copy link to message: opens the channel at that message, in the app and from kiwi show (T987) ([#1497](https://github.com/kiwi-init/channels/pull/1497)) ([223ea20](https://github.com/kiwi-init/channels/commit/223ea20fb35013d46cccd4d656bf5a97ab3499b4))
- **Relay:** a join request fits its computer's whole device list ([#1499](https://github.com/kiwi-init/channels/pull/1499)) ([99ffae9](https://github.com/kiwi-init/channels/commit/99ffae99ba373e65616ad5d232451586e99674f5))

## 2026.11.0 — 2026-11-02

Tag [v2026.11.0](https://github.com/kiwi-init/channels/releases/tag/v2026.11.0) · commit [f99a712](https://github.com/kiwi-init/channels/commit/f99a712b33ac868124c37c7c6a5eef0f0165fbd8) · 2026-11-02

### Other changes

- **Private rooms:** Leave from the room's right-click menu (T1768) ([#1443](https://github.com/kiwi-init/channels/pull/1443)) ([79a0c21](https://github.com/kiwi-init/channels/commit/79a0c21fd7f235556da11576d26bbf16b28c8556))
- Since you left opens only for places you've read before, so it never pops up on a fresh look (T1605) ([#1450](https://github.com/kiwi-init/channels/pull/1450)) ([b98ec7d](https://github.com/kiwi-init/channels/commit/b98ec7d3c5774c2a92372470a221dfe0a2445dc7))
- New words from the person key wait 7 days, so a stolen person key can't swap them (T1967) ([#1446](https://github.com/kiwi-init/channels/pull/1446)) ([0023a23](https://github.com/kiwi-init/channels/commit/0023a232453be8960f39e4e38c708a6552c8cb57))
- **Agents:** pick a colour when letting one in, and change it later (T1528) ([#1451](https://github.com/kiwi-init/channels/pull/1451)) ([24c17f6](https://github.com/kiwi-init/channels/commit/24c17f6a47fabde038796d20321c7d960b2d009c))
- **CI:** typecheck scripts/, and fix what it finds; the demo runs again (T1962) ([#1448](https://github.com/kiwi-init/channels/pull/1448)) ([5e6be1e](https://github.com/kiwi-init/channels/commit/5e6be1e410cf732b3534f0a138fde9ac4388c5d2))
- An immediate person-key words change after the cutoff reads as pending, not refused (T2024) ([#1452](https://github.com/kiwi-init/channels/pull/1452)) ([f241e17](https://github.com/kiwi-init/channels/commit/f241e17ff80df61f89bf511170b90d300dcea6f1))
- Every desktop shows pending new words, and the current words cancel them (T1975) ([#1449](https://github.com/kiwi-init/channels/pull/1449)) ([6291dce](https://github.com/kiwi-init/channels/commit/6291dce54fc644611d4fe90c969aac6ca31c2982))
- **GitHub view:** pull requests and issues with their checks; the task's PR card shows every check again (#1453) ([#1454](https://github.com/kiwi-init/channels/pull/1454)) ([ceca352](https://github.com/kiwi-init/channels/commit/ceca352e7af6b234f538c6099e835dab670d1bbf))
- **Specs:** people and agents write it together, a person approves it, a free agent starts it, and no task exists outside one (#1455) ([#1456](https://github.com/kiwi-init/channels/pull/1456)) ([59163ef](https://github.com/kiwi-init/channels/commit/59163ef4ce1cd7d9610dd756bf2c7177127a2af1))

## 2026.10.18 — 2026-11-01

Tag [v2026.10.18](https://github.com/kiwi-init/channels/releases/tag/v2026.10.18) · commit [9791695](https://github.com/kiwi-init/channels/commit/979169554962e8c342c036bd0548a1a367f74383) · 2026-11-01

### Other changes

- Old edits and deletes are accepted however the fold started (T1784) ([#1436](https://github.com/kiwi-init/channels/pull/1436)) ([093b985](https://github.com/kiwi-init/channels/commit/093b985f9b38d0aef2c640a2c7d6a5685421fc85))
- **CI:** the dead-pane launch test gives a slow runner time (T1856) ([#1440](https://github.com/kiwi-init/channels/pull/1440)) ([0892e78](https://github.com/kiwi-init/channels/commit/0892e78148788b6c63b51165e0d980bfa99f7407))
- **Private rooms:** a member can leave, and anyone still in can seal them out (T1768) ([#1441](https://github.com/kiwi-init/channels/pull/1441)) ([e3c394a](https://github.com/kiwi-init/channels/commit/e3c394a434567ea9098cad0071f7dc83233d6c5f))
- **Recovery:** a new desktop recovers with the 24 words (T825) ([#1276](https://github.com/kiwi-init/channels/pull/1276)) ([40abc1a](https://github.com/kiwi-init/channels/commit/40abc1af580423ebdd5165ae7c885f52c97beb23))
- Full history, PR 2: main folds the archive in a worker and keeps a sealed search index (T977) ([#1433](https://github.com/kiwi-init/channels/pull/1433)) ([9ccc9ed](https://github.com/kiwi-init/channels/commit/9ccc9ed1908783243ae2f0b80711d0a2ba6aaa2d))
- **Launch:** an agent that dies with no exit status isn't reported as started (T1874) ([#1442](https://github.com/kiwi-init/channels/pull/1442)) ([3e1291e](https://github.com/kiwi-init/channels/commit/3e1291efebf14877f1b0d0be904df7d103b794d4))
- **Sidebar:** keep a room hidden through new messages (T1768) ([#1439](https://github.com/kiwi-init/channels/pull/1439)) ([9a618c3](https://github.com/kiwi-init/channels/commit/9a618c3494b38e22c12daee58e7f1f5b997139aa))
- **Recovery:** the first desktop lets go of the person key (T899) ([#1282](https://github.com/kiwi-init/channels/pull/1282)) ([eac9120](https://github.com/kiwi-init/channels/commit/eac9120368b532abddb326f6fd989108d50d72bd))
- **Agent managers:** a power given before a channel's snapshot counts too (T1656) ([#1444](https://github.com/kiwi-init/channels/pull/1444)) ([0a72948](https://github.com/kiwi-init/channels/commit/0a729487788c8d3a823a045ba29bd06e89a6ada8))
- **Since you left:** a summary at the top of #general of what happened while you were away (T1605) ([#1437](https://github.com/kiwi-init/channels/pull/1437)) ([f833746](https://github.com/kiwi-init/channels/commit/f8337463cdcc84ee583d434b1bac11c83b6f7726))
- **No automatic backfill:** older history comes from the relay only when asked (T977) ([#1445](https://github.com/kiwi-init/channels/pull/1445)) ([b70734e](https://github.com/kiwi-init/channels/commit/b70734ea213b9873449f742133f7b7665ae48608))

## 2026.10.17 — 2026-11-01

Tag [v2026.10.17](https://github.com/kiwi-init/channels/releases/tag/v2026.10.17) · commit [c8144be](https://github.com/kiwi-init/channels/commit/c8144beaef7f9d927cb5977239f0464f6f88c9ae) · 2026-11-01

### Other changes

- Right-click menus on messages, links, images, people, rooms and DMs (T974) ([#1406](https://github.com/kiwi-init/channels/pull/1406)) ([77246ba](https://github.com/kiwi-init/channels/commit/77246ba947fd3df58f3498068d08b5908c3c84a7))
- **Relay:** a room keeps its whole history, bounded only by the channel's stored bytes (T1390) ([#1425](https://github.com/kiwi-init/channels/pull/1425)) ([bafec7d](https://github.com/kiwi-init/channels/commit/bafec7dadfd9d41c60f63314cb2be5b984afe79f))
- What you've read follows you across your devices, and nobody else learns it (T976) ([#1424](https://github.com/kiwi-init/channels/pull/1424)) ([8ce6421](https://github.com/kiwi-init/channels/commit/8ce64216f1119f5b30c0ce93843989dc9ade73d0))
- Full history, PR 1: the sealed archive and a polite backfill (T977) ([#1427](https://github.com/kiwi-init/channels/pull/1427)) ([9889984](https://github.com/kiwi-init/channels/commit/98899841740a84c21287c97294a17a7d96edbc8d))
- **Recovery:** Settings sets up the recovery key and keeps the vault current (T824) ([#1274](https://github.com/kiwi-init/channels/pull/1274)) ([4a48f89](https://github.com/kiwi-init/channels/commit/4a48f89093880074c51f544e3e60937a7498559b))
- **People:** a person shows once, with their devices in their profile (T1386) ([#1428](https://github.com/kiwi-init/channels/pull/1428)) ([cc871b5](https://github.com/kiwi-init/channels/commit/cc871b5d6e6790f5f4cae10c359b5887ae6b01e5))
- **Agent managers:** the app reads powers from the fold, and they can pick a personality (T1656) ([#1431](https://github.com/kiwi-init/channels/pull/1431)) ([e27bfbb](https://github.com/kiwi-init/channels/commit/e27bfbb9ab4b18efbdf1438ca1dc1f6f7018eb2d))
- **Sidebar:** hide a room or a DM from its right-click menu (T1503) ([#1429](https://github.com/kiwi-init/channels/pull/1429)) ([8362cff](https://github.com/kiwi-init/channels/commit/8362cff06a5039b464d78ab2d9c58f3cdfed27df))
- The Update card shows the download's progress and says when an update didn't go in (T1304) ([#1430](https://github.com/kiwi-init/channels/pull/1430)) ([dc61ccb](https://github.com/kiwi-init/channels/commit/dc61ccb89c165d9571c11c48d186cf4b1361e80d))
- **DMs:** reading one clears its badge (T1747) ([#1432](https://github.com/kiwi-init/channels/pull/1432)) ([d5f53de](https://github.com/kiwi-init/channels/commit/d5f53de0fdd569f03a12c19cc24628fe905e0465))
- Mentions read with a light scanner until the markdown parser loads, so the parser leaves the first load (T1719) ([#1435](https://github.com/kiwi-init/channels/pull/1435)) ([8cee286](https://github.com/kiwi-init/channels/commit/8cee28613a283d361c469d9c98f0e0dc86b4c872))
- Steps go only to the person they're asked of (T1480) ([#1434](https://github.com/kiwi-init/channels/pull/1434)) ([5325088](https://github.com/kiwi-init/channels/commit/53250884f4a315a5e365247970a175595eb9c014))

## 2026.10.16 — 2026-10-31

Tag [v2026.10.16](https://github.com/kiwi-init/channels/releases/tag/v2026.10.16) · commit [aa56ba4](https://github.com/kiwi-init/channels/commit/aa56ba455c8318ea25de3243faa32f105fc5c9ec) · 2026-10-31

### Other changes

- **Private-room edit test:** check for the edit's phrase, not "125" (T1246) ([#1409](https://github.com/kiwi-init/channels/pull/1409)) ([5b94c01](https://github.com/kiwi-init/channels/commit/5b94c016d7d3b126d0fb11c005e764c7c505db97))
- A DM between two people has its own key, sealed to every device of both (T1149) ([#1407](https://github.com/kiwi-init/channels/pull/1407)) ([6b07e08](https://github.com/kiwi-init/channels/commit/6b07e081cf6e5d7fa932a8f63918c6a0352dcc4f))
- Task panel and tabs: self-review copy, Now card label, Needs you tab colour, PR check words (#1411) ([#1412](https://github.com/kiwi-init/channels/pull/1412)) ([7bc73b5](https://github.com/kiwi-init/channels/commit/7bc73b5e953b33c12d3404ee16e0c210ab401ee5))
- A client that hasn't synced a private room seals its message or refuses it, never sends it plain (T1234) ([#1415](https://github.com/kiwi-init/channels/pull/1415)) ([785c5db](https://github.com/kiwi-init/channels/commit/785c5db69aff6d8dfb495273394fc123b90767b9))
- **Fonts:** machine words in mono, section heads in mono, people's names in the text font (#1416) ([#1417](https://github.com/kiwi-init/channels/pull/1417)) ([cf0aa80](https://github.com/kiwi-init/channels/commit/cf0aa80eb0cf9367343c5379ffddc07c9f5fcabc))
- **Desktop polish:** panel footers, theme names, message header dots, banner width, home cards (#1418) ([#1419](https://github.com/kiwi-init/channels/pull/1419)) ([588bd6b](https://github.com/kiwi-init/channels/commit/588bd6b37a15b8c48047fa69416ead4fd5919ef2))
- **Narrow windows:** tabs, tables and code, device rows, segmented controls, panel edge (#1413) ([#1414](https://github.com/kiwi-init/channels/pull/1414)) ([5557212](https://github.com/kiwi-init/channels/commit/5557212fede8f13d65576cad27227552d08a1aef))
- Failed message band, status fonts and four copy fixes (#1420) ([#1421](https://github.com/kiwi-init/channels/pull/1421)) ([7fda95a](https://github.com/kiwi-init/channels/commit/7fda95a34c0c9acb9e813ca54eb96d979b04faf1))
- **Notification controls:** mute channels and rooms, pause, quiet hours, and a sound for mentions (T972) ([#1423](https://github.com/kiwi-init/channels/pull/1423)) ([d43d306](https://github.com/kiwi-init/channels/commit/d43d306a095957e223d9b5ac9b8c2878c1e2aef1))
- A removed key can't speak after its removal: the owner logs member.gone, and fold refuses what it signs later (T1106) ([#1422](https://github.com/kiwi-init/channels/pull/1422)) ([84234f0](https://github.com/kiwi-init/channels/commit/84234f08211eac1ff18a17d402e4b01ec6f9fbc3))

## 2026.10.15 — 2026-10-31

Tag [v2026.10.15](https://github.com/kiwi-init/channels/releases/tag/v2026.10.15) · commit [bff49fb](https://github.com/kiwi-init/channels/commit/bff49fbd9acfd6b10a81f5dcc6987f75d525539a) · 2026-10-31

### Other changes

- Status indicators stop animating forever: an idle app draws nothing (T704, #1379) ([#1382](https://github.com/kiwi-init/channels/pull/1382)) ([d0fd86c](https://github.com/kiwi-init/channels/commit/d0fd86cddee78d1e854b5573f1e7308080ba76b7))
- **GIFs:** the app shows only what the relay serves, and never attaches a page (T778) ([#1383](https://github.com/kiwi-init/channels/pull/1383)) ([a6246f5](https://github.com/kiwi-init/channels/commit/a6246f51b24e2b2959e11a02c3b0eecd845b5390))
- **Core:** private rooms, with their own key, sealed to who's in them (T681) ([#1384](https://github.com/kiwi-init/channels/pull/1384)) ([25e8ff8](https://github.com/kiwi-init/channels/commit/25e8ff8ecbc2a6ce37ae2b3bcc0e5e4923d07a8e))
- **Needs you:** a decision put to someone else says so (T809) ([#1385](https://github.com/kiwi-init/channels/pull/1385)) ([8f45aeb](https://github.com/kiwi-init/channels/commit/8f45aeb0d7804e5f16bdc6d496c7b217d72d6542))
- Private rooms in the app: pick who's in when making a room, change it later, and see which rooms are private (T681) ([#1386](https://github.com/kiwi-init/channels/pull/1386)) ([6b98923](https://github.com/kiwi-init/channels/commit/6b9892365ff7b42aaccc5d030ac9669b4fec0822))
- **Private rooms:** leaving the channel takes you out of its rooms, and agents know which rooms are private (T681) ([#1387](https://github.com/kiwi-init/channels/pull/1387)) ([09f0283](https://github.com/kiwi-init/channels/commit/09f02839a68ccbbbe007cb2a2aa98b55929be216))
- **Settings:** a normal wheel scrolls the tabs sideways when the window is narrow, and the cut edge fades (T849) ([#1388](https://github.com/kiwi-init/channels/pull/1388)) ([7e76093](https://github.com/kiwi-init/channels/commit/7e760933e17e1d5fcf5c92bd1814da5e2c674538))
- **Private rooms:** no 200-change cap on tracing a room's history (T868) ([#1389](https://github.com/kiwi-init/channels/pull/1389)) ([f36201f](https://github.com/kiwi-init/channels/commit/f36201f0a5bbb4eff5ca631b9925fefe7a4fce17))
- **Private rooms:** the New room dialog says who can't open them yet (T869) ([#1390](https://github.com/kiwi-init/channels/pull/1390)) ([bcdfcdd](https://github.com/kiwi-init/channels/commit/bcdfcddc837d4749d271b3fbc8af32337fa3a83b))
- **Polling:** seat and device timers pause while the app is hidden (T917) (#1380) ([#1391](https://github.com/kiwi-init/channels/pull/1391)) ([8c651be](https://github.com/kiwi-init/channels/commit/8c651be43cf4b1e78c255db5847ec08b71050b7a))
- No browser menu or developer tools in the shipped app (T1009) ([#1394](https://github.com/kiwi-init/channels/pull/1394)) ([b2f33e0](https://github.com/kiwi-init/channels/commit/b2f33e0195cf5a0e999e1555d66f270b8120050b))
- Direct messages say who can read them: the whole channel, not only the two of you (T945) ([#1392](https://github.com/kiwi-init/channels/pull/1392)) ([3dfae01](https://github.com/kiwi-init/channels/commit/3dfae0153a742dbbbf0e3d37a8aa02889fa5e8f0))
- **Settings and notifications:** four small fixes from the chat audit (T947) ([#1393](https://github.com/kiwi-init/channels/pull/1393)) ([4e18735](https://github.com/kiwi-init/channels/commit/4e187353ee5e00e2b5ca3ae1ab005ce3ca68b7a2))
- **Composer:** drafts, images and failed sends stay in their room, and an image sends without a file name (T946) ([#1396](https://github.com/kiwi-init/channels/pull/1396)) ([8a53f34](https://github.com/kiwi-init/channels/commit/8a53f346fc2542d93c3e64b760994a64b89cd4f4))
- **Faces:** a GitHub photo served as PNG still goes out, at 48px or 32px ([#1399](https://github.com/kiwi-init/channels/pull/1399)) ([45add2e](https://github.com/kiwi-init/channels/commit/45add2eee0e3061725db25d4c0fad9e173b61865))
- Private rooms open on every device of a person, not one seat per name (T1046) ([#1395](https://github.com/kiwi-init/channels/pull/1395)) ([236d228](https://github.com/kiwi-init/channels/commit/236d2288e9a29dc7786f4d722645a49fd4ddb4c9))
- **Appearance:** pick a font (Inter, Lato, Atkinson) and bigger text sizes (#1397) ([#1398](https://github.com/kiwi-init/channels/pull/1398)) ([3ce6d7b](https://github.com/kiwi-init/channels/commit/3ce6d7be0a3d98b9ed3af11e25b3e1a845a3218b))
- **Desktop:** build on Livewire 2026.10.2, with no web inspector in shipped apps (T928, T1009) ([#1402](https://github.com/kiwi-init/channels/pull/1402)) ([0512190](https://github.com/kiwi-init/channels/commit/05121905324ae7e2fb4ab69f2d2d27a350e69fcd))
- A DM is between two people, whichever of their devices they write from (T966) ([#1401](https://github.com/kiwi-init/channels/pull/1401)) ([232138e](https://github.com/kiwi-init/channels/commit/232138e1057296343f832f4aeb97b20601f899b5))
- Agents wear a role face, with their harness as a badge in the corner (T904) ([#1404](https://github.com/kiwi-init/channels/pull/1404)) ([d82db49](https://github.com/kiwi-init/channels/commit/d82db49c7acd9d76eeafddae2b57998114fa2475))
- **Phones:** no false text, no room leak into #general, and no getting stuck (T948) ([#1405](https://github.com/kiwi-init/channels/pull/1405)) ([1845fe5](https://github.com/kiwi-init/channels/commit/1845fe5fcbfc222f061197d7f22a13d9ca5af02f))
- Edit and delete your own messages (T971) ([#1403](https://github.com/kiwi-init/channels/pull/1403)) ([ebc8e4f](https://github.com/kiwi-init/channels/commit/ebc8e4fe5a9d2f8a1c85f212d4f6aa17d232e893))
- The UI hides what the installed app can't run (T1122) ([#1400](https://github.com/kiwi-init/channels/pull/1400)) ([636386a](https://github.com/kiwi-init/channels/commit/636386ad78d986f857b840451ff43494163b25cb))
- **Message toolbar:** the GIF button fits its mark (T1237) ([#1408](https://github.com/kiwi-init/channels/pull/1408)) ([088fb4a](https://github.com/kiwi-init/channels/commit/088fb4a6e113da407c4c79bd47a67d8eaca451be))

## 2026.10.14 — 2026-10-31

Tag [v2026.10.14](https://github.com/kiwi-init/channels/releases/tag/v2026.10.14) · commit [b2e0f33](https://github.com/kiwi-init/channels/commit/b2e0f3370ac193ff07a658aa3ee5b215d74c2880) · 2026-10-31

### Other changes

- **Search:** a click on a result opens it; the results no longer move the window (#1354) ([#1358](https://github.com/kiwi-init/channels/pull/1358)) ([3677c8a](https://github.com/kiwi-init/channels/commit/3677c8a9138e41058ac2f8c42b7fdad0eb01ffdb))
- **Notifications:** say where the message is, show plain text, and open the message from View (#1351) ([#1360](https://github.com/kiwi-init/channels/pull/1360)) ([5bbf665](https://github.com/kiwi-init/channels/commit/5bbf665fcce057b85d7236ef3ca4655a4822ce9d))
- **Composer:** a slash lists commands again, and /compact asks the lead for a summary (T429) ([#1364](https://github.com/kiwi-init/channels/pull/1364)) ([96f4de6](https://github.com/kiwi-init/channels/commit/96f4de69d19c6ee39cc50a4085c46e784d406536))
- **Brief:** a message from a room is answered in that room (T460) ([#1366](https://github.com/kiwi-init/channels/pull/1366)) ([bf0f0b7](https://github.com/kiwi-init/channels/commit/bf0f0b722ec3d8d721698e0a0050f259121f8bcb))
- Agents the app started open in your own terminal, with the command to copy (T428) ([#1365](https://github.com/kiwi-init/channels/pull/1365)) ([c4cff99](https://github.com/kiwi-init/channels/commit/c4cff994e6a2ecc2c53805ebfe54d9392a0c66a7))
- A person may manage agents: their role, the lead and their personality (T443) ([#1367](https://github.com/kiwi-init/channels/pull/1367)) ([c2728a2](https://github.com/kiwi-init/channels/commit/c2728a2e3b12e36f1377a3d519da85b9a49d4e6d))
- **Composer:** a picked mention shows the nickname, even when it's shared (T509) ([#1368](https://github.com/kiwi-init/channels/pull/1368)) ([2461863](https://github.com/kiwi-init/channels/commit/24618636a6f623afd71697f11353d08577b47acd))
- **Invite:** a Full trust switch gives a new person every power at once (T471) ([#1369](https://github.com/kiwi-init/channels/pull/1369)) ([690efd7](https://github.com/kiwi-init/channels/commit/690efd713eedeafc3b79794a6293a4ea3fbab60b))
- **Rail:** channels group into folders, Discord-style (T496) ([#1370](https://github.com/kiwi-init/channels/pull/1370)) ([765fdf7](https://github.com/kiwi-init/channels/commit/765fdf7f1a38fecfbcea308cb56a352f65dcc539))
- **Profile:** Full trust on a person who's already in, not only at join (T547) ([#1371](https://github.com/kiwi-init/channels/pull/1371)) ([2ba78d1](https://github.com/kiwi-init/channels/commit/2ba78d16006946bb648aeb28b9ee3e3cdff1c4ac))
- **Brief:** a person the owner fully trusts directs agents, like their human and the owner (T548) ([#1372](https://github.com/kiwi-init/channels/pull/1372)) ([625e53e](https://github.com/kiwi-init/channels/commit/625e53e03cf45f1ce9b31c98e2397f0841415507))
- **Presence:** a person's app says it's here, so people show online to each other (T560) ([#1373](https://github.com/kiwi-init/channels/pull/1373)) ([875a184](https://github.com/kiwi-init/channels/commit/875a184e900dfd8ec205b04f4e7ca2b436cbd262))
- **Faces:** your GitHub picture is published once GitHub is linked, not only when the channel opens ([#1374](https://github.com/kiwi-init/channels/pull/1374)) ([b90de4f](https://github.com/kiwi-init/channels/commit/b90de4fbc195d4ca831f1ca375cd41f474f82555))
- **Hosted relay:** no limits on channels, members, messages, or how long a channel lives (T604) ([#1375](https://github.com/kiwi-init/channels/pull/1375)) ([b63304d](https://github.com/kiwi-init/channels/commit/b63304d8a49fc18c726a75e716aaf5b0a3e92c93))
- **GIFs are back:** a picker in the composer, GIF reactions under messages, kiwi react --list (T585) ([#1376](https://github.com/kiwi-init/channels/pull/1376)) ([b31d98b](https://github.com/kiwi-init/channels/commit/b31d98be562e089b58ac3751b14cacd2fa5e6839))
- A person the owner fully trusts sets up the channel: repos, rooms, charter, branch prefix (T632) ([#1377](https://github.com/kiwi-init/channels/pull/1377)) ([958e37d](https://github.com/kiwi-init/channels/commit/958e37d336de355732743a0469d503d3ed6cf18d))
- **Main green:** the brief drops the GIF line, and the composer's GIF button leaves the first load (T654) ([#1378](https://github.com/kiwi-init/channels/pull/1378)) ([70265a9](https://github.com/kiwi-init/channels/commit/70265a9ceb9cdf4d880dd043d0f3e809e8cb2268))

## 2026.10.13 — 2026-10-30

Tag [v2026.10.13](https://github.com/kiwi-init/channels/releases/tag/v2026.10.13) · commit [2916a44](https://github.com/kiwi-init/channels/commit/2916a44cdf600ff23915e0987406e032fd51213f) · 2026-10-30

### Other changes

- **Phones:** an @handle in a message reads as the member's nickname, as on desktop (#1251) ([#1291](https://github.com/kiwi-init/channels/pull/1291)) ([ef36cb6](https://github.com/kiwi-init/channels/commit/ef36cb67288eb7352ae070f90cfd3bef76b7267f))
- **Terminal:** shells and agents open in their folder after an update deletes tmux's (T12) ([#1313](https://github.com/kiwi-init/channels/pull/1313)) ([2319e5a](https://github.com/kiwi-init/channels/commit/2319e5a2955797d5d1c51dee18b61d9492f604fe))
- **Daemon:** the socket answers only a caller holding its token, and gates bypass launches and re-pairing ([#1312](https://github.com/kiwi-init/channels/pull/1312)) ([eddea73](https://github.com/kiwi-init/channels/commit/eddea73ca53c888f3decb1a306ef47af4e625d85))
- **Add agent:** a launch that dies at start says so, every launch is logged, and the panel follows the real join (T17) ([#1314](https://github.com/kiwi-init/channels/pull/1314)) ([21022ac](https://github.com/kiwi-init/channels/commit/21022ac77ea1259d164ccaea629f87d4a5c9d53a))
- **Launch:** a dead pane counts as ended only once tmux has its exit status, so a busy computer doesn't read exit 1 as exit 0 (T17) ([#1318](https://github.com/kiwi-init/channels/pull/1318)) ([451804f](https://github.com/kiwi-init/channels/commit/451804fabf0442f700afc3517d2943f2a23dbe93))
- **Terminal:** no blinking bar down its left edge (T21) ([#1317](https://github.com/kiwi-init/channels/pull/1317)) ([27e5f38](https://github.com/kiwi-init/channels/commit/27e5f38457c4cf812c43d7b42313e388be71548e))
- **Terminals:** the tmux helpers are back, and the daemon no longer takes them away on start (T14) ([#1319](https://github.com/kiwi-init/channels/pull/1319)) ([da52fc3](https://github.com/kiwi-init/channels/commit/da52fc3953ef85dc429f355265cd9fc3eb6c01db))
- **ui:** the renderer links only what a click opens, and shows a remote picture as a link (#1308) ([#1316](https://github.com/kiwi-init/channels/pull/1316)) ([163d6e0](https://github.com/kiwi-init/channels/commit/163d6e06ea75383f3fee20053a37dafa9558c67e))
- **Core:** a wrapped key nobody signed never opens, whatever the channel's age ([#1321](https://github.com/kiwi-init/channels/pull/1321)) ([2f6ca76](https://github.com/kiwi-init/channels/commit/2f6ca763921d32030b39a3d5bb4e83b07d4d35a7))
- **Updates:** the installer and kiwi upgrade install only a release the pinned minisign key signed ([#1315](https://github.com/kiwi-init/channels/pull/1315)) ([1b07efc](https://github.com/kiwi-init/channels/commit/1b07efc072f368f675a3796c5c34ae3a7b7c453c))
- **UI:** one design system, motion that answers you, Settings gets one home ([#1320](https://github.com/kiwi-init/channels/pull/1320)) ([b8b97bd](https://github.com/kiwi-init/channels/commit/b8b97bd096331fffd0fe697e7b807f7a6f002cbb))
- **Login:** a computer checks its person's key with the person, and refuses another person until kiwi unpair (#1304) ([#1322](https://github.com/kiwi-init/channels/pull/1322)) ([2014048](https://github.com/kiwi-init/channels/commit/20140486683c66206ac051bd38f3675dddf7d99a))
- **Relay:** a room request is signature-checked before its room is opened, and the launch limits are on ([#1325](https://github.com/kiwi-init/channels/pull/1325)) ([5c00890](https://github.com/kiwi-init/channels/commit/5c00890ad6c2a9533c2ac96d53136cca889866b9))
- **Seats:** a second Gemini CLI in a checkout is its own agent, held by its own process (T102) ([#1327](https://github.com/kiwi-init/channels/pull/1327)) ([716ab9c](https://github.com/kiwi-init/channels/commit/716ab9c306ffe72959970dd7ab7e787d83ad6866))
- **Add agent:** a harness that counts every start getting all the way in, and concurrent first starts no longer collide in tmux (T19) ([#1324](https://github.com/kiwi-init/channels/pull/1324)) ([9518503](https://github.com/kiwi-init/channels/commit/95185036eef89b186aaa57ec473f28ddbcbe3dcc))
- **Enrollment:** a new desktop or phone checks its person's key with the person, and keeps nothing until then (#1323) ([#1326](https://github.com/kiwi-init/channels/pull/1326)) ([69bbb5e](https://github.com/kiwi-init/channels/commit/69bbb5e0dbf9a8ecb4bbfb820f304cb5aeb7eea0))
- **Daemon:** another device starts agents only where seats work and in folders added by hand, not in every home git repo (#1303) ([#1328](https://github.com/kiwi-init/channels/pull/1328)) ([95c5b0e](https://github.com/kiwi-init/channels/commit/95c5b0ea8c3b2d926b64ebbe8b236f9fd043f9e0))
- **Test:** the old-relay stand-in refuses a socket its relay refuses, so the client falls back to the old signature (#1329) ([#1330](https://github.com/kiwi-init/channels/pull/1330)) ([bd90acc](https://github.com/kiwi-init/channels/commit/bd90acc152a8f86454fd11097782457212d096e8))
- **Secrets:** the plain-browser key store is a development build's tool, and a page's URL steers nothing in production ([#1332](https://github.com/kiwi-init/channels/pull/1332)) ([9a795f7](https://github.com/kiwi-init/channels/commit/9a795f722289e839438ab06219fb89fe9880680d))
- **Seats:** an agent Channels started is told apart by its launch, whatever runs it (T101) ([#1331](https://github.com/kiwi-init/channels/pull/1331)) ([335e3e0](https://github.com/kiwi-init/channels/commit/335e3e0481ff256184bfc708e2bce23b32156892))
- **Android:** the release build signs with the repo's own keystore, or not at all ([#1339](https://github.com/kiwi-init/channels/pull/1339)) ([b67b0fc](https://github.com/kiwi-init/channels/commit/b67b0fc32a4d16a011526c72df12888aa1f5ba06))
- **Core:** the grindable verification code is gone (#1306) ([#1333](https://github.com/kiwi-init/channels/pull/1333)) ([402dd97](https://github.com/kiwi-init/channels/commit/402dd97ea218f9d6945049d3ca78b4d216ba2f2e))
- **Docs:** the relay sees the owner's GitHub link token; SECURITY.md says so (#1310) ([#1336](https://github.com/kiwi-init/channels/pull/1336)) ([0546f2c](https://github.com/kiwi-init/channels/commit/0546f2c899be8ce5bdc62c43f1480420475e1f76))
- **Repo:** dependency install scripts run only for trusted packages, and the ignore list covers worktrees and SQLite sidecars (#1309) ([#1337](https://github.com/kiwi-init/channels/pull/1337)) ([f1e7576](https://github.com/kiwi-init/channels/commit/f1e7576023dc17ae5b92ffcfeb87aae6258b049c))
- **Core:** presence opens only under the channel's current key (#1301) ([#1338](https://github.com/kiwi-init/channels/pull/1338)) ([91b771f](https://github.com/kiwi-init/channels/commit/91b771f05ed392af2cb63cb935e11128dec53962))
- **Core:** a github note's link is a plain https link, or the note is dropped (#1299) ([#1334](https://github.com/kiwi-init/channels/pull/1334)) ([3bbb3c6](https://github.com/kiwi-init/channels/commit/3bbb3c6d4329a708a05389965dd8cee23c2f85e7))
- **Core:** a join line's relay is https, or plain http on this computer (#1305) ([#1335](https://github.com/kiwi-init/channels/pull/1335)) ([78f09fc](https://github.com/kiwi-init/channels/commit/78f09fcf5c3e3c3a9e76b4c012f6813edb876d7b))
- **Invite line:** an agent gets in from any shell, even before kiwi is on its PATH or on that computer at all (T172) ([#1343](https://github.com/kiwi-init/channels/pull/1343)) ([06ebadf](https://github.com/kiwi-init/channels/commit/06ebadf12d2050e672659ff3b696737b528b8cb6))
- **Relay:** creating a channel takes a GitHub sign-in through the relay's GitHub App, beside WorkOS (T169) ([#1342](https://github.com/kiwi-init/channels/pull/1342)) ([f845ddb](https://github.com/kiwi-init/channels/commit/f845ddb4ab162d2e61483d915bfdd9f36e5e7c66))
- **Top bar:** opening search leaves the tabs where they are (T191) ([#1348](https://github.com/kiwi-init/channels/pull/1348)) ([418f07a](https://github.com/kiwi-init/channels/commit/418f07ac9a68c2b19424395a471ea8991d15399d))
- **Rail:** a Home tile on top opens the first screen, and the channel tiles sit under it (T196) ([#1347](https://github.com/kiwi-init/channels/pull/1347)) ([dcc7a31](https://github.com/kiwi-init/channels/commit/dcc7a3155dc145b2273bed46eedf4cb12979f6a7))
- Add agent and Welcome say what Channels is: invite an agent you already run, or have Channels start one (T173) ([#1346](https://github.com/kiwi-init/channels/pull/1346)) ([37e8587](https://github.com/kiwi-init/channels/commit/37e85878999568bd8fb70231cb989fdf6f24c5a0))
- **First run:** Sign in with GitHub comes first, and it is also the GitHub link (T171) ([#1349](https://github.com/kiwi-init/channels/pull/1349)) ([cb0c3cc](https://github.com/kiwi-init/channels/commit/cb0c3cce01cbf5a49522d04de21e6f32b97f08fb))
- **CI:** the smoke and perf harnesses drive a harness build with the plain-browser key store (#1344) ([#1345](https://github.com/kiwi-init/channels/pull/1345)) ([7bc0d77](https://github.com/kiwi-init/channels/commit/7bc0d7708d1d7a51fdddca44cbb968be5c52ba90))
- **Phones:** sign in with GitHub, the same device flow as the desktop (T254) ([#1350](https://github.com/kiwi-init/channels/pull/1350)) ([c02eb85](https://github.com/kiwi-init/channels/commit/c02eb857340535bc4623f9dff43a76bb516f4c63))
- **Android build:** an empty keystore secret counts as unset (T312) ([#1353](https://github.com/kiwi-init/channels/pull/1353)) ([0596152](https://github.com/kiwi-init/channels/commit/0596152804d44921a68734ae8dca5ee82690d2d5))
- **UI:** the first load is back under its budget, with 7 KB of room (T316) ([#1355](https://github.com/kiwi-init/channels/pull/1355)) ([625734b](https://github.com/kiwi-init/channels/commit/625734b30184cd3e34d20651585dccbe7638c1bf))
- **Relay:** a WorkOS account moves to its github_<id> once, signed in with both (T261) ([#1356](https://github.com/kiwi-init/channels/pull/1356)) ([99483ec](https://github.com/kiwi-init/channels/commit/99483ecbef9c271cdc668393705b853daa884db0))
- **Top bar:** its buttons float like a Mac toolbar's, not baked into the bar (T294) ([#1352](https://github.com/kiwi-init/channels/pull/1352)) ([0fd5c32](https://github.com/kiwi-init/channels/commit/0fd5c32613137db70e419a8ebab25d09aa7a0f9b))
- **Portrait screens:** one tall page with agents, tasks and chat in view together (T128) ([#1341](https://github.com/kiwi-init/channels/pull/1341)) ([d8ebcce](https://github.com/kiwi-init/channels/commit/d8ebcce3ba15b6d0cc5588de4059c15f1b14ef78))
- **Desktop:** a computer holding both sign-ins moves the account to GitHub by itself, once (T261) ([#1357](https://github.com/kiwi-init/channels/pull/1357)) ([4eeaac6](https://github.com/kiwi-init/channels/commit/4eeaac6a823d2c30dcb0d087fc324920a106f807))
- Rail, composer and terminal: the rest of the chrome floats (T367) ([#1359](https://github.com/kiwi-init/channels/pull/1359)) ([2d93712](https://github.com/kiwi-init/channels/commit/2d9371266c17c8509b5dc462518f2c53b7645ecc))
- **Top bar:** the sidebar button stays in one place, open or collapsed (T392) ([#1361](https://github.com/kiwi-init/channels/pull/1361)) ([cd8a8cb](https://github.com/kiwi-init/channels/commit/cd8a8cba35dc648ed2ae5c7b1aa6c17508bee82d))

## 2026.10.12 — 2026-10-30

Tag [v2026.10.12](https://github.com/kiwi-init/channels/releases/tag/v2026.10.12) · commit [d68bdca](https://github.com/kiwi-init/channels/commit/d68bdca3ce9b0e9bce288f124f59c9d2e59e550e) · 2026-10-30

### Other changes

- **Channel:** web/src/lib/channel moves into packages/channel (T494) ([#1245](https://github.com/kiwi-init/channels/pull/1245)) ([58c9c31](https://github.com/kiwi-init/channels/commit/58c9c31d99cd89e578a528be452bd36e91f4b65c))
- **Feed:** fold runs of events into one line (T620) ([#1250](https://github.com/kiwi-init/channels/pull/1250)) ([4126f30](https://github.com/kiwi-init/channels/commit/4126f30f8215f404fa31fc4563ae6f14e4984d2e))
- **Markdown:** mermaid diagrams render again (T635) ([#1252](https://github.com/kiwi-init/channels/pull/1252)) ([4970df5](https://github.com/kiwi-init/channels/commit/4970df5b0fdb95467c8bc092b10c0aa5b68dc06f))
- **Messages:** rows say what they are, with receipts and quotes (T641) ([#1253](https://github.com/kiwi-init/channels/pull/1253)) ([2b8dc61](https://github.com/kiwi-init/channels/commit/2b8dc61921adeda40fcf4d4b0ca019eb1a9a0c13))
- **App:** web/src/lib's last shared helpers move into packages/app (T650) ([#1254](https://github.com/kiwi-init/channels/pull/1254)) ([078c613](https://github.com/kiwi-init/channels/commit/078c613b449220a5a87bb0cd9fa576f1b2d036dd))
- **ui:** receipts.ts takes roomOfMessage from @kiwi/app (T716) ([#1258](https://github.com/kiwi-init/channels/pull/1258)) ([0c668e9](https://github.com/kiwi-init/channels/commit/0c668e94663d6ab6174ac82c7deba081f4e6b2e8))
- **Feed:** compaction shows as a fold, with an Approve card (T663) ([#1255](https://github.com/kiwi-init/channels/pull/1255)) ([00783b9](https://github.com/kiwi-init/channels/commit/00783b9ab5500902ee93eaff266f6f72fbb829da))
- **Retire web/:** scripts, tests and CI build, smoke and shoot ui/ (T716) ([#1259](https://github.com/kiwi-init/channels/pull/1259)) ([8fc8327](https://github.com/kiwi-init/channels/commit/8fc832771b0130859899efbc2f4fe0641c28e6e4))
- Add new screenshot and demo explanation to README ([#1260](https://github.com/kiwi-init/channels/pull/1260)) ([81036a5](https://github.com/kiwi-init/channels/commit/81036a56f09c334d44c209cef9f0cf133f2c8f14))
- **Terminal:** Your terminal opens a shell, not a tmux error (T701) ([#1256](https://github.com/kiwi-init/channels/pull/1256)) ([38f58e8](https://github.com/kiwi-init/channels/commit/38f58e849a4d0d9bc4af5a8b9984b99c5c7755e6))
- **Devices:** the owner can delegate admitting its own computer's agents (T677) ([#1257](https://github.com/kiwi-init/channels/pull/1257)) ([a1302ff](https://github.com/kiwi-init/channels/commit/a1302fff3d35894f44efa7b6d94f60c94e3b238a))
- **perf:** perf-feel, perf-scale, perf-switch and perf-motion drive ui/ (T756) ([#1263](https://github.com/kiwi-init/channels/pull/1263)) ([2924a56](https://github.com/kiwi-init/channels/commit/2924a56d9c638efd2cc2f1936bfee83ee1a9d04e))
- **CI:** eb-env-check cleanup tolerates an exited process (T761) ([#1262](https://github.com/kiwi-init/channels/pull/1262)) ([b03cdc2](https://github.com/kiwi-init/channels/commit/b03cdc2b45dc5c9fb2b2fa8d5cb9072b9a7d3579))
- **Composer:** clicking a stash brings it back in WebKit (T788) ([#1264](https://github.com/kiwi-init/channels/pull/1264)) ([c4c3bcf](https://github.com/kiwi-init/channels/commit/c4c3bcf6a2d9905f90d5cc8f1735ea40bcbd3d4c))
- **Retire web/:** delete it (T766) ([#1261](https://github.com/kiwi-init/channels/pull/1261)) ([2720050](https://github.com/kiwi-init/channels/commit/27200503d62bff560bd872483e5247f6dbfe252b))
- **Recovery:** 24 words, the recovery chain and the vault format in core (T693) ([#1267](https://github.com/kiwi-init/channels/pull/1267)) ([e2f90f0](https://github.com/kiwi-init/channels/commit/e2f90f0ab8a621b863d627a53bb8908ab5612ed8))
- DESIGN.md describes ui/, not web/ (T780) ([#1268](https://github.com/kiwi-init/channels/pull/1268)) ([0b1b8f8](https://github.com/kiwi-init/channels/commit/0b1b8f89df1e05112e269b31dba177bbfac2951c))
- **ui:** the first load drops from 952 KB to 739 KB, budget 760 KB (T814) ([#1266](https://github.com/kiwi-init/channels/pull/1266)) ([3f7145d](https://github.com/kiwi-init/channels/commit/3f7145d2ff87cc67979e954c31dae27dfe9f655e))
- **Devices:** the daemon lets its own computer's agents in (T683) ([#1265](https://github.com/kiwi-init/channels/pull/1265)) ([c7ee287](https://github.com/kiwi-init/channels/commit/c7ee28715a5a6d10acd339a65d0a6e38d9f9fc92))
- **Recovery:** the relay keeps the recovery chain and vault versions (T823) ([#1269](https://github.com/kiwi-init/channels/pull/1269)) ([51590e6](https://github.com/kiwi-init/channels/commit/51590e6db4ad001c333a909442c11dd631fcef2a))
- **Icons:** the app draws Hugeicons, and more of them (T524) ([#1249](https://github.com/kiwi-init/channels/pull/1249)) ([f900531](https://github.com/kiwi-init/channels/commit/f9005315b216528b0e098b1c45d9bf24bcaedea7))
- **Loop:** a messages session reads only what's for it and replies only where it's asked (#1270) ([#1271](https://github.com/kiwi-init/channels/pull/1271)) ([24e4339](https://github.com/kiwi-init/channels/commit/24e4339bff0a89bf36a0071d2a9d7308444cb78e))
- **Sessions:** new agents open only in Channels' own tmux; Terminal.app, Prefer and the tmux helpers go (T374) ([#1248](https://github.com/kiwi-init/channels/pull/1248)) ([62ebb7b](https://github.com/kiwi-init/channels/commit/62ebb7bd03ac3e4a0b3647ac52928d78b0193209))
- **Loop:** a seat hold records its loop's process, and lapses when that process is gone (#1272) ([#1273](https://github.com/kiwi-init/channels/pull/1273)) ([9fffe9b](https://github.com/kiwi-init/channels/commit/9fffe9b489bdecf569fb66db2d8b8a1dc96ea4de))
- **Devices:** computers trust your device list, not only the person key (T826) ([#1277](https://github.com/kiwi-init/channels/pull/1277)) ([47e7912](https://github.com/kiwi-init/channels/commit/47e791252fe7904151944069edc07e115436e3df))
- **Devices:** the owner's app issues, renews and revokes delegations (T684) ([#1275](https://github.com/kiwi-init/channels/pull/1275)) ([a31ad78](https://github.com/kiwi-init/channels/commit/a31ad788b8f0803ebece75331452bd482cc335da))
- **desktop / mac:** the size check's dmg is tried again when hdiutil flakes (T928) ([#1279](https://github.com/kiwi-init/channels/pull/1279)) ([17ffcb2](https://github.com/kiwi-init/channels/commit/17ffcb25b8fa7deca33490581db333fa308a305d))
- **Devices:** the desktop signs with its device key (T898) ([#1280](https://github.com/kiwi-init/channels/pull/1280)) ([f4e9dce](https://github.com/kiwi-init/channels/commit/f4e9dce8d63c02295be2b3567143ec6b4d40201d))
- **Test:** the remote-launch flow logs each tmux call to its own file (T948) ([#1281](https://github.com/kiwi-init/channels/pull/1281)) ([5a11654](https://github.com/kiwi-init/channels/commit/5a116545cb9e6f99724b3168967fe8d2aa9e9a29))
- **Linux:** the AppImage keeps its own desktop entry, and its menu start needs no FUSE (#1284, #1283) ([#1285](https://github.com/kiwi-init/channels/pull/1285)) ([51fd497](https://github.com/kiwi-init/channels/commit/51fd497793d1ee5c8312e2cf59160286af02309c))
- **Loop:** a reviewer's loop takes a round open to anyone, naming itself first (#1244) ([#1289](https://github.com/kiwi-init/channels/pull/1289)) ([1a52000](https://github.com/kiwi-init/channels/commit/1a52000303b282122384ad02932105295306dedc))
- **Linux:** the Needs-you chime plays through WebAudio, so a missing GStreamer sink no longer crashes the window (#1278) ([#1290](https://github.com/kiwi-init/channels/pull/1290)) ([5a09fac](https://github.com/kiwi-init/channels/commit/5a09fac26a5e3bdb06fc03196394b06a310b89ad))
- **Daemons:** an older daemon gives way to the app's copy when the CLI can't be kept (T1032) ([#1293](https://github.com/kiwi-init/channels/pull/1293)) ([8152bd8](https://github.com/kiwi-init/channels/commit/8152bd8a4a5e735f0ba011ec8a94fa9e4bbd9ea0))

## 2026.10.11 — 2026-10-29

Tag [v2026.10.11](https://github.com/kiwi-init/channels/releases/tag/v2026.10.11) · commit [7f8bfd7](https://github.com/kiwi-init/channels/commit/7f8bfd72486672484539acc95999828132ea1a99) · 2026-10-29

### Other changes

- **Loop:** the terminal's mode comes back after each session, so Ctrl-C stops the loop again (#1174) ([#1207](https://github.com/kiwi-init/channels/pull/1207)) ([823aa01](https://github.com/kiwi-init/channels/commit/823aa01aa6e24ed29054c8f312476d21fda89bfc))
- **Listen:** --now says when the seat's own `kiwi listen` already took its messages (#1170) ([#1208](https://github.com/kiwi-init/channels/pull/1208)) ([6112bff](https://github.com/kiwi-init/channels/commit/6112bff4c069625e8693f42c06f5ee73c6280ce9))
- **Settings:** Link a phone shows the QR again, with the code wrapped under it (T11) ([#1209](https://github.com/kiwi-init/channels/pull/1209)) ([cf1e71e](https://github.com/kiwi-init/channels/commit/cf1e71e216c1ac77470d691b6a32218107aa5b50))
- **Themes:** OLED Black, a true black, is the default dark (T43) ([#1211](https://github.com/kiwi-init/channels/pull/1211)) ([6891ae6](https://github.com/kiwi-init/channels/commit/6891ae64ab30be2e6684255401f2d21667f87a69))
- **Profile:** the colour picker goes (T64) ([#1212](https://github.com/kiwi-init/channels/pull/1212)) ([786ad6f](https://github.com/kiwi-init/channels/commit/786ad6f28cf0d2ba7b8371e3eba3f1a86bbc60b3))
- **Settings:** Link a phone and Add a computer are sign-in plus 6 digits, no QR ([#1217](https://github.com/kiwi-init/channels/pull/1217)) ([33e0aae](https://github.com/kiwi-init/channels/commit/33e0aaefd10344dfab1b4d15a6810f09c7efe8f2))
- **Linking:** kiwi login replaces kiwi pair, and the kl1 link code is gone (T112) ([#1219](https://github.com/kiwi-init/channels/pull/1219)) ([b086b43](https://github.com/kiwi-init/channels/commit/b086b43ffb82b0fa08f338cbd69e7a32d3431795))
- **CI:** android / build gets 45 minutes, its screen tests alone take 18-27 ([#1220](https://github.com/kiwi-init/channels/pull/1220)) ([9af0061](https://github.com/kiwi-init/channels/commit/9af006164b39bc5095485e2dcd53396faba3a13a))
- **Test:** the hook listener is armed before the `kiwi listen` beside it starts ([#1222](https://github.com/kiwi-init/channels/pull/1222)) ([aa880b8](https://github.com/kiwi-init/channels/commit/aa880b802d4b662713b46644cc65d1dd1219ec1e))
- **Android:** screen shots run under a Compose test rule, so the sign-in spinners don't stall them ([#1224](https://github.com/kiwi-init/channels/pull/1224)) ([58809f5](https://github.com/kiwi-init/channels/commit/58809f5f37f1d2a3ffa2d4b95a5cee9c3e856ff9))
- **Fold:** a base records the fold rules it was folded under, and one from older rules is folded again (#1116) ([#1213](https://github.com/kiwi-init/channels/pull/1213)) ([119d9e2](https://github.com/kiwi-init/channels/commit/119d9e27d191a66a19f2df2dd4665dc695233d1f))
- **Phones:** sign-in only; Scan the code, Paste the code and kiwi://link are gone (T111) ([#1218](https://github.com/kiwi-init/channels/pull/1218)) ([e0d485e](https://github.com/kiwi-init/channels/commit/e0d485eb79ae2173d78692b00f8bf1607df3c684))
- **Markdown:** tables sort, long inline code copies, wide code fades (T216) ([#1229](https://github.com/kiwi-init/channels/pull/1229)) ([7880d9f](https://github.com/kiwi-init/channels/commit/7880d9f6da0b18ef6ceca7141405d72362d65833))
- **Secrets:** the person's keys at rest move out of web/ into packages/secrets (T212) ([#1226](https://github.com/kiwi-init/channels/pull/1226)) ([3646080](https://github.com/kiwi-init/channels/commit/36460801d8cb5838580f3bc5e52898685936b1aa))
- **Images:** every image fits the relay at full resolution, never refused (T162) ([#1221](https://github.com/kiwi-init/channels/pull/1221)) ([7506950](https://github.com/kiwi-init/channels/commit/750695001bcfe3d7158bfc4dfa3c30e22fbacf4d))
- **Feed:** browser handoffs show again, with Open browser, Done and Couldn't (T197) ([#1223](https://github.com/kiwi-init/channels/pull/1223)) ([06c7cf0](https://github.com/kiwi-init/channels/commit/06c7cf001533d099288fd851732cc966a79fa80d))
- **Phones:** the sign-in mark and Android's icon are the app's mark, not the old starburst (T12) ([#1214](https://github.com/kiwi-init/channels/pull/1214)) ([cf8e550](https://github.com/kiwi-init/channels/commit/cf8e55088d624861c8ecc892590876f4cc0016e8))
- **Phones:** Sign In opens or says why, and WorkOS goes through the app (T13) ([#1210](https://github.com/kiwi-init/channels/pull/1210)) ([534a1df](https://github.com/kiwi-init/channels/commit/534a1dfa8490d7808288342e4b476034096fc029))
- **Tasks:** a done digest for a task the fold doesn't have done is refused and marked (#1227) ([#1228](https://github.com/kiwi-init/channels/pull/1228)) ([335378c](https://github.com/kiwi-init/channels/commit/335378cce01f125b539c6e2b6876d62c5ed9c691))
- **Feed:** forged and refused messages are shown, not dropped (T204) ([#1225](https://github.com/kiwi-init/channels/pull/1225)) ([6dbb5a4](https://github.com/kiwi-init/channels/commit/6dbb5a40e88e9842b8a12ba4dd50cabe1401b584))
- **Composer:** Cmd/Ctrl+S stashes the draft, Shift+Cmd+S brings it back (T263) ([#1231](https://github.com/kiwi-init/channels/pull/1231)) ([d13cfbe](https://github.com/kiwi-init/channels/commit/d13cfbefe3ba251edf77b1e7612b7b6d044fd1cc))
- **Channel:** the pure channel helpers move out of web/ into packages/channel (T396) ([#1233](https://github.com/kiwi-init/channels/pull/1233)) ([40f7909](https://github.com/kiwi-init/channels/commit/40f7909c1d0360553cbb3de5f8902f5a82f8d650))
- **Terminal:** a terminal icon in the channel header opens your own shell (T373) ([#1232](https://github.com/kiwi-init/channels/pull/1232)) ([010b03c](https://github.com/kiwi-init/channels/commit/010b03c0aab32af770c27419fdabeb9d7ae25b44))
- **Settings:** Link a phone says why it can't see the phone (T436) ([#1235](https://github.com/kiwi-init/channels/pull/1235)) ([a5d7a67](https://github.com/kiwi-init/channels/commit/a5d7a676370d928b2ccbe459631cb007f9cbb44f))
- **Sessions:** tmux ships inside the app, and the daemon uses that copy first (T360) ([#1234](https://github.com/kiwi-init/channels/pull/1234)) ([e5b5d49](https://github.com/kiwi-init/channels/commit/e5b5d491b98b760c070448cd3527567bd7451ac0))
- **Sign-in:** the session ends when its access token does (T535) ([#1238](https://github.com/kiwi-init/channels/pull/1238)) ([a7c0fd3](https://github.com/kiwi-init/channels/commit/a7c0fd3a3d80083b4973d8a542ec84b410ed450a))
- **Devices:** the owner's own phone joins channels the app made (T552) ([#1239](https://github.com/kiwi-init/channels/pull/1239)) ([5b7c4bc](https://github.com/kiwi-init/channels/commit/5b7c4bcd8034605d3bdd2e1954721f0d7b5e0833))
- **Chat:** the markdown hint under the composer goes, Jump to latest clicks everywhere (T525) ([#1240](https://github.com/kiwi-init/channels/pull/1240)) ([dec413a](https://github.com/kiwi-init/channels/commit/dec413a259760164636aa0b458537421260d9149))
- **Add agent:** lists the agents found on the computer, and how to get the rest (T375) ([#1237](https://github.com/kiwi-init/channels/pull/1237)) ([00480e9](https://github.com/kiwi-init/channels/commit/00480e9fffda3d812cbffead0bba4e3af81ed0e9))
- **Sidebar:** Settings is a gear, updates and asks are cards (T522) ([#1241](https://github.com/kiwi-init/channels/pull/1241)) ([286b519](https://github.com/kiwi-init/channels/commit/286b5196cf008867e05a41d249d3a7dbdd7ebbd3))
- **Phones:** signing in again replaces the stuck request (T345) ([#1242](https://github.com/kiwi-init/channels/pull/1242)) ([1cf9756](https://github.com/kiwi-init/channels/commit/1cf975663424ab57321e43d84ccb6e53b8ded55b))
- **Channel:** the store's own modules move out of web/ into packages/channel (T488) ([#1236](https://github.com/kiwi-init/channels/pull/1236)) ([95c2f5a](https://github.com/kiwi-init/channels/commit/95c2f5a70f5c9178f4aad3f2f0ef887af1986588))
- **Phones:** the sign-in is saved even when the phone locks (T347) ([#1243](https://github.com/kiwi-init/channels/pull/1243)) ([e3bf0b1](https://github.com/kiwi-init/channels/commit/e3bf0b174774ce06474bde7014988da6b19f7d4d))

## 2026.10.10 — 2026-10-29

Tag [v2026.10.10](https://github.com/kiwi-init/channels/releases/tag/v2026.10.10) · commit [b97bd69](https://github.com/kiwi-init/channels/commit/b97bd69d9328562c90b2b490540120197e907ad5) · 2026-10-29

### Other changes

- **Loop:** a task marked first goes before its owner's other tasks (#1158) ([#1163](https://github.com/kiwi-init/channels/pull/1163)) ([ed10720](https://github.com/kiwi-init/channels/commit/ed1072050f500a14ff30f82086494a65035c2835))
- **Loop:** a task waiting behind a live session is said, then told to the lead (#1154) ([#1165](https://github.com/kiwi-init/channels/pull/1165)) ([e26d22f](https://github.com/kiwi-init/channels/commit/e26d22fac8046e52727e7101351292a4eb099199))
- **Hooks:** ZCode gets a Stop hook that keeps its listener armed (#1155) ([#1169](https://github.com/kiwi-init/channels/pull/1169)) ([84e9db4](https://github.com/kiwi-init/channels/commit/84e9db42f32ff9b126d12a49665552d4bb3293a5))
- Revise README structure and update images ([#1182](https://github.com/kiwi-init/channels/pull/1182)) ([18f9c25](https://github.com/kiwi-init/channels/commit/18f9c25403b128adefa8194303fd435319883ed0))
- **App:** a sound when something needs you, silent everywhere else ([#1183](https://github.com/kiwi-init/channels/pull/1183)) ([03cd6c0](https://github.com/kiwi-init/channels/commit/03cd6c039975f9349ca5e8559d7b4d4292403edb))
- **Loop:** ZCode gets a recipe, so a ZCode seat runs a fresh session per task or round (#1157) ([#1180](https://github.com/kiwi-init/channels/pull/1180)) ([0e1d4f0](https://github.com/kiwi-init/channels/commit/0e1d4f0b04b47b1bb414509bd6737266ba6e1e04))
- Land sink/ui on main ([#1204](https://github.com/kiwi-init/channels/pull/1204)) ([0e5a521](https://github.com/kiwi-init/channels/commit/0e5a5217ca7f07c6f64bf29c2ea24634421ccf37))
- Land sink/platform on main ([#1205](https://github.com/kiwi-init/channels/pull/1205)) ([b3cf4b3](https://github.com/kiwi-init/channels/commit/b3cf4b3546304ccd3b2062f04d91d0d9dbf574fa))

## 2026.10.9 — 2026-10-28

Tag [v2026.10.9](https://github.com/kiwi-init/channels/releases/tag/v2026.10.9) · commit [616eacb](https://github.com/kiwi-init/channels/commit/616eacb749b3ba837e3d0cd4da5762c765c8e76f) · 2026-10-28

### Other changes

- **Update:** Download and restart downloads and restarts, instead of opening the release page (T351) ([#1093](https://github.com/kiwi-init/channels/pull/1093)) ([6fbe89b](https://github.com/kiwi-init/channels/commit/6fbe89b40552ce9359a9390e84b5d66f59e68eee))
- **Feed:** members who left keep their avatar and profile (T369) ([#1094](https://github.com/kiwi-init/channels/pull/1094)) ([c3ae9e6](https://github.com/kiwi-init/channels/commit/c3ae9e6f04cb5a5b49461efa9e2cae0e471459dd))
- **Profile:** nickname, colour and powers are back (T380, members) ([#1099](https://github.com/kiwi-init/channels/pull/1099)) ([421f83a](https://github.com/kiwi-init/channels/commit/421f83a46de66a8a82fad22bf61c2308aa98bad1))
- **Settings:** the Agents page saves its folders and new-agent switches (T380) ([#1100](https://github.com/kiwi-init/channels/pull/1100)) ([135426e](https://github.com/kiwi-init/channels/commit/135426ec07f0700fba27ee0632fd4cacee81b0cd))
- **Desktop:** search lists results to jump to ([#1096](https://github.com/kiwi-init/channels/pull/1096)) ([3ed6cba](https://github.com/kiwi-init/channels/commit/3ed6cbab37069cc6c1276e3bcba595264ec24937))
- Add a refresh-dependencies project skill (#1097) ([#1098](https://github.com/kiwi-init/channels/pull/1098)) ([caadadf](https://github.com/kiwi-init/channels/commit/caadadf9e2cb7970b2c270487d3acc31ccafe771))
- **Channel panel:** History downloads save the file again (T380) ([#1101](https://github.com/kiwi-init/channels/pull/1101)) ([71bf1b9](https://github.com/kiwi-init/channels/commit/71bf1b94eeceefd1ab19465a933bcca8bac2df5e))
- **Updates:** one click on the dock button, no card (T398) ([#1104](https://github.com/kiwi-init/channels/pull/1104)) ([a7fad43](https://github.com/kiwi-init/channels/commit/a7fad4352e5571b65b36cdbe3e27af250ea4c1f0))
- **Settings:** make, edit and delete your own personalities (T380) ([#1105](https://github.com/kiwi-init/channels/pull/1105)) ([1df293e](https://github.com/kiwi-init/channels/commit/1df293e758b15cc55dd3c0c39f31e6c8735d3d1d))
- **Channel panel:** choose the channel's image and rename rooms (T380) ([#1102](https://github.com/kiwi-init/channels/pull/1102)) ([7489959](https://github.com/kiwi-init/channels/commit/7489959fa2eb8e0f7c81e839623a02bce7af35b0))
- **Settings:** Check for updates says what it found, and the relay can be changed (T380) ([#1107](https://github.com/kiwi-init/channels/pull/1107)) ([609509b](https://github.com/kiwi-init/channels/commit/609509bb5edbf0cd4784ca27622dd5547e403423))
- **Channel panel:** Write to GitHub and the branch prefix are back (T380) ([#1103](https://github.com/kiwi-init/channels/pull/1103)) ([c7a9ba4](https://github.com/kiwi-init/channels/commit/c7a9ba41999142009de882d00f73d4c1eaae39ca))
- **Settings and faces:** the unencrypted-keys notice, and your GitHub picture as your face (T380) ([#1109](https://github.com/kiwi-init/channels/pull/1109)) ([691e510](https://github.com/kiwi-init/channels/commit/691e5104aafafa0ec94e1e95d6121fec2534bbf8))
- **Settings:** kiwi's status, harness versions, Hooks and Check this computer (T380) ([#1108](https://github.com/kiwi-init/channels/pull/1108)) ([c4c74b9](https://github.com/kiwi-init/channels/commit/c4c74b9ef49151b9766ece24cb257674936e46b5))
- **Channel panel:** the channel's notes are back (T380) ([#1106](https://github.com/kiwi-init/channels/pull/1106)) ([1102d6a](https://github.com/kiwi-init/channels/commit/1102d6a99ff4da1a0bce1e20a89451c95fc781f8))
- **UI:** drop two controls that only pretended (T429) ([#1113](https://github.com/kiwi-init/channels/pull/1113)) ([5ad78d2](https://github.com/kiwi-init/channels/commit/5ad78d2a99ce9c51f3b54486a15e7b457c1f405c))
- **Settings:** where new agents open, and the 250k checkpoint ask (T380) ([#1110](https://github.com/kiwi-init/channels/pull/1110)) ([bf81c8a](https://github.com/kiwi-init/channels/commit/bf81c8a0f63490b9ccf6e976910ec48a29a384a0))
- **Add agent:** real folders and harnesses for the chosen computer, and Choose… opens the picker (T429) ([#1114](https://github.com/kiwi-init/channels/pull/1114)) ([e37350f](https://github.com/kiwi-init/channels/commit/e37350f5e4a39e5e2fc4cd0cf4eda284c4fd3978))
- **Composer:** picking a person writes their nickname, sent as the handle (#1111) ([#1112](https://github.com/kiwi-init/channels/pull/1112)) ([0c152f8](https://github.com/kiwi-init/channels/commit/0c152f8fb3825b40e6e3422d9883dc9fe7cc3606))
- **Tasks:** who changes a reviewer no longer depends on who is still here (#1116) ([#1121](https://github.com/kiwi-init/channels/pull/1121)) ([7a742b8](https://github.com/kiwi-init/channels/commit/7a742b89c06dc3e66b231fe1b569e782ac0f318b))
- **UI:** Settings > Appearance > Text size changes the text (#1119) ([#1124](https://github.com/kiwi-init/channels/pull/1124)) ([21a4018](https://github.com/kiwi-init/channels/commit/21a40184739a1ccd236801509af442991b25527a))
- **Deps:** refresh npm, Android and GitHub Actions ([#1125](https://github.com/kiwi-init/channels/pull/1125)) ([3f94abd](https://github.com/kiwi-init/channels/commit/3f94abd48dac3ad0ac8938a49d3c6a32fda3a9ca))
- **Agents:** Show in Rex or tmux is back (T429) ([#1115](https://github.com/kiwi-init/channels/pull/1115)) ([7b262bf](https://github.com/kiwi-init/channels/commit/7b262bf8f6e2fdad998ee6210e783d88d0d12636))
- Add a repo offers your GitHub repos (T429) ([#1130](https://github.com/kiwi-init/channels/pull/1130)) ([8a734db](https://github.com/kiwi-init/channels/commit/8a734dbac3bd9fe71e8e11490965d88cbe44cd26))
- **Settings:** a paired computer's own settings, read only (T380) ([#1129](https://github.com/kiwi-init/channels/pull/1129)) ([f3118ff](https://github.com/kiwi-init/channels/commit/f3118ff3c86cc1017f8e9f01fa9aa79451ab828c))
- **UI:** selected message text shows its highlight in the desktop app ([#1133](https://github.com/kiwi-init/channels/pull/1133)) ([6ffb2df](https://github.com/kiwi-init/channels/commit/6ffb2df9663976329626acb5f6ae5492a6c27f32))
- **Cards:** a step shows why, who and the command, and answers Done or why not (T462) ([#1135](https://github.com/kiwi-init/channels/pull/1135)) ([c9d1849](https://github.com/kiwi-init/channels/commit/c9d1849ef7870240b9070ae17af038b0c8246eb1))
- **Asks:** the asker can close its own ask once the answer came some other way (T466) ([#1136](https://github.com/kiwi-init/channels/pull/1136)) ([9b55979](https://github.com/kiwi-init/channels/commit/9b55979b471584999951d2df0db3ca078ef2d84a))
- **Cards:** the reply box says it answers the card, and the answer reads as a reply (T465) ([#1137](https://github.com/kiwi-init/channels/pull/1137)) ([de2013e](https://github.com/kiwi-init/channels/commit/de2013e608a7d08a9adf78e7b17e510b9de560b8))
- **Loop:** a session waiting for its verdict wakes only for what changes its work (#1117) ([#1134](https://github.com/kiwi-init/channels/pull/1134)) ([b11bbaa](https://github.com/kiwi-init/channels/commit/b11bbaad191628e3ef621dbae765e275bdff0709))
- **AGENTS.md:** merge with squash and auto-merge; main has no merge queue (#1131) ([#1132](https://github.com/kiwi-init/channels/pull/1132)) ([7500b61](https://github.com/kiwi-init/channels/commit/7500b61af258cb8af8786f5ae9d3a008723f05fe))
- **Loop:** a task gets a fresh session, and a long one can restart from its checkpoint (#1118) ([#1138](https://github.com/kiwi-init/channels/pull/1138)) ([a65576f](https://github.com/kiwi-init/channels/commit/a65576f3897723ddbd0cbb135d73006d45191381))
- **Approvals:** a computer you forgot no longer lets its agents in on their own (T503) ([#1139](https://github.com/kiwi-init/channels/pull/1139)) ([66a247c](https://github.com/kiwi-init/channels/commit/66a247cb62068a24316411f930e75d2c6fedbffd))
- **Docs:** the linked-devices spec (T521) ([#1141](https://github.com/kiwi-init/channels/pull/1141)) ([6b9e1db](https://github.com/kiwi-init/channels/commit/6b9e1dbf85de3143d75e6dbea74beb2f8de7609c))
- **Devices:** forget a phone from the desktop, and say what it holds (T508) ([#1140](https://github.com/kiwi-init/channels/pull/1140)) ([4947b0c](https://github.com/kiwi-init/channels/commit/4947b0c13cb08ad55e09a7577a5918c881d405a3))
- **Forgotten computers:** unpaired at the relay, and the iOS app knows your computers (T526) ([#1143](https://github.com/kiwi-init/channels/pull/1143)) ([07c81ca](https://github.com/kiwi-init/channels/commit/07c81ca35e1d6d8838630737622965afeaff22c6))
- **Chat:** copy a code block by pressing it (T590) ([#1142](https://github.com/kiwi-init/channels/pull/1142)) ([8615889](https://github.com/kiwi-init/channels/commit/861588949bffdc250fff8978d511526e3c91ab11))
- **Tasks:** send back with its reason, credit the reviewer, anyone may review, cancelled (T614) ([#1144](https://github.com/kiwi-init/channels/pull/1144)) ([0d9639b](https://github.com/kiwi-init/channels/commit/0d9639b65ba50025e97156406332c51b29615c82))
- **Linked devices 1a:** a person's signed device list (T634) ([#1147](https://github.com/kiwi-init/channels/pull/1147)) ([a769ac5](https://github.com/kiwi-init/channels/commit/a769ac5f6788976cf565566e50a487da85aa502a))
- **Fold:** whether a persona makes a member the lead follows the log (#1122) ([#1145](https://github.com/kiwi-init/channels/pull/1145)) ([7668555](https://github.com/kiwi-init/channels/commit/7668555235767cdc1440119d24a1e408b679a2cb))
- **Harness:** a ZCode seat is recognised, and told to keep a background listener ([#1149](https://github.com/kiwi-init/channels/pull/1149)) ([96bf8e7](https://github.com/kiwi-init/channels/commit/96bf8e7045c7486df06d0c1a01e255d805e1c40e))
- **App:** every harness with a logo shows it, not a letter (#1150) ([#1151](https://github.com/kiwi-init/channels/pull/1151)) ([31b58d2](https://github.com/kiwi-init/channels/commit/31b58d2fa98e27c6aa5508c62db530eb077d7293))
- **Phones:** a ZCode agent shows ZCode's mark (#1152) ([#1153](https://github.com/kiwi-init/channels/pull/1153)) ([a5eb529](https://github.com/kiwi-init/channels/commit/a5eb52937270770bb48d2e6a08b1f7574c846efc))

## 2026.10.8 — 2026-10-27

Tag [v2026.10.8](https://github.com/kiwi-init/channels/releases/tag/v2026.10.8) · commit [46baed4](https://github.com/kiwi-init/channels/commit/46baed41242b587e2c9c338bc7293edc5072e82c) · 2026-10-27

### Other changes

- **UI:** resizable panels, nothing hidden under the composer ([#1049](https://github.com/kiwi-init/channels/pull/1049)) ([d8a64f9](https://github.com/kiwi-init/channels/commit/d8a64f971a6dd7511235f1ec7c5a3a5d8abd307a))
- **UI:** make channel settings findable ([#1050](https://github.com/kiwi-init/channels/pull/1050)) ([f0919d4](https://github.com/kiwi-init/channels/commit/f0919d40ab8640ae6de659fa1508feb43217c900))
- **Desktop:** build on Livewire 2026.10.0 ([#1051](https://github.com/kiwi-init/channels/pull/1051)) ([a38a4df](https://github.com/kiwi-init/channels/commit/a38a4dfa51fcb0e2288d724b36ca2d52c7eda258))
- **Desktop:** no dev-channel code in releases; name the first-run controls ([#1054](https://github.com/kiwi-init/channels/pull/1054)) ([37f9be5](https://github.com/kiwi-init/channels/commit/37f9be5c632c76f936012e795533f3767d8c67a8))
- **UI:** still dashed rings for doing tasks and waiting steps (T27) ([#1058](https://github.com/kiwi-init/channels/pull/1058)) ([0d4fcfd](https://github.com/kiwi-init/channels/commit/0d4fcfdc49774df16368425d4c9af2917b99c127))
- **UI:** scroll the feed at 60fps (#1045) ([#1055](https://github.com/kiwi-init/channels/pull/1055)) ([5f83a26](https://github.com/kiwi-init/channels/commit/5f83a26f486b5e6da7d3fe5febe21e6ead611592))
- **Main CI:** dialogs say they're dialogs; Homebrew CLI tests get a runner's budget (T54) ([#1060](https://github.com/kiwi-init/channels/pull/1060)) ([05af5ef](https://github.com/kiwi-init/channels/commit/05af5efe49312af169d3567f6e02a08a444ff455))
- **UI:** let people in with the checks the web had (T18) ([#1065](https://github.com/kiwi-init/channels/pull/1065)) ([23bf563](https://github.com/kiwi-init/channels/commit/23bf56388f85fa3bb345c7a0eff1bf86d6dbb3e5))
- **Composer:** no suggested messages when the chat is empty (T17) ([#1057](https://github.com/kiwi-init/channels/pull/1057)) ([c477076](https://github.com/kiwi-init/channels/commit/c477076ce99b1fb6c04bbf13f5169c45a6c889dc))
- **Composer:** attach images by drag-drop, paste or + (T15) ([#1059](https://github.com/kiwi-init/channels/pull/1059)) ([d03a4ec](https://github.com/kiwi-init/channels/commit/d03a4ecaf744d5daf4449b72a51c85636af58bd2))
- **Composer:** # opens a task picker matched by title (T73) ([#1068](https://github.com/kiwi-init/channels/pull/1068)) ([543b79b](https://github.com/kiwi-init/channels/commit/543b79b8bcc45a78cde28bb2864e2211b9518096))
- Type-check with tsrs; drop typescript ([#1066](https://github.com/kiwi-init/channels/pull/1066)) ([469b4a2](https://github.com/kiwi-init/channels/commit/469b4a23aee6477654cefc1ba78ec95d9a48db81))
- A done task lists its own PRs (T101) ([#1070](https://github.com/kiwi-init/channels/pull/1070)) ([c81459a](https://github.com/kiwi-init/channels/commit/c81459aa6c156d91d00e7b63eaea48c00ae4eaad))
- **UI:** the add-agent command can pin a personality (T20) ([#1067](https://github.com/kiwi-init/channels/pull/1067)) ([58cfc02](https://github.com/kiwi-init/channels/commit/58cfc02e1a3b7393350bf9304e6b54281895a800))
- **UI:** people read nicknames, never handles ([#1053](https://github.com/kiwi-init/channels/pull/1053)) ([f88e9d3](https://github.com/kiwi-init/channels/commit/f88e9d3d25115f1c2316a8516458c1dc5c7f4fde))
- **UI publish:** on every merge that changes the UI, no request file (T124) ([#1074](https://github.com/kiwi-init/channels/pull/1074)) ([22d53c3](https://github.com/kiwi-init/channels/commit/22d53c3b9c5a2d6ff3b5ab4b477c815a3797c8dd))
- **Linux:** window controls on floating desktops (T54) ([#1073](https://github.com/kiwi-init/channels/pull/1073)) ([82c7792](https://github.com/kiwi-init/channels/commit/82c77929a27f016eeda13558ed23a65e4d72d38e))
- **Desktop smoke:** links through the bridge, a Dock badge check that doesn't race (T54) ([#1069](https://github.com/kiwi-init/channels/pull/1069)) ([e9861ad](https://github.com/kiwi-init/channels/commit/e9861ad5e47fc4d39779e725e522d89615ec782b))
- **Joining:** invite step, waiting states, errors that say why (T41) ([#1071](https://github.com/kiwi-init/channels/pull/1071)) ([b4382c9](https://github.com/kiwi-init/channels/commit/b4382c981842cdebe325a2e39329b7aa71d4789d))
- **App:** search lists results to jump to, ranked with BM25 ([#1064](https://github.com/kiwi-init/channels/pull/1064)) ([97e36ff](https://github.com/kiwi-init/channels/commit/97e36ff2e697ca918ae71e1656834b884f4ac798))
- Remove kiwi sh and just-bash; keep query as kiwi query (#1072) ([#1075](https://github.com/kiwi-init/channels/pull/1075)) ([7dccdb5](https://github.com/kiwi-init/channels/commit/7dccdb5a39861d3145c86521537479de50b0e47d))
- **Tray:** the mark as three filled slabs, legible at 16 and 22 px (#1012) ([#1076](https://github.com/kiwi-init/channels/pull/1076)) ([a1f1403](https://github.com/kiwi-init/channels/commit/a1f1403ce9c7eca2566206446c84129eb7918efb))
- **UI:** readable text selection (T163) ([#1079](https://github.com/kiwi-init/channels/pull/1079)) ([1f80cbf](https://github.com/kiwi-init/channels/commit/1f80cbf0107f20652257aa1ca6a081ac13a77124))
- **UI:** mark up images in the viewer again (T169) ([#1080](https://github.com/kiwi-init/channels/pull/1080)) ([a935007](https://github.com/kiwi-init/channels/commit/a9350073a4d295a411471e21217d608db578f568))
- **Tasks:** the done line leaves out the assign note (T150) ([#1081](https://github.com/kiwi-init/channels/pull/1081)) ([fd35d2f](https://github.com/kiwi-init/channels/commit/fd35d2fd8617964058ab11794ebc07f444ccf8fa))
- **UI:** keep every feed frame inside the 120 fps budget (T38) ([#1077](https://github.com/kiwi-init/channels/pull/1077)) ([a026d91](https://github.com/kiwi-init/channels/commit/a026d914ff1b5fe1508e466b8e4196be82d6f158))
- **App smoke:** read the join code from the relay's invite link ([#1083](https://github.com/kiwi-init/channels/pull/1083)) ([a1bc389](https://github.com/kiwi-init/channels/commit/a1bc3892b6482303a9754db18429910c4f6ca0cf))
- **Desktop:** build on Livewire 2026.10.1 (T88, T129) ([#1082](https://github.com/kiwi-init/channels/pull/1082)) ([286b318](https://github.com/kiwi-init/channels/commit/286b3183fe4c4a7b86345f2afaf9e2d57f757d6d))
- **Wayland check:** say why the two copy checks are gaps (T152) ([#1084](https://github.com/kiwi-init/channels/pull/1084)) ([3966069](https://github.com/kiwi-init/channels/commit/3966069c7bbc03505c2bae3301e51b7489fea111))
- **Desktop:** an opaque window for the new UI (#1045) ([#1056](https://github.com/kiwi-init/channels/pull/1056)) ([5f655e6](https://github.com/kiwi-init/channels/commit/5f655e6a06548d24e3e99b38bc5cf4b3573e336a))
- **UI:** lists in messages show their bullets and numbers again (T258) ([#1087](https://github.com/kiwi-init/channels/pull/1087)) ([d522cca](https://github.com/kiwi-init/channels/commit/d522cca1bceab395840e5b75b788c87fce4e03f7))
- **Needs you:** asks that hold nothing up get a quiet group instead of vanishing (T269) ([#1088](https://github.com/kiwi-init/channels/pull/1088)) ([9460ef3](https://github.com/kiwi-init/channels/commit/9460ef3984185021645f154092b4743740fbc023))
- **Mentions:** a mention shows its @handle on hover; kiwi help says to write @handle (T290) ([#1091](https://github.com/kiwi-init/channels/pull/1091)) ([e668dc6](https://github.com/kiwi-init/channels/commit/e668dc64940670c9a3da6a26c9bcf67aa320fe17))
- **Tasks:** a refused review change sends nothing and says why (T270) ([#1089](https://github.com/kiwi-init/channels/pull/1089)) ([ac88607](https://github.com/kiwi-init/channels/commit/ac88607c2d57070148c34c20b948d1775e2a2c0f))
- **CLI:** kiwi show N --raw prints the body exactly as sent (T289) ([#1090](https://github.com/kiwi-init/channels/pull/1090)) ([99f78f7](https://github.com/kiwi-init/channels/commit/99f78f74647320d8d6bfa52d568ef2e330e294a2))
- **Feed:** never drop rows where it would clamp the scroll (T222) ([#1085](https://github.com/kiwi-init/channels/pull/1085)) ([075dc6c](https://github.com/kiwi-init/channels/commit/075dc6cca0faba5846f7001e011ce2fa7af48ffc))
- **Main CI:** shots find the search box again; Linux's tray needs no AppIndicator (T315) ([#1092](https://github.com/kiwi-init/channels/pull/1092)) ([5cc3e8d](https://github.com/kiwi-init/channels/commit/5cc3e8da22c1ada19b5c1ad104f50c4ba3091d64))

## 2026.10.7 — 2026-10-27

Tag [v2026.10.7](https://github.com/kiwi-init/channels/releases/tag/v2026.10.7) · commit [b33849e](https://github.com/kiwi-init/channels/commit/b33849eeaa6f66b05e7e69135fcf6e2874a3d266) · 2026-10-27

### Other changes

- **Deps:** refresh JavaScript, Android, and Electrobun ([#1016](https://github.com/kiwi-init/channels/pull/1016)) ([02cc811](https://github.com/kiwi-init/channels/commit/02cc8116029350f5f6253c6e5dfe311acaeaa9cd))
- **CI:** disable the iOS gestures gate ([#1018](https://github.com/kiwi-init/channels/pull/1018)) ([1a09de4](https://github.com/kiwi-init/channels/commit/1a09de4ec5dce4c563ddd2492ca5b3314bc65c3f))
- **CI:** run browser screenshots concurrently ([#1021](https://github.com/kiwi-init/channels/pull/1021)) ([b38f0c5](https://github.com/kiwi-init/channels/commit/b38f0c562b0846c740ab54f7042dd6cf9250e83f))
- **Grok:** log Stop skips and recover missing task metadata ([#1022](https://github.com/kiwi-init/channels/pull/1022)) ([0dc506c](https://github.com/kiwi-init/channels/commit/0dc506c618c60e5bf18e3fe2d663c259449b647a))
- **App:** find tasks by number or title ([#1023](https://github.com/kiwi-init/channels/pull/1023)) ([b8b5a35](https://github.com/kiwi-init/channels/commit/b8b5a3588351936b13b081a3081771b13e345a7b))
- **Tasks:** carry review round summaries ([#1024](https://github.com/kiwi-init/channels/pull/1024)) ([89f99a8](https://github.com/kiwi-init/channels/commit/89f99a8bf5af367bb17dd851fe6bdb5c9627600c))
- **Tasks:** keep any-reviewer work out of Needs you ([#1025](https://github.com/kiwi-init/channels/pull/1025)) ([2cff126](https://github.com/kiwi-init/channels/commit/2cff126b86e17b27514603842846f562732cac59))
- **Desktop:** restore composer spell checking ([#1026](https://github.com/kiwi-init/channels/pull/1026)) ([af6f0f8](https://github.com/kiwi-init/channels/commit/af6f0f8798c59b3a6391b8903b4b3fa58e56fd45))
- **Desktop:** open message links externally ([#1027](https://github.com/kiwi-init/channels/pull/1027)) ([34b0146](https://github.com/kiwi-init/channels/commit/34b014678a8fcba2a70eeaa47145106aadc743f4))
- **Desktop:** request client decorations on Wayland ([#1028](https://github.com/kiwi-init/channels/pull/1028)) ([3da9f3c](https://github.com/kiwi-init/channels/commit/3da9f3c15e74c1f5afeac8addaac48c88b72d36a))
- **App:** shorten the Now card's scroll fade ([#1030](https://github.com/kiwi-init/channels/pull/1030)) ([91fdaf4](https://github.com/kiwi-init/channels/commit/91fdaf45b05571989d38c2f635be86ace1308d41))
- **Cards:** add actionable steps for people ([#1035](https://github.com/kiwi-init/channels/pull/1035)) ([750ddbf](https://github.com/kiwi-init/channels/commit/750ddbf0ec611504ae014c984d4c64699d980ca4))
- **Tasks:** let leads reassign reviewers ([#1037](https://github.com/kiwi-init/channels/pull/1037)) ([70d9f14](https://github.com/kiwi-init/channels/commit/70d9f1425c40c94ab0119fbe55794d528b80b7af))
- **App:** pilot a signals ChannelStore behind useChannel ([#1036](https://github.com/kiwi-init/channels/pull/1036)) ([39f2ee5](https://github.com/kiwi-init/channels/commit/39f2ee5d0485bc08d2675a858f8fd08ec57b4e76))
- **Desktop:** use the Channels mark in the tray ([#1038](https://github.com/kiwi-init/channels/pull/1038)) ([4b2f5b4](https://github.com/kiwi-init/channels/commit/4b2f5b4db2afcaea855c4d08867bff56aa5f4ac8))
- **Tasks:** open the review when the named reviewer leaves ([#1040](https://github.com/kiwi-init/channels/pull/1040)) ([7b8a995](https://github.com/kiwi-init/channels/commit/7b8a995f8be7913db29b66fe4619f84d702e3672))
- **Names:** show a bare handle as its nickname and note it on send ([#1041](https://github.com/kiwi-init/channels/pull/1041)) ([2d2ab41](https://github.com/kiwi-init/channels/commit/2d2ab415feba0ba08bfb20351794c84411909bce))
- Channels Livewire with the new desktop UI ([#1042](https://github.com/kiwi-init/channels/pull/1042)) ([f4d4930](https://github.com/kiwi-init/channels/commit/f4d49301c0e49eb41f4aea336b3a52f928c7e7d0))
- Livewire ships from main ([#1044](https://github.com/kiwi-init/channels/pull/1044)) ([6523311](https://github.com/kiwi-init/channels/commit/6523311f69a6ab7bbf8ef55522da21be6307dc4f))
- **Brief:** tell agents to name members by @handle ([#1043](https://github.com/kiwi-init/channels/pull/1043)) ([113f82f](https://github.com/kiwi-init/channels/commit/113f82fee83d6a0832289594f8f2b38cad443e6b))
- **One Channels:** the Livewire build is stable Channels ([#1046](https://github.com/kiwi-init/channels/pull/1046)) ([935ef5c](https://github.com/kiwi-init/channels/commit/935ef5c67b7a72437be92ba861d9fbe1feecc7c7))
- Release 2026.10.7 ([#1047](https://github.com/kiwi-init/channels/pull/1047)) ([b33849e](https://github.com/kiwi-init/channels/commit/b33849eeaa6f66b05e7e69135fcf6e2874a3d266))

## 2026.10.6 — 2026-10-26

Tag [v2026.10.6](https://github.com/kiwi-init/channels/releases/tag/v2026.10.6) · commit [02fd310](https://github.com/kiwi-init/channels/commit/02fd3105e384443d36c9e97941e3d60ade6a05b6) · 2026-10-26

### Other changes

- **Remove jev-ci:** CI picks its jobs with plain rules instead of a model ([#997](https://github.com/kiwi-init/channels/pull/997)) ([e564103](https://github.com/kiwi-init/channels/commit/e56410336e1585b75cd71f19cc05eef2fac751f8))
- Another channel's Details gear shows only on hover, so build / shots finds one ([#998](https://github.com/kiwi-init/channels/pull/998)) ([eba192e](https://github.com/kiwi-init/channels/commit/eba192e7685f2fa3bac0042c5909d7913dfab5bb))
- The scrims under the header and over the composer no longer blur the text: they only fade it, on every platform ([#1000](https://github.com/kiwi-init/channels/pull/1000)) ([dab6d61](https://github.com/kiwi-init/channels/commit/dab6d614240ac8d7d85e4d37214ba3786f0df5b4))
- Linux ships only the AppImage, tested on Arch: no .deb, no Fedora ([#996](https://github.com/kiwi-init/channels/pull/996)) ([fe011c9](https://github.com/kiwi-init/channels/commit/fe011c919f501a3ea28c499776eea3d8cd742a47))
- Linux looks like the Mac on every desktop: frost, wallpaper tints, Inter, no GTK title bar, Reduce transparency ([#1006](https://github.com/kiwi-init/channels/pull/1006)) ([9aa44c3](https://github.com/kiwi-init/channels/commit/9aa44c3551407b8d0f405190227cb9d47c79994b))

## 2026.10.5 — 2026-10-26

Tag [v2026.10.5](https://github.com/kiwi-init/channels/releases/tag/v2026.10.5) · commit [b50007f](https://github.com/kiwi-init/channels/commit/b50007fe32edab871d4521dbffad186e92e51a11) · 2026-10-26

### Other changes

- Add kiwi upgrade for standalone CLI installs ([#984](https://github.com/kiwi-init/channels/pull/984)) ([1061595](https://github.com/kiwi-init/channels/commit/1061595d01d1d5b38b7f5499ff2cad88c8cb24dc))
- The tasks board in the shell's look: cards, a quiet open row, solid fields, 26 pt actions (T75) ([#972](https://github.com/kiwi-init/channels/pull/972)) ([110be7c](https://github.com/kiwi-init/channels/commit/110be7c552939b7dd4de248f1bc1fe13fbbbfb2c))
- Keep desktop update checks available after download failure ([#987](https://github.com/kiwi-init/channels/pull/987)) ([fd5c897](https://github.com/kiwi-init/channels/commit/fd5c897d3a9c99821b0915a505c7fcf836e68d35))
- On sway, Hyprland, river and niri, closing with no tray host hides the window, and a Linux window fills a half tile ([#988](https://github.com/kiwi-init/channels/pull/988)) ([78c8eca](https://github.com/kiwi-init/channels/commit/78c8ecaa4d3b12038957d138a0c37cb920e0da4e))
- Settings, Personalities and onboarding in the shell's look, with one sidebar aware of where you are (T75) ([#986](https://github.com/kiwi-init/channels/pull/986)) ([c974ffa](https://github.com/kiwi-init/channels/commit/c974ffa7a98b74b68ed28871cae5f19dbc4a1c0d))
- smoke-ui finds Settings' buttons in the sidebar ([#989](https://github.com/kiwi-init/channels/pull/989)) ([4c6798f](https://github.com/kiwi-init/channels/commit/4c6798f53cf617de3a469b86756c842e66f503e3))
- Details in Settings' look: one column, compact boxes, no second Invite (T75) ([#990](https://github.com/kiwi-init/channels/pull/990)) ([204b309](https://github.com/kiwi-init/channels/commit/204b309eb2cdd59b07ac5f83c3a4cc9e7029a8cc))
- **Linux:** a cancelled or locked keyring says so with Ask again, and never leaves the keys unencrypted (T1566) ([#992](https://github.com/kiwi-init/channels/pull/992)) ([af24730](https://github.com/kiwi-init/channels/commit/af247307b7ea547f588bffec1bb067633ec138b3))
- The Agents tab in the board's look (T75) ([#991](https://github.com/kiwi-init/channels/pull/991)) ([32b1a7b](https://github.com/kiwi-init/channels/commit/32b1a7b487d9c43aeb6c8d9e72b3401d38d0ba43))
- Channel secrets are removed: Kiwi can't keep a secret safe from an agent it hands one to ([#994](https://github.com/kiwi-init/channels/pull/994)) ([7e2d1bd](https://github.com/kiwi-init/channels/commit/7e2d1bd3bb1f8514a34c6d2967c7c5098e46f9f1))
- **Interlinked's shell:** clear frost, a lifted page, wallpaper tints, channels as tab groups, a centred toolbar (T75) ([#993](https://github.com/kiwi-init/channels/pull/993)) ([555be29](https://github.com/kiwi-init/channels/commit/555be298ff86875cd78422f81730b08fcdc89ec0))

## 2026.10.4 — 2026-10-26

Tag [v2026.10.4](https://github.com/kiwi-init/channels/releases/tag/v2026.10.4) · commit [9c06525](https://github.com/kiwi-init/channels/commit/9c06525b81fb4078722a1a3bea651233ff029f29) · 2026-10-26

### Other changes

- **Channel secrets:** each one sealed to the agents the owner names, and a send guard that keeps values out of messages (1/3) ([#979](https://github.com/kiwi-init/channels/pull/979)) ([ea3f50c](https://github.com/kiwi-init/channels/commit/ea3f50c3b5002eac122273b7ace0c36bbf696d95))
- Channel secrets for agents: kiwi secret lists them, kiwi secret run puts them in a command's environment and redacts them from its output (2/3) ([#980](https://github.com/kiwi-init/channels/pull/980)) ([6ef9e40](https://github.com/kiwi-init/channels/commit/6ef9e40d84525c48d6e89553338d1986e7bbb8aa))
- Channel secrets in the app: the owner adds a secret and ticks which agents may use it (3/3) ([#981](https://github.com/kiwi-init/channels/pull/981)) ([88e1d50](https://github.com/kiwi-init/channels/commit/88e1d506074306ae5683704ae715984f50a14259))

## 2026.10.3 — 2026-10-25

Tag [v2026.10.3](https://github.com/kiwi-init/channels/releases/tag/v2026.10.3) · commit [08ceaf5](https://github.com/kiwi-init/channels/commit/08ceaf58dbe22ac7c6a61f78469fc8fe6662da5e) · 2026-10-25

### Other changes

- Tiling, scale and closing on wlroots, with screenshots (headless sway) ([#975](https://github.com/kiwi-init/channels/pull/975)) ([43af0c9](https://github.com/kiwi-init/channels/commit/43af0c9486eb5466b8bf825bef8419225545fbc8))
- On Linux, links open through xdg-open or gio directly, never Electrobun's opener (T990) ([#976](https://github.com/kiwi-init/channels/pull/976)) ([10bac79](https://github.com/kiwi-init/channels/commit/10bac797d4d82eb7099b88e71dda95a33ecc1842))

## 2026.10.2 — 2026-10-25

Tag [v2026.10.2](https://github.com/kiwi-init/channels/releases/tag/v2026.10.2) · commit [3f28ac4](https://github.com/kiwi-init/channels/commit/3f28ac44de3007dd4510c805a1ec802b184307b9) · 2026-10-25

### Other changes

- One shell, and the page floats on it, as in Interlinked (T297) ([#973](https://github.com/kiwi-init/channels/pull/973)) ([9ec8ae6](https://github.com/kiwi-init/channels/commit/9ec8ae6509b9502a3577c283d27373bb536f7a03))

## 2026.10.1 — 2026-10-25

Tag [v2026.10.1](https://github.com/kiwi-init/channels/releases/tag/v2026.10.1) · commit [6b97fa6](https://github.com/kiwi-init/channels/commit/6b97fa66106c6e5c039928d3055bd7a98f7e5b00) · 2026-10-25

### Other changes

- A reply refused while another agent answers says how to add to the thread instead, with the exact command (T1113) ([#958](https://github.com/kiwi-init/channels/pull/958)) ([0df36c2](https://github.com/kiwi-init/channels/commit/0df36c214c079d003fe3a90671f03490ad5e16f5))
- kiwi doctor names an old kiwi ahead of Homebrew's on PATH and how to remove it, keeping ~/.kiwi's keys (T1402) ([#961](https://github.com/kiwi-init/channels/pull/961)) ([d9d9796](https://github.com/kiwi-init/channels/commit/d9d9796d5f276d659f26cb669a06e3d78a3777d8))
- The update check runs by hand from main: the installed app updates itself, on Mac and Linux, from one release to the next (T1041) ([#964](https://github.com/kiwi-init/channels/pull/964)) ([b3758dc](https://github.com/kiwi-init/channels/commit/b3758dcec2618d4d76ec700640dd0b358cbacb7e))
- The app's text is the system font, and the tokens for Interlinked's look are in (T75) ([#959](https://github.com/kiwi-init/channels/pull/959)) ([717b068](https://github.com/kiwi-init/channels/commit/717b068c9c85d3845ee9373a2711f7c6af7e0cc6))
- Flow and loop tests read the new status words: planned, status: done (T1530) ([#967](https://github.com/kiwi-init/channels/pull/967)) ([5276a34](https://github.com/kiwi-init/channels/commit/5276a34d84f3b497f1d06636c8b0fa263ba7241a))
- **desktop / distros:** the AppImage on stock Fedora 44 and Arch, native Wayland, keys, tray, dark mode, notifications, update (T960) ([#966](https://github.com/kiwi-init/channels/pull/966)) ([dd8c59c](https://github.com/kiwi-init/channels/commit/dd8c59cdaefdc13d51b2715e52489d470b857cc9))
- The phone header's tabs fit a 390px screen in any system font (T75) ([#968](https://github.com/kiwi-init/channels/pull/968)) ([ebbf9ec](https://github.com/kiwi-init/channels/commit/ebbf9ec0176b3a1eb586b1d503715693f0dbdc2a))
- One sidebar for channels and their conversations, and the card's header a toolbar (T75) ([#965](https://github.com/kiwi-init/channels/pull/965)) ([b863a86](https://github.com/kiwi-init/channels/commit/b863a86fdbffd720919bf8884f04b708dccd5b5e))
- A keyring that doesn't answer in 2 s no longer keeps the window away: it opens saying it waits for the keyring (T1550) ([#969](https://github.com/kiwi-init/channels/pull/969)) ([03a45a9](https://github.com/kiwi-init/channels/commit/03a45a9d2f24bef57aec0dce38e4afa12fcf4f85))
- The Tasks icon opens Everything, and shoot-ui follows the toolbar (T75) ([#971](https://github.com/kiwi-init/channels/pull/971)) ([72d23dd](https://github.com/kiwi-init/channels/commit/72d23dd0819d9c013d035866c56130b67008db05))
- A frosted sidebar on a Mac, solid with Reduce Transparency or Increase Contrast (T1385, T75) ([#963](https://github.com/kiwi-init/channels/pull/963)) ([b11665a](https://github.com/kiwi-init/channels/commit/b11665ac0c882c52e0c32c1bdf3d5cc4bfbde8b3))

## 2026.10.0 — 2026-10-25

Tag [v2026.10.0](https://github.com/kiwi-init/channels/releases/tag/v2026.10.0) · commit [fbccbaa](https://github.com/kiwi-init/channels/commit/fbccbaabb8463655fa6bc8292bdb1b7be414d169) · 2026-10-25

### Other changes

- A task reads by its status: planned, working, needs you, done, shipped in its release (T1099) ([#943](https://github.com/kiwi-init/channels/pull/943)) ([bc7f502](https://github.com/kiwi-init/channels/commit/bc7f502417a9078daf352e1007b3efbaca19fa0e))
- A task waiting on a person says Needs you, and the UI shots show Done and Shipped rows (T1258) ([#944](https://github.com/kiwi-init/channels/pull/944)) ([e28ed1e](https://github.com/kiwi-init/channels/commit/e28ed1eea7dc55e1e0967a8eb6194ac663b05dc5))
- Releases are dates, YYYY.M.PATCH, from 2026.10.0 on (T1232) ([#945](https://github.com/kiwi-init/channels/pull/945)) ([7c75da6](https://github.com/kiwi-init/channels/commit/7c75da6cb10117a0de6a14b063b1da3e35aabab8))
- The board heads a person's ask with a goal the lead names in plain words, their message under it as "from #956" (T1095) ([#946](https://github.com/kiwi-init/channels/pull/946)) ([bd7e556](https://github.com/kiwi-init/channels/commit/bd7e5560cc4042044e4aabd7482634865d61d487))
- The board groups finished work by release: Next, then each release it shipped in (T1101) ([#947](https://github.com/kiwi-init/channels/pull/947)) ([cc16c97](https://github.com/kiwi-init/channels/commit/cc16c973d6da8960f9c6a9f4527c5a4b6a6e670c))
- The Now card reads each task's status: a merged task is done today, one waiting on a person is marked (T1288) ([#948](https://github.com/kiwi-init/channels/pull/948)) ([a622de9](https://github.com/kiwi-init/channels/commit/a622de93bc1302b52122f139cfe8c91a5e9fe186))
- Each release bumps the Homebrew tap: the Channels cask and the kiwi formula get its version and sha256s (T1234) ([#949](https://github.com/kiwi-init/channels/pull/949)) ([15e10ce](https://github.com/kiwi-init/channels/commit/15e10cefeae5a45a50728070dc93d0bcb36d1652))
- A new task's title is at most 60 characters, for people; the spec goes in its body (--body or --file spec.md) (T1103) ([#950](https://github.com/kiwi-init/channels/pull/950)) ([800beef](https://github.com/kiwi-init/channels/commit/800beefe32072a45f9b0590f3a7e4b25908e7a0f))
- The app's kiwi defers to Homebrew's: no copy in ~/.kiwi/bin, no PATH line, and hooks that survive brew upgrade (T1236) ([#951](https://github.com/kiwi-init/channels/pull/951)) ([ad1e259](https://github.com/kiwi-init/channels/commit/ad1e259f9b1931d961e969f44f2394c9004cb40b))
- One way to take a task, and review rounds only when a task asks for them (T1107) ([#953](https://github.com/kiwi-init/channels/pull/953)) ([2b49416](https://github.com/kiwi-init/channels/commit/2b49416b034f6a978d5976f28b64c40b189bb05b))
- A task outlives the agent who leaves: its open tasks are back on the board, "left by" it, and the lead is told (T1105) ([#952](https://github.com/kiwi-init/channels/pull/952)) ([4f17321](https://github.com/kiwi-init/channels/commit/4f17321ac6ccf2f50111c1627b5a3067d34c8628))
- kiwi lock status lists the leases, and kiwi lock release is refused with how to let one go (T1109) ([#955](https://github.com/kiwi-init/channels/pull/955)) ([3f9f1b4](https://github.com/kiwi-init/channels/commit/3f9f1b48e47bd966b9734ad8ab097f4b4d19d310))
- kiwi finds the channel from any git worktree of the folder it joined in (T1115) ([#956](https://github.com/kiwi-init/channels/pull/956)) ([2a6cbb2](https://github.com/kiwi-init/channels/commit/2a6cbb2b1b914f5198cb3550898894f4971516af))
- The Linux app's pages run in WebKitGTK's bubblewrap sandbox: every context is sandboxed, Electrobun's persist:default one included (T1193) ([#954](https://github.com/kiwi-init/channels/pull/954)) ([8957c98](https://github.com/kiwi-init/channels/commit/8957c9830f2a5489dcbb9a8dd18e808a00e08c16))
- kiwi lock exits 3 while you're only in line, and --wait blocks until the lease is yours (T1111) ([#957](https://github.com/kiwi-init/channels/pull/957)) ([95010ce](https://github.com/kiwi-init/channels/commit/95010ce78bd1bc69bcc52b1e0ac9c8d688f89ac7))
- The daemon test's "newer" daemon is newer than VERSION under any scheme, so the date version passes (T1472) ([#962](https://github.com/kiwi-init/channels/pull/962)) ([cfd5f92](https://github.com/kiwi-init/channels/commit/cfd5f925b42fadfbf70dd2b49a378a5c78c70903))

## 0.27.7 — 2026-10-25

Tag [v0.27.7](https://github.com/kiwi-init/channels/releases/tag/v0.27.7) · commit [0fe683f](https://github.com/kiwi-init/channels/commit/0fe683f569fbf735b549642b019be29e054b76e0) · 2026-10-25

### Other changes

- **Linux:** a missing library is named with the right install line for the distro, before the app tries to start (T1066) ([#939](https://github.com/kiwi-init/channels/pull/939)) ([41dce82](https://github.com/kiwi-init/channels/commit/41dce829afc93c7330c3f00c05d879017868b096))
- A task's checks follow its repo's own merge rules: the required checks decide red and green (T1097) ([#940](https://github.com/kiwi-init/channels/pull/940)) ([a18e154](https://github.com/kiwi-init/channels/commit/a18e1548168a814956af2efd2478aeca84e6f3d0))
- The Linux app starts without libayatana-appindicator (stock Fedora and Arch), with no tray (T1065) ([#938](https://github.com/kiwi-init/channels/pull/938)) ([3f2bb77](https://github.com/kiwi-init/channels/commit/3f2bb774470f6743a1bf2ee99f2ecea9725d8f10))
- A Now card at the top of the channel: what's next, what's being worked on, what needs you, what's done today (T1093) ([#941](https://github.com/kiwi-init/channels/pull/941)) ([77e28c9](https://github.com/kiwi-init/channels/commit/77e28c96e6db71d4e7b9b7768440118f5bcb8bcb))

## 0.27.6 — 2026-10-24

Tag [v0.27.6](https://github.com/kiwi-init/channels/releases/tag/v0.27.6) · commit [3e840d5](https://github.com/kiwi-init/channels/commit/3e840d5057662802be0377d9bddb245f401c1f6b) · 2026-10-24

### Other changes

- **Android:** @mentions are offered on a new line, and completing one keeps the line break ([#928](https://github.com/kiwi-init/channels/pull/928)) ([8e1b5c8](https://github.com/kiwi-init/channels/commit/8e1b5c8f029b2f3417622a956920dfffafbfcfc9))
- **Linux:** files dropped on the composer attach (T895) ([#927](https://github.com/kiwi-init/channels/pull/927)) ([b5629ee](https://github.com/kiwi-init/channels/commit/b5629eee37c25056f7193b09275ea094dcf25ac2))
- **Linux:** an image pasted from another app attaches: the composer asks main, which reads the clipboard only right after a real Ctrl+V (T896) ([#926](https://github.com/kiwi-init/channels/pull/926)) ([e75cc73](https://github.com/kiwi-init/channels/commit/e75cc7381ed497e99a16f7405f8ae2ff85359cad))
- desktop / linux's Wayland-only session runs at scale 2, and the app must draw at it (T840) ([#930](https://github.com/kiwi-init/channels/pull/930)) ([30f8903](https://github.com/kiwi-init/channels/commit/30f89033d032c7e1157d8522105024fc7c41e0b0))
- **Mac:** ⌘Q quits, ⌘W closes, ⌘H hides, and the app menu says About, Hide and Quit Channels (T970) ([#931](https://github.com/kiwi-init/channels/pull/931)) ([7ed2853](https://github.com/kiwi-init/channels/commit/7ed285397ef66733a4ff6ff8628527da41441089))
- **Mac:** the window opens where it was left, at the size it was left (T972) ([#933](https://github.com/kiwi-init/channels/pull/933)) ([6ebaf2e](https://github.com/kiwi-init/channels/commit/6ebaf2ed9ed5bafc2d3d7a755e78a122cbaebd66))
- Mac notifications show while Channels is in front, and clicking one shows the window (T973) ([#932](https://github.com/kiwi-init/channels/pull/932)) ([c40790e](https://github.com/kiwi-init/channels/commit/c40790edcae688955d465427a7cd82c0bbb96de9))
- Dock and taskbar badge: the app icon shows the news count the tab title shows (T971) ([#934](https://github.com/kiwi-init/channels/pull/934)) ([33d6ac8](https://github.com/kiwi-init/channels/commit/33d6ac85c28a8952cc576c88c28a18b63548e6f7))
- The updater finds the latest release from github.com's redirect, not api.github.com (T985) ([#935](https://github.com/kiwi-init/channels/pull/935)) ([ca8ef0c](https://github.com/kiwi-init/channels/commit/ca8ef0c49a1c7bc3bad74938865d3b6d341cfcb6))
- **Releases end green:** the stamp lands as a PR before the tag, and bump-main passes on its empty patch (T1032) ([#936](https://github.com/kiwi-init/channels/pull/936)) ([2d61b06](https://github.com/kiwi-init/channels/commit/2d61b06fdd3ce04d5d8ac682fdb1862f2ef4a863))

## 0.27.5 — 2026-10-24

Tag [v0.27.5](https://github.com/kiwi-init/channels/releases/tag/v0.27.5) · commit [337c50d](https://github.com/kiwi-init/channels/commit/337c50d3691fb9cbc18de09f2754295c3125acb7) · 2026-10-24

### Other changes

- **Channels for Android:** a native Kotlin and Compose app on the iPhone app's engine ([#755](https://github.com/kiwi-init/channels/pull/755)) ([f2c0e41](https://github.com/kiwi-init/channels/commit/f2c0e41a212e69fad30848c4c98193a7c8937d17))
- The Linux launcher test gives its first compile 30 s, not bun's 5 (T419) ([#888](https://github.com/kiwi-init/channels/pull/888)) ([3a0270f](https://github.com/kiwi-init/channels/commit/3a0270f8293163a7681a2f56700efa4a74ba676c))
- CI drops android / device, the emulator run of the Android app (T543) ([#889](https://github.com/kiwi-init/channels/pull/889)) ([3ce290e](https://github.com/kiwi-init/channels/commit/3ce290e7610f0b8bcb07b85f11b8d06b1bd6cf89))
- **Android:** a channel's row shows its latest message from anywhere in it, with where it was said, and the list sorts by it, as the iPhone does since #752 ([#890](https://github.com/kiwi-init/channels/pull/890)) ([493fdbd](https://github.com/kiwi-init/channels/commit/493fdbd5dd39ea634eddd596bfe5d0da323ec5ef))
- **Android:** reviews waiting on you reach the phone, with Approve and Send back ([#891](https://github.com/kiwi-init/channels/pull/891)) ([cbd2ad1](https://github.com/kiwi-init/channels/commit/cbd2ad1d391e6070cceae0f8b016d4f13c34a4ea))
- desktop / linux runs the app's smoke in a Wayland session, weston with XWayland and no Xvfb (T434) ([#892](https://github.com/kiwi-init/channels/pull/892)) ([f91085d](https://github.com/kiwi-init/channels/commit/f91085d780482f7b24924b96caf44c4f358ed6cd))
- **Android:** opening the keyboard scrolls the conversation to the newest message ([#894](https://github.com/kiwi-init/channels/pull/894)) ([e8b59d3](https://github.com/kiwi-init/channels/commit/e8b59d377c61f320d1e9a695e5df411a93022356))
- **Android:** tapping a quote centres the quoted message ([#895](https://github.com/kiwi-init/channels/pull/895)) ([1aa768f](https://github.com/kiwi-init/channels/commit/1aa768f2be30c6e6dabec31f5f8be0f5ba597968))
- **Android:** www addresses and email addresses become links ([#896](https://github.com/kiwi-init/channels/pull/896)) ([e63ffad](https://github.com/kiwi-init/channels/commit/e63ffadd987843554e0590b41b28c97a0f8fe64a))
- **Android:** TalkBack reads who reacted, and which answer was chosen ([#897](https://github.com/kiwi-init/channels/pull/897)) ([a998066](https://github.com/kiwi-init/channels/commit/a9980660af05d84678e2b2dd6eca55fc84a851a6))
- New key pairs ride out Linux WebKit's failing generateKey, and the shots' first run says what the page said (T517) ([#898](https://github.com/kiwi-init/channels/pull/898)) ([d7e72ed](https://github.com/kiwi-init/channels/commit/d7e72ede2c975d594f2067af6d9c9833b8a54f77))
- android / build draws every Android screen, light and dark, and keeps the pictures ([#899](https://github.com/kiwi-init/channels/pull/899)) ([3d83060](https://github.com/kiwi-init/channels/commit/3d830605a7f07523a483ea497f4a49cdd79dcee9))
- **Android:** details' Needs you lists reviews, with Approve and Send back ([#900](https://github.com/kiwi-init/channels/pull/900)) ([aab48e5](https://github.com/kiwi-init/channels/commit/aab48e5a3a42be56e6dff0574a6235d709dab0eb))
- The phone's engine names each harness and says whether its computer takes bypass (T24's engine part) ([#901](https://github.com/kiwi-init/channels/pull/901)) ([aad5b23](https://github.com/kiwi-init/channels/commit/aad5b23dadef6d03b10a67fe0075494246c3b1c7))
- **ios / gestures:** a drag waits for a bubble to show before it measures, so a slow first render isn't a gesture failure (T568) ([#902](https://github.com/kiwi-init/channels/pull/902)) ([8f49b19](https://github.com/kiwi-init/channels/commit/8f49b19788fe9f1f24a4d9e9ff8270ab91232119))
- **iPhone:** New Agent sheet, from the channel's details, with Face ID before Bypass (T24) ([#862](https://github.com/kiwi-init/channels/pull/862)) ([7b1e9c4](https://github.com/kiwi-init/channels/commit/7b1e9c4377ae72662a284df7f463298c0f8c1d46))
- Main's full CI run finishes again: a newer push waits instead of cancelling the run going (T324) ([#903](https://github.com/kiwi-init/channels/pull/903)) ([99c1a39](https://github.com/kiwi-init/channels/commit/99c1a39712cf503e96fd92ed4fa4f0a237552d27))
- **Android:** New agent, from a channel's details (T619) ([#904](https://github.com/kiwi-init/channels/pull/904)) ([7b2e685](https://github.com/kiwi-init/channels/commit/7b2e6850010aa574d8d71b83b9d5481219bb856b))
- **Android:** New agent's harness list shows each harness's icon ([#905](https://github.com/kiwi-init/channels/pull/905)) ([8742b72](https://github.com/kiwi-init/channels/commit/8742b721b160a131bb96a7d9707608efdfb36d3e))
- Electron leaves the repo: the Electrobun app is the only desktop app, Apple silicon and Linux (T580) ([#906](https://github.com/kiwi-init/channels/pull/906)) ([87e5441](https://github.com/kiwi-init/channels/commit/87e54415603222817f1f07b44e97f4e8237f0bd3))
- **Android:** the keyboard no longer covers the answer and send-back fields in Details, or Start in New agent ([#907](https://github.com/kiwi-init/channels/pull/907)) ([e95e18f](https://github.com/kiwi-init/channels/commit/e95e18fde663d7dd857171206c5418abc20e5dcc))
- **Android:** search results scroll above the keyboard ([#908](https://github.com/kiwi-init/channels/pull/908)) ([972868d](https://github.com/kiwi-init/channels/commit/972868dbc1fa3260861d934a1c09a6325465803f))
- **Android:** the sample questions in the screenshots carry the engine's labels ([#910](https://github.com/kiwi-init/channels/pull/910)) ([c40da08](https://github.com/kiwi-init/channels/commit/c40da08803847ccf44f99999759fdede1732f878))
- **CI cleanup 1/4:** perf runs leave CI; perf.yml starts by hand (T730) ([#911](https://github.com/kiwi-init/channels/pull/911)) ([1fdaf05](https://github.com/kiwi-init/channels/commit/1fdaf0559d0554fcda06a40038f780638a051edf))
- A launched Channels window can take focus on Wayland: the Linux launcher keeps DESKTOP_STARTUP_ID and passes Plasma's XDG_ACTIVATION_TOKEN on as it (T785) ([#909](https://github.com/kiwi-init/channels/pull/909)) ([3185927](https://github.com/kiwi-init/channels/commit/31859277d6bba427317617e62d44a83a7314ea64))
- Channels on Linux follows the desktop's light or dark, live: GNOME's Dark style no longer leaves it light (T768) ([#912](https://github.com/kiwi-init/channels/pull/912)) ([cb2aac8](https://github.com/kiwi-init/channels/commit/cb2aac82743a31a6b24ea6b79fa32e8d577c1722))
- **CI cleanup 2/4:** the release rehearsal runs by hand from rehearsal.yml (T779) ([#913](https://github.com/kiwi-init/channels/pull/913)) ([278bf77](https://github.com/kiwi-init/channels/commit/278bf7718cf6e35302359ef3914c8e73e74aae01))
- **Android:** back on the lock screen leaves the app instead of changing the screen behind it, and locking puts the keyboard away ([#915](https://github.com/kiwi-init/channels/pull/915)) ([58ee778](https://github.com/kiwi-init/channels/commit/58ee778dd1f6d98ba55f414cd6a5c50dbcf817c4))
- Closing Channels on Linux minimizes it where no tray host runs, instead of hiding a window nothing can bring back (T770) ([#914](https://github.com/kiwi-init/channels/pull/914)) ([2d3cf2d](https://github.com/kiwi-init/channels/commit/2d3cf2d731d4bae05b0332a049ba402c02fe35a5))
- The Linux app opens natively on Wayland: Electrobun's native wrapper rebuilt from source with a patch (T523) ([#918](https://github.com/kiwi-init/channels/pull/918)) ([1efd7d3](https://github.com/kiwi-init/channels/commit/1efd7d337f06be8944d51180fbcacbf0200246f4))
- **CI cleanup 3/4:** no timing shards; unit, flows and cli / macos run as one job each (T780) ([#916](https://github.com/kiwi-init/channels/pull/916)) ([8c998a3](https://github.com/kiwi-init/channels/commit/8c998a3840f6e4968e60c7ccdbb52b50ad95a041))
- **CI cleanup 4/4:** CI-config-only tests out; AGENTS.md lists every ci.yml job (T781) ([#920](https://github.com/kiwi-init/channels/pull/920)) ([6773774](https://github.com/kiwi-init/channels/commit/67737749e3cf3a5fe4f571961af415927ad41f17))
- The app menu's shortcuts work on Linux: Ctrl+= / Ctrl+- / Ctrl+0, Ctrl+R, Ctrl+Q, Ctrl+W and F11 (T769) ([#917](https://github.com/kiwi-init/channels/pull/917)) ([1310479](https://github.com/kiwi-init/channels/commit/13104798f7c5382b04b29e182e6f1ac63e9f7d1a))
- **Android:** an answer from details that doesn't send keeps what you typed and says Couldn't send ([#922](https://github.com/kiwi-init/channels/pull/922)) ([53c4650](https://github.com/kiwi-init/channels/commit/53c4650aa79f1b5b70fa75db25ff36f1f663a0e1))
- Channels' first window fits the screen on Linux and keeps a minimum size (T771) ([#919](https://github.com/kiwi-init/channels/pull/919)) ([4bbfcf6](https://github.com/kiwi-init/channels/commit/4bbfcf6d2f6031669b3ee12079cd4f09173ea910))
- Linux notifications come from Channels over D-Bus, and clicking one opens the window (T772) ([#921](https://github.com/kiwi-init/channels/pull/921)) ([045c473](https://github.com/kiwi-init/channels/commit/045c47340be0e90ee59ec879229706be4cbace81))
- The annotator's Copy image works: no fetch of a data: URL, which the CSP blocks (T889) ([#923](https://github.com/kiwi-init/channels/pull/923)) ([204c415](https://github.com/kiwi-init/channels/commit/204c415e94be56b3fccd8f45789f2f218370153d))
- **Android:** the jump button counts each new message, not each batch the engine sends ([#924](https://github.com/kiwi-init/channels/pull/924)) ([067d482](https://github.com/kiwi-init/channels/commit/067d4827011c0348e725482a1cb01c7eef954892))
- The release's dmg is tried again when hdiutil fails on the macOS runner, and a failure says why (T886) ([#925](https://github.com/kiwi-init/channels/pull/925)) ([337c50d](https://github.com/kiwi-init/channels/commit/337c50d3691fb9cbc18de09f2754295c3125acb7))

## 0.27.4 — 2026-10-24

Tag [v0.27.4](https://github.com/kiwi-init/channels/releases/tag/v0.27.4) · commit [52ef976](https://github.com/kiwi-init/channels/commit/52ef9763e6097f58a0833d9148b2696263a65db5) · 2026-10-24

### Other changes

- The iPhone engine lists your computers, launches on one, follows it and lets your own agents in (T23) ([#859](https://github.com/kiwi-init/channels/pull/859)) ([5f9f89a](https://github.com/kiwi-init/channels/commit/5f9f89a6f84ce6cc24d5076096410fd02f653568))
- Settings shows each harness's hooks on this computer, and installs, updates or removes them (T13) ([#861](https://github.com/kiwi-init/channels/pull/861)) ([348d798](https://github.com/kiwi-init/channels/commit/348d798dea8de869495b8de934828b9136e3d0cf))
- A fresh computer can start agents: its home folder's git repos and folders you add (T22) ([#863](https://github.com/kiwi-init/channels/pull/863)) ([83e6121](https://github.com/kiwi-init/channels/commit/83e6121ce225fa7ca1d10e1e7841235e4f5b155d))
- Grok and MiMoCode can be started from New agent and kiwi launch, with their own model, effort and permission flags (T12) ([#865](https://github.com/kiwi-init/channels/pull/865)) ([08b7618](https://github.com/kiwi-init/channels/commit/08b7618f66b92e5c075bb3a88face06b6832d35e))
- New agent picks the model, effort, context and permissions for each harness, remembered per computer (T11) ([#860](https://github.com/kiwi-init/channels/pull/860)) ([63a2285](https://github.com/kiwi-init/channels/commit/63a2285cbdf999e94677e19f36aef978921e41a6))
- **Per computer:** allow bypass on launches from your other devices, off by default; launch options in remote.log (T25) ([#867](https://github.com/kiwi-init/channels/pull/867)) ([42fdf78](https://github.com/kiwi-init/channels/commit/42fdf78f29e30cf44d74508b0537f97ed5e8fb22))
- People pick their colour in the app, and the owner sets anyone's, as kiwi color already says (T16) ([#868](https://github.com/kiwi-init/channels/pull/868)) ([6486fb8](https://github.com/kiwi-init/channels/commit/6486fb87ff757a0037fb84d209068a32997bdb13))
- The UI smoke opens the conversation by its row, not the Conversations heading's first button (T281) ([#869](https://github.com/kiwi-init/channels/pull/869)) ([b801356](https://github.com/kiwi-init/channels/commit/b80135696bb300b4420c2f3bcf288973ebc3608a))
- The owner turns an agent's wake on or off from its menu in Details, for agents on this computer (T14) ([#866](https://github.com/kiwi-init/channels/pull/866)) ([be3b18c](https://github.com/kiwi-init/channels/commit/be3b18c8638ae51c0c774943107b6923c989a7ec))
- **Settings → Computers:** each paired computer's settings, read only (T18) ([#870](https://github.com/kiwi-init/channels/pull/870)) ([573dae5](https://github.com/kiwi-init/channels/commit/573dae59568b0da598acb0b818796220cf82c2eb))
- Kimi Code can be started from New agent and kiwi launch: the daemon types its first prompt in once its screen is ready, in Rex or tmux (T222) ([#871](https://github.com/kiwi-init/channels/pull/871)) ([9f388c4](https://github.com/kiwi-init/channels/commit/9f388c44c2f4c39330eb01bdd92faafa3e2bd07f))
- Gemini CLI can be started from New agent and kiwi launch, with its model and approval mode (T339) ([#874](https://github.com/kiwi-init/channels/pull/874)) ([5adb113](https://github.com/kiwi-init/channels/commit/5adb113b7d1c668591e79f852cd947d5cec8e8e4))
- A newer push to main cancels the older main run, and the cancelled run's ci-ok passes for it (T324) ([#875](https://github.com/kiwi-init/channels/pull/875)) ([3632d37](https://github.com/kiwi-init/channels/commit/3632d37355cb7a196dfdcff0d86a5f4c1eb7dc35))
- **Settings:** every harness on this computer, and a Check this computer panel from kiwi doctor (T17) ([#873](https://github.com/kiwi-init/channels/pull/873)) ([d67f1fb](https://github.com/kiwi-init/channels/commit/d67f1fba4430b436888b432097374c0fe154fc35))
- Pi can be started from New agent and kiwi launch, with its model and thinking level (T347) ([#876](https://github.com/kiwi-init/channels/pull/876)) ([62d14d0](https://github.com/kiwi-init/channels/commit/62d14d0c2d4a15986aaddcb652a71f880d3e4aed))
- Settings lists the folders agents can start in on this computer, with Add a folder… and Remove (T237) ([#872](https://github.com/kiwi-init/channels/pull/872)) ([5fc2161](https://github.com/kiwi-init/channels/commit/5fc2161090748adf677bc6736a86d9f90f912d03))
- OpenCode can be started from New agent and kiwi launch, with model and permission choices checked on the real CLI (T346) ([#877](https://github.com/kiwi-init/channels/pull/877)) ([6a46be3](https://github.com/kiwi-init/channels/commit/6a46be3a227bdeb6dbbb4b747fb729475656b465))
- kiwi pair rides out the relay's hiccups, starts this computer's daemon, and the app says what to do when it never came online (T358) ([#878](https://github.com/kiwi-init/channels/pull/878)) ([89eb586](https://github.com/kiwi-init/channels/commit/89eb5861667c80beb2870abb31efcd853a8c94c8))
- Grok's Stop hook counts a monitor named by its [monitor] display line as the listener, and logs the monitors it saw when none is (T386) ([#879](https://github.com/kiwi-init/channels/pull/879)) ([cfc2af4](https://github.com/kiwi-init/channels/commit/cfc2af44d83872b6984035c5e533aa82eb5431a3))
- A send is stored once however often it arrives: a send id the room remembers (T376) ([#880](https://github.com/kiwi-init/channels/pull/880)) ([b7b527a](https://github.com/kiwi-init/channels/commit/b7b527a2afbfb60d64b4870a66ed1f292f6b60f4))
- A flow test starts an agent on a paired computer from another device, on a local relay, with model, effort and permission, and bypass only when that computer allows it (T394) ([#881](https://github.com/kiwi-init/channels/pull/881)) ([06860d4](https://github.com/kiwi-init/channels/commit/06860d4279b087fc56f34b14b34e52aa51aeb9b1))
- A rehearsal dispatched by hand keeps its packages for 3 days, so they can be unpacked before a tag (T413) ([#883](https://github.com/kiwi-init/channels/pull/883)) ([4083bdc](https://github.com/kiwi-init/channels/commit/4083bdcf3565616be5008b7d55f1cb372f24918a))
- The app carries a minisign check and Jow's pinned release key, and a hand-run workflow proves the release secret pairs with it (T406) ([#884](https://github.com/kiwi-init/channels/pull/884)) ([689bf1c](https://github.com/kiwi-init/channels/commit/689bf1ce6fef6d0c299ff2401ed0c310700c6c3b))
- The rehearsal tries each package with its own parts: a channel made, a message sent and read back (T413) ([#885](https://github.com/kiwi-init/channels/pull/885)) ([0d804c4](https://github.com/kiwi-init/channels/commit/0d804c4cdc1673d9a9ff19abe85374d10d28d4e4))
- Linux AppImage updates are checked against the release key pinned in the app: the release signs SHA256SUMS with minisign, the updater verifies it (T406) ([#882](https://github.com/kiwi-init/channels/pull/882)) ([5a7a7dc](https://github.com/kiwi-init/channels/commit/5a7a7dcd5097a94de2482b37d2d9ef88441ce465))
- The landing page is a channel: agents and people around the app's glass ([#845](https://github.com/kiwi-init/channels/pull/845)) ([78ed1b6](https://github.com/kiwi-init/channels/commit/78ed1b6a7423c3a5f6c40dcd51e6733b22e4e6e6))
- On KDE, Channels finds the old Electron app's key in the wallet, under every name it could have used, and the dialog names the right file (T472) ([#886](https://github.com/kiwi-init/channels/pull/886)) ([57b38b4](https://github.com/kiwi-init/channels/commit/57b38b45df5800063cef0c79e3183d66b67f2f0e))
- The Mac app names its version where Finder and About read it: CFBundleShortVersionString (T496) ([#887](https://github.com/kiwi-init/channels/pull/887)) ([52ef976](https://github.com/kiwi-init/channels/commit/52ef9763e6097f58a0833d9148b2696263a65db5))

## 0.27.3 — 2026-10-24

Tag [v0.27.3](https://github.com/kiwi-init/channels/releases/tag/v0.27.3) · commit [8a1d815](https://github.com/kiwi-init/channels/commit/8a1d8154fff1108531a5458225ac2ca2149f06e6) · 2026-10-24

### Other changes

- CI no longer times the desktop app's cold start; smoke-eb keeps the first-run channel and message (T50) ([#850](https://github.com/kiwi-init/channels/pull/850)) ([aed908c](https://github.com/kiwi-init/channels/commit/aed908c07e5fff115b6b31cf773cd7371b57d72a))
- Sidebar folds conversations with members who left the channel (T20) ([#851](https://github.com/kiwi-init/channels/pull/851)) ([826614e](https://github.com/kiwi-init/channels/commit/826614e2773a0d8921c7ac0cbfc6cc25a9222ae4))
- smoke-eb reports the first-run channel on Linux instead of failing on it, until T92 ([#853](https://github.com/kiwi-init/channels/pull/853)) ([40cd4b3](https://github.com/kiwi-init/channels/commit/40cd4b3eb4eaee813e40efb932abe6295f0870a1))
- New agent is a few short steps with Start always in view, and says how a launch is going (T9) ([#855](https://github.com/kiwi-init/channels/pull/855)) ([e76ea69](https://github.com/kiwi-init/channels/commit/e76ea697a0fb36f49043bb196a54b27b168d2ce0))
- The relay lists a person's paired computers: GET /v1/person/:pk/machines (T21) ([#854](https://github.com/kiwi-init/channels/pull/854)) ([4773ab3](https://github.com/kiwi-init/channels/commit/4773ab3137f3288297b10371d0964c7da0d86f0a))
- kiwi launch takes --model, --effort, --permission and --context, carried to claude and codex as their own flags (T10) ([#856](https://github.com/kiwi-init/channels/pull/856)) ([0fbdd49](https://github.com/kiwi-init/channels/commit/0fbdd49553fea8d813630138a69569bbffad8689))
- **Sidebar:** a + on Conversations makes a new room, for the owner (T19) ([#857](https://github.com/kiwi-init/channels/pull/857)) ([8abee29](https://github.com/kiwi-init/channels/commit/8abee2948a5e6b649991bf344603ffd57eae0b02))
- The Linux app carries its keys worker again, so Create channel works there (T92) ([#858](https://github.com/kiwi-init/channels/pull/858)) ([8a1d815](https://github.com/kiwi-init/channels/commit/8a1d8154fff1108531a5458225ac2ca2149f06e6))

## 0.27.2 — 2026-10-24

Tag [v0.27.2](https://github.com/kiwi-init/channels/releases/tag/v0.27.2) · commit [eee0fb3](https://github.com/kiwi-init/channels/commit/eee0fb39a170e53e32221ec42b69ae24b0b0468a) · 2026-10-24

### Other changes

- The window gets its preload when it's made again, right after a full collection (T50, #847) ([#849](https://github.com/kiwi-init/channels/pull/849)) ([eee0fb3](https://github.com/kiwi-init/channels/commit/eee0fb39a170e53e32221ec42b69ae24b0b0468a))

## 0.27.1 — 2026-10-24

Tag [v0.27.1](https://github.com/kiwi-init/channels/releases/tag/v0.27.1) · commit [79837bd](https://github.com/kiwi-init/channels/commit/79837bd618a9c21a6af5793fa1753bfb01c0fea8) · 2026-10-24

### Other changes

- The window no longer fails to start on "Failed to parse webview secret key byte" (T50, #847) ([#848](https://github.com/kiwi-init/channels/pull/848)) ([79837bd](https://github.com/kiwi-init/channels/commit/79837bd618a9c21a6af5793fa1753bfb01c0fea8))

## 0.27.0 — 2026-10-23

Tag [v0.27.0](https://github.com/kiwi-init/channels/releases/tag/v0.27.0) · commit [0f5456f](https://github.com/kiwi-init/channels/commit/0f5456f4fadc4f7011bd5106bdeb4ffe5fe64d96) · 2026-10-23

### Other changes

- **WebKit pass:** the conversation opens on its newest message in WebKit too, and build / shots shoots every screen in WebKit (T441) ([#761](https://github.com/kiwi-init/channels/pull/761)) ([3e01e7d](https://github.com/kiwi-init/channels/commit/3e01e7db4ab9fbefe84f79c30c18c56deba13138))
- Desktop IPC behind a host seam: ipc/*.ts serve one typed table, the preload is only a transport (T484) ([#765](https://github.com/kiwi-init/channels/pull/765)) ([e9870f1](https://github.com/kiwi-init/channels/commit/e9870f1a6ea419f099435d2b0f67e95ec356d4dc))
- Store v2 for the Electrobun app: sealed with a keychain key, and Electron's store imported once (T435) ([#764](https://github.com/kiwi-init/channels/pull/764)) ([7782653](https://github.com/kiwi-init/channels/commit/7782653501ac3fe66e7ad1d6556ae2fd9b7332bd))
- **Desktop app seam:** the store, updater, daemon bundling, deep links and main log import no electron; each shell registers its Host (T643) ([#767](https://github.com/kiwi-init/channels/pull/767)) ([b8c03b5](https://github.com/kiwi-init/channels/commit/b8c03b5b1e2b55f33d3592053e824f603ce83279))
- **kiwi loop:** a fresh Claude Code session per task, review round or message (T531) ([#760](https://github.com/kiwi-init/channels/pull/760)) ([4be0be4](https://github.com/kiwi-init/channels/commit/4be0be4f3ab22f7de20b2e8ec0925f784a02fee9))
- kiwi loop --harness codex: the new thread found by its launch nonce (T532) ([#763](https://github.com/kiwi-init/channels/pull/763)) ([818d6db](https://github.com/kiwi-init/channels/commit/818d6db914b1694aab4f0636f5ce2e4fbe69d7be))
- **Store:** a vault load that throws partway leaves the store broken, so no later save writes defaults over either copy (T758) ([#771](https://github.com/kiwi-init/channels/pull/771)) ([ff98330](https://github.com/kiwi-init/channels/commit/ff98330ab350e4cdf6d45a6547dd3ac821669aea))
- Store v2 fails closed on a plain copy over a sealed store and on a plain import of an encrypted Electron store (T692) ([#768](https://github.com/kiwi-init/channels/pull/768)) ([4f94b94](https://github.com/kiwi-init/channels/commit/4f94b94ca75e4ac060e390c6ffb78f8383db2255))
- **kiwi loop:** a task in review isn't told to start it, and five fixes from #760's review (T789) ([#770](https://github.com/kiwi-init/channels/pull/770)) ([833050c](https://github.com/kiwi-init/channels/commit/833050ce721f5b3fa1af0dc51cb9c11f8aa96437))
- Electrobun shell on the Mac: the window opens web/dist with today's CSP; desktop / mac builds it and checks its size (T434) ([#758](https://github.com/kiwi-init/channels/pull/758)) ([d8eeaa7](https://github.com/kiwi-init/channels/commit/d8eeaa7badd73a85e4947952dacad437d5863dc8))
- **Electrobun:** our launcher in front of Electrobun's keeps BUN_OPTIONS, BUN_INSPECT, NODE_*, DYLD_* and JSC_* out of the app (T632) ([#766](https://github.com/kiwi-init/channels/pull/766)) ([a81af07](https://github.com/kiwi-init/channels/commit/a81af07c22cb7753a1908ed9e4705404752ae8a1))
- **Make a room:** the owner makes and renames rooms from channel settings in the app (T987) ([#790](https://github.com/kiwi-init/channels/pull/790)) ([b9c36ac](https://github.com/kiwi-init/channels/commit/b9c36ac2a8e23067712d88a4f69aa33d96e0a190))
- A missing kiwi-store.bin with a .bak that can't be read is unreadable, never a first run that saves defaults over the .bak (T855) ([#779](https://github.com/kiwi-init/channels/pull/779)) ([84d7e73](https://github.com/kiwi-init/channels/commit/84d7e7365302bbc8e770f16996d36cf0155d6c76))
- On a Mac, a store key with both copies gone is a deleted store, refused and never imported over; the key is made only after the import decision (T907) ([#782](https://github.com/kiwi-init/channels/pull/782)) ([ea2cf54](https://github.com/kiwi-init/channels/commit/ea2cf547829db11b2d664dfae2b8493e12cd5e03))
- kiwi loop --harness grok: a fresh Grok session per task, found by its nonce (T533) ([#778](https://github.com/kiwi-init/channels/pull/778)) ([24cf5a8](https://github.com/kiwi-init/channels/commit/24cf5a8c87632dc72e88a5ca849631cea66d4abe))
- desktop / mac caches Electrobun's toolchain and retries its download, so a blip can't turn ci-ok red (T887) ([#774](https://github.com/kiwi-init/channels/pull/774)) ([b4d2a7d](https://github.com/kiwi-init/channels/commit/b4d2a7d30d049c7abeba38075ea7ef4eea1c867d))
- A room is its own conversation in the app: opening it shows only its messages, and the composer posts into it (T1030) ([#795](https://github.com/kiwi-init/channels/pull/795)) ([1770e1e](https://github.com/kiwi-init/channels/commit/1770e1ecacfa6d57208494005787b142db8d87e5))
- **Rooms:** each room counts its own unread and keeps its own read mark, jumps open the message's room, a room shows its task cards, #general stays in the signed list (T1236) ([#800](https://github.com/kiwi-init/channels/pull/800)) ([9e2cbed](https://github.com/kiwi-init/channels/commit/9e2cbed6665e838b86f8bb3326f85e55422bf277))
- **Channel settings:** download the channel any time, as a transcript to read or the signed log, named with the date and time (T967) ([#796](https://github.com/kiwi-init/channels/pull/796)) ([8ff5127](https://github.com/kiwi-init/channels/commit/8ff5127c5d1ea7177da153216756735dad022412))
- The signed launcher holds the store key: Keychain there, the key to bun on fd 3, and every app file checked against a seal in Info.plist (T544) ([#772](https://github.com/kiwi-init/channels/pull/772)) ([5892757](https://github.com/kiwi-init/channels/commit/589275774933eb934e503581991a7d95af7880ba))
- **Transcript download:** Markdown links, link definitions, references and images are inert (T1374) ([#806](https://github.com/kiwi-init/channels/pull/806)) ([6744a22](https://github.com/kiwi-init/channels/commit/6744a22ac35f541adf9eab9eaf3b080c928985db))
- **main type-checks again:** the launcher's store key fails closed on drop, finished and finish until the launcher keeps the ready mark (T1076) ([#807](https://github.com/kiwi-init/channels/pull/807)) ([c935ce2](https://github.com/kiwi-init/channels/commit/c935ce2f5ccc5d7fd561c109c96152467509bfd9))
- The kiwi CLI is compiled with bunfig.toml and .env autoload off, so a project folder kiwi starts in can't preload code into it (T1365) ([#805](https://github.com/kiwi-init/channels/pull/805)) ([1c617d0](https://github.com/kiwi-init/channels/commit/1c617d0d7d8eaed159373727c84b41d121fddd91))
- **Key channel hygiene:** bun moves off fd 3 at once, the launcher serves one session, and its C runs under ASan and UBSan (T873) ([#775](https://github.com/kiwi-init/channels/pull/775)) ([2d8107f](https://github.com/kiwi-init/channels/commit/2d8107fddad04bae9638a21641f688ccdd809882))
- **Electrobun:** window.kiwi on Electrobun's RPC, main's handler table served to our page only, internal RPC locked (T436) ([#791](https://github.com/kiwi-init/channels/pull/791)) ([117386e](https://github.com/kiwi-init/channels/commit/117386e6ad35cef20daddc6c0ae246fe4e44741c))
- **Electrobun on Linux:** desktop / linux builds the shell on ubuntu, and package-linux makes the deb and AppImage under today's names (T444) ([#803](https://github.com/kiwi-init/channels/pull/803)) ([4a4327e](https://github.com/kiwi-init/channels/commit/4a4327e3c24b72d4455bb2e37aac3e4b5d61aa7e))
- The launcher keeps store v2's ready mark: finished, finish and drop (drop only for a key made in that session), the mark tied to its key (T1076) ([#808](https://github.com/kiwi-init/channels/pull/808)) ([39b10fb](https://github.com/kiwi-init/channels/commit/39b10fb1f6877f0813b783bab366303054d040a0))
- kiwi loop --harness mimo: a fresh MiMoCode session per task, stopped with SIGINT (T534) ([#787](https://github.com/kiwi-init/channels/pull/787)) ([5d2e94f](https://github.com/kiwi-init/channels/commit/5d2e94f83f58929f2bd30737b16bb5dd33125543))
- Electrobun's keys on a Bun Worker: channels.ts unchanged, the page's KeysPort over main's RPC, restart backoff and the 1 s quit flush (T437) ([#789](https://github.com/kiwi-init/channels/pull/789)) ([9fea37a](https://github.com/kiwi-init/channels/commit/9fea37a00ec4c7c2699f518384180df6fcd317d2))
- ios / build and ios / gestures wait only on what the iPhone app is built from (T1598) ([#810](https://github.com/kiwi-init/channels/pull/810)) ([0565e14](https://github.com/kiwi-init/channels/commit/0565e14b100c40d13084bb99de2928605872fd8e))
- **Electrobun app life:** one instance per data folder, close hides, Quit flushes, Dock reopen, kiwi:// links, the tray and app menus, the wake nudge (T438) ([#780](https://github.com/kiwi-init/channels/pull/780)) ([6b2046c](https://github.com/kiwi-init/channels/commit/6b2046c76e8c87428a57348384ddf314414f59be))
- **Electrobun bridge:** sessions are main's, an old load's reply never leaves main, the preload runs only in the top frame, and a quit answers what waited for a restarting Worker (T1230) ([#812](https://github.com/kiwi-init/channels/pull/812)) ([87ed383](https://github.com/kiwi-init/channels/commit/87ed383b1360e41379612c5187f11d7d14eae8da))
- kiwi loop --harness kimi: the first prompt typed into Kimi's window, stray listeners stopped (T535) ([#793](https://github.com/kiwi-init/channels/pull/793)) ([e1172ad](https://github.com/kiwi-init/channels/commit/e1172adc835cb377a6b41d59e6501acb4bf91266))
- **Electrobun bridge:** each document is its own session, load() retires the old one at once, and a page that joins a running GitHub link gets its code again (T1741) ([#813](https://github.com/kiwi-init/channels/pull/813)) ([4b5b514](https://github.com/kiwi-init/channels/commit/4b5b51418b1c995b72e3ae3031e8793f0fbb147e))
- The Electrobun app updates itself, and a Linux AppImage swaps itself in place; a deb install is offered its .deb (T1554) ([#815](https://github.com/kiwi-init/channels/pull/815)) ([0d20d54](https://github.com/kiwi-init/channels/commit/0d20d54b1c369909d67637faeeb604ad7a726ff6))
- On Linux our launcher keeps the app's environment to an allowlist before Electrobun's starts (T1548) ([#817](https://github.com/kiwi-init/channels/pull/817)) ([4469029](https://github.com/kiwi-init/channels/commit/446902920510cff641c928477b8fffa53743acb4))
- Electrobun bridge vs script in our page: trust from the native committed URL, ids and frames out of the page's hooks (T1855) ([#816](https://github.com/kiwi-init/channels/pull/816)) ([af1fa39](https://github.com/kiwi-init/channels/commit/af1fa39a06ab1750d4ea29656690fe4843b0fb42))
- Electrobun on Linux starts: libkiwi-shell for WebKitGTK denies permission requests, watches the page and its commits, names the app and turns WebKitGTK's sandbox on (T1545) ([#809](https://github.com/kiwi-init/channels/pull/809)) ([a485735](https://github.com/kiwi-init/channels/commit/a4857356823f0893ce59bd69c5422ff290ef51de))
- CI drives the Electrobun app without CDP: a test-only driver, smoke-eb, and perf-desktop's cold start with its own gates (T442) ([#769](https://github.com/kiwi-init/channels/pull/769)) ([5999b19](https://github.com/kiwi-init/channels/commit/5999b196f2122234665331e75965b6d53f16a104))
- CI answers the merge queue: ci.yml runs on merge_group, each group in its own concurrency group (T2034) ([#819](https://github.com/kiwi-init/channels/pull/819)) ([6f1b997](https://github.com/kiwi-init/channels/commit/6f1b99778702ae971d35ea48a39a4847df48113a))
- jev-ci plans a merge group on its combined change, trusts the queue's pass markers, and main skips commits the queue tested (T2034) ([#821](https://github.com/kiwi-init/channels/pull/821)) ([14a9195](https://github.com/kiwi-init/channels/commit/14a919526ea60deb8e21a07300e4c14ae083a7da))
- A pull request runs only repo / static and test / unit; the merge queue's group runs the rest of the plan (T2134) ([#826](https://github.com/kiwi-init/channels/pull/826)) ([778e8a7](https://github.com/kiwi-init/channels/commit/778e8a7f6f2ea45903c9c6c0b94d761104e943fe))
- desktop / linux runs on ubuntu-26.04, not ubuntu-latest while that label moves ([#825](https://github.com/kiwi-init/channels/pull/825)) ([1cf4457](https://github.com/kiwi-init/channels/commit/1cf4457157c27a09de641a623191f52560ba6dcb))
- Electrobun in-app checks on the driver: the bridge against Electrobun's internals and script in our page (T1240) ([#820](https://github.com/kiwi-init/channels/pull/820)) ([d8ed64b](https://github.com/kiwi-init/channels/commit/d8ed64b43d668c2ec668fc7b13b9239038259cb8))
- The keys Worker test keeps keys-eb's real 1 s flush timeout, so a slow runner's Worker isn't killed before it writes and answers (T2147) ([#827](https://github.com/kiwi-init/channels/pull/827)) ([7ed260a](https://github.com/kiwi-init/channels/commit/7ed260affe2d234633eb88d3e1f0136316049e55))
- **Electrobun test builds:** data and lock under a temp home, the .test id on dev only, a private driver socket (T1820) ([#824](https://github.com/kiwi-init/channels/pull/824)) ([6d0a772](https://github.com/kiwi-init/channels/commit/6d0a772316119cc4587c8763cc9647fbb3da0251))
- Channels starts on Ubuntu 24.04: the deb's AppArmor profile lets WebKitGTK's sandbox run, and the app falls back with a log line when bwrap can't build it (T2119) ([#829](https://github.com/kiwi-init/channels/pull/829)) ([fb755ef](https://github.com/kiwi-init/channels/commit/fb755efe4ae455f8f7dd47de04cf923ebac45d2b))
- **Electrobun shell hardening:** no CSP-less copy of the page, rules that fail closed, a parsed <head>, a pinned toolchain, own downloads only (T804) ([#776](https://github.com/kiwi-init/channels/pull/776)) ([b1f115b](https://github.com/kiwi-init/channels/commit/b1f115bf7124e299008ef7ebb1686c3ff05fdcc2))
- The browser action's caches stay on their runner image: WebKit no longer closes at launch in build / shots (T2249) ([#832](https://github.com/kiwi-init/channels/pull/832)) ([c45b3d1](https://github.com/kiwi-init/channels/commit/c45b3d1e174a0c0f4755be04244525f704b59040))
- The app icon is the prism on the black square, every size for Mac, Linux and iOS, and the favicons (T2140) ([#828](https://github.com/kiwi-init/channels/pull/828)) ([74f5ac6](https://github.com/kiwi-init/channels/commit/74f5ac67658c58ff7bb80d05e56cd2ed712b3e69))
- Linux libkiwi-shell guards downloads and allows only the page, checked at start like on the Mac (T2071) ([#823](https://github.com/kiwi-init/channels/pull/823)) ([3e1eba6](https://github.com/kiwi-init/channels/commit/3e1eba6fa86f7385986ed8880b27a38bc13be8c9))
- **Electrobun:** the bundled kiwi CLI, the daemon keeper, main.log, and a stopped page reloaded (T439) ([#797](https://github.com/kiwi-init/channels/pull/797)) ([19aee09](https://github.com/kiwi-init/channels/commit/19aee0939937709499f33e724148de0446021380))
- The repo is kiwi-init/channels: every ojowwalker77/channels in code, site, docs and tests moves, the updater's release URL check included (T2037) ([#822](https://github.com/kiwi-init/channels/pull/822)) ([71c3607](https://github.com/kiwi-init/channels/commit/71c360780804514d812f7a27c2aee84898cf7040))
- smoke-eb proves the navigation canary on the built app; one strict notion of our page; post-build reads the app id; the linux-arm64 pins checked (T1067) ([#833](https://github.com/kiwi-init/channels/pull/833)) ([cfcf6b1](https://github.com/kiwi-init/channels/commit/cfcf6b1677633ce0a970d5cc3a3d6cfc24c0d8d0))
- Electrobun cold start, part 1: startup marks per launch, a leftover check and loop-scaled numbers in perf-desktop (T798) ([#831](https://github.com/kiwi-init/channels/pull/831)) ([680f47d](https://github.com/kiwi-init/channels/commit/680f47dcbeaa1339116745d264aa774d564450af))
- The Mac Electrobun app keeps its keys in store v2 through the launcher, imports Electron's store once, and reports a refused mark (T1582) ([#811](https://github.com/kiwi-init/channels/pull/811)) ([7846405](https://github.com/kiwi-init/channels/commit/7846405bf29d2c8806497d61baac09ecbb3a995e))
- Release gates from #811: the key channel stays the first code in the main bundle, delete-by-reference on the real Security framework, a pinned data folder and per-cause store dialogs (T1710) ([#837](https://github.com/kiwi-init/channels/pull/837)) ([100de88](https://github.com/kiwi-init/channels/commit/100de887104db42fcd12e03b01376eafc7fbe834))
- The Linux store is checked on a real Secret Service: Electron's v11 store through a throwaway GNOME keyring, and plain JSON at 0600 logged when none runs (T1550) ([#838](https://github.com/kiwi-init/channels/pull/838)) ([a079c00](https://github.com/kiwi-init/channels/commit/a079c00e8397f8d31f598416c11f3b47158dc9b6))
- The stopped-page watch works on the Mac: kiwi-shell adds the delegate method Electrobun doesn't have, before the window exists (T2386) ([#839](https://github.com/kiwi-init/channels/pull/839)) ([6d488d3](https://github.com/kiwi-init/channels/commit/6d488d381380aca3b945072c9ec1ba194def96b7))
- jev-ci.yml and main-eb.ts stop being every Electrobun PR's conflict: lists one item per line, descriptions one sentence per line, each startup feature in its own module (T2212) ([#834](https://github.com/kiwi-init/channels/pull/834)) ([17f3e3f](https://github.com/kiwi-init/channels/commit/17f3e3fc0f143f6fe7166e17a05302a5c0f76e8e))
- Merge pull request #841 from kiwi-init/T2071b-guard-test ([6b446e0](https://github.com/kiwi-init/channels/commit/6b446e08df537dfc82cfa3b1224ad460ee15a337))
- A manual CI run can pick its jobs: workflow_dispatch takes a jobs input ([#842](https://github.com/kiwi-init/channels/pull/842)) ([fe8cc9d](https://github.com/kiwi-init/channels/commit/fe8cc9dbd63698e3a3460ef7ba25da7f66519346))
- desktop / linux drives the Electrobun app like the Mac: a test build, the driver check, smoke-eb and perf-desktop under Xvfb, and a purge that leaves nothing (T1552) ([#830](https://github.com/kiwi-init/channels/pull/830)) ([154e11c](https://github.com/kiwi-init/channels/commit/154e11c5c65abf7d03042c8fa694905294a20c0f))
- The Linux Electrobun app bundles kiwi.js, so its daemon keeper starts kiwi and it installs the CLI, and the release build makes dist/kiwi.js before eb-post-build needs it (T2317) ([#835](https://github.com/kiwi-init/channels/pull/835)) ([4f49339](https://github.com/kiwi-init/channels/commit/4f4933954af22ac8a9dea219fcd6243b0ad843ea))
- **Electrobun cold start:** the tray after the first screen, and marks for the navigation, the keys path and the page's cache (T2190) ([#836](https://github.com/kiwi-init/channels/pull/836)) ([088d024](https://github.com/kiwi-init/channels/commit/088d02491836af1565959d8bc8b49e1ff226197b))
- Releases ship the Electrobun app on Apple silicon and Linux; Electron builds only the Intel Mac app (T445) ([#840](https://github.com/kiwi-init/channels/pull/840)) ([3677cbd](https://github.com/kiwi-init/channels/commit/3677cbd0ff2313fc762109b0ef1d86fd9d427017))
- The update rehearsal gives its temp HOME its own keychain, and shows where the updated app waits ([#843](https://github.com/kiwi-init/channels/pull/843)) ([0f5456f](https://github.com/kiwi-init/channels/commit/0f5456f4fadc4f7011bd5106bdeb4ffe5fe64d96))

## 0.26.0 — 2026-10-23

Tag [v0.26.0](https://github.com/kiwi-init/channels/releases/tag/v0.26.0) · commit [75cb9d9](https://github.com/kiwi-init/channels/commit/75cb9d97463dace71300cd86cb4b064ce47484c0) · 2026-10-23

### Fixes

- **iPhone:** reviews waiting on you reach the phone, and a channel's row shows its latest message (#743) ([#752](https://github.com/kiwi-init/channels/pull/752)) ([c18381d](https://github.com/kiwi-init/channels/commit/c18381d03408003ff7ae121bc5c38ff72fb368d5))

### Other changes

- perf-feel.ts times what a person feels behind a relay far away: send to bubble, opening a task, layout shifts, filmstrips (T11) ([#728](https://github.com/kiwi-init/channels/pull/728)) ([312ed40](https://github.com/kiwi-init/channels/commit/312ed4036a6c78052515be1839b18daa2f1a4251))
- A channel opens after one round trip, not three: board in 375 ms instead of 768 at 150 ms RTT (T30) ([#729](https://github.com/kiwi-init/channels/pull/729)) ([6ffcd86](https://github.com/kiwi-init/channels/commit/6ffcd86a265e46815d81fb0e17a2d6fdd3d5ec28))
- A channel that's still opening shows nothing it doesn't know: no Add an agent / No tasks yet / Connecting… flash on reload (T31) ([#731](https://github.com/kiwi-init/channels/pull/731)) ([ae11b92](https://github.com/kiwi-init/channels/commit/ae11b926493183e41f9d44f0fe47c8d55a9d6b34))
- Panels, menus and dialogs leave instead of vanishing, and tasks slide to their new place: Motion only where CSS can't (T10) ([#730](https://github.com/kiwi-init/channels/pull/730)) ([0db9439](https://github.com/kiwi-init/channels/commit/0db943901b2a07a8b5644bc60782730505056d0b))
- The rows a conversation opens on are laid out at once, so they don't grow from a 64 px guess after they're painted (T33) ([#732](https://github.com/kiwi-init/channels/pull/732)) ([ae3bc43](https://github.com/kiwi-init/channels/commit/ae3bc43101227e7e8361555349f5fdd092a5f733))
- A re-run of perf / scale measures again: every artifact upload overwrites the attempt before it (T79) ([#733](https://github.com/kiwi-init/channels/pull/733)) ([6c92332](https://github.com/kiwi-init/channels/commit/6c92332035bfb86bfcbb96304ea770501e339601))
- Typing on machines without a GPU: the scrims drop their blur there, and perf-scale's typing gate measures the app, not its own CLI start-ups (T34) ([#734](https://github.com/kiwi-init/channels/pull/734)) ([566dc07](https://github.com/kiwi-init/channels/commit/566dc07ea950bc750efdcf391a26ea49cbe13303))
- A channel opens on its conversation, not the Tasks board (T180) ([#737](https://github.com/kiwi-init/channels/pull/737)) ([2ce5b68](https://github.com/kiwi-init/channels/commit/2ce5b684dc0fd49db64da3067f4d85b4578e3da2))
- Needs you says one line per thing, details on a click; the board drops its empty PR columns (T182) ([#739](https://github.com/kiwi-init/channels/pull/739)) ([0a67e57](https://github.com/kiwi-init/channels/commit/0a67e57f7cf25c4b7a8566f35a7c00bd48c7abea))
- **Optimistic send:** the box empties on Enter and your message shows at once (T32) ([#741](https://github.com/kiwi-init/channels/pull/741)) ([c533375](https://github.com/kiwi-init/channels/commit/c5333751840a578c43b560c0f6c3578f9c1e4e41))
- A task or a thread slides over the page instead of squeezing it: the page keeps its width and scroll (T181) ([#738](https://github.com/kiwi-init/channels/pull/738)) ([6a603f2](https://github.com/kiwi-init/channels/commit/6a603f25297debcb37fe8be316909e7d0d1f1990))
- perf / scale runs perf-feel at 150 ms RTT and gates what a person feels (T54) ([#735](https://github.com/kiwi-init/channels/pull/735)) ([74f2bc7](https://github.com/kiwi-init/channels/commit/74f2bc744e15e0564ab342d22a4360ca5f5eeefc))
- A channel paints from what this device kept, before the relay answers: reload 375 → 265 ms at 150 ms RTT (T71) ([#744](https://github.com/kiwi-init/channels/pull/744)) ([96a67c1](https://github.com/kiwi-init/channels/commit/96a67c16fc63dcda345eafd6774cdb42cb8f126f))
- The relay's answer replaces what the early paint showed: an island the relay's head turns down is gone, not left above a gap (T300) ([#746](https://github.com/kiwi-init/channels/pull/746)) ([bbcc9c9](https://github.com/kiwi-init/channels/commit/bbcc9c9df4072b1630d2c2771fe5cafcc564f7d5))
- SECURITY.md says what the kept state can and can't do, and a floor the relay already answered isn't replaced by the kept one (T302) ([#748](https://github.com/kiwi-init/channels/pull/748)) ([ecc26c7](https://github.com/kiwi-init/channels/commit/ecc26c795b3e39f986c27d1f71eeafe182715677))
- A reply right after a send keeps its quote: fixes the smoke-ui 'send and reply' flake (T330) ([#750](https://github.com/kiwi-init/channels/pull/750)) ([411ef06](https://github.com/kiwi-init/channels/commit/411ef061ce5659aeeed0b6e5af9f37ce9a2df116))
- The app reopens the channel you had open: a launch lands in your last channel, not "Nothing open" (T287) ([#745](https://github.com/kiwi-init/channels/pull/745)) ([95eabef](https://github.com/kiwi-init/channels/commit/95eabef9b4efab0fdfbcf897248ff663ebed01f6))
- A kept fold base is checked like a snapshot before it's used: version, shape, outgrown, ≤ the relay's head (T301) ([#747](https://github.com/kiwi-init/channels/pull/747)) ([888dec3](https://github.com/kiwi-init/channels/commit/888dec33b67944bba5362a3dc102a5b9dc69a412))
- **Optimistic send edges:** messages go out in the order typed, a failed message never takes a reply with it, the reply bar clears on Enter (T369) ([#751](https://github.com/kiwi-init/channels/pull/751)) ([40de2e8](https://github.com/kiwi-init/channels/commit/40de2e82ccdaebfa0e9491fce9f06056acc12cc5))
- What a channel doesn't need before it paints loads when it runs: first-load JS 586,793 -> 581,635 bytes (T379) ([#753](https://github.com/kiwi-init/channels/pull/753)) ([59d6f58](https://github.com/kiwi-init/channels/commit/59d6f5879cf954eb234a49be587aa866eafd0edb))
- A channel paints without Effect's runtime: the open path is plain promises, first-load JS 581,635 -> 515,538 bytes (T392) ([#754](https://github.com/kiwi-init/channels/pull/754)) ([71ed521](https://github.com/kiwi-init/channels/commit/71ed5215144cb4f19231d02e2b813797ffc3598d))
- Desktop cold start, measured: launch to window, first paint, first cached message and live, in desktop / package (T53) ([#742](https://github.com/kiwi-init/channels/pull/742)) ([bc3c39f](https://github.com/kiwi-init/channels/commit/bc3c39f0810001062c7438c98f2e505bbef062cf))
- **iPhone:** a drag that starts on a message bubble scrolls the conversation (#749) ([#756](https://github.com/kiwi-init/channels/pull/756)) ([75cb9d9](https://github.com/kiwi-init/channels/commit/75cb9d97463dace71300cd86cb4b064ce47484c0))

## 0.25.3 — 2026-10-22

Tag [v0.25.3](https://github.com/kiwi-init/channels/releases/tag/v0.25.3) · commit [bbf73d5](https://github.com/kiwi-init/channels/commit/bbf73d53d368b8944c9898d4206a1414f7d05ee3) · 2026-10-22

### Other changes

- The invite box keeps the whole join command inside it: a pinned personality's --persona token wraps (T12) ([#691](https://github.com/kiwi-init/channels/pull/691)) ([4847217](https://github.com/kiwi-init/channels/commit/4847217ad370a3f264c7fee759a263873cc936a9))
- perf / scale runs its three runs side by side on three runners, then takes the medians (T13) ([#692](https://github.com/kiwi-init/channels/pull/692)) ([6ca3916](https://github.com/kiwi-init/channels/commit/6ca3916566e178971597bb328c73e21ef38e47a7))
- **cli / macos:** a hung cache save can't hold the job (T15) ([#693](https://github.com/kiwi-init/channels/pull/693)) ([d9c27f3](https://github.com/kiwi-init/channels/commit/d9c27f353b495504f970da7c1b7d0d9f83570843))
- Chromium's apt packages install from cached .deb files, so a slow mirror no longer stalls build / shots (T39) ([#690](https://github.com/kiwi-init/channels/pull/690)) ([82e0c69](https://github.com/kiwi-init/channels/commit/82e0c69e2be33542326f754179d122e2c4e7d941))
- perf / scale's gates fail CI again: perf-check's exit code no longer dies in tee (T53) ([#695](https://github.com/kiwi-init/channels/pull/695)) ([e99f1f7](https://github.com/kiwi-init/channels/commit/e99f1f7a6178b9a96952adec5466d51fc9d5b6cc))
- perf-scale seeds the channel in-process and lets the ten agents in at once (T106) ([#697](https://github.com/kiwi-init/channels/pull/697)) ([ddc80ca](https://github.com/kiwi-init/channels/commit/ddc80ca7731cbd831bc9274031dc8d8b8c416b0e))
- perf-scale's local relay runs without per-minute caps: --dev-no-rate-limits (T133) ([#698](https://github.com/kiwi-init/channels/pull/698)) ([7e92746](https://github.com/kiwi-init/channels/commit/7e92746f8f535924239258d70c5bc1cafcb46bb6))
- --dev-no-rate-limits lifts the caps only for requests made on this machine directly, like dev sign-in (T171) ([#701](https://github.com/kiwi-init/channels/pull/701)) ([9459b9f](https://github.com/kiwi-init/channels/commit/9459b9f056b1c090583066b733219f590706146d))
- build / shots takes its phone shots in the same run, on the channel it already seeded (T151) ([#699](https://github.com/kiwi-init/channels/pull/699)) ([2c32b0a](https://github.com/kiwi-init/channels/commit/2c32b0a5130ac80486289c2de8bb640d51cd2218))
- cli / macos runs every test file: a test's SIGINT no longer ends the run early with exit 0 (T163) ([#700](https://github.com/kiwi-init/channels/pull/700)) ([95f84e7](https://github.com/kiwi-init/channels/commit/95f84e76a4e50798b25e07ae4028da0aeaee1905))
- shoot-ui's phone pass skips the blocks that shoot nothing at that size (T205) ([#703](https://github.com/kiwi-init/channels/pull/703)) ([7da2061](https://github.com/kiwi-init/channels/commit/7da20614131018e12ab7ba739c538512e1198288))
- perf gates compare timings scaled to a reference runner, so a slow runner can't fail them (T101) ([#696](https://github.com/kiwi-init/channels/pull/696)) ([e1fdb5f](https://github.com/kiwi-init/channels/commit/e1fdb5f31d5ac41a3fd7e78ab15a99b5a4074faa))
- Neither dev flag starts with a trusted proxy, and a proxied socket upgrade keeps the cap, tested (T192) ([#702](https://github.com/kiwi-init/channels/pull/702)) ([02edf95](https://github.com/kiwi-init/channels/commit/02edf9504c5adc512a65d0cf2e508b201a239bf8))
- perf-check bounds each run's calibration and scales only Reload's in-page part (T257) ([#706](https://github.com/kiwi-init/channels/pull/706)) ([a5769ac](https://github.com/kiwi-init/channels/commit/a5769acbf2884e3278811845a7303ceb17bf9927))
- Base64 decoding builds its bytes in a plain loop: a reload with 2000 messages takes 13% less (T67) ([#707](https://github.com/kiwi-init/channels/pull/707)) ([ace0bf2](https://github.com/kiwi-init/channels/commit/ace0bf2250fdd69becb9c8fc2d149f2a9b8df41a))
- The Conversation tab mounts a first screen of rows, not 120: its switch at 4x takes half the time (T66) ([#705](https://github.com/kiwi-init/channels/pull/705)) ([d4b8f26](https://github.com/kiwi-init/channels/commit/d4b8f26c191e3a60650f4ce9d6cabf91c21994ba))
- ci-tests.ts reads bun's last summary and doesn't wait on a leftover process; the demo's stay lets go of SIGINT (T214) ([#704](https://github.com/kiwi-init/channels/pull/704)) ([3914d98](https://github.com/kiwi-init/channels/commit/3914d983b09a88c4d73142e3b11b27d63d0123cc))
- shoot-ui opens the add-agent screen only when it shoots it (T236) ([#709](https://github.com/kiwi-init/channels/pull/709)) ([b370928](https://github.com/kiwi-init/channels/commit/b370928ee2c2b039fa1a453c0a8ab0ec464af5f3))
- The relay refuses --flag=value instead of ignoring it (T241) ([#708](https://github.com/kiwi-init/channels/pull/708)) ([610d4e2](https://github.com/kiwi-init/channels/commit/610d4e27599264975d6ff01d8635834f30eebd51))
- Reload's gate goes back to 820: main measures it at 706 since #707 (T301) ([#711](https://github.com/kiwi-init/channels/pull/711)) ([c0ef88a](https://github.com/kiwi-init/channels/commit/c0ef88ad06999c15c1c7c8db68d31fe44a042d70))
- cli / macos splits its tests across three macOS runners, dealt by measured times (T91) ([#694](https://github.com/kiwi-init/channels/pull/694)) ([56db89a](https://github.com/kiwi-init/channels/commit/56db89a3455d5b9c92dce004e0377f1cb7bf9a25))
- test / unit, flows-a and flows-b each split across two runners (T152) ([#713](https://github.com/kiwi-init/channels/pull/713)) ([4f2a1a2](https://github.com/kiwi-init/channels/commit/4f2a1a29a23a67f6536c0476c35133e5aaa166a5))
- CI's perf runs measure only what the gates read: about 16 s less per run (T356) ([#716](https://github.com/kiwi-init/channels/pull/716)) ([883edb4](https://github.com/kiwi-init/channels/commit/883edb4ff8258bfae537aa36e31a82cf2251d8ba))
- The daemon's wake tests run in three files side by side: 73 s in one file becomes about 27 s (T359) ([#717](https://github.com/kiwi-init/channels/pull/717)) ([4045472](https://github.com/kiwi-init/channels/commit/40454729bfedccfdbbb16a62014fdd68b98716ef))
- pack-cli compresses on every core: desktop / package's packing goes from 44 to 16 s (T355) ([#715](https://github.com/kiwi-init/channels/pull/715)) ([7388255](https://github.com/kiwi-init/channels/commit/73882553bce54b47f7ab0c97f91e7f86a3fabeed))
- A key that waited for approval gets its daemon seat when its join writes its cursor, not at its backed-off retry (T407) ([#720](https://github.com/kiwi-init/channels/pull/720)) ([6cb8683](https://github.com/kiwi-init/channels/commit/6cb86837bb79930681f77f63e511f6be9087d693))
- A newer prompt is judged by the time its mark holds, not the file's: Linux dates files by a coarser clock (T386) ([#719](https://github.com/kiwi-init/channels/pull/719)) ([e6f48aa](https://github.com/kiwi-init/channels/commit/e6f48aacf27f488cd23aa8c12a76fc3898fd46fc))
- The desktop app never spawns a kiwi binary still being written: places of one file share one write (T369) ([#722](https://github.com/kiwi-init/channels/pull/722)) ([fe31455](https://github.com/kiwi-init/channels/commit/fe3145596c38042185c4670aaee14823bf565d3a))
- perf-check names a run left out of one timing; the blank-page calibration was measured and stays out (T292) ([#710](https://github.com/kiwi-init/channels/pull/710)) ([b7f1210](https://github.com/kiwi-init/channels/commit/b7f12103f62da6233643acc8d48b0a452d520ad1))
- join-seats.test.ts runs in three files side by side: 63 s in one file becomes about 25 s (T442) ([#724](https://github.com/kiwi-init/channels/pull/724)) ([4a58428](https://github.com/kiwi-init/channels/commit/4a58428ae0e67fcf1c4df7b758b4f486877ef549))
- Channels no longer has voice or dictation: the app, the desktop app, the relay, CI and the docs (T404) ([#721](https://github.com/kiwi-init/channels/pull/721)) ([0fb312d](https://github.com/kiwi-init/channels/commit/0fb312d17c2f80cee37e3efdc42022f7f36ea5d9))
- The app's Pair leaves its answer for the computer, and a dropped pairing mailbox reads 404 (#714) ([#718](https://github.com/kiwi-init/channels/pull/718)) ([cd2f37c](https://github.com/kiwi-init/channels/commit/cd2f37c3e08e8b17ce52ea6c6726ce26dbc56569))
- **Link a phone:** the Mac app hands an iPhone its person and channel keys by QR ([#725](https://github.com/kiwi-init/channels/pull/725)) ([2f1282f](https://github.com/kiwi-init/channels/commit/2f1282f7fc2f90df125f3d8b997eb062a9728848))
- link.ts's X25519 deriveBits typechecks again on main ([#727](https://github.com/kiwi-init/channels/pull/727)) ([4718de8](https://github.com/kiwi-init/channels/commit/4718de8c18937fb9abc4550c84c97d1de1534cc8))
- **Channels for iPhone:** a native SwiftUI app that reads and answers your channels like Messages ([#726](https://github.com/kiwi-init/channels/pull/726)) ([bbf73d5](https://github.com/kiwi-init/channels/commit/bbf73d53d368b8944c9898d4206a1414f7d05ee3))

## 0.25.2 — 2026-10-22

Tag [v0.25.2](https://github.com/kiwi-init/channels/releases/tag/v0.25.2) · commit [3369ded](https://github.com/kiwi-init/channels/commit/3369ded10580cb72964ab0d421ec101fa72d49d3) · 2026-10-22

### Other changes

- The Tasks board's rows size to the board, not the window: with a task open beside it, titles show again and nothing runs over them ([#688](https://github.com/kiwi-init/channels/pull/688)) ([f968927](https://github.com/kiwi-init/channels/commit/f968927411f44b9b92db331f97a4de2ee2917dd9))
- A person can be let in with Can answer decisions: agents' decisions show in their Needs you, and their answer counts ([#689](https://github.com/kiwi-init/channels/pull/689)) ([3369ded](https://github.com/kiwi-init/channels/commit/3369ded10580cb72964ab0d421ec101fa72d49d3))

## 0.25.1 — 2026-10-22

Tag [v0.25.1](https://github.com/kiwi-init/channels/releases/tag/v0.25.1) · commit [1e10057](https://github.com/kiwi-init/channels/commit/1e10057d155c6dfef424ba5b7f85abe8217b7410) · 2026-10-22

### Other changes

- A person can be let in with Can add agents: the agents on their paired computers join on their own, as theirs ([#687](https://github.com/kiwi-init/channels/pull/687)) ([1e10057](https://github.com/kiwi-init/channels/commit/1e10057d155c6dfef424ba5b7f85abe8217b7410))

## 0.25.0 — 2026-10-21

Tag [v0.25.0](https://github.com/kiwi-init/channels/releases/tag/v0.25.0) · commit [acd3855](https://github.com/kiwi-init/channels/commit/acd3855f0c1e89d6c08c2e170cfdeee7dca7a9c1) · 2026-10-21

### Other changes

- A loop holds a seat between sessions with its own token, then binds it to the session it names ([#654](https://github.com/kiwi-init/channels/pull/654)) ([7797cf0](https://github.com/kiwi-init/channels/commit/7797cf007d0b8fb4864ed4277d85872babcd0899))
- **Docs:** terminal plugins rows 6 and 7 as built, and tmux's marks and prefix K in agents.md (T2017) ([#661](https://github.com/kiwi-init/channels/pull/661)) ([abe10e5](https://github.com/kiwi-init/channels/commit/abe10e51e5aa094339a02bedef9c7bbb1a37fde6))
- Show in tmux from Needs you: a seat running in tmux is listed while tmux's helpers are on, and Show brings its pane to the front (T2378) ([#662](https://github.com/kiwi-init/channels/pull/662)) ([0cd9e41](https://github.com/kiwi-init/channels/commit/0cd9e414a9e4729e56275de67c5e30e15ca5d1a7))
- **Neutral presets:** New agent starts with no personality, and no preset carries this repo's rules (T263) ([#667](https://github.com/kiwi-init/channels/pull/667)) ([1a7de90](https://github.com/kiwi-init/channels/commit/1a7de904f6ba4611fc2c1bf7513259a79e61ae25))
- GIF reactions are gone: no picker, no GIF rendering, no kiwi react --list (T280) ([#668](https://github.com/kiwi-init/channels/pull/668)) ([31edeb0](https://github.com/kiwi-init/channels/commit/31edeb03ef2d397cd0609d2d644df29f04483d2a))
- Tasks v2 step 1: tasks are filed under the ask they serve (T223) ([#665](https://github.com/kiwi-init/channels/pull/665)) ([3a6c0c7](https://github.com/kiwi-init/channels/commit/3a6c0c77c77ea17f8eb08dcb5d172be3556b083d))
- The 250k checkpoint never blocks Stop: one line on the next prompt, in any mode (T266) ([#670](https://github.com/kiwi-init/channels/pull/670)) ([0a8104d](https://github.com/kiwi-init/channels/commit/0a8104d7d8c0dc780e1e340949e4656a200ca134))
- Kiwi's PR comment waits for a per-channel Write to GitHub switch, off by default, and no longer carries the task's title (T264) ([#669](https://github.com/kiwi-init/channels/pull/669)) ([a69e58d](https://github.com/kiwi-init/channels/commit/a69e58dd78a81785dc4c269e73c422cb5621f66c))
- **Docs:** the Tasks v2 plan, asks, work and decisions (T212) ([#664](https://github.com/kiwi-init/channels/pull/664)) ([895afa4](https://github.com/kiwi-init/channels/commit/895afa4d5e5e484e5498b82f090174850d49a74c))
- Clients keep events with an op they don't know instead of dropping the message (T224) ([#666](https://github.com/kiwi-init/channels/pull/666)) ([54313c3](https://github.com/kiwi-init/channels/commit/54313c33b135deeb7a2e095aba79d2f1bf07fbb0))
- **main typechecks again:** newer-ops lists github.write.set, and version 1's ops are a literal list ([#674](https://github.com/kiwi-init/channels/pull/674)) ([e5b8e7a](https://github.com/kiwi-init/channels/commit/e5b8e7a2c912a1792c15b614e0b7d22246945abd))
- A task's GitHub issue is only linked by default: Kiwi comments on it and closes it only while Write to GitHub is on (T267) ([#672](https://github.com/kiwi-init/channels/pull/672)) ([5cba127](https://github.com/kiwi-init/channels/commit/5cba12790cb14e61f45042af18d7b9cb6e9ed4c5))
- The context line is opt-in: nothing at 250k unless kiwi context-line is on (T430) ([#675](https://github.com/kiwi-init/channels/pull/675)) ([446159f](https://github.com/kiwi-init/channels/commit/446159f831c4b47da2aa2a6c43bd60f7e2144f04))
- The owner picks the branch prefix that links PRs to tasks; with none, no branch name links one (T265) ([#676](https://github.com/kiwi-init/channels/pull/676)) ([d311c1f](https://github.com/kiwi-init/channels/commit/d311c1fee0ce53c0819df1219c5b637da5a7879a))
- Channels are tabs in a bar across the top, and ⌘\ hides the channel's sidebar (T285) ([#671](https://github.com/kiwi-init/channels/pull/671)) ([5605e7a](https://github.com/kiwi-init/channels/commit/5605e7aabc8c00d132128e91d208db8b81add957))
- Room in the web first load: 591,122 → 582,464 bytes, with no visible change (T482) ([#681](https://github.com/kiwi-init/channels/pull/681)) ([1e7b6b0](https://github.com/kiwi-init/channels/commit/1e7b6b0d46261b3cebf9fb0d3558d59d112889cd))
- The 250k context line is back exactly as it was before #670, only behind kiwi context-line on (T469) ([#678](https://github.com/kiwi-init/channels/pull/678)) ([45b788b](https://github.com/kiwi-init/channels/commit/45b788be87e7d6be4dbbe1ecac3e01d879641470))
- Tasks v2 step 2: a decision names the work it holds, and Needs you lists only decisions that hold something (T226) ([#680](https://github.com/kiwi-init/channels/pull/680)) ([d852069](https://github.com/kiwi-init/channels/commit/d8520696d0ffa6749ad7b0ecfa48765cac48e2cf))
- Every sheet keeps 8px from the window's left edge, and the sidebar toggle shows only where there's a sidebar (T513) ([#682](https://github.com/kiwi-init/channels/pull/682)) ([4bad24c](https://github.com/kiwi-init/channels/commit/4bad24c1779d8e1d0695bf492a1f71b211a75bda))
- The Tasks board groups work under the person's message it serves (T256) ([#677](https://github.com/kiwi-init/channels/pull/677)) ([b5698e4](https://github.com/kiwi-init/channels/commit/b5698e4dca594c73b583832ae8bf9e02113ece1a))
- **Settings:** "Ask agents for a checkpoint past 250k context", the kiwi context-line switch in the app (T552) ([#683](https://github.com/kiwi-init/channels/pull/683)) ([deeca4d](https://github.com/kiwi-init/channels/commit/deeca4dcb655165594ddb4848e9c03d0aaf3b93a))
- The CLI bundle leaves out the MCP SDK's JSON Schema validator: 2,699,958 → 2,566,380 bytes, with no behaviour change (T598) ([#684](https://github.com/kiwi-init/channels/pull/684)) ([cabdca2](https://github.com/kiwi-init/channels/commit/cabdca2a89e24bf21f786d72d941e00a753c5615))
- Running checks reach the channel as state: queued and in progress on a PR, quiet in the conversation (T225) ([#679](https://github.com/kiwi-init/channels/pull/679)) ([b393b8e](https://github.com/kiwi-init/channels/commit/b393b8e6ca8bd74e7ee289dcbae4da5e8dc410f3))
- A task's stage is read off the log, never typed: kiwi task show says it, and the board when there's evidence (T227) ([#685](https://github.com/kiwi-init/channels/pull/685)) ([e57cb68](https://github.com/kiwi-init/channels/commit/e57cb68d550a554a8d2116bf06061207b45e73d6))
- A verdict counts only at the head it judged, and kiwi task show lists a task's evidence as refs (T609) ([#686](https://github.com/kiwi-init/channels/pull/686)) ([acd3855](https://github.com/kiwi-init/channels/commit/acd3855f0c1e89d6c08c2e170cfdeee7dca7a9c1))

## 0.24.0 — 2026-10-21

Tag [v0.24.0](https://github.com/kiwi-init/channels/releases/tag/v0.24.0) · commit [ead7320](https://github.com/kiwi-init/channels/commit/ead7320dc8509c8c1267fa3fea463d8c4008c9e1) · 2026-10-21

### Other changes

- The permission hook asks the relay for an answer the daemon hasn't caught up to, checks for a newer prompt last, and closes two lock races (T1651) ([#631](https://github.com/kiwi-init/channels/pull/631)) ([3c78095](https://github.com/kiwi-init/channels/commit/3c780956d56febcf26322237ed515e8feedbbece))
- **Permission prompts:** the row clears only on an answer that counts, more secret shapes, and edits show what they replace (T1588) ([#628](https://github.com/kiwi-init/channels/pull/628)) ([9451093](https://github.com/kiwi-init/channels/commit/9451093d678a6f692d8ddab571cb4ca847bd7dfc))
- The permission row shows what an edit replaces and with what, and says when it replaces every occurrence (T1615) ([#632](https://github.com/kiwi-init/channels/pull/632)) ([b74dd38](https://github.com/kiwi-init/channels/commit/b74dd3807696c5a678ac892ef4aa30ffe91e313a))
- The permission prompt docs say folder and file paths count as secret only for known shapes, and that an answer names the ask's id, agent and signature (T1608) ([#629](https://github.com/kiwi-init/channels/pull/629)) ([bf47ab2](https://github.com/kiwi-init/channels/commit/bf47ab246ca861f90bbb0450e9e3b2545e7fe575))
- A permission answer is built only on a verified ask and counted only as the fold's own message at its seq (T1594) ([#634](https://github.com/kiwi-init/channels/pull/634)) ([5cae6c2](https://github.com/kiwi-init/channels/commit/5cae6c2f60dab77e4f8af6b2331bc86e250d2dc8))
- **Plan:** one fresh agent session per task ([#635](https://github.com/kiwi-init/channels/pull/635)) ([aec0b49](https://github.com/kiwi-init/channels/commit/aec0b49d59883c16df4c18279e558db16c9cf183))
- The conversation stays at its newest message when content above it grows after it opens (T1679) ([#633](https://github.com/kiwi-init/channels/pull/633)) ([5af533e](https://github.com/kiwi-init/channels/commit/5af533eef00c6d0398275338cf6dadf60018ac77))
- The fold refuses every message at a seq it was handed twice, so neither copy opens an ask or counts as an answer (T1725) ([#636](https://github.com/kiwi-init/channels/pull/636)) ([51345eb](https://github.com/kiwi-init/channels/commit/51345eb29563a06d3cc8e09a0a98201bab2e1068))
- The conversation's own scrolls to the bottom record where they left it, so content growing before the first scroll event after a channel switch keeps it at the newest message (T1720) ([#637](https://github.com/kiwi-init/channels/pull/637)) ([b8994a8](https://github.com/kiwi-init/channels/commit/b8994a80c0b9f0c1b28a3f5587f449c7bf3de911))
- The permission hook's last check runs after its wait has closed, and letting go of a session leaves another hook's lock and newer-prompt mark alone (T1661) ([#640](https://github.com/kiwi-init/channels/pull/640)) ([ae03cbd](https://github.com/kiwi-init/channels/commit/ae03cbdf5aa76a437441d6e8e3114eabd2192fb6))
- Dictation's model, recorder and transcriber load on the first mic press, out of the first-load JS (T1859) ([#641](https://github.com/kiwi-init/channels/pull/641)) ([00217d3](https://github.com/kiwi-init/channels/commit/00217d3570cfa5466b20e22e74a255ab64fdf214))
- The bundle check fails when dictation's model code is in the first load, a failed engine load says to reload, and the engine warms on mic hover or focus (T1887) ([#642](https://github.com/kiwi-init/channels/pull/642)) ([0219f14](https://github.com/kiwi-init/channels/commit/0219f1434d2dae298e1cd07f5436ce2e912afc4f))
- **Plan:** terminal plugins, from an audit of the Rex and tmux code (T1928) ([#645](https://github.com/kiwi-init/channels/pull/645)) ([da73f13](https://github.com/kiwi-init/channels/commit/da73f130acdb0d5a5fb47f2d9e7c79f9c178050b))
- **Channel sidebar:** a Search row, one Tasks row with quiet dots, threads between agents folded (T1763) ([#638](https://github.com/kiwi-init/channels/pull/638)) ([a90b4c4](https://github.com/kiwi-init/channels/commit/a90b4c49c79ed2440a76ea3b362ddaefd5a0e4ae))
- Kiwi's terminal code runs programs, reads JSON and checks the foreground one way each, in src/terminals/shared (T2009) ([#648](https://github.com/kiwi-init/channels/pull/648)) ([1ec52e1](https://github.com/kiwi-init/channels/commit/1ec52e10abf0cd7cd20f8b9fbde8e9aae989b65e))
- New agent's windows open through terminal plugins: a manifest and interface, a registry, and Rex, tmux and the terminal app each in src/terminals (T2010) ([#649](https://github.com/kiwi-init/channels/pull/649)) ([d95a0e4](https://github.com/kiwi-init/channels/commit/d95a0e458dbbf2acc15582373bc4a8ddea1038ab))
- A stale permission lock is taken over by moving it aside first, and a signal after the wait has closed closes the ask instead of killing the hook (T1894) ([#646](https://github.com/kiwi-init/channels/pull/646)) ([079c244](https://github.com/kiwi-init/channels/commit/079c244ad440d9bd2ec6d2a19305711de69dbcc8))
- A lazy view that fails to load says "Part of Channels couldn't load. Reload to try again." instead of failing in silence (T1960) ([#644](https://github.com/kiwi-init/channels/pull/644)) ([0165ca5](https://github.com/kiwi-init/channels/commit/0165ca5801b63e9574db10b70b8cade195d5b941))
- The picture viewer's top row is the window's title row: its buttons click, and it clears the Mac traffic lights (T1841) ([#643](https://github.com/kiwi-init/channels/pull/643)) ([95660ea](https://github.com/kiwi-init/channels/commit/95660ea9c9e187c8c50cbc00cb433391f5841de6))
- One reader per terminal shape in packages/core/src/terminals.ts: place names, a launch's result, Rex's status and a Rex seat (T2012) ([#651](https://github.com/kiwi-init/channels/pull/651)) ([37679a4](https://github.com/kiwi-init/channels/commit/37679a4412c3be28887fc333a43d369db662797d))
- The secret filter lets field-name keys and whole-value switches through, and catches lowercase _key/_auth, ?code=, ?access_key= and sudo -S passwords (T1621) ([#639](https://github.com/kiwi-init/channels/pull/639)) ([a58321c](https://github.com/kiwi-init/channels/commit/a58321ca10311928d18c6ddb51da939ac8e7db63))
- The secret filter checks YAML list items and flow maps, and lets type annotations and S3/object keys through (T1923) ([#652](https://github.com/kiwi-init/channels/pull/652)) ([bb21273](https://github.com/kiwi-init/channels/commit/bb21273a530702a2a8b72eb143154a20c5f07f7f))
- Rex is a terminal plugin: where a seat runs, its marks, Show in Rex, its events, typing into its pane and its palette helpers, in src/terminals/rex (T2011) ([#650](https://github.com/kiwi-init/channels/pull/650)) ([0ccdd57](https://github.com/kiwi-init/channels/commit/0ccdd57bd27f076dc7b6b5ee62c3c980e42f66e5))
- #general reads like a group chat: task bookkeeping folds into one line, digests go to the task's thread (T1939) ([#647](https://github.com/kiwi-init/channels/pull/647)) ([6b58173](https://github.com/kiwi-init/channels/commit/6b58173e291d5753c62d642724953233f408d1a2))
- kiwi send and reply tell an agent when its #general message ran long ([#653](https://github.com/kiwi-init/channels/pull/653)) ([888e17a](https://github.com/kiwi-init/channels/commit/888e17a78bc4179b176b756be8900523d80be715))
- **Terminal plugins 5/9:** the terminals and launch config, kiwi terminal, kiwi launches, new agents open where Prefer says (T2013) ([#655](https://github.com/kiwi-init/channels/pull/655)) ([c52d1a9](https://github.com/kiwi-init/channels/commit/c52d1a9b1534eefbf357a5553290f02fde1f59a5))
- **Terminal plugins 8/9:** Settings → New agents, and New agent follows the switch (T2016) ([#658](https://github.com/kiwi-init/channels/pull/658)) ([24d0294](https://github.com/kiwi-init/channels/commit/24d02941531667c3a20effe23227d6b667f1ecbe))
- **Terminal plugins 9/9:** docs, the plan as built, and how a new agent's terminal is picked (T2017) ([#660](https://github.com/kiwi-init/channels/pull/660)) ([37c27ee](https://github.com/kiwi-init/channels/commit/37c27ee685edcf126d07c7a30e7c3bf33a336ab8))
- **tmux gets helpers:** Download and Remove, the @kiwi window marks, prefix K to the seat that needs you, and Show in tmux (T2014) ([#659](https://github.com/kiwi-init/channels/pull/659)) ([60bbefd](https://github.com/kiwi-init/channels/commit/60bbefdce4fc684b117c5fc3c38388dd4502ec3d))
- Show from Needs you and New agent goes through the terminal plugins: Show in Rex now, Show in tmux next (T2015) ([#656](https://github.com/kiwi-init/channels/pull/656)) ([ead7320](https://github.com/kiwi-init/channels/commit/ead7320dc8509c8c1267fa3fea463d8c4008c9e1))

## 0.23.1 — 2026-10-20

Tag [v0.23.1](https://github.com/kiwi-init/channels/releases/tag/v0.23.1) · commit [1f391c4](https://github.com/kiwi-init/channels/commit/1f391c4cd9e4883eb898936c01e18aa265e71e9c) · 2026-10-20

### Other changes

- The relay streams a dictation download through its hash into the store instead of holding the whole model in memory (T908) ([#608](https://github.com/kiwi-init/channels/pull/608)) ([6f849dd](https://github.com/kiwi-init/channels/commit/6f849dd1e1efa46787af0929cc2db1380433da02))
- The open conversation no longer re-renders for other channels' news, search is deferred and windowed, Mermaid drawings are cached and capped, and task rows share one PR index (T154) ([#607](https://github.com/kiwi-init/channels/pull/607)) ([71eae13](https://github.com/kiwi-init/channels/commit/71eae13724c7ed5a961f7502ed1cbd364e6171a3))
- A paired computer's daemon takes its person's asks from the relay inbox: claimed, checked, run within limits, answered and logged (T788) ([#611](https://github.com/kiwi-init/channels/pull/611)) ([a0f223d](https://github.com/kiwi-init/channels/commit/a0f223dfbab443c1796783a8446ac26e111c2ff8))
- **local-relay:** no relay left running when its port can't be read, plus the #565 review nits (T997) ([#610](https://github.com/kiwi-init/channels/pull/610)) ([27c835d](https://github.com/kiwi-init/channels/commit/27c835dd6d5b4a041941fddaba7778fdaa99b76e))
- A replayed older title, settings or icon is ignored (T722, A5) ([#613](https://github.com/kiwi-init/channels/pull/613)) ([3f28099](https://github.com/kiwi-init/channels/commit/3f2809939042f03ea388b2833363a9e71297ddd5))
- The paired computer's inbox survives a box that breaks its reader, trusts only the relay's id shape, launches in the realpath'd folder and keeps its launch cap across restarts (T1122) ([#615](https://github.com/kiwi-init/channels/pull/615)) ([563bc30](https://github.com/kiwi-init/channels/commit/563bc307a8f3e1206a85e3a5535905aeb52dba5e))
- A signature check never throws, so one crafted message can't stop a channel loading (T1123) ([#614](https://github.com/kiwi-init/channels/pull/614)) ([9d46c69](https://github.com/kiwi-init/channels/commit/9d46c6906f7272e8bf08a7e5c281d308ecadd528))
- **Composer and conversation:** options answer once, drafts survive switches, honest counts, working jumps, keyboard actions (T155) ([#609](https://github.com/kiwi-init/channels/pull/609)) ([b274494](https://github.com/kiwi-init/channels/commit/b274494c2c790601a46d0b04764988117928a90c))
- main's unit tests pass again: a box signed with a key that isn't base64 is refused as unsigned, now that verify() can't throw (T1211) ([#619](https://github.com/kiwi-init/channels/pull/619)) ([0bb5b3e](https://github.com/kiwi-init/channels/commit/0bb5b3ea60eee7fe6ce1b9a6c39e2eaf440fd828))
- The board keeps finished tasks: no fold base from a short roster, a gap between base and log refetched, a poisoned base rebuilt (T1004) ([#612](https://github.com/kiwi-init/channels/pull/612)) ([7ac9374](https://github.com/kiwi-init/channels/commit/7ac9374df16d6186614a431a2b73a4f80649d7f9))
- The owner's fold base stays bounded and a replay is still refused after it's pruned, so snapshots seal again past 512 KB (T586, T1089, T1219, T1272) ([#602](https://github.com/kiwi-init/channels/pull/602)) ([0e0bdda](https://github.com/kiwi-init/channels/commit/0e0bdda28d74301d688e26e70a3ead66ead6853f))
- New agent on another computer: pick a paired one, see who's online, launch through the relay (T789) ([#617](https://github.com/kiwi-init/channels/pull/617)) ([97da310](https://github.com/kiwi-init/channels/commit/97da3102073972ff4595f37795b66f67c79125f0))
- The docs say how an agent is started from the app, here or on a paired computer, and the New agent plan's item 4 is as built (T790) ([#616](https://github.com/kiwi-init/channels/pull/616)) ([8a1c8f4](https://github.com/kiwi-init/channels/commit/8a1c8f4d8d8f0391e2bf21e7893a75e86e54de72))
- The dashboard's first load drops about 9 KB: the Tasks view, image compression and log export load when used (T1224) ([#618](https://github.com/kiwi-init/channels/pull/618)) ([90e5a61](https://github.com/kiwi-init/channels/commit/90e5a610bc74a99db9d73b64b687d611e1b1e980))
- **main builds again:** lazy.tsx declares TasksView once, not twice (#618 and #602 both added it) ([#620](https://github.com/kiwi-init/channels/pull/620)) ([898e316](https://github.com/kiwi-init/channels/commit/898e316b3f533ec9d1f7a54167f9d9f2055c5d3d))
- Tests stop leaking the answer cache, and a local run never writes into the real ~/.kiwi (T1249) ([#621](https://github.com/kiwi-init/channels/pull/621)) ([3ec71d4](https://github.com/kiwi-init/channels/commit/3ec71d41ccc3ae0569dbdfed18c179ce14d11f03))
- docs/agents.md and SECURITY.md say how a permission prompt is answered from the app: who can answer, what's shown and what never is (T1457) ([#622](https://github.com/kiwi-init/channels/pull/622)) ([52a06a6](https://github.com/kiwi-init/channels/commit/52a06a6a744e9b7cadf753abe158a2172b855c81))
- The permission prompt docs match the core as built: Allow only from the agent's human, what's shown per tool and its caps, Deny-only rows, what stays in the terminal (T1457) ([#626](https://github.com/kiwi-init/channels/pull/626)) ([0c82c5d](https://github.com/kiwi-init/channels/commit/0c82c5d2673d559b29e5bbd1d2268fa789cc1979))
- A red CI check no longer opens a task: the owner's app's CI-red automation is gone, main included (T1515) ([#625](https://github.com/kiwi-init/channels/pull/625)) ([e5b45a1](https://github.com/kiwi-init/channels/commit/e5b45a182912e355a9905cd4f13f9fd10a30c6d9))
- **Permission prompts core:** the permission field and its check, the secret filter, and the answer check, bound to the ask's id, sender and signature (T1454) ([#623](https://github.com/kiwi-init/channels/pull/623)) ([e417262](https://github.com/kiwi-init/channels/commit/e417262a1217125f0a97f174c9495cd873c80a11))
- Claude Code's permission prompts reach the agent's human in Kiwi, and their signed Allow or Deny answers Claude Code (T1455) ([#627](https://github.com/kiwi-init/channels/pull/627)) ([743e733](https://github.com/kiwi-init/channels/commit/743e73306b5f343487841c859d4f282b0a97a6bb))
- The permission hook retries an answer the fold doesn't have yet, stays quiet once a newer prompt started, and the installer refreshes a stale entry (T1605) ([#630](https://github.com/kiwi-init/channels/pull/630)) ([8ca4e56](https://github.com/kiwi-init/channels/commit/8ca4e5609e30d1cc9552d4fa0c209c17032f1f0c))
- Permission prompts in the app: the Needs you row with the signed answer, who can allow, settled states (T1456) ([#624](https://github.com/kiwi-init/channels/pull/624)) ([1f391c4](https://github.com/kiwi-init/channels/commit/1f391c4cd9e4883eb898936c01e18aa265e71e9c))

## 0.23.0 — 2026-10-20

Tag [v0.23.0](https://github.com/kiwi-init/channels/releases/tag/v0.23.0) · commit [5cc3d3f](https://github.com/kiwi-init/channels/commit/5cc3d3fa51c34397606adf1418fe997b0c7f1bb4) · 2026-10-20

### Other changes

- kiwi rotate on gives Codex seats in tmux a fresh thread, and the seat follows it ([#564](https://github.com/kiwi-init/channels/pull/564)) ([ab6eb00](https://github.com/kiwi-init/channels/commit/ab6eb005150bf5b4599a457e139f34f911514f8f))
- **Plan:** New agent, started from the Channels app ([#566](https://github.com/kiwi-init/channels/pull/566)) ([9c8d38d](https://github.com/kiwi-init/channels/commit/9c8d38d19b6180846f0281c8cbfad26da4f3d98c))
- The composer shows a picked mention as the member's nickname, as sent messages do (T33) ([#567](https://github.com/kiwi-init/channels/pull/567)) ([178a6b2](https://github.com/kiwi-init/channels/commit/178a6b27af265958148b7fe31c48977ff96f753a))
- kiwi harnesses and the daemon's harnesses verb: each harness on the login shell's PATH, its version, and whether Kiwi can wake it (T38) ([#568](https://github.com/kiwi-init/channels/pull/568)) ([bf0feae](https://github.com/kiwi-init/channels/commit/bf0feaededb6f075c7c719231a10557c051bee2b))
- Auto-approval keeps the personality an invite pinned, and the owner reads a launch id from the join claims (T40) ([#569](https://github.com/kiwi-init/channels/pull/569)) ([08b018e](https://github.com/kiwi-init/channels/commit/08b018e8367edb84f3161b4f018f34357e0bb31d))
- The daemon reads a seat's activity from Rex only with the Rex helpers on, and never blocks on it (T138) ([#571](https://github.com/kiwi-init/channels/pull/571)) ([899ec98](https://github.com/kiwi-init/channels/commit/899ec9842839f8be8eab05d78c8875cdfef030a6))
- A message dated past what a date can hold no longer crashes the app (T136) ([#570](https://github.com/kiwi-init/channels/pull/570)) ([774672d](https://github.com/kiwi-init/channels/commit/774672d79f033e063666d8886ea014932d15d82d))
- A launch opens its terminal: a Rex window, else a tmux window in kiwi, else Terminal.app (T39) ([#572](https://github.com/kiwi-init/channels/pull/572)) ([a1f721f](https://github.com/kiwi-init/channels/commit/a1f721fd2ca13bd47ce6fd4aa786f97293b9020b))
- The dashboard's first load is back under its budget, with 6.6 KB to spare (T201) ([#577](https://github.com/kiwi-init/channels/pull/577)) ([c70ec55](https://github.com/kiwi-init/channels/commit/c70ec553860fc486f97cf8ecc4ebee98ca6106fd))
- The login shell falls back to the account's own when SHELL is unset, and pi, kimi and agent count only when they look like their harness (T170) ([#573](https://github.com/kiwi-init/channels/pull/573)) ([0caebf1](https://github.com/kiwi-init/channels/commit/0caebf12aa276b91c117b6b55ec8ca7097121515))
- A filtered read no longer marks the rest of the channel read (T137) ([#578](https://github.com/kiwi-init/channels/pull/578)) ([15df31f](https://github.com/kiwi-init/channels/commit/15df31f6f18ca56b8f094766886a9ffb7fe6390b))
- Past 2,000 messages the owner's app keeps its GitHub automation running: a fold on the snapshot counts as the whole log (T139) ([#574](https://github.com/kiwi-init/channels/pull/574)) ([a84f9f2](https://github.com/kiwi-init/channels/commit/a84f9f26221ed8e0ef831427f37070392bf56039))
- Changing the relay in Settings keeps every saved channel (T135) ([#575](https://github.com/kiwi-init/channels/pull/575)) ([1510980](https://github.com/kiwi-init/channels/commit/15109800dcfd7ec41a38e5699acc2a5f9f32a042))
- A voice call ends when you leave its channel, and never takes another channel's news or tools (T140) ([#576](https://github.com/kiwi-init/channels/pull/576)) ([8424924](https://github.com/kiwi-init/channels/commit/842492482ad8f7e215021864190039c35c009804))
- kiwi launch and the daemon's launch verb start Claude Code or Codex in a terminal you can open, and kiwi join carries KIWI_LAUNCH to the owner (T41) ([#580](https://github.com/kiwi-init/channels/pull/580)) ([d86cc81](https://github.com/kiwi-init/channels/commit/d86cc815cf77d922964540459997ccb5f6d6f608))
- CI red opens a task only for a failed check on main: a PR branch's red is its PR's to fix (T531) ([#584](https://github.com/kiwi-init/channels/pull/584)) ([25f355f](https://github.com/kiwi-init/channels/commit/25f355f65e588ac5ffccf1209e5fc81cf4733056))
- A release refuses a tag whose commit isn't on main, and bump-main pushes only the stamp's files (T142) ([#582](https://github.com/kiwi-init/channels/pull/582)) ([8ebf547](https://github.com/kiwi-init/channels/commit/8ebf54737afc4787e685a123a22d9aa450411275))
- A shell profile outside a temp folder never gets a PATH line into one (T61) ([#581](https://github.com/kiwi-init/channels/pull/581)) ([8364ebc](https://github.com/kiwi-init/channels/commit/8364ebc5117c31aa793910e484cefc3de27392cc))
- A removed member can no longer read the channel's name, charter, hold, rooms or repos: they follow the key's epoch (T141) ([#579](https://github.com/kiwi-init/channels/pull/579)) ([0ac8ff0](https://github.com/kiwi-init/channels/commit/0ac8ff068900e839fc613c39b03915ab69fb2f3f))
- Voice acts only on the person's spoken yes, channel text reaches it as content not instructions, and dictation never leaves the mic on (T153) ([#585](https://github.com/kiwi-init/channels/pull/585)) ([db3a942](https://github.com/kiwi-init/channels/commit/db3a94293099c54fb5eb68dadaba856bcbd6b6f0))
- Codex hooks go where CODEX_HOME points ([#589](https://github.com/kiwi-init/channels/pull/589)) ([2cfab31](https://github.com/kiwi-init/channels/commit/2cfab314eb1ef8bc5bbc7790aa67c8146e6dc8e6))
- One unreadable message no longer stops the owner's snapshots, filtered messages stay authentic after a reload, and GitHub automation keeps failed items (T152) ([#586](https://github.com/kiwi-init/channels/pull/586)) ([0b188d0](https://github.com/kiwi-init/channels/commit/0b188d01e25e4d39757e3b4f2dfca7d064a6b10e))
- **New agent:** start an agent on this computer from the Channels app, and watch it join (T42) ([#587](https://github.com/kiwi-init/channels/pull/587)) ([35f1b21](https://github.com/kiwi-init/channels/commit/35f1b219a1b45e696d95a4d3e9ca40b15fcceca0))
- kiwi join inside Claude Code waits a moment for its transcript to name the model (T360) ([#583](https://github.com/kiwi-init/channels/pull/583)) ([b927995](https://github.com/kiwi-init/channels/commit/b927995976eedae01cd5e22483507d7a0ccf4913))
- A key the relay lists without an owner-signed record is not a member (T143, A3) ([#592](https://github.com/kiwi-init/channels/pull/592)) ([37cb401](https://github.com/kiwi-init/channels/commit/37cb401e0071204894adfe8a7b41c5fd81c9da15))
- An agent given a personality mid-session is told it at its next hook, once (T269) ([#588](https://github.com/kiwi-init/channels/pull/588)) ([4de57f4](https://github.com/kiwi-init/channels/commit/4de57f452b6c380977820912d5b0f15e5ece0d9c))
- A name, settings or icon change during a pending rotation rotates first, and the icon follows the newest key like the rest (T414) ([#590](https://github.com/kiwi-init/channels/pull/590)) ([715af58](https://github.com/kiwi-init/channels/commit/715af5812a683c941c85dd3d29a54f47dd8ed154))
- The installer takes the Apple Silicon build under Rosetta, and a relay behind an untrusted proxy says how to trust it (T156) ([#595](https://github.com/kiwi-init/channels/pull/595)) ([c0d8843](https://github.com/kiwi-init/channels/commit/c0d88439cb20719f35743f1137c76790c45e935c))
- The daemon's CPU and memory: rex backoff holds, transcripts and folds reused while unchanged, fewer syncs, no git per hook, one home walk per version (T149) ([#591](https://github.com/kiwi-init/channels/pull/591)) ([fc0aaf2](https://github.com/kiwi-init/channels/commit/fc0aaf2ea31d2d9ecc4cea41be4326850b6337b1))
- kiwi reply N answers where the session heard #N, dash-led text is text, unused options are refused or reported, and 1.5h means 90 minutes (T151) ([#596](https://github.com/kiwi-init/channels/pull/596)) ([da41bac](https://github.com/kiwi-init/channels/commit/da41bac920f0d6b3fe141723b8eec8365bb53783))
- Presence can't be spoofed under another name or replayed (T674, A4) ([#594](https://github.com/kiwi-init/channels/pull/594)) ([3ccdaf4](https://github.com/kiwi-init/channels/commit/3ccdaf4d19156c090f4f4dd9a4338d2d3fbd7105))
- Signing secrets in the release environment, the app's own entitlements, and jev-ci trusting no fork's pass markers (T148) ([#593](https://github.com/kiwi-init/channels/pull/593)) ([44d38b2](https://github.com/kiwi-init/channels/commit/44d38b2c978caccff4f9289506d76117039b9631))
- Daemon and hook reliability: no killing a reused pid, no daemon pile-up, wakes and kiwi sh queries bounded, init.lua written in one rename (T150) ([#597](https://github.com/kiwi-init/channels/pull/597)) ([03f95b7](https://github.com/kiwi-init/channels/commit/03f95b7e86856773c7f4f144cc9f0b8fbcb9220b))
- The person's ask to a paired computer and that computer's answer: made, sealed, signed and read (T786) ([#599](https://github.com/kiwi-init/channels/pull/599)) ([20c391f](https://github.com/kiwi-init/channels/commit/20c391f81b8552e34d212e9d4fe4fe4bebdee67a))
- The linked GitHub token goes only to the relay it was linked on, while that relay names the same App (T147) ([#604](https://github.com/kiwi-init/channels/pull/604)) ([2b07f77](https://github.com/kiwi-init/channels/commit/2b07f7709417f42c74c514acf2916d8ca8745c9a))
- The relay reads bodies within a cap, bounds its signature-key cache, rate-limits join requests, history reads and GitHub lookups, and streams GitHub diffs and logs (T145) ([#605](https://github.com/kiwi-init/channels/pull/605)) ([b398503](https://github.com/kiwi-init/channels/commit/b3985031a7ef110cf8413123d09ebde5dec85f35))
- The new key never reaches a removed member, and the epoch never goes down (T721, A1+A2) ([#603](https://github.com/kiwi-init/channels/pull/603)) ([b7205fc](https://github.com/kiwi-init/channels/commit/b7205fc265fd225ae3ca2bea3d0527624f2d2a81))
- **Relay correctness:** JWKS refetch, all-or-nothing create, push-checked repos without the App key, idle days from the last close, a warm store on Bun (T146) ([#600](https://github.com/kiwi-init/channels/pull/600)) ([84c0d7b](https://github.com/kiwi-init/channels/commit/84c0d7bc182fe224d2907104cf47e1ea9a3724ef))
- Harden against untrusted messages: refused events, future re:, handoff from anyone, diagram links, history loop (T144) ([#606](https://github.com/kiwi-init/channels/pull/606)) ([2bea9fd](https://github.com/kiwi-init/channels/commit/2bea9fdaadf2874ae8a8d0186264831cd39b2266))
- Channel settings as a page, and Settings in sections (T69) ([#598](https://github.com/kiwi-init/channels/pull/598)) ([d148fde](https://github.com/kiwi-init/channels/commit/d148fdee0a4eeae0586f82358b667e909a849e9d))
- The relay keeps a sealed inbox per paired computer: registered by its cert, written only by its person, read on its socket (T787) ([#601](https://github.com/kiwi-init/channels/pull/601)) ([ae457a4](https://github.com/kiwi-init/channels/commit/ae457a46efd41d363c722789975fd4e8a6c52b26))
- The local relay in perf, shots, smoke and dictation runs takes a port the system picks ([#565](https://github.com/kiwi-init/channels/pull/565)) ([5cc3d3f](https://github.com/kiwi-init/channels/commit/5cc3d3fa51c34397606adf1418fe997b0c7f1bb4))

## 0.22.0 — 2026-10-20

Tag [v0.22.0](https://github.com/kiwi-init/channels/releases/tag/v0.22.0) · commit [bd907a3](https://github.com/kiwi-init/channels/commit/bd907a333418df34c51b9ce026041aa3c6e5d0ac) · 2026-10-20

### Other changes

- A release is a tag on main: the workflow stamps the version and changelog, and commits them to main ([#550](https://github.com/kiwi-init/channels/pull/550)) ([f7cfca6](https://github.com/kiwi-init/channels/commit/f7cfca6e81ec1c7e8f906dc91597da56ff33da60))
- The tmux-restart test waits for the old server to exit before starting a new one (#552) ([#553](https://github.com/kiwi-init/channels/pull/553)) ([5e0cf14](https://github.com/kiwi-init/channels/commit/5e0cf14baed5395e193be23f0ab49a8c455f36d2))
- On a Mac the traffic lights no longer touch the page: the rail is 92px there, so the sheet starts 12px after them ([#555](https://github.com/kiwi-init/channels/pull/555)) ([2d62cd7](https://github.com/kiwi-init/channels/commit/2d62cd703fe3336e70c275b208ee334d2ab0f129))
- A Mac window is never narrower than 768px, so its headers never sit under the traffic lights ([#556](https://github.com/kiwi-init/channels/pull/556)) ([e9fdb39](https://github.com/kiwi-init/channels/commit/e9fdb39b74322630612d9fe93d1a2d2b29530f78))
- The desktop app never zooms the page: ⌘+, ⌘− and ⌘0 step the text size, the layout stays put ([#559](https://github.com/kiwi-init/channels/pull/559)) ([a714961](https://github.com/kiwi-init/channels/commit/a7149611bb39f3f83d7d291209f14d5bac4e84f1))
- kiwi rotate logs why a seat stays, and a question on a finished task no longer holds it ([#561](https://github.com/kiwi-init/channels/pull/561)) ([b3d2b77](https://github.com/kiwi-init/channels/commit/b3d2b77abdb6fefc24dff509ed7b16626e2a9ded))
- Seats say where they run, and Kiwi marks them in terminals that take OSC 7501 ([#554](https://github.com/kiwi-init/channels/pull/554)) ([5858b4b](https://github.com/kiwi-init/channels/commit/5858b4bf2db786a445ada9ecb199d38865043417))
- A lead past the context line writes a lead checkpoint, and rotates only after it ([#562](https://github.com/kiwi-init/channels/pull/562)) ([31fd933](https://github.com/kiwi-init/channels/commit/31fd93309774365398fff97795ad872b2157d7f1))
- Seats follow Rex events, rotation clears a Rex pane, and Needs you and Rex's palette open the seat ([#557](https://github.com/kiwi-init/channels/pull/557)) ([5b813d2](https://github.com/kiwi-init/channels/commit/5b813d2e8ac762963ea8f41cb33fb772fcfa57c6))
- The Rex helpers plan, built, with what probes on a live Rex found ([#551](https://github.com/kiwi-init/channels/pull/551)) ([5d53a2c](https://github.com/kiwi-init/channels/commit/5d53a2c93e1a783f78bf6f3ee2538b44fe3d87a8))
- **Settings → Rex:** Install Rex Helpers, from the app ([#563](https://github.com/kiwi-init/channels/pull/563)) ([bd907a3](https://github.com/kiwi-init/channels/commit/bd907a333418df34c51b9ce026041aa3c6e5d0ac))

## 0.21.0 — 2026-10-20

Tag [v0.21.0](https://github.com/kiwi-init/channels/releases/tag/v0.21.0) · commit [9db1595](https://github.com/kiwi-init/channels/commit/9db1595e7ed769f68e0ff5d1a238f69f9b6b8cbf) · 2026-10-20

### Fixes

- A MiMoCode or Pi seat counts as woken only while its listener runs, and the plugin's wakes and refusals land in wake.log ([#542](https://github.com/kiwi-init/channels/pull/542)) ([82cd9aa](https://github.com/kiwi-init/channels/commit/82cd9aa54fd8c5f151bcf3f5c58f8819c6edfacb))
- Joining a second channel from a folder says which -c ALIAS --as NAME picks each seat ([#544](https://github.com/kiwi-init/channels/pull/544)) ([63a328a](https://github.com/kiwi-init/channels/commit/63a328a72d679065ec07ce9b80f31db19bb29fd1))
- One wake outstanding per seat: no second wake until the agent has read the first ([#543](https://github.com/kiwi-init/channels/pull/543)) ([840301f](https://github.com/kiwi-init/channels/commit/840301fccdd2218ccd6f0afffda73108a8980676))

### Other changes

- A MiMoCode session whose lookups race keeps one listener, and the plugin is updated before any seat joins ([#536](https://github.com/kiwi-init/channels/pull/536)) ([ffd9a2b](https://github.com/kiwi-init/channels/commit/ffd9a2b8c0e30c109c344e18e89c8601eed1feb7))
- Hooks from an older kiwi are rewritten with --harness, and a hook with no session never takes another harness's seat ([#534](https://github.com/kiwi-init/channels/pull/534)) ([18203f2](https://github.com/kiwi-init/channels/commit/18203f286495717a09bc1d3828bb629de0c1c761))
- **resign test:** a stale signature comes from a door in front of the relay, not a patched Date.now (T1045) ([#539](https://github.com/kiwi-init/channels/pull/539)) ([e3d30ce](https://github.com/kiwi-init/channels/commit/e3d30ce49ecb35d26f2156318959d298c16b1ac8))
- A new MiMoCode session can be woken before it runs its first shell command ([#533](https://github.com/kiwi-init/channels/pull/533)) ([cbb551f](https://github.com/kiwi-init/channels/commit/cbb551f0394ba254599fa5b1296fca97d88755a9))
- SessionStart's unread heading and Cursor's stop follow-up name their channel ([#540](https://github.com/kiwi-init/channels/pull/540)) ([ead3f89](https://github.com/kiwi-init/channels/commit/ead3f890a34cb4abefe518bd41584e2d6f7a31e8))
- After a Claude Code /clear, the new session commits what the earlier session's listener handed over ([#541](https://github.com/kiwi-init/channels/pull/541)) ([26c9e4b](https://github.com/kiwi-init/channels/commit/26c9e4b46d75cd661b435b9f05e60cce2071cc9f))
- Closing a channel offers its whole signed log as a download first ([#545](https://github.com/kiwi-init/channels/pull/545)) ([863b853](https://github.com/kiwi-init/channels/commit/863b853f4ecabf1415cd8ddf6990fae1c52d78da))
- The Linux app appears in seconds again: the AppImage is gzip in 128 KiB blocks, not xz in 1 MiB (#546) ([#547](https://github.com/kiwi-init/channels/pull/547)) ([4cb3343](https://github.com/kiwi-init/channels/commit/4cb3343ec20d26dae4b30ef05dc95d6e410c2302))
- kiwi rotate on gives this computer's Claude Code seats in tmux a fresh session between tasks ([#548](https://github.com/kiwi-init/channels/pull/548)) ([887e564](https://github.com/kiwi-init/channels/commit/887e56481ed8b0c2ab7f6386f46488ac6046733c))

## 0.20.5 — 2026-10-19

Tag [v0.20.5](https://github.com/kiwi-init/channels/releases/tag/v0.20.5) · commit [65fe1ae](https://github.com/kiwi-init/channels/commit/65fe1aec0229846f32b5336e9c691daf68417488) · 2026-10-19

### Fixes

- Claude Code keeps being woken after an upgrade: kiwi rewrites its own stale listen hook ([#518](https://github.com/kiwi-init/channels/pull/518)) ([2d927c6](https://github.com/kiwi-init/channels/commit/2d927c673affa414cf4c077c00ab288a05f4b30a))
- The 'looks like T…' hint no longer matches tasks that only share a suffix like 'stage 6' ([#519](https://github.com/kiwi-init/channels/pull/519)) ([f616669](https://github.com/kiwi-init/channels/commit/f61666935b6332218c9433fa8011a46338105e61))
- A Codex session started from Claude Code is no longer served the Claude session's seat ([#530](https://github.com/kiwi-init/channels/pull/530)) ([4d1069e](https://github.com/kiwi-init/channels/commit/4d1069e4346ee6661d19fe021823b6c8fb4ad70c))
- A Grok seat with a live kiwi listen shows it wakes via its listener ([#532](https://github.com/kiwi-init/channels/pull/532)) ([3335728](https://github.com/kiwi-init/channels/commit/3335728ca9999e69b2943b76da5c71ca5cb9e7af))

### Docs

- kiwi help lists log --json and says it prints JSON Lines ([#517](https://github.com/kiwi-init/channels/pull/517)) ([b261799](https://github.com/kiwi-init/channels/commit/b26179955a5fb75e5b7179b6781c8ce1b73d7230))
- Handing a review to someone else keeps the open round and its commit ([#522](https://github.com/kiwi-init/channels/pull/522)) ([d18e414](https://github.com/kiwi-init/channels/commit/d18e4144cd1dd971d1434648635ac53f537c9f1b))

### Other changes

- Grok Bot's VM is seated as Grok Bot, not Cursor, though its shell has CURSOR_AGENT (T508) ([#491](https://github.com/kiwi-init/channels/pull/491)) ([a8816d2](https://github.com/kiwi-init/channels/commit/a8816d214c5d39ccbe8df81bd0313aeae5cb4de3))
- Mentions read as the person's nickname in the app, while the message keeps the @handle (T547) ([#494](https://github.com/kiwi-init/channels/pull/494)) ([92de547](https://github.com/kiwi-init/channels/commit/92de547b7a340b7cb2309eb854e810caf4154548))
- A fresh session starts from its checkpoint, and every hook fits Claude Code's inline limit ([#488](https://github.com/kiwi-init/channels/pull/488)) ([11a77f9](https://github.com/kiwi-init/channels/commit/11a77f9215b0b7c1de2bd1ed3346e0cbe53e6333))
- Tests leave the real MiMoCode folder alone: the preload redirects it and drops its session markers ([#489](https://github.com/kiwi-init/channels/pull/489)) ([528a260](https://github.com/kiwi-init/channels/commit/528a260b39da28ee318e69f056822d2a24b572da))
- **Tasks board:** a PR's diff numbers stay inside their column instead of running into the checks (T615) ([#495](https://github.com/kiwi-init/channels/pull/495)) ([d94593a](https://github.com/kiwi-init/channels/commit/d94593a02a8d50173ab227afcaab21cbc9d014ea))
- Opening a conversation lands at its newest message, and stays there as it fills in (T534) ([#493](https://github.com/kiwi-init/channels/pull/493)) ([d4a1808](https://github.com/kiwi-init/channels/commit/d4a1808c87f6f22cce8b83858efeb02bf47331c4))
- Needs you is one list with one count, and a question waiting for you shows once (T587) ([#496](https://github.com/kiwi-init/channels/pull/496)) ([30ae53a](https://github.com/kiwi-init/channels/commit/30ae53a23f2e813565fe9053fbbbfe104cf6c22d))
- MiMoCode's plugin sends a refused wake again instead of dropping its messages ([#492](https://github.com/kiwi-init/channels/pull/492)) ([f2f676e](https://github.com/kiwi-init/channels/commit/f2f676e62d12c6421a1c8c126aaa70e43f7cb477))
- A seat's context shows on its lane, and past 250k the Stop hook asks once for a checkpoint ([#499](https://github.com/kiwi-init/channels/pull/499)) ([e4680d6](https://github.com/kiwi-init/channels/commit/e4680d62f854878b32aec252ca5c4128217a3d7a))
- **Tasks:** one board, one way to open a task, one set of labels (T588) ([#500](https://github.com/kiwi-init/channels/pull/500)) ([029d261](https://github.com/kiwi-init/channels/commit/029d261de293a208d9cd9ddfe7bbcd4f457be9bd))
- MiMoCode's wake counts as delivered only once the plugin says it landed, so a restart can't lose it ([#497](https://github.com/kiwi-init/channels/pull/497)) ([c1ba634](https://github.com/kiwi-init/channels/commit/c1ba6343b87b0407cc43fc2a9f89d1fb2e0493e3))
- On a phone too, opening a conversation lands at its newest message (T718) ([#502](https://github.com/kiwi-init/channels/pull/502)) ([5f047c8](https://github.com/kiwi-init/channels/commit/5f047c89278539785c28c723a675f7a1e3b005e6))
- An agent's status reads the same everywhere, and the agent strip shows only on phones (T589) ([#501](https://github.com/kiwi-init/channels/pull/501)) ([cbb25b8](https://github.com/kiwi-init/channels/commit/cbb25b874365fb328976290e8dd58acdac893cb2))
- **Channel details:** one invite, one notes, one way to let someone in, one add-agent command (T590) ([#516](https://github.com/kiwi-init/channels/pull/516)) ([d459452](https://github.com/kiwi-init/channels/commit/d459452e7f2e946b7f0ff12b04ef2166c61e1cc8))
- A MiMoCode seat is woken even when the plugin can't look up its session ([#521](https://github.com/kiwi-init/channels/pull/521)) ([81c04bf](https://github.com/kiwi-init/channels/commit/81c04bf16e9953e453292063297a358a1159f6c4))
- **Navigation:** the sidebar on desktop, tabs on phones; search is a real field; no title repeated (T591) ([#525](https://github.com/kiwi-init/channels/pull/525)) ([383c85c](https://github.com/kiwi-init/channels/commit/383c85c6ef0f2f29ca5201327b9e3e4e3fe1cac6))
- Needs you on Tasks shows a decision as the composer's card (#498) ([#514](https://github.com/kiwi-init/channels/pull/514)) ([07f64dd](https://github.com/kiwi-init/channels/commit/07f64dd4f2aa5c8427346d0df5bfe0b893048127))
- A Codex wake no longer reads as empty: listen --now says when nothing is unread ([#524](https://github.com/kiwi-init/channels/pull/524)) ([948ea3d](https://github.com/kiwi-init/channels/commit/948ea3d0afd2be089bb0d926f9b61f4d6c7d63a8))
- With seats in two channels in one folder, kiwi names both channels, and the Stop hook says which channel each batch is from ([#523](https://github.com/kiwi-init/channels/pull/523)) ([9a3458f](https://github.com/kiwi-init/channels/commit/9a3458fc5bebbcc024099dccefc8a35454b6c96a))
- A MiMoCode session keeps one listener, and an older kiwi's plugin is brought up to date by itself ([#531](https://github.com/kiwi-init/channels/pull/531)) ([5cbdc43](https://github.com/kiwi-init/channels/commit/5cbdc4339888d5ae5a30013c69148904574ec8fb))
- Dictation runs Whisper on this computer: the model comes pinned through the relay, and speech never leaves (T176) ([#529](https://github.com/kiwi-init/channels/pull/529)) ([7cdca42](https://github.com/kiwi-init/channels/commit/7cdca4255877b38fb1c352de2c8d7e7d580919e9))
- wake.log records the read cursor each wake's unread count was taken from ([#535](https://github.com/kiwi-init/channels/pull/535)) ([10039e0](https://github.com/kiwi-init/channels/commit/10039e03f99995e0acf9dfdde945678922194a21))
- Dictation works on Linux, checked on the packaged Linux app (T848) ([#527](https://github.com/kiwi-init/channels/pull/527)) ([5dfaaf9](https://github.com/kiwi-init/channels/commit/5dfaaf945658140ac1750ed5693da3c5443a2703))
- The app and the site no longer carry dictation's 27 MB WebAssembly: Mac downloads back under 150 MB (T1005) ([#538](https://github.com/kiwi-init/channels/pull/538)) ([21f69bf](https://github.com/kiwi-init/channels/commit/21f69bfbc88ec7d5fac48b235768717529340c30))
- kiwi 0.20.5 (T984) ([#537](https://github.com/kiwi-init/channels/pull/537)) ([65fe1ae](https://github.com/kiwi-init/channels/commit/65fe1aec0229846f32b5336e9c691daf68417488))

## 0.20.4 — 2026-10-19

Tag [v0.20.4](https://github.com/kiwi-init/channels/releases/tag/v0.20.4) · commit [4667710](https://github.com/kiwi-init/channels/commit/4667710713d629b74aa9c0ea662d69b7eeb67470) · 2026-10-19

### Other changes

- Grok Bot wears its own mark, the round head with two eyes, not Grok's (T424) ([#486](https://github.com/kiwi-init/channels/pull/486)) ([b57413a](https://github.com/kiwi-init/channels/commit/b57413ad1cc9c7aef2ca1527c2d65c412c342b11))
- kiwi 0.20.4 (T448) ([#487](https://github.com/kiwi-init/channels/pull/487)) ([4667710](https://github.com/kiwi-init/channels/commit/4667710713d629b74aa9c0ea662d69b7eeb67470))

## 0.20.3 — 2026-10-19

Tag [v0.20.3](https://github.com/kiwi-init/channels/releases/tag/v0.20.3) · commit [3153ccc](https://github.com/kiwi-init/channels/commit/3153ccc054309ca1ea4a2f5a5ba907c42a84a8f2) · 2026-10-19

### Other changes

- Kimi Code sessions in Kimi's server are woken in place by the daemon (T150) ([#480](https://github.com/kiwi-init/channels/pull/480)) ([7ed7e39](https://github.com/kiwi-init/channels/commit/7ed7e3942d99caedfdfeec465213d71f39cb95e3))
- Cursor keeps its own listener running, so it's woken in place in its session (T152) ([#483](https://github.com/kiwi-init/channels/pull/483)) ([4a75ef2](https://github.com/kiwi-init/channels/commit/4a75ef23a174a64aa8c45e4ec0355ea74aa6fc96))
- Pi is a known harness: detected, its model read, woken in place by Kiwi's Pi extension, with its logo (T146) ([#481](https://github.com/kiwi-init/channels/pull/481)) ([194c05e](https://github.com/kiwi-init/channels/commit/194c05ebc217ec7ecbc56021365a7097477b0601))
- MiMoCode is woken in place through Kiwi's plugin, and names its own session (T151) ([#484](https://github.com/kiwi-init/channels/pull/484)) ([ae6870a](https://github.com/kiwi-init/channels/commit/ae6870aa9d67aa5ac7575518c59e3d08e0d1794b))
- kiwi 0.20.3 (T386) ([#485](https://github.com/kiwi-init/channels/pull/485)) ([3153ccc](https://github.com/kiwi-init/channels/commit/3153ccc054309ca1ea4a2f5a5ba907c42a84a8f2))

## 0.20.2 — 2026-10-19

Tag [v0.20.2](https://github.com/kiwi-init/channels/releases/tag/v0.20.2) · commit [f4fa9c4](https://github.com/kiwi-init/channels/commit/f4fa9c41a325e9b1a74381f36646bfe84d4534bb) · 2026-10-19

### Other changes

- Grok Bot is a first-class agent: recognised on its VM, its model recorded, woken through its routine's webhook (T153) ([#478](https://github.com/kiwi-init/channels/pull/478)) ([3f9a46f](https://github.com/kiwi-init/channels/commit/3f9a46f14f57589366cd26cb7bac0f25e9d7e8cd))
- kiwi 0.20.2 (T289) ([#482](https://github.com/kiwi-init/channels/pull/482)) ([f4fa9c4](https://github.com/kiwi-init/channels/commit/f4fa9c41a325e9b1a74381f36646bfe84d4534bb))

## 0.20.1 — 2026-10-19

Tag [v0.20.1](https://github.com/kiwi-init/channels/releases/tag/v0.20.1) · commit [b8fabfa](https://github.com/kiwi-init/channels/commit/b8fabfad9c681174933784bb81ab8e8b7c5b8bd4) · 2026-10-19

### Other changes

- **perf-scale:** reload to first screen timed inside the page; CHANGELOG 0.20.0 speed line: every budget met (T1795) ([#471](https://github.com/kiwi-init/channels/pull/471)) ([f7475c9](https://github.com/kiwi-init/channels/commit/f7475c96ec43857c6b405bb1805b1c8d117b0417))
- Mac downloads under 150 MiB: kiwi bundled zstd-packed (Developer ID signed before packing), maximum compression, release gate at the budget (T1851) ([#472](https://github.com/kiwi-init/channels/pull/472)) ([f665a88](https://github.com/kiwi-init/channels/commit/f665a88b63da4e8d58594a637d34603616bdacff))
- Desktop on Linux knows when its keys aren't in a keyring, and moves them into one once it's installed (T1744, part 1, no UI) ([#473](https://github.com/kiwi-init/channels/pull/473)) ([fcfaabf](https://github.com/kiwi-init/channels/commit/fcfaabf569644d9d1b95d93e6fe5773eda4b167e))
- **Landing page:** OLED black, monospace, plain HTML, opening on Jow's Century 21 Calling cut (T30) ([#474](https://github.com/kiwi-init/channels/pull/474)) ([9ccc3c5](https://github.com/kiwi-init/channels/commit/9ccc3c5af3b2b7de2378045c2589294358c8b9d8))
- Robot heads become channel icons: picked when creating a channel and from its details (T6) ([#475](https://github.com/kiwi-init/channels/pull/475)) ([658d06d](https://github.com/kiwi-init/channels/commit/658d06de46a454ce3c01528c164b5157a613f512))
- Agents wear their harness's logo instead of a robot head (T7) ([#476](https://github.com/kiwi-init/channels/pull/476)) ([7fddbb5](https://github.com/kiwi-init/channels/commit/7fddbb5505c745699ca9cd3ab016f0666ed7f4e4))
- kiwi 0.20.1 (T113) ([#477](https://github.com/kiwi-init/channels/pull/477)) ([b8fabfa](https://github.com/kiwi-init/channels/commit/b8fabfad9c681174933784bb81ab8e8b7c5b8bd4))

## 0.20.0 — 2026-10-18

Tag [v0.20.0](https://github.com/kiwi-init/channels/releases/tag/v0.20.0) · commit [f21026c](https://github.com/kiwi-init/channels/commit/f21026c460548f76c18d0ba95b6cc42be1e4c662) · 2026-10-18

### Other changes

- **Fold:** a signed message counts once, near when it was signed (T690) ([#421](https://github.com/kiwi-init/channels/pull/421)) ([e128d0f](https://github.com/kiwi-init/channels/commit/e128d0fa066e9c9c256e05ab7f732ef16d9573e2))
- Web first load imports @kiwi/core's client submodules, not the client.ts barrel: first-load JS 789,931 to 735,589 bytes (T752) ([#423](https://github.com/kiwi-init/channels/pull/423)) ([574fac6](https://github.com/kiwi-init/channels/commit/574fac63525e82f925af597d806f30c23b407188))
- **docs/0.20-stable.md:** what "stable" means for 0.20.0 (T671) ([#425](https://github.com/kiwi-init/channels/pull/425)) ([8876632](https://github.com/kiwi-init/channels/commit/8876632f1c7ac55c319b4cec1546814275ed5d45))
- A message a prompt or stop hook hands over no longer wakes the session a second time from the listener started with it (T761) ([#424](https://github.com/kiwi-init/channels/pull/424)) ([409cde2](https://github.com/kiwi-init/channels/commit/409cde234bd350de795115ba5814c704f511b953))
- A dead socket is noticed: no pong in 10s, or no upgrade in 15s, drops it and reconnects (T712) ([#422](https://github.com/kiwi-init/channels/pull/422)) ([4ad49d6](https://github.com/kiwi-init/channels/commit/4ad49d6bbafbf46a3524a625e4525275c93bd967))
- The app folds its window on the channel's snapshot, so older tasks, scopes and facts survive a reload (T788) ([#426](https://github.com/kiwi-init/channels/pull/426)) ([590517e](https://github.com/kiwi-init/channels/commit/590517eda37aab3bcae9f77f0c8d5f4f81a0ebaa))
- Reconnect at once when the network or the Mac comes back: online, a visible page and wake nudge every connection (T713) ([#427](https://github.com/kiwi-init/channels/pull/427)) ([5ac3e8f](https://github.com/kiwi-init/channels/commit/5ac3e8fe26005b731d09d530844cc1f039045e76))
- Daemon socket writes queue what the socket didn't take and flush it on drain, so lines over 8 KB arrive whole (T703) ([#429](https://github.com/kiwi-init/channels/pull/429)) ([f2603e4](https://github.com/kiwi-init/channels/commit/f2603e41198ef51ab9acb75e565fe593645ca8a5))
- **Desktop cold start:** scripts cached, window before the keychain read, CLI copy off the main thread (T821) ([#428](https://github.com/kiwi-init/channels/pull/428)) ([24d6d83](https://github.com/kiwi-init/channels/commit/24d6d83aec040566ca2d1b4af6dc8f4cc7dab98b))
- A message this build can't read no longer empties the history cache: it's kept as a sealed unread row, so the window has no hole (T705) ([#431](https://github.com/kiwi-init/channels/pull/431)) ([294d08b](https://github.com/kiwi-init/channels/commit/294d08bcab95be07a8e53fe4e8b74f9718e9599c))
- A message that lands while a daemon subscriber catches up waits until the catch-up is sent, so the rest isn't skipped (T763) ([#432](https://github.com/kiwi-init/channels/pull/432)) ([de3eae4](https://github.com/kiwi-init/channels/commit/de3eae4f5fbcc7fc3613c5c3b768b0df2bc2ef91))
- **Relay:** history reads stop at 4 MB, and a body over 100 000 characters is refused at send (T694) ([#430](https://github.com/kiwi-init/channels/pull/430)) ([2d35ac2](https://github.com/kiwi-init/channels/commit/2d35ac21f9a7dfacd6c2134b2092d904d38cf23c))
- Creating a channel saves the owner key before the relay hears of it, and the next start finishes or forgets a create that didn't (T709) ([#433](https://github.com/kiwi-init/channels/pull/433)) ([40009e5](https://github.com/kiwi-init/channels/commit/40009e5e7a2c318d9ed33ac221bc525c2ad70bdc))
- A hook moves the cursor and marks messages read only after it has printed them, so a cut-off hook leaves them unread (T762) ([#435](https://github.com/kiwi-init/channels/pull/435)) ([bc207f2](https://github.com/kiwi-init/channels/commit/bc207f232fe47a46c362ae383af7614c176f1b7e))
- A crashed window page reloads by itself, a hung one asks Wait or Reload, and main-process errors go to main.log (T706) ([#434](https://github.com/kiwi-init/channels/pull/434)) ([9f90567](https://github.com/kiwi-init/channels/commit/9f9056730e2893ebfbbfadead5625ace883686da))
- **Desktop size:** no node_modules in app.asar, English locales only, a size check in CI (T823) ([#436](https://github.com/kiwi-init/channels/pull/436)) ([359e91e](https://github.com/kiwi-init/channels/commit/359e91ea001f7d321ed32bc733382965533b68b7))
- A Mac that can't replace itself offers the release with the reason, instead of looping on Restart to update (T714) ([#437](https://github.com/kiwi-init/channels/pull/437)) ([3fdfa2a](https://github.com/kiwi-init/channels/commit/3fdfa2a2d7d851ae7675023b1e0f9c1f80567c40))
- A hung relay costs a prompt or stop hook 1.6s, not 14s, and every relay request gives up after 30s (T764) ([#438](https://github.com/kiwi-init/channels/pull/438)) ([c3b6c1b](https://github.com/kiwi-init/channels/commit/c3b6c1b49c405284089165f79a071b9d8e73b33f))
- A tag release without the Mac signing secrets fails instead of publishing an unsigned app that Macs would never update to (T711) ([#440](https://github.com/kiwi-init/channels/pull/440)) ([365189a](https://github.com/kiwi-init/channels/commit/365189ae3fd26a237b70075d7bbcea5b6d368541))
- Updater failures end at available, with the reason in main.log and a retry in 30 minutes; a vanished staged update doesn't throw at quit (T708) ([#439](https://github.com/kiwi-init/channels/pull/439)) ([71b7b26](https://github.com/kiwi-init/channels/commit/71b7b268397ff0fad79d080910b747a0a3de99ba))
- The app keeps its daemon alive: it checks every 30s and starts it again when it stops answering, and the daemon's output goes to KIWI_HOME/daemon.log (T704) ([#443](https://github.com/kiwi-init/channels/pull/443)) ([8c6bab5](https://github.com/kiwi-init/channels/commit/8c6bab55b26e15efbfdeec649431037fcb49467c))
- A hand-over cut at its 6,000-character limit marks only the messages it showed as read, so the rest comes next (T765) ([#442](https://github.com/kiwi-init/channels/pull/442)) ([c9afd3d](https://github.com/kiwi-init/channels/commit/c9afd3dd8d45112738e9dc6c9dbfa7014aea85c6))
- A stalled update download no longer blocks checks: the check returns once the release is known, the zip streams with a 60s idle limit, and a newer release replaces a staged one (T717) ([#444](https://github.com/kiwi-init/channels/pull/444)) ([e719f13](https://github.com/kiwi-init/channels/commit/e719f1350cee848d4f6779d121174f1f1970f763))
- An older kiwi keeps a newer daemon running instead of replacing it, as the app already does (T710) ([#441](https://github.com/kiwi-init/channels/pull/441)) ([cca3fbe](https://github.com/kiwi-init/channels/commit/cca3fbe22c0e05ed5e8a811b9ffab2eb95b64c75))
- The channel clock holds still within its interval: a re-render doesn't refold, one timer per interval (T822) ([#446](https://github.com/kiwi-init/channels/pull/446)) ([14e42f8](https://github.com/kiwi-init/channels/commit/14e42f82262a3d0d77ff255a612c4e37e301a70c))
- **Rate limits:** 429 says Retry-After, refused attempts aren't counted, and clients wait it out instead of failing or re-posting (T695) ([#445](https://github.com/kiwi-init/channels/pull/445)) ([6be40c1](https://github.com/kiwi-init/channels/commit/6be40c1b06f02249dc6d3a6fc48caccbb282683b))
- Tasks and Agents at scale: lanes' PRs and unread counts in one pass per state; timeline only on Conversation (T831) ([#449](https://github.com/kiwi-init/channels/pull/449)) ([7d51942](https://github.com/kiwi-init/channels/commit/7d51942426840d4b6a728b82d5122a4bd68ae685))
- One daemon per KIWI_HOME: a lifetime lock, a daemon that loses it exits, and stopping never deletes another daemon's socket (T715) ([#447](https://github.com/kiwi-init/channels/pull/447)) ([88f7e14](https://github.com/kiwi-init/channels/commit/88f7e140e4e3138e8f8a75cbee2120d07e95422c))
- A daemon whose only relays are local ones that stopped answering, with nobody connected, stops by itself (T702) ([#448](https://github.com/kiwi-init/channels/pull/448)) ([8e67210](https://github.com/kiwi-init/channels/commit/8e6721090037a9e327cabe17246ef629c5ec6da6))
- **Conversation:** mounted rows stay bounded in a long session, and the view keeps following new messages (T826) ([#450](https://github.com/kiwi-init/channels/pull/450)) ([e9abd35](https://github.com/kiwi-init/channels/commit/e9abd35de2853a58d878f69035af616e427dd56f))
- Conversation per incoming message: live cards in one pass, cheaper row memo, stable pictures context (T1182) ([#451](https://github.com/kiwi-init/channels/pull/451)) ([5739fff](https://github.com/kiwi-init/channels/commit/5739fff8598168eca9cc525bbbbcd15e7a7bd357))
- A broken config.json no longer fails every hook: hooks exit 0 and say which file to fix (T766) ([#453](https://github.com/kiwi-init/channels/pull/453)) ([3b951cf](https://github.com/kiwi-init/channels/commit/3b951cfa5ccda8d86e529852c8314453d099a004))
- **Per-message storage:** one IndexedDB connection and transaction per batch, localStorage once per burst (T1252) ([#456](https://github.com/kiwi-init/channels/pull/456)) ([86097da](https://github.com/kiwi-init/channels/commit/86097dab21a33645828cfe73b8adb9cbec13ba0e))
- **First load:** Base UI's menu, tooltip and dialog load lazily, after first paint; budget 590,000 (T829) ([#455](https://github.com/kiwi-init/channels/pull/455)) ([6f2ec16](https://github.com/kiwi-init/channels/commit/6f2ec1684e199371b5b98b10d44925a8a89e7f88))
- **Repos picker:** relay config and repo list held for minutes, status and repos asked at once (T827) ([#457](https://github.com/kiwi-init/channels/pull/457)) ([b67e540](https://github.com/kiwi-init/channels/commit/b67e540c01833dcf93efe2f66755ed474a94d5e2))
- CLI downloads compressed (.xz/.gz, ≤ 30 MB) and no Windows CLI (T776) ([#452](https://github.com/kiwi-init/channels/pull/452)) ([fe11730](https://github.com/kiwi-init/channels/commit/fe117306377922297cbe869d32f94c2961ba47d3))
- A Claude session's listener that can't reach the daemon keeps trying, so the session isn't left deaf (T768) ([#458](https://github.com/kiwi-init/channels/pull/458)) ([8ec72e5](https://github.com/kiwi-init/channels/commit/8ec72e5fbc5fd5e1e9723db6d377788cfb00286e))
- **GitHub repos:** connecting one takes the owner's push access, checked once with their linked token (T691) ([#454](https://github.com/kiwi-init/channels/pull/454)) ([e21e4f9](https://github.com/kiwi-init/channels/commit/e21e4f99663b609e795e60c723b96073c683f353))
- kiwi who and status answer from the daemon's presence instead of probing the relay every time (T771) ([#460](https://github.com/kiwi-init/channels/pull/460)) ([2658892](https://github.com/kiwi-init/channels/commit/26588929401aa857da76be052042ca620d0bda02))
- wake.log rotates at 1 MB and the daemon prunes week-old hook bookkeeping (T774) ([#463](https://github.com/kiwi-init/channels/pull/463)) ([a3156fe](https://github.com/kiwi-init/channels/commit/a3156fe68b4540a4707b83f792063d9ad6e1bc28))
- kiwi log and kiwi tasks read what this computer already has when the relay is down, and say so (T772) ([#461](https://github.com/kiwi-init/channels/pull/461)) ([62e211b](https://github.com/kiwi-init/channels/commit/62e211be4fd41c503afe647087d9504dd20e5f02))
- **Web bundle:** mermaid's ELK layout left out (−1.4MB); perf-scale measures Details (T828, T588) ([#462](https://github.com/kiwi-init/channels/pull/462)) ([9c47624](https://github.com/kiwi-init/channels/commit/9c476240e05a0044adc7bd21f305a4b114b2fb94))
- The config lock takes over only a lock whose holder is gone, and never removes a lock it no longer owns (T773) ([#464](https://github.com/kiwi-init/channels/pull/464)) ([afa71cd](https://github.com/kiwi-init/channels/commit/afa71cdf89f2280a355abed3a28877a196f2a967))
- An idle Claude session's listener lasts a week, not a day, so the empty "nothing to do" turn comes weekly (T775) ([#465](https://github.com/kiwi-init/channels/pull/465)) ([5e58095](https://github.com/kiwi-init/channels/commit/5e58095dca33e61308ee4a6cabfc600803d3ee4a))
- CI gates for the 0.20 budgets: perf / scale on UI PRs, a nightly soak, and a Mac dmg, zip and app size gate (T1170) ([#459](https://github.com/kiwi-init/channels/pull/459)) ([8da2632](https://github.com/kiwi-init/channels/commit/8da2632c860721e8f30946adebb2157c0dcbcb11))
- Relay and daemon failures say what failed, where, and what to do next (T778) ([#466](https://github.com/kiwi-init/channels/pull/466)) ([0a7a980](https://github.com/kiwi-init/channels/commit/0a7a980326cc0bde17ecb72997a66ac18fd5999b))
- An agent's message cache keeps a local fold base and its newest 300 messages, instead of growing for ever (T1545) ([#468](https://github.com/kiwi-init/channels/pull/468)) ([b1dee82](https://github.com/kiwi-init/channels/commit/b1dee82556ab7aec90d5a0b3397902f71a8f0189))
- **Long sessions:** the message array folds into the base past the window, warm cache LRU of 4, markdown cache 500, mermaid drops its probe, places-seen keeps 500 (T825) ([#467](https://github.com/kiwi-init/channels/pull/467)) ([7b75849](https://github.com/kiwi-init/channels/commit/7b75849865d3c7a2bcdaff095d8d4ee57aef01e0))
- Key files survive a crash: writes are fsynced, machine.json and kiwi-store.bin keep a backup, and a broken machine.json is never replaced by a new key (T716) ([#469](https://github.com/kiwi-init/channels/pull/469)) ([0b90c76](https://github.com/kiwi-init/channels/commit/0b90c76447f46f2300723a9d6b6e5e05775b74fe))
- kiwi 0.20.0 (T1780) ([#470](https://github.com/kiwi-init/channels/pull/470)) ([f21026c](https://github.com/kiwi-init/channels/commit/f21026c460548f76c18d0ba95b6cc42be1e4c662))

## 0.19.2 — 2026-10-18

Tag [v0.19.2](https://github.com/kiwi-init/channels/releases/tag/v0.19.2) · commit [472553c](https://github.com/kiwi-init/channels/commit/472553c73cfef59bbaa224c682b4bf0cb33827f7) · 2026-10-18

### Other changes

- Every run on main gets a verdict: no push or rehearsal cancels another into a red ci-ok (T288) ([#410](https://github.com/kiwi-init/channels/pull/410)) ([faa7fe3](https://github.com/kiwi-init/channels/commit/faa7fe37a54cb70d3370db43260d20ab28876801))
- Prism only in the sidebar: the kit, header tabs, Settings, Personalities and the side panels back to the quiet look (T331) ([#412](https://github.com/kiwi-init/channels/pull/412)) ([f71a7be](https://github.com/kiwi-init/channels/commit/f71a7be43b1df23e83fe9145a3ccaabbca256731))
- Prism out of the conversation: composer, send, message lines, reactions, hover actions and Needs you back to the quiet look (T332) ([#411](https://github.com/kiwi-init/channels/pull/411)) ([c4b3f8b](https://github.com/kiwi-init/channels/commit/c4b3f8b5e751aac0e289f88e67c689f500fb7ef8))
- Prism means one thing: only the open channel and the chosen view or conversation are lit; search, rail buttons, idle tiles and counts plain (T387) ([#413](https://github.com/kiwi-init/channels/pull/413)) ([bfa00bd](https://github.com/kiwi-init/channels/commit/bfa00bd0e110c09483c9e31ba15145ac4876a5cc))
- Off-screen messages skip layout and paint, so Details opens and closes with half the layout work (T400, part 1) ([#414](https://github.com/kiwi-init/channels/pull/414)) ([9e2ff4a](https://github.com/kiwi-init/channels/commit/9e2ff4a791454f7545afe0883e5eda421cfcb959))
- **Switching channels:** a revisit renders at once from a verified, in-memory copy, 607ms to 36ms at 4x CPU (T419) ([#415](https://github.com/kiwi-init/channels/pull/415)) ([ed8625f](https://github.com/kiwi-init/channels/commit/ed8625f268294fc156b81b2c161856951a73b74a))
- Connect a repo from a searchable list of the repos your linked GitHub account reaches, in the details panel (T476) ([#417](https://github.com/kiwi-init/channels/pull/417)) ([725c3d9](https://github.com/kiwi-init/channels/commit/725c3d99da93222f021309771490f1f60d54428a))
- **Conversation:** a message renders once, markdown parses once, the newest 120 rows mount, and busy dots don't pulse (T334) ([#418](https://github.com/kiwi-init/channels/pull/418)) ([ccb4824](https://github.com/kiwi-init/channels/commit/ccb4824931ae756177c0cd02b112d112a909f7a8))
- **Sidebar:** clicking an agent opens your direct conversation with it; its task id beside it opens the task (T467) ([#416](https://github.com/kiwi-init/channels/pull/416)) ([df01197](https://github.com/kiwi-init/channels/commit/df0119777e803653d940fa9065489748a8aceffc))
- A person's face is their GitHub avatar once they've linked GitHub, carried in the channel so no page loads from GitHub (T477) ([#419](https://github.com/kiwi-init/channels/pull/419)) ([6e8498a](https://github.com/kiwi-init/channels/commit/6e8498a80923648b27ae8c63f6ba1a994bbe013a))
- kiwi 0.19.2 (T609) ([#420](https://github.com/kiwi-init/channels/pull/420)) ([472553c](https://github.com/kiwi-init/channels/commit/472553c73cfef59bbaa224c682b4bf0cb33827f7))

## 0.19.1 — 2026-10-18

Tag [v0.19.1](https://github.com/kiwi-init/channels/releases/tag/v0.19.1) · commit [b7af72c](https://github.com/kiwi-init/channels/commit/b7af72c30670b384ecd69bd24be38bc7d07dba29) · 2026-10-18

### Other changes

- The shell in two tones: the rails darker, the page a round sheet (T12) ([#398](https://github.com/kiwi-init/channels/pull/398)) ([d91ddfe](https://github.com/kiwi-init/channels/commit/d91ddfea66362f9e3060c8e1ca33b20178961a38))
- **Settings:** Check for updates, on demand (T13) ([#397](https://github.com/kiwi-init/channels/pull/397)) ([7d7d881](https://github.com/kiwi-init/channels/commit/7d7d8811c4182751f858c2df6adc5b3572ecbb18))
- A channel wears its lead's head everywhere, not only when the lead spoke last (T28) ([#400](https://github.com/kiwi-init/channels/pull/400)) ([951e524](https://github.com/kiwi-init/channels/commit/951e5249c28dc285d539c8f0062157ccc173dcee))
- **No modals:** Settings and Personalities are pages, Invite a view of the details panel (T11) ([#399](https://github.com/kiwi-init/channels/pull/399)) ([3943838](https://github.com/kiwi-init/channels/commit/3943838e9b88a4f09470335c58b19cca6c58459a))
- Selected states read clearly: segments rise off their track, chosen chips and rows wear the accent (T14) ([#401](https://github.com/kiwi-init/channels/pull/401)) ([b0f8c34](https://github.com/kiwi-init/channels/commit/b0f8c349ea29136ea39062afc5a51747c4dca0fa))
- **Prism glass:** the look of the app icon and the agents' heads, as tokens and primitives (T142) ([#402](https://github.com/kiwi-init/channels/pull/402)) ([dd59184](https://github.com/kiwi-init/channels/commit/dd59184a3a37a4850ed109ef49aec1e077fb5dee))
- UI shots follow today's dashboard and run in CI, as build / shots (T38) ([#404](https://github.com/kiwi-init/channels/pull/404)) ([b465b17](https://github.com/kiwi-init/channels/commit/b465b170170517efe327897ea5690e9181c952c6))
- **Phone:** an info button in the channel header opens Details (T153) ([#403](https://github.com/kiwi-init/channels/pull/403)) ([9d71bdb](https://github.com/kiwi-init/channels/commit/9d71bdbe0f3dc30dafa523aaa06829abe3bff3d0))
- Prism on the shell: rails, rows, tabs, side panels, Settings and Personalities (T143) ([#406](https://github.com/kiwi-init/channels/pull/406)) ([b3d6fdb](https://github.com/kiwi-init/channels/commit/b3d6fdb0b835afca849158f5952f5d99ea63c8eb))
- Prism in the conversation: the composer floats in glass, send is the orb (T144) ([#405](https://github.com/kiwi-init/channels/pull/405)) ([4c534f6](https://github.com/kiwi-init/channels/commit/4c534f6f57f45eb9412ea6466c683435dc1fe895))
- **Shots:** the Details screens on a phone again, now that T153 opens Details there ([#407](https://github.com/kiwi-init/channels/pull/407)) ([4f48c34](https://github.com/kiwi-init/channels/commit/4f48c3455fd7249566555c595aae07610634fe4f))
- **Checkbox:** the prism square, checked as the orb (T220) ([#408](https://github.com/kiwi-init/channels/pull/408)) ([ed55a90](https://github.com/kiwi-init/channels/commit/ed55a90938226cb83c5f0dd7f3aed54989f727e9))
- kiwi 0.19.1 (T260) ([#409](https://github.com/kiwi-init/channels/pull/409)) ([b7af72c](https://github.com/kiwi-init/channels/commit/b7af72c30670b384ecd69bd24be38bc7d07dba29))

## 0.19.0 — 2026-10-18

Tag [v0.19.0](https://github.com/kiwi-init/channels/releases/tag/v0.19.0) · commit [04395a4](https://github.com/kiwi-init/channels/commit/04395a406da4a77e486ecb6db401526e164b81a9) · 2026-10-18

### Other changes

- Replies sit in the conversation with an inline quote, as in Messages (T430) ([#367](https://github.com/kiwi-init/channels/pull/367)) ([fa0414e](https://github.com/kiwi-init/channels/commit/fa0414e0a66487f11f334449d9dd456ac1caecbc))
- **UI smoke:** a task's message is checked outside its card in one read of the page, until it settles (T489) ([#368](https://github.com/kiwi-init/channels/pull/368)) ([64e1c4a](https://github.com/kiwi-init/channels/commit/64e1c4ae267e238696f6d83226f8d7c49056c1d1))
- Agents wear glass fragments in the app icon's style, with no ring around them (T600) ([#369](https://github.com/kiwi-init/channels/pull/369)) ([8f3266e](https://github.com/kiwi-init/channels/commit/8f3266eeaa06e7ceb990010199ae5bb0365facb5))
- **Desktop:** the app's own pages may write to the clipboard, so copy buttons copy again (T581) ([#370](https://github.com/kiwi-init/channels/pull/370)) ([820577d](https://github.com/kiwi-init/channels/commit/820577d790d9164cd28d08aa84dc8c13816bbf82))
- **Voice:** a Grok Voice realtime adapter in web/src/lib/voice, tested on JSON fixtures (T12) ([#371](https://github.com/kiwi-init/channels/pull/371)) ([eb3f43c](https://github.com/kiwi-init/channels/commit/eb3f43c8719c61f4aa8d4fb00ef6c14ebf50c38e))
- **Voice:** what the live session is told as the channel moves, and the snapshot it starts from (T14) ([#372](https://github.com/kiwi-init/channels/pull/372)) ([e8c06b9](https://github.com/kiwi-init/channels/commit/e8c06b9c2400fe01e0d1f0df501fa74b612eba93))
- An escalation waits until one of the people it went to answers it, not anyone who replies (T654) ([#373](https://github.com/kiwi-init/channels/pull/373)) ([719fcc6](https://github.com/kiwi-init/channels/commit/719fcc6ee255bc608963cfd7472e7efc04b984c3))
- **GitHub:** a task imported from an issue, and closing either one closes the other (T453) ([#374](https://github.com/kiwi-init/channels/pull/374)) ([4a7031f](https://github.com/kiwi-init/channels/commit/4a7031fb52abea7fd03f1da17e3be8e3021ce456))
- Needs you as rows with the answers on them, and an answered ask says who chose what (T686) ([#375](https://github.com/kiwi-init/channels/pull/375)) ([4350d53](https://github.com/kiwi-init/channels/commit/4350d535bee62bd7f88fe194d13ff0de9413631e))
- **Web:** the conversation without bubbles (T687, UI 5/6) ([#377](https://github.com/kiwi-init/channels/pull/377)) ([09908da](https://github.com/kiwi-init/channels/commit/09908da5f1e87a0e71aaa2ff4d3b27cffd566f7a))
- **Voice:** Talk to channel, once the owner allows it and the person turns it on (T15) ([#376](https://github.com/kiwi-init/channels/pull/376)) ([9e42ca9](https://github.com/kiwi-init/channels/commit/9e42ca983f6fd1f56fa9ea3f3ae91144945262e9))
- **Web:** the new channel shell, one flat background, sidebar and Tasks / Agents / Conversation tabs (T683) ([#378](https://github.com/kiwi-init/channels/pull/378)) ([907d8ad](https://github.com/kiwi-init/channels/commit/907d8ad8e97ca927d6c52abe48d346714c60e1fb))
- **Voice:** the fast tools, answered from the channel the app already holds (T13) ([#379](https://github.com/kiwi-init/channels/pull/379)) ([4bd0909](https://github.com/kiwi-init/channels/commit/4bd0909cfb59967a1a580c2c895d77cede3b3aa3))
- **Web:** the Tasks view, the board in groups with two-line rows: live activity, PR with diff bar, checks (T684) ([#381](https://github.com/kiwi-init/channels/pull/381)) ([4b953d9](https://github.com/kiwi-init/channels/commit/4b953d92c71103b136cf61f1bd0a47ce72a9e0e3))
- **Agents tab:** one lane per agent, with what it runs now, its tasks and PRs, its queue and last moves (T688) ([#380](https://github.com/kiwi-init/channels/pull/380)) ([c852285](https://github.com/kiwi-init/channels/commit/c8522850d2865e746f67f5ecfbbd5cc65ef1e64e))
- **Tasks:** where a task comes from (--from), and kiwi task who ranks who has its context (T780, routing 1/3) ([#383](https://github.com/kiwi-init/channels/pull/383)) ([1f3ac36](https://github.com/kiwi-init/channels/commit/1f3ac366e9fdda91f6bdcfecd9455952fc61b18d))
- **Voice:** spoken verbs, yes, hold and stop, each acting only on what was just read back (T16) ([#382](https://github.com/kiwi-init/channels/pull/382)) ([5cc6a56](https://github.com/kiwi-init/channels/commit/5cc6a5629a97f9837bbee049ce7084967e1434b0))
- **Web:** a task opens inline in Tasks: its conversation, a reply box, and the PR card with files, diff and each check (T685) ([#384](https://github.com/kiwi-init/channels/pull/384)) ([68a92e9](https://github.com/kiwi-init/channels/commit/68a92e9eb9e2c803c182c0186d737fbf08f938fb))
- **Tasks:** a task keeps the folders its branch changed, and kiwi task who ranks whoever changed them lately (T781, routing 2/3) ([#385](https://github.com/kiwi-init/channels/pull/385)) ([9849dc9](https://github.com/kiwi-init/channels/commit/9849dc9507eb251074f62185b0b0a7c85f518b48))
- CI red becomes a task: the failing check, a log excerpt and the commit, for whoever pushed (T51) ([#386](https://github.com/kiwi-init/channels/pull/386)) ([3fc30b8](https://github.com/kiwi-init/channels/commit/3fc30b84ae0e1aa4354552da1ab609d6d3573da0))
- Personality on the owner-signed member record: role, capabilities held like scopes, areas, instructions in the brief (T873) ([#387](https://github.com/kiwi-init/channels/pull/387)) ([8afb378](https://github.com/kiwi-init/channels/commit/8afb3781fed8681def4985dcdeb9f1335b729317))
- **Tasks:** warm work, what an agent's session still holds, leads kiwi task who and the app's suggestion (T782, routing 3/3) ([#388](https://github.com/kiwi-init/channels/pull/388)) ([c9940a5](https://github.com/kiwi-init/channels/commit/c9940a59fc48d49fb4eea3c73585c04b74883947))
- Let in and the member menu pick a personality; changing it re-signs the record (T861) ([#390](https://github.com/kiwi-init/channels/pull/390)) ([d89b566](https://github.com/kiwi-init/channels/commit/d89b566697ffd3d4193ff5535d1f42cf1c320792))
- **WIP T860:** personalities on the person's account, presets, Settings → Personalities ([#389](https://github.com/kiwi-init/channels/pull/389)) ([c616988](https://github.com/kiwi-init/channels/commit/c61698885ce5e7903b7d999f44cbb1591b14d330))
- The inviter pins a personality in the invite; Let in defaults to it and the agent can't change it (T862) ([#391](https://github.com/kiwi-init/channels/pull/391)) ([7332cb2](https://github.com/kiwi-init/channels/commit/7332cb257391da9a219387eb51175b287380bb3d))
- **Members:** the personality is the only description; an old channel's roles read as personalities (T868, part 1 of 3) ([#393](https://github.com/kiwi-init/channels/pull/393)) ([8e9adef](https://github.com/kiwi-init/channels/commit/8e9adef96d84ad8b6c95cdbf3a247d66b3a9af33))
- The claims scope is gone, and an agent's card no longer repeats what runs says (T1006) ([#394](https://github.com/kiwi-init/channels/pull/394)) ([6bf0e9f](https://github.com/kiwi-init/channels/commit/6bf0e9f2ebe57f028921ee7436552808cf8b7341))
- **Web:** first-load JS back to 779 721 bytes, under a 790 000 budget that doesn't go up for a feature (T1018) ([#395](https://github.com/kiwi-init/channels/pull/395)) ([1ee136f](https://github.com/kiwi-init/channels/commit/1ee136fc36d2ff8c5327e23aa2596a2d29ca77d5))
- **Members:** nothing writes roles any more; the owner gives a personality (T868, part 2 of 3) ([#396](https://github.com/kiwi-init/channels/pull/396)) ([d0d3084](https://github.com/kiwi-init/channels/commit/d0d308485717df5f284ef5a5d399c11015b09208))
- kiwi 0.19.0 (T981) ([#392](https://github.com/kiwi-init/channels/pull/392)) ([04395a4](https://github.com/kiwi-init/channels/commit/04395a406da4a77e486ecb6db401526e164b81a9))

## 0.18.0 — 2026-10-17

Tag [v0.18.0](https://github.com/kiwi-init/channels/releases/tag/v0.18.0) · commit [4f3ebe9](https://github.com/kiwi-init/channels/commit/4f3ebe92c34cd30cf15544a32a65837bec36d85a) · 2026-10-17

### Other changes

- **Release:** the publish job installs dependencies before it writes the notes ([#330](https://github.com/kiwi-init/channels/pull/330)) ([b604fc3](https://github.com/kiwi-init/channels/commit/b604fc344d38b941454fbe29add519469e26294e))
- Cards follow the agent's branch: the prompt and stop hooks re-send repo@branch when it changed ([#331](https://github.com/kiwi-init/channels/pull/331)) ([479f051](https://github.com/kiwi-init/channels/commit/479f0519195ed8ec82236bcfee5baca2593ea8ae))
- **Tasks:** a title past 200 characters is refused with a reason, not announced as added (T56) ([#335](https://github.com/kiwi-init/channels/pull/335)) ([c6c908f](https://github.com/kiwi-init/channels/commit/c6c908f6e4f27fc7b72f0aaac583ae407c860d01))
- **Demo:** --stay prints a plain join link and lets the dashboard in itself (T58) ([#336](https://github.com/kiwi-init/channels/pull/336)) ([0b4f1a6](https://github.com/kiwi-init/channels/commit/0b4f1a6b391ee96cb1253c65d0a5ec6dbea25cad))
- A channel records its repos, and status flags an agent working from another one ([#332](https://github.com/kiwi-init/channels/pull/332)) ([1b82936](https://github.com/kiwi-init/channels/commit/1b82936a31f30a66fb108a755013bdb7dcb2a176))
- The app shows an agent's repo@branch, and flags one from a repo the channel doesn't list ([#337](https://github.com/kiwi-init/channels/pull/337)) ([0878bf0](https://github.com/kiwi-init/channels/commit/0878bf0517fa8242a2b6a1abb07e52a756ef215d))
- **Coordination:** task claims and answering #N are compare-and-set on the relay (T27) ([#333](https://github.com/kiwi-init/channels/pull/333)) ([6910e8e](https://github.com/kiwi-init/channels/commit/6910e8e107cf12cd1f566eec8646602aafb2c328))
- Coordinator-only mode is gone; the coordinator role becomes an optional lead (T33) ([#338](https://github.com/kiwi-init/channels/pull/338)) ([68a2903](https://github.com/kiwi-init/channels/commit/68a290331a71dafa32cdbc9fd42fa1de8b0f812c))
- One verb for asking a person: help and the MCP escalate tool point to ask-human (T66) ([#342](https://github.com/kiwi-init/channels/pull/342)) ([87d7615](https://github.com/kiwi-init/channels/commit/87d7615ad876a736b38f8a76bd0d5a793e7b95d1))
- git blame skips the oxfmt reformat (.git-blame-ignore-revs) ([#328](https://github.com/kiwi-init/channels/pull/328)) ([3862804](https://github.com/kiwi-init/channels/commit/3862804ab652fe3f5740b993c7a6b73d45f29507))
- **Coordination:** leases with a line, kiwi lock and kiwi unlock (T29) ([#339](https://github.com/kiwi-init/channels/pull/339)) ([026e890](https://github.com/kiwi-init/channels/commit/026e8903f434c0b76b607157ec33ffa45f76982b))
- **CLI:** reply, react and show pick the seat that was shown the message (T64) ([#340](https://github.com/kiwi-init/channels/pull/340)) ([23dbf42](https://github.com/kiwi-init/channels/commit/23dbf42c9b20a37d27c5a57c8999f93de784cea1))
- **Timeline:** notes, claims and reactions leave the conversation (T31) ([#341](https://github.com/kiwi-init/channels/pull/341)) ([a6a7714](https://github.com/kiwi-init/channels/commit/a6a771464147c92233608699128b190d1cb3c41d))
- **ui-smoke:** a task's card in the conversation shows its last line, and a click opens the Tasks panel (T8) ([#343](https://github.com/kiwi-init/channels/pull/343)) ([813fc07](https://github.com/kiwi-init/channels/commit/813fc078f2839597852627c87331cbf6dfe49e1f))
- **Standup:** the live-card model moves into core (T6) ([#334](https://github.com/kiwi-init/channels/pull/334)) ([dbc30ce](https://github.com/kiwi-init/channels/commit/dbc30ce6dffff2961f125574923ec3b93a2bbbb8))
- **Digest:** closing a task posts a one-line summary in the main conversation (T87) ([#344](https://github.com/kiwi-init/channels/pull/344)) ([ebb2fb4](https://github.com/kiwi-init/channels/commit/ebb2fb423fff8e3cbfeccf8f37c814f18e873d6f))
- **Standup:** room chips on the canvas filter the task cards (T9) ([#345](https://github.com/kiwi-init/channels/pull/345)) ([6c432b7](https://github.com/kiwi-init/channels/commit/6c432b7c31c2f4f8ca399bb95283560cc73fd60e))
- **Tasks:** proof on the task, a link a reviewer can open (T74) ([#346](https://github.com/kiwi-init/channels/pull/346)) ([8eeb250](https://github.com/kiwi-init/channels/commit/8eeb250704e173dc65a2bd079b5056db44798925))
- **Web:** an agent's question lives in the composer, with clickable options (T23) ([#348](https://github.com/kiwi-init/channels/pull/348)) ([ad66cac](https://github.com/kiwi-init/channels/commit/ad66cacf46e7e20a33002ca391df335fb7428cb5))
- Fix typos in AGENTS.md ([#347](https://github.com/kiwi-init/channels/pull/347)) ([b2f94b8](https://github.com/kiwi-init/channels/commit/b2f94b89d16dc0d778256318cf126021aa6d2458))
- **Web:** the microphone says why dictation can't run and stays, instead of vanishing (T304) ([#350](https://github.com/kiwi-init/channels/pull/350)) ([51656f5](https://github.com/kiwi-init/channels/commit/51656f5ad96d991288fb101c4ca70d6862d53059))
- **Handles:** a new handle is adjective-animal (gentle-otter), not animal-adjective (T349) ([#353](https://github.com/kiwi-init/channels/pull/353)) ([22b7812](https://github.com/kiwi-init/channels/commit/22b78128953f7b1e8598dbc31a6926eda8aef6ff))
- **Delivery:** #general, your rooms and threads, and @mentions are pushed; the rest is pulled (T35) ([#349](https://github.com/kiwi-init/channels/pull/349)) ([925ec39](https://github.com/kiwi-init/channels/commit/925ec3918dc14afcd52258b2fe64a0117f1c8fdb))
- GitHub App webhooks reach a channel's queue at the relay (T37, design B, relay half) ([#351](https://github.com/kiwi-init/channels/pull/351)) ([24f26ec](https://github.com/kiwi-init/channels/commit/24f26ec9a6b52ae8b650f845e3b166e0432ede15))
- **Web:** a slash in the composer lists commands, and one runs instead of being sent (T325) ([#354](https://github.com/kiwi-init/channels/pull/354)) ([8d9f485](https://github.com/kiwi-init/channels/commit/8d9f4857d5fac0f9c62cab91770c323a0fb60a07))
- **test/slots:** the loser of a race may be refused before sending, so accept that text too ([#355](https://github.com/kiwi-init/channels/pull/355)) ([89a8cd2](https://github.com/kiwi-init/channels/commit/89a8cd255f54b6477a4fff5efb9cb9a83090e4ea))
- GitHub's news reaches the channel: the owner's app drains the relay's queue into signed events (T37) ([#356](https://github.com/kiwi-init/channels/pull/356)) ([c62ae30](https://github.com/kiwi-init/channels/commit/c62ae30c05e8216d5330c276363d05e63c11897c))
- A PR on a task shows GitHub's state, title and checks, not the chat's guess (T43) ([#358](https://github.com/kiwi-init/channels/pull/358)) ([fca1316](https://github.com/kiwi-init/channels/commit/fca1316abf11b5f77993a3ebc1f134fde0c97d87))
- A PR on a branch named T<n>-… shows on task T<n>, with its branch (T72, first part) ([#359](https://github.com/kiwi-init/channels/pull/359)) ([7e641f7](https://github.com/kiwi-init/channels/commit/7e641f7f9485fd9db6be27dd986bab8a5bdf0732))
- **/compact:** fold the history behind an approved summary and archive finished tasks (T326) ([#357](https://github.com/kiwi-init/channels/pull/357)) ([0fcd9c1](https://github.com/kiwi-init/channels/commit/0fcd9c1815905bfdeebc5705ed3f0c43c1eb192b))
- The relay calls GitHub as the App: diffs for members, the kiwi/review check for the owner (T45, relay half) ([#361](https://github.com/kiwi-init/channels/pull/361)) ([a87a406](https://github.com/kiwi-init/channels/commit/a87a406e59672d64e559cb635b45712ba4c49ab4))
- **CLI:** one way to say where a message goes, kiwi send --to WHERE (T80) ([#362](https://github.com/kiwi-init/channels/pull/362)) ([59d5d06](https://github.com/kiwi-init/channels/commit/59d5d06b398f378ef61775b2b9b159153db2166d))
- **GitHub:** a person links their GitHub account in the desktop app, by device flow (T41) ([#360](https://github.com/kiwi-init/channels/pull/360)) ([a280cef](https://github.com/kiwi-init/channels/commit/a280cef7d7458fd656346b58571c6008ce6e169d))
- A review round shows its diff, and the owner's app posts each verdict as the kiwi/review check (T45, app half) ([#363](https://github.com/kiwi-init/channels/pull/363)) ([8e78250](https://github.com/kiwi-init/channels/commit/8e78250fdae8ea01e62b1a670a2940a5f18cda6c))
- A PR on a T<n>-… branch links back to its task: the owner's app comments once (T72, second part) ([#365](https://github.com/kiwi-init/channels/pull/365)) ([4172ef8](https://github.com/kiwi-init/channels/commit/4172ef819554f7a2dd39b0c5f61b47208f2a2309))
- kiwi 0.18.0 (T422) ([#364](https://github.com/kiwi-init/channels/pull/364)) ([4f3ebe9](https://github.com/kiwi-init/channels/commit/4f3ebe92c34cd30cf15544a32a65837bec36d85a))

## 0.17.0 — 2026-10-17

Tag [v0.17.0](https://github.com/kiwi-init/channels/releases/tag/v0.17.0) · commit [f37632d](https://github.com/kiwi-init/channels/commit/f37632d47c9c8b91adc67937d86898469a80ac8e) · 2026-10-17

### Other changes

- **Docs:** the README shows the app's channel view and uses the app icon (T1147) (bus/T1147-readme-image) ([421cb15](https://github.com/kiwi-init/channels/commit/421cb157e800c6a4d48e5139c7dbd0f81851e6ea))
- **Web:** each open task is one live card in the main conversation (T1253) (bus/T1253-task-cards) ([cf969fd](https://github.com/kiwi-init/channels/commit/cf969fdd412b857325783e38b7f0ff9d5deefecb))
- **UI smoke:** a task's message may show in main only inside its live task card (bus/smoke-task-card) ([00b9cfd](https://github.com/kiwi-init/channels/commit/00b9cfde7ef498fb924b175a019b4efe88579d77))
- **Bus:** no more mergiraf, so the bus no longer depends on codeberg.org ([#292](https://github.com/kiwi-init/channels/pull/292)) ([08f7c74](https://github.com/kiwi-init/channels/commit/08f7c74480c0e04b65a5384dd16377d8c9bedcbf))
- **CI:** the bus plans a test merge from main, and a web-only change no longer runs the macOS job ([#293](https://github.com/kiwi-init/channels/pull/293)) ([791a366](https://github.com/kiwi-init/channels/commit/791a36640f040487354e7bbb5e70611d6b5ce3b7))
- **Bus:** a branch whose own CI is green and that merges cleanly lands at once, without a staging run ([#294](https://github.com/kiwi-init/channels/pull/294)) ([d66ec62](https://github.com/kiwi-init/channels/commit/d66ec62938000063b8c533f396d01d9b004cd5b7))
- **Bus:** a PR labelled queue takes the fast path too, on its own CI run ([#295](https://github.com/kiwi-init/channels/pull/295)) ([47956ac](https://github.com/kiwi-init/channels/commit/47956ac367e7aa0a2a346e46be6da5de58d81cf0))
- Remove the merge bus: back to a normal pull request flow ([#298](https://github.com/kiwi-init/channels/pull/298)) ([38b9775](https://github.com/kiwi-init/channels/commit/38b9775397673a4230222ab1a30dd18e8d14d7a7))
- **Docs:** DESIGN.md sections 3 to 5 match web/src/index.css (T550) ([#299](https://github.com/kiwi-init/channels/pull/299)) ([c775ab2](https://github.com/kiwi-init/channels/commit/c775ab225cd9881b813a5ffa416f4b65bd3abd82))
- **Web:** a long inline command copies with one click, the copy button on code blocks shows on touch, and agents are told to put commands in code (T768) ([#300](https://github.com/kiwi-init/channels/pull/300)) ([f1e76ff](https://github.com/kiwi-init/channels/commit/f1e76ff017e5b5df8e755b01024276eca607f992))
- **Avatars:** agents wear robot heads, and the coordinator's animated head is gone (T456) ([#296](https://github.com/kiwi-init/channels/pull/296)) ([75e34d7](https://github.com/kiwi-init/channels/commit/75e34d72ed4633143837c403076831e99cfeaa50))
- **Desktop:** mic entitlement, CSP for api.x.ai when a voice key is set, and an ephemeral token mint (T11) ([#297](https://github.com/kiwi-init/channels/pull/297)) ([a841b9d](https://github.com/kiwi-init/channels/commit/a841b9d5ec89361bb532d50d76c43a4bae4ebd12))
- Address the review on #248: snapshot contiguity, watch presence, blob quota, image notices, test hygiene ([#254](https://github.com/kiwi-init/channels/pull/254)) ([bb6e9dc](https://github.com/kiwi-init/channels/commit/bb6e9dc926a0261585952ff8c7128d6d2e613916))
- **CI:** 28 jobs become 10, one per area, each with a timeout ([#301](https://github.com/kiwi-init/channels/pull/301)) ([415cef0](https://github.com/kiwi-init/channels/commit/415cef08840941c0e84ea0121cc277881a0e62fd))
- Split the conflict hotspots: client.ts, relay/room.ts and agent.ts into modules (pure moves) ([#249](https://github.com/kiwi-init/channels/pull/249)) ([767c6d5](https://github.com/kiwi-init/channels/commit/767c6d5374aacd2a5a9203881d09d8a3c68e89f7))
- **Web:** reach root src/ only through @mc, and keep the relay URL in one place ([#302](https://github.com/kiwi-init/channels/pull/302)) ([8e68448](https://github.com/kiwi-init/channels/commit/8e6844812977ff5f48e865c9075afce6d44ccdd2))
- **Repo:** Bun workspaces, one lockfile, one TypeScript ([#303](https://github.com/kiwi-init/channels/pull/303)) ([b41a43f](https://github.com/kiwi-init/channels/commit/b41a43fc53cb4f4d1bffb95b71dc8b8e84038213))
- **Web:** split conversation.tsx into components/conversation/ ([#309](https://github.com/kiwi-init/channels/pull/309)) ([321cb6b](https://github.com/kiwi-init/channels/commit/321cb6b99af53275b5eb36044ee2a62047a38be9))
- **State:** split src/state.ts into modules under src/state/ ([#308](https://github.com/kiwi-init/channels/pull/308)) ([7bddbed](https://github.com/kiwi-init/channels/commit/7bddbed94922e61fb6614b81c03f22718fa297f5))
- **Web:** split lib/channel.ts into lib/channel/ ([#311](https://github.com/kiwi-init/channels/pull/311)) ([77bc597](https://github.com/kiwi-init/channels/commit/77bc597af3175f91e5405c6ed2a5aea1afd94396))
- **CI:** the no-comments rule is no longer enforced, and a comment in a catch block is allowed ([#307](https://github.com/kiwi-init/channels/pull/307)) ([df82cec](https://github.com/kiwi-init/channels/commit/df82cecfa59bcf5b515c93a3268c203e4797c8fe))
- **CLI:** move joinedText and agentPrompt out of main.ts into src/cli/brief.ts ([#305](https://github.com/kiwi-init/channels/pull/305)) ([a2b327e](https://github.com/kiwi-init/channels/commit/a2b327e29f1320e11705e09f90a5bd4ecb7c7e45))
- **Web:** split components/controls.tsx into components/controls/ ([#312](https://github.com/kiwi-init/channels/pull/312)) ([f2c0ef7](https://github.com/kiwi-init/channels/commit/f2c0ef7546f8689f16caf857923c9df502c2c940))
- **Desktop:** split main.ts into modules, and keyring's wire server into keys-server.ts (pure moves) ([#304](https://github.com/kiwi-init/channels/pull/304)) ([57cdc62](https://github.com/kiwi-init/channels/commit/57cdc62cb22abe164816f12d56db862322b33941))
- **Daemon:** split src/daemon.ts into modules under src/daemon/ (pure moves) ([#306](https://github.com/kiwi-init/channels/pull/306)) ([84d44f3](https://github.com/kiwi-init/channels/commit/84d44f3b192a7a1cdfd43a4111255e55a2c419ef))
- **Config:** split src/config.ts into modules under src/config/ ([#310](https://github.com/kiwi-init/channels/pull/310)) ([33ebe7e](https://github.com/kiwi-init/channels/commit/33ebe7e00e9fb66d5e7f881629b793c1274212dd))
- **Hooks:** split src/hooks.ts into modules under src/hooks/ (pure moves) ([#313](https://github.com/kiwi-init/channels/pull/313)) ([e938013](https://github.com/kiwi-init/channels/commit/e9380130ac1d173406804fac3f2c9301c3436f52))
- **CLI:** split src/cli/main.ts into modules under src/cli/ (pure moves) ([#314](https://github.com/kiwi-init/channels/pull/314)) ([20c82d2](https://github.com/kiwi-init/channels/commit/20c82d2298a74ea93d17ea677b9bba836159fec5))
- **CI:** a push to main cancels main's run still in progress ([#315](https://github.com/kiwi-init/channels/pull/315)) ([dc68560](https://github.com/kiwi-init/channels/commit/dc685609649767d9211512221baa1a54cc2f2e13))
- **Changelog:** titles only, and the description check leaves ci-ok ([#316](https://github.com/kiwi-init/channels/pull/316)) ([56dce02](https://github.com/kiwi-init/channels/commit/56dce0216414a170d1d8f87b44208d326a303318))
- **jev-ci:** plan ci.yml and jev-ci.yml edits per job, judge module splits, narrower flows and macOS triggers ([#317](https://github.com/kiwi-init/channels/pull/317)) ([7d7b72d](https://github.com/kiwi-init/channels/commit/7d7b72da6b477b580f57d27b4d5fdd0db158e432))
- Lint the whole repo with oxlint, and fix every finding ([#318](https://github.com/kiwi-init/channels/pull/318)) ([cc1e517](https://github.com/kiwi-init/channels/commit/cc1e517cec7560e3156bec9c4573bb7ce35c89dd))
- **jev-ci:** a comma expression in diff.ts becomes a block, so lint passes on main ([#321](https://github.com/kiwi-init/channels/pull/321)) ([de91bf2](https://github.com/kiwi-init/channels/commit/de91bf230c966c8f998c0ee9327b8d1b6089abc8))
- **Web:** a malformed link fragment like #% no longer crashes the app ([#319](https://github.com/kiwi-init/channels/pull/319)) ([ff58d95](https://github.com/kiwi-init/channels/commit/ff58d9598c3bf956a977863f9161e7273957ce18))
- Comments that named src/daemon.ts point at the module that now holds the code ([#320](https://github.com/kiwi-init/channels/pull/320)) ([9708326](https://github.com/kiwi-init/channels/commit/9708326ebba16715dccc66207b5661bd3cd8615e))
- Move the shared code into packages/core, the @kiwi/core workspace package ([#322](https://github.com/kiwi-init/channels/pull/322)) ([96d8cf5](https://github.com/kiwi-init/channels/commit/96d8cf5486efc7c4a5e2b3f7eb501661820c7725))
- **Desktop:** a new app icon, the glass starburst ([#323](https://github.com/kiwi-init/channels/pull/323)) ([83b4e4f](https://github.com/kiwi-init/channels/commit/83b4e4f687bae97a354973b0497db1474a534571))
- Add philosophy section to AGENTS.md ([#324](https://github.com/kiwi-init/channels/pull/324)) ([c952546](https://github.com/kiwi-init/channels/commit/c952546a6aedc26f673e7439b2f1845a47c24fd7))
- **Desktop:** the app is Channels, with its own bundle ID ([#325](https://github.com/kiwi-init/channels/pull/325)) ([38af385](https://github.com/kiwi-init/channels/commit/38af3855c3fda1e5281a56bba9621da38e2a5213))
- **Web:** the dashboard calls the app Channels ([#326](https://github.com/kiwi-init/channels/pull/326)) ([34b1383](https://github.com/kiwi-init/channels/commit/34b13832e4ebe42bd25f6377bb4d321cde81db50))
- Format the root packages with oxfmt, and lint site/app.js ([#327](https://github.com/kiwi-init/channels/pull/327)) ([a46978b](https://github.com/kiwi-init/channels/commit/a46978b81011d97c2b95014ce5d7d84e52ad0b1a))

## 0.16.2 — 2026-10-17

Tag [v0.16.2](https://github.com/kiwi-init/channels/releases/tag/v0.16.2) · commit [1055e22](https://github.com/kiwi-init/channels/commit/1055e22845332e9131c37df609db65dd12620951) · 2026-10-17

### Other changes

- **Needs you:** every question the channel badge counts now has a card (bus/rail-question-badge) ([e326e12](https://github.com/kiwi-init/channels/commit/e326e12e20e9744f6a51ad09cf682f63e22a2d19))
- **Web:** the invite dialog names the agent's nickname, and writes --nick (T473) (bus/T473-invite-nickname) ([59f3b23](https://github.com/kiwi-init/channels/commit/59f3b2382b51c67585e9a72d2840defa0074e24f))
- **Wake:** a daemon with the app's PATH still finds the harness, and wake.log says why a wake failed (T544) (bus/T544-opencode-wake) ([6af17f9](https://github.com/kiwi-init/channels/commit/6af17f96c0ca0bf769bb9a26a869636ccb332f0d))
- **shoot-ui:** get through first run again and shoot every screen (#287) (bus/287-shoot-ui-first-run) ([63301e6](https://github.com/kiwi-init/channels/commit/63301e6b1492a4005a61a1d6cfe91e0f06e95741))
- **289-task-tabs:** Web: the Tasks panel gets the overview's state tabs, and the rail has room for them (#289) (bus/289-task-tabs) ([a383ed0](https://github.com/kiwi-init/channels/commit/a383ed08987732544c9c1b8afdd82c5ae327afe8))
- **285-message-refs:** Web: #N in a message jumps to message N in the channel (#285) (bus/285-message-refs) ([fcb03a0](https://github.com/kiwi-init/channels/commit/fcb03a07ff1f09b99ce2633454a8b346ebe16fa8))
- **286-ask-human:** Agents: kiwi ask-human sends a decision to a person, with options (#286) (bus/286-ask-human) ([e2e1715](https://github.com/kiwi-init/channels/commit/e2e1715196d8075a6580e4988565aace219f2e8f))
- **shoot-ui:** the phone-size shots after 08-direct land again (#287) (bus/287-shoot-ui-narrow) ([82f2ddb](https://github.com/kiwi-init/channels/commit/82f2ddb4c3bfe3178c13a17cb322b1234fb1a1dc))
- **290-reviewer:** Web: a person can cancel a task, and send back a review waiting on an agent (#288) (bus/290-reviewer) ([8c7299c](https://github.com/kiwi-init/channels/commit/8c7299cf1178ee4beeaac45fc9a9bb797be7d4e6))
- kiwi 0.16.2 (bus/release-0.16.2) ([1055e22](https://github.com/kiwi-init/channels/commit/1055e22845332e9131c37df609db65dd12620951))

## 0.16.1 — 2026-10-16

Tag [v0.16.1](https://github.com/kiwi-init/channels/releases/tag/v0.16.1) · commit [0a1b5a9](https://github.com/kiwi-init/channels/commit/0a1b5a90a3dd6b3410aae4cd5dd5abcc344e34df) · 2026-10-16

### Other changes

- **T336:** Composer: a GIF picker with the owner's 15 reaction GIFs (T336) (bus/T336-gif-picker) ([1677f43](https://github.com/kiwi-init/channels/commit/1677f439c4025a52ce20dcdd9c08414ca5fd6631))
- **Web:** the sidebar is always the rail; its toggle, shortcut and palette action are gone (T415) (bus/T415-rail-only) ([c58b4dd](https://github.com/kiwi-init/channels/commit/c58b4dd94a251679323df3b40b9f4199a8260895))
- kiwi 0.16.1 (bus/release-0.16.1) ([0a1b5a9](https://github.com/kiwi-init/channels/commit/0a1b5a90a3dd6b3410aae4cd5dd5abcc344e34df))

## 0.16.0 — 2026-10-16

Tag [v0.16.0](https://github.com/kiwi-init/channels/releases/tag/v0.16.0) · commit [7a683d6](https://github.com/kiwi-init/channels/commit/7a683d6cc9624650f7588fc414e2db04a9a77a99) · 2026-10-16

### Other changes

- **Bus:** a single-writer merge bus in .github/bus ([#251](https://github.com/kiwi-init/channels/pull/251)) ([cf19716](https://github.com/kiwi-init/channels/commit/cf19716fff66104d9a66fff5550e9e4252a07168))
- **264-sh-query:** Sh: thread and review fields in the files, and SQL with query (#264) (bus/264-sh-query) ([0a3dbe6](https://github.com/kiwi-init/channels/commit/0a3dbe6f6811a6dc8a66c8913d111156c84ae0e2))
- **267-flat-threads:** Web: in coordinator mode a person's replies stay in the conversation (#267) (bus/267-flat-threads) ([73a8838](https://github.com/kiwi-init/channels/commit/73a8838da6b248f3a0820d9df8f663d974e38a75))
- **265-browser-handoff:** Escalations: hand a live browser tab to a person (#265) (bus/265-browser-handoff) ([c8ab926](https://github.com/kiwi-init/channels/commit/c8ab926952ac644cc8c83e0762a536cd11bf7513))
- **Test:** the daemon-seats activity test removes the binding it adds, so a live pid 4242 can't fail the status test (#276) ([#277](https://github.com/kiwi-init/channels/pull/277)) ([1168488](https://github.com/kiwi-init/channels/commit/1168488c726315cd5f1334a3f6027f1c611a5644))
- **CI:** macOS tests and a release rehearsal run on the PR, not at tag time (#273) ([#274](https://github.com/kiwi-init/channels/pull/274)) ([b45b11c](https://github.com/kiwi-init/channels/commit/b45b11cd96a19d2c443a0726aa56c0b3a4cf0bce))
- **Web:** click a picture in the chat to mark it up and reply with it ([#275](https://github.com/kiwi-init/channels/pull/275)) ([6dd0664](https://github.com/kiwi-init/channels/commit/6dd06640780f4e41e211aa393bb6f361dd48c76e))
- **Docs:** a shorter README, agent detail in docs/agents.md, mcp.md caught up (bus/301-docs-readme) ([1c8ce79](https://github.com/kiwi-init/channels/commit/1c8ce79bfe2dfdc6154097309d389a274e36659f))
- **Composer:** images dragged in or pasted are compressed under the limit (T315) (bus/T315-compress-images) ([c9a279e](https://github.com/kiwi-init/channels/commit/c9a279e58bf70152d4c86f0a9e0cf7410fdba935))
- **Web:** a microphone button in the composer dictates into the message (T316) (bus/316-composer-dictation) ([7e295d8](https://github.com/kiwi-init/channels/commit/7e295d8e49109cb4b9b2a165c074f520ab95cca3))
- **267-brief-voice:** Brief: agents write like teammates in a chat channel (#267) (bus/267-brief-voice) ([9f3bd69](https://github.com/kiwi-init/channels/commit/9f3bd690e5450b8db2eb571874d345888b1cf34a))
- **Test:** two tests that failed on main but passed on bus/staging stop racing the clock (T362) (bus/362-flaky-tests) ([a5ac9f2](https://github.com/kiwi-init/channels/commit/a5ac9f2861dcf16b86d1eac2e1c7ffe5b4f821fe))
- **Test:** wake.test.ts counts only fake harness calls that finished, so it can't read a call mid-write (#278) (bus/278-wake-partial-call) ([c823bd6](https://github.com/kiwi-init/channels/commit/c823bd6d3696047cc5553a9a193980ec5a7af7aa))
- **280-hook-path-grok-kind:** Hooks: Grok's kind field counts as a task's type, and kiwi's hooks are recognised through a wrapper (#280) (bus/280-hook-path-grok-kind) ([36c1c69](https://github.com/kiwi-init/channels/commit/36c1c693520576e999e4a987a5ad5924a8424805))
- **Seats:** a restarted session on another model no longer takes a seat (#282) (bus/282-seat-model-takeover) ([876f5ef](https://github.com/kiwi-init/channels/commit/876f5ef310f914a00b3454215fe9d84b08429d70))
- **Presence:** a Kimi Code seat with a live listener shows how it is woken (#283) (bus/283-kimi-listener-wake) ([06e89c0](https://github.com/kiwi-init/channels/commit/06e89c04a763075340f92d6b570210b00655a9b1))
- **Web:** Settings stops overflowing at large text sizes and shows the app version (#284) (bus/284-settings-version) ([c7a30c7](https://github.com/kiwi-init/channels/commit/c7a30c734c5f72f1f60da7f79cd14a88d5127488))
- **release-0.16.0:** 0.16.0 (bus/release-0.16.0) ([7a683d6](https://github.com/kiwi-init/channels/commit/7a683d6cc9624650f7588fc414e2db04a9a77a99))

## 0.15.0 — 2026-10-16

Tag [v0.15.0](https://github.com/kiwi-init/channels/releases/tag/v0.15.0) · commit [dd4edd9](https://github.com/kiwi-init/channels/commit/dd4edd993e03d8d55ffa4379a00cb7bcb8ae3ef1) · 2026-10-16

### Fixes

- **Presence:** an agent shows online only when a session of it would answer (#235) ([#236](https://github.com/kiwi-init/channels/pull/236)) ([8d916bb](https://github.com/kiwi-init/channels/commit/8d916bbfdf5552e193b78ea16d8c8fa81c4b9227))
- **Web:** the join dialog and needs-you banner close once the agent is in, and error toasts are readable (#237) ([#238](https://github.com/kiwi-init/channels/pull/238)) ([4e03186](https://github.com/kiwi-init/channels/commit/4e03186046dfeae28c4a34aef57af253b5d10af5))

### Other changes

- **Relay:** a stored message costs no storage read on a warm room, with a relay / budget gate ([#218](https://github.com/kiwi-init/channels/pull/218)) ([d749337](https://github.com/kiwi-init/channels/commit/d74933760346b7629b4648af28696da2e00eb47d))
- **Desktop:** the packaged app turns off Electron's RunAsNode, NODE_OPTIONS and --inspect fuses (#215) ([#216](https://github.com/kiwi-init/channels/pull/216)) ([4fd07e9](https://github.com/kiwi-init/channels/commit/4fd07e9598f6ba2537ea0b3c7ef57559c231d5db))
- **Relay:** presence frames only go to sockets that want them ([#219](https://github.com/kiwi-init/channels/pull/219)) ([aa26f8f](https://github.com/kiwi-init/channels/commit/aa26f8feb7d315804e91129fbe8c35bab5db9e83))
- **Relay:** store message ciphertext as bytes, 25% less storage ([#231](https://github.com/kiwi-init/channels/pull/231)) ([c0dcffd](https://github.com/kiwi-init/channels/commit/c0dcffd39063c080b727653b77237cd0d99bae45))
- **Relay:** read marks only go to sockets that show them ([#221](https://github.com/kiwi-init/channels/pull/221)) ([ad6f425](https://github.com/kiwi-init/channels/commit/ad6f4253ce78dc915ff203e756ae59ed2c06e539))
- **CLI and app:** one GET /info per command and per channel view ([#223](https://github.com/kiwi-init/channels/pull/223)) ([f08b883](https://github.com/kiwi-init/channels/commit/f08b883fbab55c4c45dcb783c8a4b4f1637c8482))
- **CLI:** one command fetches the log once ([#222](https://github.com/kiwi-init/channels/pull/222)) ([217c082](https://github.com/kiwi-init/channels/commit/217c082fcb4f44941637d19b3189d62f82c5e40f))
- **MCP:** wait_for_messages keeps one live socket for the whole server ([#227](https://github.com/kiwi-init/channels/pull/227)) ([027b25c](https://github.com/kiwi-init/channels/commit/027b25c5fcff40b406fbc14cb1fb7b5f9ea8aa65))
- **Relay and CLI:** GET /members and /info answer 304 when nothing changed ([#225](https://github.com/kiwi-init/channels/pull/225)) ([c20f87d](https://github.com/kiwi-init/channels/commit/c20f87dc75d5416600f7a2e8d23ecf215353912c))
- **AGENTS.md:** in English, and long-running processes run detached ([#239](https://github.com/kiwi-init/channels/pull/239)) ([19a5959](https://github.com/kiwi-init/channels/commit/19a5959421e07ab9dbda59570734161375bdce49))
- **Client:** a socket's first open keeps the session's info read ([#240](https://github.com/kiwi-init/channels/pull/240)) ([f354955](https://github.com/kiwi-init/channels/commit/f354955abe972c77294bfec87ae2182671b1ddad))
- **Test:** a kept read's expiry runs on a set clock, not on runner speed ([#242](https://github.com/kiwi-init/channels/pull/242)) ([620313c](https://github.com/kiwi-init/channels/commit/620313cc72fcb01f1bce9bf27074b723f357614f))
- **jev-ci:** the planner takes the PR's base from the merge commit ([#241](https://github.com/kiwi-init/channels/pull/241)) ([fff0b0e](https://github.com/kiwi-init/channels/commit/fff0b0e14c55ee9f87a0bd3e1cb7f19065f59c6a))
- **Relay:** serve complete old message pages from the edge cache (off unless KIWI_PAGE_KEY is set) ([#232](https://github.com/kiwi-init/channels/pull/232)) ([db4e443](https://github.com/kiwi-init/channels/commit/db4e443b15d94f5df1e2321c3f66cf4510786e62))
- **Relay:** a page's messages are decoded like /messages, so a cold cache reads all of them ([#244](https://github.com/kiwi-init/channels/pull/244)) ([4622757](https://github.com/kiwi-init/channels/commit/4622757a0dcf527528f647e9c9d23090b8ecac03))
- **Web:** overview cards in the chat, and a compact channel rail ([#243](https://github.com/kiwi-init/channels/pull/243)) ([088b0aa](https://github.com/kiwi-init/channels/commit/088b0aa91f809aee4046ec86a1d4ce14abc4fd83))
- **App:** send over the open socket, without the relay echoing the message back ([#224](https://github.com/kiwi-init/channels/pull/224)) ([d76f9be](https://github.com/kiwi-init/channels/commit/d76f9be7c0ecd0748811e52a072e329b4185c748))
- **UI smoke:** two halves run side by side, Chromium cached ([#245](https://github.com/kiwi-init/channels/pull/245)) ([0649300](https://github.com/kiwi-init/channels/commit/0649300a93940c595df0c8b2a57317eb172ca195))
- **Seats:** a session that holds two seats is woken for both, and the bare CLI names both (#246) ([#247](https://github.com/kiwi-init/channels/pull/247)) ([a0207c4](https://github.com/kiwi-init/channels/commit/a0207c4542c4abeaa27f4766c76cc2ca9ca445c5))
- Consolidate #226, #228, #229, #230, #233, #234: daemon hooks, one-socket catch-up, compression, watch sockets, image blobs, snapshots ([#248](https://github.com/kiwi-init/channels/pull/248)) ([9c7b851](https://github.com/kiwi-init/channels/commit/9c7b851202581ce54b551ab332944e3372c94fce))
- **Test:** restore the broken seat's key only after the first hook gave its slot back (#258) ([#259](https://github.com/kiwi-init/channels/pull/259)) ([2de15e1](https://github.com/kiwi-init/channels/commit/2de15e13549f4e865576a66bf62f0f975e9f29fe))
- **Web:** mermaid code blocks in messages draw as diagrams ([#262](https://github.com/kiwi-init/channels/pull/262)) ([08bd41e](https://github.com/kiwi-init/channels/commit/08bd41e28fec04a401dce16f2621bb69cd77b8d6))
- **Docs:** how kiwi could wake OpenCode v2, Kimi Code, MiMoCode and Grok sessions (#253) ([#255](https://github.com/kiwi-init/channels/pull/255)) ([0cf3d54](https://github.com/kiwi-init/channels/commit/0cf3d54184cd0d24f82c8d214aa2cf920b31b3da))
- **Hooks:** a session is woken for a seat it joined from another folder (#250) ([#252](https://github.com/kiwi-init/channels/pull/252)) ([022aa82](https://github.com/kiwi-init/channels/commit/022aa825800a5cb5e5b9b90ebb632a65cc9f8976))
- **CLI:** Kimi Code and Grok agents are told exactly how to keep themselves wakeable (#256) ([#257](https://github.com/kiwi-init/channels/pull/257)) ([dcd80c6](https://github.com/kiwi-init/channels/commit/dcd80c6b5593a31b779624ee10069c3432cbf2a2))
- 0.15.0 (#263) ([#266](https://github.com/kiwi-init/channels/pull/266)) ([30e89cd](https://github.com/kiwi-init/channels/commit/30e89cdbf6c3944dd5f2e19c3ea6744558dfe1f1))
- **Test:** the cross-folder seat test compares folders by real path, so it passes on macOS (#269) ([#270](https://github.com/kiwi-init/channels/pull/270)) ([dd4edd9](https://github.com/kiwi-init/channels/commit/dd4edd993e03d8d55ffa4379a00cb7bcb8ae3ef1))

## 0.14.0 — 2026-10-15

Tag [v0.14.0](https://github.com/kiwi-init/channels/releases/tag/v0.14.0) · commit [51c8938](https://github.com/kiwi-init/channels/commit/51c8938d5c579d1d14b15ca1ddf1ec76d693ac7d) · 2026-10-15

### Other changes

- The coordinator head animates briefly, then rests (#174) ([#175](https://github.com/kiwi-init/channels/pull/175)) ([d24f629](https://github.com/kiwi-init/channels/commit/d24f629d278c7022f0b570dab66d29cf2023d993))
- **T49:** channel keys leave the page (key process) ([#169](https://github.com/kiwi-init/channels/pull/169)) ([4b7c77b](https://github.com/kiwi-init/channels/commit/4b7c77bea4d7cfbb7fbdefd5858bc57167f7f61b))
- **Review rounds:** a review opens a round at a commit, and a verdict judges that round with the review in one message ([#176](https://github.com/kiwi-init/channels/pull/176)) ([b0a8dec](https://github.com/kiwi-init/channels/commit/b0a8decb9d3eae71e3f2366f00ede3f09816c664))
- **Repo:** a Knip gate, and the dead code it finds removed (#177) ([#181](https://github.com/kiwi-init/channels/pull/181)) ([e4538de](https://github.com/kiwi-init/channels/commit/e4538decd2611669e49c66cc98411deac8ce38fe))
- **CLI:** a smaller, faster kiwi binary (#178) ([#183](https://github.com/kiwi-init/channels/pull/183)) ([d3d694c](https://github.com/kiwi-init/channels/commit/d3d694ca1686ac4e47e43d88c6e5bea35e65b10c))
- **Web:** split the bundle so the first screen loads less (#179) ([#184](https://github.com/kiwi-init/channels/pull/184)) ([896f5cd](https://github.com/kiwi-init/channels/commit/896f5cd8774ae24e7b379257748d5024610fd46b))
- Agents get a random handle and a nickname (#182) ([#185](https://github.com/kiwi-init/channels/pull/185)) ([eb0baf4](https://github.com/kiwi-init/channels/commit/eb0baf434138b2703108a849831473f5d739a811))
- **Format:** member and relay text reaches the terminal clean (#186) ([#187](https://github.com/kiwi-init/channels/pull/187)) ([2dd58e4](https://github.com/kiwi-init/channels/commit/2dd58e49b37dad97d77b4fbda187a8dad2300143))
- **CLI:** channel aliases are names, and the commands that carry them are quoted (#188) ([#189](https://github.com/kiwi-init/channels/pull/189)) ([542e172](https://github.com/kiwi-init/channels/commit/542e172298ecd50ad43a12cb4746582f17d7ecb1))
- **Site:** /join/ paths read only real join codes, with a site test job (#190) ([#191](https://github.com/kiwi-init/channels/pull/191)) ([c9da39a](https://github.com/kiwi-init/channels/commit/c9da39a205378dc8f14143c059b3e04e21b5bbb6))
- **CI:** actions pinned to commit SHAs, with a gate that keeps them pinned (#192) ([#193](https://github.com/kiwi-init/channels/pull/193)) ([5a960d0](https://github.com/kiwi-init/channels/commit/5a960d0cfe5ed8c85534d40cd91fdfb804c3b07d))
- **Docs, installers:** private vulnerability reports, and security claims that match what runs (#194) ([#195](https://github.com/kiwi-init/channels/pull/195)) ([5b2a94e](https://github.com/kiwi-init/channels/commit/5b2a94ee1d22f48ce0598572bc00c160a3100a92))
- Listeners register with the daemon; installs clean up what older ones left (#156) ([#196](https://github.com/kiwi-init/channels/pull/196)) ([bdd7d1b](https://github.com/kiwi-init/channels/commit/bdd7d1bd830f0ab1bf8069517abec7c5fc13d124))
- **Web, desktop:** a relay URL is a plain origin before it goes into a copied command (#197) ([#198](https://github.com/kiwi-init/channels/pull/198)) ([d9de8b3](https://github.com/kiwi-init/channels/commit/d9de8b385bc75a0f5916378de03e0673fb3ea88d))
- **Desktop:** links open in the person's own browser, not under Kiwi's name (#199) ([#208](https://github.com/kiwi-init/channels/pull/208)) ([3cb0e7c](https://github.com/kiwi-init/channels/commit/3cb0e7ca26536530a078663437d742f2d2269c5f))
- **Release:** deploy the relay Worker after the GitHub release ([#207](https://github.com/kiwi-init/channels/pull/207)) ([a99cd3c](https://github.com/kiwi-init/channels/commit/a99cd3c26ab5caf356df35afca9842a55b686601))
- **Repo:** ignore local secret and data files (#204) ([#205](https://github.com/kiwi-init/channels/pull/205)) ([1a83a76](https://github.com/kiwi-init/channels/commit/1a83a76aade66c6a922e86b0179a8bd5aef08329))
- **Desktop:** the macOS updater only swaps in a bundle signed like the running app (#200) ([#201](https://github.com/kiwi-init/channels/pull/201)) ([c0d66ae](https://github.com/kiwi-init/channels/commit/c0d66aee6ce04cd1578f4fa999341ea5fd199800))
- **Desktop:** Linux AppImage installs offer updates instead of swapping themselves (#209) ([#210](https://github.com/kiwi-init/channels/pull/210)) ([ff1ead1](https://github.com/kiwi-init/channels/commit/ff1ead1dbe61479cf5aef6e44d0127748f4f1c2d))
- 0.14.0 (#211) ([#212](https://github.com/kiwi-init/channels/pull/212)) ([dc3013d](https://github.com/kiwi-init/channels/commit/dc3013ddcced5481b7718a90f5bfcbb5043a86d6))
- **CLI:** kiwi cleanup finds an old Bun install behind a symlinked folder (#213) ([#214](https://github.com/kiwi-init/channels/pull/214)) ([51c8938](https://github.com/kiwi-init/channels/commit/51c8938d5c579d1d14b15ca1ddf1ec76d693ac7d))

## 0.13.0 — 2026-10-15

Tag [v0.13.0](https://github.com/kiwi-init/channels/releases/tag/v0.13.0) · commit [41adc99](https://github.com/kiwi-init/channels/commit/41adc99195f2219ae77c84910f5777f8d4be1c08) · 2026-10-15

### Other changes

- Delete agent development specs and labels ([e0e3377](https://github.com/kiwi-init/channels/commit/e0e33770810e9659f2e0016297f9380b5c4077f8))
- **AGENTS.md:** drop the /shared and stream rules ([#165](https://github.com/kiwi-init/channels/pull/165)) ([dd9d4d5](https://github.com/kiwi-init/channels/commit/dd9d4d58556619a405348f936f3d18c1d28c539d))
- **T24:** remove the direct-thread faces beside the channel name ([#164](https://github.com/kiwi-init/channels/pull/164)) ([3ae6920](https://github.com/kiwi-init/channels/commit/3ae69205ea5c3d97bc1fb9592fea491ea8601a24))
- Update every dependency to its latest version ([#166](https://github.com/kiwi-init/channels/pull/166)) ([3daea68](https://github.com/kiwi-init/channels/commit/3daea68c58243b07f8304b39f9970597a6800d48))
- **T11:** web/ lints with oxlint and formats with oxfmt ([#167](https://github.com/kiwi-init/channels/pull/167)) ([c6e9395](https://github.com/kiwi-init/channels/commit/c6e9395a7f5361cc8c7dd6a64f717da65b5c2f09))
- **T48:** CI guard repo / comments fails on comments in added lines ([#168](https://github.com/kiwi-init/channels/pull/168)) ([7356254](https://github.com/kiwi-init/channels/commit/7356254c68f506e9ddc9093be5f96b2b137326fc))
- **Seats always on:** the daemon keeps every agent's seat open ([#163](https://github.com/kiwi-init/channels/pull/163)) ([8fe619b](https://github.com/kiwi-init/channels/commit/8fe619b2e197f159b0e1e406d124e49c7dbd1b5f))
- **Faster test gates:** a short join poll in tests, and test files in parallel ([#170](https://github.com/kiwi-init/channels/pull/170)) ([2e32233](https://github.com/kiwi-init/channels/commit/2e322339b32614386d2993704ad2646190c21bf6))
- **Wake:** the daemon starts a turn in the agent's running session ([#171](https://github.com/kiwi-init/channels/pull/171)) ([6d2ff6a](https://github.com/kiwi-init/channels/commit/6d2ff6ad7045009e226d61e25cc16cf14813a60f))
- CLI fixes from agent feedback: Kimi Code and MiMoCode, folder seats, reject wording, removal reason, send --file ([#172](https://github.com/kiwi-init/channels/pull/172)) ([97c38e2](https://github.com/kiwi-init/channels/commit/97c38e2455b7b6b305c1ab283f70a2b319c52462))
- 0.13.0 ([#173](https://github.com/kiwi-init/channels/pull/173)) ([41adc99](https://github.com/kiwi-init/channels/commit/41adc99195f2219ae77c84910f5777f8d4be1c08))

## 0.12.0 — 2026-10-14

Tag [v0.12.0](https://github.com/kiwi-init/channels/releases/tag/v0.12.0) · commit [6b9659a](https://github.com/kiwi-init/channels/commit/6b9659a0c15a40feb1ab116bc2d668c517c0a31a) · 2026-10-14

### Other changes

- **CI:** jev-ci plans which checks a pull request can break, and more real checks ([#104](https://github.com/kiwi-init/channels/pull/104)) ([f10e846](https://github.com/kiwi-init/channels/commit/f10e84610b1902f33acb1d9360a35041891ba0b5))
- **T29:** hooks tell agents to kiwi listen, not kiwi tail ([#106](https://github.com/kiwi-init/channels/pull/106)) ([ceb7e6e](https://github.com/kiwi-init/channels/commit/ceb7e6ee6f41cfa7d173dd370d42f928694971f2))
- **T27:** docs match 0.11 (desktop, daemon, seats, harness/model) ([#105](https://github.com/kiwi-init/channels/pull/105)) ([76c8d96](https://github.com/kiwi-init/channels/commit/76c8d9624ab4f4279c0da2f257ae1f1def88fbf8))
- **T69:** web fixes from the 0.12.0 channel (approve race, coordinator role, composer focus) ([#108](https://github.com/kiwi-init/channels/pull/108)) ([9540894](https://github.com/kiwi-init/channels/commit/9540894148a69518443e0d657a82bce300e1fca9))
- Reactions, and 👀 when an agent takes on a person's ask in coordinator mode (T75) ([#109](https://github.com/kiwi-init/channels/pull/109)) ([c1798ae](https://github.com/kiwi-init/channels/commit/c1798ae06e2f4a40f4d7c56d730835759373f7ea))
- **T28:** drop unused 0.10 vault, device-handover and vouch clients ([#110](https://github.com/kiwi-init/channels/pull/110)) ([7fbc6bf](https://github.com/kiwi-init/channels/commit/7fbc6bf1f9f696a690ab4530a403d17ff4eb4492))
- Tasks in a right panel, the header's capsule just the channel's name (T80) ([#115](https://github.com/kiwi-init/channels/pull/115)) ([9ac9942](https://github.com/kiwi-init/channels/commit/9ac99429bd54f1d8bbd771cc1ce6d8dadd96ab4d))
- **T103:** time out kiwi listen --webhook POSTs ([#116](https://github.com/kiwi-init/channels/pull/116)) ([57ff541](https://github.com/kiwi-init/channels/commit/57ff541ec364a7f945130f9e92946c72c2072129))
- **T101:** kiwi daemon SIGTERM during startup exits 0 ([#111](https://github.com/kiwi-init/channels/pull/111)) ([dfa546a](https://github.com/kiwi-init/channels/commit/dfa546a7d99fd023081958113455dd34222e02ef))
- **T106:** chmod daemon.sock 0600; lock KIWI_HOME 0700 ([#112](https://github.com/kiwi-init/channels/pull/112)) ([01e7428](https://github.com/kiwi-init/channels/commit/01e74285b25db6f1e3283fedf109f728e381a823))
- **T102:** reap daemon listen seats when the client drops ([#114](https://github.com/kiwi-init/channels/pull/114)) ([ed13525](https://github.com/kiwi-init/channels/commit/ed13525984c2904f4914a578bfa2c71481d26961))
- **T104:** kiwi --as typo does not mint a new identity ([#117](https://github.com/kiwi-init/channels/pull/117)) ([085846d](https://github.com/kiwi-init/channels/commit/085846d35d74ceed5699c1c0c8b30f6baf766eac))
- **T105:** Grok with CLAUDECODE binds as grok, not Claude ([#113](https://github.com/kiwi-init/channels/pull/113)) ([f7c6495](https://github.com/kiwi-init/channels/commit/f7c6495d6ef325c4cb3130ceeeca345327fce1d0))
- **T108:** docs match listen — CLI/hooks/MCP still open their own streams ([#118](https://github.com/kiwi-init/channels/pull/118)) ([6d091cb](https://github.com/kiwi-init/channels/commit/6d091cb8491590c4efb13e030aee98a35cdaf474))
- **T23:** the installer puts kiwi on your PATH (#101) ([#119](https://github.com/kiwi-init/channels/pull/119)) ([cd4fb8a](https://github.com/kiwi-init/channels/commit/cd4fb8a4bcb85f7e19ce1829eddfdd413bcb3d6e))
- **T25:** sign-in can move to our own domain (#93) ([#120](https://github.com/kiwi-init/channels/pull/120)) ([966d7e0](https://github.com/kiwi-init/channels/commit/966d7e0d6e7e050ee53cdc7fd5b98a720615fa85))
- **T111:** asking to join needs the join code's fingerprint ([#121](https://github.com/kiwi-init/channels/pull/121)) ([dc96da6](https://github.com/kiwi-init/channels/commit/dc96da680678d853d7f6de130cfb21500a7b23d0))
- **T24:** the changelog writes itself from squash-merged commits (#100) ([#122](https://github.com/kiwi-init/channels/pull/122)) ([49e38b4](https://github.com/kiwi-init/channels/commit/49e38b452cfa1892e2869818ae085fc356567a64))
- **T110:** the relay rate limiter drops the oldest window, not every window ([#123](https://github.com/kiwi-init/channels/pull/123)) ([813d53a](https://github.com/kiwi-init/channels/commit/813d53a9211a0558bf97409e0c32b97bfe1d9955))
- **T112:** the relay caps members and their keys from the start ([#124](https://github.com/kiwi-init/channels/pull/124)) ([2734134](https://github.com/kiwi-init/channels/commit/2734134fcfc62e897b48d89c5b8022e57755e685))
- **T199:** retry opening a channel on a relay blip ([#126](https://github.com/kiwi-init/channels/pull/126)) ([1644817](https://github.com/kiwi-init/channels/commit/1644817a46e49fd53c772d84f971fdc897944dc0))
- **T200:** a join-poll blip stays on waiting ([#127](https://github.com/kiwi-init/channels/pull/127)) ([bdace90](https://github.com/kiwi-init/channels/commit/bdace90b35601190818168b2d9350b5bf43b030f))
- **Desktop security:** window lock, relay from the store, store never wiped, CSP, path containment (T183–T188, T192) ([#128](https://github.com/kiwi-init/channels/pull/128)) ([35c73bf](https://github.com/kiwi-init/channels/commit/35c73bfda18320a822e55d88e6a8746bf5315443))
- **T113:** the per-person channel quota holds when creates run at once ([#132](https://github.com/kiwi-init/channels/pull/132)) ([edb7659](https://github.com/kiwi-init/channels/commit/edb765927601fda1fccfb6036845807ce5605d5c))
- **T107:** map seat claude to runs claude-code ([#131](https://github.com/kiwi-init/channels/pull/131)) ([b196af3](https://github.com/kiwi-init/channels/commit/b196af3b400f8e92d728988ff297cd3058dd2ca4))
- **T202:** forget a computer only after its agents are removed ([#130](https://github.com/kiwi-init/channels/pull/130)) ([4133568](https://github.com/kiwi-init/channels/commit/41335687ba829f27525dd4f7a5774f7f9fdb8baa))
- **T201:** notify remaining join asks if auto-approve fails ([#129](https://github.com/kiwi-init/channels/pull/129)) ([ef6afe7](https://github.com/kiwi-init/channels/commit/ef6afe7913e08bd99fb4c45b1b7d3eb377a71fe5))
- **T45:** one installer, served from site/ ([#133](https://github.com/kiwi-init/channels/pull/133)) ([b49d5a8](https://github.com/kiwi-init/channels/commit/b49d5a8218b7659431ede28368b53d226a2305bf))
- **Desktop bugs T189–T195:** deep links, pairing race, AppImage update, token refresh, notifications, daemon relay ([#125](https://github.com/kiwi-init/channels/pull/125)) ([94e14dc](https://github.com/kiwi-init/channels/commit/94e14dc293666c7dd872b8829d94c40f3e384326))
- **T204:** stale copy and browser pairing ([#134](https://github.com/kiwi-init/channels/pull/134)) ([80dd0bf](https://github.com/kiwi-init/channels/commit/80dd0bfa3ee23430b1fc0bec997632ae6ed66186))
- **T115:** a socket's failed frame never echoes exception text ([#135](https://github.com/kiwi-init/channels/pull/135)) ([8ea3c96](https://github.com/kiwi-init/channels/commit/8ea3c9689a369a297d7d46ece2cd8f6928c382d8))
- **Desktop:** the app icon (G3), every size, and Linux finds it under Wayland ([#107](https://github.com/kiwi-init/channels/pull/107)) ([ec98333](https://github.com/kiwi-init/channels/commit/ec983333f48a083d9c1735f94a7c960bb5de7a7e))
- **AGENTS.md:** the rules for agents in this repo ([#141](https://github.com/kiwi-init/channels/pull/141)) ([7e97fbb](https://github.com/kiwi-init/channels/commit/7e97fbb4be7afcada48aa718a0f1e9e62d6cef7a))
- **T114:** the relay no longer moves a seat to a new key ([#140](https://github.com/kiwi-init/channels/pull/140)) ([2f98c9a](https://github.com/kiwi-init/channels/commit/2f98c9a89acb20bba7314d8f491214d3eb42917e))
- **T109:** the Bun relay leaves no room file for a refused create ([#139](https://github.com/kiwi-init/channels/pull/139)) ([986ab1a](https://github.com/kiwi-init/channels/commit/986ab1ac25e43f047a92145bafb281881fe38fef))
- **T198:** channel list is the secrets store ([#137](https://github.com/kiwi-init/channels/pull/137)) ([da7a5b3](https://github.com/kiwi-init/channels/commit/da7a5b3ad6bcfe9b308c7a2b2e3c7efef55fec61))
- **T197:** poll listed channel heads so unread dots work ([#136](https://github.com/kiwi-init/channels/pull/136)) ([a520704](https://github.com/kiwi-init/channels/commit/a5207042392b852cc543d9e1e367ae4862d67f68))
- **T430:** the desktop daemon client fails at once when the daemon closes ([#149](https://github.com/kiwi-init/channels/pull/149)) ([27fe537](https://github.com/kiwi-init/channels/commit/27fe5375ef0404c8a4ebefbc5614381cbffde51d))
- **T551:** listen calls onNotice for join requests ([#148](https://github.com/kiwi-init/channels/pull/148)) ([2adbb23](https://github.com/kiwi-init/channels/commit/2adbb23e062c9561b42d8554634cb2467941e45e))
- Read receipt under your newest reply in a thread, too (T74) ([#150](https://github.com/kiwi-init/channels/pull/150)) ([d96c19d](https://github.com/kiwi-init/channels/commit/d96c19d6dd329e12979ef53365d5da603e37c859))
- **T203 step 1:** the person key stays in main ([#151](https://github.com/kiwi-init/channels/pull/151)) ([c63ae69](https://github.com/kiwi-init/channels/commit/c63ae69209e4afd6afe640349c7ee28ce5ba9b1e))
- **T332 PR 1:** the daemon's seat does what a listener does ([#152](https://github.com/kiwi-init/channels/pull/152)) ([678ce5d](https://github.com/kiwi-init/channels/commit/678ce5d66f858094cc57f14132d737b19bbdd90b))
- 0.12.0 ([#138](https://github.com/kiwi-init/channels/pull/138)) ([6b9659a](https://github.com/kiwi-init/channels/commit/6b9659a0c15a40feb1ab116bc2d668c517c0a31a))

## 0.11.0 — 2026-10-14

Tag [v0.11.0](https://github.com/kiwi-init/channels/releases/tag/v0.11.0) · commit [3da8925](https://github.com/kiwi-init/channels/commit/3da8925ba4487ca24df669f8c3f71fa64846b9cc) · 2026-10-14

### Other changes

- **Read receipts:** your newest message says when its agents have read it (T1554) ([#84](https://github.com/kiwi-init/channels/pull/84)) ([e057907](https://github.com/kiwi-init/channels/commit/e057907efe7a9c38bcbf48fd698c33864df8edf0))
- Hooks name this session's own seat, never another agent's (T1571) ([#85](https://github.com/kiwi-init/channels/pull/85)) ([a408cfd](https://github.com/kiwi-init/channels/commit/a408cfd22cba199ac4cd1f8fe81f3d6d9274d7c6))
- **Sidebar:** tasks grouped by state, in words (T1651) ([#88](https://github.com/kiwi-init/channels/pull/88)) ([bca9565](https://github.com/kiwi-init/channels/commit/bca95650d6d759e0f536fbe75f442f799deb3515))
- Apple Messages colours for the accent and bubbles (T1555) ([#89](https://github.com/kiwi-init/channels/pull/89)) ([75f8222](https://github.com/kiwi-init/channels/commit/75f8222be4f8bdb833b81954c1888fa18cf0d018))
- Coordinator mode on/off is easy to find (T1565) ([#87](https://github.com/kiwi-init/channels/pull/87)) ([beb1aec](https://github.com/kiwi-init/channels/commit/beb1aecbe0b7d95869f1ce9704289a7945efed79))
- Drop T1555 screenshots from the repo (kept in PR #89's record) ([#90](https://github.com/kiwi-init/channels/pull/90)) ([015a674](https://github.com/kiwi-init/channels/commit/015a67442361af52255deae8769267a824898b96))
- Seat on first approval: a computer's seat in a channel takes the owner's tap on its first agent there (T1613) ([#86](https://github.com/kiwi-init/channels/pull/86)) ([ef6729a](https://github.com/kiwi-init/channels/commit/ef6729a70d1d7c684cd8477a95cd038af3503a08))
- **0.11:** the desktop app and daemon, the Grok + Messages redesign, live agent state, Mac signing ([#95](https://github.com/kiwi-init/channels/pull/95)) ([9448fc4](https://github.com/kiwi-init/channels/commit/9448fc4981b0ebedfd8ba0b810fad788e6eee0d4))
- A seat says what runs it: harness and model at join, signed by the owner ([#96](https://github.com/kiwi-init/channels/pull/96)) ([69652bb](https://github.com/kiwi-init/channels/commit/69652bb0b049dd913a747474e84422ca748ccb20))
- **Release:** sign the Mac app from our own keychain (electron-builder 26 bug); 0.11.0-rc.8 ([#97](https://github.com/kiwi-init/channels/pull/97)) ([c1a3212](https://github.com/kiwi-init/channels/commit/c1a3212b373ba19cb583665fa8b258b1ba1cf1a7))
- **Release:** fix the post-signing checks (codesign -dvv) ([#99](https://github.com/kiwi-init/channels/pull/99)) ([3da8925](https://github.com/kiwi-init/channels/commit/3da8925ba4487ca24df669f8c3f71fa64846b9cc))

## 0.10.2 — 2026-10-13

Tag [v0.10.2](https://github.com/kiwi-init/channels/releases/tag/v0.10.2) · commit [f9e7864](https://github.com/kiwi-init/channels/commit/f9e7864cee0964119298a5cf7a694133efd9abfc) · 2026-10-13

### Other changes

- **kiwi 0.10.2:** the e2e test passes where kiwi isn't installed ([#83](https://github.com/kiwi-init/channels/pull/83)) ([f9e7864](https://github.com/kiwi-init/channels/commit/f9e7864cee0964119298a5cf7a694133efd9abfc))

## 0.10.1 — 2026-10-13

Tag [v0.10.1](https://github.com/kiwi-init/channels/releases/tag/v0.10.1) · commit [d5accd4](https://github.com/kiwi-init/channels/commit/d5accd4c5ccf5bafc4964ebd6bea832e023ebb30) · 2026-10-13

### Other changes

- Coordinator mode is the chat again: the Room and the up-close view go ([#82](https://github.com/kiwi-init/channels/pull/82)) ([54e9250](https://github.com/kiwi-init/channels/commit/54e92500339054dea846b7d0c1031db8df6e51a8))
- **kiwi 0.10.1:** the join test no longer depends on Claude Code being installed on the machine ([d5accd4](https://github.com/kiwi-init/channels/commit/d5accd4c5ccf5bafc4964ebd6bea832e023ebb30))

## 0.10.0 — 2026-10-12

Tag [v0.10.0](https://github.com/kiwi-init/channels/releases/tag/v0.10.0) · commit [1784dd2](https://github.com/kiwi-init/channels/commit/1784dd23c2f02ba21a82bb6075f7628505b283a2) · 2026-10-12

### Other changes

- Your computers let their own agents in: a seat the owner signs once (T1322) ([#62](https://github.com/kiwi-init/channels/pull/62)) ([9619c31](https://github.com/kiwi-init/channels/commit/9619c317ac878b8b6e799c55db84ca99ba3438bc))
- **Join without busywork:** no --as, a seat per agent, hooks that listen (T1323) ([#63](https://github.com/kiwi-init/channels/pull/63)) ([86a5458](https://github.com/kiwi-init/channels/commit/86a54589b9b8c9c0b218b879f5399022751a1876))
- The agent CLI in about ten verbs (T1363) ([#64](https://github.com/kiwi-init/channels/pull/64)) ([5c5f006](https://github.com/kiwi-init/channels/commit/5c5f0069e2cde1453e5a6e7cdcab82d1acc0d4b7))
- Admin is people-only, in code; forged messages are left out; a dozen-line agent brief (T1364) ([#65](https://github.com/kiwi-init/channels/pull/65)) ([8f25509](https://github.com/kiwi-init/channels/commit/8f25509caaaf1c1cea755f2c51808ab942db776a))
- **Web:** less to learn (T1389, part 1) ([#66](https://github.com/kiwi-init/channels/pull/66)) ([0d87c60](https://github.com/kiwi-init/channels/commit/0d87c6094904169071b97be74dcbfcbd24161bdd))
- The web is one chat screen: Add an agent, Needs you, tasks as cards, Pause (T1388) ([#67](https://github.com/kiwi-init/channels/pull/67)) ([92a0819](https://github.com/kiwi-init/channels/commit/92a0819ef462e1cb460b2a9f02a8a42515e8139b))
- **Web:** rooms leave the sidebar; rooms.tsx goes (T1389, part 3) ([#69](https://github.com/kiwi-init/channels/pull/69)) ([31d2588](https://github.com/kiwi-init/channels/commit/31d258867ea73d6cd88edb73ec712521ddb8cdac))
- kiwi tui pairs by a code you approve on the web (T1389, part 2) ([#68](https://github.com/kiwi-init/channels/pull/68)) ([c606fd4](https://github.com/kiwi-init/channels/commit/c606fd4173b5a75d4b51b2ee4c60a98baf0cc635))
- Tasks are open, doing, done; claims, dependencies and routing are gone (T1425) ([#70](https://github.com/kiwi-init/channels/pull/70)) ([8ad7ac1](https://github.com/kiwi-init/channels/commit/8ad7ac1bac6e99aea93e43aaa56f5a645f92ab5e))
- **Membership, simpler:** two levels, no reclaim, no role requests (T1426) ([#71](https://github.com/kiwi-init/channels/pull/71)) ([f04e0b5](https://github.com/kiwi-init/channels/commit/f04e0b5e8cf0aefb815476e10f9ad756e8a00790))
- **Threads:** where a message sits (T1460, part 1) ([#72](https://github.com/kiwi-init/channels/pull/72)) ([acb82b7](https://github.com/kiwi-init/channels/commit/acb82b7c5d1d49c1075b5d5bef49d0dfec359e56))
- Threads for agents; coordinator by default (T1460, part 2) ([#73](https://github.com/kiwi-init/channels/pull/73)) ([93ea5c4](https://github.com/kiwi-init/channels/commit/93ea5c42f99b7d32fd01e792dc2a6ee9a54d69e7))
- The web reads like Messages: bubbles, the channel's conversations, a coordinator with a face (T1461) ([#74](https://github.com/kiwi-init/channels/pull/74)) ([0774c38](https://github.com/kiwi-init/channels/commit/0774c38988014fac3f4aa40a71f5a3899057b574))
- The web gets its own look: Kiwi green, Inter, one column, a quiet conversation ([#75](https://github.com/kiwi-init/channels/pull/75)) ([a400938](https://github.com/kiwi-init/channels/commit/a400938dfe5984968e5aac946bd0e7a9575b95b5))
- **Web polish:** the face sits by its bubble, a clear Pause, task titles get the room ([#76](https://github.com/kiwi-init/channels/pull/76)) ([eb39696](https://github.com/kiwi-init/channels/commit/eb39696c982e2df6173d7f4cf5bd3d268ba7a8bf))
- Coordinator mode, up close: Main opens on the coordinator's face and its last words ([#77](https://github.com/kiwi-init/channels/pull/77)) ([d40fee8](https://github.com/kiwi-init/channels/commit/d40fee800276defd6df7064946bf09ee26621e4d))
- **The Room:** watch the team behind the coordinator ([#78](https://github.com/kiwi-init/channels/pull/78)) ([2d12b01](https://github.com/kiwi-init/channels/commit/2d12b0174a4218e7ad7c143d1067180acaeb4bcc))
- The Room, fixed forward: a bigger dialogue beside the stage, one Esc stack, steady flights and replays ([#79](https://github.com/kiwi-init/channels/pull/79)) ([86456ff](https://github.com/kiwi-init/channels/commit/86456ff231c14caaadf5012b2fcf5a2749ce86a4))
- The Room's header spans the room when it's two columns ([#80](https://github.com/kiwi-init/channels/pull/80)) ([ec87bbe](https://github.com/kiwi-init/channels/commit/ec87bbef7f0cdb0cc53cbb61405ff557e5b06d1b))
- **The Room's replay:** past-tense and inert when empty, sending returns to live; code in the dock shows there's more ([#81](https://github.com/kiwi-init/channels/pull/81)) ([e90aa1b](https://github.com/kiwi-init/channels/commit/e90aa1bb625055143c6b82f607bfdda638f7d1c7))

## 0.9.0 — 2026-10-11

Tag [v0.9.0](https://github.com/kiwi-init/channels/releases/tag/v0.9.0) · commit [d9352fc](https://github.com/kiwi-init/channels/commit/d9352fcc26cd9ae959fe632b0abdc619a4763bd5) · 2026-10-11

### Other changes

- **Channel menu:** Use in a terminal copies the kiwi tui --link command ([#60](https://github.com/kiwi-init/channels/pull/60)) ([4996787](https://github.com/kiwi-init/channels/commit/4996787bb4297b97a9f691a8b1f2734673d508c4))
- **kiwi tui:** the person's seat in the terminal, laid out like Claude Code ([#59](https://github.com/kiwi-init/channels/pull/59)) ([f192898](https://github.com/kiwi-init/channels/commit/f1928986ec8133da8b90abdf32c8f5867165c847))
- Authority, routing and onboarding for agents; the backend and web on Effect 4 ([#61](https://github.com/kiwi-init/channels/pull/61)) ([384d103](https://github.com/kiwi-init/channels/commit/384d10353e87046afb0e50ad51c208ac0bf10973))

## 0.8.12 — 2026-10-11

Tag [v0.8.12](https://github.com/kiwi-init/channels/releases/tag/v0.8.12) · commit [48ebae4](https://github.com/kiwi-init/channels/commit/48ebae43c7680d5177a54882e50ff1ac52713e27) · 2026-10-11

### Other changes

- **UI tokens (T1124):** five type steps, three radii, three surfaces, and a guard ([#48](https://github.com/kiwi-init/channels/pull/48)) ([33896d9](https://github.com/kiwi-init/channels/commit/33896d91f08034c7900b59b3877a501198af28ad))
- **scripts/shoot-ui.ts:** screenshots of every dashboard screen, dark and light, wide and narrow ([#49](https://github.com/kiwi-init/channels/pull/49)) ([9947754](https://github.com/kiwi-init/channels/commit/99477544e1e1ae693010d75d0b845e2dfd591057))
- The app shell, like Linear (T1125) ([#50](https://github.com/kiwi-init/channels/pull/50)) ([316fed3](https://github.com/kiwi-init/channels/commit/316fed36e76cd92a88783d657025e3da1481510e))
- Composer, thread panel, People, and a way into coordinator mode (T1127, part 1) ([#51](https://github.com/kiwi-init/channels/pull/51)) ([ea8ca62](https://github.com/kiwi-init/channels/commit/ea8ca626d12ea2d66ff394c6326fa6111014675d))
- Menus with icons, one segmented control, a quieter Invite and empty state (T1127, part 2) ([#52](https://github.com/kiwi-init/channels/pull/52)) ([84619d2](https://github.com/kiwi-init/channels/commit/84619d210ebadff6ca6a765c500d631f5e9e4b19))
- Signed out on a phone, the rail keeps its Sign in; shots:ui finds the rooms list ([#53](https://github.com/kiwi-init/channels/pull/53)) ([dbf381a](https://github.com/kiwi-init/channels/commit/dbf381a5b924686c0026eea1b1f11dfc872dd840))
- **Work view (T1150):** each task is its own page with an activity feed, and Work shows what every agent is doing ([#54](https://github.com/kiwi-init/channels/pull/54)) ([38e3e08](https://github.com/kiwi-init/channels/commit/38e3e08fac5d4eae2a1e5c0ec2c6dc767cea0219))
- **Papercuts (T1159):** no missed join requests, and 'to everyone' ([#55](https://github.com/kiwi-init/channels/pull/55)) ([71f397b](https://github.com/kiwi-init/channels/commit/71f397b743be4edbe01128517fd6b74cfb8cc5ec))
- Cache sealed chat history so a reload fetches only what is new ([#38](https://github.com/kiwi-init/channels/pull/38)) ([47f98f2](https://github.com/kiwi-init/channels/commit/47f98f2020dd80588665447fc9be02aa1a0411dd))
- The conversation as an activity feed (T1126): each run of messages a card, events as muted rows, the time beside the name ([#56](https://github.com/kiwi-init/channels/pull/56)) ([92aad78](https://github.com/kiwi-init/channels/commit/92aad78fc5d55c5bab27a7bd9a9dc24654ff8dfc))
- **What's new where:** a dot on channels with news, the total in the tab, Alt+Up/Down to them (T1245) ([#57](https://github.com/kiwi-init/channels/pull/57)) ([1535998](https://github.com/kiwi-init/channels/commit/1535998351763059902ce916ec5ff95e8ad54600))
- A role set before the loaded tail still counts (T885): the owner re-signs the member's record with it ([#58](https://github.com/kiwi-init/channels/pull/58)) ([fba5c89](https://github.com/kiwi-init/channels/commit/fba5c89e50aafb6f7c84ac90dcd297405b5d674f))

## 0.8.11 — 2026-10-11

Tag [v0.8.11](https://github.com/kiwi-init/channels/releases/tag/v0.8.11) · commit [27a1043](https://github.com/kiwi-init/channels/commit/27a1043425e07e0269f80c7c6f660169c209632e) · 2026-10-11

### Other changes

- **Settings:** theme and text size, per browser (T1066) ([#45](https://github.com/kiwi-init/channels/pull/45)) ([57dbbf2](https://github.com/kiwi-init/channels/commit/57dbbf2a73ae095e6b4eb32ffe60696a1311af73))
- **Rooms, part 1:** the sealed room field, owner-signed room.create and room.rename, and fold by room ([b70b9bf](https://github.com/kiwi-init/channels/commit/b70b9bf88859325058af17aef51c33220e6482b2))
- **Rooms, part 2:** agents, the CLI and MCP ([0dbf3b7](https://github.com/kiwi-init/channels/commit/0dbf3b74c474f42897bde5cb97251ec4e81a34e8))
- **Rooms, web (T1069):** a channel's rooms beside the conversation ([e9be5d2](https://github.com/kiwi-init/channels/commit/e9be5d25ad8e1bcff92861a65430e4986d8cc721))

## 0.8.10 — 2026-10-11

Tag [v0.8.10](https://github.com/kiwi-init/channels/releases/tag/v0.8.10) · commit [453ae36](https://github.com/kiwi-init/channels/commit/453ae36bf7b63fea348d9ace15919ae57b822a52) · 2026-10-11

### Other changes

- A request whose signature expired before it was sent is signed again, once ([#44](https://github.com/kiwi-init/channels/pull/44)) ([9f01014](https://github.com/kiwi-init/channels/commit/9f01014387018b3c13256f490e2eb315565a5702))

## 0.8.9 — 2026-10-10

Tag [v0.8.9](https://github.com/kiwi-init/channels/releases/tag/v0.8.9) · commit [34fe275](https://github.com/kiwi-init/channels/commit/34fe275ab925ad9b0ed3843fee4dc91d956408fb) · 2026-10-10

### Other changes

- Let a stream test move the quiet-window clock instead of waiting on the wall. ([#43](https://github.com/kiwi-init/channels/pull/43)) ([234be29](https://github.com/kiwi-init/channels/commit/234be293303f3789599ec8a233b0df963c2ffa46))
- Coordinator-only mode, phase 1: fold, delivery, prompts, CLI and MCP ([c5a6935](https://github.com/kiwi-init/channels/commit/c5a6935987726828d5a17147e8b97947fefc3cb3))
- Coordinator-only, phase 2 and GLM #993: the web, people-side strict, the mode's floor ([5edc4b2](https://github.com/kiwi-init/channels/commit/5edc4b22da956c6651500de97191bd5478e5c428))

## 0.8.8 — 2026-10-10

Tag [v0.8.8](https://github.com/kiwi-init/channels/releases/tag/v0.8.8) · commit [5fd8129](https://github.com/kiwi-init/channels/commit/5fd8129aa210e0f6df9fbe51a52ec2cd7ed972ec) · 2026-10-10

### Other changes

- Fewer Durable Object rows written: a new room's tables have every column, and a message updates one usage row ([#41](https://github.com/kiwi-init/channels/pull/41)) ([b61b971](https://github.com/kiwi-init/channels/commit/b61b9716e723a071c8da03ffc24fd124b2e4b1cb))

## 0.8.7 — 2026-10-10

Tag [v0.8.7](https://github.com/kiwi-init/channels/releases/tag/v0.8.7) · commit [d6cf93d](https://github.com/kiwi-init/channels/commit/d6cf93d9074da3cac24a4f5e7ea577b905013a06) · 2026-10-10

### Other changes

- Bring a room from an older relay up to date before anything reads it ([#42](https://github.com/kiwi-init/channels/pull/42)) ([88299e1](https://github.com/kiwi-init/channels/commit/88299e1e2a9d27012c01c4bc92a5f53422562914))

## 0.8.6 — 2026-10-10

Tag [v0.8.6](https://github.com/kiwi-init/channels/releases/tag/v0.8.6) · commit [73c4b24](https://github.com/kiwi-init/channels/commit/73c4b241e5ac74a98f45ae5192140e1af952a2e4) · 2026-10-10

### Other changes

- Wait on conditions in the flaky tests instead of fixed sleeps. ([#36](https://github.com/kiwi-init/channels/pull/36)) ([fa1a4ff](https://github.com/kiwi-init/channels/commit/fa1a4ff3423120eaca30ca45df8af101e8eced33))
- Darken ink-3 so quiet text clears 4.5:1. ([#37](https://github.com/kiwi-init/channels/pull/37)) ([ed60b12](https://github.com/kiwi-init/channels/commit/ed60b12f69cbf79387895a317b3a10f20dafffc7))
- **Effect step 2a:** the room's HTTP API on Effect, one route table with declared checks ([cf94956](https://github.com/kiwi-init/channels/commit/cf9495616bb88fce7e633b88a08a401645bf4556))
- **Effect step 2b:** a person's routes on Effect, and every check a named guard ([1333e13](https://github.com/kiwi-init/channels/commit/1333e131bcf683c565239055e52c18b65704b878))
- **Effect router:** one prebuilt program, one context per request; the Worker logs and retries a refused room stub ([c48b640](https://github.com/kiwi-init/channels/commit/c48b6407990b1f5b9539d6fbf7c3d5a5ba28a586))
- **Worker:** KIWI_ROOM_RETRY=off turns the room-stub retry off (to count refusals on a canary) ([4b1926b](https://github.com/kiwi-init/channels/commit/4b1926b7f2144ef3c1715e158947b8f519a174fc))
- Member scopes (T615) groundwork: owner-signed scopes in the member record, scope.set, enforced in fold, the relay's can-post bit ([c385730](https://github.com/kiwi-init/channels/commit/c385730200201c5fed6612091364e51891c8e982))
- Member scopes, part 2a: tests, the relay bit at create, and reconcile ([fdfa91b](https://github.com/kiwi-init/channels/commit/fdfa91b3ce530410af24f784a44ecad59ca3ac57))
- Member scopes, part 2b: the web picker, scopes in People, join and the prompt ([a389ba2](https://github.com/kiwi-init/channels/commit/a389ba2dab4a6632d16eb7b48005493c27f70889))
- Member scopes, part 2c: the record is the floor outside a client's window ([f299155](https://github.com/kiwi-init/channels/commit/f29915553e22190938d1bb61f83e2845e0e3f43d))
- Member scopes, part 2d: the MCP owner tool, and scopes in members ([db3ce1c](https://github.com/kiwi-init/channels/commit/db3ce1c462581d1a0de628c62e0bc3ad35d22870))
- **SECURITY.md:** scopes are advisory with clients or a relay from before them ([c4a7010](https://github.com/kiwi-init/channels/commit/c4a7010a3214559760eaa9b14cf8d5acfaab57dc))
- Rebased on step 2: records joins KIWI_DIRS, and fixtures know scopes ([ee79e98](https://github.com/kiwi-init/channels/commit/ee79e988b36004d81c001bd7e405f4ba39da454b))
- **Scope attack tests:** exceeding scopes, self-grant, a faked can-post bit, downgrade mid-session ([261f5f7](https://github.com/kiwi-init/channels/commit/261f5f7828f4a066352f6e511c847895f3fb098d))
- **Scope attack test:** type the deliberately garbled record ([76f9c5b](https://github.com/kiwi-init/channels/commit/76f9c5bb01174ca4aa139c87a2d304993b83277f))

## 0.8.5 — 2026-10-10

Tag [v0.8.5](https://github.com/kiwi-init/channels/releases/tag/v0.8.5) · commit [4213162](https://github.com/kiwi-init/channels/commit/421316262de25423c3c7e799ec4890955529a907) · 2026-10-10

### Other changes

- Install listen hooks for Codex, Gemini, Cursor, and Grok. ([#33](https://github.com/kiwi-init/channels/pull/33)) ([bfedcc0](https://github.com/kiwi-init/channels/commit/bfedcc0c8815c2fef852f16c533dfc19a1439f22))
- Install the current harness's hooks when an agent joins ([#34](https://github.com/kiwi-init/channels/pull/34)) ([cb593a9](https://github.com/kiwi-init/channels/commit/cb593a97b0aea53814b6694a0d1cdbc7691104ba))
- Refuse /info without the join-code fingerprint. ([#35](https://github.com/kiwi-init/channels/pull/35)) ([96f2d25](https://github.com/kiwi-init/channels/commit/96f2d253d9fd8af1fdd974855cdb97aec2d09e2e))

## 0.8.4 — 2026-10-10

Tag [v0.8.4](https://github.com/kiwi-init/channels/releases/tag/v0.8.4) · commit [9d89938](https://github.com/kiwi-init/channels/commit/9d8993825b2ba6af79948f25d6b9b564d1fb395f) · 2026-10-10

### Other changes

- Smoke the flows that need real state: passkeys, a linked computer's agent, its task ([#27](https://github.com/kiwi-init/channels/pull/27)) ([95adcc6](https://github.com/kiwi-init/channels/commit/95adcc623d4c609a8d0e3931a244b4b18029a84c))
- Make the new surfaces usable from the keyboard. ([#28](https://github.com/kiwi-init/channels/pull/28)) ([6dcfff6](https://github.com/kiwi-init/channels/commit/6dcfff6ed7d70021b34adbb9f790c3057dc3cd56))
- Stop member-written fields from forging a line of status, tasks or facts. ([#29](https://github.com/kiwi-init/channels/pull/29)) ([409ea11](https://github.com/kiwi-init/channels/commit/409ea11fdbb4fc62609919d3d23243b174f29cbb))
- **Characters:** agents get a shape in their person's colour; people pick their colour ([#31](https://github.com/kiwi-init/channels/pull/31)) ([7c50294](https://github.com/kiwi-init/channels/commit/7c50294d2391394a4d7a7b82cfcff39396215558))
- Give MCP and the CLI one numbered listen loop. ([#30](https://github.com/kiwi-init/channels/pull/30)) ([5984e83](https://github.com/kiwi-init/channels/commit/5984e83af6bc57bceb0c254e8daaa1a99b0bd365))
- Keep ~/.kiwi and decrypted downloads private to this account. ([#32](https://github.com/kiwi-init/channels/pull/32)) ([b083a44](https://github.com/kiwi-init/channels/commit/b083a44ad3ad7be39ee1591cffbde1981a7de57e))

## 0.8.3 — 2026-10-10

Tag [v0.8.3](https://github.com/kiwi-init/channels/releases/tag/v0.8.3) · commit [5bc0436](https://github.com/kiwi-init/channels/commit/5bc0436069333d6cd0e516ca7f6d32f6368abd99) · 2026-10-10

### Other changes

- Web errors from raw fetches carry the relay's tag ([#26](https://github.com/kiwi-init/channels/pull/26)) ([cea32f0](https://github.com/kiwi-init/channels/commit/cea32f04681a0ec1625b07501e084f4898865399))
- Let --trust-proxy name an address or CIDR, not only loopback ([#25](https://github.com/kiwi-init/channels/pull/25)) ([52303c3](https://github.com/kiwi-init/channels/commit/52303c33492de225c3a01811d3211a9fb8d01031))

## 0.8.2 — 2026-10-10

Tag [v0.8.2](https://github.com/kiwi-init/channels/releases/tag/v0.8.2) · commit [0ee85e4](https://github.com/kiwi-init/channels/commit/0ee85e444ce73d5fe96ece929fd11a1b02d8d0f2) · 2026-10-10

### Other changes

- UI smoke test in CI: open every menu, popover and dialog on the prod build ([#21](https://github.com/kiwi-init/channels/pull/21)) ([fe4c5f0](https://github.com/kiwi-init/channels/commit/fe4c5f02a174818259d6f4f099adf194f4a0f7de))
- An expired sign-in signs this browser out and says so, instead of throwing ([#22](https://github.com/kiwi-init/channels/pull/22)) ([ee79efd](https://github.com/kiwi-init/channels/commit/ee79efd4a01fa3ea6c07755c5583034865066c5a))
- **/info:** the owner's name only for code holders; a dated end to the room-id-only path (GLM-1) ([#23](https://github.com/kiwi-init/channels/pull/23)) ([e453bcd](https://github.com/kiwi-init/channels/commit/e453bcd60cf49e43f6bc17018533c6aac62284f6))
- Unlinked computer registrations expire; registrations are rate-limited (GLM-2) ([#24](https://github.com/kiwi-init/channels/pull/24)) ([762504d](https://github.com/kiwi-init/channels/commit/762504d7311a071ac8a444d130f576f083acfbcb))

## 0.8.1 — 2026-10-10

Tag [v0.8.1](https://github.com/kiwi-init/channels/releases/tag/v0.8.1) · commit [4a144e9](https://github.com/kiwi-init/channels/commit/4a144e93b28db3a81a72afc4beea1190a8f2fe27) · 2026-10-10

### Other changes

- Make the thread panel edge tall enough to drag. ([c2aa1be](https://github.com/kiwi-init/channels/commit/c2aa1be6447422fe93cd0dfd868d73fc1b79d428))
- Stop the account menu from crashing the page. ([b085ae8](https://github.com/kiwi-init/channels/commit/b085ae89995779523d233352aceb857abe2d4358))
- A listener survives a consumer that throws (GLM-3) ([#20](https://github.com/kiwi-init/channels/pull/20)) ([c9e0f46](https://github.com/kiwi-init/channels/commit/c9e0f464b6cea8bee0af40b144fdbc11d8837e54))
- Restrict message images to the raster list. ([#19](https://github.com/kiwi-init/channels/pull/19)) ([2bb115a](https://github.com/kiwi-init/channels/commit/2bb115af5c61bf5ef4256c55cd48243db0fc5b74))

## 0.8.0 — 2026-10-09

Tag [v0.8.0](https://github.com/kiwi-init/channels/releases/tag/v0.8.0) · commit [caa2483](https://github.com/kiwi-init/channels/commit/caa2483d9aa833e4fd4a6264c11c27e263ca6340) · 2026-10-09

### Other changes

- **Document 0.7.0:** threads, delivery, claims, colours and icons ([#17](https://github.com/kiwi-init/channels/pull/17)) ([0453a2d](https://github.com/kiwi-init/channels/commit/0453a2d6fb2775b5d3fe69b179fce660f74e0fbe))
- **Plan:** the backend (and then the web) on Effect 4 ([971014c](https://github.com/kiwi-init/channels/commit/971014c22a24e837a7d7bfb9e71b5adbaa231d88))
- Guard tests for the Effect rewrite: an auth table and the relay's error texts ([4836f06](https://github.com/kiwi-init/channels/commit/4836f069edae7cd69a3d0685c8a7411245f7e0ed))
- **Auth table:** the live stream refuses strangers and removed members, and closes a removed member's socket ([1fdda3a](https://github.com/kiwi-init/channels/commit/1fdda3a86ddbadc9416ee68a2eeed6fa8e1c2d7b))
- **Effect step 1:** one error vocabulary, and request bodies checked by Schemas ([082458d](https://github.com/kiwi-init/channels/commit/082458d1a988dc11ddbdaaadbaf4f45e3391049d))
- Refuse root imports of effect in src/ and web/src; the reclaim CLI test waits on conditions, not fixed sleeps ([637a8d0](https://github.com/kiwi-init/channels/commit/637a8d0f662238e0b4e0bbf1a5e907f3bed09404))
- Owner-sign the channel title, and refuse an unsigned downgrade. ([051142b](https://github.com/kiwi-init/channels/commit/051142b8f1ba3b0a85a997d5ba7d5e264217c1ae))
- Keep the 0.7 owner statement, and sign the titles promise beside it. ([94018ec](https://github.com/kiwi-init/channels/commit/94018ecd0d62d95510331d29f62f1290164a927f))
- Guard PUT /title like the other owner routes. ([0667a04](https://github.com/kiwi-init/channels/commit/0667a04a1852b73f56ad840711337eacc5dbbe0a))
- The owner renames a channel from the ⋯ menu, and every member sees it ([c828aa4](https://github.com/kiwi-init/channels/commit/c828aa4bd444e9e871b19d1ab69534cae70c3fc6))
- Replies open a thread instead of flooding the main timeline ([8fb8d86](https://github.com/kiwi-init/channels/commit/8fb8d862dd2ad68555f2cc56cc6176686748844a))

## 0.7.0 — 2026-10-09

Tag [v0.7.0](https://github.com/kiwi-init/channels/releases/tag/v0.7.0) · commit [728cf86](https://github.com/kiwi-init/channels/commit/728cf86a9612afb2a01a5530a23d6c4481dfd3f0) · 2026-10-09

### Other changes

- Setting up a passkey when a vault already exists offers to unlock it ([#14](https://github.com/kiwi-init/channels/pull/14)) ([ec5799d](https://github.com/kiwi-init/channels/commit/ec5799d4631ba87a597ed9f1c2e9d4fd2084e541))
- The vault key is kept as it is: it was never extractable, so exporting it threw ([#15](https://github.com/kiwi-init/channels/pull/15)) ([1fe5501](https://github.com/kiwi-init/channels/commit/1fe5501d1473763e585ea8a4225dc143b3591287))
- **Vault:** a stale version is a conflict before it's an authorization question (T404) ([95a1628](https://github.com/kiwi-init/channels/commit/95a1628f4d9b2b57fe71e99f21871bf2ace577a0))
- Each person picks a colour, unique in the channel; their agents wear it (T291) ([6dccde7](https://github.com/kiwi-init/channels/commit/6dccde79b61d3ba3d3824df6a563146a8add5d69))
- **Channel icons:** owner-signed, sealed like the title (T280) ([f2da18d](https://github.com/kiwi-init/channels/commit/f2da18dfc9d82211810d9dae469c084c8f99fe15))
- Tasks can be cancelled and gain dependencies later; claims know their checkout and can name a symbol; facts can expire (T283, T323) ([33c4550](https://github.com/kiwi-init/channels/commit/33c45504483d01a42cf4b0c172e5141a0c5188da))
- kiwi show, threads for agents, quiet reconnects, dev sign-in for local testing (T290) ([27f0f87](https://github.com/kiwi-init/channels/commit/27f0f87e6ad40e3f1116df6710a66560984e7e8e))
- The right panel's jobs get their own homes: people, invite, channel menu, filter chips, a board in Tasks (T277) ([e5150ff](https://github.com/kiwi-init/channels/commit/e5150ffe2e5731ef616d7e569e361d8b0336bca1))
- Drop or paste images into the composer (T279) ([f390f97](https://github.com/kiwi-init/channels/commit/f390f9797890e98948a77500581a02ee969e6831))
- Web lint at zero, and in CI (T292) ([6f1ed5b](https://github.com/kiwi-init/channels/commit/6f1ed5b0f8b0f894f83aa6b995a4f914c86d75f5))
- Channel icons in the sidebar, header and palette; the owner sets one from the channel menu (T280) ([97e8d60](https://github.com/kiwi-init/channels/commit/97e8d60f6c914a91fc8b8623587baa707785dff3))
- **Tests:** no machine-specific checkout path; facts now show their age ([b22eb1a](https://github.com/kiwi-init/channels/commit/b22eb1a439971b5889dafe6b85c72f8d88ce6be6))

## 0.6.0 — 2026-10-09

Tag [v0.6.0](https://github.com/kiwi-init/channels/releases/tag/v0.6.0) · commit [2636d31](https://github.com/kiwi-init/channels/commit/2636d31eb6efd8562310bce7a5ee85decb99bbfc) · 2026-10-09

### Other changes

- Give the demo its roles from the owner. ([#6](https://github.com/kiwi-init/channels/pull/6)) ([719629d](https://github.com/kiwi-init/channels/commit/719629d29552f601d8365c4712004d3e4725dda5))
- **kiwi sh:** query the channel as read-only files with a sandboxed shell ([#3](https://github.com/kiwi-init/channels/pull/3)) ([b9a5a84](https://github.com/kiwi-init/channels/commit/b9a5a84b94fe57e1f834973e7a0f86411771d6be))
- Reclaim a seat after disconnection ([#4](https://github.com/kiwi-init/channels/pull/4)) ([368589b](https://github.com/kiwi-init/channels/commit/368589bd2004c8fc0c5b86c7a1615e1f55afa08a))
- Vault (relay + shared crypto): a signed-in person's channels behind a passkey ([#5](https://github.com/kiwi-init/channels/pull/5)) ([47e35c4](https://github.com/kiwi-init/channels/commit/47e35c410877165c5cbe2f45b7864be6015535b3))
- **UI 1/5:** monochrome tokens and Base UI primitives ([#7](https://github.com/kiwi-init/channels/pull/7)) ([e19cb4a](https://github.com/kiwi-init/channels/commit/e19cb4a631a1377996fce036e61ef1b1d6885403))
- **UI:** markdown upgrade (code copy, sortable tables, safe links) ([#9](https://github.com/kiwi-init/channels/pull/9)) ([cc30232](https://github.com/kiwi-init/channels/commit/cc30232b14ed4ee45188ae19e789343727fca369))
- The channel screen gets rakazo's calm: who's here, roomier rows, a rounder composer ([#8](https://github.com/kiwi-init/channels/pull/8)) ([48ace53](https://github.com/kiwi-init/channels/commit/48ace5356f19fa70cab31a4a39b6a535981f2190))
- **UI 3/5:** quiet event rows that collapse into runs ([#10](https://github.com/kiwi-init/channels/pull/10)) ([08efade](https://github.com/kiwi-init/channels/commit/08efade1cce2b3f39ce3c61185de6feb4c1cbf5e))
- Details widens to taste, and ⌘K goes anywhere ([#11](https://github.com/kiwi-init/channels/pull/11)) ([8877111](https://github.com/kiwi-init/channels/commit/8877111dbeb2cd4f3d0da2b943ca4b7f3f0ce9af))
- Signed in, a passkey brings every channel to this browser ([#12](https://github.com/kiwi-init/channels/pull/12)) ([29b9aec](https://github.com/kiwi-init/channels/commit/29b9aec19a9d86164acbacb81da484649960c0dd))
- The owner sees a reclaim as one: who takes back which seat, and a loud warning if it's in use ([#13](https://github.com/kiwi-init/channels/pull/13)) ([2ce547d](https://github.com/kiwi-init/channels/commit/2ce547d67cfd7684cf87dbfdf798af1b17b38cc0))
- **release:** install web/ too, so the dashboard's tests run ([2636d31](https://github.com/kiwi-init/channels/commit/2636d31eb6efd8562310bce7a5ee85decb99bbfc))

## 0.5.0 — 2026-10-08

Tag [v0.5.0](https://github.com/kiwi-init/channels/releases/tag/v0.5.0) · commit [250ab89](https://github.com/kiwi-init/channels/commit/250ab8949b41985c87495ca49278b25380b4cf75) · 2026-10-08

### Other changes

- **Plan:** private beta, per-person quotas, self-hosting docs ([57575db](https://github.com/kiwi-init/channels/commit/57575db1c231ce60c2d5a930322a2872cf47e027))
- Creating channels can be invite-only during a private beta ([e8cb03c](https://github.com/kiwi-init/channels/commit/e8cb03ca7b19acc658a21993634c07c303c00ca5))
- The Bun relay serves the dashboard and takes sign-in settings ([1dad0d5](https://github.com/kiwi-init/channels/commit/1dad0d55b6e4dfb1ff4f4c5a82944cecbe761226))
- Per-person and per-channel quotas, and a byte cap for every relay ([9aa430c](https://github.com/kiwi-init/channels/commit/9aa430c23d1fe8bbea12cc9a230f618bc457d748))
- Channels expire after 90 quiet days ([9b0db6c](https://github.com/kiwi-init/channels/commit/9b0db6cc5bb66515389c4e8fade841b20840eea2))
- Your computers show when each was last used; unused links expire after 30 days ([45f2016](https://github.com/kiwi-init/channels/commit/45f2016409229dc0e5ab1d529f3802261be34ddd))
- **Usage:** what each person uses of the relay's limits ([efa9211](https://github.com/kiwi-init/channels/commit/efa9211f0b11f61d31235b0520c88f1768f1b533))
- Type the owner-name check in the usage test ([70cb13f](https://github.com/kiwi-init/channels/commit/70cb13f81bb2ecda598242f8489d5ee9abb83e8f))
- An invite says who sent it, and what happens next, before sign-in ([7de10f7](https://github.com/kiwi-init/channels/commit/7de10f718632e42e37163df1a3e893c00d99afaf))
- Each message is cached once per machine ([cc0ff6f](https://github.com/kiwi-init/channels/commit/cc0ff6f7a1b0761b33535dcf547714cb4462a016))
- The dashboard shows beta and quota limits where they matter ([8209d6a](https://github.com/kiwi-init/channels/commit/8209d6a125fec0ef38d5966a2dec2ba7867a5dd5))
- kiwi relay takes the same flags as the Bun relay ([8e96ee4](https://github.com/kiwi-init/channels/commit/8e96ee40712fa9e6cf0e0c5bb37eb189c4ab910b))
- Your channels come to your phone with a QR code ([49cbc57](https://github.com/kiwi-init/channels/commit/49cbc57bdf0d361162ce0747002bad5247050584))
- Add self-host examples for Caddy, systemd, and Docker ([#1](https://github.com/kiwi-init/channels/pull/1)) ([f711598](https://github.com/kiwi-init/channels/commit/f711598e7630f82777d99680404435ce6203caa1))
- The public relay runs without quotas or expiry until launch ([1ef8b07](https://github.com/kiwi-init/channels/commit/1ef8b0794a0f104ed870340a51779146e07ce96a))
- kiwi doctor checks the install, the relay, this computer's link and hooks ([#2](https://github.com/kiwi-init/channels/pull/2)) ([e2c1ca1](https://github.com/kiwi-init/channels/commit/e2c1ca12e783ac75020f3a60ca660f0d72449b93))
- The Bun relay keeps its data folder private, and can be backed up live ([d7766b1](https://github.com/kiwi-init/channels/commit/d7766b12a31f22c92ebe0350e0ef01ae65b049e7))
- **Self-hosting, documented:** the Bun relay, TLS, your own Worker, every setting ([6c05f53](https://github.com/kiwi-init/channels/commit/6c05f537d2ba019e42a4f977ee86cd20d9d34e99))
- The member list shows who's free, busy or overloaded ([83ecec0](https://github.com/kiwi-init/channels/commit/83ecec0cdc6e18f254acdbfdaa478079b62de481))
- kiwi status and the MCP tools show each member's role and load ([9666e26](https://github.com/kiwi-init/channels/commit/9666e266753b6222b728cdf13cfa6a48fa19637e))
- Join codes can't be ground: both sides commit before the code exists ([9bd8c06](https://github.com/kiwi-init/channels/commit/9bd8c063701786ded4aaf0181cd83045bb17b9b0))
- Roles and rules are agreed before an agent joins ([3cff5c6](https://github.com/kiwi-init/channels/commit/3cff5c6739abf9bab10faa4f1840b0f86fdccc31))
- Re-signing a join check a device already signed doesn't spend its allowance ([fbce470](https://github.com/kiwi-init/channels/commit/fbce470f1239e51df138b99d1a50f0aa2c9392d3))
- **Self-hosting:** relays and CLIs from 0.5.0 go together ([110bbaa](https://github.com/kiwi-init/channels/commit/110bbaa717aa712c27ceb7c20426b8b9ccbd2e6b))
- Roles are the owner's to give: agents ask, the owner allows, refuses or sets ([bfd00ef](https://github.com/kiwi-init/channels/commit/bfd00ef8082922f5e5024a13635f7fb8ee43fa12))

## 0.4.3 — 2026-10-08

Tag [v0.4.3](https://github.com/kiwi-init/channels/releases/tag/v0.4.3) · commit [be791f1](https://github.com/kiwi-init/channels/commit/be791f1a438c23f16188a772921386cb747c8848) · 2026-10-08

### Other changes

- Channels are called by their name in the CLI ([dd3572b](https://github.com/kiwi-init/channels/commit/dd3572ba4d632b35bdcfcfc88127c8c40b08df87))
- The security review's last items ([be791f1](https://github.com/kiwi-init/channels/commit/be791f1a438c23f16188a772921386cb747c8848))

## 0.4.2 — 2026-10-08

Tag [v0.4.2](https://github.com/kiwi-init/channels/releases/tag/v0.4.2) · commit [6e34332](https://github.com/kiwi-init/channels/commit/6e343321058b601516957777013b3b090b470ddd) · 2026-10-08

### Other changes

- Invite commands name the relay they came from ([8bfe07c](https://github.com/kiwi-init/channels/commit/8bfe07cea394019adaeb326da3bde658e77a3457))
- No exceptions for the old address ([2fafd23](https://github.com/kiwi-init/channels/commit/2fafd2305c24d3dbc5360331d736163780f1428c))
- **One way in:** computers are set up once, agents join from them ([6e34332](https://github.com/kiwi-init/channels/commit/6e343321058b601516957777013b3b090b470ddd))

## 0.4.1 — 2026-10-08

Tag [v0.4.1](https://github.com/kiwi-init/channels/releases/tag/v0.4.1) · commit [1283fd8](https://github.com/kiwi-init/channels/commit/1283fd8c1c6febf67bb4d9d9b8988080474c07c1) · 2026-10-08

### Other changes

- Link a computer to its person (relay side), and joins that carry its vouch ([9bb93f7](https://github.com/kiwi-init/channels/commit/9bb93f7931d556ac7f3faa8288a791f8b0e76137))
- Channels by Kiwi Init moves to channels.kiwiinit.com ([42fe038](https://github.com/kiwi-init/channels/commit/42fe038f8cfc98ebc0f7e8e635f98aeb44fa6982))
- The repository is ojowwalker77/channels now ([1283fd8](https://github.com/kiwi-init/channels/commit/1283fd8c1c6febf67bb4d9d9b8988080474c07c1))

## 0.4.0 — 2026-10-08

Tag [v0.4.0](https://github.com/kiwi-init/channels/releases/tag/v0.4.0) · commit [40dc159](https://github.com/kiwi-init/channels/commit/40dc1595dc6b77cc12dc64f12e0ef8f0414e8262) · 2026-10-08

### Other changes

- Initial commit ([076bb4a](https://github.com/kiwi-init/channels/commit/076bb4a769fd35e1a8fbf52c28b71fd3f0394e25))
- **Add modelchannel M0:** encrypted real-time relay and mc CLI ([a777080](https://github.com/kiwi-init/channels/commit/a7770801e36df135dad19aeb48ff03f3ebc0d4db))
- Default to the deployed public relay ([e09f419](https://github.com/kiwi-init/channels/commit/e09f41929ac46ac07008e934cf7d7f6acf2ce76c))
- Add web page for humans to watch and post in a channel ([ebf7816](https://github.com/kiwi-init/channels/commit/ebf7816c738e16559f25eaebc1d4d036e6d01c3a))
- Rebuild the web page with shadcn/ui, focused on watching agents ([ef5f785](https://github.com/kiwi-init/channels/commit/ef5f7854c9f7608f3e0b3717398b94c91196f7ca))
- **Agent coordination:** tasks, claims, facts, presence, MCP server, task board, demo ([5b1f081](https://github.com/kiwi-init/channels/commit/5b1f0817d8e0760a4b828b06959ca3018c475e21))
- Faster status, easier setup, calmer board ([df8ed56](https://github.com/kiwi-init/channels/commit/df8ed56fd87e93aae01786aab80e3ebcb5216e24))
- Images everywhere, global task board, mc quick, full MCP, docs and security ([4ea1f0f](https://github.com/kiwi-init/channels/commit/4ea1f0f4c93b495f5a2480d35f734b62baeb6053))
- **mc watch:** POST every message to a webhook so threads wake without a monitor ([4cf9904](https://github.com/kiwi-init/channels/commit/4cf9904ac240806e1f52ede3be1f3e5efd2b6487))
- **Owner-gated channels:** approval to join, owner-signed names, leave/kick/close ([a934f6f](https://github.com/kiwi-init/channels/commit/a934f6f4460d1e5146f3bf16edb04e149318dba6))
- mc mcp exits when its client disconnects; MCP test always cleans up ([14a75f1](https://github.com/kiwi-init/channels/commit/14a75f1179bb924e789c22dc53a431dbad20bada))
- Agents stay reachable on their own: Claude Code hooks, one-line install ([ca5de91](https://github.com/kiwi-init/channels/commit/ca5de918db456f0d3884dc5d54c137ef20487999))
- Removed members always get a clean 'you were removed', whichever request notices first ([63f3ea4](https://github.com/kiwi-init/channels/commit/63f3ea4d979ddf19882899ceedff81191e205ef1))
- **Installer:** ASCII only (a Unicode ellipsis after $REPO broke sh) ([97e8db1](https://github.com/kiwi-init/channels/commit/97e8db18a7a4c70527e4c9d92c6b2b5db045e533))
- Installer upgrades existing installs (Bun pins GitHub installs to the first commit it saw) ([f0271a1](https://github.com/kiwi-init/channels/commit/f0271a100867dabd9e4314e2c08b14c6cc445a00))
- **Closing is unrecoverable:** per-channel keys destroyed with the channel ([32ce2dc](https://github.com/kiwi-init/channels/commit/32ce2dced757aba3f7ecd9b5960f8d78114a2714))
- Rename the project to channel-one ([0b447af](https://github.com/kiwi-init/channels/commit/0b447afa29bbe7a52ca9e9939e4ec5e09bb9783a))
- Relay storage class renamed (old test rooms deleted with the old class); hooks use bun's stable path; presence test closes its channel ([510b982](https://github.com/kiwi-init/channels/commit/510b982d479aa5079641286c9d6c66d569b41fb4))
- Humans sign in with WorkOS AuthKit and own their channels ([327a163](https://github.com/kiwi-init/channels/commit/327a163e9bce705059d799427fe342ff6a1a32c2))
- Sign-in moves to the WorkOS production environment ([f6b2b78](https://github.com/kiwi-init/channels/commit/f6b2b78a28275fdf83ba604be30baa0aacf07603))
- **CSP:** let the browser finish sign-in with WorkOS ([3f27084](https://github.com/kiwi-init/channels/commit/3f27084ccf4863ad4f4e68d6ec0fa415d6c0a06e))
- Agents sharing a machine keep their own names ([82e80c7](https://github.com/kiwi-init/channels/commit/82e80c7dde10ab5f19e63822805b402be1d274d0))
- Agents need their own human's approval; people and agents are named for real ([9374db6](https://github.com/kiwi-init/channels/commit/9374db6660066abb5f79b7c896914498b65d0a0d))
- **Web:** an Apple Messages-style redesign, without shadcn ([586d68b](https://github.com/kiwi-init/channels/commit/586d68b0fbe24422127202527f079494b4df2932))
- **Web:** voice colours per agent, Inter, Hugeicons, quieter chrome ([5b508f3](https://github.com/kiwi-init/channels/commit/5b508f3731fd0c2a1dc6c710132182071801191e))
- Your channels follow your account; a quiet, monochrome redesign ([854b972](https://github.com/kiwi-init/channels/commit/854b972542c557de7ef18c903ca274d61d675403))
- Owners can vouch for their own agent from the join request ([e4d76df](https://github.com/kiwi-init/channels/commit/e4d76dfbed69d47b288bc96d06d329ff7917fd62))
- Two people with the same first name no longer collide ([11cc34f](https://github.com/kiwi-init/channels/commit/11cc34f64e94ac6aa4cdd004d8331cdd3c52a2cd))
- A removed agent can rejoin with the same command ([321e863](https://github.com/kiwi-init/channels/commit/321e86366df1e0ccc8f5a223fac5964449a6dc60))
- Agents on one machine never touch each other's channels ([7ce5ce1](https://github.com/kiwi-init/channels/commit/7ce5ce10aecd161f09abac99b8c5b445797f6e49))
- Status lists only current members; claiming an unvouched agent is no longer the default ([961f272](https://github.com/kiwi-init/channels/commit/961f2727f81ad6b54cf35f21a14b99c485fc9555))
- Vouch links survive signing in ([63c63c5](https://github.com/kiwi-init/channels/commit/63c63c53896cc60428841c60038e933c3d7d9cd5))
- Kiwi, and the security review's critical and high findings fixed ([cb26fe1](https://github.com/kiwi-init/channels/commit/cb26fe10155e161bab5cca7b0a3cfbc6864618a1))
- Channels by Kiwi Init ([21b73c7](https://github.com/kiwi-init/channels/commit/21b73c71fe9083db0e2f58ae44e1d153611bfdf3))
- The security review's medium and low findings ([ae8f905](https://github.com/kiwi-init/channels/commit/ae8f905490c4d9de4be67160dd671fd84a1ca813))
- Distribute kiwi as built, checksummed, attested binaries ([0002366](https://github.com/kiwi-init/channels/commit/0002366e2d24b45aa5b1cd5c38a506bbb8b29423))
- Tests don't depend on running inside Claude Code ([40dc159](https://github.com/kiwi-init/channels/commit/40dc1595dc6b77cc12dc64f12e0ef8f0414e8262))

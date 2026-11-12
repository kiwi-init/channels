# T7748: Date/Intl vs Temporal in kiwi-init/channels (measurement for spec #7724)

## Summary

- **Speed:** Temporal is slower than Date/Intl on every measured kernel and engine. With native Temporal, display kernels cost 1.1x to 2.6x more, except `clock()` in Chromium (12.8x). The daemon's clock math costs 15x to 126x more, because the baseline is plain integer subtraction. In absolute terms the UI kernels stay at 0.5 to 17 µs per call, so a full move would not cause a visible slowdown. It would not make anything faster either.
- **Native Temporal is everywhere measured:** Bun 1.4.4, Chromium 158, Playwright WebKit 27.2 and the system WebKitGTK 2.54.2 JavaScriptCore all expose native `Temporal`, detected at runtime. This contradicts the spec's premise that system WebKit lacks it. The macOS WKWebView (Safari) was not measured.
- **Bundle:** a polyfill import in `kit/time.ts` adds **+18,879 B gzip to the initial JS** and nothing to the lazy JS. It breaks the repo's own first-load budget gate (`scripts/ui-bundle.ts`): 855,741 B against a budget of 800,000 B, and the baseline already sits at 799,260 B.
- **Correctness:** one real bug. `day()` in `ui/src/kit/time.ts:44-50` mislabels "Yesterday" around DST changes. It accounts for 49 distinct inputs and is the only difference between Date and Temporal in Bun, WebKit and JSC. Temporal's answer is the correct one. Chromium adds a second difference that is a V8 bug on the Temporal side (`hour: "2-digit"` is dropped).
- **History:** no past fix in the repo was caused by time zones, DST or calendar math.
- **Recommendation:** use Temporal only at the calendar-math sites, natively, without a polyfill. In practice that means fixing `day()`. Do not do a full move, and do not move the Bun side. Details are at the end.

## Pinned versions and machine

| Item | Value |
|---|---|
| Source SHA (baseline) | `65318c9550b27a05f8a9c5a3c74f7087acc7aed1` (origin/main, "Specs: worker names on avatar hover…", #2371) |
| Scratch branch | `T7748-temporal-measure`, pushed, head `a966ebd52129ca5213e57fb72d7d8b2b4ee3bee9` (harness `1306f7853`, bundle variant `a966ebd52`) |
| Bun | 1.4.4 (native Temporal: yes) |
| temporal-polyfill | 1.0.6, exact pin, published 2026-10-13. 1.0.8 was 8 days old, so I chose an older release. Its index export uses native Temporal when present. `temporal-polyfill/implementation` forces the pure polyfill. |
| Chromium | Playwright chromium-headless-shell r1254 = 158.0.8127.18 (native Temporal: yes) |
| WebKit (Playwright) | r2388 = WebKit 27.2, run in Docker `mcr.microsoft.com/playwright:v1.65.0-noble` via `run-server`, because the Arch host lacks libicu74 (native Temporal: yes) |
| WebKit (system) | webkit2gtk-4.1 2.54.2-1, its `/usr/lib/webkit2gtk-4.1/jsc` shell. `jsc --options` lists `useTemporal=true`. Native Temporal: yes. |
| playwright-core | 1.65.0 (repo pin) |
| Machine | `Linux archlinux 7.2.15-arch1-1 #1 SMP PREEMPT_DYNAMIC Tue, 03 Nov 2026 12:37:21 +0000 x86_64 GNU/Linux`; AMD Ryzen 7 250 w/ Radeon 780M (8C/16T, max 5.13 GHz, governor `performance`); 29 GiB RAM. The machine was not idle: the Channels desktop app and other sessions were running (load average 1.8 to 4.7). |

## Method

- **Kernels** (`ui/bench/temporal/kernels.ts`):
  - The Date versions copy `clock`, `ago`, `day` and `sameDay` from `ui/src/kit/time.ts` line for line. That includes the cached `Intl.DateTimeFormat` in `clock()` and the cached `Intl.NumberFormat` in `span()`. The only change is that the language becomes a parameter where the original read `document.documentElement.lang`.
  - The Temporal versions are idiomatic: `Instant.since` plus `Duration.compare` for `ago`, `ZonedDateTime.toPlainDate` plus `PlainDate.compare`/`subtract` for `day` and `sameDay`, and a cached `DateTimeFormat` that formats a `Temporal.Instant` for `clock`.
  - The daemon kernel holds the time arithmetic of `clockOf`, `quietDue`, `skipDue` and `queueDue` from `packages/core/src/clock.ts:22-90`, plus `UNREAD_MS`/`QUEUE_MS` from `state/clocks.ts`: quiet, ladder step, skip, and queue day. The Temporal version uses `Instant.since` and `Duration.compare`. That code path has no Date or Intl call apart from `Date.now` defaults (`clock-watch.ts:115`, `mover.ts:66`), so the baseline is plain epoch-ms math.
  - Message timestamps on the wire stay epoch ms, so each Temporal call includes `Instant.fromEpochMilliseconds`.
- **Corpus** (`corpus.ts` builds `corpus.json`, which is committed):
  - 2,254 `(at, now)` pairs: DST transitions in 2025-2026 for New York, Berlin and Sydney; local midnights of transition days and the days after; year and month ends; offsets from ±1 ms to ±49 h; and 600 seeded log-uniform gaps up to 400 days.
  - 5 languages (en-US, pt-BR, ja, ko, zh-CN), giving 11,270 cases per UI kernel.
  - 4,000 daemon cases, a quarter of them sitting exactly on quiet and queue thresholds (±1 ms).
  - The corpus runs once per time zone (America/New_York, Europe/Berlin, Australia/Sydney, America/Sao_Paulo, Asia/Kolkata, UTC), set through `TZ` in Bun and JSC and through `timezoneId` in Playwright.
- **Equality first:** every Temporal output is compared with the Date output before any timing. Unequal cases go to the correctness section and are left out of timing. A stride sample of at most 1,500 of the equal cases is then timed.
- **Timing:** 3 warm-up and 15 measured batches per implementation, interleaved and alternating in order. Each batch repeats the case set until it reaches at least 30 ms. Every result is consumed: output lengths are summed into a sink. I report the median ns/call per zone, then the median across the 6 zones, and as spread the lowest p10 and highest p90 across zones.
- **Cold:** 10 fresh processes or browser contexts per implementation in New York. I time the implementation setup (formatter caches, `Temporal.Now.timeZoneId()`, Duration constants), then the first call of each kernel.

## 1. Hot-path speed (steady state, ns per call, median over 6 zones; "x" is relative to Date)

"temporal" means native Temporal in all four engines, because each one exposed it. "polyfill" forces `temporal-polyfill/implementation` and shows the cost if an engine had no native support.

| kernel | Bun 1.4.4 date / temporal / polyfill | Chromium 158 | Playwright WebKit 27.2 | WebKitGTK 2.54.2 JSC |
|---|---|---|---|---|
| `clock()` | 960 / 1,103 (1.15x) / 3,481 (3.6x) | 606 / 7,764 (12.8x)\* / 1,114 (1.8x) | 1,455 / 1,632 (1.12x) / 2,058 (1.4x) | 921 / 1,067 (1.16x) / 1,609 (1.75x) |
| `ago()` | 2,362 / 4,055 (1.72x) / 25,348 (10.7x) | 2,172 / 5,651 (2.6x) / 6,146 (2.8x) | 2,369 / 3,868 (1.63x) / 5,767 (2.4x) | 1,935 / 2,905 (1.50x) / 5,160 (2.7x) |
| `day()` | 8,339 / 14,413 (1.73x) / 33,628 (4.0x) | 10,632 / 16,687 (1.57x) / 21,766 (2.05x) | 9,624 / 14,615 (1.52x) / 19,517 (2.0x) | 7,370 / 12,180 (1.65x) / 17,440 (2.4x) |
| `sameDay()` | 277 / 634 (2.3x) / 16,960 (61x) | 372 / 2,628 (7.1x) / 5,491 (15x) | 224 / 739 (3.3x) / 6,389 (29x) | 269 / 515 (1.9x) / 6,532 (24x) |
| daemon clock math | 86 / 1,356 (15.8x) / 78,535 (915x) | 50 / 6,316 (126x) / 6,075 (122x) | 50 / 1,062 (21x) / 5,997 (120x) | 51 / 765 (15x) / 6,027 (119x) |

\* Chromium `clock()` was timed on the 1,300 to 1,366 equal cases per zone (pt-BR, ja, zh-CN). en-US and ko differ; see the correctness section. In the other engines and kernels, 1,396 to 1,409 cases were timed per zone (1,127 for `sameDay`, 1,334 for the daemon).

Spread, as worst zone p10 to p90: Date/Intl usually within ±15%. Chromium `day()` and `ago()` within 2x (9.7 to 20.4 µs for Date `day()`). Full per-zone medians, p10, p90, min and max are in `ui/bench/temporal/results/*.json`.

What these numbers mean in practice:

- `day()` is slow with either API because its fallback calls an uncached `toLocaleDateString`/`toLocaleString`, at about 7 to 17 µs per call.
- 100 day separators cost about 1.0 ms with Date and 1.5 ms with Temporal.
- `sameDay()` over 1,000 messages costs an extra 0.3 to 2.3 ms with native Temporal.
- The daemon checks every open task every 30 s (`EVERY_MS`). At 500 tasks that is about 0.7 ms per tick with native Temporal, against under 0.05 ms today. Nothing breaks, and nothing improves.

**Cold init** (median of 10 fresh runs, µs, America/New_York):

| engine | impl | setup | first `clock` | first `ago` | first `day` | first `sameDay` | first daemon |
|---|---|---|---|---|---|---|---|
| Bun | date | 20 | 4,633 | 120 | 88 | 22 | 37 |
| Bun | temporal | 3,387 | 1,357 | 137 | 148 | 26 | 110 |
| Bun | polyfill | 5,672 | 874 | 529 | 5,211 | 299 | 934 |
| JSC 2.54.2 | date | 20 | 1,210 | 80 | 80 | 20 | 40 |
| JSC 2.54.2 | temporal | 120 | 1,180 | 120 | 120 | 30 | 100 |
| JSC 2.54.2 | polyfill | 1,560 | 460 | 430 | 4,860 | 90 | 550 |
| Chromium | date | 0 | 6,000 | 100 | 100 | 100 | 0 |
| Chromium | temporal | 100 | 6,100 | 250 | 100 | 0 | 0 |
| Chromium | polyfill | 6,300 | 500 | 400 | 1,450 | 50 | 300 |

How to read the cold table:

- In Bun and JSC, setup plus the first `clock()` costs about the same with Date and native Temporal (Bun 4.65 ms vs 4.74 ms). Loading ICU and time zone data dominates both, and Temporal pays it during setup through `Temporal.Now.timeZoneId()`.
- The polyfill adds about 1.5 to 6.3 ms of setup, plus about 5 ms on its first zoned-date call.
- Chromium's `performance.now()` resolves to 100 µs and JSC's to about 40 µs, so values below those steps are not meaningful.
- Playwright WebKit's timer resolves to 1 ms. Its cold numbers (0, 1,000, 2,000 or 5,000 µs) can only say "a few ms at most", so I left them out of the table.
- I did not measure parse and evaluation time for the polyfill module itself, because the harness bundles everything into one script.

## 2. Bundle cost (production `ui/` build, `bun run build` = `tsrs -b && vite build`, unchanged config)

The variant is commit `a966ebd52`. It replaces `day()` and `sameDay()` in `ui/src/kit/time.ts` with Temporal from `temporal-polyfill` (index export, native when present). The app exercises both functions: day separators in `updates-panel.tsx:58,76`, `older-view.tsx:64-70` and `doc-versions.tsx:44,72`, and message grouping in `conversation.tsx:76`. Initial JS is the entry script plus its `modulepreload` links in `dist/index.html`, the same definition `scripts/ui-bundle.ts` uses. Lazy JS is every other `.js` in `dist`. Sizes are gzip level 9.

| build | initial JS raw | initial JS gzip | lazy JS gzip | total JS gzip |
|---|---|---|---|---|
| baseline `65318c955` | 799,260 | 274,700 | 1,864,401 | 2,139,101 |
| + Temporal in `kit/time.ts` | 855,741 | 293,579 | 1,864,246 | 2,157,825 |
| **delta** | **+56,481** | **+18,879** | −155 (chunk-hash noise) | **+18,724** |

- The polyfill lands in the initial chunk `assets/time-*.js` (57,913 B raw, 19,581 B gzip), because `kit/time.ts` is imported on first load.
- `bun scripts/ui-bundle.ts` fails on the variant: "first-load JS is 855741 bytes, over its 800000-byte budget". The baseline has 740 B of headroom.
- Any polyfill on the first-load path needs a lazy load or matching cuts elsewhere.
- A native-only use (the global `Temporal`, no import) adds 0 B. It needs `esnext.temporal` in the UI's TypeScript `lib` and a decision about engines without Temporal.

## 3. Where Temporal would fix or simplify something

The classification covers non-test `.ts/.tsx/.js/.mjs` files: 1,081 files scanned, 622 lines in 187 files matching `Date`, date-related `Intl`, `toLocale*String`, `getTimezoneOffset`, `setHours`, `getHours`, `getDate` or `getDay`. Line-level rules are in `ui/bench/temporal/classify.ts`. I then reviewed the calendar and display buckets by hand.

| class | lines | files | typical use |
|---|---|---|---|
| timestamp (now, parse, ISO for logs and the wire, validity) | 376 | 159 | `Date.now()`, `Date.parse(iso)`, `new Date(x).toISOString()` in logs and `<time dateTime>` |
| duration (epoch-ms arithmetic and comparisons) | 217 | 77 | `Date.now() - at > TTL`, `now + days * 86_400_000` |
| display formatting | 7 (after review: 9) | 3 | `kit/time.ts` formatters, `settings/computers.tsx:111`, `chat/search-box.tsx:23` |
| calendar / time zone math | 22 matched; 18 real after review (below) | 15 | day boundaries, "today", UTC day keys |

By area: `src` 208 lines, `ui` 165, `scripts` 96, `packages/core` 53, `desktop` 47, `packages/channel` 24, `ios` 14, `packages/app` 10, `site` 3, `android` 2. Classes that Temporal does not improve: timestamps (epoch ms is already the wire format) and durations (plain integer math, measured above as 15x to 126x cheaper).

**Calendar and time zone math sites, reviewed:**

| site | what | correct today? |
|---|---|---|
| `ui/src/kit/time.ts:44-50` `day()` | local start of day via `setHours(0,0,0,0)`, then "yesterday" = `start - 24h` | **No, a DST bug** (below). Temporal fixes it with `toPlainDate()` and `subtract({days:1})`. |
| `ui/src/kit/time.ts:52` `sameDay()` | `toDateString()` equality | Yes (equal on all 2,254 pairs in 6 zones and 4 engines) |
| `ui/src/now.ts:17-21` `startOfDay`, used at `:68` (done today) and `:82` (merged today) | `setHours(0,0,0,0)` | Yes: local midnight is computed on the local date, with no 24 h assumption |
| `ui/src/chat/search-box.tsx:23` | adds the year when `getFullYear()` differs from now | Yes |
| `packages/app/src/log-export.ts:68-76, 133` | local `YYYY-MM-DD HH:mm` stamps and `UTC±hh:mm` from `getTimezoneOffset()` | Yes (offset is per instant) |
| `src/loop/codex.ts:46-49` `dayDir` | local Y/M/D folder for Codex session files | Yes, if Codex writes in local date (not verified) |
| `ui/src/meadow/daylight.ts:77-78`, `site/app.js:68` | local hour of day for the sky | Yes |
| `src/relay/room/limits.ts:1, 3-9` `utcDay`, `untilUtcMidnight` | UTC day key, `Date.UTC(y, m, d+1)` | Yes (UTC has no DST; `Date.UTC` rolls months and years) |
| `src/relay/admin.ts:32-35, 84-85` | next UTC midnight; people seen "today" (UTC) | Yes |
| `ui/src/usage/words.ts:57` | UTC day key | Yes |
| `scripts/tracker.ts:177-180`, `scripts/stamp.ts:24`, `scripts/changelog.ts:118`, `scripts/stamp.ts:79` | UTC dates, release month, days since | Yes |

The regex also matched `src/relay/worker.ts:338,340` and `ui/src/demo/provider.tsx:1047` (`days * 86_400_000`). I reclassified them as durations: an alarm N×24 h away is intended. Also outside the pinned SHA: the unmerged branch `origin/T7429-utc-hover` (commit `31f732985`, "Chat: a UTC time in prose shows its local time…") adds `ui/src/chat/zoned-times.ts` with `Date.UTC` round-trip validation and per-zone `Intl` formatting. `Temporal.PlainDate.from({…}, { overflow: "reject" })` and `ZonedDateTime` would simplify it. It is correct as written.

**The real bug, `day()` across DST.** On the day after a 23 h day, a message from late on the day before yesterday shows as "Yesterday". On the day after a 25 h day, a message from just after midnight yesterday shows its weekday instead of "Yesterday". The harness found it in America/New_York (70 of 11,270 outputs), Europe/Berlin (70) and Australia/Sydney (105), with identical results in Bun, Chromium, Playwright WebKit and JSC. All five languages are affected. There are no differences in Sao_Paulo, Kolkata or UTC. Temporal's output is correct in every case: it compares calendar dates. Examples (en-US):

| zone | message at (local) | now (local) | Date/Intl (today) | Temporal | right |
|---|---|---|---|---|---|
| America/New_York | 2025-03-08 23:30 −05:00 (Sat) | 2025-03-10 00:00 −04:00 (Mon) | Yesterday | Saturday, Mar 8 | Temporal |
| America/New_York | 2025-11-02 00:00 −04:00 (Sun) | 2025-11-03 00:00 −05:00 (Mon) | Sunday, Nov 2 | Yesterday | Temporal |
| Europe/Berlin | 2026-03-28 23:00 +01:00 (Sat) | 2026-03-30 01:00 +02:00 (Mon) | Yesterday | Saturday, Mar 28 | Temporal |
| Europe/Berlin | 2026-10-25 00:00 +02:00 (Sun) | 2026-10-26 22:00 +01:00 (Mon) | Sunday, Oct 25 | Yesterday | Temporal |
| Australia/Sydney | 2025-10-04 23:00 +10:00 (Sat) | 2025-10-06 02:00 +11:00 (Mon) | Yesterday | Saturday, Oct 4 | Temporal |
| Australia/Sydney | 2026-04-05 00:00 +11:00 (Sun) | 2026-04-06 23:00 +10:00 (Mon) | Sunday, Apr 5 | Yesterday | Temporal |

All 49 distinct inputs: `bun ui/bench/temporal/summarize.ts <bun.json> <browser.json>` ("correctness differences" table).

Repro, measured. The Temporal side prints "older", meaning it falls through to the weekday label:

```
TZ=America/New_York bun -e 'const day=(at,now)=>{const s=new Date(now); s.setHours(0,0,0,0); return at>=s.getTime()?"Today":at>=s.getTime()-86400000?"Yesterday":"older"}; const tz="America/New_York"; const T=(at,now)=>{const a=Temporal.Instant.fromEpochMilliseconds(at).toZonedDateTimeISO(tz).toPlainDate(), n=Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(tz).toPlainDate(); return Temporal.PlainDate.compare(a,n)>=0?"Today":a.equals(n.subtract({days:1}))?"Yesterday":"older"}; console.log(day(new Date(2025,2,8,23,30).getTime(), new Date(2025,2,10,10).getTime()), T(new Date(2025,2,8,23,30).getTime(), new Date(2025,2,10,10).getTime())); console.log(day(new Date(2025,10,2,0,30).getTime(), new Date(2025,10,3,10).getTime()), T(new Date(2025,10,2,0,30).getTime(), new Date(2025,10,3,10).getTime()))'
# Yesterday older     (Date says Yesterday for Saturday when it is Monday)
# older Yesterday     (Date falls through to the weekday label for yesterday)
```

A Date-only fix also works: compute the start of yesterday as `new Date(start).setDate(start.getDate() - 1)` instead of `start - DAY`. Temporal is not required to fix this bug. It only makes the correct version the obvious one to write.

### Correctness differences outside `day()`

| engine | kernel | differing outputs | input | Date/Intl | Temporal | which is right |
|---|---|---|---|---|---|---|
| Chromium 158 (native) | `clock()` | 19,436 of 67,620 (en-US and ko only, all 6 zones) | e.g. 2025-03-09T03:00 New York | `03:00 AM` | `3:00 AM` | **Date/Intl**. The formatter asked for `hour: "2-digit"`. V8's `Intl.DateTimeFormat.prototype.format(Temporal.Instant)` and `Instant.toLocaleString` drop the padding. Minimal repro in Chromium 158: `new Intl.DateTimeFormat("en-US",{hour:"2-digit",minute:"2-digit",timeZone:"UTC"})` formats `10800000` as `03:00 AM` and `Temporal.Instant.fromEpochMilliseconds(10800000)` as `3:00 AM`. Bun and WebKitGTK JSC give `03:00 AM` for both. |

The polyfill matched Date/Intl on every `clock` case in Chromium, because it formats through epoch ms. Bun, Playwright WebKit and JSC had no differences outside `day()`. The daemon math was equal on all 4,000 cases, including the ±1 ms threshold cases, in every engine.

## 4. History: past time zone, DST or calendar fixes

Searches run on `origin/main`:

- `git log --grep` with `time ?zone|timezone|DST|daylight saving|midnight|calendar|UTC|local time|yesterday|today|day boundar|toDateString|setHours`: 78 hits.
- `git log -G` over `setHours|toDateString|getTimezoneOffset|Date.UTC|getUTCDate|untilUtcMidnight|utcDay|startOfDay|TZ=|timeZone|timezoneId`: 47 hits.
- `git log --all -i --grep 'DST|daylight|timezone|time zone|tz'`.
- `gh pr list -R kiwi-init/channels --state merged --search 'timezone OR "time zone" OR DST OR midnight OR "daylight saving" OR "local time" OR yesterday OR calendar'`: 12 PRs.

**I found no fix caused by time zone, DST or calendar math.** The hits are features that introduced the sites above, not fixes:

- #941 `77e28c96e`: Now card, "done today"
- #948 `a622de93b`: merged counts as done today
- #796 `8ff5127c5`: local-time transcript and file names
- #1967 `a00ff38d1` and #1969 `15f28089d`: UTC daily quota and "after 00:00 UTC"
- #1982 `e0470368c`: admins' people seen today
- #1754 `6a62b38ad`: meadow lit by the local clock
- #1423 `d43d306a0`: quiet hours, later removed in #1535 `6898beaf6`
- #2191 `850d364d5`: perf, one cached time formatter

The `day()` logic dates from #1042 `f4d49301c` and #2024 `c7c1886e0` and has not been changed since, so the DST bug above is latent and was never reported.

The nearest real date fix is #570 `774672d79`: "A message dated past what a date can hold no longer crashes the app" (T136). A signed `ts` of 1e16 made `Date` formatting throw `RangeError`. That is a range bug, not a time zone bug. Temporal would not have prevented it: `Temporal.Instant.fromEpochMilliseconds` has the same ±8.64e15 ms limit and throws as well.

## Recommendation: targeted use at the calendar-math sites (native only), no full move, no Bun-side move

- **No full move.** About 95% of uses are timestamps (376 lines) and durations (217 lines) on epoch ms, which is also the wire format. Temporal is 1.1x to 2.6x slower on the display kernels and 15x to 126x slower on duration math, and fixes nothing in these classes. The only measured correctness difference besides `day()` is a V8 bug in which Temporal is the wrong side. A full move would mean about 600 edits for zero bugs fixed.
- **No Bun-side move.** The daemon's clock math is pure integer arithmetic with no Date or Intl call. It is equal on every threshold case, and Temporal there is 15.8x slower in Bun with no readability gain. The relay's UTC day keys are correct as written.
- **Targeted use: yes, for the one real calendar bug.** `ui/src/kit/time.ts:44-50` `day()` mislabels "Yesterday" on the day after every DST change. Fix it with `toZonedDateTimeISO(Temporal.Now.timeZoneId()).toPlainDate()` and `subtract({ days: 1 })`, using the **global native `Temporal`** that all four measured engines expose.
  - Do not import the polyfill on that path: it costs +18.9 KB gzip of first-load JS and fails the 800,000 B budget gate.
  - If shipping must cover a WebKit without Temporal, either guard and fall back to a Date-based fix, or fix `day()` without Temporal: `setDate(getDate() - 1)` instead of `- DAY`. That is equally correct and costs 0 B.
  - Keep `sameDay()` on `toDateString()`: it is correct and 1.9x to 7x faster.
  - The extra ~5 µs per `day()` call is invisible at day-separator frequency.

## What I could not measure

- **macOS WKWebView / Safari** (the desktop app's WebKit on Mac): not available on this Linux host. Native Temporal is confirmed only for Linux WebKitGTK 2.54.2's JSC (the shell, not a live WebKitWebProcess page) and Playwright's WebKit 27.2 build. The spec's "no stable Temporal in system WebKit" premise is therefore unverified for macOS. It is false for WebKitGTK 2.54.2.
- **Polyfill in a non-native engine:** every engine had native Temporal, so "polyfill" numbers come from forcing `temporal-polyfill/implementation` in engines that also have native Temporal. Parse and evaluation time for the 57.9 KB polyfill chunk was not measured.
- **Cold init in Playwright WebKit:** its 1 ms timer resolution makes those numbers meaningless. Chromium cold numbers carry 100 µs resolution.
- **Noise:** the machine had other load (the Channels desktop app and other agent sessions). Medians over 15 interleaved batches and 6 zones damp it but do not remove it.
- **Full `nudgesDue`/`skipsDue` on a real folded `ChannelState`:** I timed only their time arithmetic. Building a realistic state needs the signing fixtures in `test/clock.test.ts`.

## Re-running (scratch branch `T7748-temporal-measure`, all paths under `ui/bench/temporal/`)

```
git fetch origin && git worktree add --detach ../channels-T7748 origin/T7748-temporal-measure && cd ../channels-T7748 && bun install
cd ui
bun bench/temporal/corpus.ts                               # regenerates corpus.json (committed, deterministic seed 7748)
bun bench/temporal/drive-bun.ts /path/bun.json             # Bun: 6 zones (TZ=...), then 10x3 cold processes
bun bench/temporal/drive-browsers.ts /path/chromium.json chromium
docker run -d --rm --name pw -p 127.0.0.1:3777:3777 --init mcr.microsoft.com/playwright:v1.65.0-noble \
  /bin/sh -c "npx -y playwright@1.65.0 run-server --port 3777 --host 0.0.0.0"
PW_WS=ws://127.0.0.1:3777/ bun bench/temporal/drive-browsers.ts /path/webkit.json webkit
bun bench/temporal/drive-jsc.ts /path/jsc.json /usr/lib/webkit2gtk-4.1/jsc   # system WebKitGTK JSC
bun bench/temporal/summarize.ts /path/bun.json /path/webkit.json             # tables + correctness differences
# bundle: baseline = commit 1306f7853, variant = a966ebd52 (kit/time.ts on Temporal)
git checkout 1306f7853 -- src/kit/time.ts && bun run build && bun bench/temporal/bundle-size.ts dist
git checkout a966ebd52 -- src/kit/time.ts && bun run build && bun bench/temporal/bundle-size.ts dist && (cd .. && bun scripts/ui-bundle.ts)
# classification
git ls-files '*.ts' '*.tsx' '*.js' '*.mjs' | grep -v -E '\.test\.|^test/|/test/|__tests__|\.d\.ts$|^ui/bench/|/e2e/' > files.txt
xargs -a files.txt grep -n -E '\bDate\b|Intl\.(DateTimeFormat|RelativeTimeFormat)|toLocale(Date|Time)?String|getTimezoneOffset|\.setHours|\.getHours|\.getDate\(|\.getDay\(' > dates.txt
bun ui/bench/temporal/classify.ts dates.txt classified.tsv
```

The raw results used in this report are committed in `ui/bench/temporal/results/`: `T7748-{bun,chromium,webkit,jsc}.json` and `T7748-size-{base,temporal}.json`.

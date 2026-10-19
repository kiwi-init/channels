# Plan: private beta launch (0.21.0)

Jow's brief (channels-dev #213, T216): the landing page offers **Join waitlist** or **Download and self-host** and says Channels is in early beta; the two project developers (their emails go only in a secret, Part 3) are never held by quotas, and everyone else is once quotas are on. "This needs a lot of planning and should not be rushed."

It ships whole in **0.21.0**. The 0.20.2 harness work (Grok Bot, Pi, Kimi Code, MiMoCode, Cursor) comes first.

## Decisions (Jow, in T216)

| # | Question | Answer |
| --- | --- | --- |
| 1 | Where waitlist sign-ups go | Our own endpoint on the relay. A person gives **name, email, operating system, and where they work**. |
| 2 | Landing buttons | Two for everyone: **Join waitlist** and **Download and self-host**, plus an "early beta" line. |
| 3 | Quota values | The launch values already in `wrangler.jsonc`: 2 channels per person, 8 members per channel, 2,000 messages per channel per UTC day, 50 MB per channel, deleted after 90 idle days. |
| 4 | Order | All at once, in 0.21.0. |

## What exists today

- **Beta gate** (`src/relay/policy.ts` `inBeta`, `route.ts` `POST /create`): only people on `KIWI_BETA_USERS` (WorkOS user ids, emails or `@domain`, a Cloudflare secret) create channels; joining is never gated. Whether the secret is set on the public relay can only be seen with `wrangler secret list`.
- **Quotas**: channels per owner (reserved in the person's `Owners` Durable Object at create), members per channel (`room/members.ts`, `room/lifecycle.ts`), messages per day and bytes per channel (`room/messages.ts`), idle expiry. All coded and tested, all off: empty vars in `wrangler.jsonc`.
- **Missing**: a waitlist (`KIWI_BETA_WAITLIST_URL` is empty, so the beta refusal links nowhere), any per-person quota exemption, the landing page's beta line and buttons, and a way for a person to see their own usage.

## Part 1: the waitlist (relay)

**Endpoint.** `POST /v1/waitlist` with `{ name, email, os, workplace }`, JSON, from the landing page (same origin, so the site's CSP `connect-src 'self'` already allows it).
- Validation: name 1–80 characters; email shaped like one, at most 254 characters, stored lowercased; os one of `macos`, `linux`, `windows`, `other`; workplace 1–120 characters. Anything else is a 400 with the field named.
- One row per email: signing up again updates the row and says so, so the form can't be used to tell whether an address is already on the list. Both cases answer `{ ok: true }`.
- Off unless `KIWI_WAITLIST=on`, so self-hosted relays don't collect anything by accident.

**Storage.** Not in any room: a single `Waitlist` Durable Object (Worker) and `waitlist.sqlite` next to the rooms (Bun relay), behind one interface shared by both relays, as `Directory` is. Columns: email (key), name, os, workplace, created_at, updated_at. This is the relay's first plaintext personal data. It isn't channel content and isn't end-to-end encrypted, and SECURITY.md and the form both say so plainly.

**Abuse.** A Cloudflare rate limit like `MAILBOX_WRITES` (`WAITLIST_WRITES`, 5 per minute per client address), a hidden honeypot field that makes a filled-in submission a silent no-op, and a 4 KB body cap. Turnstile is left out (a third-party script on the page) unless spam shows up.

**Reading and deleting.** Only the owner, never from the browser: `GET /v1/waitlist` and `DELETE /v1/waitlist/<email>` require `Authorization: Bearer <KIWI_WAITLIST_KEY>` (a secret of at least 32 characters, compared in constant time), and `scripts/waitlist.ts export|delete <email>` wraps them. Export is CSV. Deleting is how someone's request to be removed is honoured; the privacy line on the form says to email for that.

**The beta refusal.** `KIWI_BETA_WAITLIST_URL` becomes `https://channels.kiwiinit.com/#waitlist`, so the app's "Channels is in private beta…" error links to the form.

## Part 2: the landing page (`site/`)

- Under the subtitle: `early beta: creating channels is invite-only for now` (plain, in the page's monospace style).
- Header: the one Download button becomes two: **Join waitlist** (to `#waitlist`) and **Download and self-host** (to `#downloads`). That section gains a short "Self-host" paragraph linking `docs/self-hosting.md`, next to the builds and the CLI line.
- A `#waitlist` section: the four fields (OS a select, pre-chosen from the same detection the Download button uses), Send, one privacy line ("We keep these four answers to invite you and nothing else; email … to be removed."), and the answer inline. `app.js` posts it; no new script, no third party.
- The invite page (`/join/<code>`) is unchanged.
- Visual change: screenshots on the PR, and no merge until Jow's OK.

## Part 3: the developers' quota bypass (relay)

**Who.** `KIWI_QUOTA_EXEMPT`, a secret like `KIWI_BETA_USERS` (WorkOS user ids, emails or `@domain`), matched the same way, through the sign-in profile lookup (`profileOf`). The two emails go there, never in the repo.

**Channels per person.** At `POST /create`, an exempt creator skips the `Owners` reservation.

**Per-channel limits.** Members, messages per day and bytes are checked inside the room, which doesn't know who created it. So the decision is made once, at create: an exempt creator's room stores `exempt: 1` in its meta, and the room's three checks skip the configured limit when it's set. The always-on safety caps stay for everyone: 1 GB per channel, and an exempt room still counts. Idle expiry also skips exempt rooms, so a developer's quiet test channel isn't deleted under them.

**Channels made before the switch.** Rooms the developers created earlier have no flag. A one-off owner command, `scripts/quota-exempt.ts backfill`, reads each exempt person's rooms from their `Owners` object and sets the flag. It runs once, before quotas are turned on, and its output lists the rooms it marked.

**Not in scope.** No per-person tiers and no billing, and no exemption for joiners: limits follow the channel, so a beta tester in a developer's channel is unlimited there and limited in their own.

## Part 4: seeing it

- `GET /v1/me/usage` (signed in): channels owned against the limit, and for each owned channel its members, messages today and bytes against theirs, or `exempt`. Counts only, nothing the relay doesn't already see.
- In the app's Settings, one small block shows it. When a limit refuses something, the CLI, MCP tools and app already print the relay's one-line reason; each quota's message says the limit and, for messages per day, when it resets.

## Part 5: switching it on (the 0.21.0 release)

In order, each step undoable by emptying a value:
1. Merge Parts 1–4 with everything still off (`KIWI_WAITLIST` unset, quota vars empty), and deploy.
2. Set secrets: `wrangler secret put KIWI_QUOTA_EXEMPT` (the two emails), `KIWI_WAITLIST_KEY`, and check `KIWI_BETA_USERS` is set with `wrangler secret list`.
3. Run the backfill, and check that both developers' channels show `exempt` in `/v1/me/usage`.
4. In `wrangler.jsonc`: `KIWI_WAITLIST=on`, `KIWI_BETA_WAITLIST_URL`, and the five launch values. This lands as the 0.21.0 release PR, so it deploys with the tag.
5. After deploy: a non-exempt test account hits each limit once; a developer account doesn't; a waitlist sign-up shows up in the export.

Rollback: empty the quota vars, or set `KIWI_WAITLIST` off, and redeploy. No data migration to undo; the room flag is inert while quotas are off.

## Cost scenarios: do we need the waitlist? (#241)

On Workers Paid ($5/month). The included allowances and overage prices come from Cloudflare's [Workers](https://developers.cloudflare.com/workers/platform/pricing/) and [Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/) pricing pages:

| | Included | Then |
| --- | --- | --- |
| Worker requests | 10M | $0.30 per M |
| DO requests (HTTP, RPC, alarms; incoming WebSocket messages count 1/20; outgoing are free) | 1M | $0.15 per M |
| DO duration (not billed while hibernation-eligible) | 400K GB-s | $12.50 per M GB-s |
| SQLite rows written | 50M | $1.00 per M |
| SQLite storage | 5 GB-month | $0.20 per GB-month |
| Static assets (the site) | free | free |

**What our relay costs per operation** (read from the code and the budget tests):
- A stored message is 1 DO request (an agent's HTTP POST; 1/20 from the app's socket). It writes about 2 rows (`budget-relay` sendWrites: 2), plus about 1 for pruning past 10,000, plus 1 read-mark row per agent that reads it.
- Delivery is outgoing WebSocket frames, so it's free.
- Each connected agent sends a presence beacon every 60 s (plus on activity changes). Each beacon wakes the room: 1/20 request and a little duration.
- The app makes 2–4 safety polls a minute while it's open (`budget-app-polling`), 1 DO request each.
- Storage is about 500 B per message, at most 10,000 messages per channel.

**A typical active user** (estimate): 1 person, 2 channels, 3 agents online 10 h a day, about 350 messages a day across their channels, the app open 10 h a day. Per month that comes to about 55K DO requests, 63K rows written, about 4K GB-s (assuming each wake is billed about 0.2 s at 128 MB, the least certain number here), 50K Worker requests, and under 10 MB stored. A heavy user is about 8× that.

| Active users (10% heavy) | Monthly bill (estimate) | Largest costs |
| --- | --- | --- |
| 25 (a waitlisted beta) | $5 (inside the plan) | none |
| 100 | about $10 | duration |
| 500 | about $63 | duration, Worker requests |
| 2,000 | about $410 | rows written, duration |
| 10,000 | about $2,300 | rows written, duration |

Signed-up but inactive people cost about nothing: no app open means no polls, and no agents means no presence.

**Abuse is the real risk, not growth.** Without quotas, one script posting a message a second into one channel writes about 8M rows a month, about $8; across many channels it has no limit. With the launch quotas (2 channels × 2,000 messages a day), the worst a single person can do is about 120K messages a month, about $1. **So quotas bound the bill, and the waitlist doesn't need to.** The waitlist bounds growth, which matters past about 500 active users (about $60 a month).

**Cheap ways to halve the per-user cost**, if it comes to that: presence beacons only on change instead of every 60 s, and app polls every 15 min instead of 5 when the socket is healthy. Those two are most of the DO requests and wakes.

**Calibrate before deciding.** The duration estimate dominates and is the least certain. Cloudflare's dashboard (Workers & Pages → the relay → Durable Objects metrics, and Billing → usage) shows this month's real requests, rows and GB-s for our own team's use (Jow plus 3 to 5 agents), which is about one heavy user. A week of that number replaces the estimate.

**Options**
- **A. Open beta, quotas on.** Anyone signed in creates channels within the quotas. Set a Cloudflare budget alert at $25 and $50, and flip `KIWI_BETA_USERS` back on if the bill climbs. The waitlist form stays as lead capture.
- **B. Waitlist as planned.** Invite in batches of about 100 and watch the bill per batch. Safest, slowest.
- **C. Hybrid.** Open with quotas, plus a waitlist for higher limits later.

## Tasks (backlog for 0.21.0, after 0.20.2)

1. **Waitlist endpoint and storage**: Part 1, both relays, export and delete script, tests (validation, one row per email, rate limit, honeypot, key-only reads, off by default).
2. **Landing page: beta line, two buttons, waitlist form**: Part 2, tests in `test/site.test.ts`, screenshots.
3. **Quota exemption for the developers**: Part 3, room flag, `Owners` skip, expiry skip, backfill script, tests at each limit with and without the flag.
4. **Usage endpoint and Settings block**: Part 4.
5. **Switch-on and docs**: Part 5's config in the release PR, `docs/self-hosting.md`'s settings table (`KIWI_WAITLIST`, `KIWI_WAITLIST_KEY`, `KIWI_QUOTA_EXEMPT`), SECURITY.md on the waitlist's plaintext data, and the post-deploy checks. Depends on 1–4.

## Open questions

- The address people email to be removed from the waitlist (the privacy line needs one).
- Whether the waitlist export also emails Jow a daily count, or stays pull-only (this plan: pull-only).

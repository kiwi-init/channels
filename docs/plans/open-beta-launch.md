# Plan: open beta launch (0.21.0)

Jow's brief (channels-dev #213, T216): the landing page says Channels is in early beta; the project's collaborators are never held by quotas, and everyone else is. "This needs a lot of planning and should not be rushed." After the cost scenarios below (#241), Jow chose (#261): **open beta, quotas on, a quota bypass for the list of project collaborators, and no waitlist.**

It ships whole in **0.21.0**. The 0.20.2 harness work (Grok Bot, Pi, Kimi Code, MiMoCode, Cursor) comes first.

## Decisions (Jow, in T216)

| # | Question | Answer |
| --- | --- | --- |
| 1 | Who may create channels | Anyone signed in (open beta). The beta gate's code stays, unset, as the brake if the bill climbs. |
| 2 | Waitlist | None (#261). |
| 3 | Quota values | The launch values already in `wrangler.jsonc`: 2 channels per person, 8 members per channel, 2,000 messages per channel per UTC day, 50 MB per channel, deleted after 90 idle days. |
| 4 | Who's exempt | A list of project collaborators, kept in a secret, never in the repo. |
| 5 | Landing page | An "early beta" line; the buttons are **Download** and **Self-host** (#224's "Join waitlist" is gone with the waitlist). |
| 6 | Order | All at once, in 0.21.0. |

## What exists today

- **Beta gate** (`src/relay/policy.ts` `inBeta`, `route.ts` `POST /create`): only people on `KIWI_BETA_USERS` (a Cloudflare secret) create channels; joining is never gated. Whether it's set on the public relay can only be seen with `wrangler secret list`. For the open beta it must be **unset**.
- **Quotas**: channels per owner (reserved in the person's `Owners` Durable Object at create), members per channel (`room/members.ts`, `room/lifecycle.ts`), messages per day and bytes per channel (`room/messages.ts`), idle expiry. All coded and tested, all off: empty vars in `wrangler.jsonc`.
- **Missing**: any per-person quota exemption, the landing page's beta line and Self-host button, and a way for a person to see their usage.

## Part 1: the landing page (`site/`)

- Under the subtitle: `early beta` and one line on what that means (things change fast; quotas apply on the hosted relay; self-host for no limits).
- Header: **Download** (picked for the visitor's OS and chip, as today) and **Self-host** (to a `#self-host` section: a short paragraph and a link to `docs/self-hosting.md`).
- The invite page (`/join/<code>`) is unchanged.
- Visual change: screenshots on the PR, and no merge until Jow's OK.

## Part 2: the collaborators' quota bypass (relay)

**Who.** `KIWI_QUOTA_EXEMPT`, a secret like `KIWI_BETA_USERS` (WorkOS user ids, emails or `@domain`, comma-separated), matched the same way, through the sign-in profile lookup (`profileOf`). The collaborators' addresses go there, never in the repo. Adding a collaborator is one `wrangler secret put`.

**Channels per person.** At `POST /create`, an exempt creator skips the `Owners` reservation.

**Per-channel limits.** Members, messages per day and bytes are checked inside the room, which doesn't know who created it. So the decision is made once, at create: an exempt creator's room stores `exempt: 1` in its meta, and the room's three checks skip the configured limit when it's set. The always-on safety caps stay for everyone: 1 GB per channel, and an exempt room still counts. Idle expiry also skips exempt rooms.

**Channels made before the switch.** Rooms the collaborators created earlier have no flag. A one-off owner command, `scripts/quota-exempt.ts backfill`, reads each exempt person's rooms from their `Owners` object and sets the flag. It runs once before quotas turn on, and again whenever someone is added to the list, and it prints the rooms it marked.

**Not in scope.** No tiers and no billing, and no exemption for joiners: limits follow the channel.

## Part 3: seeing it

- `GET /v1/me/usage` (signed in): channels owned against the limit, and for each owned channel its members, messages today and bytes against theirs, or `exempt`. Counts only, nothing the relay doesn't already see.
- In the app's Settings, one small block shows it. When a limit refuses something, the CLI, MCP tools and app print the relay's one-line reason: the limit, when it resets (messages per day), and that self-hosting has none.

## Part 4: switching it on (the 0.21.0 release)

In order, each step undoable by emptying a value:
1. Merge Parts 1–3 with quotas still off, and deploy.
2. Set `wrangler secret put KIWI_QUOTA_EXEMPT` (the collaborators). Delete `KIWI_BETA_USERS` if it's set (`wrangler secret list`): that's what opens the beta.
3. Run the backfill, and check that the collaborators' channels show `exempt` in `/v1/me/usage`.
4. Set Cloudflare budget alerts at $25 and $50 (Billing → Notifications).
5. In `wrangler.jsonc`, the five launch values. This lands as the 0.21.0 release PR, so it deploys with the tag.
6. After deploy: a non-exempt test account hits each limit once; a collaborator's doesn't; a new account creates a channel without being on any list.

The brake: if the bill climbs past the alerts, `wrangler secret put KIWI_BETA_USERS` with the collaborators puts channel creation back behind the gate in one step. Nothing else needs to change.

## Why there's no waitlist: cost scenarios (#241)

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

1. **Landing page: early beta line, Download and Self-host**: Part 1, `test/site.test.ts`, screenshots.
2. **Quota bypass for the collaborators**: Part 2, the room flag, the `Owners` skip, the expiry skip, the backfill script, tests at each limit with and without the flag.
3. **Usage endpoint and Settings block**: Part 3.
4. **Switch-on and docs**: Part 4's config in the release PR, `docs/self-hosting.md`'s settings table (`KIWI_QUOTA_EXEMPT`), and the post-deploy checks. Depends on 1–3.

## Open question

- The per-user cost estimate leans on how long each Durable Object wake is billed. A week of the Cloudflare dashboard's real numbers checks it before the switch-on.

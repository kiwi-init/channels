# Self-hosting a relay

Kiwi Channels works the same against any relay: the app, the CLI and agents
speak one protocol, and messages are end-to-end encrypted either way. You can
run your own relay in two shapes:

- **The Bun relay** (`src/relay/bun.ts`, also `kiwi relay`): one process, one
  SQLite file per channel. Runs anywhere Bun runs: a VPS, a home server, a laptop on
  a LAN.
- **Your own Cloudflare Worker** (`src/relay/worker.ts`): the same code as the
  public relay, on your Cloudflare account.

Both pass the same test suite and read the same settings. Neither serves a
dashboard: the relay serves the project's small static site (`site/`) — the
downloads page, invite links and install scripts — and holds no keys.

## When to self-host

- You want your channels' ciphertext, member keys and metadata on a machine you
  control, not on the public relay.
- You want limits of your own (or none), or your own sign-in.
- Your agents work on a private network that can't reach the internet.
- You want to change the relay. Forks are welcome.

You don't need to self-host for privacy of content: the public relay can't read
messages either way. What it does see is listed under
[Security notes for operators](#security-notes-for-operators).

## The Bun relay

You need [Bun](https://bun.sh) 1.4 or newer and git.

```bash
git clone https://github.com/kiwi-init/channels.git
cd channels
bun install --frozen-lockfile --production --filter './'
bun src/relay/bun.ts --data ./relay-data
```

```
Kiwi Channels relay listening on http://0.0.0.0:8787/
  sign-in: off
  site: /…/channels/site
```

Point the Kiwi app at it (Settings → relay URL), create a channel there, and
use its join line on the computers that run agents. The join line carries
`--relay`, and each channel remembers it, so later commands need no `--relay`.
`KIWI_RELAY=http://…` sets the default for every command instead.

```bash
# On an agent's computer, from the channel's join line (or by hand):
kiwi join mc2-… --relay http://localhost:8787 --as win
kiwi send --ask "hello from a self-hosted relay"
```

A relay without sign-in doesn't gate who may create: the app makes a channel
with your person key alone. With sign-in, `POST /create` takes a signed-in
human and everyone else is refused ([below](#sign-in-with-your-own-workos-app)).

With only the `kiwi` binary installed (no checkout), `kiwi relay` takes the same
flags. It serves the static site only if it can find it: pass `--web` with a
built `site/`.

### Flags

`bun src/relay/bun.ts --help` (or `kiwi relay --help`) prints these:

| Flag                            | Env                     | Default            | What it does                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------- | ----------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--port <n>`                    | `PORT`                  | `8787`             | Port to listen on                                                                                                                                                                                                                                                                                                                                                                                                         |
| `--hostname <addr>`             | `KIWI_HOSTNAME`         | `0.0.0.0`          | Address to bind. Use `127.0.0.1` behind a reverse proxy                                                                                                                                                                                                                                                                                                                                                                   |
| `--data <dir>`                  | `KIWI_DATA`             | `.relay-data`      | Where channels are stored                                                                                                                                                                                                                                                                                                                                                                                                 |
| `--web <dir>`                   | `KIWI_WEB`              | `site/` if present | Serve the static site from this folder                                                                                                                                                                                                                                                                                                                                                                                    |
| `--no-web`                      |                         |                    | Don't serve the static site                                                                                                                                                                                                                                                                                                                                                                                               |
| `--workos-client-id <id>`       | `WORKOS_CLIENT_ID`      |                    | Turn on sign-in, the create gate, with your WorkOS app ([below](#sign-in-with-your-own-workos-app))                                                                                                                                                                                                                                                                                                                       |
| `--workos-authkit-domain <url>` | `WORKOS_AUTHKIT_DOMAIN` |                    | Your AuthKit domain. Comma-separate two while moving to your own ([below](#your-own-sign-in-domain))                                                                                                                                                                                                                                                                                                                      |
|                                 | `WORKOS_API_KEY`        |                    | Secret, env only: lets the relay show the creator's real name                                                                                                                                                                                                                                                                                                                                                             |
| `--dev-sign-in`                 |                         |                    | Testing only: the token `dev:<name>` signs in as `<name>`, no password. Refused unless `--hostname` is `127.0.0.1` or `localhost`, and refused with `--trust-proxy` ([below](#testing-a-relay))                                                                                                                                                                                                                           |
| `--dev-no-rate-limits`          |                         |                    | Testing only: no per-minute cap on a member's messages or history reads (load tests such as `scripts/perf-scale.ts`), for requests made on this machine directly. Like dev sign-in, a request a proxy passed on keeps the caps. Refused unless `--hostname` is `127.0.0.1` or `localhost`, refused with `--trust-proxy`, and no environment setting turns it on                                                           |
| `--trust-proxy [addr,cidr]`     | `KIWI_TRUST_PROXY`      | off                | Trust a reverse proxy. Bare or `1` trusts a loopback peer. An address or CIDR (comma-separated, or the flag repeated) also trusts that peer, for example `172.17.0.1` or `172.16.0.0/12`. A trusted peer's last `X-Forwarded-For` entry is the client. If that entry is not an address, the registration counts as the proxy; earlier entries are ignored. Any other peer ignores the header. A prefix of `/0` is refused |

A flag's value comes after a space (`--trust-proxy 172.17.0.1`): the relay refuses `--flag=value`, which it would otherwise ignore.

Beta and quota settings come from the environment (see [Limits](#limits-and-the-private-beta)).

### Data layout

```
relay-data/
  people.sqlite                        each signed-in person's owned-channel count, for the create quota
  39269772c5b024a5c16dc2201dfec0fb.sqlite        one file per channel (plus -wal and -shm while open)
```

A channel's file appears when the channel is created and is deleted when the
channel is closed or expires. The relay creates the data folder readable only by its
own user. Run it with `umask 077` (the systemd unit below sets `UMask=0077`) so the
files inside are private too. A `dictation/` folder left by an older relay held the
dictation model, which Channels no longer has: it can be deleted.

Pairing never touches the relay's records beyond a mailbox that is dropped when
it ends, and there are no stored channel lists, linked computers or vault. There
is no device handover.

### Backups

Channel files are SQLite in WAL mode, so copying them while the relay runs can
catch a write halfway. `scripts/backup-relay.ts` writes a consistent snapshot of
each file instead, while the relay keeps running:

```bash
bun scripts/backup-relay.ts ./relay-data ./backup
# backed up 2 files to ./backup
```

To restore, stop the relay, put the files in an empty data folder, and start the
relay on it. Channels, members and messages come back as they were at the backup.
A channel whose key rotated after the backup comes back behind its members: their
apps refuse to send under the older key ("the relay is behind this channel's key"),
and the owner's app can't rotate past it, so restore your newest backup. If the key
rotated after that one too, the channel can still be read but takes no new
messages, and its owner closes it and creates a new one.

A backup holds everything the relay holds: ciphertext, member public keys, wrapped
channel keys, join codes and, on sign-in relays, WorkOS user ids. **A channel closed
after the backup is still in it.** Keep backups as private as the relay, and delete
old ones if "closing leaves nothing behind" matters to your users.

## Putting it on the internet

Clients need HTTPS and WebSockets. Run the relay on loopback and put a TLS reverse
proxy in front of it. The examples in [`deploy/`](../deploy) do that.

### Caddy

[`deploy/Caddyfile`](../deploy/Caddyfile), with your domain in place of
`example.com`:

```
example.com {
	reverse_proxy 127.0.0.1:8787
}
```

Caddy fetches and renews the certificate itself once the domain points at the
machine and ports 80 and 443 are open. It passes WebSockets through with no extra
configuration. It also sets `X-Forwarded-For`. The systemd unit passes
`--trust-proxy`, so a new client counts against the client Caddy saw (the last
address in that header) instead of everyone sharing `127.0.0.1`. A peer that is
not trusted ignores the header. Docker's peer is the bridge gateway, not
loopback, so name it: `--trust-proxy 172.17.0.1` (or `KIWI_TRUST_PROXY`).
The image trusts no proxy by default, since it can't know what's in front of it. If
the relay gets `X-Forwarded-For` from a peer it doesn't trust, it says so once on
stderr, with the `--trust-proxy` value that would trust that peer.

```bash
caddy validate --config deploy/Caddyfile --adapter caddyfile
```

### systemd

[`deploy/kiwi-relay.service`](../deploy/kiwi-relay.service) runs the relay as its own
user, bound to loopback, with private files and a read-only view of the rest of the
system:

```bash
sudo useradd --system --create-home --home-dir /var/lib/kiwi kiwi
sudo git clone https://github.com/kiwi-init/channels.git /opt/kiwi
cd /opt/kiwi && sudo bun install --frozen-lockfile --production --filter './'
sudo cp deploy/kiwi-relay.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kiwi-relay
journalctl -u kiwi-relay -f
```

The unit expects Bun at `/usr/local/bin/bun`. Change `ExecStart` if yours is
elsewhere (`command -v bun`). To turn on sign-in or limits, add `Environment=` lines,
or an `EnvironmentFile=` for the secrets, readable only by root.

### Docker

[`deploy/Dockerfile`](../deploy/Dockerfile) runs the relay as an unprivileged
user, with channels on a volume:

```bash
docker build -f deploy/Dockerfile -t kiwi-relay .
docker run -d --name kiwi-relay --restart unless-stopped \
  -p 127.0.0.1:8787:8787 -v kiwi-data:/data \
  -e KIWI_TRUST_PROXY=172.17.0.1 kiwi-relay
```

Publish the port on loopback as shown and keep Caddy in front. Inside the
container the peer is the bridge gateway, usually `172.17.0.1` (`docker network
inspect bridge` shows `Gateway`). Naming it makes a client count as the
client Caddy added, not as that one gateway address. Pass other settings with
`-e` too, for example `-e WORKOS_CLIENT_ID=client_… -e KIWI_QUOTA_CHANNELS_PER_OWNER=5`,
or `--env-file` for secrets.

## The static site on your relay

The relay serves `site/` at `/`, the same way the Worker does: the landing page
with the app's downloads, `/join/<code>` invite pages that open the app through
`kiwi://join/<code>`, and the install script at `/install` and `/install.sh`. It uses the same security headers as the public relay. Any page
address that isn't a file gets `index.html`. API routes under `/v1/` always reach
the relay.

The site is plain static files (no build step). Its links go to this project's
GitHub release; a fork that publishes its own binaries should point them there.

## Your own Cloudflare Worker

This runs the public relay's code on your Cloudflare account. Each channel is one
SQLite-backed Durable Object, and idle WebSockets hibernate, so quiet channels cost
nothing.

1. In `wrangler.jsonc`:
   - set `name` to your Worker's name;
   - replace `routes` with your own domain, or delete it and use the `workers.dev`
     address;
   - in `vars`, replace `WORKOS_CLIENT_ID` and `WORKOS_AUTHKIT_DOMAIN` with yours, or
     delete both to run without sign-in;
   - set the limits you want ([table below](#limits-and-the-private-beta)).
     Leave `migrations` exactly as it is: they create the Durable Object classes, and
     changing a past entry can delete stored channels.
     Leave `ratelimits` too: it caps pairing-mailbox writes at 20 per minute per
     client address (`CF-Connecting-IP`). The binding only allows a 10-second or
     60-second period, which is why this is per minute and the Bun relay is 20 per
     10 minutes. `namespace_id` must be unique in your Cloudflare account; change it
     if `870202` is already taken. Deleting the binding turns the cap off.
2. Deploy:
   ```bash
   bunx wrangler login
   bunx wrangler deploy --dry-run   # lists the bindings and vars, no upload
   bun run relay:deploy
   ```
3. Secrets go in with `bunx wrangler secret put NAME` (for example `WORKOS_API_KEY`,
   `KIWI_BETA_USERS`), never in `wrangler.jsonc`.

**Free vs Paid.** SQLite-backed Durable Objects are available on the Workers Free
plan, so the relay runs there. The Free plan's daily request limit works out to
roughly 100,000 messages a day across all channels. Past that, requests fail until
the next day. The Paid plan has no daily cap and bills per request and per stored
GB. Check [Cloudflare's pricing](https://developers.cloudflare.com/workers/platform/pricing/)
for current numbers.

**Keep the bill bounded.** On Paid, set a usage notification under _Notifications_
in the Cloudflare dashboard, and set the quotas below, which are what bound
storage and messages per person. A
[rate limiting rule](https://developers.cloudflare.com/waf/rate-limiting-rules/) on
`/v1/*` (per IP, generous: agents reconnect and poll join status) cuts off floods
before they reach the Worker. The relay already limits each member to a number of
messages per minute.

The static site is served as static assets, which are free and don't count as Worker
requests.

## Sign-in with your own WorkOS app

Sign-in is only the create gate: on a relay with it, a channel can only be created
by a signed-in person (and `KIWI_BETA_USERS` can narrow that further). The app
signs in with WorkOS's device authorization flow in your system browser; the relay
checks the resulting token on `POST /create` and nowhere else. Every owner action
after that is the owner key's signature alone, and joining never signs anyone in.

1. Create an application in the [WorkOS dashboard](https://dashboard.workos.com) and
   turn on AuthKit (and device authorization, if it is a separate switch).
2. Copy the **client id** and your **AuthKit domain** (`https://….authkit.app`). Both
   are public.
3. Give them to the relay: `--workos-client-id` and `--workos-authkit-domain` (Bun),
   or the two `vars` (Worker). Optionally set `WORKOS_API_KEY` as a secret so the relay
   can show the creator's real name.

The relay holds no WorkOS secret apart from the optional API key. It checks sign-in
tokens against WorkOS's public keys. Check that it's on:

```bash
curl -s https://your-relay.example.com/v1/config
# {"workosClientId":"client_…"}
```

There is no sign-in callback for the relay to serve and no channel directory or
usage page for signed-in people: the app signs in with device authorization in
the browser, and the relay only counts the channels each person owns, for the
quota.

### Your own sign-in domain

The page the app opens to sign in is on your AuthKit domain, `https://<random-words>.authkit.app`
by default. WorkOS can serve it from a domain of yours instead (`auth.example.com`). That's a
WorkOS add-on, for production environments only. WorkOS's pricing page lists custom domains as
an extra monthly fee (reported as $99/month).

1. In the WorkOS dashboard, with the **production** environment selected: _Domains_ →
   _Configure AuthKit domain_, and enter it (`auth.example.com`).
2. Add the CNAME record it shows at your DNS provider. On Cloudflare, make it **DNS only** (grey
   cloud) until WorkOS has verified it, which it keeps retrying for up to 72 hours.
3. Once it's verified, the device sign-in page and its tokens come from the new domain. Tokens
   then name it as their issuer, so tell the relay about both domains for the switch, new one
   first: `WORKOS_AUTHKIT_DOMAIN="https://auth.example.com,https://<random-words>.authkit.app"`
   (or `--workos-authkit-domain` with the same list), and redeploy. The relay takes tokens from
   either domain, for your client only. The public site (`site/`) does not sign in; the desktop
   app talks to WorkOS.
4. Sign in from the app once and check the page was on your domain. Sign-in tokens last minutes,
   so a day later you can drop the `.authkit.app` domain from the setting.

## Limits and the private beta

Everything here is off unless set, except the byte cap. The Bun relay reads these
from its environment, the Worker from `vars` (or secrets).

| Setting                          | Default | Public relay | What it does                                                                                                                                                                                                               |
| -------------------------------- | ------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KIWI_BETA_USERS`                | off     | set (secret) | Comma-separated WorkOS user ids, emails or `@domain`s. Only they create channels; anyone may still ask to join. Needs sign-in.                                                                                             |
| `KIWI_BETA_WAITLIST_URL`         | none    |              | Link shown to people who aren't on the list                                                                                                                                                                                |
| `KIWI_QUOTA_CHANNELS_PER_OWNER`  | off     | off          | Channels one person owns at once; closing one frees the slot                                                                                                                                                               |
| `KIWI_QUOTA_MEMBERS_PER_CHANNEL` | off     | off          | Active members per channel, people and agents together                                                                                                                                                                     |
| `KIWI_QUOTA_MESSAGES_PER_DAY`    | off     | off          | Messages stored per channel per UTC day. Over the limit: 429, with when it resets                                                                                                                                          |
| `KIWI_QUOTA_BYTES_PER_CHANNEL`   | 1 GB    | 1 GB (unset) | Stored ciphertext per channel. The oldest messages make room, so a busy channel never freezes; only a single message bigger than the allowance is refused (413)                                                            |
| `KIWI_EXPIRE_AFTER_DAYS`         | off     | off          | Delete a channel with no new message and nobody connected for this many days, exactly like a close                                                                                                                         |
| `KIWI_PAGE_KEY`                  | off     | set (secret) | Old history pages served from the cache. A random secret of at least 32 characters (`openssl rand -base64 32`; on Cloudflare, `bunx wrangler secret put KIWI_PAGE_KEY`). See [Cached history pages](#cached-history-pages) |

These are always on, everywhere: a channel keeps its whole history, bounded only by its stored bytes; one
message is at most 512 KB of ciphertext; a channel holds at most 20 pending join
requests; each member sends a bounded number of messages per minute.

### Cached history pages

With `KIWI_PAGE_KEY` set, a client catching up from far behind reads complete
pages of old messages (seq 1-1000, 1001-2000, ... wholly below the newest) from
`GET /v1/rooms/<room>/pages/<k>`. Stored messages never change, so the Worker
answers those from Cloudflare's Cache API. A cache hit does not wake the
channel's Durable Object. A miss reaches it: the first read of a page in a data
center, and every read after the entry expires or the cache evicts it. The Bun relay keeps
the same pages in memory (64 MB at most). Unset, or shorter than 32 characters,
the route answers 404 and clients read `/messages` as before.

Each page read carries a capability the channel issued on a member's signed
`GET /messages`: an HMAC with this key over the room, the member's key, a random
per-channel generation, the pages complete at that moment and an expiry five
minutes out. The relay checks the
request's signature and the capability before it looks in the cache. Changing the
key ends every capability at once. Cache entries live an hour. On a
`workers.dev` address the Cache API stores nothing, so every page read reaches the
channel (still correct, no saving).

Refusals reach people as one clear line: the app shows it where you create a
channel, the CLI prints it, MCP tools return it, and agents don't retry a 429.

## Pointing clients at your relay

```bash
kiwi join mc2-… --relay https://relay.example.com --as win
export KIWI_RELAY=https://relay.example.com      # default for every command
```

In the app, set the relay URL in Settings; the app uses it for everything,
including pairing. Each channel remembers its relay, so one machine can be in
channels on several relays. A channel's join line already includes `--relay` when
it isn't the public one.

**Versions.** 0.11 is a breaking release: the dashboard, the passkey vault,
device handovers, 0.10's computer-signed relay seats (`/seats`, `/admit`),
`kiwi tui`/`kiwi web` and CLI admin are gone, and channels are created and run
in the app. An agent's **seat** is local (the folder it joined from); the owner
signs its harness and model into that seat at approval. **0.10 and older CLIs are told to
update** — the relay answers them `update kiwi to join or approve here…` (426).
Update the relay and the CLIs together. Relays from 0.5.0 on check join codes in
two halves (see SECURITY.md), so joining and approving need kiwi 0.5.0 or newer.

**Installing the CLI.** `curl -fsSL https://channels.kiwiinit.com/install | sh`
installs the release binaries from this repository, whichever relay you use. It
checks them against the release's `SHA256SUMS` and prints a `gh attestation verify`
command that checks they were built by this repository's release workflow; it
doesn't run that command. A fork builds its own binary:

```bash
bun install --frozen-lockfile
bun run build          # dist/kiwi, a single file
```

## Security notes for operators

- **What you see.** Ciphertext and its sizes, when messages arrive, room ids, member
  public keys, connecting IP addresses, and who is connected when. With sign-in, also
  the WorkOS user id of each channel's creator, so their count of owned channels.
  Not names, roles, channel names or message content: those are end-to-end
  encrypted. Joining and pairing don't identify anyone to the relay: a person
  proves their person key, not a WorkOS account, and pairing rides a sealed mailbox.
- **What the Bun relay logs.** Three lines at startup. After that, only an error's
  message when a request fails unexpectedly, never request details, room ids or keys.
  Your reverse proxy may log more: Caddy's access logs are off unless you add `log`.
- **The site holds no keys.** The relay serves static files, so an operator can't
  take a person's key the way a served dashboard could: the person key lives only in
  the Kiwi app. The install scripts are one thing an operator could change, and
  they only download the release binaries and check them against the release's
  `SHA256SUMS` (from the same release; they print, but don't run, the
  `gh attestation verify` command). Your relay's refusal messages are the other:
  clients show them as the relay words them.
- **Serve `site/`, not the dashboard.** `--web` is for the static site. With no
  `--web`, the Bun relay serves `site/` and falls back to a built `ui/dist` when
  `site/` is missing; pass `--web site` or `--no-web` to rule that out. A built
  `ui/dist` served from a browser origin keeps the person key in that origin's
  `localStorage`, where any script on the origin, or a browser extension, can read
  it. In the Kiwi app the same dashboard never holds a secret key.
- **Closing and expiry delete the channel's file** (and its directory entries), but
  not your backups or disk snapshots.
- **Keep the data folder private.** Anyone who reads it sees what the relay sees, and
  can delete channels.
- **Don't log request bodies.** With a GitHub App configured, an owner's app sends
  its GitHub link token in the body of `PUT /github/repos` so the relay can check
  push access. The relay keeps nothing of it, but a proxy or logger in front of the
  relay that records bodies would keep a token that acts as that person on GitHub.
- **Don't expose the relay's port directly.** Clients sign every request, but tokens
  and timing travel in the clear without TLS.

## Testing a relay

The test suite runs against the Bun relay by default. To run it against a Worker in
`wrangler dev`, turn sign-in and quotas off for the run: the end-to-end tests
create channels through the client library (`test/owner.ts`), not the CLI.

```bash
bunx wrangler dev --port 8787 --var WORKOS_CLIENT_ID: \
  --var KIWI_QUOTA_CHANNELS_PER_OWNER: --var KIWI_QUOTA_MEMBERS_PER_CHANNEL: --var KIWI_QUOTA_MESSAGES_PER_DAY:
KIWI_TEST_RELAY=http://localhost:8787 bun test
```

### Signed-in flows, without WorkOS

The create gate needs a signed-in person. To test it on your own machine, start
the Bun relay with dev sign-in, where the token `dev:<name>` is the person
`dev_<name>` (the prefix keeps dev ids apart from real WorkOS ones):

```bash
bun src/relay/bun.ts --hostname 127.0.0.1 --port 8787 --data /tmp/kiwi-dev --dev-sign-in
curl -s localhost:8787/v1/config     # {"workosClientId":"dev","dev":true}
```

Anyone who can reach it can sign in as anyone. So the relay refuses to start
with `--dev-sign-in` on any address but loopback, and refuses a dev token on any
request that didn't come straight from this machine: another peer address, a
public host name, or any proxy header (`Forwarded`, `X-Forwarded-For`, `Via`…),
so a reverse proxy in front of it can't publish it. A proxy that adds no header
and rewrites the host name (nginx's bare `proxy_pass`, a TCP forwarder) would
look like this machine, so the relay also refuses `--dev-sign-in` and
`--dev-no-rate-limits` with `--trust-proxy` or `KIWI_TRUST_PROXY`: saying a proxy
is in front means other people reach it. `test/dev-sign-in.test.ts`
walks a signed-in owner, a computer-claimed agent (auto-approved while the owner's
client runs) and a person-claim join through it.

---
description: Run your own relay on Bun or on your own Cloudflare Worker, with sign-in, GitHub, limits and push.
group: Trust
order: 31
---

# Self-hosting

Channels works the same against any relay: the app, the CLI and agents speak one protocol, and messages are end-to-end encrypted either way. Run your own relay in one of two shapes:

- **The Bun relay** (`src/relay/bun.ts`, also `kiwi relay`): one process, one SQLite file per channel. It runs anywhere Bun runs: a VPS, a home server, a laptop on a LAN.
- **Your own Cloudflare Worker** (`src/relay/worker.ts`): the public relay's code, on your account.

Both pass the same test suite and read the same settings.

On a network where Cloudflare is slow or unreachable, [Self-hosting where Cloudflare is slow](self-hosting-china.md) is the short path for the Bun relay on one Linux server.

<!-- figure: selfhost -->

## When to self-host

- You want your channels' ciphertext, member keys and metadata on a machine you control.
- You want limits of your own, or none, or your own sign-in.
- Your agents work on a private network that can't reach the internet.
- You want to change the relay. Forks are welcome.

You don't need it to keep content private: the public relay can't read messages either. [What you see as an operator](#what-you-see-as-an-operator) lists what it does see.

## The Bun relay

You need [Bun](https://bun.sh) 1.4 or newer, and git.

```bash
git clone https://github.com/kiwi-init/channels.git
cd channels
bun install --frozen-lockfile --production --filter './'
bun src/relay/bun.ts --data ./relay-data
```

Point the app at it (Settings → relay URL), create a channel there, and use its join line on the computers that run agents. The join line carries `--relay`, and each channel remembers it.

With only the `kiwi` binary (no checkout), `kiwi relay` takes the same flags. It serves the website only when it can find it: pass `--web` with a built `site/`.

### Flags

`bun src/relay/bun.ts --help` (or `kiwi relay --help`) prints them. A flag's value comes after a space: the relay refuses `--flag=value`.

| Flag | Env | Default | What it does |
| --- | --- | --- | --- |
| `--port <n>` | `PORT` | `8787` | Port to listen on |
| `--hostname <addr>` | `KIWI_HOSTNAME` | `0.0.0.0` | Address to bind. Use `127.0.0.1` behind a reverse proxy |
| `--data <dir>` | `KIWI_DATA` | `.relay-data` | Where channels are stored |
| `--web <dir>` | `KIWI_WEB` | `site/` if present | Serve the website from this folder |
| `--no-web` | | | Don't serve the website |
| `--trust-proxy [addr,cidr]` | `KIWI_TRUST_PROXY` | off | Trust a reverse proxy's `X-Forwarded-For`. Bare or `1` trusts a loopback peer; an address or CIDR trusts that peer. `/0` is refused |
| `--dev-sign-in` | | | Testing only: the token `dev:<name>` signs in as `<name>`. Loopback only, never with `--trust-proxy` |
| `--dev-no-rate-limits` | | | Testing only: no per-minute caps, for requests made on this machine. Loopback only, never with `--trust-proxy` |

### Data

```
relay-data/
  people.sqlite                                each signed-in person's owned-channel count
  39269772c5b024a5c16dc2201dfec0fb.sqlite      one file per channel
```

A channel's file appears when the channel is created and is deleted when it's closed or expires. The relay creates the folder readable only by its own user; run it with `umask 077` so the files inside are private too.

## On the internet

Clients need HTTPS and WebSockets. Run the relay on loopback and put a TLS reverse proxy in front. [`deploy/`](../deploy) has the files.

### Caddy

[`deploy/Caddyfile`](../deploy/Caddyfile), with your domain:

```
example.com {
	reverse_proxy 127.0.0.1:8787
}
```

Caddy fetches and renews the certificate once the domain points at the machine and ports 80 and 443 are open, and passes WebSockets through. Pass `--trust-proxy` so each client counts as the address Caddy saw, not everyone as `127.0.0.1`.

### systemd

[`deploy/kiwi-relay.service`](../deploy/kiwi-relay.service) runs the relay as its own user, bound to loopback, with private files and a read-only view of the rest of the system:

```bash
sudo useradd --system --create-home --home-dir /var/lib/kiwi kiwi
sudo git clone https://github.com/kiwi-init/channels.git /opt/kiwi
cd /opt/kiwi && sudo bun install --frozen-lockfile --production --filter './'
sudo cp deploy/kiwi-relay.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kiwi-relay
```

The unit expects Bun at `/usr/local/bin/bun`. Add settings as `Environment=` lines, or an `EnvironmentFile=` readable only by root for secrets.

### Docker

```bash
docker build -f deploy/Dockerfile -t kiwi-relay .
docker run -d --name kiwi-relay --restart unless-stopped \
  -p 127.0.0.1:8787:8787 -v kiwi-data:/data \
  -e KIWI_TRUST_PROXY=172.17.0.1 kiwi-relay
```

Publish the port on loopback and keep Caddy in front. Inside the container the peer is the bridge gateway, usually `172.17.0.1` (`docker network inspect bridge` shows it), so name it in `KIWI_TRUST_PROXY`. Pass other settings with `-e`, or `--env-file` for secrets.

## Your own Cloudflare Worker

Each channel is one SQLite-backed Durable Object, and idle WebSockets hibernate, so quiet channels cost nothing.

1. In `wrangler.jsonc`, set `name`, replace `routes` with your domain (or use the `workers.dev` address), and set the limits you want. Leave `migrations` exactly as they are: changing a past entry can delete stored channels. `ratelimits` caps join-mailbox writes per client address; its `namespace_id` must be unique in your account.
2. Deploy:
   ```bash
   bunx wrangler login
   bunx wrangler deploy --dry-run   # lists the bindings and vars, uploads nothing
   bun run relay:deploy
   ```
3. Secrets go in with `bunx wrangler secret put NAME`, never in `wrangler.jsonc`.

Deploying builds the website first, docs included (`bun scripts/docs-site.ts`).

The Workers Free plan runs it, up to about 100,000 messages a day across all channels. The Paid plan has no daily cap and bills per request and stored GB: set a usage notification and the quotas below to keep the bill bounded. The website is static assets, which are free.

## Sign-in

People sign in with GitHub, through a GitHub App you register. On a relay with sign-in, only a signed-in person can create a channel, and adding a device needs one. Everything an owner does after creating a channel is their key's signature alone, and joining never signs anyone in.

1. Register a GitHub App (below) with **Enable Device Flow** on. For sign-in alone it needs no permissions and no webhook.
2. Give the relay the App's **Client ID** and a **client secret**:
   - Bun: `GITHUB_APP_CLIENT_ID=… GITHUB_APP_CLIENT_SECRET=… kiwi relay`
   - Worker: `GITHUB_APP_CLIENT_ID` under `vars`, and `bunx wrangler secret put GITHUB_APP_CLIENT_SECRET`

A person is `github_<id>`, GitHub's numeric id, so a renamed login stays the same person. Check it:

```bash
curl -s https://relay.example.com/v1/config
# {"githubSignIn":true,"githubClientId":"Iv23…"}
```

## GitHub

The same App carries [GitHub events](github-app.md) to channels.

1. GitHub → Settings → Developer settings → GitHub Apps → **New GitHub App**, under the organization if the repos live in one.
2. **Webhook URL**: `https://<relay>/v1/github/webhook`, with a long random **webhook secret** (`openssl rand -hex 32`).
3. **Repository permissions**: Pull requests, Issues, Contents, Actions and Metadata read-only; Checks read and write (for the review check). Nothing else.
4. **Events**: Pull request, Issues, Check run, Push, Workflow run.
5. Under **Identifying and authorizing users**, tick **Enable Device Flow** and untick **Expire user authorization tokens**.
6. Give the relay what it needs:

| Setting | Worker | Without it |
| --- | --- | --- |
| `GITHUB_WEBHOOK_SECRET` | secret | No GitHub events: `/v1/github/webhook` answers 404 |
| `GITHUB_APP_CLIENT_ID` | `vars` | No account linking and no sign-in |
| `GITHUB_APP_CLIENT_SECRET` | secret | No sign-in |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (the `.pem`) | secrets | No diffs, no green answer for a retired `kiwi/review` check a ruleset still requires, no catching up on open pull requests |

On the Bun relay each one is an environment variable.

## Limits and the private beta

Everything here is off unless set, except the byte cap. The Bun relay reads them from its environment, the Worker from `vars` or secrets.

| Setting | Default | What it does |
| --- | --- | --- |
| `KIWI_BETA_USERS` | off | Comma-separated `github_<id>`s, `github:<login>`s, emails or `@domain`s. Only they create channels; anyone may still ask to join. Needs sign-in |
| `KIWI_BETA_WAITLIST_URL` | none | A link for people who aren't on the list |
| `KIWI_QUOTA_CHANNELS_PER_OWNER` | off | Channels one person owns at once |
| `KIWI_QUOTA_MEMBERS_PER_CHANNEL` | off | Active members per channel, people and agents together |
| `KIWI_QUOTA_MESSAGES_PER_DAY` | off | Messages stored per channel per UTC day; over it, 429 with when it resets |
| `KIWI_QUOTA_PERSON_MESSAGES_PER_DAY` | off | Messages stored per person per UTC day, across every channel they own; members' and agents' messages count against the owner. Over it, 429 with when it resets. Needs sign-in |
| `KIWI_QUOTA_PAID_MESSAGES_PER_DAY` | the person quota | The same for people on the paid plan. At 100,000 or more the app calls the paid plan unlimited and names the cap only near it, as a fair-use limit |
| `KIWI_UPGRADE_URL` | none | A link in the over-quota message where people get more |
| `KIWI_ADMINS` | none | Comma-separated `github_<id>`s with no daily limit |
| `KIWI_QUOTA_BYTES_PER_CHANNEL` | 1 GB | Stored ciphertext per channel. The oldest messages make room, so a busy channel never freezes |
| `KIWI_EXPIRE_AFTER_DAYS` | off | Delete a channel with no new message and nobody connected for this many days, exactly like a close |
| `KIWI_PAGE_KEY` | off | A random secret of 32 characters or more: complete pages of old history are served from the cache |

Always on, everywhere: one message is at most 512 KB of ciphertext, a channel holds at most 20 pending join requests, and each member sends a bounded number of messages per minute. Refusals reach people as one clear line, and agents don't retry a 429.

## Paid plan (Stripe)

People on the paid plan get `KIWI_QUOTA_PAID_MESSAGES_PER_DAY`. Stripe moves them there and back:

1. In Stripe, create a product with a monthly price and a **Payment Link** for it. Put the link in `KIWI_UPGRADE_URL`; the relay adds `client_reference_id=github_<id>` so the payment lands on the right person.
2. Add a webhook endpoint `https://<relay>/v1/stripe/webhook` with the events `checkout.session.completed`, `customer.subscription.updated` and `customer.subscription.deleted`.
3. Give the relay its signing secret: `wrangler secret put STRIPE_WEBHOOK_SECRET` (Bun: the environment variable). Without it the endpoint answers 404.

A paid checkout moves a free person to paid. A subscription that stops being active or trialing moves them back. A person an admin set to unlimited stays unlimited.

## Phone push

A phone with the app closed is woken by a push with no content (see [Security](security.md#phone-notifications)). Without these settings the relay still takes registrations and sends no pushes.

- **iPhone (APNs).** Create a key under Certificates, Identifiers & Profiles → Keys with Apple Push Notifications service. Worker: `wrangler secret put APNS_KEY < AuthKey_XXXXXXXXXX.p8` and `wrangler secret put APNS_KEY_ID`, with `APNS_TEAM_ID` and `APNS_TOPIC` in `vars`. Bun: the same four as environment variables.
- **Android (FCM).** In a Firebase project with the app `com.kiwiinit.channels`, generate a service account key. Worker: `wrangler secret put FCM_SERVICE_ACCOUNT < the-key.json`. Bun: `FCM_SERVICE_ACCOUNT="$(cat the-key.json)"`.

## Pointing clients at it

```bash
kiwi join mc2-… --relay https://relay.example.com
export KIWI_RELAY=https://relay.example.com      # the default for every command
```

In the app, set the relay URL in Settings. Each channel remembers its relay, so one computer can be in channels on several relays.

The install line (`curl -fsSL https://channels.kiwiinit.com/install | sh`) installs this project's release binaries whichever relay you use, and checks them against the release's `SHA256SUMS`. A fork builds its own: `bun run build` writes `dist/kiwi`, a single file.

## What you see as an operator

- **Ciphertext and its shape**: sizes, when messages arrive, room ids, member public keys, connecting IP addresses and who is connected when. With sign-in, the `github_<id>` of each channel's creator. Never names, roles, channel names or content.
- **Logs.** The Bun relay prints three lines at startup, then only an error's message when a request fails unexpectedly. Your proxy may log more.
- **Don't log request bodies.** An owner's app sends its GitHub link token in the body of `PUT /github/repos`. The relay keeps nothing of it; a proxy that records bodies would.
- **Keep the data folder private.** Anyone who reads it sees what the relay sees, and can delete channels. Closing a channel deletes its file, not your backups.
- **Serve `site/`, never a built `ui/dist`.** A dashboard served from a browser origin would keep a person key in that origin's storage. Pass `--web site` or `--no-web` to rule it out.
- **Don't expose the relay's port directly.** Clients sign every request, but without TLS tokens and timing travel in the clear.

## Testing a relay

The test suite runs against the Bun relay by default. Against a Worker in `wrangler dev`, turn sign-in and quotas off for the run:

```bash
bunx wrangler dev --port 8787 --var GITHUB_APP_CLIENT_ID: \
  --var KIWI_QUOTA_CHANNELS_PER_OWNER: --var KIWI_QUOTA_MEMBERS_PER_CHANNEL: --var KIWI_QUOTA_MESSAGES_PER_DAY:
KIWI_TEST_RELAY=http://localhost:8787 bun test
```

To test signed-in flows without GitHub, start the Bun relay with dev sign-in, where the token `dev:<name>` is the person `dev_<name>`:

```bash
bun src/relay/bun.ts --hostname 127.0.0.1 --port 8787 --data /tmp/kiwi-dev --dev-sign-in
curl -s localhost:8787/v1/config     # {"githubSignIn":false,"dev":true}
```

Anyone who reaches it can sign in as anyone, so the relay refuses `--dev-sign-in` on any address but loopback, refuses a dev token on any request that didn't come straight from this machine, and refuses it with `--trust-proxy`.

---
description: Run your own relay on a plain Linux server, for teams where the public relay on Cloudflare is slow or unreachable. Docker or systemd, Caddy for TLS, and what nobody has tested yet.
group: Trust
order: 32
---

# Self-hosting where Cloudflare is slow

The public relay runs on Cloudflare. If that is slow or unreachable from your network, run the relay yourself on a Linux server close to your team. The app, the CLI and agents work the same against it, and messages are end-to-end encrypted either way.

This page is the short path for one case: the Bun relay on one Linux virtual machine, as sold by Alibaba Cloud, Tencent Cloud or any VPS provider. [Self-hosting](self-hosting.md) is the full reference, and every command here comes from it.

## What has not been tested

Read this first.

- **Nobody on the project has run this on Alibaba Cloud or Tencent Cloud, or from the Chinese mainland.** The commands are the ones our tests run on Linux. How they behave on those networks is not known to us.
- **We have no mirror.** The app, the CLI and their updates are downloaded from GitHub. See [Getting the app and the CLI](#getting-the-app-and-the-cli).
- If you try it, tell us what happened in a [GitHub issue](https://github.com/kiwi-init/channels/issues). A report from a real network is worth more than anything on this page.

## Choose where the server runs

A domain that points at a server in the Chinese mainland needs an ICP filing before it may serve anything. A server in Hong Kong or outside the mainland does not. The providers say so themselves:

- Alibaba Cloud: "Websites, apps, and other services with domain names resolving to servers in the Chinese mainland must obtain an ICP filing before providing services." ([What is ICP filing](https://www.alibabacloud.com/help/en/icp-filing/basic-icp-service/product-overview/what-is-an-icp-filing))
- Tencent Cloud says the same for mainland resources, and that cloud servers in Hong Kong (China) and overseas regions need no filing and cannot be used for one. ([ICP 备案：备案云资源](https://cloud.tencent.com/document/product/243/18908), in Chinese)

For any other provider, check its own pages. We are not a source for the rules, only for the relay.

The relay needs little: one process, one SQLite file per channel. Any small Linux machine with a public address, ports 80 and 443 open, and a domain pointing at it will do.

## Install the relay

You need [Bun](https://bun.sh) 1.4 or newer, and git. This runs the relay as its own user under systemd, bound to loopback:

```bash
sudo useradd --system --create-home --home-dir /var/lib/kiwi kiwi
sudo git clone https://github.com/kiwi-init/channels.git /opt/kiwi
cd /opt/kiwi && sudo bun install --frozen-lockfile --production --filter './'
sudo cp deploy/kiwi-relay.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kiwi-relay
```

The unit expects Bun at `/usr/local/bin/bun`. Add settings as `Environment=` lines, or an `EnvironmentFile=` readable only by root for secrets.

The clone and `bun install` reach GitHub and the npm registry. If those are slow from the server, that is the step that will show it.

### With Docker instead

```bash
docker build -f deploy/Dockerfile -t kiwi-relay .
docker run -d --name kiwi-relay --restart unless-stopped \
  -p 127.0.0.1:8787:8787 -v kiwi-data:/data \
  -e KIWI_TRUST_PROXY=172.17.0.1 kiwi-relay
```

Publish the port on loopback only. Inside the container the peer is the bridge gateway, usually `172.17.0.1` (`docker network inspect bridge` shows it), so name it in `KIWI_TRUST_PROXY`.

## TLS with Caddy

Clients need HTTPS and WebSockets. Keep the relay on loopback and put Caddy in front. [`deploy/Caddyfile`](../deploy/Caddyfile), with your domain:

```
example.com {
	reverse_proxy 127.0.0.1:8787
}
```

Caddy fetches and renews the certificate once the domain points at the machine and ports 80 and 443 are open, and it passes WebSockets through. Pass `--trust-proxy` to the relay (the systemd unit and the Docker line above already do) so each client counts as the address Caddy saw.

## Sign-in is optional

Without any sign-in settings the relay has no accounts: anyone who can reach it can create a channel. Joining a channel still needs its owner to let you in, and nobody can read a channel they are not in. For a team's own relay that is often enough; keep the address to yourselves.

Sign-in, when you want it, goes through a GitHub App you register, so it needs GitHub to be reachable from people's computers. [Sign-in](self-hosting.md#sign-in) has the steps. Check what your relay offers:

```bash
curl -s https://relay.example.com/v1/config
```

GitHub events in channels and phone push are optional too, and each needs its own outside service. [Self-hosting](self-hosting.md) lists them.

## Point the app and kiwi at it

```bash
kiwi join mc2-… --relay https://relay.example.com
export KIWI_RELAY=https://relay.example.com      # the default for every command
```

In the app, set the relay URL in Settings. Each channel remembers its relay, so one computer can be in channels on several relays.

## Getting the app and the CLI

- **The app** is downloaded from this project's [GitHub releases](https://github.com/kiwi-init/channels/releases/latest), and it checks GitHub for updates.
- **The CLI.** The install line fetches a script from `channels.kiwiinit.com`, which is on Cloudflare, and the script downloads the `kiwi` binary from GitHub releases and checks it against the release's `SHA256SUMS`:

```bash
curl -fsSL https://channels.kiwiinit.com/install | sh
```

- **From source**, when neither is reachable from a machine but a checkout is: `bun run build` writes `dist/kiwi`, a single file you can copy to other computers.

There is no mirror of the releases. If GitHub is unreachable from your network, download on a machine that can reach it and copy the files over. Whatever you copy, compare it with the release's `SHA256SUMS` first.

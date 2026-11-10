---
description: 在 Bun 或你自己的 Cloudflare Worker 上运行你自己的中继，包括登录、GitHub、限制和推送。
group: 信任
order: 31
---

# 自托管

无论连接哪个中继，Channels 的工作方式都一样：应用、CLI 和智能体使用同一套协议，消息始终是端到端加密的。你可以用以下两种形式之一运行自己的中继：

- **Bun 中继**（`src/relay/bun.ts`，也可以用 `kiwi relay`）：一个进程，每个频道一个 SQLite 文件。凡是能运行 Bun 的地方都能运行它：VPS、家用服务器、局域网中的笔记本。
- **你自己的 Cloudflare Worker**（`src/relay/worker.ts`）：公共中继的代码，部署在你的账户上。

两者通过同一套测试，读取同样的设置。

如果从你的网络访问 Cloudflare 很慢或无法访问，[在 Cloudflare 较慢的地方自托管](self-hosting-china.md)是在一台 Linux 服务器上运行 Bun 中继的最短路径。

<!-- figure: selfhost -->

## 何时自托管

- 你希望频道的密文、成员密钥和元数据放在你掌控的机器上。
- 你想要自己的限制，或者不设限制，或者使用自己的登录方式。
- 你的智能体工作在无法访问互联网的私有网络中。
- 你想修改中继。欢迎 fork。

要让内容保持私密，你并不需要自托管：公共中继同样读不到消息。[作为运营者你能看到什么](#what-you-see-as-an-operator)列出了它能看到的内容。

## Bun 中继

你需要 [Bun](https://bun.sh) 1.4 或更高版本，以及 git。

```bash
git clone https://github.com/kiwi-init/channels.git
cd channels
bun install --frozen-lockfile --production --filter './'
bun src/relay/bun.ts --data ./relay-data
```

把应用指向它（设置 → 中继 URL），在上面创建一个频道，然后在运行智能体的电脑上使用该频道的加入命令。加入命令带有 `--relay`，每个频道都会记住它。

如果只有 `kiwi` 二进制文件（没有检出代码），`kiwi relay` 接受同样的参数。只有在能找到网站时它才会提供网站：用 `--web` 传入构建好的 `site/`。

### 参数

`bun src/relay/bun.ts --help`（或 `kiwi relay --help`）会把它们打印出来。参数的值写在空格之后：中继不接受 `--flag=value`。

| 参数 | 环境变量 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `--port <n>` | `PORT` | `8787` | 监听的端口 |
| `--hostname <addr>` | `KIWI_HOSTNAME` | `0.0.0.0` | 绑定的地址。在反向代理之后请使用 `127.0.0.1` |
| `--data <dir>` | `KIWI_DATA` | `.relay-data` | 频道的存储位置 |
| `--web <dir>` | `KIWI_WEB` | 存在时为 `site/` | 从这个文件夹提供网站 |
| `--no-web` | | | 不提供网站 |
| `--trust-proxy [addr,cidr]` | `KIWI_TRUST_PROXY` | 关闭 | 信任反向代理的 `X-Forwarded-For`。不带值或为 `1` 时信任回环地址上的对端；给出地址或 CIDR 时信任该对端。`/0` 会被拒绝 |
| `--dev-sign-in` | | | 仅用于测试：令牌 `dev:<name>` 以 `<name>` 的身份登录。仅限回环地址，不能与 `--trust-proxy` 同时使用 |
| `--dev-no-rate-limits` | | | 仅用于测试：对本机发出的请求不设每分钟上限。仅限回环地址，不能与 `--trust-proxy` 同时使用 |

### 数据

```
relay-data/
  people.sqlite                                each signed-in person's owned-channel count
  39269772c5b024a5c16dc2201dfec0fb.sqlite      one file per channel
```

频道的文件在频道创建时出现，在频道关闭或过期时删除。中继创建的文件夹只有它自己的用户可读；请用 `umask 077` 运行它，让里面的文件也保持私有。

## 在互联网上

客户端需要 HTTPS 和 WebSocket。让中继运行在回环地址上，并在前面放一个 TLS 反向代理。[`deploy/`](../deploy) 中有相关文件。

### Caddy

[`deploy/Caddyfile`](../deploy/Caddyfile)，填上你的域名：

```
example.com {
	reverse_proxy 127.0.0.1:8787
}
```

一旦域名指向这台机器，并且 80 和 443 端口已开放，Caddy 就会获取并续期证书，并透传 WebSocket。请传入 `--trust-proxy`，这样每个客户端会被视为 Caddy 看到的地址，而不是所有人都是 `127.0.0.1`。

### systemd

[`deploy/kiwi-relay.service`](../deploy/kiwi-relay.service) 以独立用户运行中继，绑定到回环地址，文件私有，并以只读方式访问系统的其余部分：

```bash
sudo useradd --system --create-home --home-dir /var/lib/kiwi kiwi
sudo git clone https://github.com/kiwi-init/channels.git /opt/kiwi
cd /opt/kiwi && sudo bun install --frozen-lockfile --production --filter './'
sudo cp deploy/kiwi-relay.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kiwi-relay
```

该 unit 期望 Bun 位于 `/usr/local/bin/bun`。用 `Environment=` 行添加设置，机密则放进只有 root 可读的 `EnvironmentFile=`。

### Docker

```bash
docker build -f deploy/Dockerfile -t kiwi-relay .
docker run -d --name kiwi-relay --restart unless-stopped \
  -p 127.0.0.1:8787:8787 -v kiwi-data:/data \
  -e KIWI_TRUST_PROXY=172.17.0.1 kiwi-relay
```

把端口发布在回环地址上，并让 Caddy 挡在前面。在容器内部，对端是网桥网关，通常是 `172.17.0.1`（`docker network inspect bridge` 会显示它），所以要在 `KIWI_TRUST_PROXY` 中写明它。其他设置用 `-e` 传入，机密则用 `--env-file`。

## 你自己的 Cloudflare Worker

每个频道是一个以 SQLite 为存储的 Durable Object，空闲的 WebSocket 会休眠，所以安静的频道不产生费用。

1. 在 `wrangler.jsonc` 中设置 `name`，把 `routes` 换成你的域名（或使用 `workers.dev` 地址），并设置你想要的限制。`migrations` 保持原样不动：修改过去的条目可能会删除已存储的频道。`ratelimits` 限制每个客户端地址写入加入信箱的次数；它的 `namespace_id` 在你的账户中必须唯一。
2. 部署：
   ```bash
   bunx wrangler login
   bunx wrangler deploy --dry-run   # lists the bindings and vars, uploads nothing
   bun run relay:deploy
   ```
3. 机密用 `bunx wrangler secret put NAME` 写入，绝不要写进 `wrangler.jsonc`。

部署时会先构建网站，包括文档（`bun scripts/docs-site.ts`）。

Workers Free 方案即可运行它，所有频道合计每天最多约 100,000 条消息。Paid 方案没有每日上限，按请求数和存储 GB 计费：请设置用量通知和下面的配额，让账单保持可控。网站是静态资源，免费。

## 登录

人们通过你注册的 GitHub App 用 GitHub 登录。在启用了登录的中继上，只有已登录的人才能创建频道，添加设备也需要登录。所有者在创建频道之后所做的一切，都只凭其密钥的签名，加入频道也从不会让任何人登录。

1. 注册一个 GitHub App（见下文），并开启 **Enable Device Flow**。只用于登录时，它不需要任何权限，也不需要 webhook。
2. 把 App 的 **Client ID** 和一个 **client secret** 交给中继：
   - Bun：`GITHUB_APP_CLIENT_ID=… GITHUB_APP_CLIENT_SECRET=… kiwi relay`
   - Worker：`GITHUB_APP_CLIENT_ID` 放在 `vars` 下，并执行 `bunx wrangler secret put GITHUB_APP_CLIENT_SECRET`

一个人就是 `github_<id>`，即 GitHub 的数字 ID，所以改了登录名仍是同一个人。检查一下：

```bash
curl -s https://relay.example.com/v1/config
# {"githubSignIn":true,"githubClientId":"Iv23…"}
```

## GitHub

同一个 App 会把 [GitHub 事件](github-app.md)送到频道。

1. GitHub → Settings → Developer settings → GitHub Apps → **New GitHub App**，如果仓库属于某个组织，就在该组织下创建。
2. **Webhook URL**：`https://<relay>/v1/github/webhook`，并设置一个很长的随机 **webhook secret**（`openssl rand -hex 32`）。
3. **Repository permissions**：Pull requests、Issues、Contents、Actions 和 Metadata 只读；Checks 读写（用于审核检查）。其他一概不要。
4. **Events**：Pull request、Issues、Check run、Push、Workflow run。
5. 在 **Identifying and authorizing users** 下，勾选 **Enable Device Flow**，取消勾选 **Expire user authorization tokens**。
6. 把它需要的内容交给中继：

| 设置 | Worker | 没有它时 |
| --- | --- | --- |
| `GITHUB_WEBHOOK_SECRET` | secret | 没有 GitHub 事件：`/v1/github/webhook` 返回 404 |
| `GITHUB_APP_CLIENT_ID` | `vars` | 无法关联账户，也无法登录 |
| `GITHUB_APP_CLIENT_SECRET` | secret | 无法登录 |
| `GITHUB_APP_ID`、`GITHUB_APP_PRIVATE_KEY`（`.pem` 文件） | secret | 没有 diff，没有 `kiwi/review` 检查，也无法补齐未关闭的 PR |

在 Bun 中继上，每一项都是一个环境变量。

## 限制和内测

除字节上限外，这里的所有设置在未设置时都是关闭的。Bun 中继从环境变量中读取它们，Worker 则从 `vars` 或 secret 中读取。

| 设置 | 默认值 | 作用 |
| --- | --- | --- |
| `KIWI_BETA_USERS` | 关闭 | 以逗号分隔的 `github_<id>`、`github:<login>`、邮箱或 `@domain`。只有他们能创建频道；任何人仍然可以申请加入。需要登录 |
| `KIWI_BETA_WAITLIST_URL` | 无 | 给不在名单上的人的链接 |
| `KIWI_QUOTA_CHANNELS_PER_OWNER` | 关闭 | 一个人同时拥有的频道数 |
| `KIWI_QUOTA_MEMBERS_PER_CHANNEL` | 关闭 | 每个频道的活跃成员数，人和智能体合计 |
| `KIWI_QUOTA_MESSAGES_PER_DAY` | 关闭 | 每个频道每个 UTC 日存储的消息数；超出时返回 429，并告知何时重置 |
| `KIWI_QUOTA_PERSON_MESSAGES_PER_DAY` | 关闭 | 每个人每个 UTC 日存储的消息数，涵盖其拥有的所有频道；成员和智能体的消息计入所有者。超出时返回 429，并告知何时重置。需要登录 |
| `KIWI_QUOTA_PAID_MESSAGES_PER_DAY` | 个人配额 | 付费方案用户的同一项配额。设为 100,000 或以上时，应用会把付费方案称为无限，只在接近上限时才提到这个上限，作为合理使用限制 |
| `KIWI_UPGRADE_URL` | 无 | 超出配额提示中的链接，人们可以在那里获取更多额度 |
| `KIWI_ADMINS` | 无 | 以逗号分隔的 `github_<id>`，不受每日限制 |
| `KIWI_QUOTA_BYTES_PER_CHANNEL` | 1 GB | 每个频道存储的密文量。最旧的消息会腾出空间，所以繁忙的频道永远不会卡住 |
| `KIWI_EXPIRE_AFTER_DAYS` | 关闭 | 删除连续这么多天没有新消息、也无人连接的频道，效果与关闭完全相同 |
| `KIWI_PAGE_KEY` | 关闭 | 一个 32 个字符或更长的随机机密：完整的旧历史分页会从缓存中提供 |

在任何地方都始终开启：一条消息最多 512 KB 密文，一个频道最多有 20 个待处理的加入请求，每个成员每分钟发送的消息数有上限。拒绝会以一行清楚的提示告诉人们，智能体不会重试 429。

## 付费方案（Stripe）

付费方案的用户获得 `KIWI_QUOTA_PAID_MESSAGES_PER_DAY`。由 Stripe 把他们移入和移出付费方案：

1. 在 Stripe 中，创建一个带月付价格的产品，并为它创建一个 **Payment Link**。把这个链接填到 `KIWI_UPGRADE_URL`；中继会加上 `client_reference_id=github_<id>`，让付款记到正确的人名下。
2. 添加一个 webhook 端点 `https://<relay>/v1/stripe/webhook`，事件为 `checkout.session.completed`、`customer.subscription.updated` 和 `customer.subscription.deleted`。
3. 把它的签名密钥交给中继：`wrangler secret put STRIPE_WEBHOOK_SECRET`（Bun：用环境变量）。没有它时，该端点返回 404。

一次付费结账会把免费用户移到付费方案。订阅不再处于 active 或 trialing 状态时，会把他们移回去。被管理员设为无限的人保持无限。

## 手机推送

应用关闭时，手机会被一条不含内容的推送唤醒（参见[安全](security.md#phone-notifications)）。没有这些设置时，中继仍然接受注册，但不发送推送。

- **iPhone（APNs）**。在 Certificates, Identifiers & Profiles → Keys 下创建一个启用了 Apple Push Notifications service 的密钥。Worker：`wrangler secret put APNS_KEY < AuthKey_XXXXXXXXXX.p8` 和 `wrangler secret put APNS_KEY_ID`，并在 `vars` 中设置 `APNS_TEAM_ID` 和 `APNS_TOPIC`。Bun：把这四项设为环境变量。
- **Android（FCM）**。在包含应用 `com.kiwiinit.channels` 的 Firebase 项目中，生成一个服务账号密钥。Worker：`wrangler secret put FCM_SERVICE_ACCOUNT < the-key.json`。Bun：`FCM_SERVICE_ACCOUNT="$(cat the-key.json)"`。

## 让客户端指向它

```bash
kiwi join mc2-… --relay https://relay.example.com
export KIWI_RELAY=https://relay.example.com      # the default for every command
```

在应用中，到设置里填写中继 URL。每个频道都会记住自己的中继，所以一台电脑可以加入多个中继上的频道。

无论你使用哪个中继，安装命令（`curl -fsSL https://channels.kiwiinit.com/install | sh`）都会安装本项目发布的二进制文件，并用该版本的 `SHA256SUMS` 校验它们。fork 会构建自己的版本：`bun run build` 会生成 `dist/kiwi`，一个单文件。

## 作为运营者你能看到什么

- **密文及其形态**：大小、消息何时到达、房间 ID、成员公钥、连接的 IP 地址，以及谁在何时连接。启用登录时，还有每个频道创建者的 `github_<id>`。绝不包括名字、角色、频道名称或内容。
- **日志**。Bun 中继在启动时打印三行，之后只在请求意外失败时打印错误信息。你的代理可能会记录更多。
- **不要记录请求正文**。所有者的应用会在 `PUT /github/repos` 的请求正文中发送它的 GitHub 关联令牌。中继不保留它的任何部分；记录正文的代理则会留下它。
- **保持数据文件夹私有**。任何能读取它的人都能看到中继看到的内容，还能删除频道。关闭频道会删除它的文件，但不会删除你的备份。
- **提供 `site/`，绝不要提供构建好的 `ui/dist`**。从浏览器源提供的仪表盘会把个人密钥保存在该源的存储中。传入 `--web site` 或 `--no-web` 来杜绝这种情况。
- **不要直接暴露中继的端口**。客户端会对每个请求签名，但没有 TLS 时，令牌和时间信息会以明文传输。

## 测试中继

测试套件默认针对 Bun 中继运行。要针对 `wrangler dev` 中的 Worker 运行时，请在这次运行中关闭登录和配额：

```bash
bunx wrangler dev --port 8787 --var GITHUB_APP_CLIENT_ID: \
  --var KIWI_QUOTA_CHANNELS_PER_OWNER: --var KIWI_QUOTA_MEMBERS_PER_CHANNEL: --var KIWI_QUOTA_MESSAGES_PER_DAY:
KIWI_TEST_RELAY=http://localhost:8787 bun test
```

要在没有 GitHub 的情况下测试需要登录的流程，请用开发登录启动 Bun 中继，此时令牌 `dev:<name>` 就是用户 `dev_<name>`：

```bash
bun src/relay/bun.ts --hostname 127.0.0.1 --port 8787 --data /tmp/kiwi-dev --dev-sign-in
curl -s localhost:8787/v1/config     # {"githubSignIn":false,"dev":true}
```

任何能访问它的人都能以任何人的身份登录，所以中继会拒绝在回环地址以外的任何地址上使用 `--dev-sign-in`，拒绝任何不是直接来自本机的请求中的开发令牌，并且在使用 `--trust-proxy` 时也会拒绝它。

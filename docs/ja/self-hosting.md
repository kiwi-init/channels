---
description: 自分のリレーを Bun か自分の Cloudflare Worker で動かします。サインイン、GitHub、制限、プッシュも設定できます。
group: 信頼
order: 31
---

# セルフホスティング

Channels はどのリレーに対しても同じように動きます。アプリ、CLI、エージェントは 1 つのプロトコルで通信し、メッセージはどちらの場合もエンドツーエンドで暗号化されます。自分のリレーは、次の 2 つの形のどちらかで動かせます。

- **Bun リレー**（`src/relay/bun.ts`、または `kiwi relay`）: 1 つのプロセスで、チャンネルごとに 1 つの SQLite ファイルを使います。VPS、自宅のサーバー、LAN 上のノートパソコンなど、Bun が動く場所ならどこでも動きます。
- **自分の Cloudflare Worker**（`src/relay/worker.ts`）: 公開リレーのコードを、あなたのアカウントで動かします。

どちらも同じテストスイートに合格し、同じ設定を読みます。

<!-- figure: selfhost -->

## セルフホストする理由

- チャンネルの暗号文、メンバーの鍵、メタデータを、自分で管理するマシンに置きたい。
- 独自の制限を設けたい、制限をなくしたい、または独自のサインインを使いたい。
- エージェントが、インターネットに出られないプライベートネットワークで作業している。
- リレーを改造したい。フォークは歓迎です。

内容を非公開に保つためだけなら必要ありません。公開リレーもメッセージを読めないからです。それでも何が見えるかは[運営者として見えるもの](#what-you-see-as-an-operator)にまとめています。

## Bun リレー

[Bun](https://bun.sh) 1.4 以降と git が必要です。

```bash
git clone https://github.com/kiwi-init/channels.git
cd channels
bun install --frozen-lockfile --production --filter './'
bun src/relay/bun.ts --data ./relay-data
```

アプリの接続先をこのリレーにし（設定 → リレー）、そこでチャンネルを作成して、その参加用の 1 行をエージェントを動かすコンピューターで使います。参加用の 1 行には `--relay` が含まれ、各チャンネルはそれを覚えています。

`kiwi` のバイナリだけ（チェックアウトなし）の場合は、`kiwi relay` が同じフラグを受け付けます。Web サイトを配信するのは、それが見つかる場合だけです。ビルド済みの `site/` を `--web` で渡してください。

### フラグ

`bun src/relay/bun.ts --help`（または `kiwi relay --help`）で一覧を表示します。フラグの値はスペースの後に書きます。リレーは `--flag=value` を受け付けません。

| フラグ | 環境変数 | 既定値 | 内容 |
| --- | --- | --- | --- |
| `--port <n>` | `PORT` | `8787` | 待ち受けるポート |
| `--hostname <addr>` | `KIWI_HOSTNAME` | `0.0.0.0` | バインドするアドレス。リバースプロキシの後ろでは `127.0.0.1` を使います |
| `--data <dir>` | `KIWI_DATA` | `.relay-data` | チャンネルの保存先 |
| `--web <dir>` | `KIWI_WEB` | `site/` があればそれ | このフォルダーから Web サイトを配信します |
| `--no-web` | | | Web サイトを配信しません |
| `--trust-proxy [addr,cidr]` | `KIWI_TRUST_PROXY` | オフ | リバースプロキシの `X-Forwarded-For` を信頼します。値なしまたは `1` ならループバックのピアを、アドレスか CIDR ならそのピアを信頼します。`/0` は拒否されます |
| `--dev-sign-in` | | | テスト専用: トークン `dev:<name>` で `<name>` としてサインインします。ループバックのみで、`--trust-proxy` とは併用できません |
| `--dev-no-rate-limits` | | | テスト専用: このマシンからのリクエストに 1 分あたりの上限を設けません。ループバックのみで、`--trust-proxy` とは併用できません |

### データ

```
relay-data/
  people.sqlite                                each signed-in person's owned-channel count
  39269772c5b024a5c16dc2201dfec0fb.sqlite      one file per channel
```

チャンネルのファイルはチャンネルの作成時に作られ、チャンネルが閉じるか期限切れになると削除されます。リレーはフォルダーを自分のユーザーだけが読めるように作ります。中のファイルも非公開にするには、`umask 077` で実行してください。

## インターネットに公開する

クライアントには HTTPS と WebSocket が必要です。リレーはループバックで動かし、前段に TLS のリバースプロキシを置いてください。必要なファイルは [`deploy/`](../deploy) にあります。

### Caddy

[`deploy/Caddyfile`](../deploy/Caddyfile) を、あなたのドメインに書き換えて使います。

```
example.com {
	reverse_proxy 127.0.0.1:8787
}
```

ドメインがマシンを指し、ポート 80 と 443 が開いていれば、Caddy が証明書を取得・更新し、WebSocket も通します。`--trust-proxy` を渡してください。そうすれば、全員が `127.0.0.1` と数えられるのではなく、各クライアントが Caddy の見たアドレスとして数えられます。

### systemd

[`deploy/kiwi-relay.service`](../deploy/kiwi-relay.service) は、リレーを専用のユーザーで、ループバックにバインドし、ファイルを非公開にし、システムの他の部分を読み取り専用にして動かします。

```bash
sudo useradd --system --create-home --home-dir /var/lib/kiwi kiwi
sudo git clone https://github.com/kiwi-init/channels.git /opt/kiwi
cd /opt/kiwi && sudo bun install --frozen-lockfile --production --filter './'
sudo cp deploy/kiwi-relay.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kiwi-relay
```

このユニットは Bun が `/usr/local/bin/bun` にあることを前提にしています。設定は `Environment=` 行で追加し、秘密情報は root だけが読める `EnvironmentFile=` に置いてください。

### Docker

```bash
docker build -f deploy/Dockerfile -t kiwi-relay .
docker run -d --name kiwi-relay --restart unless-stopped \
  -p 127.0.0.1:8787:8787 -v kiwi-data:/data \
  -e KIWI_TRUST_PROXY=172.17.0.1 kiwi-relay
```

ポートはループバックで公開し、前段には Caddy を置いたままにします。コンテナ内ではピアはブリッジのゲートウェイで、通常は `172.17.0.1` です（`docker network inspect bridge` で確認できます）。それを `KIWI_TRUST_PROXY` に指定してください。ほかの設定は `-e` で、秘密情報は `--env-file` で渡します。

## 自分の Cloudflare Worker

各チャンネルは SQLite を使う 1 つの Durable Object で、アイドル状態の WebSocket はハイバネートするので、静かなチャンネルにはコストがかかりません。

1. `wrangler.jsonc` で `name` を設定し、`routes` をあなたのドメインに置き換え（または `workers.dev` のアドレスを使い）、必要な制限を設定します。`migrations` はそのままにしてください。過去のエントリを変えると、保存されたチャンネルが削除されることがあります。`ratelimits` はクライアントのアドレスごとに参加用メールボックスへの書き込みを制限します。その `namespace_id` はアカウント内で一意である必要があります。
2. デプロイします。
   ```bash
   bunx wrangler login
   bunx wrangler deploy --dry-run   # lists the bindings and vars, uploads nothing
   bun run relay:deploy
   ```
3. 秘密情報は `bunx wrangler secret put NAME` で登録し、決して `wrangler.jsonc` には書きません。

デプロイ時には、まずドキュメントを含む Web サイトがビルドされます（`bun scripts/docs-site.ts`）。

Workers の Free プランでも動き、全チャンネル合計で 1 日およそ 100,000 メッセージまで扱えます。Paid プランには 1 日の上限がなく、リクエスト数と保存した GB ごとに課金されます。使用量の通知と下記のクォータを設定して、請求額に上限を設けてください。Web サイトは静的アセットなので無料です。

## サインイン

人は、あなたが登録した GitHub App を通じて GitHub でサインインします。サインインのあるリレーでは、チャンネルを作成できるのはサインインした人だけで、デバイスの追加にもサインインが必要です。チャンネル作成後にオーナーが行うことはすべて、オーナーの鍵の署名だけで行われます。参加で誰かがサインインすることはありません。

1. **Enable Device Flow** をオンにして GitHub App を登録します（下記）。サインインだけなら、権限も Webhook も要りません。
2. App の **Client ID** と **client secret** をリレーに渡します。
   - Bun: `GITHUB_APP_CLIENT_ID=… GITHUB_APP_CLIENT_SECRET=… kiwi relay`
   - Worker: `vars` に `GITHUB_APP_CLIENT_ID` を書き、`bunx wrangler secret put GITHUB_APP_CLIENT_SECRET` を実行します

人は GitHub の数値 ID を使った `github_<id>` で表されるので、ログイン名を変えても同じ人のままです。確認するには次を実行します。

```bash
curl -s https://relay.example.com/v1/config
# {"githubSignIn":true,"githubClientId":"Iv23…"}
```

## GitHub

同じ App が [GitHub のイベント](github-app.md)をチャンネルに運びます。

1. GitHub → Settings → Developer settings → GitHub Apps → **New GitHub App**。リポジトリが Organization にある場合は、その Organization の下で作成します。
2. **Webhook URL**: `https://<relay>/v1/github/webhook`。長いランダムな **webhook secret**（`openssl rand -hex 32`）を設定します。
3. **Repository permissions**: Pull requests、Issues、Contents、Actions、Metadata は読み取り専用、Checks は読み書き（レビューのチェック用）。ほかは何も要りません。
4. **Events**: Pull request、Issues、Check run、Push、Workflow run。
5. **Identifying and authorizing users** で **Enable Device Flow** にチェックを入れ、**Expire user authorization tokens** のチェックを外します。
6. リレーに必要な値を渡します。

| 設定 | Worker | ない場合 |
| --- | --- | --- |
| `GITHUB_WEBHOOK_SECRET` | secret | GitHub のイベントなし: `/v1/github/webhook` は 404 を返します |
| `GITHUB_APP_CLIENT_ID` | `vars` | アカウント連携もサインインもなし |
| `GITHUB_APP_CLIENT_SECRET` | secret | サインインなし |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`（`.pem` ファイル） | secrets | 差分なし、`kiwi/review` チェックなし、未完了のプルリクエストの取り込みなし |

Bun リレーでは、いずれも環境変数です。

## 制限とプライベートベータ

ここにある設定は、バイト数の上限を除き、設定しない限りすべてオフです。Bun リレーは環境変数から、Worker は `vars` または secrets から読みます。

| 設定 | 既定値 | 内容 |
| --- | --- | --- |
| `KIWI_BETA_USERS` | オフ | カンマ区切りの `github_<id>`、`github:<login>`、メールアドレス、`@domain`。チャンネルを作成できるのは彼らだけですが、誰でも参加はリクエストできます。サインインが必要です |
| `KIWI_BETA_WAITLIST_URL` | なし | 一覧にない人に表示するリンク |
| `KIWI_QUOTA_CHANNELS_PER_OWNER` | オフ | 1 人が同時に所有できるチャンネル数 |
| `KIWI_QUOTA_MEMBERS_PER_CHANNEL` | オフ | チャンネルあたりのアクティブなメンバー数。人とエージェントの合計です |
| `KIWI_QUOTA_MESSAGES_PER_DAY` | オフ | チャンネルあたり UTC の 1 日に保存するメッセージ数。超えると、リセット時刻とともに 429 を返します |
| `KIWI_QUOTA_PERSON_MESSAGES_PER_DAY` | オフ | 1 人あたり UTC の 1 日に保存するメッセージ数で、その人が所有するすべてのチャンネルの合計です。メンバーとエージェントのメッセージはオーナーの分として数えます。超えると、リセット時刻とともに 429 を返します。サインインが必要です |
| `KIWI_QUOTA_PAID_MESSAGES_PER_DAY` | 個人のクォータ | 有料プランの人向けの同じ設定。100,000 以上なら、アプリは有料プランを無制限と表示し、上限に近づいたときだけ公正利用の上限としてその値を示します |
| `KIWI_UPGRADE_URL` | なし | クォータ超過のメッセージに表示する、上限を増やすためのリンク |
| `KIWI_ADMINS` | なし | 1 日の上限がない、カンマ区切りの `github_<id>` |
| `KIWI_QUOTA_BYTES_PER_CHANNEL` | 1 GB | チャンネルあたりに保存する暗号文の量。古いメッセージから場所を空けるので、忙しいチャンネルが止まることはありません |
| `KIWI_EXPIRE_AFTER_DAYS` | オフ | 新しいメッセージがなく、誰も接続していない状態がこの日数続いたチャンネルを、閉じたときと同じように削除します |
| `KIWI_PAGE_KEY` | オフ | 32 文字以上のランダムな秘密の値。古い履歴の完全なページをキャッシュから配信します |

どこでも常に有効なもの: 1 つのメッセージは暗号文で最大 512 KB、1 つのチャンネルが保持できる保留中の参加リクエストは最大 20 件、各メンバーが 1 分間に送れるメッセージ数には上限があります。拒否は人には 1 行のわかりやすい文で伝わり、エージェントは 429 を再試行しません。

## 有料プラン（Stripe）

有料プランの人には `KIWI_QUOTA_PAID_MESSAGES_PER_DAY` が適用されます。Stripe がその切り替えを行います。

1. Stripe で月額料金の商品と、その **Payment Link** を作成します。そのリンクを `KIWI_UPGRADE_URL` に設定します。支払いが正しい人に反映されるよう、リレーが `client_reference_id=github_<id>` を付け加えます。
2. Webhook のエンドポイント `https://<relay>/v1/stripe/webhook` を、イベント `checkout.session.completed`、`customer.subscription.updated`、`customer.subscription.deleted` で追加します。
3. 署名シークレットをリレーに渡します: `wrangler secret put STRIPE_WEBHOOK_SECRET`（Bun では環境変数）。ない場合、エンドポイントは 404 を返します。

有料の決済が完了すると、無料の人は有料になります。サブスクリプションが active でも trialing でもなくなると、無料に戻ります。管理者が無制限に設定した人は無制限のままです。

## スマートフォンのプッシュ

アプリを閉じているスマートフォンは、内容を含まないプッシュで起こされます（[セキュリティ](security.md#phone-notifications)を参照）。これらの設定がなくても、リレーは登録を受け付けますが、プッシュは送りません。

- **iPhone（APNs）。** Certificates, Identifiers & Profiles → Keys で、Apple Push Notifications service を有効にした鍵を作成します。Worker: `wrangler secret put APNS_KEY < AuthKey_XXXXXXXXXX.p8` と `wrangler secret put APNS_KEY_ID` を実行し、`APNS_TEAM_ID` と `APNS_TOPIC` を `vars` に書きます。Bun: 同じ 4 つを環境変数にします。
- **Android（FCM）。** アプリ `com.kiwiinit.channels` を含む Firebase プロジェクトで、サービスアカウントの鍵を生成します。Worker: `wrangler secret put FCM_SERVICE_ACCOUNT < the-key.json`。Bun: `FCM_SERVICE_ACCOUNT="$(cat the-key.json)"`。

## クライアントの接続先にする

```bash
kiwi join mc2-… --relay https://relay.example.com
export KIWI_RELAY=https://relay.example.com      # the default for every command
```

アプリでは、設定でリレーの URL を指定します。各チャンネルは自分のリレーを覚えているので、1 台のコンピューターで複数のリレーのチャンネルに参加できます。

インストール用の 1 行（`curl -fsSL https://channels.kiwiinit.com/install | sh`）は、どのリレーを使っていても、このプロジェクトのリリースバイナリをインストールし、リリースの `SHA256SUMS` と照合します。フォークは自分でビルドします: `bun run build` で、単一ファイルの `dist/kiwi` が作られます。

## 運営者として見えるもの

- **暗号文とその形**: サイズ、メッセージが届いた時刻、ルーム ID、メンバーの公開鍵、接続元の IP アドレス、誰がいつ接続しているか。サインインがあれば、各チャンネルの作成者の `github_<id>`。名前、ロール、チャンネル名、内容は決して見えません。
- **ログ。** Bun リレーは起動時に 3 行を出力し、その後はリクエストが予期せず失敗したときにエラーメッセージだけを出力します。プロキシはそれ以上を記録することがあります。
- **リクエストの本文は記録しないでください。** オーナーのアプリは、GitHub の連携トークンを `PUT /github/repos` の本文で送ります。リレーはそれを何も保存しませんが、本文を記録するプロキシは保存してしまいます。
- **データフォルダーは非公開に保ってください。** 読める人にはリレーと同じものが見え、チャンネルを削除することもできます。チャンネルを閉じて削除されるのはそのファイルで、バックアップは削除されません。
- **配信するのは `site/` で、ビルドした `ui/dist` は決して配信しないでください。** ブラウザのオリジンから配信されたダッシュボードは、個人の鍵をそのオリジンのストレージに保存してしまいます。`--web site` か `--no-web` を渡して、その可能性を排除してください。
- **リレーのポートを直接公開しないでください。** クライアントはすべてのリクエストに署名しますが、TLS がなければトークンとタイミングが平文で流れます。

## リレーのテスト

テストスイートは、既定では Bun リレーに対して実行します。`wrangler dev` の Worker に対して実行する場合は、その実行ではサインインとクォータをオフにします。

```bash
bunx wrangler dev --port 8787 --var GITHUB_APP_CLIENT_ID: \
  --var KIWI_QUOTA_CHANNELS_PER_OWNER: --var KIWI_QUOTA_MEMBERS_PER_CHANNEL: --var KIWI_QUOTA_MESSAGES_PER_DAY:
KIWI_TEST_RELAY=http://localhost:8787 bun test
```

GitHub なしでサインインのフローをテストするには、開発用サインインを有効にして Bun リレーを起動します。トークン `dev:<name>` が人 `dev_<name>` になります。

```bash
bun src/relay/bun.ts --hostname 127.0.0.1 --port 8787 --data /tmp/kiwi-dev --dev-sign-in
curl -s localhost:8787/v1/config     # {"githubSignIn":false,"dev":true}
```

到達できる人なら誰でも誰としてでもサインインできてしまうため、リレーは、ループバック以外のアドレスでの `--dev-sign-in` を拒否し、このマシンから直接来ていないリクエストの開発用トークンを拒否し、`--trust-proxy` と併用した場合も拒否します。

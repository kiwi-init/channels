---
description: Bun이나 내 Cloudflare Worker에서 로그인, GitHub, 한도, 푸시를 갖춘 릴레이를 직접 운영합니다.
group: 신뢰
order: 31
---

# 셀프 호스팅

Channels는 어떤 릴레이에서든 똑같이 동작합니다. 앱, CLI, 에이전트는 하나의 프로토콜을 쓰고, 메시지는 어느 쪽이든 종단 간 암호화됩니다. 릴레이는 두 가지 형태 중 하나로 직접 운영할 수 있습니다.

- **Bun 릴레이**(`src/relay/bun.ts`, 또는 `kiwi relay`): 프로세스 하나에 채널마다 SQLite 파일 하나. VPS, 홈 서버, LAN의 노트북 등 Bun이 실행되는 곳이라면 어디서든 동작합니다.
- **내 Cloudflare Worker**(`src/relay/worker.ts`): 공개 릴레이의 코드를 내 계정에서 실행합니다.

두 릴레이는 같은 테스트 스위트를 통과하고 같은 설정을 읽습니다.

<!-- figure: selfhost -->

## 셀프 호스팅이 필요한 경우

- 채널의 암호문, 구성원 키, 메타데이터를 내가 관리하는 머신에 두고 싶을 때.
- 나만의 한도를 두거나, 한도를 없애거나, 나만의 로그인을 쓰고 싶을 때.
- 에이전트가 인터넷에 닿지 않는 사설 네트워크에서 일할 때.
- 릴레이를 바꾸고 싶을 때. 포크를 환영합니다.

내용을 비공개로 지키기 위해서라면 필요 없습니다. 공개 릴레이도 메시지를 읽을 수 없습니다. 공개 릴레이가 보는 것은 [운영자로서 보는 것](#what-you-see-as-an-operator)에 정리되어 있습니다.

## Bun 릴레이

[Bun](https://bun.sh) 1.4 이상과 git이 필요합니다.

```bash
git clone https://github.com/kiwi-init/channels.git
cd channels
bun install --frozen-lockfile --production --filter './'
bun src/relay/bun.ts --data ./relay-data
```

앱이 이 릴레이를 가리키게 하고(설정 → 릴레이 URL), 그곳에 채널을 만든 뒤, 에이전트를 실행하는 컴퓨터에서 그 채널의 참여 줄을 쓰세요. 참여 줄에는 `--relay`가 들어 있고, 채널마다 자기 릴레이를 기억합니다.

`kiwi` 바이너리만 있고 체크아웃이 없다면 `kiwi relay`가 같은 플래그를 받습니다. 웹사이트는 찾을 수 있을 때만 제공하므로, 빌드한 `site/`와 함께 `--web`을 넘기세요.

### 플래그

`bun src/relay/bun.ts --help`(또는 `kiwi relay --help`)가 플래그를 출력합니다. 플래그 값은 공백 뒤에 옵니다. 릴레이는 `--flag=value`를 거부합니다.

| 플래그 | 환경 변수 | 기본값 | 하는 일 |
| --- | --- | --- | --- |
| `--port <n>` | `PORT` | `8787` | 수신 대기할 포트 |
| `--hostname <addr>` | `KIWI_HOSTNAME` | `0.0.0.0` | 바인딩할 주소. 리버스 프록시 뒤에서는 `127.0.0.1`을 쓰세요 |
| `--data <dir>` | `KIWI_DATA` | `.relay-data` | 채널을 저장하는 곳 |
| `--web <dir>` | `KIWI_WEB` | 있으면 `site/` | 이 폴더에서 웹사이트 제공 |
| `--no-web` | | | 웹사이트를 제공하지 않음 |
| `--trust-proxy [addr,cidr]` | `KIWI_TRUST_PROXY` | 꺼짐 | 리버스 프록시의 `X-Forwarded-For`를 신뢰. 값이 없거나 `1`이면 루프백 피어를 신뢰하고, 주소나 CIDR이면 그 피어를 신뢰합니다. `/0`은 거부됩니다 |
| `--dev-sign-in` | | | 테스트 전용: 토큰 `dev:<name>`으로 `<name>`으로 로그인합니다. 루프백에서만, `--trust-proxy`와는 함께 쓸 수 없습니다 |
| `--dev-no-rate-limits` | | | 테스트 전용: 이 머신에서 보낸 요청에 분당 한도를 두지 않습니다. 루프백에서만, `--trust-proxy`와는 함께 쓸 수 없습니다 |

### 데이터

```
relay-data/
  people.sqlite                                each signed-in person's owned-channel count
  39269772c5b024a5c16dc2201dfec0fb.sqlite      one file per channel
```

채널의 파일은 채널이 만들어질 때 생기고, 채널이 닫히거나 만료되면 삭제됩니다. 릴레이는 폴더를 자기 사용자만 읽을 수 있게 만듭니다. 안의 파일도 비공개가 되도록 `umask 077`로 실행하세요.

## 인터넷에 공개하기

클라이언트에는 HTTPS와 WebSocket이 필요합니다. 릴레이를 루프백에서 실행하고 앞에 TLS 리버스 프록시를 두세요. 필요한 파일은 [`deploy/`](../deploy)에 있습니다.

### Caddy

[`deploy/Caddyfile`](../deploy/Caddyfile)에 내 도메인을 넣어 쓰세요.

```
example.com {
	reverse_proxy 127.0.0.1:8787
}
```

도메인이 머신을 가리키고 80, 443 포트가 열려 있으면 Caddy가 인증서를 받아 갱신하고, WebSocket도 그대로 전달합니다. `--trust-proxy`를 넘기면 모든 클라이언트가 `127.0.0.1`로 집계되지 않고, 각 클라이언트가 Caddy가 본 주소로 집계됩니다.

### systemd

[`deploy/kiwi-relay.service`](../deploy/kiwi-relay.service)는 릴레이를 전용 사용자로, 루프백에 바인딩해, 비공개 파일과 시스템 나머지 부분에 대한 읽기 전용 보기로 실행합니다.

```bash
sudo useradd --system --create-home --home-dir /var/lib/kiwi kiwi
sudo git clone https://github.com/kiwi-init/channels.git /opt/kiwi
cd /opt/kiwi && sudo bun install --frozen-lockfile --production --filter './'
sudo cp deploy/kiwi-relay.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kiwi-relay
```

이 유닛은 Bun이 `/usr/local/bin/bun`에 있다고 가정합니다. 설정은 `Environment=` 줄로 추가하고, 비밀은 root만 읽을 수 있는 `EnvironmentFile=`에 두세요.

### Docker

```bash
docker build -f deploy/Dockerfile -t kiwi-relay .
docker run -d --name kiwi-relay --restart unless-stopped \
  -p 127.0.0.1:8787:8787 -v kiwi-data:/data \
  -e KIWI_TRUST_PROXY=172.17.0.1 kiwi-relay
```

포트는 루프백에만 공개하고 앞에 Caddy를 두세요. 컨테이너 안에서 피어는 브리지 게이트웨이이며 보통 `172.17.0.1`입니다(`docker network inspect bridge`로 확인할 수 있습니다). 이 주소를 `KIWI_TRUST_PROXY`에 지정하세요. 그 밖의 설정은 `-e`로, 비밀은 `--env-file`로 넘기세요.

## 내 Cloudflare Worker

채널마다 SQLite 기반 Durable Object 하나이고, 유휴 WebSocket은 동면하므로 조용한 채널에는 비용이 들지 않습니다.

1. `wrangler.jsonc`에서 `name`을 정하고, `routes`를 내 도메인으로 바꾸고(또는 `workers.dev` 주소를 쓰고), 원하는 한도를 설정하세요. `migrations`는 그대로 두세요. 지난 항목을 바꾸면 저장된 채널이 삭제될 수 있습니다. `ratelimits`는 클라이언트 주소별 참여 우편함 쓰기를 제한하며, 그 `namespace_id`는 내 계정 안에서 고유해야 합니다.
2. 배포하세요.
   ```bash
   bunx wrangler login
   bunx wrangler deploy --dry-run   # lists the bindings and vars, uploads nothing
   bun run relay:deploy
   ```
3. 비밀은 `wrangler.jsonc`에 절대 넣지 말고 `bunx wrangler secret put NAME`으로 넣으세요.

배포하면 먼저 문서를 포함한 웹사이트를 빌드합니다(`bun scripts/docs-site.ts`).

Workers Free 플랜으로도 실행되며, 모든 채널을 합쳐 하루 약 100,000개 메시지까지 처리합니다. Paid 플랜에는 일일 한도가 없고 요청 수와 저장 GB에 따라 과금됩니다. 비용이 늘지 않도록 사용량 알림과 아래의 할당량을 설정하세요. 웹사이트는 정적 자산이라 무료입니다.

## 로그인

사람은 내가 등록한 GitHub App을 통해 GitHub로 로그인합니다. 로그인이 있는 릴레이에서는 로그인한 사람만 채널을 만들 수 있고, 기기를 추가할 때도 로그인이 필요합니다. 채널을 만든 뒤 소유자가 하는 모든 일은 그 키의 서명만으로 이루어지며, 참여는 누구도 로그인시키지 않습니다.

1. **Enable Device Flow**를 켜고 GitHub App을 등록하세요(아래 참고). 로그인만 할 거라면 권한도 웹훅도 필요 없습니다.
2. 릴레이에 App의 **Client ID**와 **client secret**을 넘기세요.
   - Bun: `GITHUB_APP_CLIENT_ID=… GITHUB_APP_CLIENT_SECRET=… kiwi relay`
   - Worker: `vars` 아래에 `GITHUB_APP_CLIENT_ID`, 그리고 `bunx wrangler secret put GITHUB_APP_CLIENT_SECRET`

사람은 GitHub의 숫자 ID인 `github_<id>`로 식별되므로, 로그인 이름을 바꿔도 같은 사람으로 남습니다. 확인해 보세요.

```bash
curl -s https://relay.example.com/v1/config
# {"githubSignIn":true,"githubClientId":"Iv23…"}
```

## GitHub

같은 App이 [GitHub 이벤트](github-app.md)를 채널로 전달합니다.

1. GitHub → Settings → Developer settings → GitHub Apps → **New GitHub App**. 저장소가 조직에 있다면 그 조직 아래에서 만드세요.
2. **Webhook URL**: `https://<relay>/v1/github/webhook`. 길고 무작위인 **webhook secret**(`openssl rand -hex 32`)과 함께 설정하세요.
3. **Repository permissions**: Pull requests, Issues, Contents, Actions, Metadata는 읽기 전용, Checks는 읽기 및 쓰기(리뷰 체크용). 그 밖에는 없습니다.
4. **Events**: Pull request, Issues, Check run, Push, Workflow run.
5. **Identifying and authorizing users**에서 **Enable Device Flow**를 체크하고 **Expire user authorization tokens**의 체크를 해제하세요.
6. 릴레이에 필요한 것을 넘기세요.

| 설정 | Worker | 없으면 |
| --- | --- | --- |
| `GITHUB_WEBHOOK_SECRET` | secret | GitHub 이벤트 없음: `/v1/github/webhook`이 404로 응답 |
| `GITHUB_APP_CLIENT_ID` | `vars` | 계정 연결도, 로그인도 없음 |
| `GITHUB_APP_CLIENT_SECRET` | secret | 로그인 없음 |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`(`.pem`) | secrets | diff 없음, 규칙이 아직 필수로 하는 폐지된 `kiwi/review` 체크에 대한 초록색 응답 없음, 열린 풀 리퀘스트 따라잡기 없음 |

Bun 릴레이에서는 각각이 환경 변수입니다.

## 한도와 비공개 베타

바이트 한도를 제외하면, 설정하지 않은 항목은 모두 꺼져 있습니다. Bun 릴레이는 환경 변수에서, Worker는 `vars`나 secret에서 읽습니다.

| 설정 | 기본값 | 하는 일 |
| --- | --- | --- |
| `KIWI_BETA_USERS` | 꺼짐 | 쉼표로 구분한 `github_<id>`, `github:<login>`, 이메일 또는 `@domain`. 이들만 채널을 만들 수 있고, 참여 요청은 누구나 할 수 있습니다. 로그인 필요 |
| `KIWI_BETA_WAITLIST_URL` | 없음 | 목록에 없는 사람을 위한 링크 |
| `KIWI_QUOTA_CHANNELS_PER_OWNER` | 꺼짐 | 한 사람이 동시에 소유할 수 있는 채널 수 |
| `KIWI_QUOTA_MEMBERS_PER_CHANNEL` | 꺼짐 | 채널당 활성 구성원 수(사람과 에이전트 합산) |
| `KIWI_QUOTA_MESSAGES_PER_DAY` | 꺼짐 | 채널당 UTC 하루에 저장되는 메시지 수. 넘으면 초기화 시각과 함께 429 |
| `KIWI_QUOTA_PERSON_MESSAGES_PER_DAY` | 꺼짐 | 사람이 소유한 모든 채널을 합쳐 UTC 하루에 저장되는 메시지 수. 구성원과 에이전트의 메시지는 소유자에게 집계됩니다. 넘으면 초기화 시각과 함께 429. 로그인 필요 |
| `KIWI_QUOTA_PAID_MESSAGES_PER_DAY` | 사람별 할당량 | 유료 플랜 사용자에게 적용되는 같은 한도. 100,000 이상이면 앱은 유료 플랜을 무제한으로 표시하고, 한도에 가까워졌을 때만 공정 사용 한도로 알립니다 |
| `KIWI_UPGRADE_URL` | 없음 | 할당량 초과 메시지에 넣는, 더 받을 수 있는 곳의 링크 |
| `KIWI_ADMINS` | 없음 | 일일 한도가 없는, 쉼표로 구분한 `github_<id>` |
| `KIWI_QUOTA_BYTES_PER_CHANNEL` | 1 GB | 채널당 저장되는 암호문. 가장 오래된 메시지부터 비워 공간을 만들므로, 바쁜 채널이 멈추지 않습니다 |
| `KIWI_EXPIRE_AFTER_DAYS` | 꺼짐 | 이 일수 동안 새 메시지도 접속자도 없는 채널을 삭제. 닫기와 똑같이 처리됩니다 |
| `KIWI_PAGE_KEY` | 꺼짐 | 32자 이상의 무작위 비밀. 지난 기록의 완성된 페이지를 캐시에서 제공합니다 |

어디서나 항상 적용되는 것: 메시지 하나는 암호문 기준 최대 512 KB, 채널 하나에 대기 중인 참여 요청은 최대 20개, 구성원마다 분당 보낼 수 있는 메시지 수는 제한됩니다. 거부되면 사람에게는 명확한 한 줄로 알리고, 에이전트는 429를 재시도하지 않습니다.

## 유료 플랜(Stripe)

유료 플랜 사용자는 `KIWI_QUOTA_PAID_MESSAGES_PER_DAY`를 받습니다. Stripe가 사용자를 유료 플랜으로 옮기고 되돌립니다.

1. Stripe에서 월간 가격을 가진 상품과 그 상품의 **Payment Link**를 만드세요. 링크를 `KIWI_UPGRADE_URL`에 넣으세요. 릴레이가 `client_reference_id=github_<id>`를 덧붙이므로 결제가 올바른 사람에게 반영됩니다.
2. `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted` 이벤트로 웹훅 엔드포인트 `https://<relay>/v1/stripe/webhook`을 추가하세요.
3. 릴레이에 서명 비밀을 넘기세요: `wrangler secret put STRIPE_WEBHOOK_SECRET`(Bun: 환경 변수). 없으면 엔드포인트가 404로 응답합니다.

결제가 완료되면 무료 사용자가 유료로 바뀝니다. 구독이 active나 trialing 상태가 아니게 되면 다시 무료로 돌아갑니다. 관리자가 무제한으로 설정한 사람은 무제한으로 남습니다.

## 휴대폰 푸시

앱이 닫혀 있는 휴대폰은 내용 없는 푸시로 깨어납니다([보안](security.md#phone-notifications) 참고). 아래 설정이 없어도 릴레이는 등록을 받지만 푸시는 보내지 않습니다.

- **iPhone(APNs).** Certificates, Identifiers & Profiles → Keys에서 Apple Push Notifications service로 키를 만드세요. Worker: `wrangler secret put APNS_KEY < AuthKey_XXXXXXXXXX.p8`와 `wrangler secret put APNS_KEY_ID`, 그리고 `vars`에 `APNS_TEAM_ID`와 `APNS_TOPIC`. Bun: 같은 네 가지를 환경 변수로.
- **Android(FCM).** 앱 `com.kiwiinit.channels`가 있는 Firebase 프로젝트에서 서비스 계정 키를 생성하세요. Worker: `wrangler secret put FCM_SERVICE_ACCOUNT < the-key.json`. Bun: `FCM_SERVICE_ACCOUNT="$(cat the-key.json)"`.

## 클라이언트가 릴레이를 가리키게 하기

```bash
kiwi join mc2-… --relay https://relay.example.com
export KIWI_RELAY=https://relay.example.com      # the default for every command
```

앱에서는 설정에서 릴레이 URL을 지정하세요. 채널마다 자기 릴레이를 기억하므로, 한 컴퓨터가 여러 릴레이의 채널에 참여할 수 있습니다.

설치 줄(`curl -fsSL https://channels.kiwiinit.com/install | sh`)은 어떤 릴레이를 쓰든 이 프로젝트의 릴리스 바이너리를 설치하고, 릴리스의 `SHA256SUMS`로 검증합니다. 포크는 직접 빌드합니다: `bun run build`가 단일 파일 `dist/kiwi`를 만듭니다.

## 운영자로서 보는 것

- **암호문과 그 형태**: 크기, 메시지가 도착한 시각, 방 ID, 구성원 공개 키, 접속 IP 주소, 그리고 누가 언제 접속했는지. 로그인이 있으면 각 채널을 만든 사람의 `github_<id>`. 이름, 역할, 채널 이름, 내용은 절대 보지 않습니다.
- **로그.** Bun 릴레이는 시작할 때 세 줄을 출력하고, 그 뒤로는 요청이 예기치 않게 실패했을 때 오류 메시지만 출력합니다. 프록시는 더 많이 기록할 수 있습니다.
- **요청 본문을 기록하지 마세요.** 소유자의 앱은 `PUT /github/repos`의 본문에 GitHub 연결 토큰을 담아 보냅니다. 릴레이는 아무것도 보관하지 않지만, 본문을 기록하는 프록시는 보관하게 됩니다.
- **데이터 폴더를 비공개로 유지하세요.** 폴더를 읽을 수 있는 사람은 릴레이가 보는 것을 모두 보고, 채널을 삭제할 수도 있습니다. 채널을 닫으면 그 파일은 삭제되지만 백업은 삭제되지 않습니다.
- **빌드한 `ui/dist`가 아니라 `site/`를 제공하세요.** 브라우저 오리진에서 제공되는 대시보드는 그 오리진의 저장소에 사람 키를 보관하게 됩니다. 이를 막으려면 `--web site`나 `--no-web`을 넘기세요.
- **릴레이의 포트를 직접 노출하지 마세요.** 클라이언트가 모든 요청에 서명하더라도, TLS가 없으면 토큰과 타이밍 정보가 평문으로 오갑니다.

## 릴레이 테스트

테스트 스위트는 기본적으로 Bun 릴레이를 대상으로 실행됩니다. `wrangler dev`의 Worker를 대상으로 할 때는 실행하는 동안 로그인과 할당량을 끄세요.

```bash
bunx wrangler dev --port 8787 --var GITHUB_APP_CLIENT_ID: \
  --var KIWI_QUOTA_CHANNELS_PER_OWNER: --var KIWI_QUOTA_MEMBERS_PER_CHANNEL: --var KIWI_QUOTA_MESSAGES_PER_DAY:
KIWI_TEST_RELAY=http://localhost:8787 bun test
```

GitHub 없이 로그인 흐름을 테스트하려면 개발용 로그인을 켜고 Bun 릴레이를 시작하세요. 이때 토큰 `dev:<name>`은 사람 `dev_<name>`이 됩니다.

```bash
bun src/relay/bun.ts --hostname 127.0.0.1 --port 8787 --data /tmp/kiwi-dev --dev-sign-in
curl -s localhost:8787/v1/config     # {"githubSignIn":false,"dev":true}
```

여기에 닿는 사람은 누구든 아무나로 로그인할 수 있으므로, 릴레이는 루프백이 아닌 주소에서는 `--dev-sign-in`을 거부하고, 이 머신에서 곧바로 오지 않은 요청의 개발용 토큰을 거부하며, `--trust-proxy`와 함께 쓰면 거부합니다.

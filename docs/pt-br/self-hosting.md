---
description: Rode seu próprio relay no Bun ou no seu próprio Cloudflare Worker, com login, GitHub, limites e push.
group: Confiança
order: 31
---

# Self-hosting

O Channels funciona igual com qualquer relay: o app, a CLI e os agentes falam um só protocolo, e as mensagens são criptografadas de ponta a ponta de qualquer jeito. Rode seu próprio relay em um de dois formatos:

- **O relay Bun** (`src/relay/bun.ts`, também `kiwi relay`): um processo, um arquivo SQLite por canal. Roda em qualquer lugar onde o Bun roda: uma VPS, um servidor em casa, um laptop numa LAN.
- **Seu próprio Cloudflare Worker** (`src/relay/worker.ts`): o código do relay público, na sua conta.

Os dois passam na mesma suíte de testes e leem as mesmas configurações.

<!-- figure: selfhost -->

## Quando hospedar o seu

- Você quer o texto cifrado, as chaves dos membros e os metadados dos seus canais numa máquina que você controla.
- Você quer seus próprios limites, ou nenhum, ou seu próprio login.
- Seus agentes trabalham numa rede privada que não alcança a internet.
- Você quer mudar o relay. Forks são bem-vindos.

Você não precisa disso para manter o conteúdo privado: o relay público também não consegue ler as mensagens. [O que você vê como operador](#what-you-see-as-an-operator) lista o que ele vê.

## O relay Bun

Você precisa do [Bun](https://bun.sh) 1.4 ou mais novo, e do git.

```bash
git clone https://github.com/kiwi-init/channels.git
cd channels
bun install --frozen-lockfile --production --filter './'
bun src/relay/bun.ts --data ./relay-data
```

Aponte o app para ele (Configurações → URL do relay), crie um canal lá e use a linha de entrada dele nos computadores que rodam agentes. A linha de entrada leva `--relay`, e cada canal se lembra dele.

Só com o binário `kiwi` (sem checkout), `kiwi relay` aceita as mesmas flags. Ele só serve o site quando consegue achá-lo: passe `--web` com um `site/` já gerado.

### Flags

`bun src/relay/bun.ts --help` (ou `kiwi relay --help`) as imprime. O valor de uma flag vem depois de um espaço: o relay recusa `--flag=value`.

| Flag | Env | Padrão | O que faz |
| --- | --- | --- | --- |
| `--port <n>` | `PORT` | `8787` | Porta onde escutar |
| `--hostname <addr>` | `KIWI_HOSTNAME` | `0.0.0.0` | Endereço para o bind. Use `127.0.0.1` atrás de um proxy reverso |
| `--data <dir>` | `KIWI_DATA` | `.relay-data` | Onde os canais ficam guardados |
| `--web <dir>` | `KIWI_WEB` | `site/` se existir | Serve o site a partir desta pasta |
| `--no-web` | | | Não serve o site |
| `--trust-proxy [addr,cidr]` | `KIWI_TRUST_PROXY` | desligado | Confia no `X-Forwarded-For` de um proxy reverso. Sozinha ou `1` confia num peer de loopback; um endereço ou CIDR confia nesse peer. `/0` é recusado |
| `--dev-sign-in` | | | Só para testes: o token `dev:<name>` faz login como `<name>`. Só em loopback, nunca com `--trust-proxy` |
| `--dev-no-rate-limits` | | | Só para testes: sem limites por minuto, para pedidos feitos nesta máquina. Só em loopback, nunca com `--trust-proxy` |

### Dados

```
relay-data/
  people.sqlite                                each signed-in person's owned-channel count
  39269772c5b024a5c16dc2201dfec0fb.sqlite      one file per channel
```

O arquivo de um canal aparece quando o canal é criado e é apagado quando ele é fechado ou expira. O relay cria a pasta legível só pelo próprio usuário dele; rode-o com `umask 077` para que os arquivos lá dentro também fiquem privados.

## Na internet

Os clientes precisam de HTTPS e WebSockets. Rode o relay em loopback e ponha um proxy reverso com TLS na frente. [`deploy/`](../deploy) tem os arquivos.

### Caddy

[`deploy/Caddyfile`](../deploy/Caddyfile), com o seu domínio:

```
example.com {
	reverse_proxy 127.0.0.1:8787
}
```

O Caddy busca e renova o certificado assim que o domínio aponta para a máquina e as portas 80 e 443 estão abertas, e repassa os WebSockets. Passe `--trust-proxy` para que cada cliente conte como o endereço que o Caddy viu, e não todo mundo como `127.0.0.1`.

### systemd

[`deploy/kiwi-relay.service`](../deploy/kiwi-relay.service) roda o relay com um usuário próprio, preso ao loopback, com arquivos privados e uma visão somente leitura do resto do sistema:

```bash
sudo useradd --system --create-home --home-dir /var/lib/kiwi kiwi
sudo git clone https://github.com/kiwi-init/channels.git /opt/kiwi
cd /opt/kiwi && sudo bun install --frozen-lockfile --production --filter './'
sudo cp deploy/kiwi-relay.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kiwi-relay
```

A unit espera o Bun em `/usr/local/bin/bun`. Adicione configurações como linhas `Environment=`, ou um `EnvironmentFile=` legível só pelo root para segredos.

### Docker

```bash
docker build -f deploy/Dockerfile -t kiwi-relay .
docker run -d --name kiwi-relay --restart unless-stopped \
  -p 127.0.0.1:8787:8787 -v kiwi-data:/data \
  -e KIWI_TRUST_PROXY=172.17.0.1 kiwi-relay
```

Publique a porta em loopback e mantenha o Caddy na frente. Dentro do contêiner, o peer é o gateway da bridge, normalmente `172.17.0.1` (`docker network inspect bridge` mostra), então cite-o em `KIWI_TRUST_PROXY`. Passe outras configurações com `-e`, ou `--env-file` para segredos.

## Seu próprio Cloudflare Worker

Cada canal é um Durable Object com SQLite, e WebSockets ociosos hibernam, então canais quietos não custam nada.

1. No `wrangler.jsonc`, defina `name`, troque `routes` pelo seu domínio (ou use o endereço `workers.dev`) e defina os limites que quiser. Deixe `migrations` exatamente como está: mudar uma entrada antiga pode apagar canais guardados. `ratelimits` limita as escritas na caixa postal de entrada por endereço de cliente; o `namespace_id` dele precisa ser único na sua conta.
2. Faça o deploy:
   ```bash
   bunx wrangler login
   bunx wrangler deploy --dry-run   # lists the bindings and vars, uploads nothing
   bun run relay:deploy
   ```
3. Os segredos entram com `bunx wrangler secret put NAME`, nunca no `wrangler.jsonc`.

O deploy gera o site primeiro, docs incluídas (`bun scripts/docs-site.ts`).

O plano Workers Free roda isso, até umas 100.000 mensagens por dia somando todos os canais. O plano Paid não tem limite diário e cobra por pedido e por GB guardado: configure um aviso de uso e as cotas abaixo para manter a conta sob controle. O site é feito de assets estáticos, que são grátis.

## Login

As pessoas fazem login com o GitHub, por um GitHub App que você registra. Num relay com login, só uma pessoa logada pode criar um canal, e adicionar um dispositivo exige um login. Tudo o que um dono faz depois de criar um canal é só a assinatura da chave dele, e entrar num canal nunca faz login de ninguém.

1. Registre um GitHub App (abaixo) com **Enable Device Flow** ligado. Só para login, ele não precisa de permissões nem de webhook.
2. Dê ao relay o **Client ID** do App e um **client secret**:
   - Bun: `GITHUB_APP_CLIENT_ID=… GITHUB_APP_CLIENT_SECRET=… kiwi relay`
   - Worker: `GITHUB_APP_CLIENT_ID` em `vars`, e `bunx wrangler secret put GITHUB_APP_CLIENT_SECRET`

Uma pessoa é `github_<id>`, o id numérico do GitHub, então um login renomeado continua sendo a mesma pessoa. Confira:

```bash
curl -s https://relay.example.com/v1/config
# {"githubSignIn":true,"githubClientId":"Iv23…"}
```

## GitHub

O mesmo App leva os [eventos do GitHub](github-app.md) aos canais.

1. GitHub → Settings → Developer settings → GitHub Apps → **New GitHub App**, na organização se os repos estiverem numa.
2. **Webhook URL**: `https://<relay>/v1/github/webhook`, com um **webhook secret** longo e aleatório (`openssl rand -hex 32`).
3. **Repository permissions**: Pull requests, Issues, Contents, Actions e Metadata somente leitura; Checks leitura e escrita (para o check de revisão). Nada mais.
4. **Events**: Pull request, Issues, Check run, Push, Workflow run.
5. Em **Identifying and authorizing users**, marque **Enable Device Flow** e desmarque **Expire user authorization tokens**.
6. Dê ao relay o que ele precisa:

| Configuração | Worker | Sem ela |
| --- | --- | --- |
| `GITHUB_WEBHOOK_SECRET` | secret | Sem eventos do GitHub: `/v1/github/webhook` responde 404 |
| `GITHUB_APP_CLIENT_ID` | `vars` | Sem vínculo de conta e sem login |
| `GITHUB_APP_CLIENT_SECRET` | secret | Sem login |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (o `.pem`) | secrets | Sem diffs, sem a resposta verde ao check aposentado `kiwi/review` que as regras ainda exijam, sem buscar os PRs abertos |

No relay Bun, cada uma é uma variável de ambiente.

## Limites e o beta privado

Tudo aqui fica desligado a menos que seja definido, exceto o limite de bytes. O relay Bun os lê do ambiente dele, o Worker de `vars` ou de segredos.

| Configuração | Padrão | O que faz |
| --- | --- | --- |
| `KIWI_BETA_USERS` | desligado | `github_<id>`s, `github:<login>`s, emails ou `@domain`s separados por vírgula. Só eles criam canais; qualquer um ainda pode pedir para entrar. Precisa de login |
| `KIWI_BETA_WAITLIST_URL` | nenhum | Um link para quem não está na lista |
| `KIWI_QUOTA_CHANNELS_PER_OWNER` | desligado | Canais que uma pessoa tem ao mesmo tempo |
| `KIWI_QUOTA_MEMBERS_PER_CHANNEL` | desligado | Membros ativos por canal, pessoas e agentes juntos |
| `KIWI_QUOTA_MESSAGES_PER_DAY` | desligado | Mensagens guardadas por canal por dia UTC; acima disso, 429 com a hora em que zera |
| `KIWI_QUOTA_PERSON_MESSAGES_PER_DAY` | desligado | Mensagens guardadas por pessoa por dia UTC, somando todos os canais de que ela é dona; mensagens de membros e agentes contam para o dono. Acima disso, 429 com a hora em que zera. Precisa de login |
| `KIWI_QUOTA_PAID_MESSAGES_PER_DAY` | a cota por pessoa | O mesmo para quem está no plano pago. A partir de 100.000, o app chama o plano pago de ilimitado e só cita o limite quando está perto dele, como limite de uso justo |
| `KIWI_UPGRADE_URL` | nenhum | Um link na mensagem de cota estourada onde as pessoas conseguem mais |
| `KIWI_ADMINS` | nenhum | `github_<id>`s separados por vírgula, sem limite diário |
| `KIWI_QUOTA_BYTES_PER_CHANNEL` | 1 GB | Texto cifrado guardado por canal. As mensagens mais antigas abrem espaço, então um canal movimentado nunca trava |
| `KIWI_EXPIRE_AFTER_DAYS` | desligado | Apaga um canal sem mensagem nova e sem ninguém conectado por esse número de dias, exatamente como um fechamento |
| `KIWI_PAGE_KEY` | desligado | Um segredo aleatório de 32 caracteres ou mais: páginas completas de histórico antigo são servidas do cache |

Sempre ligado, em todo lugar: uma mensagem tem no máximo 512 KB de texto cifrado, um canal guarda no máximo 20 pedidos de entrada pendentes, e cada membro envia um número limitado de mensagens por minuto. As recusas chegam às pessoas como uma linha clara, e os agentes não tentam de novo depois de um 429.

## Plano pago (Stripe)

Quem está no plano pago ganha `KIWI_QUOTA_PAID_MESSAGES_PER_DAY`. A Stripe move as pessoas para lá e de volta:

1. Na Stripe, crie um produto com preço mensal e um **Payment Link** para ele. Ponha o link em `KIWI_UPGRADE_URL`; o relay acrescenta `client_reference_id=github_<id>` para que o pagamento caia na pessoa certa.
2. Adicione um endpoint de webhook `https://<relay>/v1/stripe/webhook` com os eventos `checkout.session.completed`, `customer.subscription.updated` e `customer.subscription.deleted`.
3. Dê ao relay o segredo de assinatura dele: `wrangler secret put STRIPE_WEBHOOK_SECRET` (Bun: a variável de ambiente). Sem ele, o endpoint responde 404.

Um checkout pago move uma pessoa do grátis para o pago. Uma assinatura que deixa de estar ativa ou em teste a move de volta. Uma pessoa que um admin definiu como ilimitada continua ilimitada.

## Push no celular

Um celular com o app fechado é acordado por um push sem conteúdo (veja [Segurança](security.md#phone-notifications)). Sem estas configurações, o relay ainda aceita registros e não manda push nenhum.

- **iPhone (APNs).** Crie uma chave em Certificates, Identifiers & Profiles → Keys com Apple Push Notifications service. Worker: `wrangler secret put APNS_KEY < AuthKey_XXXXXXXXXX.p8` e `wrangler secret put APNS_KEY_ID`, com `APNS_TEAM_ID` e `APNS_TOPIC` em `vars`. Bun: as mesmas quatro como variáveis de ambiente.
- **Android (FCM).** Num projeto do Firebase com o app `com.kiwiinit.channels`, gere uma chave de conta de serviço. Worker: `wrangler secret put FCM_SERVICE_ACCOUNT < the-key.json`. Bun: `FCM_SERVICE_ACCOUNT="$(cat the-key.json)"`.

## Apontando os clientes para ele

```bash
kiwi join mc2-… --relay https://relay.example.com
export KIWI_RELAY=https://relay.example.com      # the default for every command
```

No app, defina a URL do relay em Configurações. Cada canal se lembra do relay dele, então um computador pode estar em canais de vários relays.

A linha de instalação (`curl -fsSL https://channels.kiwiinit.com/install | sh`) instala os binários de release deste projeto seja qual for o relay que você usa, e os confere com o `SHA256SUMS` da release. Um fork gera os seus: `bun run build` escreve `dist/kiwi`, um único arquivo.

## O que você vê como operador

- **Texto cifrado e o formato dele**: tamanhos, quando as mensagens chegam, ids das salas, chaves públicas dos membros, os endereços IP que se conectam e quem está conectado quando. Com login, o `github_<id>` de quem criou cada canal. Nunca nomes, funções, nomes de canais ou conteúdo.
- **Logs.** O relay Bun imprime três linhas ao iniciar, e depois só a mensagem de um erro quando um pedido falha de forma inesperada. Seu proxy pode registrar mais.
- **Não registre o corpo dos pedidos.** O app de um dono manda o token de vínculo do GitHub no corpo de `PUT /github/repos`. O relay não guarda nada dele; um proxy que registra corpos guardaria.
- **Mantenha a pasta de dados privada.** Quem lê essa pasta vê o que o relay vê, e pode apagar canais. Fechar um canal apaga o arquivo dele, não os seus backups.
- **Sirva `site/`, nunca um `ui/dist` gerado.** Um painel servido de uma origem de navegador guardaria uma chave pessoal no armazenamento dessa origem. Passe `--web site` ou `--no-web` para descartar isso.
- **Não exponha a porta do relay diretamente.** Os clientes assinam cada pedido, mas sem TLS os tokens e os horários trafegam às claras.

## Testando um relay

A suíte de testes roda contra o relay Bun por padrão. Contra um Worker no `wrangler dev`, desligue o login e as cotas durante a execução:

```bash
bunx wrangler dev --port 8787 --var GITHUB_APP_CLIENT_ID: \
  --var KIWI_QUOTA_CHANNELS_PER_OWNER: --var KIWI_QUOTA_MEMBERS_PER_CHANNEL: --var KIWI_QUOTA_MESSAGES_PER_DAY:
KIWI_TEST_RELAY=http://localhost:8787 bun test
```

Para testar fluxos com login sem o GitHub, inicie o relay Bun com o login de dev, em que o token `dev:<name>` é a pessoa `dev_<name>`:

```bash
bun src/relay/bun.ts --hostname 127.0.0.1 --port 8787 --data /tmp/kiwi-dev --dev-sign-in
curl -s localhost:8787/v1/config     # {"githubSignIn":false,"dev":true}
```

Qualquer um que o alcance pode fazer login como qualquer um, então o relay recusa `--dev-sign-in` em qualquer endereço que não seja loopback, recusa um token de dev em qualquer pedido que não tenha vindo direto desta máquina, e o recusa com `--trust-proxy`.

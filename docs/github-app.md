# The Kiwi GitHub App

GitHub tells a channel about its pull requests, checks, pushes and workflow
runs through a GitHub App whose webhooks point at the relay. The relay can't
read channels, so it doesn't post anything itself: it checks each webhook's
signature, keeps a trimmed copy (repo, PR number and title, branch, commit,
check name and result, who did it; never a body or a diff) in the queue of
every channel that connected that repo, and the owner's app turns the queue
into signed, encrypted channel events the next time it's open. Queued items
are dropped once drained, and after 7 days or 500 items either way.

What the relay can see: which repos a channel connected, and those events
until the owner's app drains them. GitHub already has both.

**Not checked yet:** whether a channel's owner may see a repo. Any channel
owner on the relay can connect any repo name and receive the trimmed events
of every repo the App is installed on under that name (titles, branches,
check results; never code). Until a channel owner's GitHub account is linked
and checked (T41), install the App only on repos whose PR titles every
channel owner on your relay may see: on the public relay, that's who is on
`KIWI_BETA_USERS`.

## Register the App (once, by whoever runs the relay)

1. GitHub → Settings → Developer settings → GitHub Apps → **New GitHub App**
   (under the organization, if the repos live in one).
2. **Name**: `Kiwi` (or `Kiwi (your relay)`). **Homepage URL**: the relay's
   site, e.g. `https://kiwiinit.com`.
3. **Webhook**: active. **Webhook URL**: `https://<relay>/v1/github/webhook`.
   **Webhook secret**: a long random string (`openssl rand -hex 32`); keep it
   for step 6.
4. **Repository permissions**, all read-only: Pull requests, Checks, Contents,
   Actions, Metadata. Nothing else.
5. **Subscribe to events**: Pull request, Check run, Push, Workflow run.
   Where can it be installed: only on this account, unless others will use
   your relay.
6. Give the relay the secret:
   - Cloudflare: `wrangler secret put GITHUB_WEBHOOK_SECRET`
   - Bun relay: `GITHUB_WEBHOOK_SECRET=… kiwi relay`

   Without it, `/v1/github/webhook` answers 404 and nothing is queued.
7. For diffs and review checks: note the **App ID**, generate a **private
   key**, and give both to the relay (the `.pem` as GitHub downloads it, PKCS#1
   or PKCS#8 both work):
   - Cloudflare: `wrangler secret put GITHUB_APP_ID`, then
     `wrangler secret put GITHUB_APP_PRIVATE_KEY < the-key.pem`
   - Bun relay: `GITHUB_APP_ID=… GITHUB_APP_PRIVATE_KEY="$(cat the-key.pem)" kiwi relay`

   Set Checks and Pull requests to **Read and write** for the review check.
   Without them, `GET /github/diff` and `POST /github/check` answer 404.

## Diffs and the kiwi/review check

With the key, the relay calls GitHub as the App, with a short-lived token for
the repo's installation. A member reads a commit's diff against the repo's
default branch (`GET /github/diff?repo=&sha=`, connected repos only). Only
the owner posts the `kiwi/review` check (`POST /github/check`): the owner's
app does it for each verdict it sees in the channel, so an agent can't
approve its own work on GitHub. Require `kiwi/review` in the branch's
protection rules to make a Kiwi review a merge gate.

## Connect a repo to a channel

1. Install the App on the repos (the App's page → Install).
2. In the channel, the owner lists the repos under **Repos**. The app sends
   the same list to the relay (`PUT /github/repos`), which is what routes a
   repo's webhooks to this channel.

GitHub's **Recent Deliveries** on the App's page shows each webhook and the
relay's answer: `{"queued": 1}` when a channel took it, `{"queued": 0}` when
no channel connected that repo, 401 for a wrong secret.

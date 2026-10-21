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

**Checked:** a channel's owner connects only repos their linked GitHub account
can push to. When the repo list changes, the owner's app sends the relay its
GitHub link token with that one request. The relay asks GitHub, as the owner,
for each repo on the list (`GET /repos/<owner>/<name>`, needing push or admin),
refuses the whole list if any repo fails, and keeps nothing of the token.
Every change re-checks the whole list, so a repo the owner lost access to
can't stay connected past the next change. The app sends the token only to a
relay whose `/v1/config` names a GitHub App, and never to clear the list. The
check needs only that token, not the App's private key, so a relay with the
webhook secret and the client id but no key checks the same way. A relay with
no webhook secret receives no GitHub events, so it takes a repo list unchecked:
there's nothing for it to route.

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
7. Under **Identifying and authorizing users**, tick **Enable Device Flow**
   and untick **Expire user authorization tokens**: a Mac links by GitHub's
   device flow, which needs only the public client id, and without the App's
   client secret it can't refresh a token that expires after 8 hours.
   Account permissions: none. Give the relay the App's **Client ID** (it is
   public; it appears in the relay's `/v1/config` so a Mac can start the link):
   - Cloudflare: `GITHUB_APP_CLIENT_ID` under `vars` in `wrangler.jsonc`
   - Bun relay: `GITHUB_APP_CLIENT_ID=… kiwi relay`
8. For diffs and review checks: note the **App ID**, generate a **private
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

## Link your GitHub account (each person, in the desktop app)

Settings → **GitHub** → **Link GitHub** shows a code, opens
`github.com/login/device`, and finishes when you type it there and approve.
The app then names the account it linked (`Linked as @you`). The token is kept
in the app's encrypted store on that Mac: it is not sent to the relay, put in
a channel or handed to an agent, and **Unlink** forgets it. The row appears
only when the relay has a `GITHUB_APP_CLIENT_ID`.

## Connect a repo to a channel

1. Install the App on the repos (the App's page → Install).
2. In the channel, the owner lists the repos under **Repos**. The app sends
   the same list to the relay (`PUT /github/repos`), which is what routes a
   repo's webhooks to this channel.
3. **Write to GitHub**, under Repos, is off by default. While it's off, Kiwi
   writes nothing to your repos: a task added with `--issue` only links the
   issue, and closing the task leaves the issue as it is (the issue closing on
   GitHub still closes its task). While the owner has it on, their app comments
   `Linked to Kiwi task T7` once on a new PR whose branch names a task (`T7-…`)
   and on the issue of a task added with `--issue`, and closes that issue when
   the task is done (completed) or cancelled (not planned). No comment carries
   the task's title or notes, which stay in the encrypted channel, and nothing
   from before the switch went on is commented or closed.

GitHub's **Recent Deliveries** on the App's page shows each webhook and the
relay's answer: `{"queued": 1}` when a channel took it, `{"queued": 0}` when
no channel connected that repo, 401 for a wrong secret.

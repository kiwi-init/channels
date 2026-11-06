---
description: Connect a repo so the channel sees its pull requests, issues and checks, and a review can gate a merge.
group: Connect
order: 21
---

# GitHub

Connect a repo and the channel sees its pull requests, issues, checks, pushes and workflow runs as they happen. The relay can't read or sign in the channel, so it never posts there itself: it queues a trimmed slip, and your app posts it, signed and encrypted, the next time it's open.

<!-- figure: github -->

## Set it up

1. **Link your account.** In the app, Settings → **GitHub** → **Link GitHub** shows a code and opens `github.com/login/device`. Type the code there and approve; the app then says _Linked as @you_. The token stays in the app's encrypted store on that computer, never in a channel or with an agent. **Unlink** forgets it.
2. **Install the App.** Install **Kiwi Channels** on the repos, on every account or organization that owns one.
3. **Connect the repo** in the channel's settings, under **Repos**. You can connect only repos your linked account can push to.

When the repo list changes, your app sends the relay your link token with that one request. The relay asks GitHub, as you, whether you can push to each repo, refuses the whole list if one fails, and keeps nothing of the token. Connect repos only through a relay you trust with that: one that records request bodies could keep the token.

## What the relay sees

Which repos a channel connected, and each event until your app picks it up: the repo, PR number and title, branch, commit, check name and result, and who did it. Never a body or a diff. GitHub already has all of it. Queued slips are dropped once picked up, and after 7 days or 500 items either way.

## What a channel already has

GitHub sends only what happens after a repo is connected. So the owner's app, when it opens, when a repo is connected and every 6 hours, fetches the repo's open pull requests with their checks, its open issues, and what closed in the last 30 days, and posts only what the channel doesn't know yet.

When the GitHub view is empty, it says why: whether the App is installed on each repo (with the install link when it isn't), which events it gets, and when its last webhook came. A repo that moved to an organization needs the App installed there too.

## Reviews as a merge gate

Only the owner's app posts the `kiwi/review` check, for each verdict it sees in the channel, so an agent can't approve its own work on GitHub. Require `kiwi/review` in the branch's protection rules to make a Kiwi review a merge gate.

Members can read a commit's diff against the default branch through the relay, for connected repos only.

## Issues become tasks

`kiwi task add --issue 12` files a task from an issue of the channel's repo, titled after it. The issue closing closes the task. The task closing closes the issue only while the owner has _Write to GitHub_ on.

## On your own relay

A relay you run needs a GitHub App of its own. [Self-hosting](self-hosting.md#github) has the steps.

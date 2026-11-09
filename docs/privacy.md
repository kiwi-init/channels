---
description: What Channels collects, what it can't see, and who else touches your data.
group: Trust
order: 32
---

# Privacy

Channels is built so that the people running it can't read what you write. This page covers the apps (Mac, Linux, iPhone, Android), the CLI and the public relay at `channels.kiwiinit.com`.

## What we can't see

- **Your messages, files, names, roles and channel names.** They are encrypted on your device before they leave it, and only the channel's members can open them.
- **Your keys.** Your person key is made on your device and stays there.

## What the relay sees

To carry encrypted messages, the relay sees their shape, not their content:

- when messages are sent, their sizes and how many;
- room ids and members' public keys;
- connecting IP addresses, and when each key connects;
- how far each member has read: a number and a time, never what;
- your GitHub user id when you sign in. No names or emails.

When a channel closes, the relay deletes it, and with it the room ids and join codes.

## Others who touch your data

- **GitHub**, when you sign in or connect a repo. We get your GitHub user id and the repo events you connect.
- **Apple and Google**, for phone notifications. A push carries a random tag and a number, never a room, a name or any text.
- **Stripe**, if you pay for a plan. Stripe handles your payment details; we only learn that your GitHub id is on the paid plan.
- **Cloudflare**, which hosts the public relay.

## What we don't do

- No ads, no tracking and no analytics in the apps.
- We don't sell or share your data.

## Your choices

- **Leave a channel** and your key is revoked at once.
- **Close a channel** (owners) and the relay deletes it outright. Members' devices wipe their copy.
- **Run your own relay** and nothing goes through ours. See [Self-hosting](self-hosting.md).

## Contact

Questions about privacy: open an issue at [github.com/kiwi-init/channels](https://github.com/kiwi-init/channels/issues). The full trust model is in [Security](security.md).

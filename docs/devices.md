---
description: Add a computer to your devices with a sign-in and 6 digits. Each one keeps its own key.
group: Connect
order: 20
---

# Devices

Your devices are the computers that act for you. Each one has its own key. You add one by signing in on it and typing the 6 digits it shows into your app. Nothing copies your person key: it stays in the app.

<!-- figure: devices -->

## Add a computer

```bash
kiwi login
```

1. It opens the sign-in with the account your app uses, then shows 6 digits.
2. Your app asks about the new computer. Type the digits there.
3. Before it keeps anything, the computer shows your key. Check it against the one your app shows next to the digits, and in Settings as *Your key for new devices*. Until you confirm, it writes nothing.

The computer keeps its key and a certificate your app signed in `~/.kiwi`. From then on, agents you start there let themselves into your channels while the app is running, listed as coming from that computer. The app's own computer adds itself.

The digits come from a commitment the new computer makes before it sees the app's half, so a relay that swaps keys can't grind a match. No code to carry, no QR, no key copied.

## What your app can ask a computer

The app reaches each computer's daemon through the relay, for its settings or to unpair it. Every ask is signed with your person key and sealed to that computer's key, so the relay can't read, forge or replay it.

- The daemon runs an ask only if it's from the person who certified the computer, aimed at this computer, less than two minutes old and never seen before.
- The answer goes back signed by the computer, in a one-time mailbox only the app can read.
- Every ask is logged in `~/.kiwi/remote.log`. A refused one gets no answer.

While the daemon holds its certificate, it keeps an inbox socket open at the relay. A computer counts as online while that socket is open.

## Remove one

Remove the computer in the app, or run `kiwi unpair` on it. The relay forgets it and closes its inbox: it takes no more asks, and its agents no longer let themselves in.

## Check a computer

`kiwi doctor` checks the install, the relay, your devices and the hooks, with a fix for each problem.

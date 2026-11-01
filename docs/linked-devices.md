# Linked devices

One login on every device, without copying your root keys to all of them. You sign in on a new
desktop, phone or computer, then approve it from an app you already have, the way Signal links
devices. The encrypted vault is only for recovery.

Status: decided (T521). Jow chose this over the Spike 3 vault (#518; verdict in T494) and took the
decisions at the end (#602, #615). Reviewed by sunny-tortoise (#559, #570).

## Today

- Your person key (Ed25519 + X25519, `packages/core/src/identity.ts`) is made by the first desktop
  app. A second desktop can't receive it: its first run makes a new person (`createPerson`,
  `desktop/src/ipc/store.ts`).
- Phones linked by `kl1` before T112 hold **copies** of the person key and every channel's member key,
  owner keys included. The `kl1` link itself is gone (T112).
  - Such a phone is you: it can only be unlinked from itself, and no list can cut a stolen one off.
  - On iOS those keys are `WhenUnlockedThisDeviceOnly` (`ios/Channels/Model/Vault.swift:29`), so they
    aren't in iCloud backups.
- Computers enroll with `kiwi login`. When the app holding the person key approves one, the grant
  also carries a `MachineCert` (`packages/core/src/person.ts:22`): a person signature over the
  computer's key, with no expiry, which the app's launches need. `kp1` and `kiwi pair` are gone (T112).
  - Since T503 a forgotten computer's agents no longer join on their own in the desktop app.
  - The cert itself stays valid.
- Auto-approval runs wherever the channel owner key is: the desktop app, and the iOS app while open
  (`packages/core/src/client/requests.ts:181`). The `kiwi` daemon admits only its own computer's
  agents, and only with a delegation (section 3).
- WorkOS sign-in (`desktop/src/signin.ts:22`) only gates creating channels (`creator` guard,
  `src/relay/route.ts:147`).
- The relay keeps each computer's binding to its person (`src/relay/machine.ts`).
- Removing a member rotates the channel's content key: `rotation(without)` wraps the next epoch for
  everyone but that key (`packages/core/src/client/members.ts`, `client.ts:342`).
- The owner key is pinned in the join code, records must be signed by it (`openRecord`), and the relay
  authenticates owner routes with it.

## 1. Devices, their keys, and the device list

**Every device has its own key.** A device makes its own Ed25519 + X25519 key pair. No device is
given a copy of the person key.

**Each device is its own member in each channel.**

- Its join request carries a `DeviceClaim` (its cert plus a vouch over room and member key, like
  today's `ComputerClaim`).
- The owner's client admits it on its own when the cert chains to a person already in the record.
  That extends `joinsOnItsOwn`.
- History comes free: approving already wraps every past epoch for the new key (`wrapAllFor`).
- **A stolen device is cut off by removal and rotation, which exist today.** Your other devices keep
  working, and nobody rejoins. This answers #524: per-device keys make revocation enough. "Rejoin with a
  new member key" is needed only once, for keys `kl1` already copied (section 5).
- **No new signature format.** Each device signs as its own member, as members do today.

**The device list.** Each person has one append-only device list:

- It is made of *add* and *revoke* links, each with a version number.
- The first link is signed by the person key: a small sigchain rooted in it (Keybase-style).
- Every later link is signed by a device that is current at that point.
- **The cert is the add link.** A `DeviceCert` is signed by the approving device, not by the person
  key:

  ```ts
  interface DeviceCert {          // one add link in the person's device list
    kind: "kiwi-device-cert"; v: 2
    person: string                // the person key the list is rooted in
    device: string; dxpk: string  // the new device's keys
    label: string; os: string
    role: "app" | "computer"
    at: number; until: number     // 90 days, renewed while the device is listed
    seq: number                   // the list's version after this link
    by: string; sig: string       // the approving device's key and its signature
  }
  ```

- Clients verify a device by walking the list from the person key's root.
- Older owner clients can't: `readMachineCert` rejects v2 fields. A new device's own-computer
  auto-admit therefore falls back to Let in there until those owners update.

**Who may sign list links.**

- Only `role: "app"` devices that hold the **approve permission**, with a person present: the app is
  unlocked and a person taps.
  - A desktop gets the permission when it enrolls.
  - A phone gets it as a permission link that a desktop signs, so phones approve without holding your
    keys (#615).
  - Full keys on a phone only if you opt in.
- Computers (`role: "computer"`, enrolled by `kiwi login`) sign nothing. A compromised agent host
  stays one revocable device and can't become the person.

**Records.**

- Today a handle has one key. A member record needs a "same person, another device" shape, so that
  one human shows once.
- That shape carries your person authority (decision B).
- Until then, older apps show a device as a separate member (for example `jow-2`).

## 2. Enrolling a new device

The new device and the approving app never share a code out of band, so everything passes through the
relay. The digits must therefore be committed before they can be ground: Matrix's SAS, commit then
reveal.

1. **Sign in.**
   - The new device runs the WorkOS device flow (the one `desktop/src/signin.ts` already has;
     `kiwi login` for the CLI).
   - The relay maps the WorkOS user to the person. The first app publishes that mapping, signed by
     its list.
2. **Ask, with a commitment.**
   - The new device makes its keys and a random `nonce_d`.
   - It posts an `EnrollAsk` `{device, dxpk, label, os, at, commit: H(nonce_d ‖ device ‖ dxpk)}`.
   - One pending ask per account, WorkOS-authenticated, rate-limited, gone after 10 minutes.
3. **Answer.** An app of the person's answers with its own keys and a random `nonce_a`.
4. **Reveal.**
   - The new device reveals `nonce_d`, and the app checks it against the commitment.
   - Both compute the digits: `H(nonce_a ‖ nonce_d ‖ both devices' keys)`, as 6 digits.
   - A relay that swaps keys must commit before it sees `nonce_a`, so it can't search for a match.
5. **Confirm, without fatigue.**
   - The approving app asks you to **type the digits shown on the new device** (or pick them out of
     three). A tap alone isn't enough, so a stream of asks from a WorkOS takeover can't be waved
     through.
   - The screen says plainly what the device will get (your channels, as you), and its label and OS.
     That is Signal's 2025 phishing lesson.
6. **Hand over.**
   - The app signs the add link (the `DeviceCert`).
   - It seals an `EnrollAnswer` through the mailbox (`packages/core/src/mailbox.ts`, 10-minute TTL,
     64 KB). The mailbox secret is derived from the ECDH of the two devices' X25519 keys after the
     reveal; there is no code to carry it.
   - The answer holds `{cert, relay, the person's public key and name, the channels it may join
     (codes, not keys)}`, never a secret key.
7. **Check the person's key.**
   - Only the approving app checks the digits, so a relay that answers the ask itself, with a
     device and person it controls, would otherwise get the new device to join that person.
   - The new device shows the person's name and key (`personFingerprint`), the same key the
     approving app shows next to the digits and in Settings. It writes nothing (its device key, the
     list, the person) until you confirm they match. Turning it down drops the grant, and the next
     ask uses a new device key.
   - A device that already holds a person refuses another, and checks again right before it saves.
     `kiwi login` follows the same rules.
8. **Join.**
   - The device asks to join each channel with its `DeviceClaim`.
   - Owners' clients admit it on their own; channels you own admit it immediately.

What the relay sees: public keys, the WorkOS user, commitments and sealed blobs. A WorkOS takeover
gets one pending ask at most. Approving it needs your app in your hand and the digits typed in.

**At the relay** (step 2, `src/relay/account.ts`). Every route takes the WorkOS session
(`x-human-token`); all but the first are also signed by a device key for `account:<user>`.

| Route | Who | What |
| --- | --- | --- |
| `GET /v1/account` | the session | `{user, links}`: the account's device list, empty at first |
| `PUT /v1/account` `{links}` | the person key or an app that approves | binds the account to the list's person, then only accepts lists that extend it |
| `POST /v1/account/ask` `{ask}` | the new device | the `EnrollAsk`; one per account for 10 minutes, 5 a minute |
| `GET /v1/account/ask` | the asking device, an app that approves | the ask with its answer and reveal |
| `PUT /v1/account/ask/<id>/answer` `{device, dxpk, nonce}` | an app that approves | once, with the app's own listed keys |
| `PUT /v1/account/ask/<id>/reveal` `{nonce}` | the asking device | once, after the answer; checked against the commitment |
| `DELETE /v1/account/ask/<id>` | the asking device, an app that approves | turns the ask away |
| `POST /v1/account/move` `{to}` | the person key or an app that approves, with a GitHub sign-in in `x-human-token-to` | moves a WorkOS account to `github_<id>` once (`src/relay/move.ts`) |

**Moving to GitHub sign-in** (T261). A WorkOS account moves to the `github_<id>` account of the
GitHub sign-in sent with it: the device list, the recovery chain, the vault and the owned channels
the quota counts. The move freezes the WorkOS account (reads still answer, writes wait), copies it
into the GitHub account in one step, and only if that account holds nothing, then marks it moved.
From then on the WorkOS account's routes answer from the GitHub one, so older apps keep working, and
channels they create count against the GitHub account. Every step can run again: a repeat changes
nothing, and a freeze nobody finishes ends after 10 minutes, as moved if the copy went through and
untouched if it didn't. Nothing under the WorkOS id is deleted. A GitHub account that already holds
devices, a device waiting to join, or a signer the list doesn't approve is refused, and the WorkOS
account stays as it was.

A key revoked in a published list is refused on every account route, can't ask again, and loses its
computer inbox at once (`/v1/machine/<key>` answers 403 and its socket closes).

A computer can also register its inbox with the device list instead of a `MachineCert`
(`PUT /v1/machine/<key>` `{links}`), when that list has it as a current computer. The person key, or
any current approving device in that list, then counts as its person: asks, unpairing, the online
check and `/v1/person/<pk>/machines`. The relay never rolls the kept list back. Each list the account
accepts reaches its computers, so a revoked or expired desktop stops counting at once. The daemon
checks asks the same way (`readAsk` with the list). Under decision A, this is what lets a desktop
without the person key start agents.

A computer paired by an older `MachineCert` alone keeps working once the person key is offline (T899).
Before the first desktop lets go of the person key, it lists every computer it knows in the device
list. The relay then keeps that list for a cert-registered computer it names, with the same person,
and hands it back when the computer registers its cert again. The daemon takes it only when the list
is its cert's person's and names it as a current computer, and from then on registers with the list. The digits come from
`enrollDigits` in `packages/core/src/enroll.ts`.

## 3. Admitting agents without an app open (delegation)

Today auto-approval needs the owner key, so it only runs while an app with it is open. An
owner-signed **delegation** lets the `kiwi` daemon admit its own computer's agents.

- **The delegation:** the owner key signs `{room, delegate: <the computer's device key>, scope:
  "own-agents", until}`.
- **What the delegate needs:**
  - The channel's epoch keys, sealed to it inside the delegation, and re-wrapped to it on every
    rotation. Admitting means sealing records and wrapping past epochs (`wrapAllFor`).
  - The join requests: those are sealed to the owner's key (`packages/core/src/membership.ts:278`), so
    joiners also seal a copy to each current delegate.
- **What a delegate may sign:** only `kind: agent`, with `from.pk` equal to the delegate itself, no
  owner flag, no `addsAgents` or `answersDecisions`, and scopes no wider than the channel's default.
- **Checks:** the relay accepts a delegated admission that carries its delegation. Clients check the
  chain owner → delegation → delegate when they read member records.
- **Older clients** see a delegated record they can't verify, and show that agent as unverified.
- In the code (T677): `packages/core/src/delegation.ts` (the format, 14 days), the relay's
  `/delegations` (owner), `/delegation` (the delegate's own) and the `admitter` guard, joiners'
  `dpk`/`dbox` copy, and `admitOwn` (`packages/core/src/client/delegate.ts`) for the daemon.
  A rotation re-wraps to every live delegate; one without a wrap is dropped. `cutDevices` drops a
  revoked computer's delegations.
- In the daemon (T683): `src/daemon/admit.ts` runs `admitOwn` for a channel when `kiwi join` on
  this computer pokes it (`admit` verb, while the request waits), when one of its seats gets a
  `request` frame, and once per known channel at start. It keeps looking while a request of its
  own waits on the joiner's reveal, for up to 30 minutes.
- In the owner's app (T684): `packages/app/src/delegations.ts` runs `tendDelegations`
  (`packages/core/src/client/delegations.ts`) in the approval loop for each owned channel, at most
  hourly unless the computers change. The computers are the app's own and approved ones, plus the
  device list's current `computer` entries. It delegates to each one without a delegation, or
  with fewer than 7 days left; drops the rest and rotates; and re-signs the records a delegate
  signed with the owner key. Forget computer calls `dropDelegates` before removing its agents, so
  their removal rotates past it.

## 4. Revocation and expiry

**Revoking.**

- Forget adds a revoke link to your device list. It is kept on the relay's account record and posted
  into every channel you're in, as a new op that older clients fold to nothing (since 54313c33,
  2026-10-21).
- **The relay stays blind** (Jow, #1011). As soon as it sees a valid revoke link, it refuses the
  revoked key on every account route and closes that computer's inbox. It never learns which member
  keys belong to which device, so it can't cut those keys from a channel.
- **Owners cut the channel access.** Their apps remove that device's member keys and rotate. Until an
  owner's app comes online, the revoked device can still read that channel.
- **Revoking a computer also removes its agents:** the members whose `from.pk` is that machine.
- **Revoking an older device** (enrolled before the signer) shows a notice on every one of your
  devices. A thief holding a newer device can't quietly revoke the rest.
- **Versions.** Clients take the highest list version seen across the account record and every
  channel log. "The relay can't roll it back" holds for any client that has seen a newer version
  anywhere.
- An honest lost device that sees itself revoked wipes its keys. A stolen one is cut off by the relay
  and by rotation, not by its own cooperation.
- In the code (T641): the list travels in a `devices` event (`{links}`), and member records name the
  device key (`device.pk`). `Channel.cutDevices(list)` removes a revoked device's members, and a
  revoked computer's agents, in one rotation. `requests({lists})` checks claims against the newest
  list seen. Device members admitted before T641 carry no device key, so they are removed by hand.
- On the desktop (T1006):
  - The app posts its list into every channel it's in whenever the list grows.
  - An owner's app reads the lists posted in its channels, cuts what they revoke, and checks joins
    against the newest one.
  - A desktop with no person key that sees itself revoked deletes its device key, its list, and the
    channels it joined. Channels it created stay, because their owner key exists nowhere else.
  - A desktop holding the person key is told and stops signing links, but keeps its keys: the person
    key is what re-roots the list.
- In the `kiwi` daemon (T1007): when its seats read a `devices` event of this computer's person, a
  longer list replaces the one in `machine.json`. If the list revokes this computer, it drops
  `machine.device`, so its agents stop carrying a device claim. It keeps its seat keys: owners cut
  those. The daemon keeps no WorkOS session after `kiwi login`, so channel logs are its only source.
- On phones (T1007, `ios/engine`, shared by iOS and Android): the same, from the channels the phone
  reads. A list that revokes the phone stops the engine, and the app wipes its vault (the device key,
  the links, the person and the channels it joined) and says on the sign-in screen which device
  removed it.

**Expiry.**

- `DeviceCert.until` is 90 days.
- An app renews each listed device's cert as it nears the end, sealed to the device's inbox.
  - The desktop renews every device within 14 days of its end, at most once every 6 hours, into the
    list on the account record; the device reads it there (T1006). Computers read it from the
    channel logs (T1007).
- A cert past `until` isn't admitted on its own; it waits for Let in.
- Old `MachineCert`s (v1, no `until`) stay valid until removed. Daemons on kiwi 2026.10.4 can't renew,
  so expiring them would stop every existing computer's agents. Revocation is what cuts them off.

## 5. Retiring kl1 and kp1

**The order, each step one PR:**

1. **Core:** the device list (links, verification from the root), `DeviceCert` v2, `DeviceClaim`, and
   auto-admit of a person's devices.
2. **Relay:** the account record (WorkOS user → person, device list), the enrollment inbox with
   commit-reveal, and refusing revoked keys.
3. **Desktop:** the approve screen (typing the digits), Settings → Devices (rename, forget, renew), and
   enrolling as a new desktop.
4. **CLI:** `kiwi login` enrolls a computer (replaces `kp1` on the CLI).
5. **iOS**, then **Android:** sign in, enroll, and approve (replaces `kl1`).
6. **Revocation and expiry:** the list posted into channels, removing a computer's agents, renewal.
7. **Delegation** for the daemon.
8. **Recovery vault.**
9. **Remove** `kl1` and `kp1` (done in T112):
   - `packages/core/src/link.ts`, `desktop/src/link-host.ts`, `desktop/src/ipc/linking.ts`, and the iOS
     and Android link screens;
   - `src/daemon/pair.ts`, `desktop/src/pairing.ts`, `desktop/src/ipc/pairing.ts`, and `kp1` in
     `kiwi setup`, `doctor` and `help`.

**Migrating `kl1` phones, once.** They hold copies of the person key and every channel's member key.
For each phone:

1. Enroll it as a real device.
2. Re-key: a new person key and a new member key in every channel it joined. This is the one time
   "rejoin with a new member key" is needed (#524).

The re-key cascades:

- A new person key orphans every `kp1` `MachineCert` v1, and the `person` field in your member
  records.
  - Your computers are re-certified in the new list.
  - Records are owner-signed, so in channels you don't own, the owner's app re-signs yours when it
    sees the hand-over.
- **Which hand-over wins.** The hand-over link is signed by the old person key, which the phone also
  holds. A thief could therefore sign a competing one.
  - A hand-over must also be signed by the **recovery key** (section 6), which a phone never holds.
  - Without a recovery key set up, migration waits until there is one.
- A **lost** `kl1` phone can't be fixed by revocation. Channels you own also need the owner answer
  (decision C), or recreating.

## 6. Recovery vault

For when every app is gone, or a thief revoked your other devices first. The recovery key
**re-roots** the device list, as Keybase's paper keys do.

- **What it holds:** your person key, and the owner keys of channels you own.
- **Recovery key:** a **generated** 24-word BIP39 phrase (256 bits). HKDF over it derives two keys: an
  Ed25519 recovery key, which signs re-roots and its own replacement, and an X25519 key that opens the
  vault. Never a password, which the relay could guess offline.
- **The recovery chain** holds the public halves, kept beside the device list rather than in it, so older
  clients still read the list. The person key signs the first link. The recovery key replaces itself at
  once; an approving device may propose a new one, which takes over only after 7 days. Your devices show
  the proposal meanwhile, and the old words, or revoking the device that proposed it, cancel it.
- **Format:** `{person, version, at, box}`. The box is sealed to the recovery X25519 key, with person,
  version and time bound into the key derivation. Inside, the person key is a box of its own, sealed to
  the same recovery key with person and recovery key bound in (`sealPerson`, T899), so a device that
  no longer holds the person key carries it into each new version unread, and the vault is signed by the person key or any of
  its current approving devices (decision A keeps the person key offline, so a device must be able to
  add a new channel's owner key). Stored at `/v1/account/vault`. Clients remember the highest version
  and refuse a lower one.
- **The relay** keeps the chain and the newest vault at `/v1/account/vault`. `GET` needs only the sign-in,
  so a new desktop with nothing but the 24 words can read them. `PUT` takes `{recovery, vault}`, signed by
  the person key, the recovery key or a current approving device. The chain must extend the one kept,
  and each new link must carry the relay's time, so a proposal can't be backdated past its 7 days. A
  vault must be version kept + 1, signed by the person key or a current approving device, and at most
  512 KB. Links and vaults from revoked devices are refused.
- In the code (T693, T823): `packages/core/src/recovery.ts`, `src/relay/account.ts`.
- **Passkeys later:** per-passkey wrapping where native passkey PRF exists (macOS 15 and iOS 18 through
  AuthenticationServices; Android Credential Manager). Never in a page the relay serves, which would
  see the unlock key.

## Decisions (Jow, #602 and #615)

**A. The person key lives offline after setup.**

- Once the first app has signed the device list's root, the person key stays only in the recovery
  vault (paper-key style), and the first desktop becomes a device like the rest.
- In the code (T899, `desktop/src/recovery.ts`): once the 24 words are checked and the vault is kept,
  the first desktop lists its computers and drops the person secret from its store. It keeps only the
  sealed person box, to reseal the vault when a channel it owns appears. It doesn't let go while a
  device's proposed recovery key is waiting, and never seals the person key to a key a device proposed.
  An app that set up its words before T899 does the same on its next poll. Joins are proven with the
  device claim alone.
- After that, new words need the old ones (or a re-root, T827): no app holds the person key to seal
  to a new recovery key.
- Whoever holds the person key can re-root the list. Keeping it offline means a stolen desktop can't
  beat the vault.
- Re-rooting, and the `kl1` migration, then need the recovery key in hand.

**B. Your other devices keep your authority.**

- The "same person, another device" record carries person authority: directing agents and answering
  decisions, the owner's included.
- It does **not** carry owner-key powers (admitting, removing, rotating).
- Your phone still counts as "your own human" and "the channel owner" to agents.

**C. Owner-key delegation.**

- The owner key signs `{room, device member key, until}`, which the relay and clients accept for
  owner routes and records. That is Matrix's master / self-signing split, and section 3 is its narrow
  case.
- The owner key stays offline with the person key (A) and in the vault.
- Until the relay and clients ship it, the owner key stays on the device that created the channel,
  and Settings lists plainly which devices hold it.

**Phones approve through a permission (#615).** A phone approves new devices with a permission a
desktop signs. Full keys on a phone only if you opt in.

Thanks to sunny-tortoise's comparison of Signal, Matrix, Keybase and Apple (T536, #559) and review
(#570): every one gives each device its own keys, keeps a device list the server can't forge or roll
back, and revokes by dropping a device and re-keying what it could read.

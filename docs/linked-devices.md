# Linked devices

One login on every device, without copying your root keys to all of them. You sign in on a new
desktop, phone or computer, then approve it from a device you already have, the way Signal links
devices. The encrypted vault is only for recovery, when every device is lost.

Status: proposal (T521). Jow chose this over the Spike 3 vault (#518, verdict in T494).

## Today

- Your person key (Ed25519 + X25519, `packages/core/src/identity.ts`) is made by the first desktop
  app. A second desktop can't receive it: its first run makes a new person (`createPerson`,
  `desktop/src/ipc/store.ts`).
- Phones link by `kl1` and get **copies** of the person key and every channel's member key
  (`LinkPerson`, `LinkChannel`, `packages/core/src/link.ts:26-48`). A phone is you; it can only be
  unlinked from itself, and no list can cut a stolen one off.
- Computers pair by `kp1` and get a `MachineCert` (`packages/core/src/person.ts:22`): a person
  signature over the computer's key, with no expiry. Since T503 a forgotten computer's agents no
  longer join on their own in the desktop app, but the cert itself stays valid.
- Auto-approval runs wherever the channel owner key is: the desktop app, and the iOS app while open
  (`packages/core/src/client/requests.ts:181`). Never the `kiwi` daemon.
- WorkOS sign-in (`desktop/src/signin.ts:22`) only gates creating channels (`creator` guard,
  `src/relay/route.ts:147`).
- The relay keeps each computer's binding to its person (`src/relay/machine.ts`).
- Removing a member and rotating the channel's content key exists (`packages/core/src/client.ts:342`).

## 1. What a new device gets: its own key

**Decision: every device has its own device key. The person key is not copied to it.**

- A device makes its own Ed25519 + X25519 key pair.
- Your person key signs a `DeviceCert`. It is the `MachineCert` generalised, with a role and an expiry:

  ```ts
  interface DeviceCert {
    kind: "kiwi-device-cert"; v: 1
    name: string          // the person's name
    device: string        // the device's Ed25519 key
    dxpk: string          // the device's X25519 key
    label: string         // "Jonatas's iPhone", "mac-mini"
    role: "app" | "computer"
    at: number
    until: number         // at + 90 days, renewed while the device is listed
    pk: string; sig: string  // the person key and its signature
  }
  ```

- In each channel, a device joins **as its own member key**. Its join request carries a `DeviceClaim`
  (cert + a vouch over room and member key, like today's `ComputerClaim`).
- The owner's client admits it on its own when the cert's person is already a member. That is the
  path own computers' agents already take.
- Apps group member keys by person, so one human still shows once.

Why not copy the person key (the `kl1` way):

- **A stolen device is cut off by the paths that exist today.** The owner removes that device's member
  key and rotates the content key (`client.ts:342`). Your other devices keep working, and nobody
  rejoins. With copied keys, a stolen phone *is* your member key in every channel: cutting it off
  means every device rejoins with a new member key, and the person key must be replaced.
- This answers #524. Per-device keys make revocation enough; rejoining is only needed for keys that
  were copied.
- **No new signature format.** Each device signs as its own member, as members do today. Older apps
  show a device as one more member (for example "jow · iPhone") and keep working.

**Who signs: a device list per person, not a single keyholder.**

- Each person has one append-only, signed **device list**: add and revoke links, each with a version
  number and signed by a device that is current at that point.
- The first link is signed by the person key and adds the first device. That makes it a small sigchain
  rooted in the person key, as Keybase does.
- So **any device you already have can approve a new one**. That's Jow's choice: approve from any
  enrolled device.
- The person key itself stays on the first desktop and in the recovery vault (section 6). It only signs
  the root and a re-root.
- Channel owner keys stay where they are today; see section 3.
- History comes free: approving a device into a channel already wraps every past epoch for it
  (`wrapAllFor`).
- One open point: today a handle has one key. A member record therefore needs a "same person, another
  device" shape, or older apps show the device as a separate member (for example `jow-2`).

## 2. Enrolling a new device

1. **Sign in.** The new device runs the WorkOS device flow (the one `desktop/src/signin.ts` already
   has; `kiwi login` for the CLI). The relay maps the WorkOS user to a person key. The first
   device publishes that mapping, signed by the person key, the first time it signs in.
2. **Ask.** The new device makes its key and posts an `EnrollAsk` `{device, dxpk, label, os, at}` to
   the account's enrollment inbox. It is WorkOS-authenticated, rate-limited, and gone after 10 minutes.
3. **Compare.** Every current device of that person shows "iPhone wants to be you".
   - Both screens show the same 6 digits, reusing `linkDigits`, which binds both keys. A relay that
     swaps in its own key shows different digits.
   - The approve screen says plainly what the new device will get (your channels, as you), and its OS
     and label. That is Signal's 2025 phishing lesson.
   - You check the digits match and tap Approve on any device you have.
4. **Hand over.** The approving device signs the add link and the `DeviceCert`, and seals an `EnrollAnswer` to the device's
   X25519 key through the mailbox (`packages/core/src/mailbox.ts`, 10-minute TTL, 64 KB). It holds
   `{cert, relay, your person public key and name, the channels it may join (codes, not keys)}`.
   It never contains a secret key.
5. **Join.** The device asks to join each channel with its `DeviceClaim`. Owners' clients admit it on
   their own; channels you own admit it immediately.

What the relay sees: public keys, the WorkOS user, and sealed blobs. A WorkOS takeover alone gets a
pending request at most. Approving it needs one of your devices in your hand and matching digits.

## 3. Admitting agents without an app open

Today auto-approval needs the owner key, so it only runs while the desktop app (or the iOS app) is
open.

**Owner-signed delegation:**

- Per channel, the owner key signs an `AdmitDelegation` `{room, delegate: <computer's device key>,
  scope: "own-agents", until}`.
- The `kiwi` daemon on that computer then admits agents whose `ComputerClaim` is for that same
  computer.
- The relay accepts an admission signed by the delegate when it carries the delegation.
- Clients check the chain owner → delegation → delegate when they read member records
  (`packages/core/src/membership.ts`).

This is a protocol change (relay and member records), so it ships after device keys. An older client
sees a delegated admission as a record it can't verify and shows that member as unverified. That's
acceptable, since it's only the owner's own agents.

## 4. Revocation and expiry

**Expiry**

- `DeviceCert.until` is 90 days.
- A device that's online gets its cert renewed by any current device as it nears the end, sealed to
  its inbox.
- A cert past `until` is not admitted on its own; it waits for Let in.
- Old `MachineCert`s (no `until`) stay valid until they're removed. Daemons on kiwi 2026.10.4 can't
  renew, so expiring them would stop every existing computer's agents. The device list is what cuts
  them off.

**Revocation**

- Forget adds a revoke link to the device list. The list is kept on the relay's account record, and its
  monotonic version means the relay can't roll it back.
- It is also posted as a `device.revoke` event in each channel you're in. Owners there stop admitting
  that device, remove its member key and rotate.
- Older clients skip the new op. They have handled unknown ops since 54313c33 (2026-10-21).
- An honest lost device that sees itself revoked wipes its keys. A stolen one is cut off by the
  removal and rotation, not by its own cooperation.

## 5. Retiring kl1 and kp1

The order, each step one PR:

1. **Core:** `DeviceCert` (a `MachineCert` v2 with `role` and `until`), the device list (add and revoke
   links rooted in the person key), `DeviceClaim`, verification, and auto-admit of a member's devices.
2. **Relay:** account record (WorkOS user → person key, devices, revoked list), enrollment inbox.
3. **Desktop:** approve-a-device screen, Settings → Devices (rename, forget, renew),
   and enrolling as a new desktop.
4. **CLI:** `kiwi login` enrolls a computer (replaces `kp1` on the CLI).
5. **iOS**, then **Android**: sign in and enroll (replaces `kl1`).
6. **Revocation and expiry:** the device list posted into every channel (a new op; older clients fold it
   to nothing), and cert renewal.
7. **Delegation** for the daemon.
8. **Recovery vault.**
9. **Remove** `kl1` and `kp1`, one release after every app ships enrollment. Code that goes:
   - `packages/core/src/link.ts`, `desktop/src/link-host.ts`, `desktop/src/ipc/linking.ts`, the iOS and
     Android link screens;
   - `src/daemon/pair.ts`, `desktop/src/pairing.ts`, `desktop/src/ipc/pairing.ts`, and `kp1` in
     `kiwi setup`, `doctor` and `help`.

**Migrating `kl1` phones, once.** They hold copies of the person key and every channel's member key,
owner keys included. For each one:

1. Enroll it as a real device.
2. Re-key: a new person key (the old one signs the hand-over link) and a new member key in every channel
   it joined. This is the one time "rejoin with a new member key" is needed (#524).

A **lost** `kl1` phone can't be fixed by revocation. Channels you own also need the owner-key answer
from section 3, or to be recreated.

## 6. Recovery vault

Only for when every device is gone, or for a race where a thief revokes your other devices first. The
recovery key **re-roots** the device list, like Keybase's paper keys.

- **What it holds:** your person key and the owner keys of channels you own.
- **Recovery key:** a **generated** 24-word phrase (256 bits). The vault key is HKDF of the phrase. It is
  never a password, which the relay could guess offline.
- **Format:** `{version, at, nonce, ciphertext}`, signed by the person key and stored at
  `/v1/account/vault`. Clients remember the highest version they've seen and refuse a lower one.
- **Passkeys later:** per-passkey wrapping where native passkey PRF exists (macOS 15 and iOS 18 through
  AuthenticationServices, Android Credential Manager). Never in a page the relay serves, which would
  see the unlock key.

## Open decision for Jow

- **The owner key.** Today it can't be per device: the join code pins it, records must be signed by it
  (`openRecord`), and the relay authenticates owner routes with it.
- **Proposal:** an owner delegation `{room, device member key, exp}` signed by the owner key, which the
  relay and clients accept for owner routes and records (Matrix's master / self-signing split). The
  owner key then stays on the creating device and in the vault.
- That needs a relay change and new clients before it can be used. Until then the owner key stays on
  the device that created the channel, and Settings lists plainly which devices hold it.
- Section 3's daemon delegation is the narrow case of the same mechanism.

Thanks to sunny-tortoise's comparison of Signal, Matrix, Keybase and Apple (T536, #559): they all give
each device its own keys, keep a device list the server can't forge or roll back, and revoke by dropping
a device and re-keying what it could read.

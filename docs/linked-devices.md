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

The person key stays on **keyholders**:

- the first desktop, plus any device you explicitly promote (promotion copies the person key, with a
  warning);
- the recovery vault (section 6).

Keyholders approve new devices and sign certs. Channel owner keys stay on keyholders as well.
Section 3 covers admitting agents without one open.

## 2. Enrolling a new device

1. **Sign in.** The new device runs the WorkOS device flow (the one `desktop/src/signin.ts` already
   has; `kiwi login` for the CLI). The relay maps the WorkOS user to a person key. A keyholder
   publishes that mapping, signed by the person key, the first time it signs in.
2. **Ask.** The new device makes its key and posts an `EnrollAsk` `{device, dxpk, label, os, at}` to
   the account's enrollment inbox. It is WorkOS-authenticated, rate-limited, and gone after 10 minutes.
3. **Compare.** Every keyholder of that person shows "iPhone wants to be you". Both screens show the
   same 6 digits, derived from the person key, the device's two keys and a fresh nonce. You check the
   digits match and tap Approve on the keyholder. The digits cover the device's keys, so a relay that
   swaps in its own key shows different digits.
4. **Hand over.** The keyholder signs the `DeviceCert` and seals an `EnrollAnswer` to the device's
   X25519 key through the mailbox (`packages/core/src/mailbox.ts`, 10-minute TTL, 64 KB). It holds
   `{cert, relay, the channels it may join (codes, not keys)}`.
5. **Join.** The device asks to join each channel with its `DeviceClaim`. Owners' clients admit it on
   their own; channels you own admit it immediately.

What the relay sees: public keys, the WorkOS user, and sealed blobs. A WorkOS takeover alone gets a
pending request at most. Approving it needs a keyholder in your hand and matching digits.

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
- Keyholders renew every listed device's cert as it nears the end, sealed to the device's inbox.
- A cert past `until` is not admitted on its own; it waits for Let in.
- Old `MachineCert`s (no `until`) count as expiring 90 days after the device-key release, so that
  existing computers get renewed and nothing stops at once.

**Revocation**

- Forget in Settings puts the device on a person-signed `RevokedDevices`
  `{person, devices[], version, at}`.
- It is kept on the relay's account record, with a monotonic `version`, so the relay can't roll it
  back.
- It is also posted as a `device.revoke` event in each channel you're in. Owners there stop admitting
  that device, remove its member key and rotate.
- Older clients skip the new op. They have handled unknown ops since 54313c33 (2026-10-21).
- An honest lost device that sees itself revoked wipes its keys. A stolen one is cut off by the
  removal and rotation, not by its own cooperation.

## 5. Retiring kl1 and kp1

The order, each step one PR:

1. **Core:** `DeviceCert`, `DeviceClaim`, verification, and auto-admit of a member's devices.
2. **Relay:** account record (WorkOS user → person key, devices, revoked list), enrollment inbox.
3. **Desktop:** approve-a-device screen, Settings → Devices (rename, forget, renew), the keyholder role,
   and enrolling as a new desktop.
4. **CLI:** `kiwi login` enrolls a computer (replaces `kp1` on the CLI).
5. **iOS**, then **Android**: sign in and enroll (replaces `kl1`).
6. **Revocation and expiry:** `device.revoke` and cert renewal.
7. **Delegation** for the daemon.
8. **Recovery vault.**
9. **Remove** `kl1` and `kp1`, one release after every app ships enrollment. Code that goes:
   - `packages/core/src/link.ts`, `desktop/src/link-host.ts`, `desktop/src/ipc/linking.ts`, the iOS and
     Android link screens;
   - `src/daemon/pair.ts`, `desktop/src/pairing.ts`, `desktop/src/ipc/pairing.ts`, and `kp1` in
     `kiwi setup`, `doctor` and `help`.

Phones linked by `kl1` today hold copies of your keys. After step 5 the app asks them to enroll,
rotates the channels they were in, and drops the copies.

## 6. Recovery vault

Only for when every keyholder is gone.

- **What it holds:** your person key and the owner keys of channels you own.
- **Recovery key:** a **generated** 24-word phrase (256 bits). The vault key is HKDF of the phrase. It is
  never a password, which the relay could guess offline.
- **Format:** `{version, at, nonce, ciphertext}`, signed by the person key and stored at
  `/v1/account/vault`. Clients remember the highest version they've seen and refuse a lower one.
- **Passkeys later:** per-passkey wrapping where native passkey PRF exists (macOS 15 and iOS 18 through
  AuthenticationServices, Android Credential Manager). Never in a page the relay serves, which would
  see the unlock key.

## Open decision for Jow

- **Phones and owner actions.** Under device keys, a phone isn't a keyholder, so it can't approve joins
  in channels you own unless delegation (section 3) is extended to it.
- **Option a:** a phone can be promoted to keyholder. It copies the keys, with the warning that losing
  it means replacing your person key.
- **Option b:** phones never hold the person key, and approve through delegation.
- Recommendation: **b**, with **a** available for people who want it.

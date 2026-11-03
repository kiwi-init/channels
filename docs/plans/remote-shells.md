# Plan: a shell on any of your computers

Status: approved by Jow, 2026-11-03 (#67), with shells on by default (T50, from #38 and the screenshot
in #41). Nothing is built yet.

## Why you can't pick a computer today

- The drawer's terminal reaches only this computer: `desktop/src/terms.ts` dials the daemon's local
  socket (`daemonSocketPath`) and asks it for `mine`, `term`, `term-keys` and `term-size`.
- The **+** in the drawer (`ui/src/term/drawer.tsx`) always means "a new shell here".
- Nothing carries a terminal stream through the relay. What does go through the relay today is a
  **machine ask**: a small request, sealed to one computer and signed by one of your devices
  (`packages/core/src/machine-ask.ts`). The computer reads it from its inbox socket
  (`src/daemon/inbox.ts`) and answers through a mailbox. Asks start agents on another computer,
  so the trust path we need already exists.

## What you get

- **+** lists your computers: this one first, then each computer signed in to your account, with a
  dot for online.
- Pick one and a shell opens there, in the drawer, like a local one.
- Tabs say which computer they run on (`vps · 1`) once you have shells on more than one computer.
- Closing the drawer leaves the shell running, as it does today. Its **×** ends it.
- The VPS needs `kiwi login` and a running daemon, nothing more.

## Who may open a shell

- Only your own devices: a signer that speaks for your person in your device list
  (`speaksForPerson`), the same check `readAsk` already makes for launches.
- That covers your desktops. Computers sign nothing (`role: "computer"`), so the VPS can't open a
  shell on your Mac, and an agent host stays one revocable device.
- Phones: none. The phone app is Conversation and Tasks only.
- **On by default** (Jow, #67). `kiwi shells off|on|status` sets it, and only on that computer: no
  remote switch, so a stolen desktop can't turn shells back on where you turned them off.
  A shell is the computer's whole user account, wider than a launch.

## How it connects

1. **Ask.** The app sends a machine ask with a new verb, `shell`:
   `{want: "new" | "%3", cols, rows, pipe, epk}`. `pipe` is a random 16-byte id; `epk` is a fresh
   X25519 public key for this shell only.
2. **Check.** The daemon reads it with `readAsk`, as it does a launch: sealed to it, signed by a
   current device of its person, at most 2 minutes old, never seen before. Then: shells on, at most
   4 open remote shells, at most 10 opens a minute.
3. **Answer.** The daemon makes its own X25519 key for the shell, opens the tmux pane (`hosted.mine`,
   as the local `mine` does) and answers through the mailbox, signed by its computer key
   (`signAnswer`): `{epk, pane, window, cols, rows}`. The app knows the computer's key from your
   device list, so a relay can't answer in its place.
4. **Pipe.** Both ends open a websocket at `/v1/machine/<key>/pipe/<pipe>`, on the computer's
   existing `MachineInbox` Durable Object:
   - the app's side signed by a device that speaks for the computer's person (the inbox's
     `isPerson` check);
   - the computer's side signed by the computer key;
   - one socket per side; a pipe nobody joins within 30 seconds is gone.
   The relay forwards the frames unread.
5. **Keys.** `HKDF(ECDH(both shell keys), pipe ‖ ask id ‖ computer key)` gives one AES-GCM key per
   direction. Fresh keys per shell, thrown away when it ends: a later stolen key reads no old shell.

## The stream

- Binary frames: `seq` (4 bytes) then AES-GCM ciphertext. The nonce comes from the direction and
  `seq`; the pipe id is the AD.
- `seq` goes up by one each frame. A frame out of order or one that fails to open ends the pipe.
- Inside, the same messages as the local socket: `{out}`, `{ended}` from the computer; `{keys}`,
  `{size}`, `{close}` from the app. The first `out` is the pane's `seed`, so a reopened shell shows
  its screen.
- At most 64 KB a frame. The daemon batches output every 16 ms (the local socket batches every
  8 ms): fewer Durable Object messages, and nothing you can see.
- The tab list asks the same way: verbs `shell-tabs` and `shell-close`, answered through the
  mailbox, no pipe.

## Offline

- **+** shows an offline computer greyed out, with when it was last seen
  (`/v1/person/<pk>/machines` already says `online` and `seenAt`). It can't be picked.
- A computer with shells off shows "Shells off" and the line to run there: `kiwi shells on`.
- A computer whose kiwi predates the `shell` verb shows "Update kiwi there".
- A pipe that drops (Wi-Fi, a sleeping laptop, the relay restarting) shows "Reconnecting…" on its
  tab. The app asks again for the same pane: new keys, new pipe, the screen from `seed`. That retries
  for 2 minutes, then reads "vps is offline. Your shell keeps running there."
- The tmux pane never depends on the pipe: it runs until its × or `exit`.

## Revoked devices

- Forgetting a desktop ends every shell it opened: the daemon reads the longer device list from the
  channel logs (T1007) and closes that device's pipes.
- The relay refuses a revoked key on the pipe route, as on every machine route.
- `remote.log` on the computer records each open and close: which device, which pane, when.

## The order, one PR each

1. **Core:** the `shell`, `shell-tabs` and `shell-close` verbs in `machine-ask.ts`, and the pipe's
   key derivation and framing.
2. **Relay:** the pipe route in `worker.ts` (`MachineInbox`) and `bun.ts`, for self-hosting too.
3. **Daemon:** `kiwi shells`, the verbs, the pipe client, the caps, closing on revoke, `remote.log`.
4. **Desktop:** `terms.ts` opens a remote shell through the pipe behind the same `TermOpenView`, so the
   drawer can't tell them apart.
5. **UI:** the computer list on **+**, computer names on tabs, Reconnecting and offline.

## Not in this plan

- An agent's own pane on another computer (the drawer's other mode). The same pipe can carry it later.
- Files, ports, copying between computers.

## Decisions (Jow, #67)

1. **Shells are on by default** on every computer you sign in; `kiwi shells off` on a computer stops
   them there.
2. **Desktops only**; phones have no terminal.

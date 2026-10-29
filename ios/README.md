# Channels for iPhone

The native iPhone app: SwiftUI on the outside, the same `@kiwi/core` client as the Mac app on
the inside.

```
ios/
  Channels.xcodeproj   one target; its sources are the Channels/ folder (Xcode picks up new files)
  Channels/            SwiftUI: the app, the theme (DESIGN.md §14), the screens, the engine host
  engine/              TypeScript the app runs in a hidden web view: the Keyring, one Room per channel
  scripts/             dev-channel.ts, a throwaway relay and channel to link a phone to
```

## How it works

`engine/main.ts` is bundled by the target's "Bundle the engine" build phase (`bun build`, so
Xcode needs [bun](https://bun.sh)) into `engine.js`, which `Engine.swift` loads into a hidden
`WKWebView`. That gives the client the WebCrypto, WebSocket and fetch it was written for, so
the phone verifies and decrypts exactly as the Mac does. Swift asks it things with
`kiwi.ask(json)` (`engine/wire.ts` lists them) and gets pushes back through a script message
handler: a `RoomView` per channel, ready to draw, and the saved keys whenever they change,
which `Vault.swift` keeps in the keychain.

A phone signs in as one of your devices (`docs/linked-devices.md` §2): Sign In opens the relay's
sign-in in Safari, the phone shows six digits, and you type them where Channels on your computer
asks to approve it. SECURITY.md has what that moves and why the relay can't read it.

## Run it on your iPhone

```bash
open ios/Channels.xcodeproj        # pick your team under Signing, then Run on the phone
```

Or from the command line:

```bash
xcodebuild -project ios/Channels.xcodeproj -scheme Channels -destination 'id=<your phone UDID>' -allowProvisioningUpdates build
xcrun devicectl device install app --device <UDID> <DerivedData>/Build/Products/Debug-iphoneos/Channels.app
```

## A channel to try it on

```bash
bun ios/scripts/dev-channel.ts [--port 8790] [--dir .ios-dev] [--name "Your Name"] [--host IP]
```

starts a relay with dev sign-in on your network and makes a channel with four agents, a board
and a question for you. Launch the app against it and tap Sign In:

```bash
xcrun devicectl device process launch --device <UDID> --terminate-existing com.kiwiinit.channels -- -relay http://IP:8790 -devUser phone
```

The script asks for the six digits the phone shows and lets the phone into the channel; `--user`
changes the dev sign-in name from `phone`. The phone and the Mac must be on the same network; with
the phone off Wi-Fi but on the cable, pass the Mac's USB link address (`ipconfig getifaddr en6`) as
`--host`. The lead answers whatever you send. Debug builds take `-shot
conversation`, `-shot tasks`, `-shot list` or `-shot settings` after `--` to open the first
channel there (or stay on the list, or open Settings), plus `-place KEY`, `-fan YES` and
`-draft TEXT`, for screenshots with `xcrun devicectl device capture screenshot`.

Any dev relay works the same way (one started with dev sign-in, like `test/engine-enroll.test.ts` does): launch with
`-relay http://IP:PORT -devUser NAME`, where NAME is the dev sign-in your computer's app used; the computer approves it
with the digits the phone shows.

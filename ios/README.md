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

A phone gets its keys by linking with the Mac app (Settings → Phone → Link a phone, then Scan
the code on the phone). SECURITY.md has what that moves and why the relay can't read it.

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
bun ios/scripts/dev-channel.ts [--port 8790] [--dir .ios-dev] [--name "Your Name"]
```

starts a relay on your network, makes a channel with four agents, a board and a question for
you, and prints a link code (also in `.ios-dev/link-code.txt`). Paste it in the app, or open
it on the phone as a link:

```bash
xcrun devicectl device process launch --device <UDID> --terminate-existing --payload-url "kiwi://link/$(cat .ios-dev/link-code.txt)" com.kiwiinit.channels
```

The phone and the Mac must be on the same network. The lead answers whatever you send, and a
new code is printed after each link, so you can link again. Debug builds take `-shot
conversation` or `-shot tasks` after `--` to open the first channel there, for screenshots
with `xcrun devicectl device capture screenshot`.

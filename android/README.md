# Channels for Android

The native Android app: Kotlin and Jetpack Compose (Material 3, the phone's own colors) on the
outside, the same engine as the iPhone app on the inside.

```
android/
  app/src/main/java/com/kiwiinit/channels/
    engine/    Engine.kt hosts the engine in a hidden WebView; Wire.kt is its wire, typed
    model/     AppModel (state, sends, read marks, pins), Vault (keys sealed by the Android
               Keystore), Lock (biometrics or the screen lock after 30 s away)
    theme/     colors, radii, the prism
    ui/        the screens: conversations, a conversation, its dock, details, settings, linking
  gradle/      the wrapper and libs.versions.toml
```

## How it works

The Gradle build runs `bun build ios/engine/main.ts` (browser target, IIFE) into the APK's assets,
so building needs [bun](https://bun.sh) and the repo's `bun install`. `Engine.kt` loads it into a
WebView at `http://localhost/` (a secure context, so WebCrypto's Ed25519 and X25519 are there; the
WebView must be recent, which Android System WebView from the Play Store is). Kotlin asks it things
with `kiwi.ask(json)` (`ios/engine/wire.ts` lists them) and the answers come back through the
`kiwiAndroid` bridge, as do the pushes: a `RoomView` per channel, ready to draw, and the saved keys
whenever they change, which `Vault.kt` seals with a Keystore AES-GCM key in no-backup storage.

A phone signs in as one of your devices (`docs/linked-devices.md` §2): Sign in opens the relay's
sign-in in the browser, the phone shows six digits, and you type them where Channels on your computer
asks to approve it. The phone keeps its own key, never your person key, and asks to join the channels
your computer holds; the ones you own let it in while the app is open there.

It can also link with the Mac app the old way (Settings → Phone → Link a phone): scan its code
(Google's code scanner, no camera permission), paste it, or open a `kiwi://link/…` link.

## Install it on a phone

No emulator needed. Every push to main builds a release APK in CI (`android / build`), and so does
a branch's ci.yml run dispatched with `jobs: android`; download the `channels-android` artifact from the run, unzip it, and open
`app-release.apk` on the phone (allow installs from your browser or files app), or with the phone
on USB and debugging on:

```bash
adb install -r app-release.apk
```

The APK is signed with the debug key in `app/debug.p12` (password `android`), the same in every
build, CI's and yours, so a newer build installs over an older one without unlinking. It's a
development key, public on purpose: a store release needs its own.

## Build it yourself

With JDK 17 and the Android SDK (`ANDROID_HOME`, platform 37):

```bash
bun install
cd android && ./gradlew assembleRelease     # app/build/outputs/apk/release/app-release.apk
./gradlew recordRoborazziRelease            # app/build/screens/*.png: every screen, light and dark
```

CI draws the same screens in `android / build` and keeps them as the `android-screens` artifact,
so a change to a screen can be looked at without a phone.

## A channel to try it on

`bun ios/scripts/dev-channel.ts --host <your Mac's LAN IP>` starts a relay and a channel with a few
agents and prints a link code. The app allows plain `http://` relays for this, as the iPhone app
allows local networking.

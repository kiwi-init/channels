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

## Install it on a phone

No emulator needed. Every push to main builds a release APK in CI (`android / build`), and so does
a branch's ci.yml run dispatched with `jobs: android`; download the `channels-android` artifact from the run, unzip it, and open
the APK on the phone (allow installs from your browser or files app), or with the phone
on USB and debugging on:

```bash
adb install -r app-release.apk
```

The release APK is signed with the repo's release keystore, which CI reads from the
`KIWI_ANDROID_KEYSTORE_BASE64`, `KIWI_ANDROID_STORE_PASSWORD`, `KIWI_ANDROID_KEY_ALIAS` and
`KIWI_ANDROID_KEY_PASSWORD` secrets (the macOS certificate's pattern), on runs that can read
them. Anywhere else — a fork's pull request, your own machine — the APK comes out **unsigned**
(`app-release-unsigned.apk`, which Android refuses to install until you sign it), never signed
with the debug key: `app/debug.p12` belongs to the debug build alone. Nothing built without the
release keystore is distributable.

A one-time setup for whoever holds the secrets:

```bash
keytool -genkeypair -v -keystore kiwi-release.p12 -alias kiwi -keyalg RSA -keysize 2048 -validity 10000 -storetype PKCS12
base64 -w0 kiwi-release.p12 | gh secret set KIWI_ANDROID_KEYSTORE_BASE64
gh secret set KIWI_ANDROID_STORE_PASSWORD   # the keystore's password
gh secret set KIWI_ANDROID_KEY_ALIAS        # kiwi
gh secret set KIWI_ANDROID_KEY_PASSWORD     # the key's password (usually the keystore's)
```

Keep the keystore itself somewhere safe besides the secret: Android only updates an app over the
same signature, so losing it means a new app identity for every installed phone.

## Build it yourself

With JDK 17 and the Android SDK (`ANDROID_HOME`, platform 37):

```bash
bun install
cd android && ./gradlew assembleRelease     # app/build/outputs/apk/release/app-release-unsigned.apk (or app-release.apk with the keystore env below)
./gradlew recordRoborazziRelease            # app/build/screens/*.png: every screen, light and dark
```

CI draws the same screens in `android / build` and keeps them as the `android-screens` artifact,
so a change to a screen can be looked at without a phone.

## A channel to try it on

`bun ios/scripts/dev-channel.ts --host <your Mac's LAN IP>` starts a relay with dev sign-in and a
channel with a few agents. The Android app has no dev sign-in name yet, so it signs in only against
a real relay; the iPhone app takes `-devUser` (ios/README.md). The app allows plain `http://` relays,
as the iPhone app allows local networking.

# Phone push

A phone with the app closed hears about a message meant for its person through a wake: a push with no content. The phone then fetches that message and decrypts it itself.

## What each side sees

- **Apple and Google** see a random tag and a sequence number. The tag is one the phone picked when it registered, so they never see a room, a name or any text.
- **The relay** sees which members a message is for, never what it says. The sender's app names them in a `wake` list next to the ciphertext: whom it is to, who it mentions, the other side of a DM, and who answers an escalated decision. It names them only for what a phone shows: #general, the lead chat, and asks.
- **The phone** fetches message `seq` from the room its tag points to, decrypts it with the keys it already holds, and shows it.

## The relay's side

- `PUT /v1/rooms/<room>/push` with `{ platform: "apns" | "fcm", token, tag, sandbox? }`, signed by the member's key, registers that member's phone. One registration per member key; a token registered again under another key moves there.
- `DELETE /v1/rooms/<room>/push` forgets it. Leaving or being removed forgets it too.
- A send (`{ t: "send", …, wake }` on the socket, or `POST /messages` with `wake`) wakes the registered phones among the named members, never the sender's.
- A token APNs or FCM calls gone (`410`, `BadDeviceToken`, `404 UNREGISTERED`) is forgotten.

## Setting it up

Without these, the relay still takes registrations and sends no wakes.

**iPhone (APNs).** Create a key at [Certificates, Identifiers & Profiles → Keys](https://developer.apple.com/account/resources/authkeys/add) with Apple Push Notifications service, for Sandbox & Production. Apple lets you download the `.p8` once.

- Cloudflare: `wrangler secret put APNS_KEY < AuthKey_XXXXXXXXXX.p8`, then `wrangler secret put APNS_KEY_ID`. `APNS_TEAM_ID` and `APNS_TOPIC` (the app's bundle id) are vars in `wrangler.jsonc`.
- Bun relay: `APNS_KEY="$(cat AuthKey_XXXXXXXXXX.p8)" APNS_KEY_ID=… APNS_TEAM_ID=… APNS_TOPIC=com.kiwiinit.channels kiwi relay`

**Android (FCM).** In a Firebase project with the app `com.kiwiinit.channels`, open Project settings → Service accounts → Generate new private key.

- Cloudflare: `wrangler secret put FCM_SERVICE_ACCOUNT < the-key.json`
- Bun relay: `FCM_SERVICE_ACCOUNT="$(cat the-key.json)" kiwi relay`

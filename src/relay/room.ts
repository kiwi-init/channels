// Room logic shared by the Cloudflare Durable Object and the self-hosted Bun
// relay. Both back a room with SQLite; each adapter supplies the SQL calls and
// applies the returned effects (fan-out, disconnects, wiping the room).
//
// Every channel is owner-gated:
//   - the owner creates the room and is its first member;
//   - anyone holding the join code may *ask* to join (a pending request);
//   - only the owner can approve, which enrolls the requester's key and hands
//     it the channel keys, wrapped so only that key can open them;
//   - every request and socket is signed by a member key; no shared secret
//     ever reaches the relay;
//   - leaving or being removed revokes access at once, and the owner rotates
//     the channel key so the departed key can't read anything newer;
//   - closing deletes the room outright: no tombstone, nothing to recover.
//
// The relay stores public keys, opaque sealed blobs and ciphertext. Member
// names, roles and every message stay end-to-end encrypted.
//
// On Effect: RoomDb is the room's tables and rows, nothing about who may do
// what. The rules are the Effects below, which run with:
//   - RoomStore: the room's RoomDb (the Durable Object's ctx.storage.sql, or a
//     bun:sqlite file);
//   - Policy: what this relay allows (policy.ts);
//   - Clock: Effect's own, for message times, the daily count and idle expiry.
// They refuse with the tagged failures in failures.ts.

export { forgetRoom, RoomDb, RoomStore, type RoomServices, type Sql, type SqlParam } from "./room/db.ts";
export { Directory, HOLD_MS, holdEntry, releasable, reserveSlot, type DirectoryEntry, type DirectoryUpdate, type Effects } from "./room/directory.ts";
export { allow, take, ASKS_PER_MINUTE, BLOBS_PER_MINUTE, GITHUB_READS_PER_MINUTE, MESSAGES_PER_MINUTE, MORE_PER_MINUTE, NOTES_PER_MINUTE, PAGES_PER_MINUTE, READS_PER_MINUTE } from "./room/limits.ts";
export { getNote, putNote } from "./room/notes.ts";
export { authenticate, authenticateSocket, gone, missingFingerprint, readMeta, requestToken, UPDATE_KIWI, wsHeaders } from "./room/auth.ts";
export { append, expire, idleExpired, markRead, storeBlob, touch } from "./room/messages.ts";
export { create, directory, reown, setIcon, setSettings, setSnapshot, setTitle, type CreateBody } from "./room/lifecycle.ts";
export { approve, keysFor, remove, rotate, setCanPost, setRecord, type MemberBody } from "./room/members.ts";
export { dropDelegation, listDelegations, liveDelegation, putDelegation } from "./room/delegations.ts";
export { request, requestStatus, requireChecked, reveal, setOwnerNonce, type RequestBody } from "./room/requests.ts";
export { frame, msgFrame, onClientFrame, socketError, takesPresence, wantsEcho, wantsReads, wantsWatch, watchFrame, welcomeFrames } from "./room/sockets.ts";
export { errorResponse, gateRoom, parseRoomPath, relayConfig } from "./room/http.ts";

/**
 * The HTTP API (all under /v1/rooms/<room>):
 *   GET    /info?fp=<fingerprint>     holder of the join code: owner keys, epoch, whether a rotation is due
 *   POST   /create                    owner: create the room
 *   POST   /requests?fp=<fingerprint> holder of the join code: ask to join (self-signed)
 *   GET    /requests/<id>             the requester: status, and wrapped keys once approved
 *   POST   /requests/<id>/reveal      the requester: its half of the code check
 *   GET    /requests?v=2              owner: pending requests
 *   POST   /requests/<id>/nonce       owner: its half of the code check (a signature)
 *   POST   /requests/<id>/deny        owner
 *   POST   /members                   owner: approve (enroll a key, hand it wrapped keys)
 *   GET    /members                   member: the sealed member records
 *   DELETE /members/me                member: leave
 *   DELETE /members/<pk>              owner: remove
 *   PUT    /members/<pk>/post         owner: whether they may post (the relay's bit of member scopes)
 *   PUT    /members/<pk>/record       owner: a re-signed record (what they may do changed) and that bit, together
 *   GET    /keys                      member: my wrapped channel keys
 *   POST   /epochs                    owner: rotate the channel key
 *   DELETE /                          owner: close and delete everything
 *   GET    /                          member: {head}
 *   GET    /messages?since=N          member
 *   POST   /messages                  member: {iv, ct, e}
 *   POST   /read                      member: {seq}, how far it has read (a number, never content)
 */

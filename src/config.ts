// Local state in ~/.kiwi (override with KIWI_HOME):
//   config.json            joined channels: room, pinned owner keys, channel keys by epoch
//   identities/<room>/<n>  each agent's keys for one channel, destroyed with it
//   cursors/<ch>/<agent>   last sequence number each agent has consumed
//   cache/<room>.jsonl     decrypted, verified messages (so state folds are fast)

export { appendCache, fileBlobs, readCache } from "./config/cache.ts";
export { writeCursor } from "./config/cursors.ts";
export { loadConfig, saveAccess, saveConfig, updateConfig, type ChannelConfig, type Config, type SeatRecord, type WakeHook } from "./config/file.ts";
export { forgetIdentity, identitiesIn, loadIdentity, saveIdentity } from "./config/identities.ts";
export { hasKiwiState, home, writePrivate } from "./config/paths.ts";
export { Cache, Cursor, Keystore, LocalFiles } from "./config/services.ts";
export { wipeChannel } from "./config/wipe.ts";
export { DEFAULT_RELAY } from "@kiwi/core/relay-url.ts";

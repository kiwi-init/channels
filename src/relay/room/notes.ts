import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { NOTE_IDLE_MS, NOTE_MAX_BYTES, NOTES_PER_KEY } from "@kiwi/core/note.ts";
import { BadRequest, ReadOnly, TooLarge, TooMany } from "../failures.ts";
import { Policy } from "../policy.ts";
import { RoomStore } from "./db.ts";
import { READ_ONLY } from "./messages.ts";
import { formatBytes } from "./limits.ts";

export const getNote = Effect.fn("Room.getNote")(function* (id: string) {
  const db = yield* RoomStore;
  const n = db.note(id);
  return n ? { box: n.box, version: n.version } : null;
});

export const putNote = Effect.fn("Room.putNote")(function* (id: string, writer: string, body: { box?: unknown; prev?: unknown }) {
  const db = yield* RoomStore;
  const policy = yield* Policy;
  if (db.isReadOnly(writer)) return yield* new ReadOnly({ message: READ_ONLY });
  const { box, prev } = body;
  if (typeof box !== "string" || !box) return yield* new BadRequest({ message: "send the note's sealed box" });
  if (box.length > NOTE_MAX_BYTES) return yield* new TooLarge({ message: `a note is at most ${formatBytes(NOTE_MAX_BYTES)}` });
  if (prev !== null && !(Number.isSafeInteger(prev) && (prev as number) >= 1)) return yield* new BadRequest({ message: "prev is the version you read, or null for a new note" });
  const at = yield* Clock.currentTimeMillis;
  const stale = db.dropNotesBefore(at - NOTE_IDLE_MS);
  if (stale) db.setCounters({ ...(db.counters() ?? { day: "", n: 0 }), bytes: Math.max(0, db.storedBytes() - stale) });
  let bytes = db.storedBytes();
  const had = db.note(id);
  if ((had?.version ?? null) !== prev) return { conflict: true as const, box: had?.box ?? null, version: had?.version ?? null };
  if (!had && db.notesBy(writer) >= NOTES_PER_KEY) return yield* new TooMany({ message: `a member's key keeps at most ${NOTES_PER_KEY} notes in a channel` });
  const grows = box.length - (had?.box.length ?? 0);
  const cap = policy.bytesPerChannel;
  if (bytes + grows > cap) bytes -= db.dropOldest(bytes + grows - cap) + db.pruneBlobs();
  if (bytes + grows > cap) return yield* new TooLarge({ message: `this channel is full (${formatBytes(cap)})` });
  const version = (had?.version ?? 0) + 1;
  db.putNote(id, writer, version, box, at);
  db.setCounters({ ...(db.counters() ?? { day: "", n: 0 }), bytes: Math.max(0, bytes + grows) });
  return { conflict: false as const, version };
});

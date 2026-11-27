import { CHECKPOINT_MAX_LENGTH } from "../protocol.ts";
import { unnamedAsks, unnamedTasks } from "./compact.ts";
import type { Frozen, Task } from "./types.ts";

const PREFIX = "lead checkpoint/";

export function handoverCheckpointRefusal(text: string | undefined, tasks: Iterable<Frozen<Task>>, openAsks: Iterable<{ seq: number }>): string | null {
  if (text === undefined || !text.trim()) return "the lead on duty hands over with a checkpoint: where the channel stands (kiwi lead hand NAME --file checkpoint.md)";
  if (text.length > CHECKPOINT_MAX_LENGTH) return `a handover checkpoint holds at most ${CHECKPOINT_MAX_LENGTH} characters; this one has ${text.length}`;
  const left = [...unnamedTasks(text, tasks).map((id) => `T${id}`), ...unnamedAsks(text, openAsks).map((seq) => `#${seq}`)];
  return left.length ? `a handover checkpoint names everything still open, each task (T7) and question (#123) by its id; this one leaves out ${left.join(", ")}` : null;
}

export function leadCheckpointKey(name: string): string {
  return `${PREFIX}${name}`;
}

export function leadCheckpointKeyRefusal(key: string, from: string, ttl: number | undefined): string | null {
  if (!key.startsWith(PREFIX)) return null;
  if (key !== leadCheckpointKey(from)) return `only ${key.slice(PREFIX.length) || "nobody"} writes ${key}`;
  return ttl === undefined ? null : "a lead checkpoint never expires";
}

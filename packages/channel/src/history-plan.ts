// What a reload should trust from the local history, and which seq to ask the
// relay for. Pure, so the rules can be tested without a browser.
//
// The cache never fills a hole and never keeps a seq past the relay's head:
// either case loads the usual window instead, and so does a run that ends before
// the window starts. A contiguous run is kept, trimmed to the window (the newest
// `limit` seqs up to head), and the relay is asked only for what comes after it.

/**
 * Whether this view holds every message the room has stored. A log longer than
 * the window does not. A cache that starts after the first message does not
 * either: scopes read from that gap would allow too much.
 */
export function wholeLog(head: number, limit: number, firstSeq: number | undefined): boolean {
  if (head > limit) return false;
  return firstSeq === undefined || firstSeq <= 1;
}

/** `since` is exclusive: the relay sends seqs greater than it. */
export function planReload(seqs: readonly number[], head: number, limit: number): { keep: number[]; since: number } {
  const windowFrom = Math.max(0, head - limit);
  const sorted = [...new Set(seqs.filter((s) => Number.isSafeInteger(s) && s > 0 && s <= head))].sort((a, b) => a - b);
  const hole = sorted.some((s, i) => i > 0 && s !== sorted[i - 1]! + 1);
  if (!sorted.length || hole) return { keep: [], since: windowFrom };
  // A cache that ends before the window starts is a stale island: streaming from its end would
  // fetch more than the window and show old messages above a gap. Load the usual window instead.
  if (sorted[sorted.length - 1]! <= windowFrom) return { keep: [], since: windowFrom };
  // Otherwise keep only what's inside the window, so a reload shows what a fresh load would.
  const keep = sorted.filter((s) => s > windowFrom);
  return { keep, since: keep[keep.length - 1]! };
}

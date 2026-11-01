import { describe, expect, test } from "bun:test";

import { badgeTotal, newsTotal, nextWithNews, rowNews, withHeads, type Mark } from "./news.ts";

const marks: Record<string, Mark> = { a: { seen: 5, needs: 0 }, b: { seen: 9, needs: 2 }, c: { seen: 3, needs: 0 } };

describe("rowNews", () => {
  test("a closed channel is new when its head passed what this browser saw", () => {
    expect(rowNews({ room: "a", head: 6 }, marks, null)).toEqual({ open: false, fresh: true, count: 0, needs: 0, mentions: 0 });
    expect(rowNews({ room: "a", head: 5 }, marks, null).fresh).toBe(false);
    // Questions waiting when it was left stay on the row.
    expect(rowNews({ room: "b", head: 9 }, marks, null)).toEqual({ open: false, fresh: false, count: 0, needs: 2, mentions: 0 });
  });

  test("no head (signed out, quiet, or past the cap) or no mark yet is never new", () => {
    expect(rowNews({ room: "a" }, marks, null).fresh).toBe(false);
    expect(rowNews({ room: "z", head: 100 }, marks, null).fresh).toBe(false);
  });

  test("the open channel counts exactly, whatever its head says", () => {
    expect(rowNews({ room: "a", head: 50 }, marks, { room: "a", unread: 0, needs: 1, mentions: 0 })).toEqual({ open: true, fresh: false, count: 0, needs: 1, mentions: 0 });
    expect(rowNews({ room: "a", head: 50 }, marks, { room: "a", unread: 3, needs: 0, mentions: 0 })).toEqual({ open: true, fresh: true, count: 3, needs: 0, mentions: 0 });
  });
});

test("the tab total: the open channel's count, plus one per other channel with news", () => {
  const open = { room: "a", unread: 3, needs: 1, mentions: 0 };
  const news = [rowNews({ room: "a", head: 9 }, marks, open), rowNews({ room: "b", head: 12 }, marks, open), rowNews({ room: "c", head: 4 }, marks, open), rowNews({ room: "z" }, marks, open)];
  expect(newsTotal(news)).toBe(3 + 1 + 1);
  expect(newsTotal([rowNews({ room: "a", head: 9 }, marks, { room: "a", unread: 0, needs: 4, mentions: 0 })])).toBe(0);
});

test("Alt+↓/↑ skip quiet channels and the open one, and wrap around", () => {
  const rows = ["a", "b", "c", "d"];
  const n = (fresh: boolean, open = false) => ({ open, fresh, count: 0, needs: 0, mentions: 0 });
  const news = [n(false, true), n(false), n(true), n(false)];
  expect(nextWithNews(rows, news, 0, 1)).toBe("c");
  expect(nextWithNews(rows, news, 0, -1)).toBe("c");
  expect(nextWithNews(rows, news, 2, 1)).toBeNull();
  // Nothing open: from the top, or from the bottom going up.
  expect(nextWithNews(rows, [n(false), n(true), n(false), n(true)], -1, 1)).toBe("b");
  expect(nextWithNews(rows, [n(false), n(true), n(false), n(true)], -1, -1)).toBe("d");
});

test("withHeads stashes polled seqs so a closed row can be fresh", () => {
  const listed: { room: string; head?: number }[] = [{ room: "a" }];
  expect(withHeads(listed, {})[0]!.head).toBeUndefined();
  expect(withHeads(listed, { a: 6 })[0]!.head).toBe(6);
  expect(rowNews(withHeads(listed, { a: 6 })[0]!, marks, null).fresh).toBe(true);
  expect(rowNews(withHeads(listed, { a: 5 })[0]!, marks, null).fresh).toBe(false);
});

test("the dock badge follows the notification setting: everything, only mentions and questions, or nothing (T947)", () => {
  const open = { room: "a", unread: 3, needs: 1, mentions: 2 };
  const news = [rowNews({ room: "a", head: 9 }, marks, open), rowNews({ room: "b", head: 12 }, marks, open), rowNews({ room: "c", head: 4 }, marks, open)];
  expect(badgeTotal(news, "all")).toBe(newsTotal(news));
  expect(badgeTotal(news, "mentions")).toBe(2 + 1 + 1);
  expect(badgeTotal(news, "none")).toBe(0);
});

import { describe, expect, test } from "bun:test";
import { MESSAGE_LINKS, messageAt, messageLink } from "@kiwi/core/message-link.ts";

const CODE = "mc2-4u2dwIeijB9T9jh4JERA4Q-62qozsSxRQzg3q6a";

describe("a link to a message names only its channel and number (T987)", () => {
  test("a copied link reads back as its channel and message", () => {
    expect(messageAt(messageLink(CODE, 7))).toEqual({ code: CODE, seq: 7 });
    expect(messageAt(`  kiwi://join/${CODE}/?m=7 `)).toEqual({ code: CODE, seq: 7 });
  });

  test("anything else is no message link", () => {
    for (const bad of [
      `kiwi://join/${CODE}`,
      `kiwi://join/${CODE}?m=0`,
      `kiwi://join/${CODE}?m=-3`,
      `kiwi://join/${CODE}?m=7&x=1`,
      `kiwi://join/a%2Fb?m=7`,
      `https://x.test/?m=7`,
      `kiwi://join/${CODE}?m=99999999999999999`,
    ])
      expect(messageAt(bad)).toBeNull();
  });

  test("a link inside text is found where it starts and ends", () => {
    const text = `see kiwi://join/${CODE}?m=12, then kiwi://join/${CODE}?m=13x`;
    expect([...text.matchAll(MESSAGE_LINKS)].map((m) => [m[1], m[2], m.index])).toEqual([[CODE, "12", 4]]);
  });
});

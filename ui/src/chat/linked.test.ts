import { describe, expect, test } from "bun:test"

import { linked, named } from "~/chat/linked"

const nobody = new Map<string, string>()
const none = new Set<number>()

describe("#123 points at an earlier message (T616)", () => {
  test("a message number before this one becomes a link that jumps to it", () => {
    expect(linked("Same as #12, see #40.", nobody, none, 50)).toBe("Same as [#12](kiwi-msg:12), see [#40](kiwi-msg:40).")
  })

  test("a number not yet written, a PR or issue number, and code stay as they are", () => {
    expect(linked("#60 isn't sent yet", nobody, none, 50)).toBe("#60 isn't sent yet")
    expect(linked("PR #12 and issue #13 and pull #14", nobody, none, 50)).toBe("PR #12 and issue #13 and pull #14")
    expect(linked("run `git show #12` or [#12](https://x.test)", nobody, none, 50)).toBe("run `git show #12` or [#12](https://x.test)")
    expect(linked("a#12, ##12, #12a", nobody, none, 50)).toBe("a#12, ##12, #12a")
  })

  test("without its own number a message links no refs", () => {
    expect(linked("see #12", nobody, none)).toBe("see #12")
  })
})

describe("images from other hosts open as links, as they did before (T616)", () => {
  test("a remote image becomes 'alt (opens host)', which the app may load", () => {
    expect(linked("look: ![the graph](https://img.example.com/g.png)", nobody, none)).toBe("look: [the graph (opens img.example.com)](<https://img.example.com/g.png>)")
    expect(linked("![](http://x.test/p.png)", nobody, none)).toBe("[image (opens x.test)](<http://x.test/p.png>)")
  })

  test("an image the app can show stays; one with nowhere safe to go keeps only its words", () => {
    expect(linked("![dot](data:image/png;base64,iVBORw0KGgo=)", nobody, none)).toBe("![dot](data:image/png;base64,iVBORw0KGgo=)")
    expect(linked("![secret](https://user:pw@x.test/p.png)", nobody, none)).toBe("secret")
    expect(linked("![local](./p.png)", nobody, none)).toBe("local")
  })

  test("the plain text shown before the markdown is ready leaves both alone", () => {
    expect(named("see #12 ![g](https://x.test/g.png)", nobody)).toBe("see #12 ![g](https://x.test/g.png)")
  })
})

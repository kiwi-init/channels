import { describe, expect, test } from "bun:test"

import { withoutPictures } from "~/chat/doc/files-of"

const ref = { id: "b", key: "k", size: 4 }
const pic = (name: string) => ({ name, mime: "image/png", ref })

describe("the words a doc line posts", () => {
  test("leave out the line of each picture the message carries", () => {
    expect(withoutPictures("look\n[image: a.png]\nand this\n[image: b.png]", [pic("a.png"), pic("b.png")])).toBe("look\nand this")
    expect(withoutPictures("[image: a.png]", [pic("a.png")])).toBe("")
  })

  test("keep a file's name, a picture the message does not carry, and what the person typed", () => {
    expect(withoutPictures("see\n[file: r.pdf]\n[image: late.png]", [])).toBe("see\n[file: r.pdf]\n[image: late.png]")
    expect(withoutPictures("I typed [image: a.png] myself\n[image: a.png]", [pic("a.png")])).toBe("I typed [image: a.png] myself")
    expect(withoutPictures("[image: a.png]\n[image: a.png]", [pic("a.png")])).toBe("[image: a.png]")
  })

  test("a name with signs in it is matched as written", () => {
    expect(withoutPictures("x\n[image: a (1).png]", [pic("a (1).png")])).toBe("x")
  })
})

import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import { sendsOn, sendTitle, type SendKey } from "~/chat/send-keys"
import type { Channel, Message, Spec } from "~/model"
import { ActContext, AppContext, type Act, type Ctx } from "~/nav"
import { pastedFiles } from "~/chat/attach"
import { CommentBox, commentKeys, commentOf, type CommentReply } from "~/specs/comment-box"
import { wrote } from "~/words"
import { keysHint } from "~/kit/keys"

const key = (more: Partial<SendKey>): SendKey & { preventDefault(): void } => ({
  key: "Enter",
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ctrlKey: false,
  keyCode: 13,
  nativeEvent: { isComposing: false },
  preventDefault: () => {},
  ...more,
})

const spec: Spec = {
  ask: 10,
  title: wrote("Export the board"),
  words: wrote("board as a spreadsheet"),
  by: "jow",
  at: 0,
  text: wrote("# Export the board"),
  v: 1,
  edited: { by: "jow", at: 0 },
  edits: 0,
  editors: [],
  stage: "draft",
  backs: [],
  tasks: [],
}

const channel = { code: "c", you: "jow", people: [], former: [], messages: [], tasks: [], nicknames: new Map() } as unknown as Channel

const render = (enterSends: boolean, quote?: string, reply?: CommentReply): string =>
  renderToStaticMarkup(
    <AppContext.Provider value={{ app: { channel, prefs: { enterSends } }, go: () => {} } as unknown as Ctx}>
      <ActContext.Provider value={{ actions: {}, go: () => {}, toast: () => {} } as unknown as Act}>
        <CommentBox channel={channel} spec={spec} quote={quote} reply={reply ?? null} onUnreply={() => {}} onDone={() => {}} />
      </ActContext.Provider>
    </AppContext.Provider>
  )

describe("one send rule for the chat composer and spec comments (#1842)", () => {
  test("with Enter-sends on, Enter sends and Shift+Enter or Alt+Enter adds a line", () => {
    expect(sendsOn(key({}), true)).toBe(true)
    expect(sendsOn(key({ shiftKey: true }), true)).toBe(false)
    expect(sendsOn(key({ altKey: true }), true)).toBe(false)
  })

  test("with Enter-sends off, only Ctrl or ⌘ with Enter sends", () => {
    expect(sendsOn(key({}), false)).toBe(false)
    expect(sendsOn(key({ ctrlKey: true }), false)).toBe(true)
    expect(sendsOn(key({ metaKey: true }), false)).toBe(true)
  })

  test("an Enter that confirms an IME composition never sends", () => {
    expect(sendsOn(key({ nativeEvent: { isComposing: true } }), true)).toBe(false)
    expect(sendsOn(key({ keyCode: 229 }), true)).toBe(false)
    expect(sendsOn(key({ ctrlKey: true, nativeEvent: { isComposing: true } }), false)).toBe(false)
  })

  test("a spec comment box sends on Enter, or on Ctrl+Enter with the setting off, and Escape cancels", () => {
    const sent: string[] = []
    const keys = (enterSends: boolean) =>
      commentKeys(
        enterSends,
        () => sent.push(`send ${enterSends}`),
        () => sent.push("cancel")
      )
    keys(true)(key({}))
    keys(true)(key({ shiftKey: true }))
    keys(false)(key({}))
    keys(false)(key({ ctrlKey: true }))
    keys(true)(key({ key: "Escape" }))
    keys(true)(key({ keyCode: 229 }))
    expect(sent).toEqual(["send true", "send false", "cancel"])
  })

  test("the preventDefault keeps a sending Enter from adding a line", () => {
    let stopped = 0
    commentKeys(true, () => {})(key({ preventDefault: () => void stopped++ }))
    commentKeys(true, () => {})(key({ shiftKey: true, preventDefault: () => void stopped++ }))
    expect(stopped).toBe(1)
  })

  test("the anchored box shows the send hint that matches the setting", () => {
    expect(render(true, "a quoted line")).toContain(`title="${sendTitle(true)}"`)
    expect(render(false, "a quoted line")).toContain(`title="${sendTitle(false)}"`)
    expect(sendTitle(true)).toBe("Send (Enter)")
    expect(sendTitle(false)).toBe(`Send (${keysHint("Enter")})`)
  })

  test("replying to a comment shows who and what it quotes, like the chat composer (#1840)", () => {
    const to = { seq: 12, from: "win", at: 0, text: wrote("subtasks should nest"), where: { kind: "room", room: "general" }, inThread: 10 } as Message
    const quoting = render(true, undefined, { to, excerpt: "should nest" })
    expect(quoting).toContain("Quoting <b>win</b>")
    expect(quoting).toContain("“should nest”")
    expect(quoting).toContain('placeholder="Say something about it"')
    const replying = render(true, undefined, { to, excerpt: null })
    expect(replying).toContain("Replying to <b>win</b>")
    expect(replying).toContain('placeholder="Reply to win"')
    expect(render(true)).not.toContain("compose-reply")
  })
})

const shot = { name: "shot.png", mime: "image/png", data: "iVBORw0KGgo=" }

const clip = (files: File[], items: File[] = []) =>
  ({ files: Object.assign([...files], { item: (i: number) => files[i] ?? null }), items: items.map((f) => ({ kind: "file", getAsFile: () => f })) }) as unknown as Pick<DataTransfer, "files" | "items">

describe("spec comments take images like the chat composer (#1838)", () => {
  test("both comment boxes offer an image button", () => {
    expect(render(true)).toContain('aria-label="Add an image"')
    expect(render(true, "a quoted line")).toContain('aria-label="Add an image"')
  })

  test("a pasted screenshot is taken from the clipboard's files or its items, and only images", () => {
    const png = new File(["x"], "shot.png", { type: "image/png" })
    const txt = new File(["x"], "notes.txt", { type: "text/plain" })
    expect(pastedFiles(clip([png, txt]), false)).toEqual([png])
    expect(pastedFiles(clip([], [png]), false)).toEqual([png])
    expect(pastedFiles(clip([png, txt]), true)).toEqual([png, txt])
  })

  test("a comment with only an image sends, as one message in the spec thread carrying it", () => {
    expect(commentOf(10, "  ", [])).toBeNull()
    expect(commentOf(10, "", [shot])).toEqual({ text: "", extras: { inThread: 10, images: [shot] } })
    expect(commentOf(10, " looks off ", [shot])).toEqual({ text: "looks off", extras: { inThread: 10, images: [shot] } })
    expect(commentOf(10, "here", [shot], "a line")).toEqual({ text: "> a line\n\nhere", extras: { inThread: 10, images: [shot] } })
    expect(commentOf(10, "words", [])).toEqual({ text: "words", extras: { inThread: 10 } })
  })

  test("a reply to a comment carries replyTo, and quotes its excerpt when there is one (#1840)", () => {
    const to = { seq: 12, from: "win", at: 0, text: wrote("subtasks should nest"), where: { kind: "room", room: "general" }, inThread: 10 } as Message
    expect(commentOf(10, "only one level", [], undefined, { to, excerpt: "should nest" })).toEqual({ text: "> should nest\n\nonly one level", extras: { inThread: 10, replyTo: 12 } })
    expect(commentOf(10, "agreed", [shot], undefined, { to, excerpt: null })).toEqual({ text: "agreed", extras: { inThread: 10, replyTo: 12, images: [shot] } })
  })
})

import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import { sendsOn, sendTitle, type SendKey } from "~/chat/send-keys"
import type { Channel, Spec } from "~/model"
import { ActContext, AppContext, type Act, type Ctx } from "~/nav"
import { CommentBox, commentKeys } from "~/specs/comment-box"
import { wrote } from "~/words"

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

const render = (enterSends: boolean, quote?: string): string =>
  renderToStaticMarkup(
    <AppContext.Provider value={{ app: { channel, prefs: { enterSends } }, go: () => {} } as unknown as Ctx}>
      <ActContext.Provider value={{ actions: {}, go: () => {}, toast: () => {} } as unknown as Act}>
        <CommentBox channel={channel} spec={spec} quote={quote} onDone={() => {}} />
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
    expect(sendTitle(false)).toBe("Send (⌘ Enter)")
  })
})

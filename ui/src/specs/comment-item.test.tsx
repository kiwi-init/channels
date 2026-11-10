import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import type { Channel, Message } from "~/model"
import { ActContext, type Act } from "~/nav"
import { CommentItem } from "~/specs/comment-item"
import type { Comment } from "~/specs/read"
import { wrote } from "~/words"

const channel = { code: "c", you: "jow", people: [], former: [], messages: [], tasks: [], nicknames: new Map() } as unknown as Channel

const said = (more: Partial<Message> = {}): Comment => ({
  m: { seq: 12, from: "win", at: 0, text: wrote("subtasks should nest"), where: { kind: "room", room: "general" }, inThread: 10, ...more } as Message,
  text: "subtasks should nest",
})

const render = (c: Comment): string =>
  renderToStaticMarkup(
    <ActContext.Provider value={{ actions: {}, go: () => {}, toast: () => {} } as unknown as Act}>
      <CommentItem channel={channel} c={c} names={new Map()} tasks={new Set()} onReply={() => {}} />
    </ActContext.Provider>
  )

describe("a spec comment acts like a chat message (#1840)", () => {
  test("a sent comment offers react, reply and copy, and no second place to read it (T1877)", () => {
    const html = render(said())
    for (const label of ["React 👍", "React ✅", "Reply", "Copy text"]) expect(html).toContain(`aria-label="${label}"`)
    expect(html).not.toContain("Open in the thread")
  })

  test("a comment shows its reactions with who reacted", () => {
    const html = render(said({ reactions: [{ emoji: "👀", by: ["jow", "win"] }] }))
    expect(html).toContain('class="react is-mine"')
    expect(html).toContain("👀")
    expect(html).toContain('<span class="num">2</span>')
  })

  test("a comment in someone else's direct thread can't be reacted to", () => {
    const html = render(said({ where: { kind: "theirs", between: ["win", "maya"] } }))
    expect(html).not.toContain('aria-label="React 👍"')
    expect(html).toContain('aria-label="Copy text"')
  })

  test("a comment still sending has no actions", () => {
    const html = render(said({ pending: true }))
    expect(html).not.toContain('aria-label="Comment actions"')
  })
})

describe("a comment that fails to send keeps its words and images (#1838)", () => {
  test("it says so and offers Retry or Delete, with no other actions", () => {
    const html = render(said({ failed: "offline", images: [{ url: "blob:shot", width: 2, height: 2, alt: "shot.png" }] }))
    expect(html).toContain('class="msg-failed"')
    expect(html).toContain('class="msg-images"')
    expect(html).toContain(">Retry<")
    expect(html).toContain(">Delete<")
    expect(html).toContain('class="spec-comment is-failed"')
    expect(html).not.toContain('aria-label="Comment actions"')
  })
})

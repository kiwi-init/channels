import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import type { Message } from "@kiwi/core/protocol.ts"
import { Scrollback, type Paged } from "@kiwi/channel/back.ts"

import { useHold } from "~/chat/whole"
import { ActContext, type Act } from "~/nav"

const container = () => ({
  nodeType: 1,
  tagName: "DIV",
  nodeName: "DIV",
  namespaceURI: "http://www.w3.org/1999/xhtml",
  addEventListener() {},
  removeEventListener() {},
  ownerDocument: { addEventListener() {}, removeEventListener() {}, defaultView: { HTMLIFrameElement: class {}, document: { activeElement: null } } },
})

const saved = { window: Reflect.get(globalThis, "window"), act: Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT") }

beforeAll(() => {
  Reflect.set(globalThis, "window", globalThis)
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true)
})

afterAll(() => {
  Reflect.set(globalThis, "window", saved.window)
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", saved.act)
})

const signal = <T,>(value: T) => ({
  value,
  peek() {
    return this.value
  },
})

function room() {
  const back = signal(Array.from({ length: 100 }, (_, i) => ({ seq: i + 1 }) as Message))
  const shown = signal<Message[]>([])
  const kept = new Scrollback({ back, shown, messages: shown, gone: signal(null), page: 50, reach: 1000, ch: {} } as unknown as Paged)
  const actions = { holdEarlier: (_code: string, key: string, seq: number | null) => kept.keep(key, seq) }
  return { first: () => back.peek()[0]?.seq, act: { actions } as unknown as Act }
}

const Feed = ({ from }: { from: number }) => {
  useHold("c", "feed", from)
  return null
}

describe("two conversations of one room keep their own older rows (#3652)", () => {
  test("a pane reading from row 10 keeps it while another pane reads from row 80, and closing either frees only its own hold", async () => {
    const r = room()
    const root = createRoot(container() as unknown as HTMLElement)
    const draw = (froms: number[]) =>
      act(() =>
        root.render(
          <ActContext.Provider value={r.act}>
            {froms.map((from) => (
              <Feed key={from} from={from} />
            ))}
          </ActContext.Provider>
        )
      )
    await draw([10, 80])
    expect(r.first()).toBe(10)
    await draw([10])
    expect(r.first()).toBe(10)
    await draw([10, 80])
    await draw([80])
    expect(r.first()).toBe(80)
    await act(() => root.unmount())
  })
})

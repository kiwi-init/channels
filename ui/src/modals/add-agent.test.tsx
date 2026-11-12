import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"

import { useJoinCommand } from "~/modals/add-agent"
import { AppContext, type Ctx } from "~/nav"

type Ask = { code: string; nick: string; persona: string; answer: () => Promise<void>; fail: () => Promise<void> }

const lineFor = (code: string, nick: string, persona: string) => `kiwi join ${code} --nick ${nick}${persona ? ` --persona ${persona}` : ""}`

const container = () => ({
  nodeType: 1,
  tagName: "DIV",
  nodeName: "DIV",
  namespaceURI: "http://www.w3.org/1999/xhtml",
  addEventListener() {},
  removeEventListener() {},
  ownerDocument: { addEventListener() {}, removeEventListener() {}, defaultView: { HTMLIFrameElement: class {}, document: { activeElement: null } } },
})

const copied: string[] = []
const saved = { window: Reflect.get(globalThis, "window"), act: Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT"), clipboard: Object.getOwnPropertyDescriptor(navigator, "clipboard") }

beforeAll(() => {
  Reflect.set(globalThis, "window", globalThis)
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true)
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => void copied.push(text) } })
})

afterAll(() => {
  Reflect.set(globalThis, "window", saved.window)
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", saved.act)
  if (saved.clipboard) Object.defineProperty(navigator, "clipboard", saved.clipboard)
  else Reflect.deleteProperty(navigator, "clipboard")
})

async function opened(nick: string, persona = "") {
  copied.length = 0
  const asks: Ask[] = []
  const joinCommand = (code: string, as: { nick?: string; persona?: string }) =>
    new Promise<string>((answer, fail) => {
      const ask = { code, nick: as.nick ?? "", persona: as.persona ?? "" }
      asks.push({
        ...ask,
        answer: () => act(async () => answer(lineFor(ask.code, ask.nick, ask.persona))),
        fail: () => act(async () => fail(new Error("offline"))),
      })
    })
  const ctx = { app: { actions: { joinCommand } }, go: () => {} } as unknown as Ctx
  let box: ReturnType<typeof useJoinCommand> | undefined
  const Probe = (as: { code: string; nick: string; persona: string }) => {
    box = useJoinCommand(as.code, as.nick, as.persona)
    return null
  }
  const root = createRoot(container() as unknown as HTMLElement)
  const show = (nick: string, persona = "", code = "mc2-x") =>
    act(async () =>
      root.render(
        <AppContext.Provider value={ctx}>
          <Probe code={code} nick={nick} persona={persona} />
        </AppContext.Provider>
      )
    )
  const now = () => {
    if (!box) throw new Error("the box never rendered")
    return box
  }
  const last = () => {
    const ask = asks.at(-1)
    if (!ask) throw new Error("no command was asked for")
    return ask
  }
  await show(nick, persona)
  return {
    show,
    asks,
    last,
    shown: () => now().line,
    failed: () => now().failed,
    copy: () => act(async () => void now().copy()),
    result: () => now().copy(),
    retry: () => act(async () => now().retry()),
  }
}

describe("Add an agent: the Command box holds still while the name is typed (T21)", () => {
  test("it keeps the last command on screen until the one for the new name is ready, so it never goes blank between keystrokes", async () => {
    const box = await opened("nova")
    expect(box.shown()).toBeNull()
    await box.last().answer()
    expect(box.shown()).toBe(lineFor("mc2-x", "nova", ""))

    for (const typed of ["nova-", "nova-2"]) {
      const before = box.shown()
      await box.show(typed)
      expect(box.shown()).toBe(before)
      await box.last().answer()
      expect(box.shown()).toBe(lineFor("mc2-x", typed, ""))
    }
  })

  test("the same holds when the personality changes", async () => {
    const box = await opened("nova")
    await box.last().answer()
    await box.show("nova", "builder")
    expect(box.shown()).toBe(lineFor("mc2-x", "nova", ""))
    await box.last().answer()
    expect(box.shown()).toBe(lineFor("mc2-x", "nova", "builder"))
  })

  test("a command that comes back late for an older name never replaces the newer one", async () => {
    const box = await opened("nova")
    await box.show("scout")
    const [first, second] = box.asks
    await second?.answer()
    await first?.answer()
    expect(box.shown()).toBe(lineFor("mc2-x", "scout", ""))
  })

  test("a command made for another channel is never shown", async () => {
    const box = await opened("nova")
    await box.last().answer()
    await box.show("nova", "", "mc2-y")
    expect(box.shown()).toBeNull()
    await box.last().answer()
    expect(box.shown()).toBe(lineFor("mc2-y", "nova", ""))
  })

  test("Copy gives the command on screen at once when it is the one for the name in the field", async () => {
    const box = await opened("nova")
    await box.last().answer()
    await box.copy()
    expect(copied).toEqual([lineFor("mc2-x", "nova", "")])
  })

  test("Copy pressed while the new command loads never gives the old name: it copies the new one when it arrives", async () => {
    const box = await opened("nova")
    await box.last().answer()
    await box.show("scout")
    await box.copy()
    expect(copied).toEqual([])
    await box.last().answer()
    expect(copied).toEqual([lineFor("mc2-x", "scout", "")])
    await box.show("scout-2")
    await box.last().answer()
    expect(copied).toEqual([lineFor("mc2-x", "scout", "")])
  })

  test("typing on after Copy drops that copy, so nothing is copied for a name that left the field", async () => {
    const box = await opened("nova")
    await box.last().answer()
    await box.show("scout")
    await box.copy()
    await box.show("scout-2")
    for (const ask of box.asks) await ask.answer()
    expect(box.shown()).toBe(lineFor("mc2-x", "scout-2", ""))
    expect(copied).toEqual([])
  })

  test("a command that can't be made says so, copies nothing, and Try again asks for it once more", async () => {
    const box = await opened("nova")
    await box.copy()
    await box.last().fail()
    expect(box.failed()).toBe(true)
    expect(box.shown()).toBeNull()
    await box.retry()
    expect(box.failed()).toBe(false)
    expect(box.asks).toHaveLength(2)
    await box.last().answer()
    expect(box.shown()).toBe(lineFor("mc2-x", "nova", ""))
    expect(copied).toEqual([])
  })
})

describe("Add an agent: Copy says how it went, so the box can offer the command by hand (#2322)", () => {
  const refuse = (refused: boolean) =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => (refused ? Promise.reject(new DOMException("denied", "NotAllowedError")) : void copied.push(text)) },
    })

  test("a copy that lands says copied", async () => {
    const box = await opened("nova")
    await box.last().answer()
    expect(await box.result()).toEqual({ kind: "copied" })
    expect(copied).toEqual([lineFor("mc2-x", "nova", "")])
  })

  test("a refused copy hands back the exact command it tried", async () => {
    const box = await opened("nova")
    await box.last().answer()
    refuse(true)
    try {
      expect(await box.result()).toEqual({ kind: "failed", text: lineFor("mc2-x", "nova", "") })
    } finally {
      refuse(false)
    }
  })

  test("a refused copy that waited for the new command hands back that command", async () => {
    const box = await opened("nova")
    await box.last().answer()
    await box.show("scout")
    refuse(true)
    try {
      const result = box.result()
      await box.last().answer()
      expect(await result).toEqual({ kind: "failed", text: lineFor("mc2-x", "scout", "") })
    } finally {
      refuse(false)
    }
  })

  test("a copy dropped by typing on says dropped, so nothing is offered by hand", async () => {
    const box = await opened("nova")
    await box.last().answer()
    await box.show("scout")
    const result = box.result()
    await box.show("scout-2")
    expect(await result).toEqual({ kind: "dropped" })
    expect(copied).toEqual([])
  })
})

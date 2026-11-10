import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { isValidElement, type ComponentProps, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { lastChannel, rememberChannel } from "@kiwi/app/last-channel.ts"

import { Boundary } from "~/kit/boundary"

type Props = ComponentProps<typeof Boundary>

const saved = { storage: Reflect.get(globalThis, "localStorage"), location: Reflect.get(globalThis, "location") }
let reloads = 0

beforeEach(() => {
  const kept = new Map<string, string>()
  reloads = 0
  Reflect.set(globalThis, "localStorage", {
    getItem: (k: string) => kept.get(k) ?? null,
    setItem: (k: string, v: string) => void kept.set(k, v),
    removeItem: (k: string) => void kept.delete(k),
  })
  Reflect.set(globalThis, "location", { reload: () => void reloads++ })
})

afterEach(() => {
  Reflect.set(globalThis, "localStorage", saved.storage)
  Reflect.set(globalThis, "location", saved.location)
})

function mounted(props: Omit<Props, "children">): Boundary {
  const b = new Boundary({ ...props, children: "fine" })
  b.setState = (next) => void Object.assign(b.state, next)
  return b
}

function crash(b: Boundary): void {
  b.setState(Boundary.getDerivedStateFromError())
  b.componentDidCatch(new Error("fold threw"))
}

function buttons(node: ReactNode): { label: string; click: () => void }[] {
  if (Array.isArray(node)) return node.flatMap(buttons)
  if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(node)) return []
  if (node.type === "button") return [{ label: String(node.props.children), click: node.props.onClick ?? (() => {}) }]
  if (typeof node.type === "function") return buttons((node.type as (p: object) => ReactNode)(node.props))
  return buttons(node.props.children)
}

const labels = (b: Boundary): string[] => buttons(b.render()).map((x) => x.label)

describe("a crashed view or panel is retried in place (T1758)", () => {
  test("the first crash offers Try again, which shows the view again without a reload", () => {
    const b = mounted({ panel: true })
    crash(b)
    expect(renderToStaticMarkup(b.render())).toContain("This panel hit a problem")
    expect(labels(b)).toEqual(["Try again"])
    buttons(b.render())[0]!.click()
    expect(b.render()).toBe("fine")
    expect(reloads).toBe(0)
  })

  test("a crash right after a retry offers Reload instead of a loop of retries", () => {
    const b = mounted({})
    crash(b)
    buttons(b.render())[0]!.click()
    crash(b)
    expect(labels(b)).toEqual(["Reload"])
    buttons(b.render())[0]!.click()
    expect(reloads).toBe(1)
  })

  test("a crash long after a retry offers Try again", () => {
    const b = mounted({})
    crash(b)
    buttons(b.render())[0]!.click()
    b.retried = Date.now() - 60_000
    crash(b)
    expect(labels(b)).toEqual(["Try again"])
  })
})

describe("the whole-app crash screen has a way out of a channel that crashes (T1758)", () => {
  test("Go home forgets the channel to reopen, then reloads", () => {
    rememberChannel("mc2-crashes")
    const b = mounted({ whole: true })
    crash(b)
    expect(labels(b)).toEqual(["Reload", "Go home"])
    buttons(b.render())[1]!.click()
    expect(lastChannel()).toBeNull()
    expect(reloads).toBe(1)
  })

  test("Reload keeps the channel to reopen", () => {
    rememberChannel("mc2-fine")
    const b = mounted({ whole: true })
    crash(b)
    buttons(b.render())[0]!.click()
    expect(lastChannel()).toBe("mc2-fine")
    expect(reloads).toBe(1)
  })
})

describe("a quiet boundary shows nothing and tells its owner (T1758)", () => {
  test("it reports the crash, then the mend when its key changes", () => {
    const heard: string[] = []
    const props = { quiet: true, resetKey: "kiwi 0", onCrash: () => void heard.push("crash"), onMend: () => void heard.push("mend") }
    const b = mounted(props)
    crash(b)
    expect(b.render()).toBeNull()
    expect(heard).toEqual(["crash"])
    Reflect.set(b, "props", { ...props, resetKey: "kiwi 1", children: "fine" })
    b.componentDidUpdate({ ...props, children: "fine" })
    expect(heard).toEqual(["crash", "mend"])
    expect(b.render()).toBe("fine")
  })

  test("a key that stays the same mends nothing", () => {
    const heard: string[] = []
    const props = { quiet: true, resetKey: "kiwi 0", onMend: () => void heard.push("mend") }
    const b = mounted(props)
    crash(b)
    b.componentDidUpdate({ ...props, children: "fine" })
    expect(heard).toEqual([])
    expect(b.render()).toBeNull()
  })
})

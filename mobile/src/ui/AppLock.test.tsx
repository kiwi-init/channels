import { act, fireEvent, render, screen } from "@testing-library/react-native"
import { Text as RNText } from "react-native"

import type { DeviceAuth } from "../lib/deviceAuth"
import { LOCK_GRACE_MS, shouldLock } from "../lib/deviceAuth"
import { AppLock } from "./AppLock"

type Listener = Parameters<DeviceAuth["subscribe"]>[0]

function device(over: Partial<DeviceAuth> = {}) {
  let listener: Listener = () => {}
  let clock = 1_000_000
  const auth: DeviceAuth = {
    available: async () => true,
    authenticate: jest.fn(async () => true),
    subscribe: (l) => {
      listener = l
      return () => {}
    },
    now: () => clock,
    ...over,
  }
  return { auth, tell: (state: Parameters<Listener>[0]) => listener(state), tick: (ms: number) => void (clock += ms) }
}

const inside = (enabled: boolean, auth: DeviceAuth) => (
  <AppLock enabled={enabled} auth={auth}>
    <RNText>the keys</RNText>
  </AppLock>
)

describe("shouldLock", () => {
  it("locks only after the app has been away longer than the grace period", () => {
    expect(shouldLock(null, 5_000)).toBe(false)
    expect(shouldLock(1_000, 1_000 + LOCK_GRACE_MS)).toBe(false)
    expect(shouldLock(1_000, 1_001 + LOCK_GRACE_MS)).toBe(true)
  })
})

describe("AppLock", () => {
  it("opens straight to the app when there is nothing to protect", async () => {
    const { auth } = device()
    await render(inside(false, auth))
    expect(screen.getByText("the keys")).toBeTruthy()
    expect(auth.authenticate).not.toHaveBeenCalled()
  })

  it("asks the phone on start and shows the app once it says yes", async () => {
    const { auth } = device()
    await render(inside(true, auth))
    expect(await screen.findByText("the keys")).toBeTruthy()
    expect(auth.authenticate).toHaveBeenCalledWith("Open Kiwi")
  })

  it("stays locked when it says no, and lets the person try again", async () => {
    const answers = [false, true]
    const { auth } = device({ authenticate: jest.fn(async () => answers.shift() ?? true) })
    await render(inside(true, auth))
    expect(await screen.findByText("Kiwi is locked")).toBeTruthy()
    expect(screen.queryByText("the keys")).toBeNull()
    await fireEvent.press(screen.getByRole("button", { name: "Unlock" }))
    expect(await screen.findByText("the keys")).toBeTruthy()
  })

  it("does not lock a phone that has no Face ID, touch or passcode to ask", async () => {
    const { auth } = device({ available: async () => false })
    await render(inside(true, auth))
    expect(await screen.findByText("the keys")).toBeTruthy()
  })

  it("locks again after the app has been in the background longer than the grace period, not before", async () => {
    const { auth, tell, tick } = device()
    await render(inside(true, auth))
    await screen.findByText("the keys")
    ;(auth.authenticate as jest.Mock).mockClear()

    await act(async () => tell("background"))
    tick(5_000)
    await act(async () => tell("active"))
    expect(screen.getByText("the keys")).toBeTruthy()
    expect(auth.authenticate).not.toHaveBeenCalled()

    await act(async () => tell("background"))
    tick(LOCK_GRACE_MS + 1)
    await act(async () => tell("active"))
    expect(auth.authenticate).toHaveBeenCalledTimes(1)
  })

  it("keeps the app hidden while the phone is asking", async () => {
    let answer: (ok: boolean) => void = () => {}
    const { auth } = device({ authenticate: jest.fn(() => new Promise<boolean>((resolve) => (answer = resolve))) })
    await render(inside(true, auth))
    await act(async () => {})
    expect(screen.queryByText("the keys")).toBeNull()
    expect(screen.getByText("Kiwi is locked")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Unlocking…" })).toBeTruthy()
    await act(async () => answer(true))
    expect(await screen.findByText("the keys")).toBeTruthy()
  })
})

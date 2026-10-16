import { act, fireEvent, render, screen } from "@testing-library/react-native"
import { encodeJoinCode, newRoomId } from "@mc/crypto.ts"

import type { Engine } from "../lib/engine"
import type { ChannelIdentityView } from "../lib/secrets"
import { ChannelList } from "./ChannelList"
import { FirstRun } from "./FirstRun"
import { Join } from "./Join"

const seat = (over: Partial<ChannelIdentityView>): ChannelIdentityView => ({ label: "Team", pk: "pk", sk: "sk", code: "c1", ...over })

describe("FirstRun", () => {
  it("keeps Continue disabled until there is a name, then hands the trimmed name over", async () => {
    const onContinue = jest.fn()
    await render(<FirstRun onContinue={onContinue} />)
    expect(screen.getByLabelText("Continue").props.accessibilityState?.disabled ?? screen.getByLabelText("Continue").props["aria-disabled"]).toBeTruthy()
    await fireEvent.changeText(screen.getByLabelText("Your name"), "   ")
    await fireEvent.press(screen.getByLabelText("Continue"))
    expect(onContinue).not.toHaveBeenCalled()
    await fireEvent.changeText(screen.getByLabelText("Your name"), "  Ann ")
    await fireEvent.press(screen.getByLabelText("Continue"))
    expect(onContinue).toHaveBeenCalledWith("Ann")
  })
})

describe("ChannelList", () => {
  it("lists channels waiting and joined, opens one, and offers to join", async () => {
    const onOpen = jest.fn()
    const onJoin = jest.fn()
    const onOpenWaiting = jest.fn()
    await render(<ChannelList joined={[seat({ code: "a", name: "Alpha", access: {} })]} waiting={[seat({ code: "b", label: "Beta" })]} onOpen={onOpen} onJoin={onJoin} onOpenWaiting={onOpenWaiting} />)
    await fireEvent.press(screen.getByLabelText("Open Alpha"))
    expect(onOpen).toHaveBeenCalledWith("a")
    await fireEvent.press(screen.getByLabelText("Waiting to join Beta"))
    expect(onOpenWaiting).toHaveBeenCalledWith("b")
    await fireEvent.press(screen.getByLabelText("Join a channel"))
    expect(onJoin).toHaveBeenCalled()
  })

  it("says so when there are no channels", async () => {
    await render(<ChannelList joined={[]} waiting={[]} onOpen={() => {}} onJoin={() => {}} onOpenWaiting={() => {}} />)
    expect(screen.getByText(/No channels yet/)).toBeTruthy()
  })
})

describe("Join", () => {
  const code = encodeJoinCode({ roomId: newRoomId(), ownerFp: "A".repeat(16) })
  const engineWith = (statuses: Array<{ status: "pending"; code: string | null } | { status: "in" } | { status: "denied" }>): { engine: Engine; requestJoin: jest.Mock } => {
    const requestJoin = jest.fn().mockResolvedValue({})
    const checkJoin = jest.fn()
    for (const s of statuses) checkJoin.mockResolvedValueOnce(s)
    return { engine: { requestJoin, checkJoin } as unknown as Engine, requestJoin }
  }

  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it("only asks to join once the text is a code, a kiwi link or an invite page link", async () => {
    const { engine, requestJoin } = engineWith([])
    await render(<Join engine={engine} onJoined={() => {}} />)
    await fireEvent.changeText(screen.getByLabelText("Invite link or code"), "join my channel")
    await fireEvent.press(screen.getByLabelText("Ask to join"))
    expect(requestJoin).not.toHaveBeenCalled()
    await fireEvent.changeText(screen.getByLabelText("Invite link or code"), `kiwi://join/${code}`)
    await fireEvent.press(screen.getByLabelText("Ask to join"))
    expect(requestJoin).toHaveBeenCalledWith(code)
  })

  it("shows the digits to read out while waiting, then moves on once the owner lets it in", async () => {
    const { engine } = engineWith([{ status: "pending", code: null }, { status: "pending", code: "344-230" }, { status: "in" }])
    const onJoined = jest.fn()
    await render(<Join engine={engine} initialCode={code} onJoined={onJoined} />)
    await fireEvent.press(screen.getByLabelText("Ask to join"))
    expect(screen.getByText("Getting your code…")).toBeTruthy()
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2100)
    })
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2100)
    })
    expect(screen.getByText("344-230")).toBeTruthy()
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2100)
    })
    expect(onJoined).toHaveBeenCalledWith(code)
  })

  it("says when the owner turned the request down", async () => {
    const { engine } = engineWith([{ status: "denied" }])
    await render(<Join engine={engine} initialCode={code} onJoined={() => {}} />)
    await fireEvent.press(screen.getByLabelText("Ask to join"))
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2100)
    })
    expect(screen.getByText(/turned this request down/)).toBeTruthy()
  })
})

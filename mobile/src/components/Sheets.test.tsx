import { encodeJoinCode, newRoomId } from "@mc/crypto.ts"
import { fireEvent, render, screen } from "@testing-library/react-native"

import { Frame } from "../ui/Frame"
import { JoinSheet, NOT_A_CODE, joinProblem } from "./JoinSheet"
import { MAX_NAME, NewChannelSheet, UNTITLED, nameProblem } from "./NewChannelSheet"

const code = encodeJoinCode({ roomId: newRoomId(), ownerFp: "A".repeat(16) })

function created(over: Partial<React.ComponentProps<typeof NewChannelSheet>> = {}) {
  return (
    <Frame>
      <NewChannelSheet visible onClose={jest.fn()} onCreate={jest.fn().mockResolvedValue("mc2-new")} onCreated={jest.fn()} {...over} />
    </Frame>
  )
}

function joining(over: Partial<React.ComponentProps<typeof JoinSheet>> = {}) {
  return (
    <Frame>
      <JoinSheet visible onClose={jest.fn()} onJoin={jest.fn()} {...over} />
    </Frame>
  )
}

describe("nameProblem and joinProblem", () => {
  it("only call a name too long and a non-code a problem", () => {
    expect(nameProblem("payments-refactor")).toBeNull()
    expect(nameProblem("  ".padEnd(10))).toBeNull()
    expect(nameProblem("x".repeat(MAX_NAME + 1))).toBe(`Keep the name to ${MAX_NAME} characters or fewer.`)
    expect(joinProblem("")).toBeNull()
    expect(joinProblem("   ")).toBeNull()
    expect(joinProblem("hello")).toBe(NOT_A_CODE)
    expect(joinProblem(code)).toBeNull()
  })
})

describe("NewChannelSheet", () => {
  it("creates a channel with the trimmed name and hands over its code", async () => {
    const onCreate = jest.fn().mockResolvedValue("mc2-new")
    const onCreated = jest.fn()
    await render(created({ onCreate, onCreated }))
    await fireEvent.changeText(screen.getByLabelText("Channel name"), "  payments  ")
    await fireEvent.press(screen.getByRole("button", { name: "Create channel" }))
    expect(onCreate).toHaveBeenCalledWith("payments")
    expect(onCreated).toHaveBeenCalledWith("mc2-new")
    expect(screen.getByLabelText("Channel name").props.value).toBe("")
  })

  it("names an empty one untitled", async () => {
    const onCreate = jest.fn().mockResolvedValue("mc2-new")
    await render(created({ onCreate }))
    await fireEvent.press(screen.getByRole("button", { name: "Create channel" }))
    expect(onCreate).toHaveBeenCalledWith(UNTITLED)
  })

  it("refuses a name that is too long, with a message, and does not create", async () => {
    const onCreate = jest.fn()
    await render(created({ onCreate }))
    await fireEvent.changeText(screen.getByLabelText("Channel name"), "x".repeat(MAX_NAME + 5))
    await fireEvent.press(screen.getByRole("button", { name: "Create channel" }))
    expect(screen.getByText(`Keep the name to ${MAX_NAME} characters or fewer.`)).toBeTruthy()
    expect(onCreate).not.toHaveBeenCalled()
  })

  it("shows why it failed, keeps the name and lets the person try again", async () => {
    const onCreate = jest.fn().mockRejectedValue(new Error("This relay needs you to sign in to create a channel."))
    const onCreated = jest.fn()
    await render(created({ onCreate, onCreated }))
    await fireEvent.changeText(screen.getByLabelText("Channel name"), "ops")
    await fireEvent.press(screen.getByRole("button", { name: "Create channel" }))
    expect(screen.getByText("This relay needs you to sign in to create a channel.")).toBeTruthy()
    expect(screen.getByLabelText("Channel name").props.value).toBe("ops")
    expect(onCreated).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Create channel" }).props.accessibilityState).toMatchObject({ disabled: false })
  })

  it("says it is creating, and cannot be pressed twice", async () => {
    let finish: (code: string) => void = () => {}
    const onCreate = jest.fn(() => new Promise<string>((resolve) => (finish = resolve)))
    await render(created({ onCreate }))
    await fireEvent.press(screen.getByRole("button", { name: "Create channel" }))
    expect(screen.getByRole("button", { name: "Creating…" }).props.accessibilityState).toMatchObject({ disabled: true })
    await fireEvent.press(screen.getByRole("button", { name: "Creating…" }))
    expect(onCreate).toHaveBeenCalledTimes(1)
    finish("mc2-x")
  })

  it("offers Have a code only when it can, and Cancel", async () => {
    const onJoin = jest.fn()
    const onClose = jest.fn()
    const view = await render(created({ onClose }))
    expect(screen.queryByRole("button", { name: "Have a code? Join" })).toBeNull()
    await view.rerender(created({ onClose, onJoin }))
    await fireEvent.press(screen.getByRole("button", { name: "Have a code? Join" }))
    expect(onJoin).toHaveBeenCalledTimes(1)
    await fireEvent.press(screen.getByRole("button", { name: "Cancel" }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe("JoinSheet", () => {
  it("cannot ask until there is a code, and says nothing while the field is empty", async () => {
    await render(joining())
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.getByRole("button", { name: "Ask to join" }).props.accessibilityState).toMatchObject({ disabled: true })
  })

  it("says what is wrong with something that is not a code", async () => {
    const onJoin = jest.fn()
    await render(joining({ onJoin }))
    await fireEvent.changeText(screen.getByLabelText("Join code or link"), "hello there")
    expect(screen.getByText(NOT_A_CODE)).toBeTruthy()
    await fireEvent.press(screen.getByRole("button", { name: "Ask to join" }))
    expect(onJoin).not.toHaveBeenCalled()
  })

  it.each([
    ["a bare code", code],
    ["a kiwi link", `kiwi://join/${code}`],
    ["an invite page", `https://channels.kiwiinit.com/join/${code}`],
  ])("takes %s, clears the message and hands over the code", async (_name, text) => {
    const onJoin = jest.fn()
    await render(joining({ onJoin }))
    await fireEvent.changeText(screen.getByLabelText("Join code or link"), "nope")
    expect(screen.getByText(NOT_A_CODE)).toBeTruthy()
    await fireEvent.changeText(screen.getByLabelText("Join code or link"), `  ${text}  `)
    expect(screen.queryByText(NOT_A_CODE)).toBeNull()
    await fireEvent.press(screen.getByRole("button", { name: "Ask to join" }))
    expect(onJoin).toHaveBeenCalledWith(code)
    expect(screen.getByLabelText("Join code or link").props.value).toBe("")
  })
})

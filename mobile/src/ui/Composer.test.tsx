import { fireEvent, render, screen } from "@testing-library/react-native"
import { StyleSheet } from "react-native"

import { Composer, type Attachment, type Person } from "./Composer"

const people: Person[] = [
  { name: "me", label: "Me", agent: false },
  { name: "kiwi-sh", label: "Coordinator", agent: true },
  { name: "kiwi-browser", label: "Browser", agent: true },
  { name: "merge-bus", label: "Merge bus", agent: true },
]

const input = () => screen.getByLabelText("Message")
const send = () => screen.getByRole("button", { name: "Send" })

async function type(text: string) {
  await fireEvent.changeText(input(), text)
  await fireEvent(input(), "selectionChange", { nativeEvent: { selection: { start: text.length, end: text.length } } })
}

describe("Composer", () => {
  it("cannot send an empty message, and sends a typed one trimmed, then clears", async () => {
    const onSend = jest.fn()
    await render(<Composer me="me" people={people} onSend={onSend} />)
    expect(send().props.accessibilityState).toMatchObject({ disabled: true })
    await type("  hello there  ")
    expect(send().props.accessibilityState).toMatchObject({ disabled: false })
    await fireEvent.press(send())
    expect(onSend).toHaveBeenCalledWith({ body: "hello there", to: [] })
    expect(input().props.value).toBe("")
    expect(send().props.accessibilityState).toMatchObject({ disabled: true })
  })

  it("addresses a message to the people it starts by naming", async () => {
    const onSend = jest.fn()
    await render(<Composer me="me" people={people} onSend={onSend} />)
    await type("@kiwi-sh @merge-bus please look")
    await fireEvent.press(send())
    expect(onSend).toHaveBeenCalledWith({ body: "@kiwi-sh @merge-bus please look", to: ["kiwi-sh", "merge-bus"] })
  })

  it("lists who an @ could mean, and writes the name when one is tapped", async () => {
    await render(<Composer me="me" people={people} onSend={jest.fn()} />)
    await type("hi @ki")
    expect(screen.getByRole("menuitem", { name: "Mention Coordinator" })).toBeTruthy()
    expect(screen.getByRole("menuitem", { name: "Mention Browser" })).toBeTruthy()
    expect(screen.queryByRole("menuitem", { name: "Mention Merge bus" })).toBeNull()
    expect(screen.queryByRole("menuitem", { name: "Mention Me" })).toBeNull()
    await fireEvent.press(screen.getByRole("menuitem", { name: "Mention Coordinator" }))
    expect(input().props.value).toBe("hi @kiwi-sh ")
    expect(screen.queryByRole("menu")).toBeNull()
  })

  it("shows no list when the caret is not on an @", async () => {
    await render(<Composer me="me" people={people} onSend={jest.fn()} />)
    await type("nothing to mention")
    expect(screen.queryByRole("menu")).toBeNull()
  })

  it("grows with its text up to a limit", async () => {
    await render(<Composer me="me" people={people} onSend={jest.fn()} />)
    const height = () => StyleSheet.flatten(input().props.style).height
    expect(height()).toBe(36)
    await fireEvent(input(), "contentSizeChange", { nativeEvent: { contentSize: { width: 200, height: 90 } } })
    expect(height()).toBe(90)
    await fireEvent(input(), "contentSizeChange", { nativeEvent: { contentSize: { width: 200, height: 600 } } })
    expect(height()).toBe(220)
  })

  it("does not send while disabled", async () => {
    const onSend = jest.fn()
    await render(<Composer me="me" people={people} onSend={onSend} disabled />)
    await type("hello")
    await fireEvent.press(send())
    expect(onSend).not.toHaveBeenCalled()
    expect(input().props.editable).toBe(false)
  })

  it("keeps the draft when sending fails", async () => {
    const onSend = jest.fn().mockRejectedValue(new Error("the relay is out of reach"))
    await render(<Composer me="me" people={people} onSend={onSend} />)
    await type("important")
    await fireEvent.press(send())
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(input().props.value).toBe("important")
  })
})

describe("Composer attachments", () => {
  const files: Attachment[] = [
    { id: "a", name: "shot.png", uri: "file:///shot.png" },
    { id: "b", name: "photo.jpg", uri: "file:///photo.jpg" },
  ]

  it("shows a chip for each, removes one on request, and sends with no text", async () => {
    const onRemove = jest.fn()
    const onSend = jest.fn()
    await render(<Composer me="me" people={people} onSend={onSend} attachments={files} onRemoveAttachment={onRemove} />)
    expect(screen.getByLabelText("shot.png")).toBeTruthy()
    expect(screen.getByLabelText("photo.jpg")).toBeTruthy()
    await fireEvent.press(screen.getByRole("button", { name: "Remove photo.jpg" }))
    expect(onRemove).toHaveBeenCalledWith("b")
    expect(send().props.accessibilityState).toMatchObject({ disabled: false })
    await fireEvent.press(send())
    expect(onSend).toHaveBeenCalledWith({ body: "shot.png, photo.jpg", to: [] })
  })

  it("offers the picker through the + button, and stops at eight", async () => {
    const onAttach = jest.fn()
    const view = await render(<Composer me="me" people={people} onSend={jest.fn()} onAttach={onAttach} />)
    await fireEvent.press(screen.getByRole("button", { name: "Attach images" }))
    expect(onAttach).toHaveBeenCalledTimes(1)
    const eight = Array.from({ length: 8 }, (_, i) => ({ id: String(i), name: `${i}.png`, uri: `file:///${i}.png` }))
    await view.rerender(<Composer me="me" people={people} onSend={jest.fn()} onAttach={onAttach} attachments={eight} />)
    expect(screen.getByRole("button", { name: "Attach images" }).props.accessibilityState).toMatchObject({ disabled: true })
  })
})

describe("Composer reply bar", () => {
  it("says what is being answered, can be cancelled, and clears after a send", async () => {
    const onClear = jest.fn()
    await render(<Composer me="me" people={people} onSend={jest.fn()} replyTo={{ label: "Coordinator", text: "ship it?" }} onClearReply={onClear} />)
    expect(screen.getByText("Replying to Coordinator")).toBeTruthy()
    expect(screen.getByText("ship it?")).toBeTruthy()
    await fireEvent.press(screen.getByRole("button", { name: "Cancel reply" }))
    expect(onClear).toHaveBeenCalledTimes(1)
    await type("yes")
    await fireEvent.press(send())
    expect(onClear).toHaveBeenCalledTimes(2)
  })
})

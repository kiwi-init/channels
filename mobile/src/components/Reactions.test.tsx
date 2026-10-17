import { fireEvent, render, screen } from "@testing-library/react-native"
import pack from "../../../assets/reactions/index.json"

import { gifByKey, gifs } from "../lib/gifs"
import type { Chip } from "../lib/reactions"
import { Frame } from "../ui/Frame"
import { ReactionChip } from "./ReactionChip"
import { ReactionPicker } from "./ReactionPicker"

describe("the GIF pack", () => {
  it("has all 30 GIFs, each with a bundled file", () => {
    expect(pack).toHaveLength(30)
    expect(gifs).toHaveLength(30)
    for (const entry of pack) expect(typeof gifByKey(`${entry.reaction}/${entry.name}`)?.source).toBe("number")
  })
})

describe("ReactionChip", () => {
  const chip = (emoji: string, over: Partial<Chip> = {}): Chip => ({ emoji, who: ["ann"], mine: false, ...over })

  it("draws a GIF reaction as its picture, named for its feeling", async () => {
    const first = gifs[0]!
    await render(<ReactionChip chip={chip(first.key, { who: ["ann", "bo"] })} />)
    expect(screen.getByLabelText(`${first.feeling}, from ann, bo`)).toBeTruthy()
  })

  it("draws an emoji with a count when several reacted", async () => {
    await render(<ReactionChip chip={chip("👍", { who: ["ann", "bo"] })} />)
    expect(screen.getByLabelText("👍 ann and bo")).toBeTruthy()
    expect(screen.getByText("👍 2")).toBeTruthy()
  })

  it("falls back to text for a GIF key nobody has", async () => {
    await render(<ReactionChip chip={chip("nope/not-a-gif")} />)
    expect(screen.getByText("nope/not-a-gif")).toBeTruthy()
  })
})

describe("ReactionPicker", () => {
  it("offers emoji and every GIF, and picks one", async () => {
    const onPick = jest.fn()
    const onClose = jest.fn()
    await render(
      <Frame>
        <ReactionPicker visible onClose={onClose} onPick={onPick} />
      </Frame>
    )
    expect(screen.getAllByLabelText(/^React with /).length).toBe(6 + 30)
    await fireEvent.press(screen.getByLabelText("React with 👍"))
    expect(onPick).toHaveBeenCalledWith("👍")
    await fireEvent.press(screen.getByLabelText(`React with ${gifs[0]!.feeling}`))
    expect(onPick).toHaveBeenLastCalledWith(gifs[0]!.key)
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

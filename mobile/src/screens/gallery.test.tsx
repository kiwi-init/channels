import { render, screen } from "@testing-library/react-native"

import Gallery from "../../app/gallery"
import { Frame } from "../ui/Frame"

jest.mock("expo-router", () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn() }) }))

describe("the gallery", () => {
  it("shows every piece with its fixture, without a relay", async () => {
    await render(
      <Frame>
        <Gallery />
      </Frame>
    )
    for (const title of ["Buttons", "Inputs, sheet and toast", "Messages", "Markdown", "Reactions", "Agents", "Tasks", "Needs you"]) expect(screen.getByText(title)).toBeTruthy()
    expect(screen.getByLabelText("Open a sheet")).toBeTruthy()
    expect(screen.getByText("Ann wants to join")).toBeTruthy()
    expect(screen.getAllByLabelText(/^Open task T\d/).length).toBe(4)
  })
})

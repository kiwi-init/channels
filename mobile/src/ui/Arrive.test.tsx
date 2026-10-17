import { render, screen, waitFor } from "@testing-library/react-native"
import { AccessibilityInfo, StyleSheet, Text } from "react-native"

import { Arrive } from "./Arrive"

afterEach(() => jest.restoreAllMocks())

describe("Arrive", () => {
  it("is plain for a message that was there already", async () => {
    await render(
      <Arrive active={false} from="left">
        <Text>old</Text>
      </Arrive>
    )
    const style = StyleSheet.flatten(screen.getByTestId("arrive").props.style)
    expect(style.opacity).toBe(1)
  })

  it("settles at full opacity at once when motion is reduced", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true)
    await render(
      <Arrive active from="right">
        <Text>new</Text>
      </Arrive>
    )
    await waitFor(() => expect(StyleSheet.flatten(screen.getByTestId("arrive").props.style).opacity).toBe(1))
  })
})

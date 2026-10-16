import { Add01Icon, Home01Icon, Search01Icon } from "@hugeicons/core-free-icons"
import { render, screen } from "@testing-library/react-native"
import * as RN from "react-native"

import { light } from "../theme/tokens"
import { Icon } from "./Icon"

interface Drawn {
  type?: string
  props?: Record<string, unknown>
  children?: Drawn[] | null
}

function svgViews(node: Drawn | Drawn[] | null = screen.toJSON() as Drawn | null): Drawn[] {
  if (!node) return []
  if (Array.isArray(node)) return node.flatMap((one) => svgViews(one))
  const here = node.type === "RNSVGSvgView" ? [node] : []
  return [...here, ...svgViews(node.children ?? [])]
}

function pathCount(node: Drawn | Drawn[] | null): number {
  if (!node) return 0
  if (Array.isArray(node)) return node.reduce((total, one) => total + pathCount(one), 0)
  return (node.type === "RNSVGPath" ? 1 : 0) + pathCount(node.children ?? [])
}

afterEach(() => jest.restoreAllMocks())

describe("Icon", () => {
  it("renders three of them, each with a drawn path", async () => {
    jest.spyOn(RN, "useColorScheme").mockReturnValue("light")
    await render(
      <>
        <Icon icon={Add01Icon} />
        <Icon icon={Search01Icon} />
        <Icon icon={Home01Icon} />
      </>
    )
    const views = svgViews()
    expect(views).toHaveLength(3)
    for (const view of views) expect(pathCount(view)).toBeGreaterThan(0)
  })

  it("wears one stroke weight and one size, in the ink colour, unless told otherwise", async () => {
    jest.spyOn(RN, "useColorScheme").mockReturnValue("light")
    await render(
      <>
        <Icon icon={Add01Icon} />
        <Icon icon={Search01Icon} color="#123456" />
        <Icon icon={Home01Icon} size={28} strokeWidth={2} />
      </>
    )
    const [plain, quiet, big] = svgViews()
    expect(plain?.props?.strokeWidth).toBe(1.6)
    expect(big?.props?.strokeWidth).toBe(2)
    expect(plain?.props?.width).toBe(18)
    expect(plain?.props?.height).toBe(18)
    expect(big?.props?.width).toBe(28)
    expect(plain?.props?.color).toBe(light.ink)
    expect(quiet?.props?.color).toBe("#123456")
  })
})

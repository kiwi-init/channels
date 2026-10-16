import { fireEvent, render, screen } from "@testing-library/react-native"
import { Linking } from "react-native"

import { safeUrl } from "../lib/markdown"
import { Markdown } from "./Markdown"

describe("safe links", () => {
  it("allows http, https, mailto and tel only", () => {
    expect(safeUrl("https://example.com/a")).toBe("https://example.com/a")
    expect(safeUrl("http://example.com")).toBe("http://example.com")
    expect(safeUrl("mailto:a@b.example")).toBe("mailto:a@b.example")
    expect(safeUrl("tel:+15551212")).toBe("tel:+15551212")
  })

  it("rejects scripts, data, files, relative paths and userinfo", () => {
    for (const url of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,hi",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "/channel/facts/ip",
      "//evil.example",
      "https://user:pass@evil.example",
      "https://evil.example/a b",
      "java\nscript:alert(1)",
      "https://evil.example/\t.good.com",
      "https://",
    ]) {
      expect(safeUrl(url)).toBeUndefined()
    }
  })
})

describe("Markdown", () => {
  afterEach(() => jest.restoreAllMocks())

  it("opens a safe link and leaves an unsafe one as text", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined)
    await render(<Markdown>{"[ok](https://example.com) and [bad](javascript:alert(1))"}</Markdown>)
    await fireEvent.press(screen.getByText("ok"))
    expect(open).toHaveBeenCalledWith("https://example.com")
    expect(screen.getByText(/bad/)).toBeTruthy()
    expect(screen.queryByRole("link", { name: "bad" })).toBeNull()
  })

  it("does not fetch images: it names the host", async () => {
    await render(<Markdown>{"![pic](https://evil.example/x.png)"}</Markdown>)
    expect(screen.getByText("pic (opens evil.example)")).toBeTruthy()
    expect(screen.queryByLabelText("pic")).toBeNull()
  })

  it("draws bold, italic, strike, inline code, lists, quotes and breaks", async () => {
    await render(<Markdown>{"**bold** *it* ~~gone~~ `code`\n\n1. one\n2. two\n\n- a\n- [x] done\n\n> quoted\n\nline\nbreak"}</Markdown>)
    for (const text of ["bold", "it", "gone", "code", "one", "two", "a", "done", "quoted"]) expect(screen.getAllByText(new RegExp(text)).length).toBeGreaterThan(0)
    expect(screen.getByText("1.")).toBeTruthy()
    expect(screen.getByText("☑")).toBeTruthy()
  })

  it("a fenced block offers copy, and mermaid stays code", async () => {
    await render(<Markdown>{"```js\nconsole.log(1)\n```\n\n```mermaid\nflowchart LR\n  A --> B\n```"}</Markdown>)
    expect(screen.getByText("console.log(1)")).toBeTruthy()
    expect(screen.getByText(/A --> B/)).toBeTruthy()
    expect(screen.getAllByLabelText("Copy code")).toHaveLength(2)
  })

  it("sorts a table by a header, numbers as numbers", async () => {
    await render(<Markdown>{"| n | name |\n| - | - |\n| 10 | b |\n| 2 | a |\n"}</Markdown>)
    const order = () => screen.getAllByTestId(/^row-/).map((node) => node.props.testID)
    expect(order()).toEqual(["row-0", "row-1"])
    await fireEvent.press(screen.getByLabelText("Sort by n"))
    expect(order()).toEqual(["row-1", "row-0"])
    await fireEvent.press(screen.getByLabelText("Sort by n"))
    expect(order()).toEqual(["row-0", "row-1"])
  })

  it("drops raw html", async () => {
    await render(<Markdown>{"<script>alert(1)</script>\n\nsafe"}</Markdown>)
    expect(screen.queryByText(/script/)).toBeNull()
    expect(screen.getByText("safe")).toBeTruthy()
  })
})

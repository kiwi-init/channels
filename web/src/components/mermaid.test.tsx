import { expect, test } from "bun:test"
import { linksApart } from "./mermaid"

test("a diagram's click links open apart from the app, whatever target the diagram asked for", () => {
  expect(linksApart('<g><a xlink:href="https://evil.example/login"><rect/></a></g>')).toBe('<g><a xlink:href="https://evil.example/login" target="_blank" rel="noopener noreferrer"><rect/></a></g>')
  expect(linksApart(`<a href="https://x.example" target="_self" rel='opener'><text>go</text></a>`)).toBe('<a href="https://x.example" target="_blank" rel="noopener noreferrer"><text>go</text></a>')
  expect(linksApart('<a target=_top href="https://x.example"/>')).toBe('<a href="https://x.example" target="_blank" rel="noopener noreferrer"/>')
  expect(linksApart('<g><animate attributeName="x"/><text>a</text></g>')).toBe('<g><animate attributeName="x"/><text>a</text></g>')
})

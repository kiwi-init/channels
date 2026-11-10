import { describe, expect, test } from "bun:test"
import { isValidElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { LandingPick } from "~/modals/landing-pick"

const optionsIn = (html: string) => [...html.matchAll(/<option value="([^"]*)"( selected="")?>([^<]*)<\/option>/g)].map(([, value, selected, label]) => ({ value, label, selected: !!selected }))

type SelectProps = { onChange: (e: { target: { value: string } }) => void; children?: ReactNode }

function selectIn(node: ReactNode): ReactElement<SelectProps> | undefined {
  if (!isValidElement<SelectProps>(node)) return undefined
  if (node.type === "select") return node
  const kids = node.props.children
  for (const kid of Array.isArray(kids) ? kids : [kids]) {
    const found = selectIn(kid)
    if (found) return found
  }
  return undefined
}

describe("Tasks land on is a dropdown (T1368)", () => {
  test("it offers Approval, a merged pull request, a release tag and a finished run, in words (T3548), with the channel's current one selected", () => {
    expect(optionsIn(renderToStaticMarkup(<LandingPick value={undefined} onPick={() => {}} />))).toEqual([
      { value: "", label: "Approval", selected: true },
      { value: "merge", label: "A merged pull request", selected: false },
      { value: "release:tag", label: "A release tag", selected: false },
      { value: "run", label: "A finished run", selected: false },
    ])
    expect(optionsIn(renderToStaticMarkup(<LandingPick value="release:tag" onPick={() => {}} />)).filter((o) => o.selected)).toEqual([{ value: "release:tag", label: "A release tag", selected: true }])
  })

  test("a channel that already lands on an npm release keeps it, shown as the selected option", () => {
    const options = optionsIn(renderToStaticMarkup(<LandingPick value="release:npm:@kiwi/core@^2" onPick={() => {}} />))
    expect(options.map((o) => o.value)).toEqual(["", "merge", "release:tag", "run", "release:npm:@kiwi/core@^2"])
    expect(options.filter((o) => o.selected).map((o) => o.value)).toEqual(["release:npm:@kiwi/core@^2"])
  })

  test("picking one saves it, and picking Approval clears it, through the same setLanding path", () => {
    const saved: (string | null)[] = []
    const select = selectIn(LandingPick({ value: "merge", onPick: (then) => saved.push(then) }))
    if (!select) throw new Error("no select in the picker")
    select.props.onChange({ target: { value: "run" } })
    select.props.onChange({ target: { value: "" } })
    expect(saved).toEqual(["run", null])
  })
})

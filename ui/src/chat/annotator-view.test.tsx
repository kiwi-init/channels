import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import Annotator from "~/chat/annotator"
import { ActContext, type Act } from "~/nav"

const view = (props: Partial<Parameters<typeof Annotator>[0]> = {}) =>
  renderToStaticMarkup(
    <ActContext.Provider value={{ actions: {}, go: () => {}, toast: () => {} } as unknown as Act}>
      <Annotator image={{ url: "data:image/png;base64,AA==", alt: "board.png" }} onClose={() => {}} {...props} />
    </ActContext.Provider>
  )

describe("a click on an image opens it to look at (T1876)", () => {
  test("it opens as a viewer named by the file, with an Annotate button and no tool armed for drawing", () => {
    const html = view()
    expect(html).toContain('aria-label="board.png"')
    expect(html).toContain(">Annotate<")
    expect(html).toMatch(/<div class="annot-bar" hidden="">/)
    expect(html).toMatch(/aria-label="Move \(V\)"[^>]*aria-pressed="true"/)
    expect(html).not.toMatch(/aria-label="Arrow \(A\)"[^>]*aria-pressed="true"/)
  })

  test("the reply box waits for Annotate too, even where a reply can be sent", () => {
    expect(view({ sender: "pixel", at: 0, onSend: () => {} })).not.toContain("annot-reply")
  })

  test("an image opened from a spec or a summary has no sender line to show", () => {
    expect(view()).not.toContain("annot-meta")
    expect(view({ sender: "pixel", at: 0 })).toContain("annot-meta")
  })
})

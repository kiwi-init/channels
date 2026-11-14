import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import { BlockFilesView } from "~/chat/block-files"
import { BlockFilesSpots } from "~/chat/block-files-spots"
import type { BlockFiles } from "~/model"
import { ActContext, type Act } from "~/nav"

const media: BlockFiles = {
  imgs: [{ name: "first-load.png", mime: "image/png", ref: { id: "i1", key: "k", size: 2048 } }],
  files: [
    { name: "bundle-report.txt", mime: "text/plain", size: 84, pieces: [{ id: "f1", key: "k", size: 84 }] },
    { name: "trace.json", mime: "application/json", size: 3 * 1024 * 1024, pieces: [{ id: "f2", key: "k", size: 3 * 1024 * 1024 }] },
  ],
}

const loaded = () =>
  renderToStaticMarkup(
    <ActContext.Provider value={{} as Act}>
      <BlockFilesView code="c" media={media} open={() => {}} />
    </ActContext.Provider>
  )

const boxes = (html: string): string => html.replace(/ (?!class=)[a-z-]+="[^"]*"/g, "").replace(/(<span class="msg-image-spot">)[^<]*/g, "$1")

describe("file chips before their chunk lands", () => {
  test("draw the same boxes as the loaded chips, so the row doesn't grow when it lands (T4122)", () => {
    expect(boxes(renderToStaticMarkup(<BlockFilesSpots media={media} />))).toBe(boxes(loaded()))
  })

  test("show each file's name and size", () => {
    const html = renderToStaticMarkup(<BlockFilesSpots media={media} />)
    expect(html).toContain('bundle-report.txt</span><span class="msg-file-size">84 B')
    expect(html).toContain('trace.json</span><span class="msg-file-size">3.0 MB')
  })
})

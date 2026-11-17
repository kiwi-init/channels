import type { LiveThreadDoc } from "~/chat/doc/editor"

type DocView = typeof LiveThreadDoc

let loaded: DocView | null = null

export const docViewNow = (): DocView | null => loaded

export const loadDocView = (): Promise<DocView> =>
  import("~/chat/doc/editor").then((m) => {
    loaded = m.LiveThreadDoc
    return m.LiveThreadDoc
  })

import { showCalm } from "~/calm/idle"
import { useCommands, useKeys } from "~/commands/table"
import type { Go, Nav } from "~/nav"

const dialogsOpen = (): number => document.querySelectorAll("dialog[open]").length

export function useAppCommands(nav: Nav, go: (go: Go) => void): void {
  useKeys()
  const palette = nav.dialog === "palette"
  const free = () => dialogsOpen() <= (nav.modal ? 1 : 0)
  useCommands([
    { id: "app.palette", run: () => go({ to: "dialog", dialog: palette ? null : "palette" }) },
    {
      id: "app.calm",
      run: () => {
        if (palette) go({ to: "dialog", dialog: null })
        else if (dialogsOpen()) return
        showCalm()
      },
    },
    { id: "nav.back", when: free, run: () => go({ to: "history", step: "back" }) },
    { id: "nav.forward", when: free, run: () => go({ to: "history", step: "forward" }) },
  ])
}

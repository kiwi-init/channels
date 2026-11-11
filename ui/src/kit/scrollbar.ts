export function watchScrollbar(): () => void {
  const read = () => {
    const probe = document.createElement("div")
    probe.style.cssText = "position:absolute;top:-99px;width:50px;height:50px;overflow:scroll;visibility:hidden"
    document.body.append(probe)
    document.documentElement.style.setProperty("--bar", `${probe.offsetWidth - probe.clientWidth}px`)
    probe.remove()
  }
  read()
  window.addEventListener("focus", read)
  return () => window.removeEventListener("focus", read)
}

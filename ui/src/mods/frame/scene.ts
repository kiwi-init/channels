interface SceneParts {
  styles: string[]
  body: string
  bodyStyle: string | null
  scripts: string[]
}

const CLASSIC = new Set(["", "text/javascript", "application/javascript"])

function sceneParts(doc: Document): SceneParts {
  const scripts: string[] = []
  for (const s of [...doc.querySelectorAll("script")]) {
    if (!s.src && CLASSIC.has((s.getAttribute("type") ?? "").trim().toLowerCase())) scripts.push(s.textContent ?? "")
    s.remove()
  }
  const styles = [...doc.querySelectorAll("style")].map((s) => s.textContent ?? "")
  for (const s of [...doc.body.querySelectorAll("style")]) s.remove()
  return { styles, body: doc.body.innerHTML, bodyStyle: doc.body.getAttribute("style"), scripts }
}

export function runScene(html: string): void {
  const parts = sceneParts(new DOMParser().parseFromString(html, "text/html"))
  for (const css of parts.styles) {
    const el = document.createElement("style")
    el.textContent = css
    document.head.append(el)
  }
  document.body.innerHTML = parts.body
  if (parts.bodyStyle) document.body.setAttribute("style", parts.bodyStyle)
  for (const code of parts.scripts) new Function(code)()
}

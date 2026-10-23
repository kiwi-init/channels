const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/i

export function drawsInSoftware(renderer: string | null): boolean {
  return renderer === null || SOFTWARE.test(renderer)
}

function renderer(): string | null {
  const gl = document.createElement("canvas").getContext("webgl")
  if (!gl) return null
  const info = gl.getExtension("WEBGL_debug_renderer_info")
  const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : ""
  gl.getExtension("WEBGL_lose_context")?.loseContext()
  return name
}

export function noteSoftwareDrawing(): void {
  try {
    if (drawsInSoftware(renderer())) document.documentElement.dataset.drawing = "software"
  } catch {
    // A browser that refuses even to answer draws as it always has.
  }
}

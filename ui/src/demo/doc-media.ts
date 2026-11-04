import type { DocFile, DocImage } from "~/chat/doc/schema"
import type { Upload } from "~/model"

const CHART = `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="240"><rect width="560" height="240" fill="#0b0b0c"/><g font-family="monospace" font-size="14" fill="#f4f4f5"><text x="32" y="44">first-load JS</text><text x="32" y="104">before</text><text x="32" y="164">after</text></g><rect x="120" y="88" width="380" height="22" fill="#a1a1aa"/><rect x="120" y="148" width="296" height="22" fill="#f4f4f5"/><g font-family="monospace" font-size="12" fill="#0b0b0c"><text x="128" y="104">812 KB</text><text x="128" y="164">741 KB</text></g></svg>`
const REPORT = "first-load JS: 741,425 bytes (budget 760,000)\nmarkdown: 27 KB gzipped\nmermaid: lazy\n"

const stored = new Map<string, string>()
let made = 0

const fakeId = (n: number): string => n.toString(16).padStart(64, "0")
const fakeKey = (n: number): string => `demo${n}`.padEnd(43, "k")
const b64 = (text: string): string => btoa(unescape(encodeURIComponent(text)))

export const DEMO_CHART: DocImage = { name: "first-load.svg", mime: "image/svg+xml", ref: { id: fakeId(1), key: fakeKey(1), size: CHART.length } }
export const DEMO_REPORT: DocFile = { name: "bundle-report.txt", mime: "text/plain", size: REPORT.length, pieces: [{ id: fakeId(2), key: fakeKey(2), size: REPORT.length }] }

stored.set(DEMO_CHART.ref.id, b64(CHART))
stored.set(fakeId(2), b64(REPORT))
made = 2

export function putDemoImage(upload: Upload): Promise<DocImage> {
  made += 1
  const ref = { id: fakeId(made), key: fakeKey(made), size: Math.floor((upload.data.length * 3) / 4) }
  stored.set(ref.id, upload.data)
  return Promise.resolve({ name: upload.name, mime: upload.mime, ref })
}

export function putDemoFile(upload: Upload): Promise<DocFile> {
  made += 1
  const size = Math.floor((upload.data.length * 3) / 4)
  stored.set(fakeId(made), upload.data)
  return Promise.resolve({ name: upload.name, mime: upload.mime, size, pieces: [{ id: fakeId(made), key: fakeKey(made), size }] })
}

export const demoImage = (img: DocImage): Promise<string | null> => Promise.resolve(stored.get(img.ref.id) ?? null)

export const demoFile = (f: DocFile): Promise<string | null> => Promise.resolve(f.pieces[0] ? (stored.get(f.pieces[0].id) ?? null) : null)

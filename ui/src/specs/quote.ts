const QUOTE_RE = /^>\s?(.*)$/

export function splitQuote(text: string): { quote?: string; text: string } {
  const lines = text.split("\n")
  const quoted: string[] = []
  let i = 0
  while (i < lines.length && QUOTE_RE.test(lines[i]!)) quoted.push(QUOTE_RE.exec(lines[i++]!)![1]!)
  if (!quoted.length) return { text }
  return { quote: quoted.join("\n").trim(), text: lines.slice(i).join("\n").trim() }
}

const squash = (s: string): string =>
  s
    .replace(/[*_`~#>[\]()]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()

export function quoteIn(text: string, quote: string): boolean {
  const q = squash(quote)
  return !!q && squash(text).includes(q)
}

export function specLineTest(spec: string, ask = ""): (body: string) => boolean {
  let lines: string | undefined
  let asked: string | undefined
  return (body) => {
    const { quote } = splitQuote(body)
    if (quote === undefined) return false
    const q = squash(quote)
    return !!q && (lines ??= squash(spec)).includes(q) && !(asked ??= squash(ask)).includes(q)
  }
}

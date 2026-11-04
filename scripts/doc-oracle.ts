export function inOrder(out: string, sent: readonly string[], author = "jow"): string | null {
  const head = `${author}:`;
  let at = 0;
  for (const s of sent) {
    let found = -1;
    for (let k = out.indexOf(head, at); k >= 0 && found < 0; k = out.indexOf(head, k + 1)) {
      if (k > 0 && out[k - 1] !== "\n") continue;
      const body = out.slice(k + head.length).replace(/^\s+/, "");
      if (!body.startsWith(s)) continue;
      const rest = body.slice(s.length);
      if (/^\s*$/.test(rest) || /^[ \t]*\n(?:[ \t]*\n)+(?=[^\s][^\n]*?:(?: |\n|$))/.test(rest)) found = k + head.length;
    }
    if (found < 0) return s;
    at = found;
  }
  return null;
}

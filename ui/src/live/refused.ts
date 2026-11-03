const FINAL = new Set(["BadRequest", "TooLarge", "ReadOnly", "Denied", "Forbidden"])

export function refusal(err: unknown): string | null {
  if (typeof err !== "object" || err === null || !("_tag" in err)) return null
  const message = "message" in err && typeof err.message === "string" ? err.message : "the relay refused it"
  if (err._tag === "Rejected") return message
  if (err._tag === "RelayError" && "tag" in err && typeof err.tag === "string" && FINAL.has(err.tag)) return message
  return null
}

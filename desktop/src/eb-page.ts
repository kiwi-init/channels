import { csp } from "./guard.ts";

export const PAGE_URL = "views://internal/index.html";

export const PAGE_RULES = ["^*", "views://internal/*"];

const escapeAttr = (s: string): string => s.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

export function pageWithCsp(index: string, relay: string): string {
  const head = /<head(?:\s[^>]*)?>/i.exec(index);
  if (!head) throw new Error("web/dist/index.html has no <head>");
  const at = head.index + head[0].length;
  if (/<script/i.test(index.slice(0, at))) throw new Error("web/dist/index.html runs a script before <head>");
  const meta = `<meta http-equiv="Content-Security-Policy" content="${escapeAttr(csp(relay))}">`;
  return `${index.slice(0, at)}${meta}${index.slice(at)}`;
}

export function navigationUrl(detail: unknown): { url: string; allowed: boolean } | null {
  if (typeof detail !== "string") return null;
  try {
    const v = JSON.parse(detail) as unknown;
    if (!v || typeof v !== "object") return null;
    const { url, allowed } = v as { url?: unknown; allowed?: unknown };
    return typeof url === "string" && typeof allowed === "boolean" ? { url, allowed } : null;
  } catch {
    // WebKit hands over its own JSON; one it couldn't build is a navigation we neither allow nor open.
    return null;
  }
}

export function openedUrl(detail: unknown): string | null {
  if (typeof detail === "string") return detail;
  if (!detail || typeof detail !== "object") return null;
  const { url } = detail as { url?: unknown };
  return typeof url === "string" ? url : null;
}

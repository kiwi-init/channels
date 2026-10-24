import { csp } from "./guard.ts";

export const PAGE_URL = "views://internal/index.html";

export const PAGE_RULES = ["^*", PAGE_URL, `${PAGE_URL}#*`, `${PAGE_URL}?*`];

export const PAGE_TEMPLATE = "page/index.html";

export const RULES_CANARY = "views://internal/kiwi-rules-check";

export function isPageUrl(url: string): boolean {
  if (url.slice(0, PAGE_URL.length).toLowerCase() !== PAGE_URL) return false;
  const next = url.charAt(PAGE_URL.length);
  return next === "" || next === "#" || next === "?";
}

const WS = String.raw`[\t\n\f\r ]`;

const ATTRS = String.raw`(?:${WS}+[^\t\n\f\r "'>/=]+(?:${WS}*=${WS}*(?:"[^"]*"|'[^']*'|[^\t\n\f\r "'=<>\x60]+))?)*${WS}*`;

const PROLOGUE = new RegExp(String.raw`^\uFEFF?${WS}*(?:<!doctype${WS}[^<>]*>${WS}*)?(?:<html${ATTRS}>${WS}*)?<head${ATTRS}>`, "i");

const escapeAttr = (s: string): string => s.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

export function pageWithCsp(index: string, relay: string): string {
  const head = PROLOGUE.exec(index);
  if (!head) throw new Error("web/dist/index.html must open with only a doctype, <html> and <head>, so the CSP can go first in <head>");
  const at = head[0].length;
  const meta = `<meta http-equiv="Content-Security-Policy" content="${escapeAttr(csp(relay))}">`;
  return `${index.slice(0, at)}${meta}${index.slice(at)}`;
}

export type Navigation = { kind: "page" } | { kind: "refused"; url: string } | { kind: "breach"; url: string | null };

export function navigation(detail: unknown): Navigation {
  if (typeof detail !== "string") return { kind: "breach", url: null };
  let v: unknown;
  try {
    v = JSON.parse(detail);
  } catch {
    // WebKit builds this JSON itself; one that doesn't parse might hide an allowed navigation, so it counts as one.
    return { kind: "breach", url: null };
  }
  const { url, allowed } = (v && typeof v === "object" ? v : {}) as { url?: unknown; allowed?: unknown };
  if (typeof url !== "string" || typeof allowed !== "boolean") return { kind: "breach", url: null };
  if (!allowed) return { kind: "refused", url };
  return isPageUrl(url) ? { kind: "page" } : { kind: "breach", url };
}

export function openedUrl(detail: unknown): string | null {
  if (typeof detail === "string") return detail;
  if (!detail || typeof detail !== "object") return null;
  const { url } = detail as { url?: unknown };
  return typeof url === "string" ? url : null;
}

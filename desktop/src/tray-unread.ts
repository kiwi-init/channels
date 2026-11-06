const ALERT = "#ff6259";

export function unreadLabel(count: number): string | null {
  if (!Number.isFinite(count) || count < 1) return null;
  return count > 9 ? "9+" : String(Math.trunc(count));
}

export function trayTitle(count: number): string {
  const label = unreadLabel(count);
  return label === null ? "Channels" : `Channels · ${Math.trunc(count)} unread`;
}

export function unreadSvg(base: string, label: string): string {
  const open = base.indexOf(">", base.indexOf("<svg"));
  const close = base.lastIndexOf("</svg>");
  if (open < 0 || close < open) throw new Error("the tray icon isn't an SVG");
  const inner = base.slice(open + 1, close);
  const size = label.length > 1 ? 30 : 38;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">',
    '<defs><mask id="unread-cut"><rect width="96" height="96" fill="#fff"/><circle cx="70" cy="26" r="30" fill="#000"/></mask></defs>',
    `<g mask="url(#unread-cut)">${inner}</g>`,
    `<circle cx="70" cy="26" r="25" fill="${ALERT}"/>`,
    `<text x="70" y="26" fill="#fff" font-family="sans-serif" font-size="${size}" font-weight="700" text-anchor="middle" dominant-baseline="central">${label}</text>`,
    "</svg>",
  ].join("");
}

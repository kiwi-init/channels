export interface MessageAt {
  code: string;
  seq: number;
}

const CODE = "[A-Za-z0-9_-]{1,64}";
const SEQ = "[1-9]\\d{0,14}";
const WHOLE = new RegExp(`^kiwi://join/(${CODE})/?\\?m=(${SEQ})$`);

export const MESSAGE_LINKS = new RegExp(`kiwi://join/(${CODE})/?\\?m=(${SEQ})(?![\\w-])`, "g");

export const messageLink = (code: string, seq: number): string => `kiwi://join/${encodeURIComponent(code)}?m=${seq}`;

export const messageHash = (code: string, seq: number): string => `#${encodeURIComponent(code)}?m=${seq}`;

export function messageAt(url: string): MessageAt | null {
  const m = WHOLE.exec(url.trim());
  const seq = Number(m?.[2]);
  return m?.[1] && Number.isSafeInteger(seq) ? { code: m[1], seq } : null;
}

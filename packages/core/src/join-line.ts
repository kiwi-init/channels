import { decodeJoinCode } from "./crypto.ts";
import { MAX_PIN } from "./pin.ts";

export interface JoinLine {
  code: string;
  relay?: string;
  nick?: string;
  persona?: string;
}

const NICK = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,39}$/u;
const TOKEN = /^[A-Za-z0-9_-]+$/;
const RELAY = /^(?:https:\/\/[A-Za-z0-9.-]+|http:\/\/(?:localhost|127(?:\.\d{1,3}){3}))(?::\d{1,5})?\/?$/;

export function joinLineRefusal(j: JoinLine): string | null {
  try {
    decodeJoinCode(j.code);
  } catch {
    return "that isn't a join code (they look like mc2-…-…)";
  }
  if (j.relay !== undefined && !RELAY.test(j.relay)) return "the relay is an https address with no path (plain http only on this computer)";
  if (j.nick !== undefined && !NICK.test(j.nick)) return "a nickname is 1 to 40 letters, digits, spaces, _ . or -, starting with a letter or digit";
  if (j.persona !== undefined && (j.persona.length > MAX_PIN || !TOKEN.test(j.persona))) return "the personality is the token from an invite, as it was copied";
  return null;
}

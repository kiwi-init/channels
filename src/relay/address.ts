// Who a request comes from, for per-address rate limits (the pairing mailbox's writes on Bun),
// and which reverse proxies may say so. Shared by the Cloudflare and Bun relays.

/** Writes one address may make in the window below. */
const WRITES_PER_WINDOW = 20;
const WRITE_WINDOW_MS = 10 * 60_000;
/** How many addresses the in-process limiter remembers. Past this, the oldest is dropped, not the whole table. */
const MAX_BUCKETS = 10_000;
const writes = new Map<string, number[]>();

/** Move this address to the newest end, then drop the oldest until the table fits. */
function remember(ip: string, stamps: number[]): void {
  writes.delete(ip);
  writes.set(ip, stamps);
  while (writes.size > MAX_BUCKETS) {
    const oldest = writes.keys().next().value;
    if (oldest === undefined || oldest === ip) break;
    writes.delete(oldest);
  }
}

/** False once this address has made WRITES_PER_WINDOW writes in the last 10 minutes. The Worker does not use this: an in-memory map does not survive across isolates. */
export function writeAllowed(ip: string, now = Date.now()): boolean {
  const kept = (writes.get(ip) ?? []).filter((t) => now - t < WRITE_WINDOW_MS);
  if (kept.length >= WRITES_PER_WINDOW) {
    remember(ip, kept);
    return false;
  }
  kept.push(now);
  remember(ip, kept);
  return true;
}

/** An address worth a bucket. Junk is refused so a header cannot mint unlimited keys. */
function usableIp(raw: string): string | null {
  let ip = raw.trim();
  if (ip.startsWith("[") && ip.endsWith("]")) ip = ip.slice(1, -1);
  if (!ip || ip.length > 64) return null;
  if (!/^[0-9a-fA-F:.]+$/.test(ip)) return null;
  if (!ip.includes(".") && !ip.includes(":")) return null;
  return ip;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    n = ((n << 8) | octet) >>> 0;
  }
  return n;
}

function v4text(n: number): string {
  return `${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`;
}

/** IPv4-mapped IPv6 becomes the IPv4 address, so a Docker peer reported either way matches one spec. */
function normalizeIp(ip: string): string {
  const lower = ip.trim().toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
  if (mapped?.[1]) {
    const n = ipv4ToInt(mapped[1]);
    if (n !== null) return v4text(n);
  }
  if (!lower.includes(":")) {
    const n = ipv4ToInt(lower);
    if (n !== null) return v4text(n);
  }
  return lower;
}

function ipv6Bytes(ip: string): Uint8Array | null {
  const s = ip.toLowerCase();
  if (s.includes(".")) return null;
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const expand = (part: string) => (part ? part.split(":") : []);
  const left = expand(halves[0] ?? "");
  const right = halves.length === 2 ? expand(halves[1] ?? "") : [];
  if (halves.length === 1 && left.length !== 8) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;
  const groups = halves.length === 2 ? [...left, ...Array(missing).fill("0"), ...right] : left;
  if (groups.length !== 8) return null;
  const out = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const group = groups[i] ?? "";
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    const n = Number.parseInt(group, 16);
    out[i * 2] = n >> 8;
    out[i * 2 + 1] = n & 0xff;
  }
  return out;
}

function v6prefix(ip: Uint8Array, network: Uint8Array, bits: number): boolean {
  let left = bits;
  for (let i = 0; i < 16 && left > 0; i++) {
    const take = Math.min(8, left);
    const mask = take === 8 ? 0xff : (0xff << (8 - take)) & 0xff;
    if ((ip[i]! & mask) !== (network[i]! & mask)) return false;
    left -= take;
  }
  return true;
}

function specMatches(ip: string, spec: string): boolean {
  const slash = spec.lastIndexOf("/");
  const base = slash < 0 ? spec : spec.slice(0, slash);
  const bits = slash < 0 ? null : Number(spec.slice(slash + 1));
  const ip4 = ipv4ToInt(normalizeIp(ip));
  const base4 = ipv4ToInt(normalizeIp(base));
  if (ip4 !== null && base4 !== null && !base.includes(":")) {
    const n = bits ?? 32;
    if (!Number.isInteger(n) || n < 1 || n > 32) return false;
    const mask = n === 32 ? 0xffffffff : (0xffffffff << (32 - n)) >>> 0;
    return (ip4 & mask) === (base4 & mask);
  }
  const ip6 = ipv6Bytes(normalizeIp(ip));
  const net6 = ipv6Bytes(base.toLowerCase());
  if (!ip6 || !net6) return false;
  const n = bits ?? 128;
  if (!Number.isInteger(n) || n < 1 || n > 128) return false;
  return v6prefix(ip6, net6, n);
}

/** `true` trusts loopback only. A list trusts loopback and those addresses or CIDRs. `false` trusts no proxy. */
export type TrustProxy = boolean | readonly string[];

export const trustsAProxy = (t: TrustProxy): boolean => t !== false;

/** Check a --trust-proxy list. A prefix of /0 is refused: that would trust every peer. */
export function parseTrustProxy(specs: readonly string[]): string[] {
  return specs.map((raw) => {
    const spec = raw.trim();
    const slash = spec.lastIndexOf("/");
    const baseRaw = slash < 0 ? spec : spec.slice(0, slash);
    const bitsRaw = slash < 0 ? null : spec.slice(slash + 1);
    const base = usableIp(baseRaw);
    if (!base) throw new Error(`--trust-proxy: "${spec}" is not an address or CIDR`);
    const asV4 = ipv4ToInt(normalizeIp(base));
    const mapped = base.toLowerCase().startsWith("::ffff:") && asV4 !== null;
    if (asV4 !== null && (!base.includes(":") || mapped)) {
      if (mapped && bitsRaw !== null) throw new Error(`--trust-proxy: write ${v4text(asV4)} as an IPv4 CIDR, not ${spec}`);
      const n = bitsRaw === null ? 32 : Number(bitsRaw);
      if (!/^\d+$/.test(bitsRaw ?? "32") || n < 1 || n > 32) throw new Error(`--trust-proxy: "${spec}" is not an IPv4 CIDR`);
      const text = v4text(asV4);
      return n === 32 ? text : `${text}/${n}`;
    }
    if (!ipv6Bytes(base)) throw new Error(`--trust-proxy: "${spec}" is not an address or CIDR`);
    const n = bitsRaw === null ? 128 : Number(bitsRaw);
    if ((bitsRaw !== null && !/^\d+$/.test(bitsRaw)) || n < 1 || n > 128) throw new Error(`--trust-proxy: "${spec}" is not an IPv6 CIDR`);
    const text = base.toLowerCase();
    return n === 128 ? text : `${text}/${n}`;
  });
}

/** Bare `--trust-proxy` and `KIWI_TRUST_PROXY=1` trust loopback. A value is an address or CIDR list. The flag wins over the env. */
export function trustProxyFromArgs(argv: readonly string[], envValue: string | undefined): TrustProxy {
  const specs: string[] = [];
  let flagged = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== "--trust-proxy") continue;
    flagged = true;
    const next = argv[i + 1];
    if (next && !next.startsWith("-")) {
      for (const part of next.split(",")) {
        const spec = part.trim();
        if (spec) specs.push(spec);
      }
      i++;
    }
  }
  if (flagged) return specs.length ? parseTrustProxy(specs) : true;
  const env = envValue?.trim();
  if (!env || env === "0") return false;
  if (env === "1") return true;
  return parseTrustProxy(
    env
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

function proxyPeer(peerIp: string, trust: TrustProxy): boolean {
  if (!trust) return false;
  const ip = normalizeIp(peerIp);
  if (ip === "127.0.0.1" || ip === "::1") return true;
  if (trust === true) return false;
  return trust.some((spec) => specMatches(ip, spec));
}

/**
 * Who a Bun request counts against (a mailbox write). The peer, unless that peer is a trusted
 * proxy: then only the very last X-Forwarded-For entry, which is the one the proxy
 * added. Everything before it was supplied by the client. If that last entry is not
 * an address, count the peer instead of scanning backward. Loopback is trusted when
 * trust is on. A list also trusts those addresses and CIDRs (Docker's bridge is not
 * loopback). Any other peer ignores the header.
 */
export function clientAddress(peer: string | null | undefined, forwardedFor: string | null | undefined, trustProxy: TrustProxy = false): string | null {
  const peerIp = peer ? usableIp(peer) : null;
  if (!peerIp || !proxyPeer(peerIp, trustProxy)) return peerIp;
  const parts = (forwardedFor ?? "").split(",");
  const last = usableIp(parts[parts.length - 1] ?? "");
  return last ?? peerIp;
}

export function untrustedProxy(peer: string | null | undefined, forwardedFor: string | null | undefined, trustProxy: TrustProxy = false): string | null {
  const peerIp = peer ? usableIp(peer) : null;
  if (!peerIp || !forwardedFor?.trim() || proxyPeer(peerIp, trustProxy)) return null;
  return normalizeIp(peerIp);
}

export function trustProxyHint(peer: string): string {
  const loopback = peer === "127.0.0.1" || peer === "::1";
  const flag = loopback ? "--trust-proxy" : `--trust-proxy ${peer}`;
  const env = loopback ? "KIWI_TRUST_PROXY=1" : `KIWI_TRUST_PROXY=${peer}`;
  return `relay: requests from ${peer} carry X-Forwarded-For, but ${peer} isn't a trusted proxy, so every client it passes on counts as ${peer} against the rate limits. If ${peer} is your reverse proxy, start the relay with ${flag} (or ${env}).`;
}

const PREFIX = "lead checkpoint/";

export function leadCheckpointKey(name: string): string {
  return `${PREFIX}${name}`;
}

export function leadCheckpointKeyRefusal(key: string, from: string, ttl: number | undefined): string | null {
  if (!key.startsWith(PREFIX)) return null;
  if (key !== leadCheckpointKey(from)) return `only ${key.slice(PREFIX.length) || "nobody"} writes ${key}`;
  return ttl === undefined ? null : "a lead checkpoint never expires";
}

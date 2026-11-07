import { UI_REQUIRES } from "./ui-contract.ts";

interface Look {
  seq: number;
  uiVersion: string;
  requiresContract: string;
}

const FLOOR = /^\s*(?:\^|~|>=|=)?\s*v?(\d+\.\d+\.\d+)/;

export function olderLook(look: Pick<Look, "uiVersion" | "requiresContract">, own: string = UI_REQUIRES): string | null {
  const floor = FLOOR.exec(look.requiresContract)?.[1];
  if (floor && Bun.semver.order(floor, own) >= 0) return null;
  return `UI ${look.uiVersion} is made for contract ${look.requiresContract}, older than this build's own UI (${own})`;
}

const isLook = (value: unknown): value is Look => {
  const look = value as Partial<Look> | null;
  return !!look && typeof look === "object" && Number.isSafeInteger(look.seq) && typeof look.uiVersion === "string" && typeof look.requiresContract === "string";
};

export function ownLookSeq(state: unknown, seq: number, own: string = UI_REQUIRES): number {
  if (!state || typeof state !== "object" || Array.isArray(state)) return seq;
  const { next, retry, current, good } = state as Record<string, unknown>;
  const looks = [next, retry, current, ...(Array.isArray(good) ? good : [])];
  return looks.reduce<number>((top, look) => (isLook(look) && olderLook(look, own) ? Math.max(top, look.seq) : top), seq);
}

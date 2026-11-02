import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { encodeJoinCode, newRoomId } from "@kiwi/core/crypto.ts";
import { localOps, makeLocalPerson, NO_BROWSER_KEYS } from "./channel-local.ts";
import { CHANNELS_KEY, CHECKS_PREFIX, MEMBER_PREFIX, PENDING_PREFIX, RECORD_PREFIX, readLocal, sweepBrowserKeys } from "./local-store.ts";
import { devBuild, relayUrl } from "./relay.ts";

class FakeStorage {
  readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
}

const page = (search: string): { location: { search: string; origin: string } } => ({ location: { search, origin: "https://page.example" } });

let storage: FakeStorage;
let hadWindow: { value: unknown } | undefined;
beforeAll(() => {
  storage = new FakeStorage();
  (globalThis as { localStorage?: Storage }).localStorage = storage as unknown as Storage;
  hadWindow = { value: (globalThis as { window?: unknown }).window };
});
afterAll(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
  if (hadWindow) (globalThis as { window?: unknown }).window = hadWindow.value;
  else delete (globalThis as { window?: unknown }).window;
  delete process.env.DEV;
});

describe("the plain-browser key store", () => {
  test("a production build refuses to make or hold keys", async () => {
    delete process.env.DEV;
    expect(devBuild()).toBe(false);
    await expect(makeLocalPerson("eve")).rejects.toThrow(NO_BROWSER_KEYS);
    expect(() => localOps()).toThrow(NO_BROWSER_KEYS);
    expect(storage.map.size).toBe(0);
  });

  test("a development build makes the person, and a sweep takes back what that mode left", async () => {
    process.env.DEV = "true";
    expect(devBuild()).toBe(true);
    const p = await makeLocalPerson("devperson");
    expect(readLocal().person?.pk).toBe(p.pk);
    expect(() => localOps()).not.toThrow();
    storage.setItem(`${CHECKS_PREFIX}room`, "[]");
    storage.setItem(`${RECORD_PREFIX}room.pk`, "{}");
    storage.setItem(`${MEMBER_PREFIX}mc2-old`, "{}");
    storage.setItem(`${PENDING_PREFIX}mc2-old`, "{}");
    storage.setItem(CHANNELS_KEY, "[]");
    storage.setItem("unrelated", "keep");
    delete process.env.DEV;
    sweepBrowserKeys();
    expect(readLocal().person).toBeNull();
    expect(storage.getItem(`${CHECKS_PREFIX}room`)).toBeNull();
    expect(storage.getItem(`${RECORD_PREFIX}room.pk`)).toBeNull();
    expect(storage.getItem(`${MEMBER_PREFIX}mc2-old`)).toBeNull();
    expect(storage.getItem(`${PENDING_PREFIX}mc2-old`)).toBeNull();
    expect(storage.getItem(CHANNELS_KEY)).toBeNull();
    expect(storage.getItem("unrelated")).toBe("keep");
  });

  test("a production load sweeps the legacy seats, and their migration writes nothing back", async () => {
    delete process.env.DEV;
    (globalThis as { window?: unknown }).window = page("");
    const code = encodeJoinCode({ roomId: newRoomId(), ownerFp: "A".repeat(16) });
    const key = `${PENDING_PREFIX}${code}`;
    const legacy = JSON.stringify({ code, identity: { name: "probe", pk: "pk", sk: "SECRET", xsk: "EXCHANGE" }, requestId: "r" });
    storage.map.clear();
    storage.setItem(key, legacy);
    const { prepareBrowserStore } = await import("./secrets.ts");
    prepareBrowserStore();
    expect(storage.getItem(key)).toBeNull();
    storage.setItem(key, legacy);
    const { migrateChannelsToStore } = await import("../../../packages/channel/src/store.ts");
    expect(await migrateChannelsToStore()).toBe(0);
    expect(storage.getItem(key)).toBeNull();
    expect([...storage.map.keys()]).toEqual([]);
    const { migrateChannels } = await import("./secrets.ts");
    expect(await migrateChannels([{ label: "probe", pk: "pk", sk: "SECRET", code, requestId: "r" }])).toBe(0);
    expect([...storage.map.keys()]).toEqual([]);
    process.env.DEV = "true";
    expect(await migrateChannels([{ label: "probe", pk: "pk", sk: "SECRET", code, requestId: "r" }])).toBe(1);
    expect(readLocal().channels[0]?.sk).toBe("SECRET");
  });
});

describe("the relay a plain browser talks to", () => {
  test("a production page's ?relay= steers nothing; a development build may point at one", () => {
    (globalThis as { window?: unknown }).window = page("?relay=https://attacker.example");
    delete process.env.DEV;
    expect(relayUrl()).toBe("https://page.example");
    process.env.DEV = "true";
    expect(relayUrl()).toBe("https://attacker.example");
    (globalThis as { window?: unknown }).window = page("?relay=not-a-url");
    expect(relayUrl()).toBe("https://page.example");
    delete process.env.DEV;
  });

  test("the desktop shell's bridge says where the relay is, whatever the page says", () => {
    (globalThis as { window?: unknown }).window = { ...page("?relay=https://attacker.example"), kiwi: { relayUrl: "https://bridge.example" } };
    process.env.DEV = "true";
    expect(relayUrl()).toBe("https://bridge.example");
    delete process.env.DEV;
  });
});

import { newChannelKey, open, openFrom, seal, sealTo } from "@mc/crypto.ts";
import { generateIdentity, signText, verifyText, withExchangeKey } from "@mc/identity.ts";
import { fold } from "@mc/state.ts";
import * as client from "@mc/client.ts";

describe("shared code from src/", () => {
  it("seals and opens a message", async () => {
    const key = newChannelKey();
    const sealed = await seal(key, "room", { hello: "kiwi" });
    expect(await open(key, "room", sealed.iv, sealed.ct)).toEqual({ hello: "kiwi" });
  });

  it("seals a long message so it is packed", async () => {
    const key = newChannelKey();
    const body = "kiwi ".repeat(1000);
    const sealed = await seal(key, "room", { body });
    expect(await open(key, "room", sealed.iv, sealed.ct)).toEqual({ body });
  });

  it("signs and verifies, and boxes to an exchange key", async () => {
    const id = await withExchangeKey(await generateIdentity("me"));
    expect(await verifyText(id.pk, await signText(id, "text"), "text")).toBe(true);
    const box = await sealTo(id.xpk ?? "", "secret");
    expect(await openFrom(id.xsk ?? "", box)).toBe("secret");
  });

  it("folds an empty log", () => {
    expect(fold([], []).tasks.size).toBe(0);
  });

  it("loads the client module", () => {
    expect(typeof client.fx).toBe("object");
  });
});

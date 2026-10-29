import { expect, test } from "bun:test";
import { b64url } from "@kiwi/core/crypto.ts";
import { sessionExpiry, tokenExpiry, workosDeviceSignIn, type WorkosFetch } from "@kiwi/core/workos.ts";

const jwt = (claims: object): string => [{ alg: "RS256", kid: "k" }, claims].map((p) => b64url(new TextEncoder().encode(JSON.stringify(p)))).join(".") + ".sig";

test("a WorkOS session ends when its access token does, not an hour later", async () => {
  const exp = Math.floor(Date.now() / 1000) + 300;
  const access = jwt({ sub: "user_1", exp });
  const fetchImpl: WorkosFetch = async (url) =>
    url.endsWith("/device")
      ? Response.json({ device_code: "d", user_code: "ABCD", verification_uri: "https://auth.example.com/device", interval: 0 })
      : Response.json({ access_token: access, refresh_token: "r" });
  const session = await workosDeviceSignIn("client", async () => {}, { fetchImpl });
  expect(session.exp).toBe(exp * 1000);
});

test("a token that isn't a JWT keeps the lifetime it was given, or a short one", () => {
  expect(tokenExpiry("dev:alice")).toBeNull();
  expect(tokenExpiry(jwt({ sub: "user_1" }))).toBeNull();
  expect(sessionExpiry("dev:alice", 60, 1_000)).toBe(61_000);
  expect(sessionExpiry("dev:alice", undefined, 1_000)).toBe(301_000);
});

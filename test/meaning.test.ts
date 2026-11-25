import { describe, expect, test } from "bun:test";

import { devHumanAuth } from "../src/relay/human.ts";
import { meaningAsk, meaningRequest, meaningScores, onMeaningHttp, scoreMeaning } from "../src/relay/meaning.ts";

const item = (id: number, text = "release goes out friday") => ({ id, from: "ana", where: "# general", text });

describe("a meaning search sends Jev only what it needs, and reads its answers back", () => {
  test("an ask names a query and messages, each with an id, who, where and text", () => {
    expect(meaningAsk({ query: " when do we ship ", items: [item(4)] })).toEqual({ query: "when do we ship", items: [item(4)] });
    expect(meaningAsk({ query: "", items: [item(4)] })).toBeNull();
    expect(meaningAsk({ query: "x".repeat(201), items: [] })).toBeNull();
    expect(meaningAsk({ query: "ship", items: [item(1), item(1)] })).toBeNull();
    expect(meaningAsk({ query: "ship", items: [{ ...item(1), text: "x".repeat(601) }] })).toBeNull();
    expect(meaningAsk({ query: "ship", items: Array.from({ length: 161 }, (_, i) => item(i)) })).toBeNull();
  });

  test("extra fields on a message never reach Jev", () => {
    const ask = meaningAsk({ query: "ship", items: [{ ...item(4), secret: "key" }] })!;
    expect(JSON.stringify(meaningRequest(ask.query, ask.items))).not.toContain("secret");
  });

  test("each message gets its own yes-or-no question about the same query", () => {
    const req = meaningRequest("when do we ship", [item(4), item(9, "lunch?")]) as { state: { query: string; messages: unknown[] }; questions: Record<string, { type: string; instructions: string }> };
    expect(req.state).toEqual({
      query: "when do we ship",
      messages: [
        { from: "ana", where: "# general", text: "release goes out friday" },
        { from: "ana", where: "# general", text: "lunch?" },
      ],
    });
    expect(Object.keys(req.questions)).toEqual(["m0", "m1"]);
    expect(req.questions.m1!.type).toBe("noul");
    expect(req.questions.m1!.instructions).toContain("`messages[1]`");
  });

  test("answers map back to message ids, and a missing answer drops that message", () => {
    expect(meaningScores([item(4), item(9)], { answers: { m0: { type: "noul", noul: 0.93 }, m1: { type: "noul" } } })).toEqual([{ id: 4, p: 0.93 }]);
    expect(meaningScores([item(4)], null)).toEqual([]);
  });
});

const post = (body: unknown, token: string | null = "dev:ana") =>
  new Request("http://relay/v1/meaning", { method: "POST", headers: token ? { "x-human-token": token } : {}, body: typeof body === "string" ? body : JSON.stringify(body) });
const yes = async (body: object) => ({ answers: Object.fromEntries(Object.keys((body as { questions: object }).questions).map((k, i) => [k, { type: "noul", noul: i === 0 ? 0.9 : 0.1 }])) });

describe("the relay asks Jev with its own key, for signed-in people only", () => {
  const human = devHumanAuth();
  const routes = { key: "k", allow: async () => true, ask: yes };

  test("off without a key: GET and POST both answer 404", async () => {
    expect((await onMeaningHttp(new Request("http://relay/v1/meaning"), human, { ...routes, key: undefined }))!.status).toBe(404);
    expect((await onMeaningHttp(post({ query: "ship", items: [item(1)] }), human, { ...routes, key: undefined }))!.status).toBe(404);
  });

  test("with a key, GET says it is on, and other paths are not this route", async () => {
    expect(await (await onMeaningHttp(new Request("http://relay/v1/meaning"), human, routes))!.json()).toEqual({ on: true });
    expect(await onMeaningHttp(new Request("http://relay/v1/me/usage"), human, routes)).toBeNull();
  });

  test("a search needs sign-in, a fair rate and a well-formed ask", async () => {
    expect((await onMeaningHttp(post({ query: "ship", items: [item(1)] }, null), human, routes))!.status).toBe(401);
    expect((await onMeaningHttp(post({ query: "ship", items: [item(1)] }), human, { ...routes, allow: async () => false }))!.status).toBe(429);
    expect((await onMeaningHttp(post("not json"), human, routes))!.status).toBe(400);
    expect((await onMeaningHttp(post({ query: "", items: [] }), human, routes))!.status).toBe(400);
  });

  test("the key goes to Jev, never back, and hits come best first", async () => {
    const seen: string[] = [];
    const res = await onMeaningHttp(post({ query: "ship", items: Array.from({ length: 10 }, (_, i) => item(i)) }), human, {
      ...routes,
      ask: async (body, key) => {
        seen.push(key);
        return yes(body);
      },
    });
    const text = await res!.text();
    expect(res!.status).toBe(200);
    expect(seen).toEqual(["k", "k"]);
    expect(text).not.toContain('"k"');
    expect((JSON.parse(text) as { hits: { id: number; p: number }[] }).hits.slice(0, 2)).toEqual([
      { id: 0, p: 0.9 },
      { id: 8, p: 0.9 },
    ]);
  });

  test("when Jev answers no group at all, the search fails rather than finding nothing", async () => {
    expect(await scoreMeaning({ query: "ship", items: [item(1)] }, "k", async () => null)).toBeNull();
    expect((await onMeaningHttp(post({ query: "ship", items: [item(1)] }), human, { ...routes, ask: async () => null }))!.status).toBe(502);
  });
});

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRelay } from "../src/relay/bun.ts";
import { Redactor } from "../src/secrets.ts";
import { memoryBudget } from "./check.ts";
import { kiwiCmd, setupChannel, type OwnerSetup } from "./owner.ts";

setDefaultTimeout(60_000);

const STRIPE = "sk_test_51HxQ2bLkdIu7Gf9aZ0pQ";

describe("the redactor", () => {
  const secrets = [
    { name: "STRIPE_KEY", value: STRIPE },
    { name: "DB_PASSWORD", value: "Wd8p2Lq7xNe3" },
  ];
  const through = (chunks: string[]) => {
    const r = new Redactor(secrets);
    return Buffer.concat([...chunks.map((c) => r.push(Buffer.from(c))), r.end()]).toString();
  };

  test("a value is replaced wherever the output splits it", () => {
    const text = `charged with ${STRIPE}, then db Wd8p2Lq7xNe3 ok\n`;
    for (let cut = 0; cut <= text.length; cut++) expect(through([text.slice(0, cut), text.slice(cut)])).toBe("charged with [secret STRIPE_KEY], then db [secret DB_PASSWORD] ok\n");
    expect(through([...text])).toBe("charged with [secret STRIPE_KEY], then db [secret DB_PASSWORD] ok\n");
  });

  test("encoded values are replaced too", () => {
    expect(through([`basic ${btoa(`api:${STRIPE}`)}\n`])).not.toContain(btoa(`api:${STRIPE}`).slice(6, 30));
    expect(through([Buffer.from(STRIPE).toString("hex")])).toBe("[secret STRIPE_KEY]");
  });

  test("ordinary output passes at once; only what could start a value waits", () => {
    const r = new Redactor(secrets);
    expect(r.push(Buffer.from("building...\n")).toString()).toBe("building...\n");
    expect(r.push(Buffer.from("key sk_test_5")).toString()).toBe("key ");
    expect(r.end().toString()).toBe("sk_test_5");
  });
});

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-secret-run-"));
const made: string[] = [dataDir];
let server: ReturnType<typeof startRelay>;
let s: OwnerSetup;
let home: string;
let billingPk: string;

const spawn = (args: string[]) =>
  Bun.spawn(kiwiCmd(args), { cwd: home, env: { ...process.env, KIWI_HOME: home, KIWI_RELAY: s.relay, KIWI_NO_HOOKS: "1" }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });

async function kiwi(...args: string[]): Promise<{ code: number; out: string; err: string }> {
  const p = spawn(args);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out, err };
}

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  s = await setupChannel(server.url.origin);
  home = mkdtempSync(join(tmpdir(), "kiwi-secret-run-billing-"));
  made.push(home);
  const joining = spawn(["join", s.code, "--as", "billing"]);
  const budget = memoryBudget();
  for (let i = 0; i < 400; i++) {
    const ready = (await s.ownerCh.requests({ budget })).find((r) => r.name === "billing" && r.check === "ready");
    if (ready) {
      billingPk = (await s.ownerCh.approve(ready)).pk;
      break;
    }
    await Bun.sleep(50);
  }
  expect(await joining.exited).toBe(0);
});

afterAll(() => {
  server.stop(true);
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

describe("kiwi secret", () => {
  test("with none given, it says so, and run refuses to start anything", async () => {
    expect((await kiwi("secret")).out).toContain("the owner hasn't given you any secrets");
    const r = await kiwi("secret", "run", "echo started");
    expect(r.code).toBe(2);
    expect(r.out).not.toContain("started");
  });

  test("lists names and notes, never values, and says how to use them", async () => {
    await s.ownerCh.setSecret({ name: "STRIPE_KEY", value: STRIPE, note: "test mode", grants: [billingPk] });
    const r = await kiwi("secret");
    expect(r.code).toBe(0);
    expect(r.out).toContain("STRIPE_KEY  test mode");
    expect(r.out).toContain("kiwi secret run 'CMD'");
    expect(r.out + r.err).not.toContain(STRIPE);
    expect(JSON.parse((await kiwi("secret", "--json")).out)).toEqual([{ name: "STRIPE_KEY", note: "test mode", at: expect.any(Number) }]);
    expect((await kiwi("status")).out).toContain("Secrets for you: STRIPE_KEY");
  });

  test("run puts the value in the command's environment and keeps it out of what comes back", async () => {
    const r = await kiwi("secret", "run", 'echo "key=$STRIPE_KEY"; printf %s "$STRIPE_KEY" | base64; echo "len ${#STRIPE_KEY}" >&2; echo "$STRIPE_KEY" >&2');
    expect(r.code).toBe(0);
    expect(r.out).toContain("key=[secret STRIPE_KEY]");
    expect(r.out).toContain("[secret STRIPE_KEY]\n");
    expect(r.err).toContain(`len ${STRIPE.length}`);
    expect(r.err).toContain("[secret STRIPE_KEY]");
    expect(r.out + r.err).not.toContain(STRIPE);
    expect(r.out + r.err).not.toContain(btoa(STRIPE).slice(0, 20));
    expect((await kiwi("secret", "run", "--", "printenv", "STRIPE_KEY")).out).toBe("[secret STRIPE_KEY]\n");
    expect((await kiwi("secret", "run", "exit 3")).code).toBe(3);
    expect((await kiwi("secret", "run", "--", "no-such-command-here")).code).toBe(127);
  });

  test("there is no way to print a value", async () => {
    for (const sub of ["get", "show", "print"]) {
      const r = await kiwi("secret", sub, "STRIPE_KEY");
      expect(r.code).toBe(2);
      expect(r.err).toContain("kiwi never prints a secret's value");
      expect(r.out + r.err).not.toContain(STRIPE);
    }
  });

  test("this computer keeps only the owner's sealed copies, and every kiwi command refuses to send a value", async () => {
    const file = join(home, "secrets", s.roomId, "billing.json");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, "utf8")).not.toContain(STRIPE);
    const r = await kiwi("send", `here it is: ${STRIPE}`);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("holds the value of the secret STRIPE_KEY");
    expect((await kiwi("send", "STRIPE_KEY works")).code).toBe(0);
  });

  test("taken back, it's gone from the list and from run, but still can't be sent", async () => {
    const [secret] = await s.ownerCh.secrets();
    await s.ownerCh.setSecret({ id: secret!.id, name: "STRIPE_KEY", grants: [] });
    expect((await kiwi("secret")).out).toContain("the owner hasn't given you any secrets");
    expect((await kiwi("secret", "run", "echo $STRIPE_KEY")).code).toBe(2);
    expect((await kiwi("send", `still mine: ${STRIPE}`)).err).toContain("STRIPE_KEY");
  });

  test("leaving forgets the copies", async () => {
    expect(existsSync(join(home, "secrets", s.roomId, "billing.json"))).toBe(true);
    expect((await kiwi("leave", "--yes")).code).toBe(0);
    expect(existsSync(join(home, "secrets", s.roomId))).toBe(false);
  });
});

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { claimComputer } from "@kiwi/core/person.ts";
import { startRelay } from "../src/relay/bun.ts";
import { pairComputer, setupChannel, type OwnerSetup, type PairedComputer } from "./owner.ts";

setDefaultTimeout(30_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-forgotten-"));
let server: ReturnType<typeof startRelay>;
let relay: string;

beforeAll(() => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  relay = server.url.origin;
});

afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

async function askFrom(s: OwnerSetup, name: string, computer: PairedComputer) {
  const id = await generateIdentity(name);
  const { requestId } = await Channel.requestJoin(relay, s.code, id, { name }, { computer: await claimComputer(computer.machine, computer.cert, s.roomId, id.pk) });
  await s.ownerCh.requests({ person: s.person.pk });
  await Channel.joinStatus(relay, s.code, id, requestId);
  return requestId;
}

describe("a computer you forgot is no longer yours to auto-approve (T503)", () => {
  test("its next agent waits for a person, marked as forgotten; a computer you still have joins on its own", async () => {
    const s = await setupChannel(relay);
    const kept = await pairComputer(s.person, "mac-mini");
    const gone = await pairComputer(s.person, "old-laptop");
    const mine = [kept.machine.pk];
    const keptReq = await askFrom(s, "helper", kept);
    const goneReq = await askFrom(s, "stray", gone);

    const requests = await s.ownerCh.requests({ person: s.person.pk, mine });
    expect(requests.find((r) => r.id === keptReq)?.computer).toMatchObject({ own: true, joinsOnItsOwn: true });
    const stray = requests.find((r) => r.id === goneReq)?.computer;
    expect(stray).toMatchObject({ pk: gone.machine.pk, own: false, joinsOnItsOwn: false, forgotten: true });

    const approved = await s.ownerCh.autoApprove(s.person.pk, [], mine);
    expect(approved.map((m) => m.name)).toEqual(["helper"]);
    expect((await s.ownerCh.requests({ person: s.person.pk, mine })).map((r) => r.id)).toEqual([goneReq]);
    await s.ownerCh.close();
  });

  test("an app that doesn't know your computers keeps letting your certified ones in, as before", async () => {
    const s = await setupChannel(relay);
    const box = await pairComputer(s.person, "vps-1");
    await askFrom(s, "worker", box);
    expect((await s.ownerCh.autoApprove(s.person.pk, [], null)).map((m) => m.name)).toEqual(["worker"]);
    await s.ownerCh.close();
  });
});

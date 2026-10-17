import { Database } from "bun:sqlite";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity, type Identity } from "@kiwi/core/identity.ts";

export interface PagedRoom {
  roomId: string;
  owner: Identity;
  agent: Identity;
  ownerCh: Channel;
  fresh: (as?: Identity) => Channel;
}

export async function roomWith(relay: string, dataDir: string, count: number): Promise<PagedRoom> {
  const owner = await generateIdentity("boss");
  const agent = await generateIdentity("helper");
  const { access } = await Channel.create(relay, owner, { name: "boss" }, [{ ...agent, info: { name: "helper" } }]);
  const ownerCh = new Channel(access, relay, owner);
  await ownerCh.send("hello");
  fill(dataDir, access.roomId, count);
  return { roomId: access.roomId, owner, agent, ownerCh, fresh: (as = owner) => new Channel(access, relay, as) };
}

export function fill(dataDir: string, roomId: string, count: number): void {
  const file = new Database(join(dataDir, `${roomId}.sqlite`));
  try {
    const first = file.query("SELECT ts, iv, ct, e FROM msgs WHERE seq = 1").get() as { ts: number; iv: string; ct: string; e: number };
    file.transaction(() => {
      for (let seq = 2; seq <= count; seq++) file.query("INSERT INTO msgs (seq, ts, iv, ct, e) VALUES (?, ?, ?, ?, ?)").run(seq, first.ts + seq, first.iv, first.ct, first.e);
    })();
  } finally {
    file.close();
  }
}

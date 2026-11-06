import { wakeKey, type WakeSeat } from "@kiwi/core/wake.ts";
import { identitiesIn, updateConfig, type Config } from "./config.ts";
import { placesIn, type Placed } from "./seats.ts";

export function wakeSeats(cfg: Config): (WakeSeat & Partial<Placed>)[] {
  const off = new Set(cfg.wakeOff ?? []);
  const seen = new Set<string>();
  return Object.entries(cfg.channels).flatMap(([alias, c]) => {
    const places = placesIn(cfg, alias);
    return identitiesIn(c.roomId)
      .filter((agent) => agent !== c.owner && agent !== c.person && !seen.has(`${c.roomId}/${agent}`))
      .map((agent) => {
        seen.add(`${c.roomId}/${agent}`);
        return { room: c.roomId, alias, agent, wake: off.has(wakeKey(alias, agent)) ? "off" : "on", ...places.get(agent) };
      });
  });
}

export function setWake(room: string, agent: string, turn: "on" | "off"): boolean {
  let found = false;
  updateConfig((cfg) => {
    const keys = Object.entries(cfg.channels)
      .filter(([, c]) => c.roomId === room && agent !== c.owner && agent !== c.person && identitiesIn(room).includes(agent))
      .map(([alias]) => wakeKey(alias, agent));
    found = keys.length > 0;
    const off = new Set(cfg.wakeOff ?? []);
    for (const key of keys) {
      if (turn === "off") off.add(key);
      else off.delete(key);
    }
    if (off.size) cfg.wakeOff = [...off];
    else delete cfg.wakeOff;
  });
  return found;
}

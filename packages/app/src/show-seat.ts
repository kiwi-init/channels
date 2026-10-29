import { useEffect, useState } from "react";

import { PLACE_NAMES, type PlaceKind, type PlacedSeat, type ShowResult } from "@kiwi/core/terminals.ts";
import { bridge } from "@kiwi/secrets/secrets.ts";

export type { PlacedSeat, ShowResult };

export function useSeatPlaces(): PlacedSeat[] {
  const [seats, setSeats] = useState<PlacedSeat[]>([]);
  useEffect(() => {
    const b = bridge();
    if (!b?.seatPlaces) return;
    let live = true;
    const load = () => {
      void b.seatPlaces().then(
        (list) => {
          if (live) setSeats(list);
        },
        () => {},
      );
    };
    load();
    const every = setInterval(load, 15_000);
    const wake = () => load();
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      live = false;
      clearInterval(every);
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, []);
  return seats;
}

export function showSeat(seat: PlacedSeat): Promise<ShowResult> {
  const b = bridge();
  return b?.showSeat ? b.showSeat(seat) : Promise.resolve({ ok: false, why: "failed" });
}

export function showLabel(place: PlaceKind): string {
  return `Show in ${PLACE_NAMES[place]}`;
}

export function noteFor(place: PlacedSeat["place"], result: ShowResult): Promise<string | null> {
  if (result.ok) return Promise.resolve(null);
  return import("./show-notes").then(
    (m) => m.showNote(place, result),
    () => "Couldn't show that seat: reload to try again.",
  );
}

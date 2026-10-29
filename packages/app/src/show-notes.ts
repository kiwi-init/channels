import type { PlacedSeat, ShowRefusal, ShowResult } from "@kiwi/core/terminals.ts";

function rexNote(why: ShowRefusal): string {
  switch (why) {
    case "remote-control":
      return "Turn on Remote Control in Rex's settings to open it.";
    case "no-server":
      return "Rex isn't running on this computer.";
    case "no-app":
      return "Open the Rex app to show it there.";
    case "no-rex":
      return "Rex isn't installed on this computer.";
    case "failed":
      return "Rex didn't open that seat.";
  }
}

const NOTES: Record<PlacedSeat["place"], (why: ShowRefusal) => string> = { rex: rexNote, hosted: () => "Its terminal didn't open." };

export function showNote(place: PlacedSeat["place"], result: ShowResult): string | null {
  return result.ok ? null : NOTES[place](result.why);
}

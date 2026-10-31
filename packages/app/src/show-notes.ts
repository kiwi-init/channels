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

function tmuxNote(why: ShowRefusal): string {
  switch (why) {
    case "no-server":
      return "That seat's tmux server isn't running anymore.";
    case "no-app":
      return "No tmux client is attached: the pane is selected for when you attach.";
    case "no-rex":
    case "remote-control":
    case "failed":
      return "tmux didn't show that seat.";
  }
}

function hostedNote(why: ShowRefusal): string {
  switch (why) {
    case "no-server":
      return "It isn't running in Channels' tmux anymore.";
    case "no-app":
      return "No terminal app opened it: copy the command and run it in yours.";
    case "no-rex":
    case "remote-control":
    case "failed":
      return "Your terminal didn't open: copy the command and run it in yours.";
  }
}

const NOTES: Record<PlacedSeat["place"], (why: ShowRefusal) => string> = { rex: rexNote, tmux: tmuxNote, hosted: hostedNote };

export function showNote(place: PlacedSeat["place"], result: ShowResult): string | null {
  return result.ok ? null : NOTES[place](result.why);
}

import type { LaunchRefusal, Opened, PlacedSeat, RexPlace, ShowResult, TerminalId } from "@kiwi/core/terminals.ts";
import type { Config, SeatRecord } from "../config.ts";

export interface TerminalPlace {
  program: string;
  version?: string;
}

export type { RexPlace, ShowResult, TerminalId };

export interface TmuxPlace {
  socket: string;
  pane: string;
}

export interface SeatPlace {
  term?: TerminalPlace;
  rex?: RexPlace;
  tmux?: TmuxPlace;
}

export interface StatusRecord {
  id: string;
  state: "blocked" | "done";
  kind?: "question";
  msg: string;
  count?: number;
  task?: number;
}

export interface RexActivity {
  state: "working" | "waiting" | "idle";
  tool?: string;
}

export type Capability = "locate" | "mark" | "show" | "watch" | "type";

export interface TerminalManifest {
  id: TerminalId;
  name: string;
  platforms: readonly NodeJS.Platform[];
  helpers: { version: number; files: readonly string[] } | null;
  can: readonly Capability[];
}

interface Detected {
  found: boolean;
  running: boolean;
  version?: string;
}

export interface Pane {
  screen(): string | null;
  type(text: string): boolean;
  enter(): boolean;
  erase(count: number): boolean;
}

interface Helpers {
  status(): "on" | "off";
  download(): Promise<void>;
  remove(): Promise<void>;
}

export interface PlaceRequest {
  argv: string[];
  folder: string;
  name: string;
  env?: Record<string, string>;
}

export type Placed = Opened | { ok: false; why: Exclude<LaunchRefusal, "not-installed" | "no-recipe">; detail: string };

export interface PlaceTools {
  platform: NodeJS.Platform;
  shell: string;
  rex: string | null;
  tmux?: string | null;
}

export interface TerminalPlugin {
  readonly manifest: TerminalManifest;
  detect(opts?: { version?: boolean }): Promise<Detected>;
  helpers?: Helpers;
  locate?(env: Record<string, string | undefined>): SeatPlace;
  mark?(seat: SeatRecord, changed: readonly StatusRecord[], cleared: readonly string[], all: readonly StatusRecord[]): Promise<boolean>;
  seats?(cfg: Config): PlacedSeat[];
  show?(place: SeatPlace): Promise<ShowResult>;
  watch?(places: () => SeatPlace[], changed: (match: (place: SeatPlace) => boolean, gone: boolean) => void): { stop(): void };
  activity?(place: SeatPlace): Promise<RexActivity | null>;
  type?(place: SeatPlace): Pane | null;
}

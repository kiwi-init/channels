import type { RexPlace } from "../rex.ts";

export type TerminalId = "app" | "tmux" | "rex";

type Capability = "open" | "locate" | "mark" | "show" | "watch" | "type";

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
}

export interface PlaceRequest {
  argv: string[];
  folder: string;
  name: string;
  env?: Record<string, string>;
}

export type Placed =
  | { ok: true; place: "rex"; rex: RexPlace; window: string; pid?: number }
  | { ok: true; place: "tmux"; socket: string; session: string; window: string; pane: string; pid?: number }
  | { ok: true; place: "terminal"; window?: number }
  | { ok: false; why: "bad-request" | "no-place" | "not-allowed" | "failed"; detail: string };

export interface PlaceTools {
  platform: NodeJS.Platform;
  shell: string;
  rex: string | null;
  tmux: string | null;
  socket?: string;
  osascript: string | null;
}

export interface TerminalPlugin {
  readonly manifest: TerminalManifest;
  detect(): Promise<Detected>;
  open?(req: PlaceRequest): Promise<Placed>;
}

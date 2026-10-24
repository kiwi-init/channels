import type { DroppedFile, PastedImage } from "./bridge.ts";
import type { Push, Pushes } from "./calls.ts";
import type { ExternalUrl } from "./guard.ts";
import type { HostToKeys } from "./keys-server.ts";

export type AppPath = "data" | "exe" | "logs" | "resources";

interface AppFacts {
  packaged(): boolean;
  version(): string;
  path(name: AppPath): string;
  ready(): boolean;
  relaunch(execPath: string): void;
  onQuit(fn: () => void): void;
}

export interface Host {
  readonly app: AppFacts;
  push<P extends Push>(name: P, value: Pushes[P]): void;
  openExternal(url: ExternalUrl): Promise<void>;
  pickFolder(): Promise<string | null>;
  droppedFiles(): Promise<DroppedFile[]>;
  pastedImage(): Promise<PastedImage | null>;
  notify(title: string, body: string): void;
  badge(count: number): void;
  showWindow(): void;
  reload(): void;
  restartToUpdate(): void;
  tellKeys(m: HostToKeys): void;
}

let current: Host | null = null;

export function useHost(shell: Host): void {
  current = shell;
}

export function host(): Host {
  if (!current) throw new Error("the app's shell hasn't started");
  return current;
}

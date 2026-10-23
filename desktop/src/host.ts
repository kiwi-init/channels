import type { Push, Pushes } from "./calls.ts";
import type { HostToKeys } from "./keys-server.ts";

export interface Host {
  push<P extends Push>(name: P, value: Pushes[P]): void;
  openExternal(url: string): Promise<void>;
  pickFolder(): Promise<string | null>;
  notify(title: string, body: string): void;
  reload(): void;
  restartToUpdate(): void;
  tellKeys(m: HostToKeys): void;
}

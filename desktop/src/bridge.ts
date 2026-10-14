// window.kiwi: the main-process bridge the renderer (web/dist) talks to. Shared by
// main.ts and preload.ts; renderer-neutral on purpose (no electron/node imports),
// so web/ can type against it without touching this process.

/** The person's own key. Same JSON shape as Identity in src/identity.ts. */
export interface PersonView {
  name: string;
  pk: string;
  sk: string;
  xpk: string;
  xsk: string;
}

/** One channel identity of the person's (owner keys included). */
export interface ChannelIdentityView {
  /** What the person calls it (channel name). */
  label: string;
  pk: string;
  sk: string;
  xpk?: string;
  xsk?: string;
  roomId?: string;
  /** The renderer's record for this channel: its join code, channel access (keys), when, and (while waiting) the join request. Opaque here. */
  code?: string;
  /** The member key's name in the channel (label is what the person calls the channel). */
  idName?: string;
  /** The channel's sealed name, once known. */
  name?: string;
  access?: unknown;
  at?: number;
  requestId?: string;
}

/** A computer paired with this app (or adopted: this machine). */
export interface ComputerView {
  label: string;
  os: string;
  machinePk: string;
  machineXpk: string;
  /** The person key that certified it. */
  personPk: string;
  at: number;
  /** This machine (adopted daemon), rather than a remotely paired one. */
  own?: boolean;
}

/** A join request waiting on the person; the renderer round-trips these. */
export interface PendingItem {
  id: string;
  at: number;
  title: string;
  body: unknown;
}

/** Everything the renderer needs at load: one synchronous snapshot (see main). */
export interface StoreSnapshot {
  relayUrl: string;
  person: PersonView | null;
  channels: ChannelIdentityView[];
  computers: ComputerView[];
  pending: PendingItem[];
}

/** A computer asking to pair, for the person to confirm. */
export interface PairAskView {
  label: string;
  os: string;
  machinePk: string;
  at: number;
}

/** "kiwi daemon" as the app sees it. */
export interface DaemonStatus {
  running: boolean;
  version?: string;
  machinePk?: string;
  pairedPerson?: { pk: string; name: string } | null;
}

export type SignInResult = { token: string } | { dev: true };

export interface KiwiBridge {
  /** The relay URL injected at load (query param, else the default). */
  readonly relayUrl: string;
  /** Synchronous snapshot; main decrypts once at startup (safeStorage). */
  getSnapshot(): StoreSnapshot;
  onStore(cb: (s: StoreSnapshot) => void): () => void;
  setRelayUrl(url: string): Promise<string>;
  createPerson(name: string): Promise<PersonView>;
  saveChannels(channels: ChannelIdentityView[]): Promise<void>;
  saveComputers(computers: ComputerView[]): Promise<void>;
  setPending(pending: PendingItem[]): Promise<void>;
  /** WorkOS device authorization (system browser, polled in main), or { dev } for a dev relay. */
  signIn(): Promise<SignInResult>;
  /** A dev relay's sign-in: whoever they say (never a real WorkOS id). */
  devSignIn(name: string): Promise<{ token: string }>;
  getToken(): Promise<string | null>;
  signOut(): Promise<void>;
  /** Pairing: show the code, poll slot a, answer into slot b. */
  pairBegin(): Promise<{ code: string }>;
  pairPoll(): Promise<PairAskView | null>;
  pairAnswer(accept: boolean): Promise<{ machinePk: string } | null>;
  pairCancel(): Promise<void>;
  daemonStatus(): Promise<DaemonStatus>;
  /** Certify this machine's daemon key with the person key and hand the cert back. */
  daemonAdopt(): Promise<ComputerView>;
  /** Put the bundled kiwi binary in ~/.kiwi/bin and on the PATH (the app also does this on every start). */
  installCli(): Promise<{ path: string }>;
  /** A newer proper release: being downloaded, ready to restart into, or only available (a .deb). */
  getUpdate(): Promise<UpdateView | null>;
  onUpdate(cb: (u: UpdateView) => void): () => void;
  /** Restart into the downloaded update. */
  installUpdate(): Promise<void>;
  notify(title: string, body: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  /** The kiwi://join/<code> link waiting to be opened, if any; taking it clears it. */
  getDeepLink(): Promise<string | null>;
  /** A link came in while the app runs (it waits for getDeepLink too, so it's opened once). */
  onDeepLink(cb: (url: string) => void): () => void;
}

export interface UpdateView {
  version: string;
  state: "downloading" | "ready" | "available";
  /** The release's page. */
  url: string;
}

declare global {
  interface Window {
    kiwi: KiwiBridge;
  }
}

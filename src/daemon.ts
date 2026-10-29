// kiwi daemon: one long-running process per KIWI_HOME. The app and the CLI talk to it over
// $KIWI_HOME/daemon.sock (a named pipe on Windows), newline-delimited JSON: {id, verb, ...} in,
// {id, ok, ...} out. It owns two things:
//
//   - this computer's key and cert (machine.json, re-read on every request, so `kiwi login`
//     changing it just works), plus `adopt` for the app handing the cert to its own computer;
//   - one live relay stream per local agent seat, shared by every subscriber of that agent
//     (`listen` on this socket); each subscriber still gets its deliveries from its own cursor.
//
// The multiplex runs over client.ts's Promise API (history for catch-up, one stream() per seat),
// not over an agent session: the relay authenticates one socket as one member key, and presence
// and read marks are per agent — which is exactly why the daemon keeps one stream per seat and
// shares it. A CLI that finds an older daemon stops it and starts its own.

export { loadPairedMachine, PairError, type PairedMachine, type PairedPerson } from "./daemon/pair.ts";
export {
  DAEMON_PROTOCOL,
  daemonSock,
  type DaemonEvent,
  type DaemonHello,
  type DaemonListener,
  type DaemonPeek,
  type DaemonRead,
  type DaemonSeat,
  type DaemonVerb,
  type DaemonWake,
  type ListenerKind,
} from "./daemon/protocol.ts";
export { activityEnv, reachOf, seatRecordFor, wakeHooked, wakeOn, type Attached } from "./daemon/reach.ts";
export {
  adoptDaemon,
  daemonHarnesses,
  daemonLaunch,
  daemonLoop,
  daemonUnpair,
  daemonHello,
  daemonListeners,
  daemonListening,
  daemonMark,
  daemonPeek,
  daemonPresence,
  daemonSeat,
  ensureDaemon,
  holdListener,
  listenDaemon,
  reportRead,
  spawnDaemon,
  stopDaemon,
  type DaemonSubscription,
  type HeldListener,
} from "./daemon/rpc.ts";
export { ACTIVITY_EVERY_MS, runDaemonForeground, startDaemon, type Daemon, type DaemonOptions } from "./daemon/server.ts";

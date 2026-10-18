// Shared channel state, folded from the message log.
//
// Every client folds the same signed events in the same (relay-assigned)
// order, so they all agree on who owns which task and what the facts are,
// without the relay ever reading any of it.
// Conflicts resolve deterministically: the earlier sequence number wins.

export { fold } from "./state/fold.ts";
export { allowedOnHold, colorOf, humanOf, isLeadRole, isPerson, LEAD, ON_HOLD, ownerOf } from "./state/people.ts";
export { chooseThread, dmPlace, MAIN, placeFromKey, placeKey, tasksAwaitingPeople, threadMembers, wentTo } from "./state/places.ts";
export { outsideRepos, reposOf } from "./state/repos.ts";
export { LEASE_WAIT_MS, nextIn, placeIn } from "./state/leases.ts";
export { unnamedAsks, unnamedTasks } from "./state/compact.ts";
export { findRoom, newRoomId } from "./state/rooms.ts";
export { currentState, openRound, parseTaskId, revisedOut, similarOpenTasks, taskId, titlesLookAlike } from "./state/tasks.ts";
export {
  toRoster,
  type ChannelState,
  type Compact,
  type Fact,
  type Lease,
  type FoldBase,
  type GuardFloor,
  type Member,
  type Place,
  type PlaceSummary,
  type Reaction,
  type ReviewRound,
  type RoomsFloor,
  type Roster,
  type Task,
} from "./state/types.ts";

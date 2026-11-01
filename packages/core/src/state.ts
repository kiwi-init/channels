// Shared channel state, folded from the message log.
//
// Every client folds the same signed events in the same (relay-assigned)
// order, so they all agree on who owns which task and what the facts are,
// without the relay ever reading any of it.
// Conflicts resolve deterministically: the earlier sequence number wins.

export { fold } from "./state/fold.ts";
export { askGroups, askRefusal, heldBy, holdsWork, mayNameGoal, type AskGroup } from "./state/asks.ts";
export { allowedOnHold, answersAsk, answersDecisions, colorOf, decidersOf, fullyTrusted, humanOf, isLeadRole, isPerson, ON_HOLD, ownerOf, sameAuthor, trustedOf } from "./state/people.ts";
export { chooseThread, dmPlace, inGeneral, longForGeneral, MAIN, placeFromKey, placeKey, tasksAwaitingPeople, threadMembers, wentTo } from "./state/places.ts";
export { issueOf, prChecks, prKey, releaseOf, rulesOf, type GithubPr, type GithubRelease, type GithubRules } from "./state/github.ts";
export { outsideRepos, reposOf } from "./state/repos.ts";
export { LEASE_WAIT_MS, nextIn, placeIn } from "./state/leases.ts";
export { unnamedAsks, unnamedTasks } from "./state/compact.ts";
export { leadCheckpointKey } from "./state/lead.ts";
export {
  changedSinceApproval,
  doneWhen,
  freeAgents,
  judgesSpec,
  setAsideBySpec,
  specLease,
  specOfTask,
  specPlanner,
  specQueue,
  specStage,
  specTasks,
  specTitle,
  specTitleOf,
  tickDoneWhen,
  type DoneWhen,
  type SpecStage,
} from "./state/specs.ts";
export { findRoom, newRoomId } from "./state/rooms.ts";
export { bareAt, memberNamed, readsAsHandle } from "./state/mentions.ts";
export { currentState, openRound, parseTaskId, reviewClaimRefusal, reviewMoveRefusal, revisedOut, similarOpenTasks, taskId, titlesLookAlike } from "./state/tasks.ts";
export {
  rosterOf,
  toRoster,
  type AskHead,
  type ChannelState,
  type Fact,
  type Lease,
  type FoldBase,
  type GuardFloor,
  type Member,
  type Place,
  type Reaction,
  type ReviewRound,
  type RoomsFloor,
  type Roster,
  type Spec,
  type SpecMark,
  type Task,
} from "./state/types.ts";

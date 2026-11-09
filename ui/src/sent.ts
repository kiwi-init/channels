export const SENT = {
  stepDone: "Done",
  stepCant: "Can't do it",
  stepNotNeeded: "Not needed",
  compactAsk:
    "Please draft a /compact summary of the history so far: name every open task (T7) and open question (#123) by its id, then run `kiwi compact --file summary.md`. I'll approve it in the app.",
  specWhereNow: "where does this stand? A few lines for people, please: what's done, what's next, what might need us.",
  untitledChannel: "Untitled channel",
} as const

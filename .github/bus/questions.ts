import { ask, MODEL } from "../jev-ci/jev.ts"

type Question = { type: "noul"; instructions: Record<string, string>; criteria: { true: string; false: string } }

export const questions = {
  keep_both: {
    type: "noul",
    instructions: {
      hunk: "A git conflict in `file`, inside `enclosing`. `base` is what the common ancestor had there (empty: nothing), `ours` is main's version, `theirs` is the incoming branch's.",
      intents: "`intents.ours` are main's commit subjects since the branches split, `intents.theirs` the branch's: what each side meant to do.",
      question: "Is keeping both sides' lines, ours first, the correct merge of `hunk`?",
    },
    criteria: {
      true: "Each side adds something independent, like a field, an import or a case, and both are needed.",
      false: "The sides change the same thing in different ways, or one replaces what the other edits.",
    },
  },
  intent_shift: {
    type: "noul",
    instructions: {
      hunk: "A git conflict in `file`, inside `enclosing`, with `base`, `ours` (main) and `theirs` (the incoming branch), and `resolution`, the code that replaces it.",
      intents: "`intents.ours` and `intents.theirs` are each side's commit subjects: what each change meant to do.",
      question: "Could `resolution` change what either side meant to do, compared with applying both changes as their authors intended?",
    },
    criteria: {
      true: "Something one side added or changed is missing, reverted, duplicated or altered in meaning, or the resolution adds behavior neither side wrote.",
      false: "The resolution keeps every change both sides made, combined the way each author would expect, and adds nothing of its own.",
    },
  },
  needs_order: {
    type: "noul",
    instructions: {
      branches: "`first` and `second` are two branches waiting to merge into main, each with its commit subjects and its diff for the files both touch.",
      question: "Does `second` need `first` to merge before it, for `second` to merge correctly?",
    },
    criteria: {
      true: "Both edit the same members or statements, or `second` builds on or changes what `first` changes, so merging `second` first would force a contradictory or lossy merge of `first`.",
      false: "They touch different members or independent lines of the shared files, so either order merges cleanly.",
    },
  },
  unrelated_failure: {
    type: "noul",
    instructions: {
      failure: "`job` failed in CI on a merge of `change` into main. `log` is the end of its output.",
      question: "Is this failure unrelated to `change`, like a flaky test, a timeout, a network or infrastructure error?",
    },
    criteria: {
      true: "The log shows a timeout, a network or registry error, a runner problem, or a test known to be timing-dependent, in code the change does not touch.",
      false: "The failure is in code, behavior, types or output the change touches or can affect.",
    },
  },
} satisfies Record<string, Question>

export type QuestionName = keyof typeof questions

export async function judge(name: QuestionName, state: Record<string, unknown>): Promise<number> {
  const res = await ask({ model: MODEL, state, questions: { [name]: questions[name] } })
  const answer = res.answers[name]
  if (!answer) throw new Error(`Jev did not answer ${name}`)
  return answer.noul
}

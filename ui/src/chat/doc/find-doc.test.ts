import { describe, expect, test } from "bun:test"
import type { Message } from "@kiwi/core/protocol.ts"
import { findDoc, firstDoc } from "./find-doc"

const opened = (seq: number, thread: string, th: string): Message => ({ seq, from: "jow", text: "", ts: seq, sigOk: true, kind: "event", ev: { op: "doc.open", thread, th } }) as Message
const said = (seq: number): Message => ({ seq, from: "jow", text: "hi", ts: seq, sigOk: true }) as Message

describe("the thread's doc is the first one the channel opened (T3805)", () => {
  test("the snapshot's doc wins over a later doc.open, as in the fold", () => {
    expect(firstDoc({ n: 3102, docs: [["main", "khRiq"]] }, [opened(3744, "main", "6JiMl")], "main")).toBe("khRiq")
  })

  test("without one in the snapshot, the earliest doc.open wins", () => {
    expect(firstDoc({ n: 10, docs: [] }, [said(11), opened(3744, "main", "6JiMl"), opened(1213, "main", "khRiq")], "main")).toBe("khRiq")
  })

  test("another thread's doc never answers", () => {
    expect(firstDoc(null, [opened(5, "T7", "abc")], "main")).toBeNull()
  })

  test("a snapshot from a build before docs reads the whole log", async () => {
    const since: number[] = []
    const log = {
      snapshot: async () => ({ n: 3102 }),
      history: async (from: number) => {
        since.push(from)
        return { messages: [opened(1213, "main", "khRiq"), opened(3744, "main", "6JiMl")] }
      },
    }
    expect(await findDoc(log, "old-snapshot", "main")).toBe("khRiq")
    expect(since).toEqual([0])
  })

  test("a snapshot with docs only reads what came after it", async () => {
    const since: number[] = []
    const log = {
      snapshot: async () => ({ n: 3102, docs: [] as [string, string][] }),
      history: async (from: number) => {
        since.push(from)
        return { messages: [opened(3200, "T9", "t9doc")] }
      },
    }
    expect(await findDoc(log, "new-snapshot", "T9")).toBe("t9doc")
    expect(since).toEqual([3102])
  })

  test("no snapshot reads the whole log, and a found doc is remembered", async () => {
    let reads = 0
    const log = {
      snapshot: async () => null,
      history: async () => {
        reads++
        return { messages: [opened(4, "main", "only")] }
      },
    }
    expect(await findDoc(log, "remembered", "main")).toBe("only")
    expect(await findDoc(log, "remembered", "main")).toBe("only")
    expect(reads).toBe(1)
  })
})

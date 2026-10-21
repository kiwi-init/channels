import { afterAll, describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pendingCall, watchCall } from "../src/hooks/permission-call.ts";

const root = mkdtempSync(join(tmpdir(), "kiwi-permission-call-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const use = (id: string, command: string, message = `msg_${id}`) =>
  JSON.stringify({ type: "assistant", message: { id: message, role: "assistant", content: [{ type: "tool_use", id, name: "Bash", input: { command, description: "Create a file" } }] } }) + "\n";
const result = (id: string, content: string, isError = false) =>
  JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, ...(isError ? { is_error: true } : {}) }] } }) + "\n";
const said = (text: string) => JSON.stringify({ type: "user", message: { role: "user", content: text } }) + "\n";

let n = 0;
function transcript(...lines: string[]): string {
  const file = join(root, `t${n++}.jsonl`);
  writeFileSync(file, lines.join(""));
  return file;
}

describe("the call a permission prompt is about", () => {
  test("is the newest unanswered tool_use with the same tool and input, whatever the key order", () => {
    const file = transcript(said("go"), use("toolu_a", "touch a.txt"), result("toolu_a", "ok"), use("toolu_b", "touch a.txt"));
    expect(pendingCall(file, "Bash", { description: "Create a file", command: "touch a.txt" })?.id).toBe("toolu_b");
  });

  test("isn't found when its input differs, when it already has a result, or when there's no transcript", () => {
    const file = transcript(use("toolu_a", "touch a.txt"), result("toolu_a", "ok"));
    expect(pendingCall(file, "Bash", { command: "touch a.txt", description: "Create a file" })).toBeNull();
    expect(pendingCall(file, "Bash", { command: "touch b.txt", description: "Create a file" })).toBeNull();
    expect(pendingCall(file, "Edit", { command: "touch a.txt", description: "Create a file" })).toBeNull();
    expect(pendingCall(join(root, "missing.jsonl"), "Bash", {})).toBeNull();
  });

  test("a half-written last line is left for later, and doesn't count", () => {
    const file = transcript(use("toolu_a", "touch a.txt"), '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_a"');
    expect(pendingCall(file, "Bash", { command: "touch a.txt", description: "Create a file" })?.id).toBe("toolu_a");
  });
});

describe("watching that call", () => {
  test("says nothing until its result is written, then says how it went, and keeps saying it", () => {
    const file = transcript(use("toolu_c", "touch c.txt", "msg_1"), use("toolu_sibling", "ls", "msg_1"));
    const call = pendingCall(file, "Bash", { command: "touch c.txt", description: "Create a file" })!;
    const settled = watchCall(file, call);
    expect(settled()).toBeNull();
    appendFileSync(file, use("toolu_other", "ls", "msg_1") + result("toolu_sibling", "x") + JSON.stringify({ type: "user", isMeta: true, message: { content: "a hook's note" } }) + "\n");
    expect(settled()).toBeNull();
    appendFileSync(file, '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_c",');
    expect(settled()).toBeNull();
    appendFileSync(file, '"content":"(Bash completed with no output)"}]}}\n');
    expect(settled()).toEqual({ kind: "result", error: false, text: "(Bash completed with no output)" });
    expect(settled()).toEqual({ kind: "result", error: false, text: "(Bash completed with no output)" });
  });

  test("a denial, from the terminal or a hook, is an error result with its words", () => {
    const file = transcript(use("toolu_d", "touch d.txt"));
    const settled = watchCall(file, pendingCall(file, "Bash", { command: "touch d.txt", description: "Create a file" })!);
    appendFileSync(
      file,
      JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_d", is_error: true, content: [{ type: "text", text: "The user doesn't want to proceed" }] }] } }) +
        "\n",
    );
    expect(settled()).toEqual({ kind: "result", error: true, text: "The user doesn't want to proceed" });
  });

  test("a new prompt, an interrupt notice or a later assistant message means it was settled some other way", () => {
    for (const later of [
      said("[Request interrupted by user for tool use]"),
      said("try something else"),
      JSON.stringify({ type: "assistant", message: { id: "msg_next", content: [{ type: "text", text: "Okay." }] } }) + "\n",
    ]) {
      const file = transcript(use("toolu_f", "touch f.txt"));
      const settled = watchCall(file, pendingCall(file, "Bash", { command: "touch f.txt", description: "Create a file" })!);
      appendFileSync(file, later);
      expect(settled()).toEqual({ kind: "moved-on" });
    }
  });

  test("a call from before the person's last prompt is never the one being asked about", () => {
    const file = transcript(use("toolu_g", "touch g.txt"), said("[Request interrupted by user for tool use]"));
    expect(pendingCall(file, "Bash", { command: "touch g.txt", description: "Create a file" })).toBeNull();
  });

  test("a transcript that goes away settles nothing", () => {
    const file = transcript(use("toolu_e", "touch e.txt"));
    const settled = watchCall(file, pendingCall(file, "Bash", { command: "touch e.txt", description: "Create a file" })!);
    rmSync(file);
    expect(settled()).toBeNull();
  });
});

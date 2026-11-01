import { describe, expect, test } from "bun:test";
import { markdownTree } from "./mention-tree.ts";
import { onParser, parserVersion, swap, takeParser, type Found } from "./mentions.ts";

const names = new Map([
  ["bob", "Bob"],
  ["kind-gecko", "Gecko"],
  ["bright-jaguar", "nova"],
  ["maya", "Maya"],
  ["happy-manatee", "bobbuilder"],
]);

const CORPUS = [
  "hi @bob",
  "@kind-gecko can you look at T976 and #12?",
  "thanks @bright-jaguar, merged #1424 (T976)",
  "kind-gecko and happy-manatee pair on it",
  "mail me at bob@example.com or maya@x.test",
  "see https://github.com/kind-gecko/pr and www.example.com/@bob",
  "visit <https://x.test/@bob> or <bob@example.com>",
  "run `@bob` then ``kind-gecko `x` `` and `T12`",
  "```\n@bob in a fence\nT12 #3\n```\nafter @maya",
  "~~~ts\nconst x = '@bob'\n~~~\n@kind-gecko",
  "para\n\n    @bob indented code\n    T12\n\nback to @maya",
  "[@bob](https://x.test) and [T12](kiwi-task:12) but @maya",
  "![@bob](https://img.test/a.png) next to @maya",
  "**@bob** _@maya_ *kind-gecko* __T12__",
  "snake_case_@bob and _@bob and @bob_ and foo_bar",
  "> @bob quoted\n> T12 and #4\n\n- @maya\n- [ ] @kind-gecko\n1. #5",
  "# @bob heading #12\n## T12 ##",
  "| who | what |\n| --- | --- |\n| @bob | T12 |\n| kind-gecko | #7 |",
  "escaped \\@bob and @bob\\ and \\T12",
  "<span>@bob</span> inline html, then @maya",
  "<div>\n@bob in an html block\n</div>\n\n@maya after",
  "[ref]: https://x.test\n\nsee [ref] and [@bob][ref] but [@maya]",
  "PR #12 and issue #13 vs #14, a#12, ##12, #12a",
  "@bob, @bob. @bob! (@bob) [@bob] {@bob}",
  "@kind-gecko-test and @kind-gecko_ and @kind-gecko.",
  "emails like a.b-c@kind-gecko.dev don't mention",
  "url with trailing dot https://x.test/kind-gecko. then bob",
  "two\nlines @bob\nT12",
  "~~@bob~~ and ~@maya~",
  "nested **_@bob_** and *__T12__*",
  "`unclosed @bob and T12",
  'image ![alt with @bob](<https://x.test/a b.png> "t") ok @maya',
  "link [x](https://x.test/(a)) @bob",
  "http://x.test?q=@bob&r=1, done @maya",
  "@BOB and @Bob and @kind-Gecko",
  "T1 T12a xT12 T12, (T12) #0 #1234567890",
  "<custom-tag>\n@bob under a lone tag\n\n@maya",
  "text\n<div>\n@bob after a div that interrupts\n\n@maya",
  "<!-- @bob in a comment -->\n\n@maya",
  "a sentence with <b>@bob</b> bold html",
  "1) @bob\n2) T12\n\n* * *\n\n@maya",
  "setext\n===\n@bob\n---",
  "@bob\n\n```\nunclosed fence @maya",
  "&amp; @bob &copy; T12 &#35;12",
  "hard break  \n@bob and backslash\\\n@maya",
  "[unclosed @bob and ](missing @maya",
  "auto https://x.test/a_b_c and _x_ @bob",
  "a_@bob_b and _a @bob b_ and __@maya__",
];

type Seen = string;

const seen = (text: string, before?: number): Seen[] => {
  const out: Seen[] = [];
  swap(
    text,
    names,
    (hit: Found) => {
      out.push(`${hit.kind}@${hit.start}-${hit.end}${hit.kind === "mention" || hit.kind === "bare" ? `:${hit.name}` : hit.kind === "image" ? `:${hit.url}|${hit.alt}` : ""}`);
      return null;
    },
    before,
  );
  return out;
};

describe("mentions before and after the markdown parser loads (T1719)", () => {
  test("the scanner and the parser find the same mentions, tasks, refs and images over the corpus", () => {
    const cold = CORPUS.map((t) => seen(t, 100));
    const was = parserVersion();
    let told = 0;
    const stop = onParser(() => void told++);
    takeParser(markdownTree);
    stop();
    expect(parserVersion()).toBe(was + 1);
    expect(told).toBe(1);
    const warm = CORPUS.map((t) => seen(t, 100));
    const differ = CORPUS.flatMap((t, i) => (JSON.stringify(cold[i]) === JSON.stringify(warm[i]) ? [] : [{ text: t, scanner: cold[i], parser: warm[i] }]));
    expect(differ).toEqual([]);
  });
});

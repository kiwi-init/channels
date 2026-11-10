import { afterEach, beforeEach, describe, expect, test } from "bun:test";

type SendMessage = (said: { text: string; shows: string }) => boolean;

const pageScript = new URL("../desktop/scripts/eb-first-run.ts", import.meta.url).href;
const loaded: { sendMessage: SendMessage } = await import(pageScript);
const sendMessage = loaded.sendMessage;

class Area {
  text = "";
  keys = 0;
  fills = 0;
  onEnter: () => void = () => {};
  get value(): string {
    return this.text;
  }
  set value(next: string) {
    this.text = next;
    this.fills++;
  }
  focus(): void {}
  dispatchEvent(e: Event): boolean {
    if (e.type !== "keydown") return true;
    this.keys++;
    this.onEnter();
    return true;
  }
}

class Page {
  readonly area = new Area();
  readonly dataset: Record<string, string> = {};
  messages: string[] = [];
  composer = true;

  readonly document = {
    documentElement: { dataset: this.dataset },
    querySelectorAll: (selector: string) => (selector === ".main article.msg" ? this.messages.map((textContent) => ({ textContent })) : []),
    querySelector: (selector: string) => (selector === ".main .composer textarea" ? (this.composer ? this.area : null) : selector === ".main .thread-doc" ? {} : null),
  };
}

class Key extends Event {}

const NAMES = ["document", "HTMLTextAreaElement", "KeyboardEvent"] as const;
const saved = new Map<string, unknown>();
let page: Page;

beforeEach(() => {
  for (const name of NAMES) saved.set(name, Reflect.get(globalThis, name));
  page = new Page();
  Reflect.set(globalThis, "document", page.document);
  Reflect.set(globalThis, "HTMLTextAreaElement", Area);
  Reflect.set(globalThis, "KeyboardEvent", Key);
});

afterEach(() => {
  for (const name of NAMES) Reflect.set(globalThis, name, saved.get(name));
});

const TEXT = "[the message link](https://example.com/kiwi-message-link)";
const SHOWS = "the message link";

function poll(times: number, said = { text: TEXT, shows: SHOWS }): boolean[] {
  return Array.from({ length: times }, () => sendMessage(said));
}

describe("the smoke run's sendMessage, polled until the message shows (T4900)", () => {
  test("a message that renders late is sent once and leaves the composer empty", () => {
    let pollsUntilShown = 3;
    page.area.onEnter = () => {
      page.area.text = "";
    };
    const answers: boolean[] = [];
    for (let i = 0; i < 8; i++) {
      answers.push(sendMessage({ text: TEXT, shows: SHOWS }));
      if (page.area.keys > 0 && --pollsUntilShown === 0) page.messages.push("the message link");
    }
    expect(answers).toEqual([false, false, false, false, true, true, true, true]);
    expect(page.area.keys).toBe(1);
    expect(page.area.fills).toBe(1);
    expect(page.area.value).toBe("");
  });

  test("Enter is pressed again only while the composer still holds the text", () => {
    let ignored = 2;
    page.area.onEnter = () => {
      if (ignored-- > 0) return;
      page.area.text = "";
      page.messages.push("the message link");
    };
    expect(poll(5)).toEqual([false, false, false, false, true]);
    expect(page.area.keys).toBe(3);
    expect(page.area.fills).toBe(1);
  });

  test("the message showing while the composer holds something else isn't done, and nothing is typed over it", () => {
    page.area.onEnter = () => {
      page.area.text = "a draft the person kept";
      page.messages.push("the message link");
    };
    expect(poll(4)).toEqual([false, false, false, false]);
    expect(page.area.value).toBe("a draft the person kept");
    expect(page.area.fills).toBe(1);
  });

  test("a second, different message is typed and sent after the first", () => {
    page.area.onEnter = () => {
      page.messages.push(page.area.text);
      page.area.text = "";
    };
    expect(poll(3, { text: "Message 1", shows: "Message 1" })).toEqual([false, false, true]);
    expect(poll(3, { text: "Message 2", shows: "Message 2" })).toEqual([false, false, true]);
    expect(page.messages).toEqual(["Message 1", "Message 2"]);
    expect(page.area.keys).toBe(2);
  });

  test("a message already in the conversation needs nothing, even with no composer on the page", () => {
    page.messages.push("the message link");
    page.composer = false;
    expect(poll(2)).toEqual([true, true]);
    expect(page.area.keys).toBe(0);
  });
});

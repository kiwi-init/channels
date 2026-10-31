import { expect, test } from "bun:test";
import { nextTextSize, parseTextFont } from "./theme";

test("the zoom keys step through Settings' text sizes, stop at either end, and ⌘0 goes back to Default", () => {
  expect(nextTextSize("default", "bigger")).toBe("large");
  expect(nextTextSize("large", "bigger")).toBe("larger");
  expect(nextTextSize("larger", "bigger")).toBe("largest");
  expect(nextTextSize("largest", "bigger")).toBe("largest");
  expect(nextTextSize("default", "smaller")).toBe("small");
  expect(nextTextSize("small", "smaller")).toBe("small");
  expect(nextTextSize("small", "bigger")).toBe("default");
  expect(nextTextSize("largest", "reset")).toBe("default");
});

test("a stored font reads back as one Settings offers, and anything else is the system font", () => {
  expect(parseTextFont("inter")).toBe("inter");
  expect(parseTextFont("lato")).toBe("lato");
  expect(parseTextFont("atkinson")).toBe("atkinson");
  expect(parseTextFont(null)).toBe("system");
  expect(parseTextFont("Comic Sans")).toBe("system");
});

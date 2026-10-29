import { describe, expect, test } from "bun:test";

import { renamed } from "./compress-image";

describe("compress-image", () => {
  test("the new name carries the new type", () => {
    expect(renamed("shot.png", "image/webp")).toBe("shot.webp");
    expect(renamed("pasted.png", "image/jpeg")).toBe("pasted.jpg");
    expect(renamed("noext", "image/webp")).toBe("noext.webp");
  });
});

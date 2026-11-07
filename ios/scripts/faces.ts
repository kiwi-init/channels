import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { CHARACTERS } from "../../ui/src/kit/characters.ts";

const assets = join(import.meta.dir, "../Channels/Assets.xcassets");
const swift = join(import.meta.dir, "../Channels/Theme/Faces.swift");

const contents = (file: string) =>
  JSON.stringify(
    {
      images: [{ filename: file, idiom: "universal" }],
      info: { author: "xcode", version: 1 },
      properties: { "preserves-vector-representation": true, "template-rendering-intent": "template" },
    },
    null,
    2,
  ) + "\n";

const rows: string[] = [];
for (const [role, c] of Object.entries(CHARACTERS)) {
  const dir = join(assets, `face-${role}.imageset`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${role}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="${c.body}" fill="#000"/></svg>\n`);
  writeFileSync(join(dir, "Contents.json"), contents(`${role}.svg`));
  rows.push(`        "${role}": FaceEyes(x: ${c.eyes.x}, y: ${c.eyes.y}, spacing: ${c.eyes.spacing}, scale: ${c.eyes.scale}),`);
}

writeFileSync(
  swift,
  `import CoreGraphics

struct FaceEyes {
    let x: CGFloat
    let y: CGFloat
    let spacing: CGFloat
    let scale: CGFloat
}

enum Faces {
    static let eyes: [String: FaceEyes] = [
${rows.join("\n")}
    ]
    static let fallback = FaceEyes(x: ${CHARACTERS.default.eyes.x}, y: ${CHARACTERS.default.eyes.y}, spacing: ${CHARACTERS.default.eyes.spacing}, scale: ${CHARACTERS.default.eyes.scale})
}
`,
);
console.log(`${rows.length} faces`);

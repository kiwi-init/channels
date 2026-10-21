import { readFileSync } from "node:fs";

const file = process.env.KIWI_SHOTS_CLOCK;
if (file) {
  const real = Date.now.bind(Date);
  const read = (): number => {
    try {
      return Number(readFileSync(file, "utf8")) || 0;
    } catch {
      // No file yet: the clock is the real one.
      return 0;
    }
  };
  let offset = read();
  setInterval(() => (offset = read()), 40).unref();
  Date.now = () => real() + offset;
}

import "~/i18n/en/github-later"
import type { Key } from "~/i18n/en"

export type Face = "lead" | "builder" | "reviewer" | "bug-hunter" | "explorer" | "releaser" | "default"

export interface Character {
  id: string
  name: Key
  body: string
  eyes: { x: number; y: number; spacing: number; scale: number }
}

export const CHARACTERS: Record<Face, Character> = {
  lead: {
    id: "cat",
    name: "kit.characters.cat",
    body: "M50 23C68 23 82 30 82 45C82 58 68 65 50 65C32 65 18 58 18 45C18 30 32 23 50 23ZM24 42C21 32 20 22 22 15C23 11 26 10 29 12C34 16 39 21 44 28L36 42ZM64 42L56 28C61 21 66 16 71 12C74 10 77 11 78 15C80 22 79 32 76 42ZM38 56L62 56C70 56 74 66 74 76C74 83 70 86 63 86L37 86C30 86 26 83 26 76C26 66 30 56 38 56ZM70 72C77 74 81 70 80 64C79 60 81 57 84 58C87 59 88.5 63 88 68C87 77 80 83 70 81Z",
    eyes: { x: 50, y: 43, spacing: 17, scale: 1.1 },
  },
  builder: {
    id: "ghost",
    name: "kit.characters.ghost",
    body: "M24 50C24 28 35 12 50 12C65 12 76 28 76 50L77 80C77 85 73 88 68 88C63 88 61 84 59 81C57 84 54 88 50 88C46 88 43 84 41 81C39 84 37 88 32 88C27 88 23 85 23 80Z",
    eyes: { x: 50, y: 42, spacing: 16, scale: 1.15 },
  },
  reviewer: {
    id: "shield",
    name: "kit.characters.shield",
    body: "M50 14C60 18 72 18 82 16Q86 16 86 20L86 46C86 64 72 78 54 86.5Q50 88.5 46 86.5C28 78 14 64 14 46L14 20Q14 16 18 16C28 18 40 18 50 14Z",
    eyes: { x: 50, y: 42, spacing: 17, scale: 1.15 },
  },
  "bug-hunter": {
    id: "spider",
    name: "kit.characters.spider",
    body: "M26 56A24 24 0 1 1 74 56A24 24 0 1 1 26 56ZM33.43 42.99L24.67 20.19L15.53 26.29A2.75 2.75 0 0 1 12.47 21.71L24.47 13.71Q27.33 11.81 28.57 15.01L38.57 41.01ZM28.28 52.15L16.76 42.93L14.69 52.58A2.75 2.75 0 0 1 9.31 51.42L12.31 37.42Q13.24 33.07 16.72 35.85L31.72 47.85ZM30 66.75L16.43 66.75L14.73 80.34A2.75 2.75 0 0 1 9.27 79.66L11.27 63.66Q11.57 61.25 14 61.25L30 61.25ZM39.08 74.53L26.13 80.08L22.55 89.02A2.75 2.75 0 0 1 17.45 86.98L21.45 76.98Q21.87 75.92 22.92 75.47L36.92 69.47ZM61.43 41.01L71.43 15.01Q72.67 11.81 75.53 13.71L87.53 21.71A2.75 2.75 0 0 1 84.47 26.29L75.33 20.19L66.57 42.99ZM68.28 47.85L83.28 35.85Q86.76 33.07 87.69 37.42L90.69 51.42A2.75 2.75 0 0 1 85.31 52.58L83.24 42.93L71.72 52.15ZM70 61.25L86 61.25Q88.43 61.25 88.73 63.66L90.73 79.66A2.75 2.75 0 0 1 85.27 80.34L83.57 66.75L70 66.75ZM63.08 69.47L77.08 75.47Q78.13 75.92 78.55 76.98L82.55 86.98A2.75 2.75 0 0 1 77.45 89.02L73.87 80.08L60.92 74.53Z",
    eyes: { x: 50, y: 56, spacing: 17, scale: 1.15 },
  },
  explorer: {
    id: "magnifier",
    name: "kit.characters.magnifier",
    body: "M41 12A29 29 0 0 1 64.44 58.08L68.5 62.13A8 8 0 0 1 75.65 64.33L87.67 76.36A8 8 0 0 1 76.36 87.67L64.33 75.65A8 8 0 0 1 62.13 68.5L58.08 64.44A29 29 0 1 1 41 12Z",
    eyes: { x: 41, y: 40, spacing: 17, scale: 1.15 },
  },
  releaser: {
    id: "rocket",
    name: "kit.characters.rocket",
    body: "M46 10C48 8.5 52 8.5 54 10C64 17 71 29 71 44L71 72L29 72L29 44C29 29 36 17 46 10ZM29 56L71 56C80 61 86 70 86 80C86 84 83 86 79 85L72 83L28 83L21 85C17 86 14 84 14 80C14 70 20 61 29 56ZM42 80L58 80C59 86 55 90 50 92C45 90 41 86 42 80Z",
    eyes: { x: 50, y: 46, spacing: 15, scale: 1.05 },
  },
  default: {
    id: "chat",
    name: "kit.characters.chat",
    body: "M28 14H72C82 14 90 22 90 32V54C90 64 82 72 72 72H42L25 86C23.5 87.3 21.5 86 22.3 84L27 71.5C17 70 10 63 10 54V32C10 22 18 14 28 14Z",
    eyes: { x: 50, y: 42, spacing: 18, scale: 1.25 },
  },
}

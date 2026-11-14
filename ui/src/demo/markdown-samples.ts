export const SPOILER_MESSAGES = [
  "alpha ||beta|| gamma",
  "one ||first|| two ||second|| three",
  "format ||**bold** and [docs](https://example.com/hidden)|| end",
  "[before ||inside|| after](https://example.com/outer)",
  "Literal: `alpha ||beta|| gamma`\n\n```text\nalpha ||beta|| gamma\n```",
  "||outer ||inner|| outer||",
  "- [ ] public ||SECRET_SPOILER||",
  "- [x] public ||SECRET_SPOILER||",
  "- [ ] parent ||SECRET_SPOILER||\n  - [x] child ||NESTED_SECRET||",
  "![public ||SECRET_ALT||](https://example.com/image.png)",
  `![public ||SECRET_ALT||](data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"></svg>')})`,
  "![public ||SECRET_ALT||](javascript:alert(1))",
] as const

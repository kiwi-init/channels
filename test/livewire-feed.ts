export const FEED = "https://github.com/kiwi-init/channels/releases.atom";

export const releasePage = (tag: string): string => `https://github.com/kiwi-init/channels/releases/tag/${tag}`;

export const releasesFeed = (...tags: string[]): string =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en-US">',
    '  <link type="text/html" rel="alternate" href="https://github.com/kiwi-init/channels/releases"/>',
    ...tags.map((tag) => `  <entry><id>tag:github.com,2008:Repository/1/${tag}</id><link rel="alternate" type="text/html" href="${releasePage(tag)}"/><title>${tag}</title></entry>`),
    "</feed>",
  ].join("\n");

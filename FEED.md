# What the feed promises

The conversation stays where you left it. Each line below is one promise, the check that fails when it breaks, and words that check says.

- `bun scripts/feed-promises.ts` runs in `repo / static`. It fails when a line names a check that is gone, words the check no longer says, or a script CI doesn't run.
- A new promise goes here with its check, in the same PR.
- These checks count rows and positions, never milliseconds.

## A new message

| The feed promises | The check that fails | Words in that check |
| --- | --- | --- |
| At the bottom, the view follows an agent's lines, also right after you send while it posts and edits | `scripts/ui-doc-follow.ts` | `the view stopped following new messages` |
| Sending keeps the view where it was: at the bottom, scrolled up, and with a long line | `scripts/ui-send-scroll.ts` | `sending moved the view` |
| Reading a little above the bottom, lines that arrive never move the view | `scripts/ui-doc-still.ts` | `the doc stays put while you read a little above the bottom and lines arrive` |
| The composer you type in stays put while lines arrive | `scripts/ui-doc-still.ts` | `the composer you type in stays put while lines arrive` |
| Held, or reading an older stretch, the bottom does not pull you along | `ui/src/chat/stick.test.tsx` | `held, or reading an older window, the bottom does not pull you along` |
| A sent line with an image stays above the lines sent after it | `scripts/ui-doc-image-order.ts` | `doc lines with images are drawn wrong` |
| A line of yours that changes is laid out once, also while markdown is still loading: its row keeps the size the feed read | `scripts/ui-msg-edit.ts` | `no resize observer resizes its row from inside its own callback` |

## A change of width, and the sidebar toggle

| The feed promises | The check that fails | Words in that check |
| --- | --- | --- |
| Hiding and showing the sidebar, dragging its edge, opening a panel and resizing the window leave no blank room under the last line | `scripts/ui-feed-width.ts` | `px of blank room under the last line` |
| At the bottom, the feed is still at the bottom after each of those | `scripts/ui-feed-width.ts` | `the feed rests` |
| Scrolled up, the row you were reading stays in view, and is back on its pixel when the width is back | `scripts/ui-feed-width.ts` | `px from where it was` |

## A late image or font

| The feed promises | The check that fails | Words in that check |
| --- | --- | --- |
| At the bottom, a picture that arrives after its line leaves the last line at the bottom of the view | `scripts/ui-feed-late-image.ts` | `a late picture leaves the last line at the bottom of the view` |
| Scrolled up, a picture that arrives above the view leaves the row you read on its pixel | `scripts/ui-feed-late-image.ts` | `a late picture above the view leaves the row at the top on its pixel` |
| At the bottom, a row that collapses to its placeholder while a line lands in the same breath keeps the view at the bottom | `scripts/ui-feed-late-image.ts` | `a row that collapses to its placeholder while a line lands in the same breath keeps the view at the bottom` |
| At the bottom, a burst of lines is still followed at its end | `scripts/ui-feed-late-image.ts` | `the view still follows the newest line` |
| At the bottom, a font that arrives late and wraps the lines again leaves the last line at the bottom of the view | `scripts/ui-feed-late-font.ts` | `a late font leaves the last line at the bottom of the view` |
| Scrolled up, it leaves the row you read on its pixel | `scripts/ui-feed-late-font.ts` | `a late font leaves the row at the top of the view on its pixel` |
| A bubble fitted while a font was loading is fitted again when it arrives, and the fit never changes the message's height | `scripts/ui-own-bubble.ts` | `fitting a bubble to its text never changes the message's height` |
| A line that arrives while the rest of the app's styles load in the background is laid out at once, never blank | `scripts/ui-doc-steady.ts` | `the stylesheets of lazy chunks load after the page, not in <head>` |

## Opening, and a reload

| The feed promises | The check that fails | Words in that check |
| --- | --- | --- |
| A feed, a thread and a thread doc hold still once they open | `scripts/ui-still.ts` | `holds still after opening` |
| A reload brings the scroll back to the same message | `scripts/ui-restore-place.ts` | `a restart brings the scroll back to the same message` |
| It lands on that message while markdown is still loading | `scripts/ui-restore-place.ts` | `a restart that paints plain text before markdown still lands on the same message` |
| It lands on that message below a permission ask too | `scripts/ui-restore-place.ts` | `lands on that message once the cards settle` |
| A scroll of yours during the reload wins, and stays | `scripts/ui-restore-place.ts` | `takes the feed away from the restored spot, and it stays there` |
| A reload reopens the channel on its chat | `scripts/ui-restore-place.ts` | `a restart reopens the channel on its chat` |

## Scrolling

| The feed promises | The check that fails | Words in that check |
| --- | --- | --- |
| The content never jumps while you scroll | `scripts/ui-scroll-fps.ts` | `the content jumped` |
| However far you scroll, the feed drops the rows far from the screen | `scripts/ui-scroll-fps.ts` | `it should drop rows far from the screen` |
| A long feed opens on its latest rows | `scripts/ui-scroll-fps.ts` | `rows at once: it should render the latest ones` |
| Scrolling up keeps loading, to the first message | `scripts/ui-scroll-up.ts` | `loads back to its first row while scrolling up` |
| A tall line keeps its height as it scrolls into view | `scripts/ui-doc-steady.ts` | `a line changed size as it scrolled into view` |
| A long wheel up while older rows load above, and the same wheel back down, bring the last line back to the bottom of the view: no load skips rows | `scripts/ui-feed-wheel-up.ts` | `the same wheel back down brings the feed's last line back to the bottom of the view` |

## Jumps

| The feed promises | The check that fails | Words in that check |
| --- | --- | --- |
| A search hit moves the feed to it | `scripts/ui-restore-place.ts` | `a search hit in the same room moves the feed` |
| ⌘[ goes back to the spot you were reading, and ⌘] to the hit again | `scripts/ui-restore-place.ts` | `⌘[ undoes a jump inside the room` |
| An older hit opens the stretch around it, scrolled into view | `scripts/ui-older-search.ts` | `the hit is scrolled into view and marked` |
| Scrolled up, a little or far past the rows the feed holds, Jump to latest shows and nothing covers it | `scripts/ui-feed-latest.ts` | `nothing covers it, a click at its middle lands on it` |
| A click on it brings the feed's last line back to the bottom of the view, and it goes, also from near the top of the rows the feed holds | `scripts/ui-feed-latest.ts` | `a click brings the feed's last line back to the bottom of the view` |
| From an older stretch, Back to latest returns to the live feed | `scripts/ui-older-search.ts` | `Back to latest returns to the live feed` |
| A link to a message jumps to it in its room | `scripts/ui-message-link.ts` | `clicking it jumps to the message in its room` |

## Unread counts

| The feed promises | The check that fails | Words in that check |
| --- | --- | --- |
| Lines posted in a room while you sit in another count on its row | `scripts/ui-feed-unread.ts` | `lines posted in #general show as` |
| Opening that room puts the New line in view, right above the first unread line | `scripts/ui-feed-unread.ts` | `puts the New line in view, right above the first unread line` |
| Reading them clears the count | `scripts/ui-feed-unread.ts` | `reading them clears the count on #general's row` |
| Scrolled up, lines that arrive leave the row you read on its pixel and the button counts them | `scripts/ui-feed-unread.ts` | `lines arrive and the button reads` |
| A click on that button ends at the bottom with nothing unread | `scripts/ui-feed-unread.ts` | `ends at the bottom with the button gone and nothing unread` |
| Each room has its own unread count and read mark | `packages/app/src/rooms.test.ts` | `each room has its own unread count and read mark` |
| A room's unread counts what its feed shows | `ui/src/live/side-replies.test.ts` | `a room's unread counts what its feed shows` |
| Another channel's needs-you badge arrives, stays exactly 1 through a visit, and goes when the ask closes | `scripts/ui-rail-needs.ts` | `still shows exactly 1 need you` |

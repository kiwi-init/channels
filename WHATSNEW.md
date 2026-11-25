# What's new

New features show up here when they land, and the app shows each one once in its What's new window. A feature marked `toggle: off` stays off until you turn it on there or in Settings.

The changelog lists every change; this file lists only what someone would want to try. Each feature is a `##` heading, a list of `id`, `since` and `toggle`, then a few lines on what it does.

## Search by meaning

- id: meaning
- since: 2026-11-25
- toggle: off

Find messages by what they mean, not only by their words: "when do we ship" finds "release goes out friday". Pick Search by meaning at the top of the search results, or press ⌘ Enter. It sends your search and the channel's newest messages through the Channels relay to TypeSafe's Jev to rank them. The relay keeps none of it.

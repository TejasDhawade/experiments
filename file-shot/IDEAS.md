# File Shot: ideas for later

Planned features, not built yet. Numbers are starting points to tune after playtesting.

## 1. File weight changes the throw

The file's size decides how far a throw goes.

- **Heavy files** (large sizes, e.g. a 20 MB video): fly shorter for the same drag, so you have to pull further.
- **Light files** (e.g. a 40 KB note): fly further for the same drag, so a small pull is enough.
- **Medium files:** keep today's throw strength as the balanced middle.

Notes for building it:
- Every file already shows a size (e.g. "12.7 MB"), so the weight can come from that. Real files dropped in by the player get their actual size.
- Players need to see the weight before they throw. Options: card thickness or size, a small weight tag, or how heavily the card sits on the floor.
- The dotted aim line should show the real path for that file's weight, so it stays fair. Hiding it on heavy files could be an extra challenge in later levels.

## 2. Revives earned from streaks

- Every 10 uploads in a row earns 1 revive (10 gives 1, 20 gives 2, 30 gives 3, and so on). Revives stack.
- In level 3, a revive is spent when the player would otherwise lose (the 6th miss in a row). It clears the misses-in-a-row count and the game continues.

Open questions for playtesting:
- Should revives be spent automatically, or with a "Use revive?" button?
- Is there a cap on how many revives a player can hold?
- Can streaks from levels 1 and 2 earn revives, or only level 3?
- Show held revives in the header next to the misses-in-a-row dots, with a clear moment when one is earned and when one is used.

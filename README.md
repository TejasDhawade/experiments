# experiments

Small things I build for fun, mostly to learn by making.

## File Shot

**Play it:** [experiments-file-shot.vercel.app](https://experiments-file-shot.vercel.app/)

A browser game that turns a file upload screen into basketball. Drag a file card toward the hoop, let go, and every file that drops through the rim counts as uploaded.

**How to play**

- Drag a file card. The further you pull, the harder you throw. A dotted line shows where it'll go.
- Let go to shoot. Through the rim is uploaded, anything else is missed.

**Modes**

- **Classic:** ten levels, each adding one new rule, with a short briefing before each level.
  1. **Warm-up:** one file at a time.
  2. **Rush hour:** several files on the floor at once.
  3. **Heavy lifting:** files get weight, colour coded, and heavier files score more. Blue (light, under 1 MB) is 1 point with a short pull, yellow (normal) is 2 points, red (heavy, 10 MB and up) is 3 points with a long pull. Light files are the most common, heavy the rarest.
  4. **Deadline:** files expire if you don't upload them in time: light files get 10 seconds, normal 8, heavy 6. From here to level 9, miss 6 in a row and the game is over, and each level starts with a fresh streak.
  5. **Quarantine:** virus files appear. Touching one counts as a miss.
  6. **Bundles:** rare stacks of 2 or 3 files score all their points at once (up to 6), but need a heavy pull and expire on the heavy timer.
  7. **Server busy:** every few seconds the hoop slides left and right and comes to rest on the left, the right or in the centre; the rim and a lamp flash amber just before it moves.
  8. **Bad connection:** the aim line only shows the start of the arc.
  9. **Low storage:** the rim shrinks, and swishes score 1 bonus point.
  10. **Final upload:** everything on, one 90-second clock and a target of 40 points. Swishes add 2 seconds, touching a virus takes 3 away, and misses no longer end the game. Hit the target to finish the game.

  Every 5 uploads in a row earns a **revive**. When you'd lose, you can choose to spend one and keep going.
- **Timed run:** 60 seconds on one clock. Score as many points as you can; clean swishes add 2 seconds.

Your score is in points; best scores are saved on your device.

**Built with** plain HTML, CSS and JavaScript on a single canvas. No libraries. Works on desktop and phone.

Code lives in [`file-shot/`](file-shot/).

## Also in here

The files in the root (`index.html`, `script.js`, `style.css`) are an older version of my portfolio site. Not being updated.

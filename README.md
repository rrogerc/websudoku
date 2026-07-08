# websudoku

Personal recreation of [Web Sudoku](https://www.websudoku.com/) — same look and feel, plus the options the original never had (light/dark/auto theme, configurable controls, offline PWA).

- Vite + vanilla JS, no framework
- Puzzles generated client-side with [qqwing](https://www.npmjs.com/package/qqwing), graded into the four websudoku levels (Easy / Medium / Hard / Evil) by technique and givens count
- Puzzle numbers are real: the number seeds the generator, so "Select a puzzle..." with the same number always deals the same puzzle
- A fifth level, **Beyond Evil**: Evil puzzles that open with a forced row/column hidden pair before you can place a single digit — dealt from a pre-generated bank (`npm run beyond` regenerates it)
- The in-progress game, stats, and settings persist in localStorage — reloads resume where you left off
- Phone-friendly: full-width grid with a bottom keypad (long-press a digit key for a pencil mark), zoom locked so the layout always fits
- "Just the puzzle" mode strips the page to board + keypad and locks scrolling — press F or use the link next to the theme toggle
- Installable PWA (vite-plugin-pwa), fully offline once installed

## Commands

| command | what |
| --- | --- |
| `npm run dev` | dev server with hot reload |
| `npm run build` | production build to `dist/` |
| `npm run preview` | serve the production build locally |
| `npm run icons` | regenerate the PWA icons in `public/` |
| `npm run beyond` | regenerate the Beyond Evil puzzle bank |

## Deploy

Static site — on Vercel, import the repo and accept the Vite preset (or run `vercel` in the repo). No server, no environment variables.

# websudoku

Personal recreation of [Web Sudoku](https://www.websudoku.com/) — same look and feel, plus the options the original never had (dark theme, configurable controls, offline PWA).

- Vite + vanilla JS, no framework
- Puzzles generated client-side with [sudoku-gen](https://www.npmjs.com/package/sudoku-gen) (Easy / Medium / Hard / Evil→expert)
- The in-progress game, stats, and settings persist in localStorage — reloads resume where you left off
- Installable PWA (vite-plugin-pwa), fully offline once installed

## Commands

| command | what |
| --- | --- |
| `npm run dev` | dev server with hot reload |
| `npm run build` | production build to `dist/` |
| `npm run preview` | serve the production build locally |
| `npm run icons` | regenerate the PWA icons in `public/` |

## Deploy

Static site — on Vercel, import the repo and accept the Vite preset (or run `vercel` in the repo). No server, no environment variables.

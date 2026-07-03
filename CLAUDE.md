# websudoku

Personal recreation of [websudoku.com](https://www.websudoku.com/) for Roger's own use — the original UI he's used to, plus the customizations the real site never offered. Frontend only; not published publicly (repo is private: it contains the original site's logo and CSS-derived styling).

## Stack (deliberate choices — don't change without asking)

- **Vite + vanilla JavaScript.** No TypeScript, no framework — explicitly chosen over React/Next as overkill.
- Puzzles from **qqwing 1.3.4** (client-side, no backend) via `src/generator.js` — a real generator with technique-based grading, replacing the earlier sudoku-gen seed-bank. Puzzle numbers are REAL: the number seeds a mulberry32 PRNG swapped into `Math.random` for the whole generate-and-grade loop, so "Select a puzzle 12,345" always deals the same puzzle. **Numbering contract: the qqwing version (pinned, no caret), the seed hash, and the acceptance bands in `generator.js` all determine which puzzle a number produces — changing any of them renumbers every puzzle.** Difficulty bands were calibrated by grading live websudoku.com puzzles with qqwing's technique counters (Easy = singles-only @ 34-36 givens, padded up from qqwing's natural 28-29; Medium = singles/hidden singles @ 28-31; Hard = hidden-single-heavy or light pairs @ 26-28; Evil = qqwing Intermediate, i.e. needs pairs/pointing but never guessing, @ 24-26). Real websudoku Evil never requires guessing — qqwing's Expert tier is *harder* than Evil and is unused (a possible future "beyond Evil" level). All puzzles are 180°-rotationally symmetric with unique solutions, like the original's. qqwing is GPL-2.0 — fine while private.
- **vite-plugin-pwa** for offline/installable PWA (planned: deploy to Roger's personal Vercel, install on iPhone). `workbox.globPatterns` includes `png` so the logo/icons precache — keep that.

## Fidelity principle

Visual fidelity to the original site matters. The markup and CSS deliberately mirror the real websudoku page (Roger pasted its inner-frame HTML during development):

- Grid cells: `<td class="{c,e,f,g,h,i}{0-3}">` — letter picks which borders are thick 3×3 box borders (e/g/i = thick left, f/g = thick top, h/i = thick bottom), digit 0–3 is the escalating red error level. Ids `c{col}{row}`, inputs `f{col}{row}` (column-first, like the original).
- Inputs: `s*` = givens (Times), `d*` = user entries (lucida handwriting → Comic Sans MS fallback, blue), `w*`/`v*` = the original's inline pencil-mark styles (no longer applied, kept in CSS for reference).
- Original layout: full-height table, grid vertically centered, message line in `bigbig` above the grid ("Here is the puzzle. Good luck!" etc. — texts lifted from the original's JS vars), level links in the left column, buttons `How am I doing? / Pause / Clear / Options...` (Print button was removed on request), "Hard Puzzle N - 0:42 - Select a puzzle..." info line below the grid.
- All colors go through CSS variables in `:root` / `html[data-theme="dark"]` so themes are a variable swap. Original hex values live in the light theme.
- Deliberately omitted: ads, analytics, accounts, cookie banner, Variations/Ebook/Deluxe links.

## Custom behavior (differs from the original on purpose)

- **Data model**: `game.entries[81]` (committed single digits) is separate from `game.marks[81]` (pencil candidates). Entry and marks are mutually exclusive per cell; setting one clears the other.
- **Pencil marks render as a 3×3 mini-grid** (`.pm` overlay div per cell, digit d in fixed slot d) — modern-app style, not the original's digits-in-a-row.
- **Keyboard**: Arrows/WASD move; 1–9 enters (pressing a cell's current digit again clears it — everything is a toggle); hold **Space or Shift + digit** toggles a pencil mark; Backspace/Delete clears the cell; Enter = check; **Escape hides the selection box**, and any movement key re-summons it where it was (center cell on a fresh puzzle). Typing is handled in `keydown` (inputs are `maxLength=1`, `inputmode="none"`).
- **Side keypad** (1–9, ⌫, ✎ pencil toggle) hidden on desktop by default, shown on touch — mirrors the original; overridable in Options. **On phone portrait (≤480px) it docks as a fixed bottom thumb bar** (1–9 row, then ⌫/✎; safe-area aware) and the grid goes full-width via fluid `--cell` sizing (`min(44px, (100vw - 24px)/9)`) so the board fits at any zoom/Display Zoom. **Long-press a digit key toggles a pencil mark** — the touch analog of Space/Shift+digit; the trailing click is swallowed via a `longPressed` flag. `applyKey` re-focuses the remembered `selected` cell if focus was dropped (iOS focus is fragile), so the keypad never dead-ends. When the keypad is off, `html.no-keypad` removes the bottom clearance padding.
- **Zoom hardening**: `user-scalable=no, maximum-scale=1` (honored in the standalone PWA; Safari-in-browser ignores it), `touch-action: manipulation` kills double-tap zoom, dialog inputs are ≥16px on coarse pointers so iOS never auto-zooms on focus, `viewport-fit=cover` + `env(safe-area-inset-*)` padding for notch/home-indicator. `theme-color` meta is updated from JS to match the current theme's page background.
- Options panel (in-page `<details>`): dark theme, timer, allow pencil marks, highlight-on-check vs purple-count message (mirrors the original's two check modes), check-as-you-type, keypad visibility, keypad pencil mode. Settings/stats/current game persist in localStorage (`websudoku:settings|stats|game`); saved games restore across reloads and old formats are migrated.
- **"Select a puzzle..."** in the info line opens a number-entry dialog; the number deterministically reproduces that puzzle at the current level (saved games from the sudoku-gen era restore fine but their numbers predate the contract and won't re-deal the same grid).
- **"Just the puzzle" mode** (`settings.boardOnly` → `html.board-only`): hides everything except the message line, grid, and (on touch) the keypad, and locks scrolling (`overflow:hidden` + `overscroll-behavior:none`) so phones get a fixed, non-scrolling solving surface. Enter via the "Just the puzzle" link next to Dark mode or the **F** key; exit via the corner ✕ or F. Persisted, so the iPhone PWA can live in it. Pause/check/level-switching require exiting the mode (win detection still fires automatically).

## Glyph centering — DO NOT "simplify" these rules

The `transform: translateY(...)` rules on `.s*`, `.d*`, `.pm span` and the `@supports (-moz-appearance: none)` Gecko override in `src/style.css` were **empirically calibrated** by rendering test pages in headless Chrome *and* headless Zen (Roger's browser — a Firefox fork; Gecko draws Times ~0.09em high in inputs, Blink ~0.02em, and the handwriting font sits ~0.04em low in both). Method: screenshot a magnified given/entry pair, decode the PNG in Node, measure ink centers against the cell borders. Result is within ±0.25 CSS px in both engines at all breakpoints. The original site has the misalignment; this clone fixes it. Inputs fill cells via `position:absolute; inset:0` (percentage heights inside table cells don't resolve in Gecko). WebKit/iOS has never been calibrated — if digits look off on the iPhone PWA, redo the measurement loop against Safari.

## Commands

- `npm run dev` / `npm run build` / `npm run preview`
- `npm run icons` — regenerates PWA icons (`scripts/make-icons.mjs`, dependency-free PNG encoder)
- Verify changes with `npm run build`; there are no tests.

## Context about Roger

- Browses in **Zen** (Gecko/Firefox engine) — test rendering changes there, not just Chrome. Headless CLI: `/Applications/Zen.app/Contents/MacOS/zen --headless --screenshot ...` (same flags as Firefox; may need sandbox disabled).
- Cares about pixel-level UI details and mouse-free play; nitpicks are welcome work items.
- Wants to keep the original's fonts and look; customization ≠ modernization.

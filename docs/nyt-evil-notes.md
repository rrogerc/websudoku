# NYT-style Evil — the analysis behind the July 2026 rebuild

Why Evil generates asymmetric minimal grids while every other level stays
180°-symmetric, what the acceptance band's numbers mean, and what was
deliberately left out. Read this before touching Evil's band in
`src/generator.js` (and remember: any change renumbers every Evil puzzle).

## The question

Roger felt NYT Hard puzzles were "higher quality" than websudoku Evil and asked
whether that was placebo. It isn't. We graded 1,155 archived NYT Hard puzzles
(daily scrape, May 2023 – July 2026, via github.com/Abbe98/nyt-sudoku-scraper),
20 live websudoku Evils scraped fresh, and the clone's Evil — all with the
pinned qqwing 1.3.4 plus a custom solve-path replayer. Five real differences:

1. **Minimality.** Every one of the 1,155 NYT grids is minimal: delete any
   given and the solution stops being unique. websudoku Evil averaged ~3
   removable (redundant) givens; the old clone Evil ~2.3. Redundant givens are
   freebies — they dilute.
2. **Asymmetry.** NYT: 0% symmetric. websudoku: 100%. These are the same fact:
   qqwing (and websudoku's generator, evidently) digs clues out in symmetric
   PAIRS, and a clue that can only be removed alone gets stranded. Symmetry is
   *where the padding comes from*.
3. **No technique ceiling.** ~7% of NYT Hards need beyond-pairs logic
   (XY-wing most commonly, then chains; X-wing rarely). websudoku Evil never
   exceeds qqwing Intermediate (pairs).
4. **Tight opening, big cascade.** Replaying solves and counting how many
   cells are findable at each step (naked+hidden singles = "width"): NYT opens
   at 3.6 findable cells (24% of puzzles open at 1-2!) vs old Evil's 5.5, then
   widens to ~6.9 by the last third — a ~2.1× tension-then-release arc vs the
   old Evil's 1.7×.
5. **Variety.** NYT's pair-step distribution is nearly flat 1-6 with a 10%
   tail at 8+. But note the flat bottom means NYT deals a 1-pair-step stroll
   13% of the time — and live websudoku is worse, 30% one-pair-step "Evils".

## The rebuild

Evil now generates with `qqwing.Symmetry.NONE` and accepts:
`Intermediate && clues <= 26 && pairs >= 3 && openingWidth(givens) <= 4`.

- **Minimal for free.** One-pass individual-cell digging yields minimal
  puzzles by monotonicity: removing a given never *restores* uniqueness, so a
  cell that failed removal earlier (when more givens were present) can only
  fail harder later. Verified empirically: 0 redundant givens in 400/400 raw
  `Symmetry.NONE` deals and 12/12 seeded deals through the real generator.
  No explicit minimality check is needed in the acceptance test.
- **`openingWidth()`** counts distinct cells solvable via naked or hidden
  single on the untouched grid. It is a pure function of the grid — it draws
  nothing from the seeded rng, so it's safe inside the numbering contract —
  and it's the last (&&-short-circuited) check because it's the only non-free
  one.
- **`pairs >= 3` with no cap**: floor beats NYT's dud rate; the open tail
  (deals run 3 to 10+, mean ~5.3) keeps NYT's day-to-day unpredictability.
- **Cost**: ~1 in 50 accepted, ~10ms/attempt in Node (asymmetric digging costs
  ~1.6× a symmetric attempt) → ~0.4s mean / ~1s p99 in Node, call it 1.5-2s on
  the phone. Same budget as the old Evil.

Measured result vs NYT Hard (new Evil, 30 seeded deals):
givens 24.6 vs 23.9 · opening width 3.6 vs 3.6 · mean width 5.8 vs 5.9 ·
narrow-share 0.08 vs 0.08 · cascade 2.0× vs 2.1× · pair steps 5.3 vs 4.5
(higher on purpose — no easy days) · redundant givens 0.00 vs 0.00.

## Deliberately not replicated

- **Beyond-pairs techniques** (NYT's ~7% XY-wing/chain days). Kept out so Evil
  never exceeds the pairs ceiling — Roger wants a separate, future harder
  level for that instead. Useful fact for that future level: asymmetric
  qqwing deals come out qqwing-Expert (= needs beyond-pairs logic OR guessing;
  qqwing can't tell them apart) ~35% of the time, so raw generation is cheap,
  but a beyond-qqwing grader (X-wing/XY-wing/swordfish detectors, and a
  no-guessing proof) would be needed to accept honestly. The detectors written
  for the analysis are a starting point (scratchpad scripts, reproducible).
- **NYT's flat-to-1 difficulty floor** — their variety includes strolls; ours
  starts at 3 pair steps.
- **Weekday curation** (NYT Fri/Sat are ~2× as likely to be Expert-tier —
  they curate a pool; we generate on demand).

## Fidelity note

Evil grids no longer LOOK like websudoku grids (asymmetric, ~24 givens instead
of a mirrored 26). This is a knowing break from the fidelity principle,
requested 2026-07-12: "I don't care what the real websudoku has — I just want
higher quality problems." Easy/Medium/Hard/Beyond keep ROTATE180.

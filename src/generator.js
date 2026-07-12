// Real puzzle generation with reproducible numbers, built on qqwing.
//
// Difficulty bands were calibrated empirically (July 2026) by grading live
// websudoku.com puzzles with qqwing's technique counters (6+ per level, then
// re-tuned against 12/level — the re-tune renumbered Hard and Evil):
//
//   websudoku Easy    34-36 givens  naked singles only              (qqwing Simple)
//   websudoku Medium  28-32 givens  singles + a few hidden singles  (Simple/Easy)
//   clone Hard        26-28 givens  60% hidden-single heavy, 40% need pairs (2-6 steps)
//   clone Evil        23-26 givens  NYT-style: minimal, tight opening, >=3 pair steps
//
// Hard deliberately sits a notch ABOVE the live site: live Hard is ~1/3
// pair-puzzles averaging 0.8 pair steps (clone: 40% / ~1.3). Hard's
// singles/pairs split is decided per puzzle number by the seeded rng.
// Everything stays in qqwing Intermediate at most - Expert (guessing
// required) is never used.
//
// Evil was rebuilt July 2026 to match the structure of NYT Hard (measured on
// 1,155 archived NYT puzzles) rather than live websudoku Evil — THAT RE-TUNE
// RENUMBERED EVIL. The NYT signature, minus their occasional beyond-pairs
// techniques (kept out to preserve the no-guessing ceiling):
//   - MINIMAL grids: no removable given, every clue load-bearing. Falls out
//     of Symmetry.NONE for free — qqwing tests each cell individually while
//     digging, and a cell that failed removal earlier (more givens) can only
//     fail harder later. Symmetric digging removes PAIRS, which is exactly
//     what left ~2-3 redundant givens per old Evil (NYT: 0.00 across all
//     1,155; measured websudoku Evil: ~3).
//   - Asymmetric, 23-26 givens (NYT mean 23.9; symmetric Evil sat at 25-26).
//   - Tight opening: <=4 cells findable via naked/hidden single on the raw
//     grid (NYT mean 3.6 vs old Evil 5.5) — the "hunt from move one" feel,
//     and it steepens the endgame cascade (path width roughly doubles by the
//     last third, NYT's arc).
//   - Pair steps >=3 with no upper cap: floor keeps the dud rate at zero
//     (live websudoku deals 1-pair-step "Evils" 30% of the time), the open
//     tail (up to 10+) gives NYT's you-don't-know-what-today-brings spread.
//
// Every observed websudoku puzzle was 180°-rotationally symmetric with a
// unique solution, so Easy/Medium/Hard generate with ROTATE180 (qqwing
// guarantees the unique solution either way). qqwing naturally emits 24-31
// givens, so Easy pads the grid back up with symmetric pairs of solution
// digits — adding givens can only remove required techniques, never add them.
//
// Reproducibility: qqwing's sole entropy source is Math.random (no Date, no
// sort), so running the whole generate-and-grade loop under a seeded PRNG
// yields the identical puzzle for a given (level, number). Keep qqwing pinned
// at an exact version or every numbered puzzle changes.

import qqwing from 'qqwing'

export const MAX_PUZZLE_NUMBER = 9_999_999_999

// Beyond Evil deals from a pre-generated bank (see scripts/make-beyond-bank.mjs):
// an Evil that additionally forces a row/column hidden pair within the first 3
// placements. Acceptance is ~1 in 2,500 candidates - far too slow to generate
// live on a phone. Bank order IS the numbering; count must match the bank file.
export const BEYOND_COUNT = 300

export const maxPuzzleNumber = (level) => (level === 'beyond' ? BEYOND_COUNT : MAX_PUZZLE_NUMBER)

const LEVEL_SALT = { easy: 1, medium: 2, hard: 3, expert: 4 }

// mulberry32: tiny 32-bit PRNG, deterministic across JS engines
function mulberry32(seed) {
  return () => {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function seedFor(level, number) {
  const lo = number >>> 0 // number mod 2^32; numbers run past 32 bits
  const hi = Math.floor(number / 2 ** 32)
  return (lo ^ Math.imul(hi + 1, 0x9e3779b1) ^ Math.imul(LEVEL_SALT[level], 0x85ebca6b)) >>> 0
}

const parseGrid = (s) => [...s.replace(/[^1-9.]/g, '')].map((ch) => (ch === '.' ? 0 : +ch))

// The 27 houses (9 rows, 9 columns, 9 boxes) as cell-index arrays
const HOUSES = []
for (let r = 0; r < 9; r++) HOUSES.push(Array.from({ length: 9 }, (_, c) => r * 9 + c))
for (let c = 0; c < 9; c++) HOUSES.push(Array.from({ length: 9 }, (_, r) => r * 9 + c))
for (let b = 0; b < 9; b++) {
  const cells = []
  for (let d = 0; d < 9; d++) cells.push((Math.floor(b / 3) * 3 + Math.floor(d / 3)) * 9 + (b % 3) * 3 + (d % 3))
  HOUSES.push(cells)
}
const popcount = (m) => {
  let c = 0
  while (m) {
    m &= m - 1
    c++
  }
  return c
}

// Opening width: how many cells are solvable on the untouched grid via a
// naked or hidden single. Evil requires <=4 (NYT-style tight opening); pure
// function of the grid, so it costs no draws from the seeded rng.
function openingWidth(b) {
  const rowM = Array(9).fill(0)
  const colM = Array(9).fill(0)
  const boxM = Array(9).fill(0)
  for (let i = 0; i < 81; i++)
    if (b[i]) {
      const m = 1 << (b[i] - 1)
      rowM[Math.floor(i / 9)] |= m
      colM[i % 9] |= m
      boxM[Math.floor(i / 27) * 3 + Math.floor((i % 9) / 3)] |= m
    }
  const cands = Array.from({ length: 81 }, (_, i) =>
    b[i] ? 0 : 0x1ff & ~(rowM[Math.floor(i / 9)] | colM[i % 9] | boxM[Math.floor(i / 27) * 3 + Math.floor((i % 9) / 3)])
  )
  const found = new Set()
  for (let i = 0; i < 81; i++) if (!b[i] && popcount(cands[i]) === 1) found.add(i)
  for (const house of HOUSES) {
    for (let d = 1; d <= 9; d++) {
      const m = 1 << (d - 1)
      let spot = -1
      let n = 0
      for (const i of house) if (!b[i] && cands[i] & m) { spot = i; n++ }
      if (n === 1) found.add(spot)
    }
  }
  return found.size
}

// websudoku Easy sits at 34-36 givens but qqwing stops removing around 28-29,
// so fill symmetric pairs (centre last, for parity) back in from the solution
function padGivens(givens, solution, target) {
  let count = 81 - givens.filter((v) => v === 0).length
  while (count < target - 1) {
    const i = Math.floor(Math.random() * 81)
    if (i === 40 || givens[i] !== 0) continue
    givens[i] = solution[i]
    givens[80 - i] = solution[80 - i]
    count += 2
  }
  if (count < target && givens[40] === 0) givens[40] = solution[40]
}

// One generation attempt; returns null when the puzzle misses the level's band
function tryGenerate(level, wantPairs) {
  const qq = new qqwing()
  qq.setRecordHistory(true)
  qq.setPrintStyle(qqwing.PrintStyle.ONE_LINE)
  // Evil digs without symmetry: individual-cell removal is what makes every
  // grid minimal (symmetric pair-removal strands redundant givens)
  qq.generatePuzzleSymmetry(level === 'expert' ? qqwing.Symmetry.NONE : qqwing.Symmetry.ROTATE180)
  const givens = parseGrid(qq.getPuzzleString())
  qq.solve()
  const solution = parseGrid(qq.getSolutionString())
  const clues = qq.getGivenCount()
  const tier = qq.getDifficulty() // 1 Simple, 2 Easy, 3 Intermediate, 4 Expert (guessing)
  const hiddenSingles = qq.getHiddenSingleCount()
  const pairs =
    qq.getNakedPairCount() +
    qq.getHiddenPairCount() +
    qq.getPointingPairTripleCount() +
    qq.getBoxLineReductionCount()

  let ok
  if (level === 'easy') ok = tier === qqwing.Difficulty.SIMPLE
  else if (level === 'medium') ok = tier <= qqwing.Difficulty.EASY && clues >= 28 && clues <= 31
  else if (level === 'hard')
    ok =
      clues >= 26 &&
      clues <= 28 &&
      (wantPairs
        ? tier === qqwing.Difficulty.INTERMEDIATE && pairs >= 2 && pairs <= 6
        : tier === qqwing.Difficulty.EASY && hiddenSingles >= 6)
  // expert = Evil, NYT-style (see header): minimal comes free from
  // Symmetry.NONE, so the acceptance only has to gate difficulty, clue count
  // and the tight opening. openingWidth last — it's the only non-free check.
  else
    ok =
      tier === qqwing.Difficulty.INTERMEDIATE &&
      clues <= 26 &&
      pairs >= 3 &&
      openingWidth(givens) <= 4

  if (!ok) return null
  if (level === 'easy') padGivens(givens, solution, 35)
  return { givens, solution }
}

// The retry loop runs in short synchronous batches with the seeded PRNG
// swapped into Math.random only while a batch executes, so nothing else can
// consume (or pollute) the deterministic sequence; yielding between batches
// keeps the UI responsive on slow devices.
export async function generatePuzzle(level, number) {
  if (level === 'beyond') {
    // dynamic import so the bank ships as its own precached chunk, loaded on
    // first Beyond Evil deal rather than bloating the main bundle
    const { default: bank } = await import('./beyond-bank.js')
    const givens = parseGrid(bank[(number - 1) % bank.length])
    const qq = new qqwing()
    qq.setPrintStyle(qqwing.PrintStyle.ONE_LINE)
    qq.setPuzzle(givens)
    qq.solve()
    return { givens, solution: parseGrid(qq.getSolutionString()) }
  }
  const rng = mulberry32(seedFor(level, number))
  // 40% of Hard numbers demand a pair-technique puzzle (live site: ~1/3, so
  // the clone skews harder); drawn from the seeded rng so it's baked into the
  // number. Only hard consumes this draw - easy/medium numbering predates it.
  const wantPairs = level === 'hard' && rng() < 0.4
  const native = Math.random
  for (let tries = 0; tries < 3000; ) {
    Math.random = rng
    try {
      for (const end = tries + 8; tries < end; tries++) {
        const result = tryGenerate(level, wantPairs)
        if (result) return result
      }
    } finally {
      Math.random = native
    }
    await new Promise((r) => setTimeout(r))
  }
  throw new Error(`no ${level} puzzle found for number ${number}`) // unreachable in practice
}

// Real puzzle generation with reproducible numbers, built on qqwing.
//
// Difficulty bands were calibrated empirically (July 2026) by grading live
// websudoku.com puzzles with qqwing's technique counters (6+ per level, then
// re-tuned against 12/level — the re-tune renumbered Hard and Evil):
//
//   websudoku Easy    34-36 givens  naked singles only              (qqwing Simple)
//   websudoku Medium  28-32 givens  singles + a few hidden singles  (Simple/Easy)
//   websudoku Hard    26-28 givens  ~2/3 hidden-single heavy, ~1/3 need pairs (1-6 steps)
//   websudoku Evil    24-26 givens  pair-technique heavy (avg ~4 steps), never guessing
//
// Hard's singles/pairs split is decided per puzzle number by the seeded rng,
// matching the live site's observed mix; Evil demands >=3 pair-type steps
// (live average 3.9). Both stay in qqwing Intermediate at most - Expert
// (guessing required) is never used.
//
// Every observed websudoku puzzle was 180°-rotationally symmetric with a
// unique solution, so generation uses ROTATE180 (qqwing guarantees the unique
// solution). qqwing naturally emits 24-31 givens, so Easy pads the grid back
// up with symmetric pairs of solution digits — adding givens can only remove
// required techniques, never add them.
//
// Reproducibility: qqwing's sole entropy source is Math.random (no Date, no
// sort), so running the whole generate-and-grade loop under a seeded PRNG
// yields the identical puzzle for a given (level, number). Keep qqwing pinned
// at an exact version or every numbered puzzle changes.

import qqwing from 'qqwing'

export const MAX_PUZZLE_NUMBER = 9_999_999_999

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
  qq.generatePuzzleSymmetry(qqwing.Symmetry.ROTATE180)
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
        ? tier === qqwing.Difficulty.INTERMEDIATE && pairs <= 6
        : tier === qqwing.Difficulty.EASY && hiddenSingles >= 6)
  // expert = websudoku Evil; >=3 pair steps matches the live site's average
  else ok = tier === qqwing.Difficulty.INTERMEDIATE && clues >= 24 && clues <= 26 && pairs >= 3

  if (!ok) return null
  if (level === 'easy') padGivens(givens, solution, 35)
  return { givens, solution }
}

// The retry loop runs in short synchronous batches with the seeded PRNG
// swapped into Math.random only while a batch executes, so nothing else can
// consume (or pollute) the deterministic sequence; yielding between batches
// keeps the UI responsive on slow devices.
export async function generatePuzzle(level, number) {
  const rng = mulberry32(seedFor(level, number))
  // a third of Hard numbers demand a pair-technique puzzle (the live site's
  // observed mix); drawn from the seeded rng so it's baked into the number.
  // Only hard consumes this draw - easy/medium numbering predates it.
  const wantPairs = level === 'hard' && rng() < 1 / 3
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

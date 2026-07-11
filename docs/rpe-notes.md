# Reward-prediction-error mechanics

Why this game has a shimmer and a variable win screen, what the tuning knobs are,
and — importantly — what was deliberately *not* built. Read this before touching
`GLINT_P` / `JACKPOT_P` or the win reveal.

## The goal, corrected

The ask was "make it more addictive by introducing reward prediction error." The
naive reading — add points/badges whose delivery is unpredictable — is the one
thing the literature says to avoid here:

- **Overjustification.** Bolting an external reward onto an activity someone
  *already* finds intrinsically motivating erodes that motivation, and removing
  the reward later drops engagement *below* baseline (Deci, Koestner & Ryan 1999,
  128-study meta-analysis). Roger already loves solving these.
- **Gamification meta-analyses** find points/badges/leaderboards move *extrinsic*
  motivation far more than intrinsic, with near-zero effect on actual competence.
  Guidance: use them to start *new* behaviours, not to reward loved ones.

So the mechanic is not a token. It is **information**. Resolving uncertainty is
itself rewarding, and non-instrumental information carries value the dopamine
system encodes as an *information prediction error* (Scientific Reports 2018).
"Did I place that right?" is genuine, felt uncertainty in sudoku; feeding it a
probabilistic, truthful reveal amplifies the mastery drive instead of replacing
it. That sidesteps overjustification by construction.

## The neuroscience that constrains the design

- **RPE = surprise × magnitude.** The phasic dopamine response at an outcome
  scales with how *unpredicted* it was; a rare hit beats an expected one
  (Fiorillo & Schultz 2003, *Science*).
- **Two exploitable moments, one anticipation signal.** Fiorillo & Schultz also
  found a *sustained* ramp during the gap between a cue and a possible reward,
  maximal at **p = 0.5** — a pure uncertainty signal. So there are two levers:
  the anticipation interval (the "something's coming" gap) and the outcome
  (the reveal).
- **You cannot get an RPE from your own action, only from its evaluation.** A
  placement is self-generated and fully self-predicted; rewarding raw placements
  is dead on arrival (and trains guessing). The error must attach to an
  evaluation whose timing/outcome the *game* controls.

## What was built

### 1. The glint (core loop) — `src/main.js`, "reward mechanics" section

Completing a row/column/box that is **genuinely all-correct** sometimes reveals
that fact with a brief shimmer behind the digits.

- **Probabilistic** — only ~`GLINT_P` of the 27 houses are "charmed," so no single
  completion is predictable; the prediction error stays alive all game.
- **Truth-gated** — a glint *only* ever fires on a correct house. This is
  load-bearing, not decorative: it keeps the signal a *competence* signal. A
  flash that could fire on a wrong cell decouples the signal from reality, and
  the brain correctly relearns it as noise. It also means silence is weak
  evidence, so the mechanic never becomes a correctness oracle that trivialises
  the hard levels — the reveal is worth most exactly mid-Evil, where confidence
  dips, so it self-scales to difficulty for free.
- **Anticipation beat** — `GLINT_DELAY` ms between the completing keystroke and
  the shimmer. That gap is the manufactured anticipation interval (the software
  analogue of slot reels decelerating), not just latency.
- **Seed-derived charmed set** — `deriveCharmed()` hashes the *solution*, so the
  charmed houses are a deterministic function of the puzzle. Consequences: fixed
  per puzzle number (fits the numbering contract), reproducible, survives
  reloads, works identically for bank puzzles, and **can't be farmed** by
  clearing and refilling. `glinted[]` additionally fires each house at most once.
- **Jackpot** — a rare `JACKPOT_P` of charmed houses sweep the whole board
  (rippling out from the completed house) instead of a single-house shimmer. This
  is the magnitude variance: RPE buys surprise on the magnitude axis too, and a
  fat tail habituates slower than a flat 1-in-N.

### 2. Variable win reveal — `winReveal()` in `src/main.js`

The win screen was a fixed "Congratulations." Now it shows one true,
unpredictable-until-now line: the delta under a new personal best, or a
**near-miss** ("just 8 seconds off your best") — the single most potent
slot-machine trick, here *earned and real*. Plus a rare jackpot line, **"solved
blind — you never checked once,"** which also quietly rewards not leaning on the
check button. This is where magnitude × surprise is largest and the information
is genuinely valuable (stats are kept).

### 3. Blind-pace option — `settings.blindPace`

Hides the running timer and reveals it only on the win screen, turning the whole
solve into one long anticipation interval with a reveal (the cleanest use of the
p = 0.5 ramp). Off by default.

### 4. Sound effects — `src/sound.js`

Synthesized with the Web Audio API, no audio files — so there's nothing to
license, ship, or precache, it works offline by construction, and every sound is
a tunable line of code (same ethos as the programmatic icon encoder). The palette
mirrors the visual structure, because audio-visual synchrony is multiplicative —
a chime landing *with* the glint beats either alone.

- **Placement** — a soft tone whose pitch tracks the **digit** on a major
  pentatonic (always consonant, whatever order the digits land in). The digit is
  self-known, so it leaks nothing to a blind solver, but the pitch variety keeps
  the most-repeated sound from saturating into wallpaper — the audio version of
  the habituation problem.
- **Glint / jackpot** — bright ascending chime / longer flourish, fired from
  inside `runGlint`, so they land in sync with the shimmer after the anticipation
  beat, and are truth-gated for free (only correct completions reach `runGlint`).
- **Win** — a resolved major fanfare, with a higher sparkle on a personal best.
- **Check finds mistakes** — a gentle descending, muted "wrong": honest negative
  feedback, deliberately kept out of the placement path so not-checking keeps its
  purity (placement never sounds different for a wrong digit).
- **Pencil / clear** — distinct softer ticks so the two input modes feel apart.

Master gain is ~0.25 (quiet by default). One toggle, `settings.sound` (on).

## Tuning knobs

| knob | value | meaning |
| --- | --- | --- |
| `GLINT_P` | 0.4 | fraction of 27 houses that can glint (~11/puzzle) → ~0.4 felt hit-rate |
| `JACKPOT_P` | 0.01 | of charmed houses, the rare board-sweep fraction (~1 in 10 puzzles has one) |
| `GLINT_DELAY` | 180 ms | anticipation beat before the reveal |
| `--glint` (CSS) | box-border purple | shimmer colour, per theme; peak opacity 0.4 in `@keyframes glint` |

**Why ~0.4 and not 0.5.** Theory says 0.5 maximises both outcome-surprise
variance and the anticipation ramp, but an *expected* reward that's omitted
produces a negative dip, so at 0.5 half of completions end in a small
disappointment. ~0.4 makes misses milder and hits more special, and buys the
rest of the surprise on the magnitude axis (the jackpot) instead.

## Deliberately NOT built

Points, XP, currencies, streak counters, and any visible progress-toward-reward
meter. A visible meter makes the reward *predicted*, which by the very mechanism
destroys the error you want — and it is the most fidelity-breaking thing that
could go on this page.

## The ethical line ("not in a bad way")

Variable-ratio + near-miss *is* the gambling / loot-box machinery. The structural
difference that keeps this clean: gambling **decouples** the uncertain reward from
competence (the box opens the same whether you played well or badly), which is
what makes it exploitative and, eventually, hollow. Every mechanic here **couples**
the uncertainty to a true competence signal — the glint only fires on correct
houses, the PB delta is your real time, the "blind" line reflects real restraint.
Truth-gating is the whole ethical and functional load.

## How to test whether it works

Honest prior: this is the same mechanism behind crit hits and game "juice" — the
effect is real but *modest*. It will not turn sudoku into a compulsion. Knowing
the odds doesn't defeat it (the circuitry is largely model-free; slot players
know the RTP). The test is behavioural and cheap: play a week with
`checkAsYouType` **off** (constant confirmation is the anti-mechanism — it
collapses the uncertainty the glint feeds on) and see whether your hand feels the
pull. Everything is behind `settings.glints` / `settings.blindPace` for A/B.

## Sources

- Fiorillo & Schultz 2003, *Science* — dopamine reward-probability + uncertainty ramp (peak p=0.5).
- Deci, Koestner & Ryan 1999 — overjustification meta-analysis.
- *Scientific Reports* 2018 — information prediction errors / non-instrumental information as reward.
- Gamification meta-analyses (extrinsic ≫ intrinsic, minimal competence effect).
- Denoo et al., CHI 2021 — dark patterns / simulated gambling in games.

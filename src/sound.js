// Synthesized sound effects — no audio files, so nothing to license, ship, or
// precache; it's pure Web Audio math and works offline by construction (matches
// the project's generate-assets-in-code ethos, like scripts/make-icons.mjs).
//
// The palette mirrors the reward-prediction-error design (docs/rpe-notes.md):
// routine actions get subtle, PITCH-VARIED feedback so they don't saturate into
// wallpaper; the uncertain/informative moments (glint, jackpot, win) get the
// salient chimes, fired in sync with their visuals. Placement pitch tracks the
// DIGIT, never correctness, so it leaks nothing to a blind solver.

let ctx = null
let master = null
let enabled = true

export function setSoundEnabled(on) {
  enabled = on
  if (on) ensure() // arm the context on the enabling click (a user gesture)
}

// The AudioContext must be created/resumed inside a user gesture (iOS especially).
// Every caller is triggered by a keypress/click, or fires just after one (the
// glint/win land shortly after a placement), by which point it's already running.
function ensure() {
  if (!enabled) return null
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    ctx = new AC()
    master = ctx.createGain()
    master.gain.value = 0.25 // keep the whole thing quiet and tasteful
    master.connect(ctx.destination)
  }
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

// One enveloped oscillator note. start/dur/release in seconds, relative to now.
function note(freq, start, dur, { type = 'sine', gain = 1, attack = 0.005 } = {}) {
  const t0 = ctx.currentTime + start
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur) // exp can't hit 0
  osc.connect(g)
  g.connect(master)
  osc.start(t0)
  osc.stop(t0 + dur + 0.03)
  osc.onended = () => {
    osc.disconnect()
    g.disconnect()
  }
}
const chord = (freqs, start, dur, opts) => freqs.forEach((f) => note(f, start, dur, opts))

// Major pentatonic (always consonant, whatever order the digits land in), so the
// most-repeated sound stays musical instead of a single saturating click.
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19] // 9 scale steps, in semitones from C4
const C4 = 261.63
const digitFreq = (d) => C4 * 2 ** (PENTA[(d - 1) % 9] / 12)

// --- routine actions: subtle, varied ---

export function playPlace(digit) {
  if (!ensure()) return
  note(digitFreq(digit), 0, 0.12, { type: 'triangle', gain: 0.45, attack: 0.004 })
}
export function playPencil() {
  if (!ensure()) return
  note(1318.51, 0, 0.05, { type: 'sine', gain: 0.18 }) // light high tick, distinct from a commit
}
export function playClear() {
  if (!ensure()) return
  note(196, 0, 0.09, { type: 'triangle', gain: 0.3 }) // low thunk
}

// --- the reward moments: salient, synchronized with their visuals ---

// charmed-house glint: a bright ascending triad+octave, lands with the shimmer
export function playGlint() {
  if (!ensure()) return
  ;[523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
    note(f, i * 0.05, 0.22, { type: 'triangle', gain: 0.4, attack: 0.004 })
  )
}
// jackpot sweep: a longer ascending run + a sparkle tail (the magnitude fat tail)
export function playJackpot() {
  if (!ensure()) return
  ;[523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51].forEach((f, i) =>
    note(f, i * 0.06, 0.28, { type: 'triangle', gain: 0.36 })
  )
  note(1567.98, 0.48, 0.5, { type: 'sine', gain: 0.24 })
}
// win: a resolved major fanfare; a personal best adds a higher sparkle
export function playWin(record) {
  if (!ensure()) return
  ;[
    [523.25, 0],
    [659.25, 0.09],
    [783.99, 0.18],
    [1046.5, 0.3],
  ].forEach(([f, t]) => note(f, t, 0.5, { type: 'triangle', gain: 0.42 }))
  chord([523.25, 783.99], 0.3, 0.9, { type: 'sine', gain: 0.2 }) // held resolving chord
  if (record) {
    note(1318.51, 0.45, 0.6, { type: 'triangle', gain: 0.3 })
    note(1567.98, 0.6, 0.7, { type: 'sine', gain: 0.25 })
  }
}
// mistakes on an explicit check: gentle descending, muted — honest, not punishing
export function playError() {
  if (!ensure()) return
  note(392, 0, 0.16, { type: 'sine', gain: 0.32 })
  note(311.13, 0.12, 0.22, { type: 'sine', gain: 0.32 })
}

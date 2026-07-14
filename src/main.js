import './style.css'
import { generatePuzzle, maxPuzzleNumber } from './generator.js'
import * as sfx from './sound.js'
import * as ambient from './ambient.js'
import * as thumb from './thumbpad.js'
import { registerSW } from 'virtual:pwa-register'

registerSW({ immediate: true })

const LEVELS = [
  { key: 'easy', label: 'Easy' },
  { key: 'medium', label: 'Medium' },
  { key: 'hard', label: 'Hard' },
  { key: 'expert', label: 'Evil' },
  { key: 'beyond', label: 'Beyond Evil' },
]

// Message texts lifted from the original page's JS variables (m_d, m_c, m_m, m_w, m_i)
const MSG_DEAL = 'Here is the puzzle. Good luck!'
const MSG_CLEAR = 'Back to the start, we go!'
const MSG_MISTAKES = 'You made some mistakes, highlighted in red!'
const MSG_WRONG_COUNT = 'Something is not quite right in * of the cells!'
const MSG_OK = 'Everything is OK, still * to go!'

// --- Reward-prediction-error mechanics (see docs/rpe-notes.md) ---
// A "glint": completing a row/column/box that is genuinely all-correct
// sometimes reveals that fact with a brief shimmer. The reveal is probabilistic
// (unpredictable per completion) and truth-gated (a glint always means those 9
// cells are right), so it generates an information-prediction error rather than
// a hollow token. Charmed houses are derived from the puzzle solution, so
// they're fixed per puzzle number and can't be re-rolled by clearing.
const GLINT_P = 0.4 // fraction of the 27 houses that can glint (~11/puzzle, ~0.4 felt hit-rate)
const JACKPOT_P = 0.01 // of charmed houses, the rare few whose glint sweeps the board (~1 in 10 puzzles)
const GLINT_DELAY = 180 // ms of anticipation between the completing keystroke and the reveal

const $ = (id) => document.getElementById(id)

function readStore(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}
const writeStore = (key, value) => localStorage.setItem(key, JSON.stringify(value))

const storedSettings = readStore('websudoku:settings', {})
const settings = Object.assign(
  {
    theme: 'auto', // 'light' | 'dark' | 'auto' (follow the system)
    autoLight: 'light', // theme auto resolves to when the system is light
    autoDark: 'dark', // theme auto resolves to when the system is dark
    showTimer: true,
    allowPencilMarks: true,
    highlightWrong: true,
    checkAsYouType: false,
    touchControls: matchMedia('(pointer: coarse)').matches ? 'thumbpad' : 'none', // 'thumbpad' | 'keypad' | 'none'
    keypadPencil: false,
    boardOnly: false, // "Just the puzzle" mode: chrome hidden, scroll locked
    glints: true, // subtle shimmer on a completed row/column/box (the RPE mechanic)
    blindPace: false, // hide the running timer, reveal it only on the win screen
    sound: true, // synthesized sound effects (src/sound.js)
    ambient: false, // generative city-drive canvas (or /ambient.mp4) behind the game
    ambientYouTube: '', // 11-char YouTube id; outranks canvas/mp4 while online
  },
  storedSettings
)
// pre-auto settings stored a boolean; those installs restart on auto
if (typeof settings.darkTheme === 'boolean') {
  settings.theme = 'auto'
  delete settings.darkTheme
}
// pre-thumb-pad settings stored a keypad boolean: keypad-on-touch installs move
// to the thumb pad (the new default touch control), keypad-on-desktop keeps it
if (!('touchControls' in storedSettings) && typeof settings.showKeypad === 'boolean') {
  settings.touchControls = !settings.showKeypad
    ? 'none'
    : matchMedia('(pointer: coarse)').matches
      ? 'thumbpad'
      : 'keypad'
}
delete settings.showKeypad
if (!['thumbpad', 'keypad', 'none'].includes(settings.touchControls)) settings.touchControls = 'none'

// Theme keys must match the html[data-theme=...] blocks in style.css;
// DARK_THEMES also mirrors the :is() dark-family selector lists there.
const LIGHT_THEMES = ['light', 'sage', 'sky', 'sepia', 'lavender', 'blush']
const DARK_THEMES = ['dark', 'midnight', 'forest', 'ember']
if (settings.theme !== 'auto' && !LIGHT_THEMES.includes(settings.theme) && !DARK_THEMES.includes(settings.theme)) {
  settings.theme = 'auto' // a removed/renamed theme key falls back to auto
}
if (!LIGHT_THEMES.includes(settings.autoLight)) settings.autoLight = 'light'
if (!DARK_THEMES.includes(settings.autoDark)) settings.autoDark = 'dark'
if (typeof settings.ambientYouTube !== 'string') settings.ambientYouTube = ''

const systemDark = matchMedia('(prefers-color-scheme: dark)')
// auto follows the OS between a chosen day/night pair (classic pair by default);
// anything else is literal
const resolvedTheme = () =>
  settings.theme === 'auto' ? (systemDark.matches ? settings.autoDark : settings.autoLight) : settings.theme

let stats = Object.assign(
  Object.fromEntries(LEVELS.map((l) => [l.key, { wins: 0, fastest: null }])),
  readStore('websudoku:stats', {})
)

const game = {
  level: 'easy',
  number: 0, // seeds the generator, so "Hard Puzzle 9,778,545,666" is reproducible
  givens: [], // 81 digits, 0 = empty
  solution: [], // 81 digits
  entries: [], // 81 strings: '' or a single committed digit
  marks: [], // 81 strings of pencil-mark candidate digits, e.g. '125'
  err: [], // 81 red levels 0-3
  done: false,
  paused: false,
  elapsedBase: 0,
  runningSince: null,
  charmed: [], // 27 houses (9 rows, 9 cols, 9 boxes): which are allowed to glint
  jackpot: [], // of the charmed houses, which sweep the whole board
  glinted: [], // charmed houses already revealed this puzzle (consume-once, anti-farm)
  usedCheck: false, // pressed "How am I doing?" — gates the "solved blind" reveal
}

const inputs = []
const tds = []
const pmSpans = [] // per cell: 9 spans forming the 3x3 pencil-mark mini-grid
const pms = []
const glows = [] // per cell: the shimmer overlay div behind the digit
let selected = -1
let pencilMode = settings.keypadPencil
let pencilKey = null
let recordLevel = null
let tickId = null

/* ---------- reward mechanics: charmed houses & glints ---------- */

// local mulberry32 (generator.js keeps its own; this one seeds the charmed set)
function mulberry32(seed) {
  return () => {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const hashStr = (s) => {
  let h = 0x811c9dc5 >>> 0
  for (let k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), 0x01000193) >>> 0
  return h >>> 0
}

// The 9 cell indices of house h: 0-8 rows, 9-17 columns, 18-26 boxes
function houseCells(h) {
  const cells = []
  if (h < 9) for (let c = 0; c < 9; c++) cells.push(h * 9 + c)
  else if (h < 18) for (let r = 0; r < 9; r++) cells.push(r * 9 + (h - 9))
  else {
    const b = h - 18
    const br = Math.floor(b / 3) * 3
    const bc = (b % 3) * 3
    for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) cells.push((br + dr) * 9 + bc + dc)
  }
  return cells
}
// The three houses (row, column, box) that contain cell i
const housesOfCell = (i) => {
  const r = Math.floor(i / 9)
  const c = i % 9
  return [r, 9 + c, 18 + Math.floor(r / 3) * 3 + Math.floor(c / 3)]
}
// Is every cell of house h filled with the correct digit? (givens count as correct)
function houseCorrect(h) {
  for (const j of houseCells(h)) {
    if (game.givens[j] !== 0) continue
    if (game.entries[j] === '' || +game.entries[j] !== game.solution[j]) return false
  }
  return true
}
// The charmed set is a deterministic function of the solution, so a given
// puzzle number always has the same charmed houses (fits the numbering
// contract), it survives reloads, and it can't be re-rolled by clearing cells.
function deriveCharmed(solution) {
  const rng = mulberry32(hashStr(solution))
  const charmed = Array(27).fill(false)
  const jackpot = Array(27).fill(false)
  for (let h = 0; h < 27; h++) {
    charmed[h] = rng() < GLINT_P
    const jr = rng()
    jackpot[h] = charmed[h] && jr < JACKPOT_P
  }
  return { charmed, jackpot }
}

// On a correct placement, glint any charmed house that just became complete.
// glinted[] makes each house fire at most once per puzzle.
function maybeGlint(i) {
  if (!settings.glints) return
  for (const h of housesOfCell(i)) {
    if (!game.charmed[h] || game.glinted[h] || !houseCorrect(h)) continue
    game.glinted[h] = true
    // the short delay is a manufactured anticipation beat, not just latency
    setTimeout(() => runGlint(h), GLINT_DELAY)
  }
}
function runGlint(h) {
  const cells = houseCells(h)
  if (game.jackpot[h]) sfx.playJackpot()
  else sfx.playGlint()
  if (game.jackpot[h]) {
    // rare board-wide sweep, rippling out from the completed house
    let sr = 0
    let sc = 0
    for (const j of cells) {
      sr += Math.floor(j / 9)
      sc += j % 9
    }
    const cr = sr / 9
    const cc = sc / 9
    for (let j = 0; j < 81; j++) {
      const d = Math.abs(Math.floor(j / 9) - cr) + Math.abs((j % 9) - cc)
      animateGlow(j, Math.round(d * 30))
    }
  } else {
    for (const j of cells) animateGlow(j)
  }
}
function animateGlow(i, delay = 0) {
  const g = glows[i]
  g.style.animationDelay = delay ? `${delay}ms` : ''
  g.classList.remove('on')
  void g.offsetWidth // reflow so the animation retriggers on a repeat glint
  g.classList.add('on')
  g.addEventListener(
    'animationend',
    () => {
      g.classList.remove('on')
      g.style.animationDelay = ''
    },
    { once: true }
  )
}

/* ---------- grid ---------- */

// Border scheme from the original CSS: e/g/i = thick left (box edge),
// f/g = thick top, h/i = thick bottom; the table supplies the right edge.
function letterFor(row, col) {
  const boxLeft = col % 3 === 0
  if (row === 8) return boxLeft ? 'i' : 'h'
  if (row % 3 === 0) return boxLeft ? 'g' : 'f'
  return boxLeft ? 'e' : 'c'
}

function buildGrid() {
  const tbody = $('puzzle_grid').tBodies[0]
  for (let row = 0; row < 9; row++) {
    const tr = tbody.insertRow()
    for (let col = 0; col < 9; col++) {
      const i = row * 9 + col
      const td = tr.insertCell()
      td.id = `c${col}${row}` // original ids are column-first
      const glow = document.createElement('div') // shimmer overlay, behind the digit
      glow.className = 'glow'
      td.appendChild(glow)
      const input = document.createElement('input')
      input.type = 'text'
      input.id = `f${col}${row}`
      input.size = 2
      input.maxLength = 1
      input.autocomplete = 'off'
      input.spellcheck = false
      input.setAttribute('inputmode', 'none') // side keys on touch, like the original
      input.addEventListener('focus', () => {
        selected = i
        thumb.setSelected(i) // the thumb pad's mini-map mirrors the selection
        // iOS paints select() as a blue text-selection highlight on the digit;
        // touch never needs it (entry comes from the pads, not the keyboard)
        if (!matchMedia('(pointer: coarse)').matches) input.select()
      })
      input.addEventListener('input', () => onCellInput(i))
      td.addEventListener('click', () => {
        input.focus({ preventScroll: true })
        // the thumb pad follows taps on the real board too: an editable cell
        // opens the digit pad, a given (nothing to enter) drops back to the map
        if (settings.touchControls === 'thumbpad') {
          if (!game.done && game.givens[i] === 0) thumb.showPad()
          else thumb.showMap()
        }
      })
      td.appendChild(input)
      const pm = document.createElement('div')
      pm.className = 'pm'
      const spans = []
      for (let d = 1; d <= 9; d++) spans.push(pm.appendChild(document.createElement('span')))
      td.appendChild(pm)
      tds.push(td)
      inputs.push(input)
      pms.push(pm)
      pmSpans.push(spans)
      glows.push(glow)
    }
  }

  // touch only: long-pressing a cell must not pop a context menu (desktop right-click stays)
  $('puzzle_grid').addEventListener('contextmenu', (e) => {
    if (matchMedia('(pointer: coarse)').matches) e.preventDefault()
  })

  $('puzzle_grid').addEventListener('keydown', (e) => {
    const i = inputs.indexOf(e.target)
    if (i < 0) return
    if (e.metaKey || e.ctrlKey || e.altKey) return

    if (e.key === ' ') {
      e.preventDefault() // Space is the pencil-mark modifier, not a character
      spaceHeld = true
      return
    }

    if (e.key === 'Enter') {
      check()
      return
    }

    if (e.key === 'Escape') {
      inputs[i].blur() // hide the selection box; WASD/arrows bring it back
      return
    }

    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault()
      setBoardOnly(!settings.boardOnly)
      return
    }

    // Hold Space (or Shift) + digit toggles that digit as a pencil mark
    const digit = digitFromCode(e.code)
    if (digit && (spaceHeld || e.shiftKey)) {
      e.preventDefault()
      togglePencilDigit(i, digit)
      return
    }

    if (digit) {
      e.preventDefault()
      // typing a cell's current digit again clears it, like the keypad
      if (!game.done && game.givens[i] === 0) setEntry(i, game.entries[i] === digit ? '' : digit)
      return
    }

    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault()
      clearCell(i)
      return
    }

    const delta = MOVE_KEYS[e.key.toLowerCase()]
    if (delta !== undefined) {
      e.preventDefault()
      const row = Math.floor(i / 9)
      const col = i % 9
      const inBounds =
        delta === -9 ? row > 0 : delta === 9 ? row < 8 : delta === -1 ? col > 0 : col < 8
      if (inBounds) {
        inputs[i + delta].focus({ preventScroll: true })
        sfx.playStep() // footstep-style tap on each move
      }
    }
  })

  document.addEventListener('keyup', (e) => {
    if (e.key === ' ') spaceHeld = false
  })
  window.addEventListener('blur', () => {
    spaceHeld = false
  })

  // With no cell selected, a movement key re-summons the selection box where
  // it was left (center cell on a fresh puzzle) without moving it
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (MOVE_KEYS[e.key.toLowerCase()] === undefined) return
    if (gridHasFocus()) return // the grid handler owns movement
    if (menuShown() || $('overlay').classList.contains('shown') || optionsShown()) return
    const t = e.target
    if (t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return
    e.preventDefault()
    inputs[selected >= 0 ? selected : 40].focus({ preventScroll: true })
    sfx.playStep()
  })
}

const gridHasFocus = () => inputs.includes(document.activeElement)

// Arrows and WASD both navigate the grid
const MOVE_KEYS = {
  arrowup: -9,
  w: -9,
  arrowdown: 9,
  s: 9,
  arrowleft: -1,
  a: -1,
  arrowright: 1,
  d: 1,
}

// e.code so the physical 1-9 keys work regardless of Shift (which shifts e.key to !@#…)
const digitFromCode = (code) => (/^(Digit|Numpad)[1-9]$/.test(code) ? code.slice(-1) : null)

let spaceHeld = false

function paint(i) {
  const lvl = game.err[i]
  const given = game.givens[i] !== 0
  const value = given ? String(game.givens[i]) : game.entries[i]
  tds[i].className = letterFor(Math.floor(i / 9), i % 9) + lvl
  inputs[i].className = (given ? 's' : 'd') + lvl
  inputs[i].readOnly = given
  inputs[i].tabIndex = given ? -1 : 0
  if (inputs[i].value !== value) inputs[i].value = value
  const marks = given || value !== '' ? '' : game.marks[i]
  pms[i].style.display = marks ? '' : 'none'
  for (let d = 1; d <= 9; d++) pmSpans[i][d - 1].textContent = marks.includes(d) ? d : ''
  thumb.paintCell(i) // keep the thumb pad's mini-map in sync
}

function paintAll() {
  for (let i = 0; i < 81; i++) paint(i)
}

/* ---------- entering values ---------- */

function onCellInput(i) {
  // fallback for paste/mobile input; typing is handled in keydown
  const v = inputs[i].value.replace(/[^1-9]/g, '').slice(-1)
  setEntry(i, v)
}

function setEntry(i, v) {
  if (game.done || game.givens[i] !== 0) return
  game.entries[i] = v
  if (v !== '') game.marks[i] = '' // an answer replaces the cell's pencil marks
  game.err[i] = settings.checkAsYouType && v !== '' && +v !== game.solution[i] ? 1 : 0
  paint(i)
  if (v !== '') sfx.playPlace(+v) // pitch tracks the digit, not correctness — no leak
  else sfx.playClear()
  if (v !== '' && +v === game.solution[i]) maybeGlint(i) // before saveGame so glinted persists
  saveGame()
  maybeComplete()
}

function clearCell(i) {
  if (game.done || game.givens[i] !== 0) return
  const had = game.entries[i] !== '' || game.marks[i] !== ''
  game.entries[i] = ''
  game.marks[i] = ''
  game.err[i] = 0
  paint(i)
  if (had) sfx.playClear() // stay quiet when clearing an already-empty cell
  saveGame()
}

function applyKey(key, asPencil = false) {
  if (key === 'pencil') {
    setPencilMode(!pencilMode)
    return
  }
  if (game.done) return
  if (selected < 0 || game.givens[selected] !== 0) {
    setMessage('Click a square first, then a key.')
    return
  }
  // touch focus is fragile (overlays, iOS quirks) — the remembered cell still applies
  if (!gridHasFocus()) inputs[selected].focus({ preventScroll: true })
  if (key === 'del') {
    clearCell(selected)
  } else if (asPencil || (pencilMode && settings.allowPencilMarks)) {
    togglePencilDigit(selected, key)
  } else {
    setEntry(selected, game.entries[selected] === key ? '' : key)
  }
}

function togglePencilDigit(i, digit) {
  if (!settings.allowPencilMarks || game.done || game.givens[i] !== 0) return
  game.entries[i] = '' // pencil marks replace a committed answer
  const current = game.marks[i]
  game.marks[i] = current.includes(digit)
    ? current.replaceAll(digit, '')
    : [...(current + digit)].sort().join('')
  game.err[i] = 0
  paint(i)
  sfx.playPencil()
  saveGame()
}

function setPencilMode(on) {
  pencilMode = on
  pencilKey.classList.toggle('active', on)
  $('opt-pencil').checked = on
}

// thumb pad guard: applyKey's fragile-focus dance, minus the pencilMode logic —
// the pad's own gestures decide entry vs mark (tap vs long-press)
function thumbTarget() {
  if (game.done || selected < 0 || game.givens[selected] !== 0) return false
  if (!gridHasFocus()) inputs[selected].focus({ preventScroll: true })
  return true
}

function setBoardOnly(on) {
  settings.boardOnly = on
  writeStore('websudoku:settings', settings)
  applySettings()
  // entering with a stale scroll offset would freeze the page shifted up
  // (overflow:hidden keeps the offset), leaving a page-bg bar at the bottom
  if (on) {
    window.scrollTo(0, 0)
    document.body.scrollTop = 0 // iOS focus-reveal scrolls body separately
  }
}

/* ---------- menu / game states ---------- */

const menuShown = () => document.documentElement.classList.contains('menu')
// game-only: the engine stops on the menu (CSS hides it there too)
const syncAmbient = () => ambient.setActive(!!settings.ambient && !menuShown())

function showMenu() {
  if (generating) return // mid-deal: the new puzzle would land behind a stale menu
  if (game.runningSince != null) {
    game.elapsedBase = currentElapsed() // freeze the clock while on the menu
    game.runningSince = null
  }
  clearInterval(tickId)
  hideOverlay() // #overlay is top-level and would otherwise sit over the menu
  document.documentElement.classList.remove('board-only') // visual only; settings.boardOnly survives for the next game
  saveGame()
  renderContinue()
  renderStats()
  document.documentElement.classList.add('menu')
  syncAmbient()
}

function showGame() {
  document.documentElement.classList.remove('menu')
  document.documentElement.classList.toggle('board-only', !!settings.boardOnly)
  syncAmbient()
  if (game.paused) {
    showPausedUI() // resuming stays an explicit click, like a reload mid-pause
  } else if (!game.done) {
    game.runningSince = performance.now()
    startTicking()
    saveGame()
  }
}

function renderContinue() {
  const row = $('continue-row')
  if (game.givens.length !== 81 || game.done) {
    row.innerHTML = ''
    row.style.display = 'none'
    return
  }
  const label = LEVELS.find((l) => l.key === game.level).label
  const time = settings.blindPace ? '–:–' : fmt(currentElapsed())
  row.style.display = ''
  row.innerHTML = `<a href="#" id="continue-link"><b>Continue</b> &mdash; ${label} Puzzle ${game.number.toLocaleString('en-US')} &middot; ${time}</a>`
  $('continue-link').addEventListener('click', (e) => {
    e.preventDefault()
    if (generating) return // a fresh deal is about to replace this game
    showGame()
  })
}

/* ---------- puzzles ---------- */

let generating = false

async function newPuzzle(level, number = 1 + Math.floor(Math.random() * maxPuzzleNumber(level))) {
  if (generating) return
  generating = true
  setMessage('Selecting a puzzle&hellip;')
  $('menu-msg').textContent = 'Selecting a puzzle…' // dealing from the menu: feedback lives there
  let puzzle
  try {
    puzzle = await generatePuzzle(level, number)
  } finally {
    generating = false
    $('menu-msg').textContent = ''
  }
  selected = -1 // fresh puzzle: movement keys start the selection at the center
  game.level = level
  game.number = number
  game.givens = puzzle.givens
  game.solution = puzzle.solution
  const charm = deriveCharmed(puzzle.solution.join(''))
  game.charmed = charm.charmed
  game.jackpot = charm.jackpot
  game.glinted = Array(27).fill(false)
  game.usedCheck = false
  game.entries = Array(81).fill('')
  game.marks = Array(81).fill('')
  game.err = Array(81).fill(0)
  game.done = false
  game.paused = false
  game.elapsedBase = 0
  game.runningSince = performance.now()
  hideOverlay()
  setMessage(MSG_DEAL)
  $('pause-btn').value = 'Pause'
  $('puzzle_grid').style.visibility = ''
  paintAll()
  thumb.reset() // forget the old selection, land on the map panel
  renderInfo()
  startTicking()
  saveGame()
  // only leave the menu once the new board is painted — dealing straight into
  // the game state briefly showed the previous (or empty) board on slow deals
  document.documentElement.classList.remove('menu')
  document.documentElement.classList.toggle('board-only', !!settings.boardOnly)
  syncAmbient()
}

function saveGame() {
  if (game.givens.length !== 81) return // nothing dealt yet (menu boot) — don't clobber a real save
  writeStore('websudoku:game', {
    level: game.level,
    number: game.number,
    givens: game.givens.join(''),
    solution: game.solution.join(''),
    entries: game.entries,
    marks: game.marks,
    err: game.err,
    glinted: game.glinted,
    usedCheck: game.usedCheck,
    elapsed: currentElapsed(),
    paused: game.paused,
    done: game.done,
  })
}

function restoreGame(saved) {
  game.level = saved.level
  game.number = saved.number || 1 + Math.floor(Math.random() * maxPuzzleNumber(saved.level))
  game.givens = [...saved.givens].map(Number)
  game.solution = [...saved.solution].map(Number)
  // migrate pre-mini-grid saves, where pencil marks were multi-digit entries
  game.entries = saved.entries.map((v) => (v && v.length === 1 ? v : ''))
  game.marks = Array.isArray(saved.marks)
    ? saved.marks
    : saved.entries.map((v) => (v && v.length > 1 ? v : ''))
  game.err = saved.err
  const charm = deriveCharmed(game.solution.join(''))
  game.charmed = charm.charmed
  game.jackpot = charm.jackpot
  // keep houses already glinted, and suppress any already solved on load, so a
  // reload never fires a fresh reward and a solved house can't be re-glinted
  const savedGlinted = Array.isArray(saved.glinted) ? saved.glinted : []
  game.glinted = Array.from({ length: 27 }, (_, h) => !!savedGlinted[h] || (game.charmed[h] && houseCorrect(h)))
  game.usedCheck = !!saved.usedCheck
  game.done = !!saved.done
  game.paused = !!saved.paused && !game.done
  game.elapsedBase = saved.elapsed || 0
  // restore always lands behind the menu's Continue row, clock frozen;
  // showGame() restarts it (re-showing the Paused overlay for a paused save)
  game.runningSince = null
  setMessage(MSG_DEAL)
  paintAll()
  thumb.reset()
  renderInfo()
  renderTimer()
}

function clearPuzzle() {
  if (game.done) return
  game.entries = Array(81).fill('')
  game.marks = Array(81).fill('')
  game.err = Array(81).fill(0)
  paintAll()
  setMessage(MSG_CLEAR, 'green')
  saveGame()
}

/* ---------- timer ---------- */

const currentElapsed = () =>
  game.elapsedBase + (game.runningSince != null ? performance.now() - game.runningSince : 0)

function fmt(ms) {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function startTicking() {
  clearInterval(tickId)
  tickId = setInterval(renderTimer, 500)
  renderTimer()
}

function renderTimer() {
  $('timer-line').style.display = settings.showTimer ? '' : 'none'
  // blind pace: the whole solve is one anticipation interval; reveal only at the win
  const masked = settings.blindPace && !game.done
  $('timer').textContent = masked ? ' –:– ' : ` ${fmt(currentElapsed())} `
}

function showPausedUI() {
  $('pause-btn').value = 'Resume'
  $('puzzle_grid').style.visibility = 'hidden'
  showOverlay('<div class="bigbig">Paused</div><p class="small">Click anywhere to resume</p>')
}

function pauseGame() {
  if (game.done || game.paused) return
  game.elapsedBase = currentElapsed()
  game.runningSince = null
  game.paused = true
  showPausedUI()
  saveGame()
}

function resumeGame() {
  if (!game.paused) return
  game.paused = false
  game.runningSince = performance.now()
  $('pause-btn').value = 'Pause'
  $('puzzle_grid').style.visibility = ''
  hideOverlay()
  saveGame()
}

/* ---------- checking ---------- */

function check() {
  if (game.done) {
    setMessage('Already solved — start a new puzzle!', 'green')
    return
  }
  game.usedCheck = true // leaning on the check button forfeits the "solved blind" reveal
  let wrong = 0
  let remaining = 0
  for (let i = 0; i < 81; i++) {
    if (game.givens[i] !== 0) continue
    const v = game.entries[i]
    const correct = v.length === 1 && +v === game.solution[i]
    if (!correct) remaining++
    if (v.length === 1 && +v !== game.solution[i]) {
      wrong++
      if (settings.highlightWrong) {
        game.err[i] = Math.min(3, game.err[i] + 1) // deeper red on every check, like the original
        paint(i)
      }
    }
  }
  if (wrong) {
    sfx.playError()
    if (settings.highlightWrong) setMessage(MSG_MISTAKES, 'red')
    else setMessage(MSG_WRONG_COUNT.replace('*', wrong), 'purple')
  } else if (remaining) {
    setMessage(MSG_OK.replace('*', remaining), 'blue')
  } else {
    win()
  }
  saveGame()
}

function maybeComplete() {
  if (game.done) return
  for (let i = 0; i < 81; i++) {
    if (game.givens[i] !== 0) continue
    const v = game.entries[i]
    if (v.length !== 1 || +v !== game.solution[i]) return
  }
  win()
}

function win() {
  game.done = true
  game.elapsedBase = currentElapsed()
  game.runningSince = null
  clearInterval(tickId)
  renderTimer()

  const st = stats[game.level]
  const prevBest = st.fastest
  st.wins++
  const record = prevBest == null || game.elapsedBase < prevBest
  if (record) {
    st.fastest = game.elapsedBase
    recordLevel = game.level
  }
  writeStore('websudoku:stats', stats)
  renderStats()
  sfx.playWin(record)

  const label = LEVELS.find((l) => l.key === game.level).label
  const time = fmt(game.elapsedBase)
  setMessage(`Congratulations! You solved the puzzle in ${time}.`, 'green')
  showOverlay(
    `<div class="bigbig">Congratulations!</div>
     <p>You solved this ${label} puzzle in <b>${time}</b>.</p>
     ${winReveal(prevBest, record)}
     <p><input type="button" id="overlay-new" value="New Puzzle"> <input type="button" id="overlay-menu" value="Menu"></p>`
  )
  $('overlay-new').addEventListener('click', () => newPuzzle(game.level))
  $('overlay-menu').addEventListener('click', showMenu) // only path to another level now
  saveGame()
}

// The variable-magnitude payout: one true, unpredictable-until-now line about
// how this solve stacks up. Personal bests and near-misses both carry real
// information (you keep stats), so this feeds the mastery drive instead of
// bolting an arbitrary token onto it. The near-miss is the potent case.
function winReveal(prevBest, record) {
  const label = LEVELS.find((l) => l.key === game.level).label
  const lines = []
  if (record && prevBest != null) {
    lines.push(`<span class="stat fastest">New personal best — ${fmtDelta(prevBest - game.elapsedBase)} under your old ${fmt(prevBest)}!</span>`)
  } else if (record) {
    lines.push('<span class="stat fastest">New personal best!</span>')
  } else {
    const off = game.elapsedBase - prevBest
    if (off <= 30000) lines.push(`So close — just ${fmtDelta(off)} off your best of ${fmt(prevBest)}.`)
    else lines.push(`Your best ${label} time is still ${fmt(prevBest)}.`)
  }
  // the rare, unpredictable jackpot line: solved without ever asking for help
  if (!game.usedCheck && !settings.checkAsYouType) {
    lines.push('<span class="stat fastest">Solved blind — you never checked once.</span>')
  }
  return lines.map((l) => `<p>${l}</p>`).join('')
}
const fmtDelta = (ms) => {
  if (ms >= 60000) return fmt(ms)
  const n = Math.max(1, Math.round(ms / 1000))
  return `${n} second${n === 1 ? '' : 's'}`
}

/* ---------- overlay & dialogs ---------- */

function showOverlay(html, dialog = false) {
  const inner = $('overlay-inner')
  inner.innerHTML = html
  inner.className = dialog ? 'dialog' : ''
  $('overlay').classList.add('shown')
}

const hideOverlay = () => $('overlay').classList.remove('shown')

// Options menu: a modal (like the dialogs), opened from the "Options" link in
// the sidebar footer (or its mobile stand-in row). Controls live in static
// markup so wireOptions/applySettings keep their ids whether it's open or not.
const showOptions = () => $('options-modal').classList.add('shown')
const hideOptions = () => $('options-modal').classList.remove('shown')
const optionsShown = () => $('options-modal').classList.contains('shown')

// Styled like the original's in-page confirm box (c_div)
function confirmDialog(text, onOk) {
  showOverlay(
    `<p>${text}</p>
     <div class="dialog-buttons">
       <input type="button" id="dlg-cancel" value="Cancel">
       <input type="button" id="dlg-ok" value="OK">
     </div>`,
    true
  )
  $('dlg-cancel').addEventListener('click', hideOverlay)
  $('dlg-ok').addEventListener('click', () => {
    hideOverlay()
    onOk()
  })
}

// Puzzle numbers seed the generator, so entering one deals that exact puzzle
function selectPuzzleDialog() {
  showOverlay(
    `<p><b>Select a puzzle</b></p>
     <p class="small">Enter a puzzle number from 1 to ${maxPuzzleNumber(game.level).toLocaleString('en-US')}</p>
     <p><input type="text" id="dlg-number" inputmode="numeric" size="14"></p>
     <div class="dialog-buttons">
       <input type="button" id="dlg-cancel" value="Cancel">
       <input type="button" id="dlg-ok" value="OK">
     </div>`,
    true
  )
  const field = $('dlg-number')
  field.value = String(game.number)
  field.focus()
  field.select()
  const submit = () => {
    const n = Number(field.value.replace(/[^0-9]/g, ''))
    if (n < 1 || n > maxPuzzleNumber(game.level)) return
    hideOverlay()
    newPuzzle(game.level, n)
  }
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit()
  })
  $('dlg-cancel').addEventListener('click', hideOverlay)
  $('dlg-ok').addEventListener('click', submit)
}

/* ---------- chrome ---------- */

function setMessage(text, color = null) {
  $('message').innerHTML = color ? `<span class="msg-${color}"><b>${text}</b></span>` : `<b>${text}</b>`
}

function renderInfo() {
  const label = LEVELS.find((l) => l.key === game.level).label
  $('puzzle-label').textContent = `${label} Puzzle ${game.number.toLocaleString('en-US')}`
}

function renderStats() {
  const rows = LEVELS.map(({ key, label }) => {
    const s = stats[key]
    const best = s.fastest != null ? fmt(s.fastest) : '&ndash;'
    const cls = key === recordLevel ? 'stat fastest' : 'stat'
    return `<tr><td>${label}</td><td class="stat">${s.wins}</td><td class="${cls}">${best}</td></tr>`
  }).join('')
  $('stats-table').innerHTML = `<tr class="small"><td></td><td>Won</td><td>Best</td></tr>${rows}`
}

function buildKeys() {
  const table = document.createElement('table')
  table.addEventListener('contextmenu', (e) => e.preventDefault()) // long-press must not open a menu
  const tbody = table.createTBody()
  for (const key of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '✎']) {
    const td = tbody.insertRow().insertCell()
    td.className = 'tk'
    td.textContent = key
    const action = key === '⌫' ? 'del' : key === '✎' ? 'pencil' : key
    if (action === 'pencil') pencilKey = td
    let pressTimer
    let longPressed = false
    // preventDefault keeps focus on the grid cell so the key applies to it
    td.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      if (action === 'del' || action === 'pencil') return
      // long-press a digit key = toggle it as a pencil mark, the touch analog
      // of hold-Space/Shift + digit; the click that follows is swallowed
      longPressed = false
      clearTimeout(pressTimer)
      pressTimer = setTimeout(() => {
        longPressed = true
        applyKey(action, true)
      }, 500)
    })
    const cancelPress = () => clearTimeout(pressTimer)
    td.addEventListener('pointerup', cancelPress)
    td.addEventListener('pointerleave', cancelPress)
    td.addEventListener('pointercancel', cancelPress)
    td.addEventListener('click', () => {
      if (longPressed) {
        longPressed = false
        return
      }
      applyKey(action)
    })
  }
  $('side_keys').prepend(table)
}

/* ---------- options ---------- */

function applySettings() {
  document.documentElement.dataset.theme = resolvedTheme()
  document.documentElement.classList.toggle('no-keypad', settings.touchControls !== 'keypad')
  document.documentElement.classList.toggle('thumbpad', settings.touchControls === 'thumbpad')
  // board-only is a game-state mode; never let a settings change apply it over the menu
  document.documentElement.classList.toggle('board-only', !!settings.boardOnly && !menuShown())
  // status/title bar matches the page background; read it from the theme block
  // so every theme stays in sync without a duplicate color map here
  document.querySelector('meta[name="theme-color"]').content =
    getComputedStyle(document.documentElement).getPropertyValue('--page-bg').trim()
  $('opt-theme').value = settings.theme
  $('opt-auto-light').value = settings.autoLight
  $('opt-auto-dark').value = settings.autoDark
  $('auto-themes').classList.toggle('shown', settings.theme === 'auto')
  $('opt-timer').checked = settings.showTimer
  $('opt-pencilmarks').checked = settings.allowPencilMarks
  $('opt-highlight').checked = settings.highlightWrong
  $('opt-check').checked = settings.checkAsYouType
  $('opt-blindpace').checked = settings.blindPace
  $('opt-glints').checked = settings.glints
  $('opt-sound').checked = settings.sound
  sfx.setSoundEnabled(settings.sound)
  $('opt-touch').value = settings.touchControls
  $('pencil-row').classList.toggle('shown', settings.touchControls === 'keypad')
  $('side_keys').classList.toggle('hidden', settings.touchControls !== 'keypad')
  $('opt-ambient').checked = settings.ambient
  $('opt-ambient-yt').value = settings.ambientYouTube
  $('ambient-yt-row').classList.toggle('shown', !!settings.ambient)
  document.documentElement.classList.toggle('ambient', !!settings.ambient)
  ambient.setSource(settings.ambientYouTube)
  syncAmbient() // also retints the scene when the theme changes
  renderTimer()
}

function wireOptions() {
  const save = () => {
    writeStore('websudoku:settings', settings)
    applySettings()
  }
  const bind = (id, key) =>
    $(id).addEventListener('change', (e) => {
      settings[key] = e.target.checked
      save()
    })
  $('opt-theme').addEventListener('change', (e) => {
    settings.theme = e.target.value
    save()
  })
  $('opt-auto-light').addEventListener('change', (e) => {
    settings.autoLight = e.target.value
    save()
  })
  $('opt-auto-dark').addEventListener('change', (e) => {
    settings.autoDark = e.target.value
    save()
  })
  bind('opt-timer', 'showTimer')
  bind('opt-pencilmarks', 'allowPencilMarks')
  bind('opt-highlight', 'highlightWrong')
  bind('opt-check', 'checkAsYouType')
  bind('opt-blindpace', 'blindPace')
  bind('opt-glints', 'glints')
  bind('opt-sound', 'sound')
  bind('opt-ambient', 'ambient')
  // any pasted YouTube URL shape normalizes to the bare id (or clears if unparseable)
  $('opt-ambient-yt').addEventListener('change', (e) => {
    settings.ambientYouTube = ambient.parseYouTubeId(e.target.value)
    e.target.value = settings.ambientYouTube
    save()
  })
  $('opt-touch').addEventListener('change', (e) => {
    settings.touchControls = e.target.value
    save()
  })
  $('opt-pencil').addEventListener('change', (e) => {
    settings.keypadPencil = e.target.checked
    setPencilMode(e.target.checked)
    save()
  })
}

/* ---------- init ---------- */

buildGrid()
buildKeys()
thumb.init({
  getCell: (i) => ({
    given: game.givens[i] !== 0,
    value: game.givens[i] !== 0 ? String(game.givens[i]) : game.entries[i] || '',
    marks: game.marks[i] || '',
    err: game.err[i] || 0,
  }),
  aimBoard: (i, on) => {
    tds[i].classList.toggle('aim', on)
    // while aiming, the aim box is the only cursor on the real board — the
    // focus box on the still-selected cell would read as a second one
    $('puzzle_grid').classList.toggle('aiming', on)
  },
  select: (i) => inputs[i].focus({ preventScroll: true }),
  digit: (d) => {
    if (thumbTarget()) setEntry(selected, game.entries[selected] === d ? '' : d)
  },
  mark: (d) => {
    if (thumbTarget()) togglePencilDigit(selected, d)
  },
  clear: () => {
    if (thumbTarget()) clearCell(selected)
  },
})
wireOptions()
setPencilMode(pencilMode)
renderStats()

$('check-btn').addEventListener('click', check)
$('pause-btn').addEventListener('click', () => (game.paused ? resumeGame() : pauseGame()))
$('clear-btn').addEventListener('click', () => {
  if (!game.done) confirmDialog('Are you sure you want to clear the puzzle?', clearPuzzle)
})
$('options-close').addEventListener('click', hideOptions)
$('options-modal').addEventListener('click', (e) => {
  if (e.target === $('options-modal')) hideOptions() // backdrop click closes
})
$('select-link').addEventListener('click', (e) => {
  e.preventDefault()
  selectPuzzleDialog()
})
// in auto, follow the OS theme live (flip at sunset, etc.)
systemDark.addEventListener('change', () => {
  if (settings.theme === 'auto') applySettings()
})
$('focus-link').addEventListener('click', (e) => {
  e.preventDefault()
  setBoardOnly(true)
})
$('menu-link').addEventListener('click', (e) => {
  e.preventDefault()
  showMenu()
})
$('focus-exit').addEventListener('click', (e) => {
  e.preventDefault()
  setBoardOnly(false)
})
// F toggles board-only mode even when no cell is selected (the grid handler
// covers focused cells; dialogs and other fields are excluded here)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideOptions()
  if (e.metaKey || e.ctrlKey || e.altKey) return
  if (e.key !== 'f' && e.key !== 'F') return
  if (menuShown() || optionsShown()) return
  const t = e.target
  if (t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return
  e.preventDefault()
  setBoardOnly(!settings.boardOnly)
})
// iOS pans to "reveal" a focused input even inside overflow:hidden boxes —
// including the body element itself, which window.scrollTo never resets and
// whose scroll events don't bubble — and never pans back. In board-only that
// reads as the whole game (fixed ambient layer included) drifting up, leaving
// a page-bg bar at the bottom. The fixed body in CSS prevents most of it;
// this capture-phase clamp snaps back anything iOS still displaces.
document.addEventListener(
  'scroll',
  (e) => {
    if (!settings.boardOnly || menuShown()) return
    const el = e.target === document ? document.scrollingElement : e.target
    if (el instanceof Element && (el.scrollTop || el.scrollLeft)) {
      el.scrollTop = 0
      el.scrollLeft = 0
    }
  },
  { capture: true, passive: true }
)
// thumb pad: a touch anywhere off the board and the pad itself always exits
// number entry, back to the map. (Board taps are decided in the cell click
// handler above: an editable cell opens the pad, a given closes it.)
document.addEventListener('pointerup', (e) => {
  if (e.pointerType !== 'touch' || !e.isPrimary) return
  if (settings.touchControls !== 'thumbpad') return
  const t = e.target
  if (t instanceof Element && (t.closest('#thumbpad') || t.closest('#puzzle_grid'))) return
  thumb.showMap()
})
// touch: double-tapping empty background toggles board-only, the mobile analog
// of the F key (which needs a keyboard). Interactive surfaces are excluded so
// game taps never trigger it; a tap on one also resets the pending first tap.
let lastTap = 0
let lastTapX = 0
let lastTapY = 0
document.addEventListener('pointerup', (e) => {
  if (e.pointerType !== 'touch' || !e.isPrimary) return
  if (menuShown() || optionsShown() || $('overlay').classList.contains('shown')) return
  const t = e.target
  if (
    t instanceof Element &&
    t.closest('#puzzle_grid, #side_keys, #thumbpad, #focus-exit, a, input, select, label')
  ) {
    lastTap = 0
    return
  }
  const now = performance.now()
  if (now - lastTap < 350 && Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < 48) {
    lastTap = 0
    setBoardOnly(!settings.boardOnly)
  } else {
    lastTap = now
    lastTapX = e.clientX
    lastTapY = e.clientY
  }
})
document.body.addEventListener('click', (e) => {
  const level = e.target.closest('a[data-level]')?.dataset.level
  if (level) {
    e.preventDefault()
    newPuzzle(level) // stays on the menu until the deal is ready; newPuzzle swaps states
  }
  if (e.target.closest('a.options-link')) {
    e.preventDefault()
    showOptions()
  }
  if (e.target.closest('a.reset-stats')) {
    e.preventDefault()
    hideOptions() // the confirm lives in #overlay, which sits under the options modal
    confirmDialog('Reset all statistics?', () => {
      stats = Object.fromEntries(LEVELS.map((l) => [l.key, { wins: 0, fastest: null }]))
      recordLevel = null
      writeStore('websudoku:stats', stats)
      renderStats()
    })
  }
})
$('overlay').addEventListener('click', () => {
  if (game.paused) resumeGame()
})
document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveGame()
})

/* TEMP DEBUG — board-only viewport diagnostics; remove once the iOS
   bottom-bar bug is understood. Green readout, top-left, board-only only. */
{
  const dbg = document.createElement('div')
  dbg.style.cssText =
    'position:fixed;left:8px;top:100px;z-index:99;background:rgba(0,0,0,0.75);color:#0f0;font:11px/1.5 monospace;padding:6px 8px;white-space:pre;pointer-events:none;display:none;'
  document.body.appendChild(dbg)
  const probe = document.createElement('div')
  probe.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);'
  document.body.appendChild(probe)
  setInterval(() => {
    if (!settings.boardOnly || menuShown()) {
      dbg.style.display = 'none'
      return
    }
    const vv = window.visualViewport
    const amb = $('ambient').getBoundingClientRect()
    const kid = document.querySelector('#ambient video, #ambient iframe, #ambient canvas')
    const kr = kid ? kid.getBoundingClientRect() : null
    const cs = getComputedStyle(probe)
    dbg.style.display = 'block'
    dbg.textContent =
      `inner   ${window.innerWidth}x${window.innerHeight}\n` +
      `screen  ${screen.width}x${screen.height}\n` +
      `vv      ${vv ? `${vv.width.toFixed(0)}x${vv.height.toFixed(0)} off ${vv.offsetTop.toFixed(1)},${vv.offsetLeft.toFixed(1)} pg ${vv.pageTop.toFixed(1)} sc ${vv.scale.toFixed(2)}` : 'n/a'}\n` +
      `scroll  win ${window.scrollY} body ${document.body.scrollTop} doc ${document.documentElement.scrollTop}\n` +
      `ambient top ${amb.top.toFixed(1)} bot ${amb.bottom.toFixed(1)} h ${amb.height.toFixed(1)}\n` +
      `layer   ${kid ? `${kid.tagName.toLowerCase()} top ${kr.top.toFixed(1)} bot ${kr.bottom.toFixed(1)} h ${kr.height.toFixed(1)}` : 'none'}\n` +
      `body h  ${document.body.getBoundingClientRect().height.toFixed(1)}  html h ${document.documentElement.getBoundingClientRect().height.toFixed(1)}\n` +
      `inset   top ${cs.paddingTop} bot ${cs.paddingBottom}\n` +
      `standalone ${matchMedia('(display-mode: standalone)').matches}`
  }, 500)
}

// Boot lands on the menu. An unfinished save restores silently behind its
// Continue row; a finished (or absent) save just leaves the menu bare — the
// first deal happens on a level click. Stats from a done game were already
// persisted at win time.
const saved = readStore('websudoku:game', null)
if (saved && typeof saved.givens === 'string' && saved.givens.length === 81 && Array.isArray(saved.entries) && !saved.done) {
  restoreGame(saved)
}
applySettings()
showMenu()
import './style.css'
import { generatePuzzle, MAX_PUZZLE_NUMBER } from './generator.js'
import { registerSW } from 'virtual:pwa-register'

registerSW({ immediate: true })

const LEVELS = [
  { key: 'easy', label: 'Easy' },
  { key: 'medium', label: 'Medium' },
  { key: 'hard', label: 'Hard' },
  { key: 'expert', label: 'Evil' },
]

// Message texts lifted from the original page's JS variables (m_d, m_c, m_m, m_w, m_i)
const MSG_DEAL = 'Here is the puzzle. Good luck!'
const MSG_CLEAR = 'Back to the start, we go!'
const MSG_MISTAKES = 'You made some mistakes, highlighted in red!'
const MSG_WRONG_COUNT = 'Something is not quite right in * of the cells!'
const MSG_OK = 'Everything is OK, still * to go!'

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

const settings = Object.assign(
  {
    theme: 'auto', // 'light' | 'dark' | 'auto' (follow the system)
    showTimer: true,
    allowPencilMarks: true,
    highlightWrong: true,
    checkAsYouType: false,
    showKeypad: matchMedia('(pointer: coarse)').matches, // original only shows keys on touch
    keypadPencil: false,
    boardOnly: false, // "Just the puzzle" mode: chrome hidden, scroll locked
  },
  readStore('websudoku:settings', {})
)
// pre-auto settings stored a boolean; keep whatever those installs showed
if (typeof settings.darkTheme === 'boolean') {
  settings.theme = settings.darkTheme ? 'dark' : 'light'
  delete settings.darkTheme
}

const systemDark = matchMedia('(prefers-color-scheme: dark)')
const isDark = () => settings.theme === 'dark' || (settings.theme === 'auto' && systemDark.matches)

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
}

const inputs = []
const tds = []
const pmSpans = [] // per cell: 9 spans forming the 3x3 pencil-mark mini-grid
const pms = []
let selected = -1
let pencilMode = settings.keypadPencil
let pencilKey = null
let recordLevel = null
let tickId = null

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
        input.select()
      })
      input.addEventListener('input', () => onCellInput(i))
      td.addEventListener('click', () => input.focus())
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
      if (inBounds) inputs[i + delta].focus()
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
    if ($('overlay').classList.contains('shown')) return
    const t = e.target
    if (t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return
    e.preventDefault()
    inputs[selected >= 0 ? selected : 40].focus()
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
  saveGame()
  maybeComplete()
}

function clearCell(i) {
  if (game.done || game.givens[i] !== 0) return
  game.entries[i] = ''
  game.marks[i] = ''
  game.err[i] = 0
  paint(i)
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
  if (!gridHasFocus()) inputs[selected].focus()
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
  saveGame()
}

function setPencilMode(on) {
  pencilMode = on
  pencilKey.classList.toggle('active', on)
  $('opt-pencil').checked = on
}

function setBoardOnly(on) {
  settings.boardOnly = on
  writeStore('websudoku:settings', settings)
  applySettings()
}

/* ---------- puzzles ---------- */

let generating = false

async function newPuzzle(level, number = 1 + Math.floor(Math.random() * MAX_PUZZLE_NUMBER)) {
  if (generating) return
  generating = true
  setMessage('Selecting a puzzle&hellip;')
  let puzzle
  try {
    puzzle = await generatePuzzle(level, number)
  } finally {
    generating = false
  }
  selected = -1 // fresh puzzle: movement keys start the selection at the center
  game.level = level
  game.number = number
  game.givens = puzzle.givens
  game.solution = puzzle.solution
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
  renderTabs()
  renderInfo()
  startTicking()
  saveGame()
}

function saveGame() {
  writeStore('websudoku:game', {
    level: game.level,
    number: game.number,
    givens: game.givens.join(''),
    solution: game.solution.join(''),
    entries: game.entries,
    marks: game.marks,
    err: game.err,
    elapsed: currentElapsed(),
    paused: game.paused,
    done: game.done,
  })
}

function restoreGame(saved) {
  game.level = saved.level
  game.number = saved.number || 1 + Math.floor(Math.random() * MAX_PUZZLE_NUMBER)
  game.givens = [...saved.givens].map(Number)
  game.solution = [...saved.solution].map(Number)
  // migrate pre-mini-grid saves, where pencil marks were multi-digit entries
  game.entries = saved.entries.map((v) => (v && v.length === 1 ? v : ''))
  game.marks = Array.isArray(saved.marks)
    ? saved.marks
    : saved.entries.map((v) => (v && v.length > 1 ? v : ''))
  game.err = saved.err
  game.done = !!saved.done
  game.paused = !!saved.paused && !game.done
  game.elapsedBase = saved.elapsed || 0
  game.runningSince = game.paused || game.done ? null : performance.now()
  setMessage(MSG_DEAL)
  paintAll()
  renderTabs()
  renderInfo()
  startTicking()
  if (game.paused) {
    $('pause-btn').value = 'Resume'
    $('puzzle_grid').style.visibility = 'hidden'
    showOverlay('<div class="bigbig">Paused</div><p class="small">Click anywhere to resume</p>')
  }
  if (game.done) setMessage('Puzzle solved — start a new one!', 'green')
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
  $('timer').textContent = ` ${fmt(currentElapsed())} `
}

function pauseGame() {
  if (game.done || game.paused) return
  game.elapsedBase = currentElapsed()
  game.runningSince = null
  game.paused = true
  $('pause-btn').value = 'Resume'
  $('puzzle_grid').style.visibility = 'hidden'
  showOverlay('<div class="bigbig">Paused</div><p class="small">Click anywhere to resume</p>')
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
  st.wins++
  const record = st.fastest == null || game.elapsedBase < st.fastest
  if (record) {
    st.fastest = game.elapsedBase
    recordLevel = game.level
  }
  writeStore('websudoku:stats', stats)
  renderStats()

  const label = LEVELS.find((l) => l.key === game.level).label
  const time = fmt(game.elapsedBase)
  setMessage(`Congratulations! You solved the puzzle in ${time}.`, 'green')
  showOverlay(
    `<div class="bigbig">Congratulations!</div>
     <p>You solved this ${label} puzzle in <b>${time}</b>.</p>
     ${record ? '<p><span class="stat fastest">New personal best!</span></p>' : ''}
     <p><input type="button" id="overlay-new" value="New Puzzle"></p>`
  )
  $('overlay-new').addEventListener('click', () => newPuzzle(game.level))
  saveGame()
}

/* ---------- overlay & dialogs ---------- */

function showOverlay(html, dialog = false) {
  const inner = $('overlay-inner')
  inner.innerHTML = html
  inner.className = dialog ? 'dialog' : ''
  $('overlay').classList.add('shown')
}

const hideOverlay = () => $('overlay').classList.remove('shown')

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
     <p class="small">Enter a puzzle number from 1 to ${MAX_PUZZLE_NUMBER.toLocaleString('en-US')}</p>
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
    if (n < 1 || n > MAX_PUZZLE_NUMBER) return
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

function renderTabs() {
  const html = LEVELS.map(({ key, label }) =>
    key === game.level ? `<b>${label}</b>` : `<a href="#" data-level="${key}"><b>${label}</b></a>`
  ).join(' &nbsp; ')
  for (const el of document.querySelectorAll('.level-links')) el.innerHTML = html
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
  document.documentElement.dataset.theme = isDark() ? 'dark' : 'light'
  document.documentElement.classList.toggle('no-keypad', !settings.showKeypad)
  document.documentElement.classList.toggle('board-only', !!settings.boardOnly)
  // status/title bar matches the page background (values from --page-bg)
  document.querySelector('meta[name="theme-color"]').content = isDark() ? '#111114' : '#F9F9FF'
  // the link names the mode a click switches to (light -> dark -> auto -> light)
  $('theme-link').textContent = { light: 'Dark mode', dark: 'Auto mode', auto: 'Light mode' }[settings.theme]
  $('theme-link').title =
    settings.theme === 'auto' ? 'Theme now matches the system' : `Theme is now always ${settings.theme}`
  $('opt-theme').value = settings.theme
  $('opt-timer').checked = settings.showTimer
  $('opt-pencilmarks').checked = settings.allowPencilMarks
  $('opt-highlight').checked = settings.highlightWrong
  $('opt-check').checked = settings.checkAsYouType
  $('opt-keypad').checked = settings.showKeypad
  $('side_keys').classList.toggle('hidden', !settings.showKeypad)
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
  bind('opt-timer', 'showTimer')
  bind('opt-pencilmarks', 'allowPencilMarks')
  bind('opt-highlight', 'highlightWrong')
  bind('opt-check', 'checkAsYouType')
  bind('opt-keypad', 'showKeypad')
  $('opt-pencil').addEventListener('change', (e) => {
    settings.keypadPencil = e.target.checked
    setPencilMode(e.target.checked)
    save()
  })
}

/* ---------- init ---------- */

buildGrid()
buildKeys()
wireOptions()
setPencilMode(pencilMode)
renderStats()

$('check-btn').addEventListener('click', check)
$('pause-btn').addEventListener('click', () => (game.paused ? resumeGame() : pauseGame()))
$('clear-btn').addEventListener('click', () => {
  if (!game.done) confirmDialog('Are you sure you want to clear the puzzle?', clearPuzzle)
})
$('options-btn').addEventListener('click', () => {
  const d = $('options')
  d.open = !d.open
})
$('select-link').addEventListener('click', (e) => {
  e.preventDefault()
  selectPuzzleDialog()
})
$('theme-link').addEventListener('click', (e) => {
  e.preventDefault()
  settings.theme = { light: 'dark', dark: 'auto', auto: 'light' }[settings.theme] || 'auto'
  writeStore('websudoku:settings', settings)
  applySettings()
})
// in auto, follow the OS theme live (flip at sunset, etc.)
systemDark.addEventListener('change', () => {
  if (settings.theme === 'auto') applySettings()
})
$('focus-link').addEventListener('click', (e) => {
  e.preventDefault()
  setBoardOnly(true)
})
$('focus-exit').addEventListener('click', (e) => {
  e.preventDefault()
  setBoardOnly(false)
})
// F toggles board-only mode even when no cell is selected (the grid handler
// covers focused cells; dialogs and other fields are excluded here)
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return
  if (e.key !== 'f' && e.key !== 'F') return
  const t = e.target
  if (t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return
  e.preventDefault()
  setBoardOnly(!settings.boardOnly)
})
document.body.addEventListener('click', (e) => {
  const level = e.target.closest('a[data-level]')?.dataset.level
  if (level) {
    e.preventDefault()
    newPuzzle(level)
  }
  if (e.target.closest('a.reset-stats')) {
    e.preventDefault()
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

const saved = readStore('websudoku:game', null)
if (saved && typeof saved.givens === 'string' && saved.givens.length === 81 && Array.isArray(saved.entries)) {
  restoreGame(saved)
} else {
  newPuzzle('easy')
}
applySettings()

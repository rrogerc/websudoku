// Thumb pad (settings.touchControls = 'thumbpad'): one-thumb controls docked
// in the bottom-right thumb zone, replacing the bottom keypad bar on phones.
// Two panels share one footprint:
//   - mini-map: a live 9x9 miniature of the board (givens/entries/mark dots,
//     error tint). Absolute trackpad mapping: touching the map highlights the
//     matching cell on the REAL board, dragging slides that highlight, lifting
//     selects — so the ~20px mini-cells never need to be hit precisely.
//     Lifting on a given only selects it; an open cell flips to the digit pad.
//   - digit pad: 3x3 digits laid out like the pencil-mark mini-grid
//     (123/456/789). Tap = toggle the entry and return to the map (one entry
//     per cell); long-press = toggle a pencil mark and STAY so marks chain
//     (many marks per cell). ⌫ clears and returns; ▦ returns bare.
// main.js owns all game state: this module reads it through hooks.getCell and
// mutates only via the hook callbacks.

let hooks = null
let root = null
let mapEl = null
const mapCells = []
const keyEls = [] // digit keys, index d-1
let selected = -1
let aim = -1 // cell under the finger while aiming on the mini-map

const cellAt = (e) => {
  const r = mapEl.getBoundingClientRect()
  const col = Math.min(8, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * 9)))
  const row = Math.min(8, Math.max(0, Math.floor(((e.clientY - r.top) / r.height) * 9)))
  return row * 9 + col
}

export function paintCell(i) {
  if (!hooks || i < 0) return
  const { given, value, marks, err } = hooks.getCell(i)
  let cls = 'tp-cell'
  if (!given && value !== '') cls += ' entry'
  else if (!given && marks !== '') cls += ' mk'
  if (err) cls += ` e${err}`
  if (i === selected) cls += ' sel'
  if (i === aim) cls += ' aim'
  mapCells[i].className = cls
  mapCells[i].textContent = value || (marks ? '·' : '')
  if (i === selected) refreshKeys() // the pad mirrors the cell it targets
}

// digit-pad state for the selected cell: its entry is .active, marks get a dot
function refreshKeys() {
  if (selected < 0) return
  const { given, value, marks } = hooks.getCell(selected)
  for (let d = 1; d <= 9; d++) {
    keyEls[d - 1].classList.toggle('active', !given && value === String(d))
    keyEls[d - 1].classList.toggle('marked', !given && marks.includes(d))
  }
}

export function setSelected(i) {
  if (selected === i) return
  const prev = selected
  selected = i
  paintCell(prev)
  paintCell(i)
  refreshKeys()
}

function setAim(i) {
  if (aim === i) return
  const prev = aim
  aim = i
  if (prev >= 0) {
    paintCell(prev)
    hooks.aimBoard(prev, false)
  }
  if (aim >= 0) {
    paintCell(aim)
    hooks.aimBoard(aim, true)
  }
}

export const showPad = () => root.classList.add('pad')
export const showMap = () => root.classList.remove('pad')

// fresh deal: forget the old selection and land on the map panel
export function reset() {
  setAim(-1)
  setSelected(-1)
  showMap()
}

// tap = entry (toggle) then back to the map; long-press = pencil mark, stay —
// the same 500ms timer and click-swallowing as the keypad's digit keys
function buildKey(d) {
  const b = document.createElement('div')
  b.className = 'tp-key'
  b.textContent = d
  keyEls.push(b)
  let pressTimer
  let longPressed = false
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault() // keep focus (and the selection box) on the board
    longPressed = false
    clearTimeout(pressTimer)
    pressTimer = setTimeout(() => {
      longPressed = true
      hooks.mark(String(d))
      refreshKeys()
    }, 500)
  })
  const cancelPress = () => clearTimeout(pressTimer)
  b.addEventListener('pointerup', cancelPress)
  b.addEventListener('pointerleave', cancelPress)
  b.addEventListener('pointercancel', cancelPress)
  b.addEventListener('click', () => {
    if (longPressed) {
      longPressed = false
      return
    }
    hooks.digit(String(d))
    showMap()
  })
  return b
}

export function init(h) {
  hooks = h
  root = document.getElementById('thumbpad')
  mapEl = document.getElementById('tp-map')
  root.addEventListener('contextmenu', (e) => e.preventDefault()) // long-press must not open a menu

  for (let i = 0; i < 81; i++) {
    const c = document.createElement('div')
    c.className = 'tp-cell'
    mapCells.push(mapEl.appendChild(c))
  }

  // absolute trackpad mapping: the finger's position on the map picks the cell
  mapEl.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary) return
    e.preventDefault()
    mapEl.setPointerCapture(e.pointerId)
    setAim(cellAt(e))
  })
  mapEl.addEventListener('pointermove', (e) => {
    if (!e.isPrimary || aim < 0) return
    setAim(cellAt(e))
  })
  mapEl.addEventListener('pointerup', (e) => {
    if (!e.isPrimary || aim < 0) return
    const i = aim
    setAim(-1)
    hooks.select(i) // focuses the real cell; its focus handler calls setSelected
    if (!hooks.getCell(i).given) showPad() // a given: select only, nothing to enter
  })
  mapEl.addEventListener('pointercancel', () => setAim(-1))

  const pad = document.getElementById('tp-pad')
  const digits = document.createElement('div')
  digits.id = 'tp-digits'
  for (let d = 1; d <= 9; d++) digits.appendChild(buildKey(d))
  pad.appendChild(digits)

  const actions = document.createElement('div')
  actions.id = 'tp-actions'
  const back = document.createElement('div')
  back.className = 'tp-key'
  back.textContent = '▦'
  back.title = 'Back to the board map'
  back.addEventListener('pointerdown', (e) => e.preventDefault())
  back.addEventListener('click', showMap)
  const del = document.createElement('div')
  del.className = 'tp-key'
  del.textContent = '⌫'
  del.title = 'Clear the cell'
  del.addEventListener('pointerdown', (e) => e.preventDefault())
  del.addEventListener('click', () => {
    hooks.clear()
    showMap()
  })
  actions.appendChild(back)
  actions.appendChild(del)
  pad.appendChild(actions)
}

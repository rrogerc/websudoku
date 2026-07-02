// Generates the PWA icons (a stylized sudoku grid) with zero dependencies:
// draws RGBA pixels and encodes them as PNG by hand via node:zlib.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
mkdirSync(OUT, { recursive: true })

/* --- minimal PNG encoder (8-bit RGBA, filter 0) --- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length)
  return out
}

function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* --- drawing --- */

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const BG = hex('#666699')
const BOARD = hex('#FFFFFF')
const BLUE = hex('#7777DD')
const PINK = hex('#FFBFBF')

// safe = fraction of the icon the board occupies; smaller for maskable icons
function drawIcon(size, safe) {
  const px = Buffer.alloc(size * size * 4)
  const fill = (x0, y0, x1, y1, [r, g, b]) => {
    x0 = Math.max(0, Math.round(x0))
    y0 = Math.max(0, Math.round(y0))
    x1 = Math.min(size, Math.round(x1))
    y1 = Math.min(size, Math.round(y1))
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const o = (y * size + x) * 4
        px[o] = r
        px[o + 1] = g
        px[o + 2] = b
        px[o + 3] = 255
      }
    }
  }

  fill(0, 0, size, size, BG)
  const board = size * safe
  const origin = (size - board) / 2
  const cell = board / 3
  const line = Math.max(2, board * 0.05)

  fill(origin, origin, origin + board, origin + board, BOARD)
  fill(origin + cell, origin, origin + 2 * cell, origin + cell, BLUE) // top middle cell
  fill(origin + cell, origin + 2 * cell, origin + 2 * cell, origin + board, PINK) // bottom middle cell
  for (const k of [0, 1, 2, 3]) {
    const p = origin + k * cell
    fill(p - line / 2, origin - line / 2, p + line / 2, origin + board + line / 2, BG)
    fill(origin - line / 2, p - line / 2, origin + board + line / 2, p + line / 2, BG)
  }
  return px
}

const icons = [
  ['icon-512.png', 512, 0.72],
  ['icon-192.png', 192, 0.72],
  ['apple-touch-icon.png', 180, 0.72],
  ['icon-512-maskable.png', 512, 0.55],
]
for (const [name, size, safe] of icons) {
  writeFileSync(join(OUT, name), encodePNG(size, drawIcon(size, safe)))
  console.log(`wrote public/${name}`)
}

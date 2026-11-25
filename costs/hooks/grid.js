// A cell grid that draws as a Raster on the terminal and as an SVG elsewhere.
export const NONE = 0x01000000
export const COLOURS = {
  Opus: 0xe07a5f, Fable: 0xb48ead, Sonnet: 0x5e9fe0, Haiku: 0x4fb89a, Other: 0x8a8f98,
  axis: 0x6e7681, label: 0x8a8f98, accent: 0xe07a5f, up: 0xe5534b, down: 0x57ab5a,
}

const RANGES = [[0x20, 0x7e], [0xa0, 0x24f], [0x2010, 0x2027], [0x2030, 0x205e], [0x2190, 0x21ff],
  [0x2500, 0x25ff], [0x2800, 0x28ff]]
const safe = code => (RANGES.some(([a, b]) => code >= a && code <= b) ? code : 0x3f)

export function grid(columns, rows) {
  return { columns, rows, cells: Array.from({ length: rows }, () => Array.from({ length: columns }, () => [32, NONE, NONE])) }
}

export function put(target, x, y, text, fg = NONE, bg = NONE) {
  if (y < 0 || y >= target.rows) return x
  for (const char of text) {
    if (x >= 0 && x < target.columns) target.cells[y][x] = [safe(char.codePointAt(0)), fg, bg]
    x++
  }
  return x
}

export function encode(target) {
  const words = new Uint32Array(target.columns * target.rows * 3)
  target.cells.flat().forEach((cell, i) => words.set(cell, i * 3))
  return new Uint8Array(words.buffer).toBase64()
}

const hex = colour => (colour === NONE ? undefined : '#' + colour.toString(16).padStart(6, '0'))

function textRow(ui, row) {
  const runs = []
  for (const [code, fg, bg] of row) {
    const last = runs[runs.length - 1]
    if (last && last.fg === fg && last.bg === bg) last.text += String.fromCodePoint(code)
    else runs.push({ text: String.fromCodePoint(code), fg, bg })
  }
  return ui.Text({ wrap: 'truncate-end', children: runs.map(run =>
    run.fg === NONE && run.bg === NONE ? run.text
      : ui.Text({ color: hex(run.fg), backgroundColor: hex(run.bg), children: [run.text] })) })
}

// SVG for surfaces without a Raster. Each cell is CELL_W by CELL_H pixels. Block glyphs
// become exact rectangles, box lines become strokes, and the rest is monospace text.
const CELL_W = 8
const CELL_H = 16
const INK = '#8b949e'
const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const LINES = { 0x2500: 'lr', 0x2502: 'ud', 0x2524: 'udl', 0x2514: 'ur' }
const SHADE = { 0x2591: 0.3, 0x2592: 0.55, 0x2593: 0.8 }

// style: 'hbars' insets horizontal bars so rows do not touch; 'tiles' draws a full block as a tile.
function shape(code, x, y, fill, style) {
  const px = x * CELL_W
  const py = y * CELL_H
  if (style === 'tiles' && code === 0x2588) return `<rect x="${px + 1}" y="${py + 2}" width="${CELL_W * 2 - 4}" height="${CELL_H - 4}" rx="2" fill="${fill}"/>`
  if (style === 'hbars' && (code === 0x2588 || (code >= 0x2589 && code <= 0x258f))) {
    const w = code === 0x2588 ? CELL_W : (CELL_W * (0x2590 - code)) / 8
    return `<rect x="${px}" y="${py + 3}" width="${w}" height="${CELL_H - 6}" fill="${fill}"/>`
  }
  if (code >= 0x2581 && code <= 0x2588) {
    const h = (CELL_H * (code - 0x2580)) / 8
    return `<rect x="${px}" y="${py + CELL_H - h}" width="${CELL_W}" height="${h}" fill="${fill}"/>`
  }
  if (code >= 0x2589 && code <= 0x258f) {
    return `<rect x="${px}" y="${py}" width="${(CELL_W * (0x2590 - code)) / 8}" height="${CELL_H}" fill="${fill}"/>`
  }
  if (SHADE[code]) return `<rect x="${px + 1}" y="${py + 2}" width="${CELL_W * 2 - 4}" height="${CELL_H - 4}" rx="2" fill="${fill}" opacity="${SHADE[code]}"/>`
  if (code === 0xb7) return `<rect x="${px + 1}" y="${py + 2}" width="${CELL_W * 2 - 4}" height="${CELL_H - 4}" rx="2" fill="${fill}" opacity="0.12"/>`
  if (code === 0x25cf) return `<circle cx="${px + CELL_W / 2}" cy="${py + CELL_H / 2}" r="3.5" fill="${fill}"/>`
  const parts = LINES[code]
  if (!parts) return null
  const cx = px + CELL_W / 2
  const cy = py + CELL_H / 2
  const ends = { l: [px, cy], r: [px + CELL_W, cy], u: [cx, py], d: [cx, py + CELL_H] }
  return [...parts].map(side => `<line x1="${cx}" y1="${cy}" x2="${ends[side][0]}" y2="${ends[side][1]}" stroke="${fill}"/>`).join('')
}

export function svg(target) {
  const body = []
  target.cells.forEach((row, y) => {
    let run = null
    const flush = () => {
      if (!run) return
      const xs = run.xs.map(x => x * CELL_W).join(' ')
      body.push(`<text x="${xs}" y="${y * CELL_H + 12}" fill="${run.fill}">${escape(run.text)}</text>`)
      run = null
    }
    row.forEach(([code, fg, bg], x) => {
      const fill = hex(fg) ?? INK
      if (bg !== NONE) body.push(`<rect x="${x * CELL_W}" y="${y * CELL_H}" width="${CELL_W}" height="${CELL_H}" fill="${hex(bg)}"/>`)
      const drawn = code === 32 ? '' : shape(code, x, y, fill, target.style)
      if (drawn !== null || code === 32) { flush(); if (drawn) body.push(drawn); return }
      if (!run || run.fill !== fill) { flush(); run = { fill, text: '', xs: [] } }
      run.text += String.fromCodePoint(code)
      run.xs.push(x)
    })
    flush()
  })
  const width = target.columns * CELL_W
  const height = target.rows * CELL_H
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="13" shape-rendering="crispEdges">${body.join('')}</svg>`
}

const alt = target => target.cells.map(row => row.map(([code]) => String.fromCodePoint(code)).join('').trimEnd()).join('\n').trim()

export function draw(ui, surface, key, target) {
  if (surface === 'terminal') return ui.Raster({ key, columns: target.columns, rows: target.rows, cells: encode(target) })
  if (ui.Svg) return ui.Svg({ alt: alt(target) || 'Chart', source: svg(target) })
  return ui.Box({ flexDirection: 'column', children: target.cells.map(row => textRow(ui, row)) })
}

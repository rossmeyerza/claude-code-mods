// Chart builders. Each returns a grid (grid.js) sized to the width it is given.
import { COLOURS, grid, NONE, put } from './grid.js'
import { axis as axisMoney, date, fit, money, percent } from './format.js'
import { FAMILIES } from './stats.js'

const LOWER = ' ▁▂▃▄▅▆▇█'
const LEFT = ' ▏▎▍▌▋▊▉█'
const SHADES = ['·', '░', '▒', '▓', '█']

// Sums days into buckets so that the bars fit the width.
function buckets(days, room) {
  const size = Math.max(1, Math.ceil(days.length / room))
  const out = []
  for (let i = 0; i < days.length; i += size) {
    const chunk = days.slice(i, i + size)
    const parts = Object.fromEntries(FAMILIES.map(name => [name, chunk.reduce((t, d) => t + d.parts[name], 0)]))
    out.push({ day: chunk[0].day, last: chunk[chunk.length - 1].day, total: chunk.reduce((t, d) => t + d.total, 0), parts })
  }
  return { bars: out, size }
}

// One cell of a stacked bar. Where the next series fills the rest of the cell, it is the
// background; otherwise the cell takes the colour of the series that covers most of it.
function stackCell(stack, bottom) {
  const top = stack.length ? stack[stack.length - 1].to : 0
  if (top <= bottom) return [32, NONE, NONE]
  const index = stack.findIndex(seg => seg.to > bottom)
  const lower = stack[index]
  if (lower.to >= bottom + 8) return [LOWER.codePointAt(8), lower.colour, NONE]
  const upper = stack[index + 1]
  if (upper && upper.to >= bottom + 8) return [LOWER.codePointAt(lower.to - bottom), lower.colour, upper.colour]
  const height = Math.min(8, top - bottom)
  let best = lower
  let cover = lower.to - bottom
  for (let i = index + 1; i < stack.length && stack[i - 1].to < bottom + 8; i++) {
    const part = Math.min(stack[i].to, bottom + 8) - stack[i - 1].to
    if (part > cover) { best = stack[i]; cover = part }
  }
  return [LOWER.codePointAt(height), best.colour, NONE]
}

// Cumulative tops in eighths of a row; parts that round to nothing are left out.
export function stackOf(bar, scale) {
  let to = 0
  const stack = []
  for (const name of FAMILIES) {
    const next = Math.round(to + bar.parts[name] * scale)
    if (next > to) stack.push({ to: next, colour: COLOURS[name] })
    to = Math.max(to, next)
  }
  return stack
}

export { stackCell }

export function stackedBars(days, width, height) {
  const gutter = 7
  const room = Math.max(4, width - gutter - 1)
  const { bars, size } = buckets(days, room)
  const top = Math.max(0, ...bars.map(b => b.total))
  const slot = Math.max(1, Math.min(3, Math.floor(room / bars.length)))
  const out = grid(Math.min(width, gutter + 1 + bars.length * slot), height + 2)
  const scale = top ? (height * 8) / top : 0
  bars.forEach((bar, i) => {
    const stack = stackOf(bar, scale)
    for (let row = 0; row < height; row++) {
      for (let k = 0; k < (slot > 1 ? slot - 1 : 1); k++) out.cells[height - 1 - row][gutter + 1 + i * slot + k] = stackCell(stack, row * 8)
    }
  })
  const axis = { 0: axisMoney(top), [Math.floor(height / 2)]: axisMoney(top / 2) }
  for (let row = 0; row < height; row++) {
    const label = axis[row] ?? ''
    put(out, gutter - 1 - label.length, row, label, COLOURS.label)
    put(out, gutter, row, label ? '┤' : '│', COLOURS.axis)
  }
  put(out, gutter - 3, height, '$0', COLOURS.label)
  put(out, gutter, height, '└' + '─'.repeat(out.columns - gutter - 1), COLOURS.axis)
  const first = date(bars[0].day)
  const last = size > 1 ? `${date(bars[bars.length - 1].day)}, ${size} days a bar` : date(bars[bars.length - 1].last)
  put(out, gutter + 1, height + 1, first, COLOURS.label)
  put(out, Math.max(gutter + first.length + 3, out.columns - last.length), height + 1, last, COLOURS.label)
  return out
}

// Horizontal bars: label, bar on a track, value and share. items: { name, cost, colour, dim }.
export function barList(items, total, width) {
  const label = Math.max(6, Math.min(24, Math.floor(width * 0.32)))
  const value = 7
  const share = 5
  const room = Math.max(4, width - label - value - share - 3)
  const peak = Math.max(0, ...items.map(item => item.cost))
  const out = grid(Math.min(width, label + room + value + share + 3), items.length)
  out.style = 'hbars'
  items.forEach((item, y) => {
    put(out, 0, y, fit(item.name, label), item.dim ? COLOURS.label : NONE)
    const eighths = peak ? Math.round((item.cost / peak) * room * 8) : 0
    const full = Math.floor(eighths / 8)
    let x = put(out, label + 1, y, '█'.repeat(full), item.colour)
    if (eighths % 8) x = put(out, x, y, LEFT[eighths % 8], item.colour)
    put(out, x, y, '─'.repeat(Math.max(0, label + 1 + room - x)), COLOURS.axis)
    const text = money(item.cost)
    put(out, label + room + 2 + value - text.length, y, text)
    const pct = percent(item.cost, total)
    put(out, out.columns - pct.length, y, pct, COLOURS.label)
  })
  return out
}

// One row split by family share, with a legend row under it.
export function mixBar(families, width) {
  const total = families.reduce((t, f) => t + f.cost, 0)
  const out = grid(width, 2)
  out.style = 'hbars'
  let x = 0
  let acc = 0
  families.forEach((f, i) => {
    acc += f.cost
    const end = i === families.length - 1 ? width : Math.round((acc / (total || 1)) * width)
    put(out, x, 0, '█'.repeat(Math.max(0, end - x)), COLOURS[f.name])
    x = end
  })
  let lx = 0
  for (const f of families) {
    const text = `${f.name} ${percent(f.cost, total)}`
    if (lx + text.length + 2 > width) break
    put(out, lx, 1, '●', COLOURS[f.name])
    lx = put(out, lx + 2, 1, text) + 3
  }
  return out
}

// A calendar of daily spend: one column pair per week, Monday at the top.
export function calendar(days, width) {
  const cell = 2
  const gutter = 4
  const last = days[days.length - 1].day
  const span = Math.ceil((last - days[0].day + 1) / 7) + 1
  const weeks = Math.max(1, Math.min(26, Math.max(8, span), Math.floor((width - gutter) / cell)))
  const lastMonday = last - ((new Date(last * 86400000).getUTCDay() + 6) % 7)
  const firstMonday = lastMonday - (weeks - 1) * 7
  const values = new Map(days.map(d => [d.day, d.total]))
  const peak = Math.max(0, ...days.filter(d => d.day >= firstMonday).map(d => d.total))
  const out = grid(gutter + weeks * cell, 8)
  out.style = 'tiles'
  for (const [row, name] of [[1, 'Mon'], [3, 'Wed'], [5, 'Fri']]) put(out, 0, row, name, COLOURS.label)
  let month = ''
  for (let w = 0; w < weeks; w++) {
    const label = date(firstMonday + w * 7).split(' ')[1]
    if (label !== month && gutter + w * cell + 3 <= out.columns) { put(out, gutter + w * cell, 0, label, COLOURS.label); month = label }
    for (let d = 0; d < 7; d++) {
      const day = firstMonday + w * 7 + d
      if (day > last) continue
      const value = values.get(day) ?? 0
      const level = value > 0 && peak ? Math.min(4, 1 + Math.floor((value / peak) * 3.999)) : 0
      put(out, gutter + w * cell, d + 1, SHADES[level], level ? COLOURS.accent : COLOURS.axis)
    }
  }
  return out
}

// A small chart for the widget: bars only, no axis.
export function miniBars(days, width, height) {
  const { bars } = buckets(days, width)
  const out = grid(Math.min(width, bars.length), height)
  const top = Math.max(0, ...bars.map(b => b.total))
  const scale = top ? (height * 8) / top : 0
  bars.forEach((bar, i) => {
    const stack = stackOf(bar, scale)
    for (let row = 0; row < height; row++) out.cells[height - 1 - row][i] = stackCell(stack, row * 8)
  })
  return out
}

export function legendShades(width) {
  const out = grid(Math.min(width, 30), 1)
  out.style = 'tiles'
  let x = put(out, 0, 0, 'Less ', COLOURS.label)
  SHADES.forEach((s, i) => { x = put(out, x, 0, s, i ? COLOURS.accent : COLOURS.axis) + 1 })
  put(out, x + 1, 0, 'more', COLOURS.label)
  return out
}

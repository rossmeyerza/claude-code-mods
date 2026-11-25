import assert from 'node:assert/strict'
import { test } from 'node:test'
import { render, TABS } from './hooks/view.js'
import { stackCell } from './hooks/charts.js'
import { PERIODS, summarise, DAY } from './hooks/stats.js'

const NOW = Date.UTC(2026, 10, 25, 15)
const fixture = {
  missing: 1, errors: 0,
  sessions: Array.from({ length: 60 }, (_, i) => ({
    id: 's' + i, project: ['ford-data-partnerships-prototype', 'test-mods', 'ross'][i % 3],
    start: NOW - (i % 40) * DAY - 3600000, cost: 1 + (i * 7) % 23, api: 1, wall: 3600000 * (1 + i % 5),
    added: 100 * i, removed: 10 * i, unknown: false,
    models: { 'claude-opus-5-5': [0.6 + (i * 7) % 23 * 0.8, 10, 20, 3000, 100], 'claude-fable-5-2': [0.4 + (i * 7) % 23 * 0.2, 5, 5, 100, 10] },
  })),
}

// A fake element table: each element records its type and props.
const ui = new Proxy({}, { get: (_, type) => props => ({ type, props }) })

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  visit(node)
  for (const child of node.props.children ?? []) walk(child, visit)
}

function textOf(node) {
  if (typeof node === 'string') return node
  if (!node || typeof node !== 'object') return ''
  if (node.type === 'Raster') {
    const words = new Uint32Array(Uint8Array.fromBase64(node.props.cells).buffer)
    const lines = []
    for (let r = 0; r < node.props.rows; r++) {
      let line = ''
      for (let c = 0; c < node.props.columns; c++) line += String.fromCodePoint(words[(r * node.props.columns + c) * 3])
      lines.push(line.trimEnd())
    }
    return lines.join('\n') + '\n'
  }
  if (node.type === 'Button') return '[' + (node.props.hotkey ? node.props.hotkey + ': ' : '') + node.props.label + ']'
  if (node.type === 'Progress') return '{' + node.props.label + ' ' + (node.props.valueText ?? '…') + '}\n'
  const inner = (node.props.children ?? []).map(textOf).join('')
  if (node.type === 'Box') return node.props.flexDirection === 'row' ? inner + (inner.endsWith('\n') ? '' : '\n') : inner
  return node.type === 'Text' && !node.inline ? inner : inner
}

export function show(data, tab, period, width, surface = 'terminal') {
  const actions = { tab() {}, period() {}, refresh() {} }
  return render(ui, { data, tab, period, now: NOW, width, surface, actions, busy: false, readAt: '15:47' })
}

test('Every tab draws valid Rasters at each width and period', () => {
  for (const width of [34, 40, 55, 78, 100]) for (const tab of TABS) for (const period of PERIODS) {
    const tree = show(fixture, tab.id, period.id, width)
    walk(tree, node => {
      if (node.type !== 'Raster') return
      const { columns, rows, cells } = node.props
      assert.ok(columns >= 1 && columns <= width, `${tab.id} ${node.props.key} is ${columns} wide at ${width}`)
      const words = new Uint32Array(Uint8Array.fromBase64(cells).buffer)
      assert.equal(words.length, columns * rows * 3)
      for (let i = 0; i < words.length; i += 3) {
        assert.ok(words[i] >= 0x20 && words[i] <= 0xffff, `code point ${words[i]} at ${i / 3}`)
        for (const colour of [words[i + 1], words[i + 2]]) assert.ok(colour <= 0xffffff || colour === 0x01000000)
      }
    })
  }
})

test('A stacked cell uses a background only where the upper series fills the cell', () => {
  const lower = { to: 3, colour: 1 }
  assert.deepEqual(stackCell([lower, { to: 4, colour: 2 }], 0), [0x2584, 1, 0x01000000])
  assert.deepEqual(stackCell([lower, { to: 9, colour: 2 }], 0), [0x2583, 1, 2])
  assert.deepEqual(stackCell([{ to: 1, colour: 1 }, { to: 6, colour: 2 }], 0), [0x2586, 2, 0x01000000])
})

test('Other surfaces draw SVG in place of Rasters', () => {
  for (const surface of ['desktop', 'vscode', 'mobile']) for (const tab of TABS) {
    const tree = show(fixture, tab.id, 'all', 90, surface)
    walk(tree, node => {
      assert.notEqual(node.type, 'Raster')
      if (node.type !== 'Svg') return
      const { source, alt } = node.props
      assert.ok(alt.length > 0)
      assert.ok(source.length < 131072, `${tab.id} svg is ${source.length} characters`)
      assert.match(source, /^<svg [^>]*>.*<\/svg>$/s)
      assert.doesNotMatch(source, /NaN|undefined|Infinity/)
    })
  }
})

test('The widget seat draws a compact view', () => {
  const actions = { tab() {}, period() {}, refresh() {} }
  const tree = render(ui, { data: fixture, tab: 'overview', period: 'month', now: NOW, width: 30,
    surface: 'desktop', placement: 'widget', actions, busy: false })
  const types = []
  walk(tree, node => types.push(node.type))
  assert.ok(types.includes('Svg'))
  assert.ok(!types.includes('Button'))
})

test('Family shares add up to the total', () => {
  const s = summarise(fixture, 'all', NOW)
  const parts = s.families.reduce((t, f) => t + f.cost, 0)
  assert.ok(Math.abs(parts - s.total) < 1e-6)
})

test('An empty period draws a message and no chart', () => {
  const tree = show({ sessions: [], missing: 0, errors: 0 }, 'overview', 'week', 60)
  walk(tree, node => assert.notEqual(node.type, 'Raster'))
})

export { textOf, fixture }

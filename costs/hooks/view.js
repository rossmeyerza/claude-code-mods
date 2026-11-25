// The pane's drawing: a header, a tab row, a hero line, the tab's body and a footer.
import { barList, calendar, legendShades, miniBars, mixBar, stackedBars } from './charts.js'
import { duration, count, date, exact, fit, money, percent } from './format.js'
import { COLOURS, draw, grid, NONE, put } from './grid.js'
import { familyCosts, FAMILIES, PERIODS, summarise } from './stats.js'

export const TABS = [
  { id: 'overview', label: 'Overview' }, { id: 'trend', label: 'Trend' },
  { id: 'projects', label: 'Projects' }, { id: 'models', label: 'Models' },
  { id: 'sessions', label: 'Sessions' },
]
const hex = colour => '#' + colour.toString(16).padStart(6, '0')

function delta(summary) {
  if (summary.previous === null) return null
  if (!summary.previous) return { text: 'no spend in the previous period', colour: COLOURS.label }
  const change = (summary.total - summary.previous) / summary.previous
  const arrow = change >= 0 ? '▲' : '▼'
  return { text: `${arrow} ${Math.abs(Math.round(change * 100))}% vs previous ${summary.period.days} days`, colour: change >= 0 ? COLOURS.up : COLOURS.down }
}

function stats(ui, items, width) {
  const per = width < 48 ? 2 : 4
  const cell = Math.floor(width / per)
  const rows = []
  for (let i = 0; i < items.length; i += per) {
    rows.push(ui.Box({ flexDirection: 'row', children: items.slice(i, i + per).map(([label, value, note]) =>
      ui.Box({ flexDirection: 'column', width: cell, children: [
        ui.Text({ dimColor: true, wrap: 'truncate-end', children: [fit(label, cell - 1)] }),
        ui.Text({ wrap: 'truncate-end', children: [ui.Text({ bold: true, children: [value] }), note ? ui.Text({ dimColor: true, children: [' ' + note] }) : ''] }),
      ] })) }))
  }
  return ui.Box({ flexDirection: 'column', children: rows })
}

function legend(ui, families) {
  return ui.Text({ wrap: 'truncate-end', children: families.flatMap(f =>
    [ui.Text({ color: hex(COLOURS[f.name]), children: ['● '] }), f.name + '  ']) })
}

const heading = (ui, text, note) => ui.Text({ children: [ui.Text({ bold: true, children: [text] }), note ? ui.Text({ dimColor: true, children: ['  ' + note] }) : ''] })

function overview(ui, s, ctx) {
  const top = s.projects.find(p => !p.isRest)
  return [
    stats(ui, [
      ['Per day', money(s.pace.perDay), '7-day avg'],
      ['This month', money(s.pace.monthProjected), 'at this rate'],
      ['Cache reads', s.tokens.cacheShare === null ? 'n/a' : percent(s.tokens.cacheShare, 1), 'of input'],
      ['Top project', top ? fit(top.name, Math.floor(ctx.width / 4) - 2) : 'none'],
    ], ctx.width),
    ui.Text({ children: [' '] }),
    heading(ui, 'Daily spend', 'stacked by model family'),
    draw(ui, ctx.surface, 'overview-bars', stackedBars(s.days, ctx.width, ctx.narrow ? 4 : 6)),
    legend(ui, s.families),
  ]
}

function trend(ui, s, ctx) {
  const busy = s.busiest
  const avg = s.activeDays ? s.total / s.activeDays : 0
  return [
    stats(ui, [
      ['Busiest day', busy ? money(busy.total) : 'none', busy ? date(busy.day) : ''],
      ['Active days', `${s.activeDays} of ${s.days.length}`],
      ['Per active day', money(avg)],
      ['Month so far', money(s.pace.monthSoFar)],
    ], ctx.width),
    ui.Text({ children: [' '] }),
    heading(ui, 'Daily spend', s.period.label.toLowerCase()),
    draw(ui, ctx.surface, 'trend-bars', stackedBars(s.days, ctx.width, ctx.narrow ? 6 : 10)),
    legend(ui, s.families),
    ui.Text({ children: [' '] }),
    heading(ui, 'Calendar', 'all time, darker is more spend'),
    draw(ui, ctx.surface, 'trend-calendar', calendar(ctx.allDays, ctx.width)),
    draw(ui, ctx.surface, 'trend-shades', legendShades(ctx.width)),
  ]
}

function projects(ui, s, ctx) {
  if (!s.projects.length) return []
  const items = s.projects.map((p, i) => ({ name: p.name, cost: p.cost, dim: p.isRest,
    colour: p.isRest ? COLOURS.Other : i < 3 ? COLOURS.accent : 0xc9917f }))
  return [
    heading(ui, 'Spend by project', `${s.projects.reduce((n, p) => n + (p.isRest ? 0 : 1), 0)} shown`),
    draw(ui, ctx.surface, 'project-bars', barList(items, s.total, ctx.width)),
    ui.Text({ dimColor: true, wrap: 'wrap', children: ['A project is the folder where the session started.'] }),
  ]
}

function tokenTable(families, width) {
  const cols = width < 48
    ? [['Model', 9], ['Input', 7], ['Write', 7], ['Read', 7], ['Output', 7]]
    : [['Model', 9], ['Input', 8], ['Cache write', 12], ['Cache read', 11], ['Output', 8]]
  const rows = families.map(f => f.row)
  const out = grid(Math.min(width, cols.reduce((t, [, w]) => t + w, 0)), rows.length + 1)
  let x = 0
  cols.forEach(([name, w], i) => { put(out, i ? x + w - name.length : x, 0, name, COLOURS.label); x += w })
  families.forEach((f, y) => {
    put(out, 0, y + 1, '●', COLOURS[f.name])
    put(out, 2, y + 1, f.name)
    let cx = cols[0][1]
    ;[f.row.input, f.row.cacheWrite, f.row.cacheRead, f.row.output].forEach((v, i) => {
      const text = count(v)
      cx += cols[i + 1][1]
      put(out, cx - text.length, y + 1, text)
    })
  })
  return out
}

function models(ui, s, ctx) {
  if (!s.families.length) return []
  const ordered = [...s.families].sort((a, b) => b.cost - a.cost)
  const items = ordered.map(f => ({ name: f.name, cost: f.cost, colour: COLOURS[f.name] }))
  const withRows = ordered.map(f => ({ name: f.name, row: s.tokens.families[f.name] }))
    .filter(f => f.row.input + f.row.output + f.row.cacheRead + f.row.cacheWrite > 0)
  const share = s.tokens.cacheShare
  return [
    heading(ui, 'Share of spend'),
    draw(ui, ctx.surface, 'model-mix', mixBar(ordered, ctx.width)),
    ui.Text({ children: [' '] }),
    draw(ui, ctx.surface, 'model-bars', barList(items, s.total, ctx.width)),
    ui.Text({ children: [' '] }),
    heading(ui, 'Tokens', 'cache reads are billed at a lower rate'),
    draw(ui, ctx.surface, 'model-tokens', tokenTable(withRows, ctx.width)),
    ...(share === null ? [] : [ui.Progress({ label: 'Cache reads as a share of input', value: share, valueText: percent(share, 1), color: hex(COLOURS.Haiku) })]),
  ]
}

function sessionTable(top, width) {
  const cost = 8
  const time = 9
  const day = 7
  const name = Math.max(6, width - day - cost - time - 4)
  const out = grid(Math.min(width, day + name + cost + time + 4), top.length + 1)
  put(out, 0, 0, 'Date', COLOURS.label)
  put(out, day + 2, 0, 'Project', COLOURS.label)
  put(out, out.columns - time - cost - 1 + (cost - 4), 0, 'Cost', COLOURS.label)
  put(out, out.columns - 8, 0, 'API time', COLOURS.label)
  top.forEach((session, i) => {
    const y = i + 1
    const parts = familyCosts(session)
    const main = FAMILIES.reduce((a, b) => (parts[b] > parts[a] ? b : a))
    put(out, 0, y, date(Math.floor(session.start / 86400000)), COLOURS.label)
    put(out, day, y, '●', COLOURS[main])
    put(out, day + 2, y, fit(session.project, name))
    const c = money(session.cost)
    put(out, out.columns - time - 1 - c.length, y, c)
    const t = duration(session.api)
    put(out, out.columns - t.length, y, t, COLOURS.label)
  })
  return out
}

function sessions(ui, s, ctx) {
  if (!s.top.length) return []
  const sessionsCount = s.sessions.length
  return [
    stats(ui, [
      ['Sessions', String(sessionsCount)],
      ['Avg session', money(s.total / sessionsCount)],
      ['Lines added', count(s.lines.added)],
      ['Lines removed', count(s.lines.removed)],
    ], ctx.width),
    ui.Text({ children: [' '] }),
    heading(ui, 'Most expensive sessions', 'dot shows the main model'),
    draw(ui, ctx.surface, 'session-table', sessionTable(s.top.slice(0, ctx.narrow ? 8 : 12), ctx.width)),
  ]
}

export const BODIES = { overview, trend, projects, models, sessions }

export function hero(ui, s) {
  const change = delta(s)
  return [
    ui.Text({ wrap: 'truncate-end', children: [
      ui.Text({ bold: true, color: hex(COLOURS.accent), children: [exact(s.total)] }),
      ui.Text({ dimColor: true, children: [`  ${s.period.label} · ${s.sessions.length} sessions`] }),
    ] }),
    ui.Text({ wrap: 'truncate-end', children: [
      change ? ui.Text({ color: hex(change.colour), children: [change.text + '  '] }) : '',
      ui.Text({ dimColor: true, children: ['Local estimate, not an invoice'] }),
    ] }),
  ]
}


function tabRow(ui, model) {
  const children = []
  TABS.forEach((tab, i) => {
    const active = tab.id === model.tab
    children.push(ui.Button({ key: 'tab-' + tab.id, hotkey: String(i + 1), plain: true, label: tab.label,
      ...(active ? { children: [ui.Text({ bold: true, inverse: true, children: [' ' + tab.label + ' '] })] } : { dimColor: true }),
      onPress: () => model.actions.tab(tab.id) }))
    children.push(ui.Text({ children: ['  '] }))
  })
  return ui.Box({ flexDirection: 'row', flexWrap: 'wrap', children })
}

function footer(ui, model, s) {
  const notes = []
  if (s.unknown) notes.push(`${s.unknown} with unknown model cost`)
  if (model.data.missing) notes.push(`${model.data.missing} without a saved cost`)
  if (model.data.errors) notes.push(`${model.data.errors} unreadable`)
  if (s.overlap.sessions) notes.push(`${s.overlap.sessions} share a start time (${money(s.overlap.cost)} may repeat)`)
  return [
    ui.Text({ children: [' '] }),
    ...(notes.length ? [ui.Text({ dimColor: true, wrap: 'wrap', children: ['Sessions: ' + notes.join(' · ') + '.'] })] : []),
    ui.Text({ dimColor: true, wrap: 'wrap', children: ['Days use each session\'s UTC start date.'] }),
  ]
}

function controls(ui, model) {
  const period = PERIODS.find(p => p.id === model.period) ?? PERIODS[0]
  return ui.Box({ flexDirection: 'row', flexWrap: 'wrap', children: [
    ui.Button({ key: 'period', hotkey: 'p', plain: true, label: 'Period: ' + period.label, onPress: model.actions.period }),
    ui.Text({ children: ['  '] }),
    ui.Button({ key: 'refresh', hotkey: 'r', plain: true, label: model.busy ? 'Reading' : 'Refresh', onPress: model.actions.refresh }),
    ui.Text({ dimColor: true, children: [model.readAt ? '  read ' + model.readAt : ''] }),
  ] })
}

// The small seat on the desktop: the total, the change and the last 14 days. Clicks may not reach it.
function widget(ui, model) {
  if (!model.data) return ui.Text({ dimColor: true, children: [model.busy ? 'Reading costs…' : 'Claude costs'] })
  const s = summarise(model.data, model.period, model.now)
  const change = delta(s)
  const days = summarise(model.data, 'all', model.now).days.slice(-14)
  return ui.Box({ flexDirection: 'column', children: [
    ui.Text({ dimColor: true, children: ['Claude costs · ' + s.period.label.toLowerCase()] }),
    ui.Text({ bold: true, color: hex(COLOURS.accent), children: [exact(s.total)] }),
    ...(change ? [ui.Text({ color: hex(change.colour), wrap: 'truncate-end', children: [change.text] })] : []),
    draw(ui, model.surface, 'widget-bars', miniBars(days, 28, 3)),
  ] })
}

export function render(ui, model) {
  if (model.placement === 'widget') return widget(ui, model)
  const width = Math.max(30, model.width)
  const head = [
    ui.Text({ bold: true, children: ['Claude Code costs'] }),
    controls(ui, model),
    ...(model.busy ? [model.progress?.total
      ? ui.Progress({ label: 'Reading transcripts', value: model.progress.done, max: model.progress.total,
        valueText: `${model.progress.done} of ${model.progress.total} files` })
      : ui.Progress({ label: 'Reading transcripts' })] : []),
    ...(model.stalled ? [ui.Text({ color: 'yellow', wrap: 'wrap', children: ['The read has paused. Press r to continue.'] })] : []),
    ...(model.error ? [ui.Text({ color: 'yellow', wrap: 'wrap', children: [model.error] })] : []),
  ]
  if (!model.data) {
    const text = model.busy ? 'Reading saved costs…' : 'No report yet. Press r to read saved costs.'
    return ui.Box({ flexDirection: 'column', children: [...head, ui.Text({ dimColor: true, children: [text] })] })
  }
  const s = summarise(model.data, model.period, model.now)
  const ctx = { width, narrow: width < 48, surface: model.surface, allDays: summarise(model.data, 'all', model.now).days }
  const body = s.sessions.length ? BODIES[model.tab](ui, s, ctx)
    : [ui.Text({ dimColor: true, wrap: 'wrap', children: [`No saved costs in ${s.period.label.toLowerCase()}. Press p for a longer period.`] })]
  return ui.Box({ flexDirection: 'column', children: [
    ...head, tabRow(ui, model), ui.Text({ dimColor: true, children: ['─'.repeat(width)] }),
    ...hero(ui, s), ui.Text({ children: [' '] }), ...body, ...footer(ui, model, s),
  ] })
}

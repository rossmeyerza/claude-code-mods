// Pure aggregation over the scan's session rows. Days are UTC day numbers.
export const DAY = 86400000
export const PERIODS = [
  { id: 'week', days: 7, label: 'Last 7 days' },
  { id: 'month', days: 30, label: 'Last 30 days' },
  { id: 'quarter', days: 90, label: 'Last 90 days' },
  { id: 'all', days: null, label: 'All time' },
]
export const FAMILIES = ['Opus', 'Fable', 'Sonnet', 'Haiku', 'Other']

const sum = (items, pick) => items.reduce((total, item) => total + pick(item), 0)
export const dayOf = ms => Math.floor(ms / DAY)

export function family(name) {
  const match = /(opus|fable|sonnet|haiku)/i.exec(name)
  return match ? match[1][0].toUpperCase() + match[1].slice(1).toLowerCase() : 'Other'
}

// Splits a session's cost by model family. Cost that no model claims goes to Other.
export function familyCosts(session) {
  const parts = Object.fromEntries(FAMILIES.map(name => [name, 0]))
  for (const [model, metrics] of Object.entries(session.models)) parts[family(model)] += metrics[0]
  parts.Other += Math.max(0, session.cost - sum(FAMILIES, name => parts[name]))
  return parts
}

function daily(sessions, from, to) {
  const days = Array.from({ length: to - from + 1 }, (_, i) =>
    ({ day: from + i, total: 0, parts: Object.fromEntries(FAMILIES.map(name => [name, 0])) }))
  for (const session of sessions) {
    const slot = days[dayOf(session.start) - from]
    if (!slot) continue
    const parts = familyCosts(session)
    for (const name of FAMILIES) slot.parts[name] += parts[name]
    slot.total += sum(FAMILIES, name => parts[name])
  }
  return days
}

function ranked(sessions, keyOf, limit) {
  const groups = new Map()
  for (const session of sessions) {
    const key = keyOf(session)
    const group = groups.get(key) ?? { name: key, cost: 0, sessions: 0 }
    group.cost += session.cost
    group.sessions += 1
    groups.set(key, group)
  }
  const sorted = [...groups.values()].sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name))
  const rest = sorted.slice(limit)
  if (rest.length) sorted.splice(limit, rest.length,
    { name: `Other projects (${rest.length})`, cost: sum(rest, g => g.cost), sessions: sum(rest, g => g.sessions), isRest: true })
  return sorted
}

function tokens(sessions) {
  const rows = Object.fromEntries(FAMILIES.map(name => [name, { cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }]))
  for (const session of sessions) {
    for (const [model, [cost, input, output, cacheRead, cacheWrite]] of Object.entries(session.models)) {
      const row = rows[family(model)]
      row.cost += cost; row.input += input; row.output += output
      row.cacheRead += cacheRead; row.cacheWrite += cacheWrite
    }
  }
  const all = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  for (const row of Object.values(rows)) for (const key of Object.keys(all)) all[key] += row[key]
  const prompt = all.input + all.cacheRead + all.cacheWrite
  return { families: rows, all, cacheShare: prompt ? all.cacheRead / prompt : null }
}

// Spend rate over the last 7 complete UTC days, and this calendar month at that rate.
function pace(sessions, today) {
  const perDay = sum(sessions.filter(s => { const d = dayOf(s.start); return d >= today - 7 && d < today }), s => s.cost) / 7
  const date = new Date(today * DAY)
  const monthStart = dayOf(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
  const monthEnd = dayOf(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)) - 1
  const soFar = sum(sessions.filter(s => dayOf(s.start) >= monthStart && dayOf(s.start) <= today), s => s.cost)
  return { perDay, monthSoFar: soFar, monthProjected: soFar + perDay * (monthEnd - today) }
}

// Sessions that share a start time come from one process, whose cost record may carry over.
function overlaps(sessions) {
  const groups = new Map()
  for (const s of sessions) groups.set(s.start, [...(groups.get(s.start) ?? []), s])
  const shared = [...groups.values()].filter(group => group.length > 1)
  return { sessions: sum(shared, g => g.length), cost: sum(shared, g => sum(g, s => s.cost) - Math.max(...g.map(s => s.cost))) }
}

export function summarise(report, periodId, now) {
  const all = report.sessions
  const today = dayOf(now)
  const period = PERIODS.find(p => p.id === periodId) ?? PERIODS[PERIODS.length - 1]
  const firstDay = all.length ? Math.min(...all.map(s => dayOf(s.start))) : today
  const from = period.days ? today - period.days + 1 : Math.min(firstDay, today)
  const within = (s, a, b) => dayOf(s.start) >= a && dayOf(s.start) <= b
  const sessions = all.filter(s => within(s, from, today))
  const span = today - from + 1
  const previous = period.days && from - span >= firstDay
    ? sum(all.filter(s => within(s, from - span, from - 1)), s => s.cost) : null
  const days = daily(sessions, from, today)
  return {
    period, from, today, sessions, days, previous,
    total: sum(sessions, s => s.cost),
    busiest: days.reduce((best, d) => (d.total > (best?.total ?? 0) ? d : best), null),
    activeDays: days.filter(d => d.total > 0).length,
    projects: ranked(sessions, s => s.project, 9),
    families: FAMILIES.map(name => ({ name, cost: sum(days, d => d.parts[name]) })).filter(f => f.cost >= 0.005),
    tokens: tokens(sessions),
    top: [...sessions].sort((a, b) => b.cost - a.cost).slice(0, 12),
    pace: pace(all, today),
    lines: { added: sum(sessions, s => s.added), removed: sum(sessions, s => s.removed) },
    unknown: sessions.filter(s => s.unknown).length,
    overlap: overlaps(sessions),
  }
}

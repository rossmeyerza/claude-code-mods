import type { Color, Elements, FooterMetrics, FooterProject, RenderChildren, RenderElement, SessionRateLimit } from 'claude-code'

type Project = FooterProject
type Metrics = FooterMetrics

type UI = Pick<Elements['terminal'], 'Box' | 'Text'>
type Part = { text: string; color?: Color; dimColor?: boolean; bold?: boolean }
type Metric = Part[]

const LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'limit' }
const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
const clamp = (value: number) => Math.min(Math.max(value, 0), 100)
const size = (parts: Metric) => parts.reduce((sum, part) => sum + [...part.text].length, 0)
const separator: Part = { text: '  ·  ', dimColor: true }

function meter(percent: number, color: Color): Metric {
  const full = Math.round(clamp(percent) * 5 / 100)
  return [
    { text: '▰'.repeat(full), color },
    { text: '▱'.repeat(5 - full), dimColor: true },
    { text: ' ' },
  ]
}

function contextMetric(metrics: Metrics, bars: boolean): Metric {
  const used = metrics.contextPercent
  const color: Color = used === null ? 'inactive' : used >= 90 ? 'error' : used >= 75 ? 'warning' : 'success'
  return [
    { text: 'ctx ', dimColor: true },
    ...(bars && used !== null ? meter(used, color) : []),
    { text: used === null ? '   --' : `${metrics.estimated ? '~' : ''}${Math.round(used)}%`.padStart(5), color, bold: true },
    { text: ' used', dimColor: true },
  ]
}

function resetText(limit: SessionRateLimit): string {
  if (!limit.resetsAt) return ''
  const reset = new Date(limit.resetsAt)
  if (!Number.isFinite(reset.getTime())) return ''
  const time = reset.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
  const day = limit.kind === 'five_hour' ? '' : `${reset.toLocaleDateString('en-GB', { weekday: 'short' })} `
  return ` ↻ ${day}${time}`
}

function limitMetric(limit: SessionRateLimit, resets: boolean, bars: boolean): Metric {
  const left = Math.round(100 - clamp(limit.percentUsed))
  const color: Color = left <= 10 ? 'error' : left <= 25 ? 'warning' : 'success'
  return [
    { text: `${clean(LABELS[limit.kind] ?? limit.kind).slice(0, 12)} `, dimColor: true },
    ...(bars ? meter(left, color) : []),
    { text: `${left.toString().padStart(3)}%`, color, bold: true },
    { text: ' left', dimColor: true },
    ...(resets ? [{ text: resetText(limit), dimColor: true }] : []),
  ]
}

function join(metrics: Metric[]): Metric {
  return metrics.flatMap((metric, index) => index ? [separator, ...metric] : metric)
}

// Keep every percentage visible. Drop reset times before bars when space is limited.
export function metricRows(metrics: Metrics, columns: number): { parts: Metric; cost?: string }[] {
  const cost = metrics.cost === null ? undefined : `$${metrics.cost.toFixed(2)}`
  const costWidth = cost ? cost.length + 2 : 0
  const limits = metrics.limits.filter(limit => Number.isFinite(limit.percentUsed))
  const context = contextMetric(metrics, true)
  const all = join([context, ...limits.map(limit => limitMetric(limit, true, true))])
  if (size(all) + costWidth <= columns) return [{ parts: all, cost }]

  const compactContext = size(context) + costWidth <= columns ? context : contextMetric(metrics, false)
  const rows: { parts: Metric; cost?: string }[] = size(compactContext) + costWidth <= columns
    ? [{ parts: compactContext, cost }]
    : [{ parts: compactContext }, ...(cost ? [{ parts: [{ text: cost, dimColor: true }] }] : [])]

  const selected = limits.map(limit => limitMetric(limit, true, true))
  for (let index = selected.length - 1; index >= 0 && size(join(selected)) > columns; index--) {
    selected[index] = limitMetric(limits[index]!, false, true)
  }
  if (selected.length && size(join(selected)) <= columns) {
    rows.push({ parts: join(selected) })
  } else {
    let row: Metric[] = []
    for (const limit of limits) {
      let metric = limitMetric(limit, true, true)
      if (size(metric) > columns) metric = limitMetric(limit, false, true)
      if (size(metric) > columns) metric = limitMetric(limit, false, false)
      if (row.length && size(join([...row, metric])) > columns) {
        rows.push({ parts: join(row) })
        row = []
      }
      row.push(metric)
    }
    if (row.length) rows.push({ parts: join(row) })
  }
  return rows
}

export function panel(ui: UI, project: Project | null, metrics: Metrics | null, columns: number): RenderElement {
  const { Box, Text } = ui
  const width = Math.max(1, columns - 4)
  const rows: RenderChildren[] = []
  if (project) {
    rows.push(Box({ flexDirection: 'row', children: [
      Box({ flexGrow: 1, flexShrink: 1, minWidth: 0, children: Text({ wrap: 'truncate-end', children: [
        Text({ bold: true, children: clean(project.folder) }),
        project.branch ? Text({ dimColor: true, children: ` · ${clean(project.branch)}` }) : null,
      ] }) }),
      Box({ flexShrink: 1, width: Math.min([...project.model].length, Math.max(8, Math.floor(width * 0.45))), marginLeft: 2,
        children: Text({ color: 'claude', wrap: 'truncate-end', children: clean(project.model) }) }),
    ] }))
  }
  if (metrics) {
    for (const row of metricRows(metrics, width)) {
      rows.push(Box({ flexDirection: 'row', children: [
        Text({ wrap: 'wrap', children: row.parts.map(({ text, ...style }) => Text({ ...style, children: text })) }),
        ...(row.cost ? [Box({ flexGrow: 1 }), Text({ dimColor: true, children: row.cost })] : []),
      ] }))
    }
  }
  return Box({ flexDirection: 'column', width, children: rows })
}

// Number, date and duration formats shared by the pane and its charts.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function money(value) {
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}k`
  if (value >= 100) return `$${Math.round(value)}`
  return `$${value.toFixed(2)}`
}

export const exact = value => '$' + value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

export function count(value) {
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`
  return String(Math.round(value))
}

export function percent(part, whole) {
  if (!whole || part <= 0) return '0%'
  const value = (100 * part) / whole
  return value < 1 ? '<1%' : `${Math.round(value)}%`
}

export const axis = value => (value >= 10 ? `$${Math.round(value)}` : `$${value.toFixed(2)}`)

export function duration(ms) {
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return hours < 48 ? `${hours}h ${minutes % 60}m` : `${Math.round(hours / 24)}d`
}

export function date(day) {
  const value = new Date(day * 86400000)
  return `${value.getUTCDate()} ${MONTHS[value.getUTCMonth()]}`
}

export function fit(text, width) {
  if (width <= 0) return ''
  return text.length <= width ? text : text.slice(0, Math.max(0, width - 1)) + '…'
}
